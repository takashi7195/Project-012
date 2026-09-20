import { classifyRetry } from "./scheduler.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { toIngestionRecords } from "./records.mjs";

export const DEFAULT_CHUNK_SIZE = 8;

export function chunkRecords(payload, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!payload || !Array.isArray(payload.records)) throw new Error("payload.records must be an array");
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("chunkSize must be a positive integer");
  const chunks = [];
  for (let index = 0; index < payload.records.length; index += chunkSize) {
    chunks.push({ ...payload, records: payload.records.slice(index, index + chunkSize) });
  }
  return chunks.length ? chunks : [{ ...payload, records: [] }];
}

export async function runWorker({
  workerId,
  claimTask,
  fetchDaily,
  writeSnapshotChunk,
  finishTask,
  now = new Date(),
  chunkSize = DEFAULT_CHUNK_SIZE,
  normalize = normalizeSnapshot,
  buildPayload = toIngestionRecords,
  recordFailure,
} = {}) {
  if (typeof workerId !== "string" || workerId.trim() === "") throw new Error("workerId is required");
  const task = await claimTask(workerId);
  if (!task) return { status: "idle" };
  const finish = async (state, nextAttemptAt = null, errorCode = null) => {
    const accepted = await finishTask(task, { state, nextAttemptAt, errorCode });
    if (!accepted) throw Object.assign(new Error("lease_lost"), { code: "lease_lost" });
  };

  let fetchMeta = null;
  try {
    const fetched = await fetchDaily(task.raceDate);
    fetchMeta = fetched?.meta ?? null;
    if (fetched?.status === "not_modified") {
      await finish("succeeded");
      return { status: "not_modified", raceDate: task.raceDate };
    }
    if (!fetched?.json) throw Object.assign(new Error("invalid_json"), { code: "invalid_json" });
    const snapshot = await normalize(fetched.json, { fetchedAt: fetched.startedAt });
    if (!snapshot.accepted) throw Object.assign(new Error("normalization_invalid"), { code: "normalization_invalid", issues: snapshot.issues });
    const payload = await buildPayload(snapshot);
    const chunks = chunkRecords(payload, chunkSize);
    const writes = [];
    for (const [index, chunk] of chunks.entries()) {
      writes.push(await writeSnapshotChunk(chunk, { publish: index === chunks.length - 1, task }));
    }
    await finish("succeeded");
    return { status: "succeeded", raceDate: task.raceDate, chunkCount: chunks.length, writes };
  } catch (error) {
    const code = error?.code || "worker_error";
    const decision = classifyRetry({
      code,
      attemptCount: Math.max(0, (task.attemptCount ?? 1) - 1),
      now,
      retryAfterSeconds: error?.retryAfterSeconds ?? null,
    });
    if (typeof recordFailure === "function") {
      try {
        await recordFailure(task, { ...(fetchMeta ?? {}), ...(error?.metadata ?? {}) }, { ...decision, code });
      } catch {
        // Failure logging must not prevent the task lease from being released.
      }
    }
    await finish(decision.state, decision.nextAttemptAt, decision.errorCode);
    return { status: decision.state, raceDate: task.raceDate, errorCode: code, issues: error?.issues ?? null };
  }
}
