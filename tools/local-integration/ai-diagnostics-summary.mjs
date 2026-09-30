import { pathToFileURL } from "node:url";
import { sanitizeDiagnosticRecord } from "../../race-prediction/ai-diagnostics.mjs";

// Discard all non-diagnostic input, including runtime exceptions and multiline bodies.
export function extractDiagnostic(line, filters = {}) {
  if (Buffer.byteLength(line, "utf8") > 16384) return null;
  const start = line.indexOf('{"schema":"race-ai-diagnostic-v1"');
  if (start < 0) return null;
  try {
    const record = sanitizeDiagnosticRecord(JSON.parse(line.slice(start).trim()));
    if (!record || (filters.jobId && record.jobId !== filters.jobId) ||
        (filters.requestId && record.requestId !== filters.requestId)) return null;
    return record;
  } catch { return null; }
}

export async function collectDiagnostics(input, output, filters = {}) {
  let pending = "", dropping = false;
  input.setEncoding("utf8");
  for await (const chunk of input) {
    const parts = chunk.split("\n");
    for (let index = 0; index < parts.length; index++) {
      if (!dropping) {
        if (Buffer.byteLength(pending, "utf8") + Buffer.byteLength(parts[index], "utf8") > 16384) {
          pending = ""; dropping = true;
        } else pending += parts[index];
      }
      if (index < parts.length - 1) {
        if (!dropping) {
          const record = extractDiagnostic(pending, filters);
          if (record) output.write(`${JSON.stringify(record)}\n`);
        }
        pending = ""; dropping = false;
      }
    }
  }
  if (!dropping && pending) {
    const record = extractDiagnostic(pending, filters);
    if (record) output.write(`${JSON.stringify(record)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filters = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    if (!["--job-id", "--request-id"].includes(args[index]) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[index + 1] ?? "")) {
      console.error("Usage: node ai-diagnostics-summary.mjs [--job-id UUID] [--request-id UUID]");
      process.exit(2);
    }
    filters[args[index] === "--job-id" ? "jobId" : "requestId"] = args[index + 1];
  }
  try { await collectDiagnostics(process.stdin, process.stdout, filters); }
  catch { console.error("DIAGNOSTIC_COLLECTION=failed"); process.exitCode = 1; }
}
