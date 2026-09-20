import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSnapshot } from "./normalize.mjs";
import { toIngestionRecords } from "./records.mjs";

const defaultDir = "C:\\codex\\project-012\\research\\v0.1.11-api-20260920";
const dir = process.env.RACE_EVIDENCE_DIR || defaultDir;
const files = (await fs.readdir(dir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
if (files.length < 5) throw new Error(`expected at least 5 evidence files, found ${files.length}`);

const reports = [];
for (const file of files) {
  const date = file.slice(0, 8);
  const raw = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
  const normalized = normalizeSnapshot(raw, { fetchedAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z` });
  if (!normalized.accepted) throw new Error(`${file}: rejected: ${JSON.stringify(normalized.issues.slice(0, 3))}`);
  if (normalized.raceCount === 0 || normalized.stadiumCount === 0) throw new Error(`${file}: empty normalized snapshot`);
  const records = toIngestionRecords(normalized);
  if (records.records.length !== normalized.raceCount) throw new Error(`${file}: record count mismatch`);
  reports.push({ file, bytes: (await fs.stat(path.join(dir, file))).size, stadiumCount: normalized.stadiumCount, raceCount: normalized.raceCount, resultRaceCount: normalized.resultRaceCount, recordCount: records.records.length, issueCount: normalized.issues.length });
}

const all = reports.reduce((acc, row) => ({ stadiumCount: acc.stadiumCount + row.stadiumCount, raceCount: acc.raceCount + row.raceCount, resultRaceCount: acc.resultRaceCount + row.resultRaceCount }), { stadiumCount: 0, raceCount: 0, resultRaceCount: 0 });
console.log(JSON.stringify({ evidenceDir: dir, files: reports, totals: all }, null, 2));
