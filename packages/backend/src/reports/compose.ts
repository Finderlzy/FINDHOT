// Dailies, evenings and specials. Windows are Beijing calendar based and written into the report;
// missed schedule points are caught up; regeneration creates a revision. A daily and an evening each
// cover half a day and are composed by rule from edition.ts without a model. A special's topic and
// material are chosen by rule (special.ts); a model writes the article from the brief in the industry
// pack (industry/prompts/report-special.md), and what it writes beyond its material is not printed.
import { z } from "zod";
import { EDITION_TIMES, SITE, SPECIAL_DAYS } from "@aihot/site";
import { PLAIN_TERMS, RELEASE } from "@aihot/industry/taxonomy";
import type { ReportKind } from "@aihot/contracts/site";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { modelFor } from "../editorial/models.ts";
import { ENTITIES, isRelease } from "../editorial/vocabulary.ts";
import { addDays, beijingAt, beijingDate, beijingTime } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt, rejectReceivedResponse } from "../providers/receipts.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import { logError } from "../lib/log-error.ts";
import { emit } from "../modules.ts";
import { arrangeDaily, dailyEdition, sectionOf, SECTION_ORDER, type EditionEntry, type EditionKind } from "./edition.ts";
import { chooseTopic, MATERIAL_DAYS, MIN_EVENTS, specialMaterial, type SpecialMaterial } from "./special.ts";

export const REPORT_VERSION = promptVersion("report-special");

/**
 * The masthead's figures, counted in events: sources over every report its entries cite; releases
 * (`modelsReleased`, its public name) are the entries of the pack's headline launch kind (RELEASE: its
 * category and its tag, so not a ranking or a test) that a maker announced itself, new that day. An
 * industry without such a kind has no release figure.
 */
export function dailyMetrics(main: EditionEntry[]) {
  return {
    totalEvents: main.length,
    sourcesCount: new Set(main.flatMap((e) => [e.entry.sourceId, ...(e.entry.related ?? []).map((r) => r.sourceId)])).size,
    ...(RELEASE ? { modelsReleased: main.filter((e) => isRelease(e.category, e.tags) && !e.previous && e.authority < 3).length } : {}),
    firstPartyEvents: main.filter((e) => e.entry.firstParty).length,
  };
}

/** How many events an issue already published carries; nothing when it does not exist yet. */
async function savedReport(kind: ReportKind, key: string) {
  const [row] = await sql<{ entries: number }[]>`
    SELECT coalesce(CASE WHEN kind = 'special' THEN jsonb_array_length(content->'storyOrder') ELSE (content->'metrics'->>'totalEvents')::int END, 0) AS entries
    FROM reports WHERE kind = ${kind} AND key = ${key}`;
  return row;
}

/**
 * Without a reason (the scheduled run) only a missing issue is written: one already published stays as
 * it is. With a reason (an explicit regeneration) the issue is replaced and the edition it replaces is
 * kept as a revision. Says whether the issue was written.
 */
async function saveReport(kind: ReportKind, key: string, start: Date, end: Date, content: Record<string, unknown>, reason: string | undefined, model: string | null, receiptIds: number[]): Promise<boolean> {
  return sql.begin(async (tx) => {
    const insert = async () => (await tx`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, model, origin)
      VALUES (${kind}, ${key}, ${start}, ${end}, ${tx.json(content as never)}, now(), ${model}, 'model') ON CONFLICT (kind, key) DO NOTHING`).count > 0;
    let written: boolean;
    if (reason === undefined) written = await insert();
    else {
      const [existing] = await tx<{ id: number; revision: number; content: unknown; generated_at: Date }[]>`
        SELECT id, revision, content, generated_at FROM reports WHERE kind = ${kind} AND key = ${key} FOR UPDATE`;
      if (existing) {
        await tx`INSERT INTO report_revisions (report_id, revision, content, generated_at, reason)
                 VALUES (${existing.id}, ${existing.revision}, ${tx.json(existing.content as never)}, ${existing.generated_at}, ${reason}) ON CONFLICT DO NOTHING`;
        await tx`UPDATE reports SET content = ${tx.json(content as never)}, window_start = ${start}, window_end = ${end}, generated_at = now(),
                   model = ${model}, revision = revision + 1, origin = 'model', updated_at = now() WHERE id = ${existing.id}`;
        written = true;
      } else written = await insert();
    }
    // A new issue changes the latest page, the archive, its neighbours' navigation and the report feeds.
    if (written) await emit("reportsChanged", { reason: `${kind} ${key} published` }, tx);
    for (const id of receiptIds) await completeReceipt(tx, id);
    return written;
  });
}

