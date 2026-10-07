// Every reply comes from the Gemini API, streamed token-by-token. No canned answers: if the key is
// missing or Gemini fails, the error is returned to the client.
const { personas } = require('./config');

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// Tried in order when the main model is overloaded (503/429/5xx). Comma-separated, optional.
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-2.5-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);
// Gemini 2.5 Flash "thinks" before answering, which adds seconds of silence. 0 = off (fast),
// -1 = dynamic (smarter, slower), or a token count such as 1024.
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
const RETRY_DELAYS_MS = [500]; // per model: 1 try + 1 quick retry, then the next model
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini wants alternating user/model turns that start with "user".
function toGeminiContents(history) {
  const out = [];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (!out.length && role === 'model') continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n\n' + m.text;
    else out.push({ role, parts: [{ text: m.text }] });
  }
  return out;
}

// One streaming request. Calls onDelta(text) for every chunk and resolves with the full text.
async function streamGemini({ model, system, history, temperature, onDelta, signal, schema, thinkingBudget = THINKING_BUDGET }) {
  const generationConfig = { temperature, maxOutputTokens: 8192 };
  if (/gemini-2\.5-flash/.test(model) && Number.isFinite(thinkingBudget)) generationConfig.thinkingConfig = { thinkingBudget };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: toGeminiContents(history), generationConfig }),
    signal
  });
  if (!res.ok) {
    const e = new Error(`Gemini API ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`);
    e.retryable = RETRYABLE.has(res.status);
    throw e;
  }

  const decoder = new TextDecoder();
  let buf = '', full = '', finish = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch { continue; }
      const cand = data.candidates?.[0];
      if (cand?.finishReason) finish = cand.finishReason;
      const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      if (text) { full += text; onDelta?.(text); }
      else if (data.promptFeedback?.blockReason) finish = data.promptFeedback.blockReason;
    }
  }
  if (!full) throw new Error('Gemini returned no text (' + (finish || 'empty response') + ')');
  return full;
}

// Retries / falls back to another model, but only while nothing has been sent to the user yet.
async function generate({ history, personaId, settings, onDelta, signal, system: systemOverride, schema, thinkingBudget, temperature }) {
  if (!KEY) {
    const e = new Error('GEMINI_API_KEY is not set. Add it to the .env file next to server.js and restart the server.');
    e.status = 503;
    throw e;
  }
  const persona = personas.find((p) => p.id === personaId) || personas[0];
  const system = systemOverride || `${settings.systemPrompt}\n\n${persona.prompt}`;
  let started = false, lastErr;

  for (const model of [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)]) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const text = await streamGemini({ model, system, history, temperature: temperature ?? settings.temperature, signal, schema, thinkingBudget, onDelta: (t) => { started = true; onDelta?.(t); } });
        return { text, source: 'gemini', model };
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw err;
        console.error('[ai]', err.message.slice(0, 200));
        if (started || !err.retryable) { const e = new Error(err.message); e.status = 502; throw e; }
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  const e = new Error('Gemini is overloaded right now (tried ' + [MODEL, ...FALLBACKS].join(', ') + '). Please try again in a minute. Last error: ' + lastErr.message);
  e.status = 503;
  throw e;
}

// ---- AI security audit: structured JSON findings from Gemini
const AUDIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          severity: { type: 'STRING', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'STRING' },
          line: { type: 'INTEGER' },
          snippet: { type: 'STRING' },
          description: { type: 'STRING' },
          fix: { type: 'STRING' }
        },
        required: ['severity', 'title', 'description', 'fix']
      }
    }
  },
  required: ['summary', 'findings']
};
const AUDIT_SYSTEM = `You are a senior application-security engineer doing a code review.
Audit the supplied code for: OWASP Top 10 vulnerabilities, hardcoded secrets, injection, unsafe deserialization, auth/authz gaps, missing input validation, insecure crypto, SSRF/path traversal, race conditions, memory/resource leaks, and serious performance bottlenecks.
Rules:
- Report only real issues that are present in THIS code. Never invent problems and never pad the list. If the code is clean or only a fragment, say so in "summary" and return few or no findings.
- "line" is the line number from the numbered listing; "snippet" is the offending code (max 140 chars).
- "description" explains the concrete risk/exploit; "fix" gives a specific remedy (short code if useful).
- Severity: critical = remotely exploitable / data loss; high = serious; medium = needs conditions; low = hardening.
- "summary" is 1-3 sentences describing what the code does and its overall security posture.`;

async function auditCode(code, settings) {
  const numbered = code.split(/\r?\n/).map((l, i) => `${i + 1}: ${l}`).join('\n');
  const out = await generate({
    history: [{ role: 'user', text: `Audit this code:\n\n${numbered}` }],
    settings, system: AUDIT_SYSTEM, schema: AUDIT_SCHEMA, temperature: 0.1, thinkingBudget: 1024
  });
  let data;
  try { data = JSON.parse(out.text); } catch { const e = new Error('Gemini returned an unreadable audit result. Please run it again.'); e.status = 502; throw e; }
  const SEV = ['critical', 'high', 'medium', 'low'];
  const findings = (Array.isArray(data.findings) ? data.findings : [])
    .filter((f) => f && SEV.includes(f.severity) && f.title)
    .map((f) => ({ severity: f.severity, title: String(f.title), line: Number.isInteger(f.line) ? f.line : null, snippet: String(f.snippet || '').slice(0, 140), description: String(f.description || ''), fix: String(f.fix || ''), source: 'ai' }));
  return { summary: String(data.summary || ''), findings, model: out.model };
}

module.exports = { generate, auditCode };
