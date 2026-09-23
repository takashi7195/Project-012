import test from "node:test";
import assert from "node:assert/strict";
import { formatJstDate } from "./date-utils.mjs";

test("JST date is stable across the day boundaries", () => {
  assert.equal(formatJstDate("2026-09-21T15:01:00.000Z"), "2026-09-22"); // JST 00:01
  assert.equal(formatJstDate("2026-09-21T23:59:00.000Z"), "2026-09-22"); // JST 08:59
  assert.equal(formatJstDate("2026-09-22T00:00:00.000Z"), "2026-09-22"); // JST 09:00
  assert.equal(formatJstDate("2026-09-22T14:59:00.000Z"), "2026-09-22"); // JST 23:59
});