/**
 * The half day an issue dated D covers: a daily from the evening's edition time the day before to its own
 * edition time on D, an evening from the daily's edition time on D to its own (EDITION_TIMES).
 */
export function editionWindow(kind: EditionKind, date: string): { start: Date; end: Date } {
  return kind === "daily"
    ? { start: beijingAt(addDays(date, -1), EDITION_TIMES.evening), end: beijingAt(date, EDITION_TIMES.daily) }
    : { start: beijingAt(date, EDITION_TIMES.daily), end: beijingAt(date, EDITION_TIMES.evening) };
}

/** A daily or evening for Beijing date D: its most important entry leads, in its own words, and the next three are its highlights. */
async function composeEdition(kind: EditionKind, date: string, reason?: string): Promise<{ key: string; entries: number }> {
  const previous = await savedReport(kind, date);
  if (previous && reason === undefined) return { key: date, entries: previous.entries };
  const { start, end } = editionWindow(kind, date);
  const edition = await dailyEdition(kind, date, start, end);
  // An issue with nothing in it is a failure upstream, not a report: the run fails and is caught up later.
  if (edition.entries.length === 0) throw new Error(`${kind} ${date}: no selected items in its window`);
  const issue = arrangeDaily(edition.entries);
  const [lead, ...rest] = issue.main as [EditionEntry, ...EditionEntry[]];
  const content = {
    date,
    lead: { title: lead.entry.title, leadParagraph: lead.entry.summary },
    leadItemId: lead.entry.itemId,
    highlights: rest.slice(0, 3).map((e) => e.entry.itemId),
    sections: SECTION_ORDER
      .map((label) => ({ label, items: issue.main.filter((e) => sectionOf(e.category) === label).map((e) => e.entry) }))
      .filter((s) => s.items.length > 0),
    flashes: issue.flashes.map((e) => e.entry),
    metrics: dailyMetrics(issue.main),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    generator: { version: "rule", ...edition.stats, ...issue.stats },
  };
  await saveReport(kind, date, start, end, content, reason, null, []);
  return { key: date, entries: issue.main.length };
}

export const composeDaily = (date: string, reason?: string) => composeEdition("daily", date, reason);
export const composeEvening = (date: string, reason?: string) => composeEdition("evening", date, reason);

/** How long a special is asked to be, and the least of it that must survive the check to be printed. */
const SPECIAL_CHARS = 3000;
const MIN_KEPT_CHARS = 1500;
const MIN_KEPT_SHARE = 0.6;
const TITLE_CHARS = 30;
const DEK_CHARS = 160;
const CHAPTER_HEADING_CHARS = 16;

export const SpecialSchema = z.object({
  title: z.string().max(200),
  dek: z.string().max(1000),
  chapters: z.array(z.object({
    heading: z.string().max(100),
    paragraphs: z.array(z.string().max(2000)).max(12),
    refs: z.array(z.number().int()).max(40).catch([]),
  })).min(1).max(10),
});

/** The writer's brief: the topic and its numbered material, each report as date, source, headline and summary. */
export function specialPrompt(topic: string, material: SpecialMaterial[]) {
  const line = (m: SpecialMaterial) => `[${m.n}] ${beijingDate(m.publishedAt)}｜${m.sourceName}｜${m.title}｜${m.summary.slice(0, 240)}`;
  return {
    system: promptText("report-special", { topic, days: String(MATERIAL_DAYS), chars: String(SPECIAL_CHARS) }),
    user: `本期：${topic}\n${material.map(line).join("\n")}`,
  };
}

const COMPANY_NAMES = Object.values(ENTITIES).map((e) => [e.name, ...e.aliases, ...(e.otherNames ?? [])].map((n) => n.toLowerCase()));
/** Words a writer may use that name nothing in particular: the pack's plain terms and the site's name. */
const PLAIN = new Set([...PLAIN_TERMS, SITE.name.toLowerCase()]);

/**
 * Whether written text names only what its material names: every capitalised or numbered Latin token
 * (Acme, Nova-2.5, X1), every figure of three or more digits or with a decimal point or percent (845,
 * 129.3, 40%) and every country or organisation of the vocabulary appears in the material's own words;
 * one may be named in either language (美国 for US).
 */
