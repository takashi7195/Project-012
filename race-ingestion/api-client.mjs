import { createHash } from "node:crypto";

export const API_BASE_URL = "https://boatraceopenapi.github.io/api/v1";
export const SOURCE_CODE = "boatraceopenapi-v1";
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

function dateParts(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error("date must be YYYY-MM-DD");
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) throw new Error("invalid date");
  return { year: dateText.slice(0, 4), compact: dateText.replaceAll("-", "") };
}

export function buildApiUrl(dateText) {
  const { year, compact } = dateParts(dateText);
  return `${API_BASE_URL}/${year}/${compact}.json`;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function readBody(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      const error = new Error("response body exceeds configured limit");
      error.code = "payload_too_large";
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function classifyError(error) {
  // DOMException(AbortError) exposes numeric `code = 20` in Node. Do not
  // leak that implementation detail into scheduler error codes.
  if (typeof error?.code === "string" && error.code) return error.code;
  if (error?.name === "AbortError") return "fetch_timeout";
  if (error instanceof SyntaxError) return "invalid_json";
  return "fetch_network";
}

export async function fetchDailyJson(dateText, {
  fetchImpl = fetch,
  timeoutMs = 30_000,
  maxBodyBytes = MAX_BODY_BYTES,
  etag,
  lastModified,
} = {}) {
  const url = buildApiUrl(dateText);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const headers = { Accept: "application/json" };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: controller.signal });
    } catch (error) {
      const wrapped = new Error(error?.message || "fetch failed");
      wrapped.code = classifyError(error);
      throw wrapped;
    }
    const elapsedMs = Date.now() - started;
    const header = (name) => response.headers?.get?.(name) ?? null;
    if (response.status === 304) {
      return { status: "not_modified", date: dateText, url, startedAt, elapsedMs, httpStatus: 304, etag: header("etag"), lastModified: header("last-modified") };
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.code = response.status === 404 ? "fetch_404" : response.status === 429 ? "fetch_429" : response.status >= 500 ? "fetch_5xx" : "fetch_http_error";
      error.httpStatus = response.status;
      error.retryAfter = header("retry-after");
      throw error;
    }
    const text = await readBody(response, maxBodyBytes);
    let json;
    try { json = JSON.parse(text); } catch (error) { error.code = "invalid_json"; throw error; }
    return {
      status: "fetched", date: dateText, url, startedAt, elapsedMs,
      httpStatus: response.status, bytes: Buffer.byteLength(text, "utf8"),
      etag: header("etag"), lastModified: header("last-modified"),
      bodyHash: sha256(text), bodyText: text, json,
    };
  } catch (error) {
    const wrapped = new Error(error?.message || "fetch failed");
    wrapped.code = classifyError(error);
    wrapped.httpStatus = error?.httpStatus;
    wrapped.retryAfter = error?.retryAfter;
    wrapped.date = dateText;
    wrapped.url = url;
    wrapped.elapsedMs = Date.now() - started;
    wrapped.startedAt = startedAt;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

