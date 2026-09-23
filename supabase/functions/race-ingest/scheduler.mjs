const DAY_MS = 24 * 60 * 60 * 1000;

// A 404 is usually permanent for old dates, but the upstream feed can publish
// today's/yesterday's file a little later. Keep this window small so a missing
// historical day is never retried forever.
export const RETRY_POLICY = Object.freeze({
  recent404Days: 1,
  recent404MaxAttempts: 3,
  recent404DelaysSeconds: [5 * 60, 15 * 60, 30 * 60],
});

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

function jstDateText(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function isRecentRaceDate(raceDate, { now = new Date(), recentDays = RETRY_POLICY.recent404Days } = {}) {
  const target = parseDate(raceDate).getTime();
  const today = parseDate(jstDateText(now)).getTime();
  return target >= today - (recentDays * DAY_MS) && target <= today;
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

export function classifyRetry({ code, raceDate = null, attemptCount = 0, now = new Date(), retryAfterSeconds = null, maxAttempts = 5, recent404Days = RETRY_POLICY.recent404Days, recent404MaxAttempts = RETRY_POLICY.recent404MaxAttempts } = {}) {
  const retryable = new Set(["fetch_timeout", "fetch_5xx", "fetch_network", "db_write_failed", "lease_lost"]);
  const boundedAttempt = Number.isInteger(attemptCount) && attemptCount >= 0 ? attemptCount : 0;
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error("now must be a valid date");
  if (code === "fetch_429" && Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) >= 0) {
    return { state: "retry", nextAttemptAt: new Date(nowDate.getTime() + Number(retryAfterSeconds) * 1000).toISOString(), errorCode: code };
  }
  if (code === "fetch_404" && raceDate && isRecentRaceDate(raceDate, { now: nowDate, recentDays: recent404Days }) && boundedAttempt < recent404MaxAttempts) {
    const delaySeconds = RETRY_POLICY.recent404DelaysSeconds[Math.min(boundedAttempt, RETRY_POLICY.recent404DelaysSeconds.length - 1)];
    return { state: "retry", nextAttemptAt: new Date(nowDate.getTime() + delaySeconds * 1000).toISOString(), errorCode: code };
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
