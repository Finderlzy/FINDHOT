// What a special is about and what it is written from. A special tells one country or region: a topic of
// the industry pack that allows one (industry/topics.json). The candidates are those with collected
// reports in the last two weeks, apart from the topics of the last two specials; a model judges which of
// them makes an episode, from the brief in industry/prompts/special-pick.md, and none may. The material
// is the chosen topic's collected reports of the last three weeks, not only the selected ones: the most
// important events, a few reports each, in the order they happened.
import { sql } from "../db.ts";
import { pickRepresentative } from "../publication/representative.ts";
import { TOPICS, type Topic } from "../publication/topics.ts";
import { beijingDate } from "@aihot/contracts/time";
import { factKeyOf, groupBy, reportEntry, topicReports, type ReportEntry, type ReportRow } from "./edition.ts";

const DAY = 86_400_000;
/** The days a topic's news counts for its candidacy, and the days a special is written from. */
export const CHOICE_DAYS = 14;
export const MATERIAL_DAYS = 21;
/** The last specials whose topics are not candidates, and how many earlier ones the judge is told about. */
const RESTING_SPECIALS = 2;
const REMEMBERED_SPECIALS = 12;
/** What the judge sees: the topics with most events, and each one's latest headlines. */
const CANDIDATES = 12;
const HEADLINES = 12;
/** The material: this many events, at most this many reports each. */
const MATERIAL_EVENTS = 18;
const PER_EVENT = 3;

export interface SpecialMaterial extends ReportEntry {
  /** Its number in the brief, from 1. */
  n: number;
}

export interface Candidate {
  topic: Topic;
  rows: ReportRow[];
  events: number;
  /** The date of the latest special about it, when there was one. */
  told: string | null;
}

const eventOf = (r: ReportRow) => (r.story_id === null ? `f:${factKeyOf(r)}` : `s:${r.story_id}`);

/**
 * The topics a special dated `date` may be about: those with collected reports in the counted days, not
 * the topic of one of the last two specials, most events first.
 */
export async function specialCandidates(date: string, end: Date): Promise<Candidate[]> {
  const recent = await sql<{ key: string; slug: string | null }[]>`
    SELECT key, content->'topic'->>'slug' AS slug FROM reports WHERE kind = 'special' AND key < ${date} ORDER BY key DESC LIMIT ${REMEMBERED_SPECIALS}`;
  const resting = new Set(recent.slice(0, RESTING_SPECIALS).map((r) => r.slug));
  const start = new Date(end.getTime() - MATERIAL_DAYS * DAY);
  const counted = end.getTime() - CHOICE_DAYS * DAY;
  const out: Candidate[] = [];
  for (const topic of TOPICS.filter((t) => t.special && !resting.has(t.slug))) {
    const rows = await topicReports(topic, start, end);
    const events = [...groupBy(rows, eventOf).values()].filter((members) => members.some((m) => m.timeline_at.getTime() >= counted)).length;
    if (events > 0) out.push({ topic, rows, events, told: recent.find((r) => r.slug === topic.slug)?.key ?? null });
  }
  return out.sort((a, b) => b.events - a.events).slice(0, CANDIDATES);
}

/** The judge's list: each candidate with its events, when a special last told it, and its latest headlines. */
export function candidateList(candidates: Candidate[], end: Date): string {
  const counted = end.getTime() - CHOICE_DAYS * DAY;
  return candidates.map((c) => {
    const latest = [...groupBy(c.rows.filter((r) => r.timeline_at.getTime() >= counted), eventOf).values()]
      .map((members) => members.reduce((a, b) => (b.timeline_at > a.timeline_at ? b : a)))
      .sort((a, b) => b.timeline_at.getTime() - a.timeline_at.getTime())
      .slice(0, HEADLINES);
    return [
      `【${c.topic.slug}｜${c.topic.name}】近两周 ${c.events} 件事；${c.told ? `${c.told} 讲过一期` : "最近没讲过"}`,
      ...latest.map((r) => `- ${beijingDate(r.timeline_at).slice(5)} ${r.title}`),
    ].join("\n");
  }).join("\n\n");
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
