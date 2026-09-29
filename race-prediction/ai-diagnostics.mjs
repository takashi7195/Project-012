// Only allowlisted scalar diagnostics belong here. Never serialize an Error,
// request, response, input bundle, owner token, or model output into a log.
export const DIAGNOSTIC_SCHEMA = "race-ai-diagnostic-v1";
export const DIAGNOSTIC_MAX_EVENTS = 64;
export const DIAGNOSTIC_MAX_BYTES = 2048;

const events = new Set([
  "request.started", "request.finished", "request.failed", "input.validated", "input.rejected",
  "job.claimed", "job.read", "rpc.started", "rpc.finished", "rpc.failed", "worker.started",
  "worker.finished", "worker.failed", "attempt.started", "attempt.blocked", "attempt.authorization_unknown",
  "attempt.unknown_record_failed", "attempt.unknown_job_close_failed", "provider.finished",
  "output.validated", "save.started", "save.finished", "retry.scheduled", "retry.stopped", "diagnostic.limit",
]);
const codes = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "EACCES", "EPERM",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "UND_ERR_INVALID_ARG", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_CHAR", "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_SSL_WRONG_VERSION_NUMBER",
]);
const errorNames = new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError", "NotFound",
  "ConnectionRefused", "ConnectionReset", "InvalidData", "PermissionDenied"]);
const providerStatuses = new Set(["OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND",
  "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE",
  "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"]);
const validationCodes = new Set(["json_invalid", "main_shape", "counter_shape", "hole_shape", "main_duplicate_boat",
  "counter_duplicate_boat", "hole_duplicate_boat", "narrative_empty", "bets_duplicate", "provider_incomplete_response"]);
const errorCodes = new Set(["provider_not_configured", "provider_network_error", "provider_auth_error", "provider_rate_limited",
  "provider_daily_limit", "provider_empty_response", "provider_incomplete_response", "deadline_expired", "generation_failed",
  "output_invalid", "background_runtime_unavailable", "rpc_http_error", "rpc_response_invalid", "input_invalid", "config_invalid"]);
