// What a special is about and what it is written from, decided by rule. A special tells one country or
// region: a topic of the industry pack that allows one (industry/topics.json). The topic is the one with
// the most events in the last two weeks, the last week counting double, that none of the last specials
// was about and whose reports are not mostly ones a recent special already told. Its material is the
// topic's selected reports of the last three weeks: the most important events, a few reports each, in
// the order they happened.
import { sql } from "../db.ts";
import { pickRepresentative } from "../publication/representative.ts";
import { TOPICS, type Topic } from "../publication/topics.ts";
import { citedIn, factKeyOf, groupBy, reportEntry, topicReports, type ReportEntry, type ReportRow } from "./edition.ts";

const DAY = 86_400_000;
/** The days a topic's events are counted over, and the days a special is written from. */
export const CHOICE_DAYS = 14;
export const MATERIAL_DAYS = 21;
/** A topic needs this many events in the counted days to be worth a special. */
export const MIN_EVENTS = 5;
/** Specials whose topics are not chosen again, and the share of a topic's reports they may already have told. */
const RECENT_SPECIALS = 4;
const TOLD_SHARE = 0.5;
/** The material: this many events, at most this many reports each. */
const MATERIAL_EVENTS = 18;
const PER_EVENT = 3;

export interface SpecialMaterial extends ReportEntry {
  /** Its number in the brief, from 1. */
  n: number;
}

const eventOf = (r: ReportRow) => (r.story_id === null ? `f:${factKeyOf(r)}` : `s:${r.story_id}`);

/** What the last specials were about and which reports they cited. */
async function recentSpecials(before: string): Promise<Array<{ slug: string | null; cited: Set<string> }>> {
  const rows = await sql<{ content: Record<string, any> }[]>`
    SELECT content FROM reports WHERE kind = 'special' AND key < ${before} ORDER BY key DESC LIMIT ${RECENT_SPECIALS}`;
  return rows.map((r) => ({
    slug: typeof r.content.topic?.slug === "string" ? r.content.topic.slug : null,
    cited: new Set(citedIn(r.content).map((c) => String(c.itemId ?? "")).filter(Boolean)),
  }));
}

/** The topic of the special dated `date` with its end, and the reports it is written from; null when no topic has enough news. */
export async function chooseTopic(date: string, end: Date): Promise<{ topic: Topic; rows: ReportRow[] } | null> {
  const recent = await recentSpecials(date);
  const told = new Set(recent.map((r) => r.slug));
  const start = new Date(end.getTime() - MATERIAL_DAYS * DAY);
  const counted = end.getTime() - CHOICE_DAYS * DAY;
  const lastWeek = end.getTime() - 7 * DAY;
  let best: { topic: Topic; rows: ReportRow[]; rank: number } | null = null;
  for (const topic of TOPICS.filter((t) => t.special && !told.has(t.slug))) {
    const rows = await topicReports(topic, start, end);
    if (recent.some((r) => rows.filter((row) => r.cited.has(row.id)).length > TOLD_SHARE * rows.length)) continue;
    const latest = [...groupBy(rows, eventOf).values()].map((members) => Math.max(...members.map((m) => m.timeline_at.getTime())));
    const events = latest.filter((at) => at >= counted).length;
    if (events < MIN_EVENTS) continue;
    const rank = events + latest.filter((at) => at >= lastWeek).length;
    if (!best || rank > best.rank) best = { topic, rows, rank };
  }
  return best && { topic: best.topic, rows: best.rows };
}

/**
 * The reports a special is written from: the most important events (most reports, then the best score),
 * each by its representative reports of up to three of its facts, numbered in the order they happened.
 */
export function specialMaterial(rows: ReportRow[]): SpecialMaterial[] {
  const events = [...groupBy(rows, eventOf).values()]
    .map((members) => {
      const facts = [...groupBy(members, factKeyOf).values()].map((f) => pickRepresentative(f));
      return { facts, weight: members.length + Math.max(...members.map((m) => m.score ?? 0)) / 20 };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MATERIAL_EVENTS);
  return events
    .flatMap((e) => [...e.facts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, PER_EVENT))
    .sort((a, b) => a.timeline_at.getTime() - b.timeline_at.getTime() || a.id.localeCompare(b.id))
    .map((r, i) => ({ ...reportEntry(r), n: i + 1 }));
}
