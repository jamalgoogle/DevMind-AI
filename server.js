require('dotenv').config({ path: require('path').join(__dirname, '.env') }); // must run before ./src/* so GEMINI_API_KEY is visible
const express = require('express');
const path = require('path');
const config = require('./src/config');
const store = require('./src/store');
const ai = require('./src/ai');
const { audit, tally, sortFindings } = require('./src/audit');
const runner = require('./src/runner');

const app = express();
// CORS so the page still works if opened from another origin (e.g. file:// or a different dev port).
// In production set CORS_ORIGIN to your real site, or leave unset for same-origin only.
const CORS_ORIGIN = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*');
app.use((req, res, next) => {
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
const ID_RE = /^[\w-]{6,64}$/;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Everything the UI needs on load: labels, personas, prompts, defaults, settings, session list.
api.get('/bootstrap', (req, res) => {
  const { defaultSettings, ...ui } = config;
  res.json({ ...ui, settings: store.getSettings(), sessions: store.listSessions(), features: { codeExecution: runner.ENABLED } });
});

// Quick check: is the AI key loaded?  Open http://localhost:3000/api/health
api.get('/health', (req, res) => res.json({ ok: true, ai: process.env.GEMINI_API_KEY ? 'gemini' : 'NOT CONFIGURED (GEMINI_API_KEY missing)', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }));

// ---- Settings
api.get('/settings', (req, res) => res.json(store.getSettings()));
api.put('/settings', (req, res) => {
  const b = req.body || {}, patch = {};
  if (b.systemPrompt !== undefined) { if (typeof b.systemPrompt !== 'string' || b.systemPrompt.length > 4000) return bad(res, 'Invalid systemPrompt'); patch.systemPrompt = b.systemPrompt; }
  if (b.temperature !== undefined) { const t = Number(b.temperature); if (!(t >= 0 && t <= 1)) return bad(res, 'temperature must be 0..1'); patch.temperature = t; }
  if (b.engine !== undefined) { if (!config.engines.some((e) => e.id === b.engine)) return bad(res, 'Unknown engine'); patch.engine = b.engine; }
  if (b.theme !== undefined) { if (!['light', 'dark'].includes(b.theme)) return bad(res, 'Invalid theme'); patch.theme = b.theme; }
  if (b.persona !== undefined) { if (!config.personas.some((p) => p.id === b.persona)) return bad(res, 'Unknown persona'); patch.persona = b.persona; }
  res.json(store.updateSettings(patch));
});

// ---- Sessions
api.get('/sessions', (req, res) => res.json({ sessions: store.listSessions() }));
api.delete('/sessions', (req, res) => { store.clearSessions(); res.json({ ok: true }); });
api.get('/sessions/:id', (req, res) => {
  const s = store.getSession(req.params.id);
  s ? res.json(s) : bad(res, 'Session not found', 404);
});
api.delete('/sessions/:id', (req, res) => (store.deleteSession(req.params.id) ? res.json({ ok: true }) : bad(res, 'Session not found', 404)));

// ---- Chat
const F = '```';
function prepareChat(body) {
  const { sessionId, message = '', persona, attachment } = body || {};
  if (!ID_RE.test(sessionId || '')) return { error: 'Invalid sessionId' };
  if (typeof message !== 'string' || message.length > 20000) return { error: 'Message too long (max 20,000 chars)' };
  if (attachment && (typeof attachment.name !== 'string' || typeof attachment.content !== 'string' || attachment.content.length > 100000)) return { error: 'Invalid attachment (max 100 KB of text)' };
  if (!message.trim() && !attachment) return { error: 'Empty message' };
  const userText = attachment ? `${message}\n\n[Attached file: ${attachment.name}]\n${F}\n${attachment.content}\n${F}` : message;
  const userMsg = { role: 'user', text: userText, attachment: attachment ? attachment.name : undefined };
  const existing = (store.getSession(sessionId) || { messages: [] }).messages;
  return { sessionId, persona, userMsg, history: [...existing, userMsg].slice(-20) };
}
function saveExchange(c, out) {
  // Only saved after Gemini succeeded, so failed requests leave no dangling messages.
  store.addMessage(c.sessionId, c.userMsg, c.persona);
  store.addMessage(c.sessionId, { role: 'assistant', text: out.text, source: out.source }, c.persona);
}

// Streaming (used by the UI): Server-Sent Events -> {delta} ... {done, sessions} | {error}
api.post('/chat/stream', async (req, res) => {
  const c = prepareChat(req.body);
  if (c.error) return bad(res, c.error);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // user closed the tab -> stop paying for tokens
  try {
    const out = await ai.generate({ history: c.history, personaId: c.persona, settings: store.getSettings(), signal: ac.signal, onDelta: (delta) => send({ delta }) });
    saveExchange(c, out);
    send({ done: true, sessions: store.listSessions(), model: out.model });
  } catch (e) {
    if (!ac.signal.aborted) send({ error: e.message });
  }
  res.end();
});

// Non-streaming variant (curl / other clients)
api.post('/chat', async (req, res, next) => {
  try {
    const c = prepareChat(req.body);
    if (c.error) return bad(res, c.error);
    const out = await ai.generate({ history: c.history, personaId: c.persona, settings: store.getSettings() });
    saveExchange(c, out);
    res.json({ reply: out, sessions: store.listSessions() });
  } catch (e) { next(e); }
});

// ---- Code Studio
api.post('/studio/run', async (req, res, next) => {
  try {
    if (!runner.ENABLED) return bad(res, 'Code execution is disabled on this server (ENABLE_CODE_EXEC=false).', 403);
    const { code, language } = req.body || {};
    if (typeof code !== 'string' || !code.trim() || code.length > 50000) return bad(res, 'Provide code (max 50,000 chars)');
    if (!config.languages.some((l) => l.id === language)) return bad(res, 'Unknown language');
    res.json(await runner.run(language, code));
  } catch (e) { next(e); }
});

// ---- Security audit: Gemini review + deterministic pattern rules (secrets, eval, SQL concat, ...)
api.post('/audit', async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (typeof code !== 'string' || !code.trim() || code.length > 100000) return bad(res, 'Provide code (max 100,000 chars)');
    const ai_ = await ai.auditCode(code, store.getSettings());
    const rules = audit(code).findings.filter((r) => !ai_.findings.some((f) => f.line === r.line)).map((r) => ({ ...r, source: 'rule' }));
    const findings = sortFindings([...ai_.findings, ...rules]);
    res.json({ summary: ai_.summary, findings, ...tally(findings), linesScanned: code.split(/\r?\n/).length, model: ai_.model });
  } catch (e) { next(e); }
});

api.use((req, res) => bad(res, 'Not found', 404));
app.use('/api', api);
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DevMind AI running on http://localhost:${PORT}  (AI: ${process.env.GEMINI_API_KEY ? 'Gemini ' + (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : 'NOT CONFIGURED - set GEMINI_API_KEY in .env'}, code exec: ${runner.ENABLED})`));
