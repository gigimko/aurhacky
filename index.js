// server.js
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const pass = 'redacted';
const port = 5000;

app.use(cookieParser());
app.use(require('nocache')());
app.use(express.json()); // for JSON POST bodies

// --- Config ---
const PLACE_TTL_MS   = 30_000; // remove if no heartbeat within 30s
const CLEAN_MS       = 5_000;  // how often to sweep stale places
const SCRIPT_TTL_MS  = 10_000; // pending script auto-delete after 30s

// --- In-memory stores ---
/** placeId -> { displayName: string, lastSeen: number } */
const places = new Map();

/** uniqueId -> { script: string, addedAt: number, timer: NodeJS.Timeout } */
const pendingScripts = new Map();

// --- Helpers ---
function requireAuth(req, res, next) {
  if (req.cookies && req.cookies.auth === pass) return next();
  res.status(401).send('no auth ¯\\_(ツ)_/¯');
}

function cleanupPlaces() {
  const now = Date.now();
  for (const [id, info] of places.entries()) {
    if (now - info.lastSeen > PLACE_TTL_MS) {
      places.delete(id);
    }
  }
}
setInterval(cleanupPlaces, CLEAN_MS);

// --- Routes ---
app.post('/api/addPlace', (req, res) => {
  const { placeId, displayName } = req.body || {};
  if (placeId == null) {
    return res.status(400).json({ error: 'placeId is required' });
  }
  const id = String(placeId);
  const name = displayName != null ? String(displayName) : id;

  places.set(id, { displayName: name, lastSeen: Date.now() });
  return res.status(204).end(); // no content
});

app.get('/api/options', requireAuth, (req, res) => {
  // ensure no stale entries sneak through
  cleanupPlaces();
  const out = {};
  for (const [id, info] of places.entries()) {
    out[id] = info.displayName;
  }
  return res.status(200).json(out);
});

app.post('/api/execute', requireAuth, (req, res) => {
  const { uniqueId, pendingScriptToAdd } = req.body || {};
  if (!uniqueId || !pendingScriptToAdd) {
    return res.status(400).json({
      error: 'uniqueId and pendingScriptToAdd are required'
    });
  }

  // If same uniqueId is re-used, reset its TTL
  if (pendingScripts.has(uniqueId)) {
    clearTimeout(pendingScripts.get(uniqueId).timer);
  }

  const addedAt = Date.now();
  const timer = setTimeout(() => {
    pendingScripts.delete(uniqueId);
  }, SCRIPT_TTL_MS);

  pendingScripts.set(uniqueId, {
    script: String(pendingScriptToAdd),
    addedAt,
    timer
  });

  return res.status(201).json({ status: 'queued', uniqueId });
});

app.get('/api/pendingScripts', (req, res) => {
  const now = Date.now();
  const list = [];
  for (const [uniqueId, entry] of pendingScripts.entries()) {
    const expiresInMs = Math.max(SCRIPT_TTL_MS - (now - entry.addedAt), 0);
    list.push({ uniqueId, script: entry.script, expiresInMs });
  }
  return res.status(200).json(list);
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`app listening on http://localhost:${port}`);
});
