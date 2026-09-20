import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSnapshot } from "./normalize.mjs";
import { toIngestionRecords } from "./records.mjs";

const compact = process.argv[2];
const outputDir = process.argv[3];
const chunkSize = Number(process.argv[4] || 8);
if (!/^\d{8}$/.test(compact) || !outputDir || !Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("usage: node race-ingestion/write-ingest-chunks.mjs YYYYMMDD output-dir [chunk-size]");
const dir = process.env.RACE_EVIDENCE_DIR || "C:\\codex\\project-012\\research\\v0.1.11-api-20260920";
const dateText = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
const raw = JSON.parse(await fs.readFile(path.join(dir, `${compact}.json`), "utf8"));
const normalized = normalizeSnapshot(raw, { fetchedAt: `${dateText}T00:00:00Z` });
if (!normalized.accepted) throw new Error(`normalization rejected: ${JSON.stringify(normalized.issues.slice(0, 10))}`);
const payload = toIngestionRecords(normalized);
await fs.mkdir(outputDir, { recursive: true });
const files = [];
for (let start = 0, index = 0; start < payload.records.length; start += chunkSize, index += 1) {
  const chunk = { ...payload, records: payload.records.slice(start, start + chunkSize) };
  const json = JSON.stringify(chunk);
  const tag = `$payload_${chunk.rawHash.slice(0, 16)}_${index}$`;
  const publish = start + chunkSize >= payload.records.length;
  const sql = `select * from race_data.ingest_snapshot(${sqlText(chunk.sourceCode)}, ${sqlText(dateText)}::date, ${sqlText(chunk.rawHash)}, ${tag}${json}${tag}::jsonb, ${sqlText(chunk.fetchedAt)}::timestamptz, ${sqlText(chunk.parserVersion)}, ${sqlText(chunk.rulesVersion)}, ${publish});\n`;
  const file = path.join(outputDir, `${String(index).padStart(3, "0")}.sql`);
  await fs.writeFile(file, sql, "utf8");
  files.push({ file, bytes: Buffer.byteLength(sql), records: chunk.records.length });
}
console.log(JSON.stringify({ date: dateText, chunkSize, chunks: files.length, raceCount: payload.raceCount, resultRaceCount: payload.resultRaceCount, files }, null, 2));
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
