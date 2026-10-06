// 两家中文媒体的文章页不把正文放在可读的网页结构里，框架的通用提取（Readability）读不到：
//   环球网（huanqiu.com）：正文 HTML 转义后放在 <textarea class="article-content"> 里；
//   参考消息（ckxxapp.ckxx.net）：正文是脚本变量 var contentTxt = "…"，由页面脚本写进网页。
// 只认这两个网站；页面里找不到这些标记（改版了）就返回 null，交回框架按通用方式提取。

const HOSTS = { huanqiu: /(^|\.)huanqiu\.com$/i, cankaoxiaoxi: /^ckxxapp\.ckxx\.net$/i };

export function bodyFromPage(html: string, url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (HOSTS.huanqiu.test(host)) return huanqiu(html);
  if (HOSTS.cankaoxiaoxi.test(host)) return cankaoxiaoxi(html);
  return null;
}

function huanqiu(html: string): string | null {
  const m = /<textarea\s+class="article-content"\s*>([\s\S]*?)<\/textarea>/i.exec(html);
  return m?.[1]?.trim() ? decodeEntities(m[1]) : null;
}

/** The variable is a double-quoted JavaScript string; it reads as JSON once \' (not valid JSON) is unescaped. */
function cankaoxiaoxi(html: string): string | null {
  const m = /\bvar\s+contentTxt\s*=\s*("(?:[^"\\]|\\.)*")/.exec(html);
  if (!m) return null;
  try {
    const body = JSON.parse(m[1]!.replace(/\\'/g, "'")) as string;
    return body.trim() ? body : null;
  } catch {
    return null;
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}