export function grounded(text: string, corpus: string): boolean {
  const known = corpus.toLowerCase();
  const companies = COMPANY_NAMES.filter((names) => names.some((n) => known.includes(n)));
  const named = (word: string) => PLAIN.has(word) || known.includes(word) || companies.some((names) => names.includes(word));
  const words = (text.match(/[A-Za-z][A-Za-z0-9.+-]*/g) ?? []).map((w) => w.replace(/[.+-]+$/, "")).filter((w) => /[A-Z0-9]/.test(w));
  const figures = (text.match(/\d+(?:\.\d+)?%?/g) ?? []).filter((f) => f.length >= 3 || /[.%]/.test(f));
  const lower = text.toLowerCase();
  const mentioned = COMPANY_NAMES.filter((names) => names.some((n) => /\p{Script=Han}/u.test(n) && lower.includes(n)));
  return words.every((w) => named(w.toLowerCase())) && figures.every((f) => known.includes(f)) && mentioned.every((names) => companies.includes(names));
}

/** The leading whole sentences of a text that fit in `max` characters; null when not even the first does. */
export function fitted(text: string, max: number): string | null {
  let out = "";
  for (const sentence of text.trim().match(/[^。！？]+(?:[。！？]+[」”’）]*|$)/g) ?? []) {
    if ([...out + sentence].length > max) break;
    out += sentence;
  }
  return out.trim() || null;
}

const length = (text: string) => [...text].length;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The article as printed, or why it cannot be: a title and dek that fit and name only what the material
 * names; each chapter's paragraphs that do, under its heading, citing the material it names by number
 * (a chapter without a valid citation cites nothing and is dropped). Most of what was written must
 * survive, else the special is not printed.
 */
export function vetArticle(written: z.infer<typeof SpecialSchema>, material: SpecialMaterial[], corpus: string) {
  const byN = new Map(material.map((m) => [m.n, m]));
  const title = oneLine(written.title);
  const dek = fitted(oneLine(written.dek), DEK_CHARS);
  if (!title || length(title) > TITLE_CHARS || !grounded(title, corpus)) return { error: "title missing, too long or naming what the material does not" } as const;
  if (!dek || !grounded(dek, corpus)) return { error: "dek missing or naming what the material does not" } as const;
  let writtenChars = 0;
  const chapters = written.chapters.flatMap((c) => {
    const paragraphs = c.paragraphs.map(oneLine).filter(Boolean);
    writtenChars += paragraphs.reduce((sum, p) => sum + length(p), 0);
    const kept = paragraphs.filter((p) => grounded(p, corpus));
    const refs = [...new Set(c.refs)].map((n) => byN.get(n)).filter((m): m is SpecialMaterial => !!m);
    const heading = oneLine(c.heading);
    if (!kept.length || !refs.length || !heading || length(heading) > CHAPTER_HEADING_CHARS) return [];
    return [{ heading, paragraphs: kept, refs }];
  });
  const keptChars = chapters.reduce((sum, c) => sum + c.paragraphs.reduce((n, p) => n + length(p), 0), 0);
  if (keptChars < MIN_KEPT_CHARS || keptChars < MIN_KEPT_SHARE * writtenChars) {
    return { error: `only ${keptChars} of ${writtenChars} characters could be printed` } as const;
  }
  return { title, dek, chapters, dropped: writtenChars - keptChars } as const;
}

/**
 * A special dated D, at its edition time: the topic chosen by rule, an article a model writes from its
 * material, and under each chapter the reports it cites. Without a topic that has enough news, or when
 * too little of what was written can be printed, the run fails and is tried again at the next run.
 */
