// Runs studio code in a child process with a timeout and output cap.
// A child process is NOT a real sandbox. For anything public, run the server in a locked-down
// container, or set ENABLE_CODE_EXEC=false.
const { spawn } = require('child_process');
const os = require('os');

const ENABLED = process.env.ENABLE_CODE_EXEC
  ? process.env.ENABLE_CODE_EXEC === 'true'
  : process.env.NODE_ENV !== 'production';
const TIMEOUT_MS = 5000;
const MAX_OUT = 64 * 1024;

const RUNTIMES = {
  javascript: { cmd: process.execPath, args: ['-'] },
  python: { cmd: process.platform === 'win32' ? 'python' : 'python3', args: ['-'] }
};

function run(language, code) {
  const rt = RUNTIMES[language];
  if (!rt) {
    return Promise.resolve({ ok: false, supported: false, stdout: '', stderr: `Server-side execution is not available for "${language}". Supported: ${Object.keys(RUNTIMES).join(', ')}.`, exitCode: null, durationMs: 0, timedOut: false });
  }
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // never expose secrets to user code
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '', stderr = '', timedOut = false, done = false, timer;
    const finish = (extra) => { if (done) return; done = true; clearTimeout(timer); resolve({ supported: true, stdout, stderr, durationMs: Date.now() - start, timedOut, ...extra }); };
    const child = spawn(rt.cmd, rt.args, { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout = (stdout + d).slice(0, MAX_OUT); });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(0, MAX_OUT); });
    child.on('error', (e) => { stderr = e.code === 'ENOENT' ? `Runtime "${rt.cmd}" is not installed on the server.` : e.message; finish({ ok: false, exitCode: null }); });
    child.on('close', (code) => { if (timedOut) stderr += `\nExecution killed after ${TIMEOUT_MS / 1000}s timeout.`; finish({ ok: code === 0 && !timedOut, exitCode: code }); });
    child.stdin.on('error', () => {});
    child.stdin.end(code);
  });
}
module.exports = { run, ENABLED };
