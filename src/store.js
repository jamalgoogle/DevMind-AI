// Tiny JSON-file store (sessions + settings). Swap for PostgreSQL later without touching the routes.
const fs = require('fs');
const path = require('path');
const { defaultSettings } = require('./config');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
const MAX_SESSIONS = 50;
let db = { sessions: [], settings: { ...defaultSettings } };

try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }
db.settings = { ...defaultSettings, ...db.settings };

function write() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}
let timer;
function persist() { clearTimeout(timer); timer = setTimeout(() => { try { write(); } catch (e) { console.error('persist failed', e.message); } }, 100); }
process.on('SIGINT', () => { try { write(); } catch {} process.exit(0); });

module.exports = {
  getSettings: () => db.settings,
  updateSettings(patch) { db.settings = { ...db.settings, ...patch }; persist(); return db.settings; },
  listSessions: () =>
    db.sessions.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt),
  getSession: (id) => db.sessions.find((s) => s.id === id),
  addMessage(id, message, persona) {
    let s = db.sessions.find((x) => x.id === id);
    if (!s) {
      s = { id, title: (message.text || 'Coding Task').replace(/\s+/g, ' ').slice(0, 30) || 'Coding Task', createdAt: Date.now(), updatedAt: Date.now(), persona, messages: [] };
      db.sessions.unshift(s);
      db.sessions = db.sessions.slice(0, MAX_SESSIONS);
    }
    s.messages.push({ ...message, at: Date.now() });
    s.updatedAt = Date.now();
    persist();
    return s;
  },
  deleteSession(id) { const n = db.sessions.length; db.sessions = db.sessions.filter((s) => s.id !== id); persist(); return db.sessions.length < n; },
  clearSessions() { db.sessions = []; persist(); }
};