export async function composeSpecial(date: string, reason?: string): Promise<{ key: string; entries: number }> {
  const previous = await savedReport("special", date);
  if (previous && reason === undefined) return { key: date, entries: previous.entries };
  const end = beijingAt(date, EDITION_TIMES.special);
  const start = new Date(end.getTime() - MATERIAL_DAYS * 86_400_000);
  const choice = await chooseTopic(date, end);
  if (!choice) throw new Error(`special ${date}: no topic has ${MIN_EVENTS} events in two weeks`);
  const material = specialMaterial(choice.rows);
  const corpus = [choice.topic.name, ...material.map((m) => `${beijingDate(m.publishedAt)} ${m.sourceName} ${m.title} ${m.summary}`)].join("\n");
  const model = await modelFor("report");
  const res = await chatJson({
    model, purpose: "report_special", subject: `report:special:${date}`, promptVersion: REPORT_VERSION,
    ...specialPrompt(choice.topic.name, material), schema: SpecialSchema, temperature: 0.6, maxTokens: 9000,
  });
  const article = vetArticle(res.data, material, corpus);
  if ("error" in article) {
    await rejectReceivedResponse(res.receiptId, `special ${date}: ${article.error}`);
    throw new Error(`special ${date} (${choice.topic.slug}): ${article.error}`);
  }
  const cite = ({ n: _n, ...m }: SpecialMaterial) => m;
  const cited = [...new Map(article.chapters.flatMap((c) => c.refs).map((m) => [m.itemId, m])).values()];
  const content = {
    kind: "special",
    topic: { slug: choice.topic.slug, name: choice.topic.name },
    title: article.title,
    headline: article.title,
    overview: article.dek,
    highlights: [...cited].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3).map((m) => m.itemId),
    themes: article.chapters.map((c) => ({ heading: c.heading, summary: null, paragraphs: c.paragraphs, storyRefs: c.refs.map(cite) })),
    storyOrder: cited.map((m) => m.itemId),
    periodStart: beijingDate(start),
    periodEnd: date,
    metrics: { reportsCited: cited.length, sourcesCount: new Set(cited.map((m) => m.sourceId)).size },
    generator: { version: REPORT_VERSION, model, material: material.length, droppedChars: article.dropped },
  };
  await saveReport("special", date, start, end, content, reason, model, [res.receiptId]);
  return { key: date, entries: cited.length };
}

/** The newest daily due by `now`: today's from its edition time (Beijing), yesterday's before. */
export function dueDaily(now = new Date()): string {
  const today = beijingDate(now);
  return beijingTime(now) >= EDITION_TIMES.daily ? today : addDays(today, -1);
}

/** The newest evening due by `now`: today's from its edition time (Beijing), yesterday's before. */
export function dueEvening(now = new Date()): string {
  const today = beijingDate(now);
  return beijingTime(now) >= EDITION_TIMES.evening ? today : addDays(today, -1);
}

/** The ISO weekday (1 Monday … 7 Sunday) of a Beijing date. */
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** The newest special due by `now`: the latest of its days (SPECIAL_DAYS) whose edition time has passed. */
export function dueSpecial(now = new Date()): string {
  const today = beijingDate(now);
  for (let back = 0; ; back++) {
    const date = addDays(today, -back);
    if (SPECIAL_DAYS.includes(weekday(date)) && (back > 0 || beijingTime(now) >= EDITION_TIMES.special)) return date;
  }
}

/**
 * The scheduled run (every half hour): every daily and evening due by `now` that does not exist yet,
 * oldest first. The newest one appears at the first run after it falls due (above); a long stop or an
 * older gap is filled too. A kind with no issue yet only gets its latest due one, and a special only ever
 * its latest: an older one would be written from news that has moved on. An issue that fails does not
 * hold up the others; at most `limit` issues are written per run, the next run continues.
 */
export async function composeDueReports(now = new Date(), limit = 8): Promise<{ generated: string[]; failed: string[] }> {
  const generated: string[] = [];
  const failed: string[] = [];
  const kinds: Array<{ kind: ReportKind; due: string; compose: (k: string) => Promise<unknown> }> = [
    { kind: "daily", due: dueDaily(now), compose: composeDaily },
    { kind: "evening", due: dueEvening(now), compose: composeEvening },
    { kind: "special", due: dueSpecial(now), compose: composeSpecial },
  ];
  kinds: for (const k of kinds) {
    const have = new Set((await sql<{ key: string }[]>`SELECT key FROM reports WHERE kind = ${k.kind}`).map((r) => r.key));
    const first = k.kind === "special" ? k.due : [...have].sort()[0] ?? k.due;
    for (let key = first; key <= k.due; key = addDays(key, 1)) {
      if (have.has(key)) continue;
      if (shutdownSignal.signal.aborted || generated.length >= limit) break kinds;
      try {
        await k.compose(key);
        generated.push(`${k.kind}:${key}`);
      } catch (error) {
        failed.push(`${k.kind}:${key}`);
        console.error(JSON.stringify({ level: "error", msg: "report failed", report: `${k.kind}:${key}`, error: logError(error) }));
      }
    }
  }
  if (failed.length) throw new Error(`reports: ${failed.join(", ")} failed${generated.length ? `; ${generated.join(", ")} written` : ""}`);
  return { generated, failed };
}
