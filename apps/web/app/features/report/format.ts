// Names, dates and grouping for dailies, evenings and specials. Every issue is keyed by its date.
import { REPORT_KINDS, type ReportNavigationEntry, type ReportKind } from "@aihot/contracts/site";
import { beijingDate, beijingWeekday } from "@aihot/contracts/time";
import { EDITION_WHEN, REPORTS, SITE, subjectAfter } from "@aihot/site";
import { RELEASE } from "@aihot/industry/taxonomy";
import { monthDay, weekdayShort } from "../../lib/format.ts";

export const KINDS = REPORT_KINDS;
export const KIND_PATH: Record<ReportKind, string> = { daily: "/daily", evening: "/evening", special: "/special" };
export const KIND_LABEL: Record<ReportKind, string> = { daily: "日报", evening: "晚报", special: "专题报" };

export function kindFromPath(pathname: string): ReportKind {
  if (pathname.startsWith("/evening")) return "evening";
  if (pathname.startsWith("/special")) return "special";
  return "daily";
}

/** The kind's RSS feed, announced in the page head so a reader given the page finds it. */
export const feedLink = (kind: ReportKind) => ({ tagName: "link", rel: "alternate", type: "application/rss+xml", title: `${SITE.name}${KIND_LABEL[kind]}`, href: `/feed/${kind}.xml` }) as const;

export function reportPath(kind: ReportKind, key: string): string {
  return `${KIND_PATH[kind]}/${key}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

const { measure, noun } = REPORTS.entry;
/** "件大事": what an issue counts its entries in, in the site's words (REPORTS.entry). */
export const ENTRIES_UNIT = `${measure}${noun}`;

/** "这一早的 4 件国际大事" / "这一天白天的 4 件国际大事" (the subject and REPORTS.entry from site/site.ts). */
export function headline(kind: ReportKind, count: number): string {
  return subjectAfter(`${kind === "evening" ? "这一天白天" : "这一早"}的 ${count} ${measure}`, noun);
}

/** "09.16" for a report a special cites. */
export function shortDay(iso: string): string {
  return beijingDate(iso).slice(5).replace("-", ".");
}

export interface ArchiveGroup {
  id: string;
  label: string;
  entries: Array<ReportNavigationEntry & { short: string }>;
}

/** The archive column: issues grouped by month, newest first, as the index comes. */
export function archiveGroups(index: ReportNavigationEntry[]): ArchiveGroup[] {
  const groups: ArchiveGroup[] = [];
  for (const e of index) {
    const id = e.key.slice(0, 7);
    const entry = { ...e, short: `${Number(e.key.slice(8, 10))} 日` };
    const g = groups[groups.length - 1];
    if (g && g.id === id) g.entries.push(entry);
    else groups.push({ id, label: `${e.key.slice(0, 4)} 年 ${Number(e.key.slice(5, 7))} 月`, entries: [entry] });
  }
  return groups;
}

/** An issue's mark in the archive column: its day over its weekday. */
export function archiveMark(key: string): { big: string; small: string } {
  return { big: key.slice(8, 10), small: weekdayShort(key) };
}

/** Short chip label for the phone switcher: "今天", "9月26日". */
export function chipLabel(key: string, today: string): string {
  return key === today ? "今天" : monthDay(key);
}

/**
 * "第 N 期": the issue's place in its series as the server counts it over every issue. The navigation
 * index holds only the newest issues, so its length cannot tell.
 */
export function issueNumber(index: ReportNavigationEntry[], key: string): number | null {
  return index.find((e) => e.key === key)?.issueNumber ?? null;
}

/** The masthead's date block: a large figure and two small lines beside it. */
export function dateMark(key: string): { figure: string; top: string; bottom: string } {
  return { figure: key.slice(8, 10), top: `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`, bottom: beijingWeekday(key) };
}

/** When each kind comes out, for the masthead (the times are the site's, EDITION_WHEN). */
export const EDITION: Record<ReportKind, string> = { daily: `${EDITION_WHEN.daily} 出刊`, evening: `${EDITION_WHEN.evening} 出刊`, special: `${EDITION_WHEN.special} 出刊` };

/**
 * The masthead's figures, in the order a reader wants them, in the site's words (REPORTS). Releases of the
 * pack's headline launch kind (RELEASE, "个新模型" for AI) count only where the pack has one; zero is left out.
 */
const UNITS = REPORTS.metricUnits;
const METRICS: Array<[key: string, unit: string]> = [
  ["totalEvents", ENTRIES_UNIT],
  ["totalStories", ENTRIES_UNIT],
  ["sourcesCount", UNITS.sourcesCount],
  ["firstPartyEvents", UNITS.firstPartyEvents],
  ...(RELEASE ? [["modelsReleased", RELEASE.unit] as [string, string]] : []),
  ["reportsCited", UNITS.reportsCited],
];
export function metricItems(metrics: Record<string, number>): Array<{ value: number; unit: string }> {
  return METRICS.filter(([k]) => typeof metrics[k] === "number" && (k !== "modelsReleased" || metrics[k]! > 0)).map(([k, unit]) => ({ value: metrics[k]!, unit }));
}

/** "前一日 · 9月25日", "上一期 · 9月23日". */
export function neighbourLabel(kind: ReportKind, key: string, direction: "prev" | "next"): string {
  if (kind === "special") return `${direction === "prev" ? "上一期" : "下一期"} · ${monthDay(key)}`;
  return `${direction === "prev" ? "前一日" : "后一日"} · ${monthDay(key)}`;
}

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** Page numbers as a Chinese paper prints them: 1 → 一, 12 → 十二, 20 → 二十. */
function cnNumber(n: number): string {
  if (n <= 10) return CN[n]!;
  if (n < 20) return `十${CN[n - 10]}`;
  return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ""}`;
}

