import { sha256Json } from "./normalize.mjs";

const asArray = (value) => Array.isArray(value) ? value : [];

function parseCombination(value) {
  if (typeof value !== "string") return null;
  const entries = value.split(/[-=]/).map((part) => Number(part));
  return entries.length > 0 && entries.every((part) => Number.isInteger(part)) ? entries : null;
}

function payoutKind(row) {
  const label = String(row.label ?? "");
  if (/特払|不成立|返還|返金/.test(label)) return /返還|返金/.test(label) ? "refund_or_void" : "special";
  return row.combination === null || row.amountYen === null ? "unknown" : "normal";
}

function component(normalized, kind) {
  const phase = normalized[kind];
  const presence = phase.presence === "value" && phase.rows.length === 0 ? "empty" : phase.presence;
  return { kind, rawHash: sha256Json(phase.raw ?? null), presence, rawJson: phase.raw ?? null };
}

export function toIngestionRecords(snapshot) {
  if (!snapshot?.accepted) throw new Error("Cannot build records from a rejected snapshot");
  const records = [];
  for (const race of snapshot.races) {
    const { stadiumNumber: stadiumCode, raceNumber, date: raceDate } = race.identity;
    const components = [component(race, "program"), component(race, "preview"), component(race, "result")];
    const program = race.program;
    const preview = race.preview;
    const result = race.result;
    records.push({
      race: { sourceCode: snapshot.sourceCode, raceDate, stadiumCode, raceNumber },
      components,
      program: { common: program.common, entries: program.rows },
      preview: { common: preview.common, entries: preview.rows },
      result: {
        common: result.common,
        entries: result.rows,
        payouts: asArray(result.payouts?.rows).map((row) => ({ ...row, combinationEntries: parseCombination(row.combination), payoutKind: payoutKind(row) })),
        refunds: asArray(result.refunds?.rows),
      },
      qualityFlags: race.qualityFlags,
    });
  }
  return {
    sourceCode: snapshot.sourceCode,
    fetchedAt: snapshot.fetchedAt,
    rawHash: snapshot.rawHash,
    parserVersion: snapshot.parserVersion,
    rulesVersion: snapshot.rulesVersion,
    raceCount: snapshot.raceCount,
    stadiumCount: snapshot.stadiumCount,
    resultRaceCount: snapshot.resultRaceCount,
    records,
  };
}

export function toRpcPayload(snapshot) {
  const payload = toIngestionRecords(snapshot);
  return { p_source_code: payload.sourceCode, p_race_date: payload.records[0]?.race.raceDate ?? null, p_snapshot: payload, p_fetched_at: payload.fetchedAt, p_body_hash: payload.rawHash, p_parser_version: payload.parserVersion, p_rules_version: payload.rulesVersion };
}
