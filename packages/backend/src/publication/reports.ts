// Reports through the public read layer: website DTOs and the v1 shapes. Only real reports are
// listed; a missing date is a 404, never another day. Withdrawn citations are marked, not shown.
import type { ReportCitation, ReportDetail, ReportIndexEntry, ReportNavigationEntry, ReportKind } from "@aihot/contracts/site";
import { REPORTS, SITE, withSubject } from "@aihot/site";
import { sql } from "../db.ts";
import { cached, type Cached } from "../lib/cache.ts";
import { proxiedImage, proxiedImageSet } from "../media/imgproxy.ts";
import { itemUrl, reportUrl, siteUrl } from "./links.ts";
import { publicSourceName } from "./rules.ts";
import { listedCondition } from "./scope.ts";

export type { ReportKind };

/** How an issue is stored: a daily's or evening's sections of entries, or a special's chapters. */
type Shape = "daily" | "special";
const shapeOf = (kind: ReportKind): Shape => (kind === "special" ? "special" : "daily");

interface ReportRow {
  kind: ReportKind;
  key: string;
  window_start: Date;
  window_end: Date;
  content: Record<string, any>;
  generated_at: Date;
}

interface Availability {
  available: boolean;
  /** The article's public summary, for issues saved before summaries were frozen into them. */
  summary: string | null;
  firstParty: boolean;
  sourceId: string | null;
  sourceName: string | null;
  sourceIcon: string | null;
  publishedAt: Date | null;
}

async function availability(ids: string[]): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>();
  if (ids.length === 0) return out;
  const rows = await sql<{ id: string; available: boolean; summary: string | null; first_party: boolean; source_id: string; source_name: string | null; icon_url: string | null; at: Date | null }[]>`
    SELECT p.article_id AS id, (${listedCondition(new Date())}) AS available, p.summary, (s.tier = 'T1') AS first_party, p.source_id, s.name AS source_name, s.icon_url,
      coalesce(p.published_at, p.discovered_at) AS at
    FROM publications p LEFT JOIN sources s ON s.id = p.source_id
    WHERE p.article_id IN ${sql(ids)}`;
  for (const r of rows) {
    out.set(r.id, {
      available: r.available,
      summary: r.summary,
      firstParty: r.first_party,
      sourceId: r.source_id,
      sourceName: r.source_name,
      sourceIcon: r.icon_url,
      publishedAt: r.at,
    });
  }
  return out;
}