/** The line above the nameplate: "2026 年 9 月 26 日 · 星期六". */
export function dateLine(key: string): string {
  const m = dateMark(key);
  return `${m.top} ${Number(key.slice(8, 10))} 日 · ${m.bottom}`;
}

/** What each kind is, under its nameplate. */
export const MOTTO: Record<ReportKind, string> = { daily: `${REPORTS.motto} · 早间要闻`, evening: `${REPORTS.motto} · 晚间要闻`, special: `${REPORTS.motto} · 专题长文` };

export interface PeriodCell {
  key: string | null;
  /** Hover text: "9月26日 · 第 158 期". */
  label: string;
  state: "current" | "issue" | "none" | "pad";
}

/**
 * The dot grid beside the date in the masthead: the days of this issue's month, Monday first, each marked
 * as this issue, an issue of its kind that exists, or none. This issue's own number (`current`) labels it,
 * also when it is older than the navigation.
 */
export function periodGrid(key: string, index: ReportNavigationEntry[], current: number): { title: string; note: string; columns: number; heads: string[] | null; cells: PeriodCell[] } {
  const exists = new Set(index.map((e) => e.key));
  const cell = (k: string, name: string): PeriodCell => {
    const n = k === key ? current : issueNumber(index, k);
    return { key: k, label: n ? `${name} · 第 ${n} 期` : `${name} · 未出刊`, state: k === key ? "current" : exists.has(k) ? "issue" : "none" };
  };
  const year = key.slice(0, 4);
  const m = Number(key.slice(5, 7));
  const days = new Date(Date.UTC(Number(year), m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(Number(year), m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: PeriodCell[] = [
    ...Array.from({ length: lead }, (): PeriodCell => ({ key: null, label: "", state: "pad" })),
    ...Array.from({ length: days }, (_, i) => {
      const day = `${key.slice(0, 7)}-${pad(i + 1)}`;
      return cell(day, monthDay(day));
    }),
  ];
  const count = cells.filter((c) => c.state === "issue" || c.state === "current").length;
  return { title: `${cnNumber(m)}月`, note: `本月 ${count} 期`, columns: 7, heads: ["一", "二", "三", "四", "五", "六", "日"], cells };
}
