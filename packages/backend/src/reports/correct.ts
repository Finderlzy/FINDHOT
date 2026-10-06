// A classification correction moves the same frozen entry between the sections of the dailies and
// evenings that carry it; it never composes another issue or pays a writer. A special's chapters are not
// sections and stay as written. The override, publication, report revisions and audit commit in the
// caller's transaction.
import { RELEASE } from "@aihot/industry/taxonomy";
import type { Tx } from "../db.ts";
import { isRelease } from "../editorial/vocabulary.ts";
import { emit } from "../modules.ts";
import { SECTION_ORDER, sectionOf } from "./edition.ts";

interface Entry { itemId: string; followUp?: string; firstParty?: boolean; role?: string; [key: string]: unknown }
interface Group { label?: string; items?: Entry[]; [key: string]: unknown }
interface Content { sections?: Group[]; metrics?: Record<string, number>; [key: string]: unknown }

/** Moves the item to its new section in every issue that carries it; says whether any issue changed. */
export async function correctReportClassification(tx: Tx, articleId: string, reason: string): Promise<boolean> {
  const [item] = await tx<{ category: string | null }[]>`SELECT category FROM publications WHERE article_id=${articleId}`;
  if (!item?.category) return false;
  const reports = await tx<{ id: number; content: Content; revision: number; generated_at: Date }[]>`
    SELECT id,content,revision,generated_at FROM reports
    WHERE kind IN ('daily','evening') AND content @> ${tx.json({ sections: [{ items: [{ itemId: articleId }] }] })}
    ORDER BY id FOR UPDATE`;
  let changed = false;
  for (const report of reports) {
    const content = structuredClone(report.content);
    const groups = content.sections ?? [];
    const from = groups.find(g => g.items?.some(e => e.itemId === articleId));
    if (!from || !SECTION_ORDER.includes(from.label ?? "")) continue;
    const label = sectionOf(item.category);
    if (from.label !== label) {
      const moving = from.items!.filter(e => e.itemId === articleId);
      from.items = from.items!.filter(e => e.itemId !== articleId);
      let target = groups.find(g => g.label === label);
      if (!target) { target = { label, items: [] }; groups.push(target); }
      target.items!.push(...moving);
    }
    const arranged = groups.filter(g => g.items?.length).sort((a, b) => SECTION_ORDER.indexOf(a.label!) - SECTION_ORDER.indexOf(b.label!));
    content.sections = arranged;
    // The release figure (dailyMetrics) follows the new classification; without a RELEASE kind there is none.
    if (RELEASE) {
      const entries = arranged.flatMap(g => g.items ?? []);
      const rows = await tx<{ article_id: string; category: string | null; tags: string[] }[]>`
        SELECT article_id,category,tags FROM publications WHERE article_id IN ${tx(entries.map(e => e.itemId))}`;
      const byId = new Map(rows.map(r => [r.article_id, r]));
      content.metrics = { ...content.metrics, modelsReleased: entries.filter(e => {
        const p = byId.get(e.itemId);
        return p && isRelease(p.category, p.tags) && !e.followUp && (e.firstParty || e.role === "官方" || e.role === "X·官方");
      }).length };
    }
    if (JSON.stringify(content) === JSON.stringify(report.content)) continue;
    await tx`INSERT INTO report_revisions (report_id,revision,content,generated_at,reason)
      VALUES (${report.id},${report.revision},${tx.json(report.content as never)},${report.generated_at},${`classification ${articleId}: ${reason}`})`;
    await tx`UPDATE reports SET content=${tx.json(content as never)},revision=revision+1,updated_at=now() WHERE id=${report.id}`;
    changed = true;
  }
  if (changed) await emit("reportsChanged", { reason: `report classification ${articleId}` }, tx);
  return changed;
}