/** Ids among `ids` that are no longer public. Ids absent from this database stay cited as published. */
export async function unavailableIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT p.article_id AS id FROM publications p
    WHERE p.article_id = ANY(${unique}::text[]) AND NOT (${listedCondition(new Date())})`;
  return new Set(rows.map((r) => r.id));
}

/**
 * Directory/feed metadata only: citation summaries and full report prose stay in the detail read. Issue
 * numbers count the whole series of the kind before the limit applies, so the 401st issue is numbered
 * 401 although the index keeps 400; a back-filled or deleted issue renumbers the ones after it.
 */
export async function reportIndexRows(kind: ReportKind, limit: number) {
  return sql<{ key: string; issue_number: number; content: Record<string, any>; generated_at: Date }[]>`
    SELECT key, generated_at, (row_number() OVER (ORDER BY key))::int AS issue_number, jsonb_build_object(
      'lead', content->'lead', 'headline', content->'headline', 'title', content->'title',
      'leadItemId', content->'leadItemId', 'highlights', content->'highlights',
      CASE WHEN kind = 'special' THEN 'themes' ELSE 'sections' END,
      jsonb_build_array(jsonb_build_object(CASE WHEN kind = 'special' THEN 'storyRefs' ELSE 'items' END,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', item->'itemId', 'title', item->'title') ORDER BY ord), '[]'::jsonb)
         FROM jsonb_array_elements(jsonb_path_query_array(content,
           CASE WHEN kind = 'special' THEN '$.themes[*].storyRefs[*]'::jsonpath ELSE '$.sections[*].items[*]'::jsonpath END
         )) WITH ORDINALITY AS cited(item, ord))))) AS content
    FROM reports WHERE kind = ${kind} ORDER BY key DESC LIMIT ${limit}`;
}

/** The entries an issue cites in reading order: a daily's or evening's sections, a special's chapters. */
function entriesOf(content: Record<string, any>, shape: Shape): Array<Record<string, any>> {
  return shape === "daily" ? (content.sections ?? []).flatMap((s: any) => s.items ?? []) : (content.themes ?? []).flatMap((t: any) => t.storyRefs ?? []);
}

/**
 * The entries a daily or evening may lead with, in order. An issue that names its lead item (composed by
 * rule) leads with that entry, then its highlights, then the rest; an issue without a written lead with
 * its entries as cited. A written lead is matched to its citation just as its cover is, so its
 * withdrawal can replace that lead too. An unmatched written lead has no individual citation.
 */
function leadCandidates(content: Record<string, any>): Array<Record<string, any>> {
  const entries = entriesOf(content, "daily");
  const leadId = content.leadItemId ?? writtenLeadId(content, entries);
  if (!leadId) return content.lead?.title ? [] : entries;
  const byId = new Map(entries.filter((e) => e.itemId).map((e) => [String(e.itemId), e]));
  const order = new Set([leadId, ...(content.highlights ?? []), ...entries.map((e) => e.itemId)].filter(Boolean).map(String));
  return [...order].map((id) => byId.get(id)).filter((e): e is Record<string, any> => !!e);
}

export interface IssueLead { itemId: string | null; title: string; leadParagraph: string | null }

/** A written lead's citation, using the same title match as a daily's front-page picture. */
function writtenLeadId(content: Record<string, any>, entries = entriesOf(content, "daily")): string | null {
  const title = content.lead?.title;
  if (!title) return null;
  return leadItemOf(title, [], entries as ReportCitation[])?.itemId ?? null;
}

/**
 * The lead an issue shows, everywhere it is shown (page, indexes, feeds, v1, MCP). A special leads with
 * its own title, whatever it cites. A daily or evening that names its lead item leads with that entry's
 * own title and summary; once the item is withdrawn, the next candidate still public leads in its own
 * words, so a withdrawn report is never set above the others. An earlier daily keeps its written lead,
 * else its first cited item still public. `gone` must cover the candidates before the first public one
 * (see {@link unavailableHeadlineIds}); entries read without summaries lead without a paragraph.
 */
export function issueLead(content: Record<string, any>, shape: Shape, gone: Set<string>): IssueLead | null {
  if (shape === "special") return content.headline ? { itemId: null, title: String(content.headline), leadParagraph: specialOverview(content) } : null;
  const candidates = leadCandidates(content);
  if (!candidates.length) return content.lead?.title ? { itemId: null, title: String(content.lead.title), leadParagraph: content.lead.leadParagraph ?? null } : null;
  const first = candidates.find((e) => !e.itemId || !gone.has(String(e.itemId)));
  if (!first) return null;
  const lead = { itemId: first.itemId ? String(first.itemId) : null, title: String(first.title ?? "") };
  const writtenId = content.leadItemId ? null : writtenLeadId(content);
  if (writtenId && first.itemId === writtenId) return { ...lead, title: String(content.lead.title), leadParagraph: content.lead.leadParagraph ?? null };
  const own = first.itemId === content.leadItemId && typeof content.lead?.leadParagraph === "string";
  return { ...lead, leadParagraph: own ? content.lead.leadParagraph : (content.leadItemId || writtenId) && typeof first.summary === "string" ? first.summary : null };
}

/**
 * Projected indexes and feeds keep no citation prose. Fetch just a replacement lead's frozen
 * paragraph after choosing it, in one batch; the 400-issue navigation stays free of full summaries.
 */
async function dailyLeads(kind: ReportKind, rows: Array<{ key: string; content: Record<string, any> }>, gone: Set<string>): Promise<Map<string, IssueLead | null>> {
  const leads = new Map(rows.map((r) => [r.key, issueLead(r.content, "daily", gone)]));
  const replacements = rows.flatMap((r) => {
    const lead = leads.get(r.key);
    return lead?.itemId && lead.leadParagraph === null && (r.content.leadItemId || writtenLeadId(r.content))
      ? [{ key: r.key, item_id: lead.itemId }] : [];
  });
  if (!replacements.length) return leads;
  const paragraphs = await sql<{ key: string; summary: string | null }[]>`
    SELECT r.key, (SELECT i->>'summary' FROM jsonb_path_query(r.content, '$.sections[*].items[*]') i
      WHERE i->>'itemId' = wanted.item_id LIMIT 1) AS summary
    FROM reports r JOIN jsonb_to_recordset(${sql.json(replacements)}) AS wanted(key text, item_id text) ON wanted.key = r.key
    WHERE r.kind = ${kind}`;
  for (const p of paragraphs) leads.get(p.key)!.leadParagraph = p.summary;
  return leads;
}

/** A special's dek. It tells the whole special, not one report, so a withdrawn citation leaves it standing. */
function specialOverview(content: Record<string, any>): string | null {
  return typeof content.overview === "string" && content.overview ? content.overview : null;
}

/** Check only the first possible lead of each report; advance reports whose candidate was withdrawn. */
export async function unavailableHeadlineIds(rows: Array<{ content: Record<string, any> }>, shape: Shape): Promise<Set<string>> {
  if (shape === "special") return new Set();
  const reports = rows.map((r) => leadCandidates(r.content)).filter((items) => items.length > 0);
  const gone = new Set<string>();
  const checked = new Set<string>();
  while (true) {
    const candidates = reports.map((items) => items.find((i) => !i.itemId || !gone.has(i.itemId))?.itemId)
      .filter((id): id is string => !!id && !checked.has(id));
    if (!candidates.length) return gone;
    for (const id of await unavailableIds(candidates)) gone.add(id);
    for (const id of candidates) checked.add(id);
  }
}

/** Ids among the cited items that are no longer public, from an availability read. */
const goneIn = (avail: Map<string, Availability>) => new Set([...avail].filter(([, a]) => !a.available).map(([id]) => id));

/** Items absent from this database (older than the imported window) stay cited as they were published. */
const stillPublic = (raw: Record<string, any>, avail: Map<string, Availability>) => !raw.itemId || (avail.get(raw.itemId)?.available ?? true);

/** Frozen citation fields, with current source metadata and a public summary only if none was saved. */
function citationMetadata(raw: Record<string, any>, a: Availability | undefined) {
  return {
    summary: raw.summary ?? a?.summary ?? null,
    sourceName: String(a?.sourceName ?? raw.sourceName ?? raw.source?.name ?? ""),
    sourceUrl: String(raw.sourceUrl ?? raw.links?.original ?? ""),
    publishedAt: a?.publishedAt?.toISOString() ?? (raw.publishedAt ? new Date(raw.publishedAt).toISOString() : null),
  };
}

/** A special's chapter is not printed once a report it cites was withdrawn: its text retells that report. */
function chapterParagraphs(chapter: Record<string, any>, avail: Map<string, Availability>): string[] {
  if ((chapter.storyRefs ?? []).some((e: Record<string, any>) => !stillPublic(e, avail))) return [];
  return Array.isArray(chapter.paragraphs) ? chapter.paragraphs.map(String) : [];
}

function citationFrom(raw: Record<string, any>, avail: Map<string, Availability>): ReportCitation {
  const id = raw.itemId ?? null;
  const a = id ? avail.get(id) : undefined;
  if (!stillPublic(raw, avail)) {
    // Withdrawn since: the reader sees a marked title; the summary and links are not sent at all.
    return {
      itemId: id, title: String(raw.title ?? ""), summary: null, sourceName: "", sourceUrl: "", sourceIconUrl: null,
      firstParty: false, publishedAt: null, available: false,
    };
  }
  const iconSrcSet = a?.sourceIcon ? proxiedImageSet(a.sourceIcon, "avatar") : null;
  const metadata = citationMetadata(raw, a);
  return {
    itemId: id,
    title: String(raw.title ?? ""),
    ...metadata,
    sourceName: publicSourceName(metadata.sourceName),
    sourceIconUrl: a?.sourceIcon ? proxiedImage(a.sourceIcon, "avatar") : null,
    ...(iconSrcSet ? { sourceIconSrcSet: iconSrcSet } : {}),
    firstParty: a?.firstParty ?? false,
    available: true,
  };
}

/**
 * How many sources an issue cites: those of its entries still public and of what is listed under them, as
 * the database has them, else as the issue recorded them.
 */
function citedSources(content: Record<string, any>, shape: Shape, avail: Map<string, Availability>): number {
  const cited = entriesOf(content, shape).filter((e) => stillPublic(e, avail)).flatMap((e) => [e, ...(e.related ?? [])]);
  return new Set(cited.filter((e) => stillPublic(e, avail)).map((e) => (e.itemId ? avail.get(e.itemId)?.sourceId : undefined) ?? e.sourceId).filter(Boolean)).size;
}

/**
 * A cited entry with what a daily or evening entry composed by rule adds: how many other sources reported
 * the event, the event's other developments listed under it (titles only), and the earlier issue it follows.
 */
function entryCitation(raw: Record<string, any>, avail: Map<string, Availability>): ReportCitation {
  const citation = citationFrom(raw, avail);
  if (!citation.available) return citation;
  const related: ReportCitation[] = (raw.related ?? []).map((r: Record<string, any>) => ({ ...citationFrom(r, avail), summary: null }));
  return {
    ...citation,
    ...(Number(raw.sources) > 1 ? { otherSources: Number(raw.sources) - 1 } : {}),
    ...(related.length ? { related } : {}),
    ...(typeof raw.followUp === "string" ? { followUp: raw.followUp } : {}),
  };
}

const bigrams = (text: string) => {
  const chars = [...text.toLowerCase().replace(/[\s\p{P}]/gu, "")];
  return new Set(chars.slice(1).map((ch, i) => chars[i] + ch));
};

/**
 * The item a daily's front page leads with. Without an editors' lead it is the first highlight (else
 * the first story), as the page sets it. The editors' lead is written about one of the items, so it is
 * the item whose title shares most of the lead's character pairs, if most of them are shared; a lead
 * that matches no item clearly has none.
 */
export function leadItemOf(leadTitle: string | undefined, highlights: ReportCitation[], all: ReportCitation[]): ReportCitation | undefined {
  if (!leadTitle) return highlights.find((c) => c.available) ?? all.find((c) => c.available);
  const want = bigrams(leadTitle);
  if (want.size === 0) return undefined;
  let best: { c: ReportCitation; share: number } | undefined;
  for (const c of all) {
    const have = bigrams(c.title);
    const share = [...want].filter((b) => have.has(b)).length / want.size;
    if (!best || share > best.share) best = { c, share };
  }
  return best && best.share >= 0.5 ? best.c : undefined;
}

/**
 * A picture for the front page's lead item: its own first sizeable image, else one from another public
 * report of the same event (first-hand first). Items shown as summaries only lend no pictures.
 */
async function leadCover(itemId: string): Promise<{ url: string; srcSet?: string; width: number | null; height: number | null } | null> {
  const [row] = await sql<{ m: { url: string; width?: number; height?: number } }[]>`
    SELECT img.m
    FROM publications p JOIN articles a ON a.id = p.article_id
    CROSS JOIN LATERAL (
      SELECT m FROM jsonb_array_elements(coalesce(a.media, '[]'::jsonb)) m
      WHERE m->>'kind' = 'image' AND coalesce((m->>'width')::numeric, 800) >= 480 LIMIT 1
    ) img
    WHERE (p.article_id = ${itemId} OR p.story_id = (SELECT story_id FROM publications WHERE article_id = ${itemId}))
      AND ${listedCondition(new Date())} AND p.body_mode <> 'summary'
    ORDER BY (p.article_id = ${itemId}) DESC, p.first_party DESC, coalesce(p.score, 0) DESC, p.article_id
    LIMIT 1`;
  if (!row) return null;
  const url = proxiedImage(row.m.url, "full");
  if (!url) return null;
  const srcSet = proxiedImageSet(row.m.url, "hero");
  return { url, ...(srcSet ? { srcSet } : {}), width: typeof row.m.width === "number" ? row.m.width : null, height: typeof row.m.height === "number" ? row.m.height : null };
}

function readingMinutes(text: string): number {
  return Math.max(1, Math.round([...text].length / 450));
}

async function neighbors(kind: ReportKind, key: string): Promise<{ prev: string | null; next: string | null }> {
  const [row] = await sql<{ prev: string | null; next: string | null }[]>`
    SELECT (SELECT key FROM reports WHERE kind = ${kind} AND key < ${key} ORDER BY key DESC LIMIT 1) AS prev,
      (SELECT key FROM reports WHERE kind = ${kind} AND key > ${key} ORDER BY key ASC LIMIT 1) AS next`;
  return { prev: row?.prev ?? null, next: row?.next ?? null };
}

export async function loadReport(kind: ReportKind, key: string): Promise<ReportDetail | null> {
  // Its number counts every issue of the kind up to it, as the index numbers them (reportIndexRows).
  const [r] = await sql<(Pick<ReportRow, "content" | "generated_at"> & { issue_number: number })[]>`
    SELECT r.content, r.generated_at, (SELECT count(*)::int FROM reports earlier WHERE earlier.kind = r.kind AND earlier.key <= r.key) AS issue_number
    FROM reports r WHERE r.kind = ${kind} AND r.key = ${key}`;
  if (!r) return null;
  const c = r.content;
  const shape = shapeOf(kind);
  const entries: Array<Record<string, any>> = [...entriesOf(c, shape), ...(c.flashes ?? [])];
  const rawItems = [...entries, ...entries.flatMap((e) => e.related ?? [])];
  const avail = await availability([...new Set(rawItems.map((i) => i.itemId).filter(Boolean))]);
  const cite = (raw: Record<string, any>) => entryCitation(raw, avail);

  const sections: ReportDetail["sections"] = shape === "daily"
    ? (c.sections ?? []).map((s: any) => ({ label: String(s.label), summary: null, items: (s.items ?? []).map(cite) }))
    : (c.themes ?? []).map((t: any) => ({ label: String(t.heading), summary: null, paragraphs: chapterParagraphs(t, avail), items: (t.storyRefs ?? []).map(cite) }));
  const all = sections.flatMap((s) => s.items);
  const highlightIds: string[] = c.highlights ?? [];
  const highlights = highlightIds.length
    ? highlightIds.map((id) => all.find((x: ReportCitation) => x.itemId === id)).filter((x): x is ReportCitation => !!x)
    : all.slice(0, 3);
  const text = shape === "daily"
    ? [c.lead?.leadParagraph ?? "", ...all.flatMap((i: ReportCitation) => [`${i.title}${i.summary ?? ""}`, ...(i.related ?? []).map((r) => r.title)])].join("")
    : [c.overview ?? "", ...sections.flatMap((s) => s.paragraphs ?? [])].join("");
  // A daily or evening leads with the item it names (an issue composed by rule records it), or the one
  // standing in for it once withdrawn (issueLead); an earlier daily's lead is matched by title. A
  // special's picture comes from its most important cited report, captioned with it.
  const gone = goneIn(avail);
  const hasCitedLead = shape === "daily" && (!!c.leadItemId || !!writtenLeadId(c));
  const named = hasCitedLead ? issueLead(c, "daily", gone) : null;
  const overview = shape === "daily" ? c.overview ?? null : specialOverview(c);
  const leadItem = hasCitedLead
    ? all.find((x) => x.itemId === named?.itemId)
    : shape === "daily" ? leadItemOf(c.lead?.title, highlights, all) : (highlights.find((x) => x.available) ?? all.find((x) => x.available));
  const [{ prev, next }, picture] = await Promise.all([neighbors(kind, key), leadItem?.itemId && leadItem.available ? leadCover(leadItem.itemId) : null]);
  const cover = picture && leadItem ? { ...picture, caption: shape === "daily" ? null : leadItem.title } : null;
  const headline = shape === "special" && c.headline ? String(c.headline) : null;
  return {
    kind,
    key,
    issueNumber: r.issue_number,
    title: headline ?? `${withSubject(REPORT_NAME[kind])} · ${key}`,
    generatedAt: r.generated_at.toISOString(),
    lead: shape === "special"
      ? (headline ? { title: headline, leadParagraph: overview ?? "" } : null)
      : hasCitedLead ? (named ? { title: named.title, leadParagraph: named.leadParagraph ?? "" } : null) : c.lead ?? null,
    leadItemId: shape === "daily" && leadItem?.available ? leadItem.itemId : null,
    overview,
    highlights,
    sections,
    flashes: (c.flashes ?? []).map(cite),
    cover,
    ...(c.topic?.slug ? { topic: { slug: String(c.topic.slug), name: String(c.topic.name) } } : {}),
    metrics: {
      ...c.metrics,
      ...(c.metrics?.firstPartyEvents !== undefined ? { firstPartyEvents: all.filter((i) => i.firstParty).length } : {}),
      ...(c.metrics?.sourcesCount !== undefined ? { sourcesCount: citedSources(c, shape, avail) } : {}),
    },
    readingMinutes: readingMinutes(text),
    prev,
    next,
  };
}

/** Each kind's name in titles ("日报"), after the site's subject word. */
export const REPORT_NAME: Record<ReportKind, string> = { daily: "日报", evening: "晚报", special: "专题报" };

/**
 * The newest 400 issues of a kind with their withdrawn headline candidates. Every archive, navigation
 * and feed of that kind reads this; after one minute readers wait for its replacement so an expired
 * index cannot reintroduce a withdrawn headline into downstream caches.
 */
const INDEX_LIMIT = 400;
const indexes = new Map<ReportKind, Cached<{ rows: Awaited<ReturnType<typeof reportIndexRows>>; gone: Set<string> }>>();
export function reportIndex(kind: ReportKind) {
  let entry = indexes.get(kind);
  if (!entry) {
    entry = cached(async () => {
      const rows = await reportIndexRows(kind, INDEX_LIMIT);
      return { rows, gone: await unavailableHeadlineIds(rows, shapeOf(kind)) };
    }, { freshMs: 60_000, maxStaleMs: 60_000 });
    indexes.set(kind, entry);
  }
  return entry.get();
}

export async function listReports(kind: ReportKind, limit = INDEX_LIMIT): Promise<ReportIndexEntry[]> {
  const index = await reportIndex(kind);
  const rows = index.rows.slice(0, limit);
  const shape = shapeOf(kind);
  const gone = index.gone;
  return rows.map((r) => ({
    key: r.key,
    issueNumber: r.issue_number,
    title: issueLead(r.content, shape, gone)?.title ?? null,
    count: entriesOf(r.content, shape).length,
  }));
}

// v1

const attribution = (url: string) => ({ name: SITE.name, url });

/** The v1 index of dailies or evenings, newest first: date, lead and link. */
export async function v1Dailies(kind: "daily" | "evening", limit: number) {
  const index = await reportIndex(kind);
  const rows = index.rows.slice(0, limit);
  const gone = index.gone;
  const leads = await dailyLeads(kind, rows, gone);
  const items = rows.map((r) => {
    const url = reportUrl(kind, r.key);
    const lead = leads.get(r.key);
    return {
      date: r.key,
      generatedAt: r.generated_at.toISOString(),
      leadTitle: lead?.title ?? null,
      leadParagraph: lead?.leadParagraph ?? null,
      links: { aihot: url },
      attribution: attribution(url),
    };
  });
  return { schemaVersion: 1 as const, count: items.length, items };
}

/**
 * What a daily or evening entry adds for readers of the Agent answer, keyed by the entry's link: other
 * sources, the event's other developments (title and link on this site), and the earlier issue it follows.
 */
export interface DailyNote {
  otherSources: number;
  related: Array<{ title: string; link: string }>;
  followUp: string | null;
}

/** The v1 daily or evening (its fields never change) and the notes the Agent answer adds to it. */
export async function dailyWithNotes(kind: "daily" | "evening", date: string | "latest") {
  const [r] = date === "latest"
    ? await sql<ReportRow[]>`SELECT kind, key, window_start, window_end, content, generated_at FROM reports WHERE kind = ${kind} ORDER BY key DESC LIMIT 1`
    : await sql<ReportRow[]>`SELECT kind, key, window_start, window_end, content, generated_at FROM reports WHERE kind = ${kind} AND key = ${date}`;
  if (!r) return null;
  const c = r.content;
  const raw = [...(c.sections ?? []).flatMap((s: any) => s.items ?? []), ...(c.flashes ?? [])];
  const avail = await availability([...new Set([...raw, ...raw.flatMap((i: any) => i.related ?? [])].map((i: any) => i.itemId).filter(Boolean))] as string[]);
  const ok = (i: any) => !i.itemId || (avail.get(i.itemId)?.available ?? true);
  const metadata = (i: any) => citationMetadata(i, avail.get(i.itemId));
  const links = (i: any) => ({ aihot: i.itemId ? itemUrl(i.itemId) : null, original: metadata(i).sourceUrl });
  const url = reportUrl(kind, r.key);
  const lead = c.lead || c.leadItemId ? issueLead(c, "daily", goneIn(avail)) : null;
  const notes = new Map<string, DailyNote>();
  for (const i of raw.filter(ok)) {
    const related = (i.related ?? []).filter((x: any) => x.itemId && ok(x)).map((x: any) => ({ title: String(x.title), link: itemUrl(x.itemId) }));
    const otherSources = Number(i.sources) > 1 ? Number(i.sources) - 1 : 0;
    if (otherSources || related.length || i.followUp) notes.set(links(i).aihot ?? links(i).original, { otherSources, related, followUp: i.followUp ?? null });
  }
  const body = {
    schemaVersion: 1 as const,
    report: {
      date: r.key,
      generatedAt: r.generated_at.toISOString(),
      windowStart: r.window_start.toISOString(),
      windowEnd: r.window_end.toISOString(),
      links: { aihot: url },
      attribution: attribution(url),
      lead: lead ? { title: lead.title, leadParagraph: lead.leadParagraph ?? "" } : null,
      sections: (c.sections ?? []).map((s: any) => ({
        label: String(s.label),
        items: (s.items ?? []).filter(ok).map((i: any) => ({
          title: String(i.title),
          summary: String(metadata(i).summary ?? ""),
          source: { name: metadata(i).sourceName },
          links: links(i),
          attribution: attribution(i.itemId ? itemUrl(i.itemId) : url),
        })),
      })),
      flashes: (c.flashes ?? []).filter(ok).map((i: any) => ({
        title: String(i.title),
        source: { name: metadata(i).sourceName },
        links: links(i),
        publishedAt: metadata(i).publishedAt ?? r.generated_at.toISOString(),
        attribution: attribution(i.itemId ? itemUrl(i.itemId) : url),
      })),
    },
  };
  return { body, notes };
}

export async function v1Daily(kind: "daily" | "evening", date: string | "latest") {
  return (await dailyWithNotes(kind, date))?.body ?? null;
}

export interface FeedIssue {
  key: string;
  generatedAt: Date;
  headline: string | null;
  /** A daily's or evening's lead paragraph; a special's dek. */
  leadParagraph: string | null;
  sections: Array<{ label: string; items: Array<{ title: string; link: string }> }>;
}

/**
 * The newest issues of a kind for its RSS feed: headline, lead paragraph (a special's dek) and each
 * section's or chapter's entry titles with their links on this site, withdrawn ones left out.
 */
export async function feedIssues(kind: ReportKind, limit: number): Promise<FeedIssue[]> {
  const shape = shapeOf(kind);
  const rows = shape === "daily"
    ? await sql<{ key: string; generated_at: Date; content: Record<string, any> }[]>`
      SELECT key, generated_at, jsonb_build_object(
        'lead', content->'lead', 'leadItemId', content->'leadItemId', 'highlights', content->'highlights',
        'sections', (SELECT coalesce(jsonb_agg(jsonb_build_object('label', s->'label', 'items',
          (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', i->'itemId', 'title', i->'title') ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) WITH ORDINALITY AS e(i, ord))) ORDER BY sord), '[]'::jsonb)
          FROM jsonb_array_elements(coalesce(content->'sections', '[]'::jsonb)) WITH ORDINALITY AS x(s, sord))) AS content
      FROM reports WHERE kind = ${kind} ORDER BY key DESC LIMIT ${limit}`
    : await sql<{ key: string; generated_at: Date; content: Record<string, any> }[]>`
      SELECT key, generated_at, jsonb_build_object(
        'headline', content->'headline', 'overview', content->'overview',
        'themes', (SELECT coalesce(jsonb_agg(jsonb_build_object('heading', t->'heading', 'storyRefs',
          (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', i->'itemId', 'title', i->'title') ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(t->'storyRefs', '[]'::jsonb)) WITH ORDINALITY AS e(i, ord))) ORDER BY tord), '[]'::jsonb)
          FROM jsonb_array_elements(coalesce(content->'themes', '[]'::jsonb)) WITH ORDINALITY AS x(t, tord))) AS content
      FROM reports WHERE kind = ${kind} ORDER BY key DESC LIMIT ${limit}`;
  const gone = await unavailableIds(rows.flatMap((r) => entriesOf(r.content, shape).map((i) => i.itemId)));
  const leads = shape === "daily" ? await dailyLeads(kind, rows, gone) : null;
  return rows.map((r) => {
    const lead = leads ? leads.get(r.key) : issueLead(r.content, shape, gone);
    const groups: Array<{ label: unknown; items?: Array<Record<string, any>> }> = shape === "daily"
      ? (r.content.sections ?? []).map((s: any) => ({ label: s.label, items: s.items }))
      : (r.content.themes ?? []).map((t: any) => ({ label: t.heading, items: t.storyRefs }));
    return {
      key: r.key,
      generatedAt: r.generated_at,
      headline: lead?.title ?? null,
      leadParagraph: lead?.leadParagraph ?? null,
      sections: groups.map((g) => ({
        label: String(g.label),
        items: (g.items ?? []).filter((i) => i.itemId && !gone.has(i.itemId)).map((i) => ({ title: String(i.title), link: itemUrl(i.itemId) })),
      })).filter((s) => s.items.length > 0),
    };
  });
}

// v1 specials

/** A special's own date, topic and the days it was written from. */
function specialOf(r: { key: string; content: Record<string, any> }) {
  return {
    date: r.key,
    topic: r.content.topic?.slug ? { slug: String(r.content.topic.slug), name: String(r.content.topic.name) } : null,
    periodStart: typeof r.content.periodStart === "string" ? r.content.periodStart : null,
    periodEnd: typeof r.content.periodEnd === "string" ? r.content.periodEnd : null,
  };
}

/** The v1 index of specials, newest first: date, topic, headline and link. */
export async function v1Specials(limit: number) {
  const rows = await sql<{ key: string; generated_at: Date; content: Record<string, any> }[]>`
    SELECT key, generated_at, jsonb_build_object('topic', content->'topic', 'headline', content->'headline', 'periodStart', content->'periodStart', 'periodEnd', content->'periodEnd') AS content
    FROM reports WHERE kind = 'special' ORDER BY key DESC LIMIT ${limit}`;
  const items = rows.map((r) => {
    const url = reportUrl("special", r.key);
    return { ...specialOf(r), generatedAt: r.generated_at.toISOString(), headline: r.content.headline ?? null, links: { aihot: url }, attribution: attribution(url) };
  });
  return { schemaVersion: 1 as const, count: items.length, items };
}

/**
 * A special in v1: its headline, dek and chapters, each with its paragraphs and the reports it cites in
 * order. A chapter citing a withdrawn report keeps its heading and remaining citations without its
 * text; withdrawn reports are left out.
 */
export async function v1Special(date: string | "latest") {
  const [r] = date === "latest"
    ? await sql<ReportRow[]>`SELECT kind, key, window_start, window_end, content, generated_at FROM reports WHERE kind = 'special' ORDER BY key DESC LIMIT 1`
    : await sql<ReportRow[]>`SELECT kind, key, window_start, window_end, content, generated_at FROM reports WHERE kind = 'special' AND key = ${date}`;
  if (!r) return null;
  const c = r.content;
  const raw = entriesOf(c, "special");
  const avail = await availability([...new Set(raw.map((i) => i.itemId).filter(Boolean))] as string[]);
  const ok = (i: Record<string, any>) => stillPublic(i, avail);
  const url = reportUrl("special", r.key);
  return {
    schemaVersion: 1 as const,
    report: {
      ...specialOf(r),
      generatedAt: r.generated_at.toISOString(),
      windowStart: r.window_start.toISOString(),
      windowEnd: r.window_end.toISOString(),
      links: { aihot: url },
      attribution: attribution(url),
      headline: c.headline ?? null,
      overview: specialOverview(c),
      sections: (c.themes ?? []).map((t: any) => ({
        label: String(t.heading),
        paragraphs: chapterParagraphs(t, avail),
        items: (t.storyRefs ?? []).filter(ok).map((i: any) => {
          const metadata = citationMetadata(i, avail.get(i.itemId));
          return {
            title: String(i.title),
            summary: String(metadata.summary ?? ""),
            source: { name: metadata.sourceName },
            links: { aihot: i.itemId ? itemUrl(i.itemId) : null, original: metadata.sourceUrl },
            publishedAt: metadata.publishedAt,
            attribution: attribution(i.itemId ? itemUrl(i.itemId) : url),
          };
        }),
      })),
    },
  };
}

export { siteUrl };

export function reportNavigation(kind: ReportKind, index: ReportIndexEntry[], key: string): ReportNavigationEntry[] {
  const at = index.findIndex((e) => e.key === key);
  return index.map((entry, n) => ({ key: entry.key, issueNumber: entry.issueNumber,
    ...(kind === "special" || entry.key.slice(0, 7) === key.slice(0, 7) || n < 3 || Math.abs(n - at) <= 1 ? { title: entry.title } : {}),
  }));
}

export async function loadReportNavigation(kind: ReportKind, key: string) {
  return reportNavigation(kind, await listReports(kind), key);
}

export async function loadReportMonth(kind: ReportKind, month: string) {
  return (await listReports(kind)).filter((e) => e.key.startsWith(month)).map(({ key, issueNumber, title }) => ({ key, issueNumber, title }));
}
