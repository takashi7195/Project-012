import fs from "node:fs/promises";
import { fetchDailyJson } from "./api-client.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { toIngestionRecords } from "./records.mjs";

const dateText = process.argv[2];
if (!dateText) throw new Error("usage: node race-ingestion/prepare-date.mjs YYYY-MM-DD [output.json]");
const fetched = await fetchDailyJson(dateText);
const normalized = normalizeSnapshot(fetched.json, { fetchedAt: fetched.startedAt });
if (!normalized.accepted) throw new Error(`normalization rejected: ${JSON.stringify(normalized.issues.slice(0, 10))}`);
const payload = toIngestionRecords(normalized);
payload.http = { status: fetched.httpStatus, bytes: fetched.bytes, elapsedMs: fetched.elapsedMs, etag: fetched.etag, lastModified: fetched.lastModified, bodyHash: fetched.bodyHash };
const output = process.argv[3];
if (output) await fs.writeFile(output, JSON.stringify(payload), "utf8");
console.log(JSON.stringify({ date: dateText, status: fetched.status, raceCount: payload.raceCount, stadiumCount: payload.stadiumCount, resultRaceCount: payload.resultRaceCount, output: output ?? null }, null, 2));
