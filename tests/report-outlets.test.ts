// The same issue through the website, JSON, Agent answer and RSS. Failure cases: withdrawal
// changes a headline but drops its paragraph in projected indexes/feeds; written historical leads
// keep withdrawn news; citations leak a scheduled selection; missing frozen summaries or corrected
// publication dates differ between readers; discovery claims to list topics it actually omits.
import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb, sql } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { feedIssues, loadReport, v1Dailies, v1Daily, v1Special, v1Specials } from '@aihot/backend/publication/reports';
import { reportFeed } from '@aihot/backend/publication/feeds';
import { llmsTxt } from '@aihot/backend/publication/llms';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { buildApp } from '../apps/api/src/app.ts';
import type { ReportKind } from '@aihot/contracts/site';

const T = tag();
const source = `report-outlets-${T}`;
const app = await buildApp();
const generatedAt = new Date('2026-09-30T00:00:00Z');
let sequence = 0;
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${source}, 'Issue source', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

async function citation(title: string) {
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.com/${T}/${++sequence}`, title,
    bodyText: 'Licensed report fixture', bodyHtml: '<p>Licensed report fixture</p>', bodyStatus: 'ok', via: 'fetch', publishedAt: generatedAt });
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${title}, ${`${title} current summary`}, 90, true)`;
  await publishArticle(articleId, { releasedAt: generatedAt });
  return { itemId: articleId, title, summary: `${title} frozen summary`, sourceUrl: `https://example.com/${T}/${sequence}`, sourceName: 'Issue source' };
}

async function issue(kind: ReportKind, key: string, content: Record<string, unknown>) {
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
    VALUES (${kind}, ${key}, ${generatedAt}, ${generatedAt}, ${sql.json(content as never)}, ${generatedAt}, 'manual')`;
}

async function dailyOutlets(key: string, kind: 'daily' | 'evening' = 'daily') {
  return {
    site: await loadReport(kind, key),
    v1: (await v1Daily(kind, key))!.report,
    index: (await v1Dailies(kind, 50)).items.find((r) => r.date === key)!,
    feed: (await feedIssues(kind, 30)).find((r) => r.key === key)!,
    agent: (await app.inject({ method: 'GET', url: `/api/v1/agent/${kind}/${key}` })).body,
  };
}

for (const kind of ['daily', 'evening'] as const) {
  test(`withdrawing a named ${kind} lead preserves the replacement headline and its own frozen paragraph everywhere`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 600_001 });
    const removed = await citation(`Withdrawn ${kind} lead`);
    const replacement = await citation(`Replacement ${kind} lead`);
    const key = '2096-01-01';
    await issue(kind, key, { leadItemId: removed.itemId, lead: { title: removed.title, leadParagraph: removed.summary },
      highlights: [replacement.itemId], sections: [{ label: 'News', items: [removed, replacement] }] });
    await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${removed.itemId}`;
    const outlets = await dailyOutlets(key, kind);
    for (const [name, lead] of Object.entries({ site: outlets.site!.lead, v1: outlets.v1.lead, index: { title: outlets.index.leadTitle, leadParagraph: outlets.index.leadParagraph }, feed: { title: outlets.feed.headline, leadParagraph: outlets.feed.leadParagraph } })) {
      assert.deepEqual(lead, { title: replacement.title, leadParagraph: replacement.summary }, name);
    }
    assert.ok(outlets.agent.includes(replacement.summary));
    assert.ok((await reportFeed(kind)).includes(replacement.summary));
  });
}

