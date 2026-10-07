// Rule-based static scanner: fast and deterministic, not a replacement for a real SAST tool.
const RULES = [
  { sev: 'critical', title: 'Hardcoded secret', re: /(api[_-]?key|secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
    msg: 'Credentials committed in source leak through VCS, logs and bundles.', fix: 'Load from environment variables or a secret manager (process.env.API_KEY).' },
  { sev: 'high', title: 'Dynamic code execution (eval / Function / exec)', re: /\beval\s*\(|new\s+Function\s*\(|\bexec\s*\(|os\.system\s*\(|shell\s*=\s*True/,
    msg: 'Executing strings as code enables remote code execution when any part is user-controlled.', fix: 'Remove dynamic evaluation; use a parser, lookup table, or execFile with an argument array.' },
  { sev: 'high', title: 'SQL built with string concatenation', re: /(select|insert|update|delete)\b[^;\n]*(['"`]\s*\+|\$\{|%s|\.format\(|f['"])/i,
    msg: 'Interpolating values into SQL allows SQL injection (OWASP A03).', fix: "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [id])." },
  { sev: 'medium', title: 'Unsafe HTML sink (innerHTML / document.write)', re: /\.innerHTML\s*=|document\.write\s*\(|dangerouslySetInnerHTML/,
    msg: 'Writing unsanitized data into the DOM leads to XSS (OWASP A03).', fix: 'Use textContent, or sanitize with DOMPurify before inserting HTML.' },
  { sev: 'medium', title: 'Weak hash algorithm (MD5 / SHA-1)', re: /createHash\(\s*['"](md5|sha1)['"]|hashlib\.(md5|sha1)\(/i,
    msg: 'MD5/SHA-1 are broken for security purposes.', fix: 'Use SHA-256+ for integrity and bcrypt/argon2 for passwords.' },
  { sev: 'medium', title: 'TLS verification disabled', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED/,
    msg: 'Disabling certificate checks exposes traffic to man-in-the-middle attacks.', fix: 'Keep verification on; trust a custom CA instead.' },
  { sev: 'low', title: 'Insecure random for tokens', re: /Math\.random\(\)|\brandom\.random\(\)/,
    msg: 'Not cryptographically secure; unsuitable for tokens, IDs or secrets.', fix: 'Use crypto.randomBytes / crypto.randomUUID (secrets module in Python).' },
  { sev: 'low', title: 'Plain HTTP URL', re: /['"]http:\/\/(?!localhost|127\.0\.0\.1)/,
    msg: 'Unencrypted transport.', fix: 'Use https://.' },
  { sev: 'low', title: 'Empty catch block', re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:\n]*:\s*pass\b/,
    msg: 'Swallowed errors hide failures and make debugging hard.', fix: 'Log or rethrow the error.' }
];
const WEIGHT = { critical: 25, high: 15, medium: 8, low: 3 };
const ORDER = ['critical', 'high', 'medium', 'low'];

function audit(code) {
  const lines = code.split(/\r?\n/);
  const findings = [];
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) findings.push({ severity: r.sev, title: r.title, description: r.msg, fix: r.fix, line: i + 1, snippet: line.trim().slice(0, 140) });
  });
  findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.line - b.line);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((f) => counts[f.severity]++);
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + WEIGHT[f.severity], 0));
  return { score, counts, findings, linesScanned: lines.length };
}
function tally(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((f) => counts[f.severity]++);
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + WEIGHT[f.severity], 0));
  return { counts, score };
}
function sortFindings(findings) {
  return findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || (a.line || 0) - (b.line || 0));
}
module.exports = { audit, tally, sortFindings };
