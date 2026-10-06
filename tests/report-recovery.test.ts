// Failure cases: automatic runs rewrite published issues; report/receipt commits split; empty gaps
// starve later dailies or make a failed run look successful. All use a local model stub.
import { editionAt, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { composeDaily, composeDueReports, composeEvening, composeSpecial } from "@aihot/backend/reports/compose";

const T = tag();
const SOURCE = `report-recovery-${T}`;
const paragraph = "这件事说来话长，咱们慢慢讲，先看最近这几天发生了什么。".repeat(12);
const answer = { title: "日本最近有点热闹", dek: "这一期讲讲日本。", chapters: [{ heading: "最近的事", paragraphs: [paragraph, paragraph, paragraph, paragraph, paragraph], refs: [1, 2] }] };
const provider = await stub(async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${SOURCE}, 'Report recovery', 'rss', 'T1')`;
});
beforeEach(async () => {
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

/** A selected item at `at`, about Japan when `japan` (the topic a special may be about). */
async function item(at: Date, japan = false) {
  const id = `recovery-${tag()}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${SOURCE}, ${id}, 'https://example.com/report', ${id}, ${at}, ${at})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at, eligible, selected, visible_after, visibility, score, tags)
    VALUES (${id}, ${id}, ${SOURCE}, 'news', 'https://example.com/report', ${at}, ${at}, ${at}, true, true, ${at}, 'public', 90, ${japan ? ["entity:japan"] : []})`;
  return id;
}
/** Items for each kind's issue: the daily and evening dated `date`, and a special on the day after. */
async function issueItems(date: string) {
  const ids = [await item(editionAt("daily", date, -3600)), await item(editionAt("evening", date, -3600))];
  for (let n = 1; n <= 5; n++) ids.push(await item(editionAt("evening", date, -n * 7200), true));
  return ids;
}
const report = async (kind: string, key: string) => (await sql`SELECT content, revision, generated_at FROM reports WHERE kind = ${kind} AND key = ${key}`)[0];

test("automatic retries preserve all three published issue kinds; explicit corrections keep a revision", async () => {
  const ids = await issueItems("2024-02-02");
  for (const [kind, key, compose] of [
    ["daily", "2024-02-02", composeDaily], ["evening", "2024-02-02", composeEvening], ["special", "2024-02-03", composeSpecial],
  ] as const) {
    await compose(key);
    const saved = await report(kind, key);
    assert.ok(saved, `${kind} ${key} was written`);
    const calls = provider.hits();
    await sql`UPDATE publications SET title = title || ' corrected' WHERE article_id = ANY(${ids}::text[])`;
    await compose(key);
    assert.deepEqual(await report(kind, key), saved, `${kind}: an automatic retry preserves the edition`);
    assert.equal(provider.hits(), calls, "no model request for an already published edition");
    await compose(key, "editor correction");
    assert.equal((await report(kind, key)).revision, 2);
    const [revision] = await sql`SELECT v.content FROM report_revisions v JOIN reports r ON r.id = v.report_id WHERE r.kind = ${kind} AND r.key = ${key}`;
    assert.deepEqual(revision.content, saved.content);
  }
  assert.equal((await report("special", "2024-02-03")).content.topic.slug, "japan");
});

test("report publication and its receipt commit together and recovery reuses the response", async () => {
  await issueItems("2024-05-03");
  await sql.unsafe(`CREATE FUNCTION fail_report_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status = 'completed' AND NEW.purpose = 'report_special' THEN RAISE EXCEPTION 'receipt commit interrupted'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER fail_report_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION fail_report_receipt()`);
  try {
    await assert.rejects(composeSpecial("2024-05-04"), /receipt commit interrupted/);
    assert.equal(await report("special", "2024-05-04"), undefined);
  } finally {
    await sql.unsafe("DROP TRIGGER fail_report_receipt ON receipts; DROP FUNCTION fail_report_receipt()");
  }
  const calls = provider.hits();
  await composeSpecial("2024-05-04");
  assert.equal(provider.hits(), calls);
  assert.equal((await report("special", "2024-05-04")).revision, 1);
  assert.equal((await sql`SELECT status FROM receipts WHERE subject = 'report:special:2024-05-04'`)[0]!.status, "completed");
});

test("a special without a topic that has enough news is not written and asks no model", async () => {
  for (let n = 1; n <= 4; n++) await item(editionAt("evening", "2024-03-01", -n * 7200), true);
  const calls = provider.hits();
  await assert.rejects(composeSpecial("2024-03-02"), /no topic has 5 events/);
  assert.equal(provider.hits(), calls);
});

test("empty older gaps cannot starve a later daily, and failures remain visible", async () => {
  // An older issue carried an item; the days after it are empty.
  const early = await item(editionAt("daily", "2024-01-23", -3600));
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
    VALUES ('daily', '2024-01-23', now(), now(), ${sql.json({ sections: [{ label: "行业动态", items: [{ itemId: early, title: early }] }] })}, now())`;
  await item(editionAt("daily", "2024-02-02", -3600));
  await assert.rejects(composeDueReports(editionAt("daily", "2024-02-02", 3600)), /reports:/);
  assert.ok(await report("daily", "2024-02-02"), "daily 2024-02-02 was recovered past the empty gaps");
});