test('a historical written daily lead follows withdrawal of the citation it describes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 1_200_002 });
  const removed = await citation('历史模型发布与能力升级');
  const replacement = await citation('新的安全工具发布');
  const key = '2096-01-02';
  await issue('daily', key, { lead: { title: removed.title, leadParagraph: removed.summary }, highlights: [replacement.itemId], sections: [{ label: 'News', items: [removed, replacement] }] });
  const before = await v1Daily('daily', key);
  assert.equal(before!.report.lead?.title, removed.title, 'the written lead remains while its citation is public');
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${removed.itemId}`;
  const outlets = await dailyOutlets(key);
  for (const [name, lead] of Object.entries({ site: outlets.site!.lead, v1: outlets.v1.lead, index: { title: outlets.index.leadTitle, leadParagraph: outlets.index.leadParagraph }, feed: { title: outlets.feed.headline, leadParagraph: outlets.feed.leadParagraph } })) {
    assert.deepEqual(lead, { title: replacement.title, leadParagraph: replacement.summary }, name);
  }
  assert.ok(!outlets.agent.includes(removed.title));
});

test('daily, evening and special citations share the public list release boundary', async (t) => {
  for (const [kind, key] of [['daily', '2096-01-03'], ['evening', '2096-01-03'], ['special', '2096-01-03']] as const) {
    await t.test(kind, async () => {
      const pending = await citation(`Not released ${kind}`);
      const visible = await citation(`Released ${kind}`);
      await sql`UPDATE publications SET visible_after = '2100-01-01' WHERE article_id = ${pending.itemId}`;
      await issue(kind, key, kind === 'special'
        ? { headline: 'Special', overview: 'Dek', highlights: [visible.itemId], themes: [{ heading: 'News', paragraphs: [`Text about ${pending.title}`], storyRefs: [pending, visible] }] }
        : { leadItemId: pending.itemId, highlights: [visible.itemId], lead: { title: pending.title, leadParagraph: pending.summary }, sections: [{ label: 'News', items: [pending, visible] }] });
      const site = (await loadReport(kind, key))!;
      assert.equal(site.sections[0]!.items[0]!.available, false, 'website marks the unavailable citation');
      if (kind === 'special') assert.deepEqual(site.sections[0]!.paragraphs, [], 'a chapter retelling it is not shown');
      const detail = kind === 'special' ? (await v1Special(key))!.report : (await v1Daily(kind, key))!.report;
      assert.ok(!JSON.stringify(detail).includes(pending.title), 'v1 omits unreleased citations and replaces the headline');
      const feed = (await feedIssues(kind, 30)).find((r) => r.key === key)!;
      assert.ok(!JSON.stringify(feed).includes(pending.title), 'RSS omits unreleased citations and replaces the headline');
      const agent = await app.inject({ method: 'GET', url: `/api/v1/agent/${kind}/${key}` });
      assert.equal(agent.statusCode, 200);
      assert.ok(!agent.body.includes(pending.title), 'Agent follows the same scope');
    });
  }
});

test('daily citations without frozen summaries use the same current metadata in JSON and website', async () => {
  const entry = await citation('Older report citation');
  const key = '2096-01-04';
  const { summary: _, ...old } = entry;
  await issue('daily', key, { sections: [{ label: 'News', items: [old] }], flashes: [{ ...old, publishedAt: '2020-01-01T00:00:00Z' }] });
  const site = (await loadReport('daily', key))!;
  const v1 = (await v1Daily('daily', key))!.report;
  assert.equal(v1.sections[0]!.items[0]!.summary, site.sections[0]!.items[0]!.summary);
});

test('daily flashes use the same publication time in JSON and website', async () => {
  const entry = await citation('Flash date');
  const key = '2096-01-05';
  await issue('daily', key, { sections: [], flashes: [{ ...entry, publishedAt: '2020-01-01T00:00:00Z' }] });
  const site = (await loadReport('daily', key))!;
  const v1 = (await v1Daily('daily', key))!.report;
  assert.equal(v1.flashes[0]!.publishedAt, site.flashes[0]!.publishedAt);
});

test('discovery counts exactly the publicly indexed topics it lists', () => {
  const text = llmsTxt({ hasDailies: false, hasEvenings: false, hasSpecials: false, topics: [{ slug: 'sample', name: 'Example', definition: 'Example topic' }], tools: [],
    modules: { api: [], pace: [], pages: [], topics: [], access: [], usage: [], guideClients: [], ways: [] } });
  assert.match(text, /（1 个主题，下一节逐个列出）/);
});

// A special's chapter retells the reports it cites. Every reduction of one of them takes the chapter's
// text away in the same way on every outlet; the special's own title and dek stay, as do intact chapters.
for (const reduction of ['withdrawn', 'summary-only', 'ineligible'] as const) {
  test(`special chapters drop their text after ${reduction}`, async () => {
    const removed = await citation(`Removed special ${reduction}`);
    const visible = await citation(`Remaining special ${reduction}`);
    const key = `2095-0${['withdrawn', 'summary-only', 'ineligible'].indexOf(reduction) + 1}-10`;
    await issue('special', key, { topic: { slug: 'japan', name: '日本' }, headline: 'Special title', overview: 'Special dek', highlights: [visible.itemId],
      themes: [{ heading: 'Changed chapter', paragraphs: [`Chapter about ${removed.title}`], storyRefs: [removed, visible] },
        { heading: 'Intact chapter', paragraphs: ['Intact text'], storyRefs: [visible] }] });
    assert.deepEqual((await loadReport('special', key))!.sections[0]!.paragraphs, [`Chapter about ${removed.title}`], 'unchanged chapters keep their own text');
    if (reduction === 'ineligible') await sql`UPDATE publications SET eligible = false WHERE article_id = ${removed.itemId}`;
    else await sql`UPDATE publications SET visibility = ${reduction} WHERE article_id = ${removed.itemId}`;
    const site = (await loadReport('special', key))!;
    const v1 = (await v1Special(key))!.report;
    const rss = (await feedIssues('special', 30)).find((r) => r.key === key)!;
    for (const lead of [{ title: site.lead?.title, dek: site.overview }, { title: v1.headline, dek: v1.overview }, { title: rss.headline, dek: rss.leadParagraph }]) {
      assert.deepEqual(lead, { title: 'Special title', dek: 'Special dek' });
    }
    assert.deepEqual(site.sections.map((c) => c.paragraphs), [[], ['Intact text']]);
    assert.deepEqual(v1.sections.map((c: { paragraphs: string[] }) => c.paragraphs), [[], ['Intact text']]);
    const agent = await app.inject({ method: 'GET', url: `/api/v1/agent/special/${key}` });
    assert.ok(!agent.body.includes(removed.title), 'Agent never repeats unavailable evidence through its prose');
    assert.ok(agent.body.includes('Intact text'));
    assert.equal((await v1Specials(50)).items.find((r) => r.date === key)!.headline, 'Special title');
  });
}

for (const [kind, key] of [['daily', '2096-01-06'], ['evening', '2096-01-06'], ['special', '2096-01-06']] as const) {
  test(`${kind} imported citations retain the same original link, source and date as the website`, async () => {
    const original = `https://example.com/historical/${kind}/${T}`;
    const old = { itemId: `absent-${kind}-${T}`, title: 'Historical citation', source: { name: 'Historical source' }, links: { original }, publishedAt: '2020-01-01T00:00:00Z' };
    await issue(kind, key, kind === 'special' ? { headline: 'H', themes: [{ heading: 'News', paragraphs: ['P'], storyRefs: [old] }] } : { sections: [{ label: 'News', items: [old] }] });
    const site = (await loadReport(kind, key))!.sections[0]!.items[0]!;
    const v1 = (kind === 'special' ? (await v1Special(key))!.report : (await v1Daily(kind, key))!.report).sections[0]!.items[0]!;
    assert.equal(v1.links.original, site.sourceUrl);
    assert.equal(v1.source.name, site.sourceName);
    if ('publishedAt' in v1) assert.equal(v1.publishedAt, site.publishedAt);
  });
}


test('an expired report index waits for the current withdrawal result',async(t)=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()+86_400_000});
  const removed=await citation('索引旧头条');
  const replacement=await citation('索引新头条');
  const key='2099-01-01';
  await issue('daily',key,{leadItemId:removed.itemId,lead:{title:removed.title,leadParagraph:removed.summary},highlights:[replacement.itemId],sections:[{label:'News',items:[removed,replacement]}]});
  assert.equal((await v1Dailies('daily',50)).items.find(r=>r.date===key)!.leadTitle,removed.title);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${removed.itemId}`;
  t.mock.timers.tick(60_001);
  assert.equal((await v1Dailies('daily',50)).items.find(r=>r.date===key)!.leadTitle,replacement.title);
});
