const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must be YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("invalid date");
  }
  return date;
}

export function formatDate(value) {
  return parseDate(value).toISOString().slice(0, 10);
}

export function enumerateDates(from, through) {
  const start = parseDate(from);
  const end = parseDate(through);
  if (start > end) throw new Error("from must not be after through");
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    dates.push(formatDate(cursor));
  }
  return dates;
}

export function buildBackfillTasks({ from, through, now = new Date(), reason = "backfill", priority = 0 } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error("now must be a valid date");
  return enumerateDates(from, through).map((raceDate) => ({
    raceDate,
    reason,
    priority,
    state: "queued",
    nextAttemptAt: nowDate.toISOString(),
  }));
}

export function classifyRetry({ code, attemptCount = 0, now = new Date(), retryAfterSeconds = null, maxAttempts = 5 } = {}) {
  const retryable = new Set(["fetch_timeout", "fetch_5xx", "fetch_network", "db_write_failed", "lease_lost"]);
  const boundedAttempt = Number.isInteger(attemptCount) && attemptCount >= 0 ? attemptCount : 0;
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error("now must be a valid date");
  if (code === "fetch_429" && Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) >= 0) {
    return { state: "retry", nextAttemptAt: new Date(nowDate.getTime() + Number(retryAfterSeconds) * 1000).toISOString(), errorCode: code };
  }
  if (!retryable.has(code) || boundedAttempt >= maxAttempts) {
    return { state: "quarantined", nextAttemptAt: null, errorCode: code };
  }
  const delays = [5 * 60, 15 * 60, 60 * 60];
  const delaySeconds = delays[Math.min(boundedAttempt, delays.length - 1)];
  return { state: "retry", nextAttemptAt: new Date(nowDate.getTime() + delaySeconds * 1000).toISOString(), errorCode: code };
}

export function selectDueTask(tasks, { now = new Date(), limit = 1 } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error("now must be a valid date");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  return [...tasks]
    .filter((task) => ["queued", "retry"].includes(task.state) && new Date(task.nextAttemptAt).getTime() <= nowDate.getTime())
    .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0) || String(a.raceDate).localeCompare(String(b.raceDate)))
    .slice(0, limit);
}
