// 两家媒体文章页的正文读取。页面按两站 2026-10 的结构手写，正文是虚构的。
import assert from "node:assert/strict";
import { test } from "node:test";
import { readable } from "@aihot/backend/content/extract";
import { installModules } from "@aihot/backend/modules";
import cnMedia from "../server.ts";
import { bodyFromPage } from "../backend/body.ts";

const PARA = "这是一段用于测试的虚构正文，描述某国外交部发言人在例行记者会上回应记者提问的经过，内容足够长以便通过正文长度检查。";
const BODY = Array.from({ length: 5 }, () => `<p>${PARA}</p>`).join("");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const huanqiuPage = (content: string) =>
  `<html><head><title>标题</title></head><body><div class="nav">导航</div><article><textarea class="article-title">测试标题</textarea>` +
  `<textarea class="article-content">${content}</textarea><textarea class="article-time">1791260161253</textarea></article></body></html>`;
const ckxxPage = (literal: string) =>
  `<html><head><title>标题</title></head><body><div id="app"></div><script src="/jquery.min.js"></script>` +
  `<script>\n    var contentTxt =${literal};\n    var other = 1;\n  </script></body></html>`;
const jsString = (s: string) => JSON.stringify(s).replace(/\//g, "\\/");

test("环球网：读出 textarea 里转义过的正文", () => {
  const html = huanqiuPage(escape(BODY) + "&#8220;引号&#x201D;&nbsp;");
  assert.equal(bodyFromPage(html, "https://world.huanqiu.com/article/4TV0wJzeItF"), BODY + "“引号” ");
});

test("参考消息：读出 contentTxt 脚本变量里的正文，包括转义的斜杠、引号和单引号", () => {
  const body = `<p style="text-indent: 2em;"><strong>参考消息网10月6日报道</strong> 他说：“这是对等反制”，又说 'yes'。</p>`;
  const literal = jsString(body).replace(/'/g, "\\'");
  assert.equal(bodyFromPage(ckxxPage(literal), "https://ckxxapp.ckxx.net/pages/2026/10/06/abc.html"), body);
});

test("别的网站、找不到标记、标记里是空的，都交回框架", () => {
  assert.equal(bodyFromPage(huanqiuPage(escape(BODY)), "https://example.com/article/1"), null);
  assert.equal(bodyFromPage("<html><body><p>改版后的页面</p></body></html>", "https://world.huanqiu.com/article/1"), null);
  assert.equal(bodyFromPage(huanqiuPage("  "), "https://www.huanqiu.com/article/1"), null);
  assert.equal(bodyFromPage(ckxxPage('"'), "https://ckxxapp.ckxx.net/pages/x.html"), null);
  assert.equal(bodyFromPage(huanqiuPage(escape(BODY)), "not a url"), null);
});

test("装上模块后，框架的正文提取用它读出的正文，照常清洗", () => {
  installModules([cnMedia]);
  try {
    const got = readable(huanqiuPage(escape(BODY + `<script>alert(1)</script>`)), "https://world.huanqiu.com/article/1");
    assert.ok(got, "a body is read");
    assert.equal(got.via, "readability");
    assert.ok(got.text.includes("例行记者会"));
    assert.ok(!got.html.includes("<script"), "sanitized like any body");
    assert.ok(!got.text.includes("导航"), "only the article, not the page around it");
    const ckxx = readable(ckxxPage(jsString(BODY)), "https://ckxxapp.ckxx.net/pages/2026/10/06/abc.html");
    assert.ok(ckxx?.text.includes("例行记者会"));
    const flash = readable(huanqiuPage(escape(`<p>${PARA}</p>`)), "https://world.huanqiu.com/article/2");
    assert.equal(flash?.text, PARA, "a short news flash is kept");
    assert.equal(readable(huanqiuPage(escape("<p> </p>")), "https://world.huanqiu.com/article/3"), null, "an empty one is not");
  } finally {
    installModules([]);
  }
});