const enumFields = {
  transport: new Set(["dns", "connection", "tls", "timeout", "aborted", "invalid_argument", "permission", "unknown"]),
  errorName: errorNames, transportCode: codes, providerStatus: providerStatuses,
  responseFormat: new Set(["json", "json_invalid", "body_error"]),
  finishReason: new Set(["STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT",
    "SPII", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "IMAGE_SAFETY", "FINISH_REASON_UNSPECIFIED"]),
  operation: new Set(["get_ai_input", "claim_ai_job", "begin_ai_attempt", "finish_ai_attempt", "finish_ai_job", "fail_ai_job", "read_ai_job"]),
  stage: new Set(["request", "input", "config", "claim", "worker", "begin_attempt", "provider", "validation", "save", "finish_attempt", "fail_job", "retry"]),
  state: new Set(["created", "existing", "busy", "rejected", "generating", "succeeded", "failed", "expired", "missing", "unknown"]),
  reason: new Set(["not_authorized", "deadline", "not_retryable", "attempt_limit", "unrecorded", "insufficient_time", "retry", "saved", "save_refused"]),
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

/** Classify only known names/codes, without inspecting arbitrary messages. */
export function diagnosticError(error, signal) {
  try {
    const name = errorNames.has(error?.name) ? error.name : "Error";
    const candidate = error?.cause?.code ?? error?.code;
    const code = codes.has(candidate) ? candidate : undefined;
    let transport = "unknown";
    if (signal?.aborted || name === "AbortError") transport = "aborted";
    else if (name === "TimeoutError" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) transport = "timeout";
    else if (["ENOTFOUND", "EAI_AGAIN"].includes(code) || name === "NotFound") transport = "dns";
    else if (["ECONNREFUSED", "ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code) || ["ConnectionRefused", "ConnectionReset"].includes(name)) transport = "connection";
    else if (["ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(code)) transport = "tls";
    else if (["UND_ERR_INVALID_ARG", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_CHAR"].includes(code)) transport = "invalid_argument";
    else if (["EACCES", "EPERM"].includes(code) || name === "PermissionDenied") transport = "permission";
    const status = error?.rpcHttpStatus;
    return { errorName: name, transportCode: code, transport,
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}) };
  } catch { return { errorName: "Error", transport: "unknown" }; }
}

/** @param {any} source @param {string[]} secrets */
export function sanitizeDiagnosticRecord(source, secrets = []) {
  try {
    if (source?.schema !== DIAGNOSTIC_SCHEMA || !events.has(source.event)) return null;
    const safe = (value) => typeof value !== "string" || !secrets.some((secret) => secret && value.includes(secret));
    const result = { schema: DIAGNOSTIC_SCHEMA, event: source.event };
    if (typeof source.timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(source.timestamp) && safe(source.timestamp)) result.timestamp = source.timestamp;
    for (const key of ["requestId", "jobId", "runId"]) if (typeof source[key] === "string" && uuid.test(source[key]) && safe(source[key])) result[key] = source[key];
    if (typeof source.caseId === "string" && /^(?:[IGTDUM]\d{2}|L0[1-6]|ENV)$/.test(source.caseId) && safe(source.caseId)) result.caseId = source.caseId;
    if (typeof source.model === "string" && /^gemini-[a-z0-9.-]{1,64}$/.test(source.model) && safe(source.model)) result.model = source.model;
    for (const key of ["factsHash", "configHash", "promptHash", "requestHash", "providerRequestIdHash"]) {
      if (typeof source[key] === "string" && hash.test(source[key]) && safe(source[key])) result[key] = source[key];
    }
    for (const [key, values] of Object.entries(enumFields)) if (values.has(source[key]) && safe(source[key])) result[key] = source[key];
    if (safe(source.errorCode) && (errorCodes.has(source.errorCode) || (typeof source.errorCode === "string" && /^provider_http_[1-5]\d\d$/.test(source.errorCode)))) result.errorCode = source.errorCode;
    if (Array.isArray(source.validationCodes)) result.validationCodes = [...new Set(source.validationCodes.filter((v) => validationCodes.has(v) && safe(v)))].slice(0,10);
    for (const key of ["durationMs", "remainingMs", "retryAfterMs", "inputTokens", "outputTokens", "totalTokens"]) {
      if (Number.isFinite(source[key]) && source[key] >= 0 && source[key] <= 1e12) result[key] = Math.trunc(source[key]);
    }
    if (Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599) result.httpStatus = source.httpStatus;
    if (source.attempt === 1 || source.attempt === 2) result.attempt = source.attempt;
    for (const key of ["ok", "retryable", "incomplete", "saved", "recorded"]) if (typeof source[key] === "boolean") result[key] = source[key];
    if (encoder.encode(JSON.stringify(result)).byteLength > DIAGNOSTIC_MAX_BYTES) {
      return { schema: result.schema, event: result.event, timestamp: result.timestamp, requestId: result.requestId, jobId: result.jobId };
    }
    return result;
  } catch { return null; }
}

/**
 * @param {Record<string, any>} context
 * @param {{sink?: (line: string) => any, now?: () => number, enabled?: boolean, secrets?: string[]}} options
 */
export function createDiagnosticLogger(context = {}, options = {}) {
  const sink = options.sink ?? ((line) => console.info(line));
  const now = options.now ?? Date.now;
  const secrets = (options.secrets ?? []).filter((v) => typeof v === "string" && v.length > 0);
  const budget = { count: 0 };
  function logger(base) {
    return {
      child(extra = {}) { return logger({ ...base, ...extra }); },
      emit(event, fields = {}) {
        try {
          if (options.enabled === false || budget.count >= DIAGNOSTIC_MAX_EVENTS || !events.has(event)) return;
          const limited = budget.count === DIAGNOSTIC_MAX_EVENTS - 1;
          const record = sanitizeDiagnosticRecord({ ...base, ...(limited ? {} : fields), schema: DIAGNOSTIC_SCHEMA,
            timestamp: new Date(now()).toISOString(), event: limited ? "diagnostic.limit" : event }, secrets);
          if (!record) return;
          budget.count++;
          const pending = sink(JSON.stringify(record));
          // Diagnostic sinks must never become a dependency of prediction completion.
          if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(() => {});
        } catch { /* A log sink failure must not trigger prediction retries. */ }
      },
    };
  }
  return logger(context);
}

export function emitDiagnostic(logger, event, fields = {}) {
  try { logger?.emit(event, fields); } catch { /* also isolate injected test sinks */ }
}

export async function providerDiagnostics(response, body, responseFormat = "json") {
  const value = { httpStatus: response.status, responseFormat,
    providerStatus: body?.error?.status, finishReason: body?.candidates?.[0]?.finishReason };
  try {
    const id = response.headers.get("x-request-id");
    if (id && id.length <= 256) {
      const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(id));
      value.providerRequestIdHash = [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2,"0")).join("");
    }
  } catch { /* request-ID diagnostics are optional */ }
  const safe = sanitizeDiagnosticRecord({ schema: DIAGNOSTIC_SCHEMA, event: "provider.finished", ...value });
  if (!safe) return {};
  const { schema: _schema, event: _event, ...fields } = safe;
  return fields;
}
