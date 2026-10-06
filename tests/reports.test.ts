// Reports: a scheduled run that starts late still writes the issue it was due for, never one whose
// window is still open; a daily and an evening split the day without a gap or an overlap; an issue
// with nothing in it is refused rather than published empty; a special prints only what its material
// names and drops a chapter's text once a report it cites is withdrawn; and a special that froze no
// summaries shows the cited articles' public summaries.
import { editionAt, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadReport } from "@aihot/backend/publication/reports";
import { composeDaily, composeEvening, dueDaily, dueEvening, dueSpecial, editionWindow, vetArticle } from "@aihot/backend/reports/compose";
import type { SpecialMaterial } from "@aihot/backend/reports/special";

const T = tag();
const SOURCE = `test-reports-${T}`;
const SPECIAL = `2098-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 10)}`;
after(async () => {
  await sql`DELETE FROM reports WHERE kind = 'special' AND key = ${SPECIAL}`;
  await stopBoss();
  await closeDb();
});

test("a late run writes the issue that was due, not today's", () => {
  assert.equal(dueDaily(editionAt("daily", "2026-09-29", 6)), "2026-09-29");
  assert.equal(dueDaily(editionAt("daily", "2026-09-30", -60)), "2026-09-29", "the 29th's run delayed until just before the next issue");
  assert.equal(dueEvening(editionAt("evening", "2026-09-29", 6)), "2026-09-29");
  assert.equal(dueEvening(editionAt("evening", "2026-09-29", -60)), "2026-09-28", "before its edition time today's evening is not due");
  // 2026-10-07 is a Wednesday and 2026-10-10 a Saturday, the special's days.
  assert.equal(dueSpecial(editionAt("special", "2026-10-07", 60)), "2026-10-07");
  assert.equal(dueSpecial(editionAt("special", "2026-10-07", -60)), "2026-10-03", "Wednesday before its edition time: Saturday's is still the newest");
  assert.equal(dueSpecial(editionAt("special", "2026-10-09")), "2026-10-07");
});

test("a daily and an evening cover the day in two halves, back to back", () => {
  const evening = editionWindow("evening", "2026-09-29");
  const daily = editionWindow("daily", "2026-09-30");
  assert.equal(evening.start.getTime(), editionWindow("daily", "2026-09-29").end.getTime(), "the evening starts when that morning's daily closed");
  assert.equal(daily.start.getTime(), evening.end.getTime(), "the next daily starts when the evening closed");
  assert.equal(evening.end.getTime(), editionAt("evening", "2026-09-29").getTime());
});

test("an issue with nothing in its window is refused, not published empty", async () => {
  const date = "2098-01-15";
  await assert.rejects(composeDaily(date), /no selected items/);
  await assert.rejects(composeEvening(date), /no selected items/);
  const [row] = await sql`SELECT 1 FROM reports WHERE kind IN ('daily', 'evening') AND key = ${date}`;
  assert.equal(row, undefined);
});

test("a special prints only the paragraphs its material grounds, and nothing when too little survives", () => {
  const material: SpecialMaterial[] = [1, 2].map((n) => ({
    n, itemId: `a${n}`, factId: null, storyPublicId: null, title: `报道${n}`, summary: `第${n}篇说了 2026 年的 315 架飞机`,
    sourceName: "S", sourceUrl: "https://example.com", sourceId: "s", firstParty: false, role: "媒体", score: 80, publishedAt: "2026-09-30T00:00:00Z",
  }));
  const corpus = material.map((m) => `${m.title} ${m.summary}`).join("\n");
  const grounded = "这一段只说材料里有的 315 架飞机。".repeat(30);
  const invented = "这一段编了一个 4821 的数字。".repeat(30);
  const written = {
    title: "飞机的事", dek: "讲讲 315 架飞机。",
    chapters: [
      { heading: "第一章", paragraphs: [grounded, grounded, grounded, invented], refs: [1, 9] },
      { heading: "第二章", paragraphs: [grounded], refs: [] },
    ],
  };
  const article = vetArticle(written, material, corpus);
  assert.ok(!("error" in article));
  assert.deepEqual(article.chapters.map((c) => c.heading), ["第一章"], "a chapter citing nothing in the material is dropped");
  assert.equal(article.chapters[0]!.paragraphs.length, 3, "the paragraph with an invented figure is not printed");
  assert.deepEqual(article.chapters[0]!.refs.map((m) => m.itemId), ["a1"], "unknown numbers cite nothing");
  const mostlyInvented = { ...written, chapters: [{ heading: "第一章", paragraphs: [grounded, invented, invented, invented], refs: [1] }] };
  assert.ok("error" in vetArticle(mostlyInvented, material, corpus));
  assert.ok("error" in vetArticle({ ...written, title: "编了 4821 架" }, material, corpus), "an invented figure in the title fails the whole special");
});

test("a special shows its citations' public summaries, and drops a chapter's text once a citation is withdrawn", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Reports', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${T}/${n}`, title: `R ${T} ${n}`, bodyText: "b", bodyHtml: "<p>b</p>", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
              VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${`标题-${T}-${n}`}, ${`公开摘要-${T}-${n}`}, 80, true)`;
    await publishArticle(articleId, { releasedAt: new Date() });
    ids.push(articleId);
  }
  const ref = (id: string, n: number) => ({ itemId: id, title: `标题-${T}-${n}`, sourceName: "Old aggregator", sourceId: "old-source", firstParty: false, sourceUrl: "https://example.com" });
  const content = {
    kind: "special", topic: { slug: "japan", name: "日本" }, title: "专题标题", headline: "专题标题", overview: "导语",
    themes: [
      { heading: "一", summary: null, paragraphs: ["第一章正文"], storyRefs: [ref(ids[0]!, 1)] },
      { heading: "二", summary: null, paragraphs: ["第二章正文"], storyRefs: [ref(ids[1]!, 2)] },
    ],
  };
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
            VALUES ('special', ${SPECIAL}, now(), now(), ${sql.json(content as never)}, now(), 'manual')`;
  const report = await loadReport("special", SPECIAL);
  assert.equal(report?.title, "专题标题");
  assert.deepEqual(report?.topic, { slug: "japan", name: "日本" });
  assert.equal(report?.sections[0]?.items[0]?.summary, `公开摘要-${T}-1`);
  assert.equal(report?.sections[0]?.items[0]?.sourceName, "Reports");
  assert.equal(report?.sections[0]?.items[0]?.firstParty, true, "a frozen citation cannot override verified current provenance");
  assert.deepEqual(report?.sections.map((s) => s.paragraphs), [["第一章正文"], ["第二章正文"]]);
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${ids[1]!}`;
  const after = await loadReport("special", SPECIAL);
  assert.deepEqual(after?.sections.map((s) => s.paragraphs), [["第一章正文"], []]);
  assert.equal(after?.sections[1]?.items[0]?.available, false);
  assert.equal(after?.lead?.title, "专题标题", "a special keeps its own title whatever is withdrawn");
});
