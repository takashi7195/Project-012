/**
 * Summarize capacity observations without claiming that elapsed observation
 * time has passed. Rows are the values returned by the capacity observation
 * RPC (observation_date, database_bytes, race_data_bytes).
 */
export function summarizeCapacityObservations(rows, { requiredDays = 7 } = {}) {
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  if (!Number.isInteger(requiredDays) || requiredDays < 1) throw new Error("requiredDays must be a positive integer");
  const dates = [...new Set(rows.map((row) => String(row?.observation_date ?? "").slice(0, 10)).filter(Boolean))].sort();
  const latest = rows.length ? [...rows].sort((a, b) => String(b?.observed_at ?? "").localeCompare(String(a?.observed_at ?? "")))[0] : null;
  const totalDatabaseBytes = rows.reduce((sum, row) => sum + Number(row?.database_bytes ?? 0), 0);
  const totalRaceDataBytes = rows.reduce((sum, row) => sum + Number(row?.race_data_bytes ?? 0), 0);
  return {
    status: dates.length >= requiredDays ? "ready" : "pending",
    distinctDates: dates,
    observationCount: rows.length,
    totalDatabaseBytes,
    totalRaceDataBytes,
    latest,
    requiredDays,
  };
}
