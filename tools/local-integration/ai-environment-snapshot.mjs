// Read-only environment checks. Only this script's allowlisted report is saved.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:http';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const windows = process.platform === 'win32';
const report = { schema: 'race-ai-environment-v1', timestamp: new Date().toISOString(),
  platform: process.platform, node: process.version, checks: {}, http: [] };
function run(command, args) {
  return new Promise(done => execFile(command, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
  }, (error, stdout) => done({ ok: !error, exit: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
    reason: error ? (['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? error.code : error.killed ? 'timeout' : 'failed') : null,
    text: stdout ?? '' })));
}
const state = r => ({ ok: r.ok, exit: r.exit, reason: r.reason });
async function version(name, command, args) {
  const r = await run(command, args);
  report.checks[name] = { ...state(r), version: r.ok ? r.text.match(/\b\d+\.\d+(?:\.\d+)?\b/)?.[0] ?? null : null };
}
function privateIPv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function probe(host, path) {
  return new Promise(done => {
    let finished = false;
    let timer;
    const finish = fields => { if (!finished) { finished = true; clearTimeout(timer); done({ host, path, ...fields }); } };
    const req = get({ host, port: 54321, path, agent: false }, res => {
      finish({ status: res.statusCode, error: null });
      res.destroy();
    });
    req.on('error', error => finish({ status: null, error: ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES'].includes(error.code) ? error.code : 'network_error' }));
    timer = setTimeout(() => { finish({ status: null, error: 'timeout' }); req.destroy(); }, 5000);
  });
}

console.log('INFO: collecting safe environment facts; raw output and credentials are withheld');
await Promise.all([
  version('git', 'git', ['--version']),
  version('githubCli', 'gh', ['--version']),
  version('supabaseCli', resolve(root, 'tools/supabase-cli/supabase.exe'), ['--version']),
  (async () => { const r = await run('docker', ['version', '--format', '{{.Client.Version}}|{{.Server.Version}}']);
    const v = r.text.trim().split('|');
    report.checks.docker = { ...state(r), client: /^\d+\.\d+\.\d+$/.test(v[0]) ? v[0] : null,
      server: /^\d+\.\d+\.\d+$/.test(v[1]) ? v[1] : null }; })(),
  (async () => { const r = await run('docker', ['ps', '-a', '--filter', 'label=com.supabase.cli.project=project-012', '--format', '{{.Names}}|{{.State}}']);
    report.checks.containers = { ...state(r), items: r.text.split(/\r?\n/).map(line => line.split('|'))
      .filter(([name, status]) => /^supabase_[a-z0-9_]+_project-012$/.test(name) && /^(created|running|paused|restarting|removing|exited|dead)$/.test(status))
      .map(([name, status]) => ({ name, status })) }; })(),
  (async () => { report.checks.githubAuth = state(await run('gh', ['auth', 'status', '--hostname', 'github.com'])); })(),
  (async () => { report.checks.supabaseManagementAuth = state(await run(resolve(root, 'tools/supabase-cli/supabase.exe'), ['projects', 'list', '--output', 'json'])); })(),
]);
report.checks.browser = {
  playwrightModule: existsSync(resolve(root, windows ? 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json' : '/mnt/c/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')),
  windowsEdge: [String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`]
    .some(path => existsSync(windows ? path : '/mnt/c/' + path.slice(3).replaceAll('\\', '/'))),
};
report.checks.localSecretMetadataFile = { exists: existsSync(resolve(root, 'supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env')) };
report.checks.linkedProjectFile = { exists: existsSync(resolve(root, 'supabase/.temp/project-ref')) };

let addresses = [];
const bashChecks = 'test -r "$HOME/.config/project-012/gemini-v019.env" && test -s "$HOME/.config/project-012/gemini-v019.env" && printf "KEY_FILE_READY\\n"; test -r "$HOME/.nvm/nvm.sh" && printf "NVM_FILE_READY\\n"; command -v node >/dev/null && printf "NODE_ON_PATH\\n"; command -v docker >/dev/null && printf "DOCKER_ON_PATH\\n"; command -v codex >/dev/null && printf "CODEX_ON_PATH\\n"; exit 0';
if (windows) {
  await version('powershell', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  report.checks.ubuntuLaunch = state(await run('wsl.exe', ['-d', 'Ubuntu', '--exec', '/bin/true']));
  if (report.checks.ubuntuLaunch.ok) {
    const ip = await run('wsl.exe', ['-d', 'Ubuntu', '--exec', 'hostname', '-I']);
    addresses = ip.ok ? ip.text.trim().split(/\s+/).filter(privateIPv4) : [];
    const r = await run('wsl.exe', ['-d', 'Ubuntu', '--exec', 'bash', '-lc', bashChecks]);
    report.checks.ubuntu = { ...state(r), ...Object.fromEntries(['KEY_FILE_READY', 'NVM_FILE_READY', 'NODE_ON_PATH', 'DOCKER_ON_PATH', 'CODEX_ON_PATH'].map(label => [label, r.text.split(/\r?\n/).includes(label)])) };
  }
  const listeners = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetTCPConnection -LocalPort 54321 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }']);
  const names = listeners.text.split(/\r?\n/).filter(x => ['wslrelay', 'com.docker.backend', 'node', 'System', 'svchost'].includes(x));
  report.checks.windowsPortListeners = { ...state(listeners), recognized: [...new Set(names)] };
} else {
  const ip = await run('hostname', ['-I']);
  addresses = ip.ok ? ip.text.trim().split(/\s+/).filter(privateIPv4) : [];
  const r = await run('bash', ['-lc', bashChecks]);
  report.checks.linux = { ...state(r), ...Object.fromEntries(['KEY_FILE_READY', 'NVM_FILE_READY', 'NODE_ON_PATH', 'DOCKER_ON_PATH', 'CODEX_ON_PATH'].map(label => [label, r.text.split(/\r?\n/).includes(label)])) };
}
for (const host of [...new Set(['127.0.0.1', ...addresses])].slice(0, 5)) {
  report.http.push(...await Promise.all(['/rest/v1/', '/functions/v1/predictions'].map(path => probe(host, path))));
}
report.checks.bundledNode = { exists: existsSync(resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin', windows ? 'node.exe' : 'node')) };
const destination = resolve(root, 'docs/test-evidence/v0.1.19', `environment-snapshot-${process.platform}.json`);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(`ENVIRONMENT_REPORT_SAVED=${destination}`);
console.log('INFO: environment snapshot only; test acceptance is not implied');
