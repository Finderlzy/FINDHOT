// 站点的字标和圆环标记：页面用 Wordmark 画站名（size 是高度，单位像素），RingMark 是小标记，转起来就是加载动画。
// Wordmark 是晨昏线标志加站名；标志和图标（logo.svg 等，由 scripts/icons.ts 生成）是同一个图形，改了要两边一起改。
import { SITE } from "../site.ts";

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  return (
    <span className={`inline-flex items-center font-black leading-none tracking-[-0.03em] ${className}`} style={{ fontSize: Math.round(size * 0.92) }} aria-label={title} role="img">
      <Mark className="mr-[0.3em] size-[1.1em]" />
      <span aria-hidden="true">{SITE.name}</span>
    </span>
  );
}

/** The globe split into day and night by the terminator, tilted 23.4° like the Earth's axis. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-56 -56 112 112" className={`shrink-0 ${className}`} aria-hidden="true">
      <g transform="rotate(23.4)" className="stroke-[#1e2b4a] dark:stroke-[#ece4d2]" strokeWidth="5">
        <circle r="40" className="fill-[#f4b844]" stroke="none" />
        <path d="M0,-40 A40,40 0 0 1 0,40 A14,40 0 0 1 0,-40 Z" className="fill-[#1e2b4a] dark:fill-[#3a4d80]" stroke="none" />
        <circle r="40" fill="none" />
        <path d="M0,-44 L0,-53 M0,44 L0,53" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A ring with a dot; spinning, it is the loader. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="42 15" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}
