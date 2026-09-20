import test from "node:test";
import assert from "node:assert/strict";
import { reparsePayload } from "./reparse-payload.mjs";

const payload = {
  sourceCode: "boatraceopenapi-v1", rawHash: "hash", fetchedAt: "2026-09-20T00:00:00Z",
  records: [{ race: { raceDate: "2026-09-20" }, components: [] }],
};

test('reparse stages a new parser/rules version without publishing', async () => {
  let request;
  const result = await reparsePayload(payload, {
    supabaseUrl: "https://example.supabase.co", serviceRoleKey: "secret", projectRef: "dev-ref",
    parserVersion: "parser-v2", rulesVersion: "rules-v2",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, async json() { return [{ out_batch_id: "batch" }]; } };
    },
  });
  const body = JSON.parse(request.options.body);
  assert.equal(result.status, "staged");
  assert.equal(body.p_publish, false);
  assert.equal(body.p_parser_version, "parser-v2");
  assert.equal(body.p_rules_version, "rules-v2");
  assert.match(request.url, /race_data_ingest_snapshot_with_metadata$/);
});

test('reparse refuses the protected Project-012 production ref', async () => {
  await assert.rejects(() => reparsePayload(payload, {
    supabaseUrl: "https://example.supabase.co", serviceRoleKey: "secret", projectRef: "jxjxqfrtvdpvrifktxsf",
    fetchImpl: async () => { throw new Error("must not fetch"); },
  }), /refusing to reparse/);
});
