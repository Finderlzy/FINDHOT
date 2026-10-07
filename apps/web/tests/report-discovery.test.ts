// Production SSR with a local health stub. Failure cases: an access page describes daily reports
// but omits evening/special support; a report RSS card offers a schedule without saying it carries
// that issue's contents; machine entry points exist but cannot be found from the access page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import * as cheerio from 'cheerio';
import { MCP_TOOL_NAMES } from '@aihot/contracts/mcp';
import { startWebServer, type WebServer } from './web-server.ts';

let web: WebServer;
const api = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true }));
  if (req.url === '/api/site/meta') return res.end(JSON.stringify({ changelogVersion: '2026-01-01T00:00' }));
  res.statusCode = 404;
  res.end(JSON.stringify({ code: 'not_found' }));
});
before(async () => { web = await startWebServer(api); });
after(() => web.stop());

async function page(tab: string) {
  const response = await fetch(`${web.origin}/agent?tab=${tab}`);
  assert.equal(response.status, 200, web.logs());
  return cheerio.load(await response.text());
}

test('the access page names every report cadence in its visible overview', async () => {
  const $ = await page('rss');
  const intro = $('h1').first().closest('header').find('p').first().text();
  for (const label of ['日报', '晚报', '专题报']) assert.ok(intro.includes(label), `access overview omits ${label}: ${intro}`);
});

test('all report RSS cards tell readers the feed includes an issue contents list', async () => {
  const $ = await page('rss');
  for (const kind of ['daily', 'evening', 'special']) {
    const address = $(`code`).filter((_, node) => $(node).text().endsWith(`/feed/${kind}.xml`));
    assert.equal(address.length, 1, `${kind} RSS must be discoverable`);
    const description = address.closest('.card').find('p').text();
    assert.match(description, /目录|按栏目|引用的报道/, `${kind} RSS must describe its contents, not only its cadence`);
  }
});

for (const [tab, names] of [
  ['rss', ['/feed/daily.xml', '/feed/evening.xml', '/feed/special.xml']],
  ['api', ['/api/v1/dailies/latest', '/api/v1/evenings/latest', '/api/v1/specials/latest']],
  ['mcp', [MCP_TOOL_NAMES.daily, MCP_TOOL_NAMES.evening, MCP_TOOL_NAMES.special]],
] as const) {
  test(`the ${tab} panel exposes all report entry points`, async () => {
    const response = await fetch(`${web.origin}/agent?tab=${tab}`);
    assert.equal(response.status, 200, web.logs());
    const panel = cheerio.load(await response.text())('#agent-panel').text();
    for (const name of names) assert.ok(panel.includes(name), `${tab} panel omits ${name}`);
  });
}
