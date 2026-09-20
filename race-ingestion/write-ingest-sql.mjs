import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSnapshot } from "./normalize.mjs";
import { toRpcPayload } from "./records.mjs";

const compact = process.argv[2];
const output = process.argv[3];
if (!/^\d{8}$/.test(compact) || !output) throw new Error("usage: node race-ingestion/write-ingest-sql.mjs YYYYMMDD output.sql");
const dir = process.env.RACE_EVIDENCE_DIR || "C:\\codex\\project-012\\research\\v0.1.11-api-20260920";
const dateText = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
const raw = JSON.parse(await fs.readFile(path.join(dir, `${compact}.json`), "utf8"));
const normalized = normalizeSnapshot(raw, { fetchedAt: `${dateText}T00:00:00Z` });
if (!normalized.accepted) throw new Error(`normalization rejected: ${JSON.stringify(normalized.issues.slice(0, 10))}`);
const payload = JSON.stringify(toRpcPayload(normalized));
const tag = `$payload_${normalized.rawHash.slice(0, 16)}$`;
const sql = `select * from race_data.ingest_snapshot(${sqlText("boatraceopenapi-v1")}, ${sqlText(dateText)}::date, ${sqlText(normalized.rawHash)}, ${tag}${payload}${tag}::jsonb, ${sqlText(normalized.fetchedAt)}::timestamptz, ${sqlText(normalized.parserVersion)}, ${sqlText(normalized.rulesVersion)});\n`;
await fs.writeFile(output, sql, "utf8");
console.log(JSON.stringify({ date: dateText, output, bytes: Buffer.byteLength(sql), raceCount: normalized.raceCount, resultRaceCount: normalized.resultRaceCount }, null, 2));

function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
