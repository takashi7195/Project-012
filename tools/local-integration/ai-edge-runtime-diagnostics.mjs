// Read-only local diagnostics. No Function invocation, config changes, restart,
// or raw logs/environment values are printed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../..', import.meta.url));
const container = 'supabase_edge_runtime_project-012';
function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}
const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
const section = config.match(/\[edge_runtime\]([^]*?)(?=\n\[|$)/)?.[1] ?? '';
console.log(`CONFIG_PER_WORKER=${/policy\s*=\s*"per_worker"/.test(section)}`);
const cli = run(resolve(root, 'tools/supabase-cli/supabase.exe'), ['--version']);
console.log(`CLI_VERSION=${cli.status === 0 ? cli.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? 'unknown' : 'unavailable'}`);
const inspected = run('docker', ['inspect', '--format', '{{json .State}}', container]);
if (inspected.status === 0) {
  const state = JSON.parse(inspected.stdout);
  const status = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(state.Status) ? state.Status : 'unknown';
  console.log(`EDGE_STATE=${status} RUNNING=${state.Running === true} OOM_KILLED=${state.OOMKilled === true} EXIT_CODE=${Number.isInteger(state.ExitCode) ? state.ExitCode : 'unknown'}`);
} else console.log('EDGE_STATE=unavailable');
const logs = run('docker', ['logs', '--timestamps', '--since', '30m', '--tail', '1500', container]);
if (logs.error || logs.status !== 0) {
  console.log(`LOG_READ=failed EXIT_CODE=${logs.status ?? 'unknown'} TIMEOUT=${logs.error?.code === 'ETIMEDOUT'}`);
  process.exitCode = 1;
} else {
  const lines = `${logs.stdout}\n${logs.stderr}`.split(/\r?\n/).filter(Boolean);
  const patterns = {
    completion: /AI_WAITUNTIL_SMOKE_COMPLETED:/i,
    boot: /booted|worker.*started|starting.*worker/i,
    shutdown: /shutdown|shutting down|terminated|terminating|early.?drop/i,
    wall_clock: /wall.?clock|wall.?time/i,
    cpu_limit: /cpu.*(?:limit|exceed)|(?:limit|exceed).*cpu/i,
    memory_limit: /memory.*(?:limit|exceed)|out.of.memory/i,
    exception: /error|exception|unhandled|failed|panic/i,
    policy_per_worker: /per_worker|per-worker/i,
    policy_per_request: /per_request|per-request/i,
  };
  console.log(`LOG_READ=ok WINDOW=30m MAX_LINES=1500 LINES=${lines.length}`);
  for (const [category, pattern] of Object.entries(patterns)) {
    console.log(`LOG_${category.toUpperCase()}=${lines.filter((line) => pattern.test(line)).length}`);
  }
  for (const line of lines.filter((line) => Object.values(patterns).some((pattern) => pattern.test(line))).slice(-16)) {
    const time = line.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/)?.[0] ?? 'unknown';
    const categories = Object.entries(patterns).filter(([, pattern]) => pattern.test(line)).map(([key]) => key);
    console.log(`EVENT time=${time} categories=${categories.join(',')}`);
  }
  console.log('INFO: counts may include earlier runs and shutdown caused by test cleanup; no raw logs or credentials displayed');
}
