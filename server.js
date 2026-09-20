const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'nearhelp-demo-secret-change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'nearhelp.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'nearhelp-demo-secret-change-me') {
  console.warn('Warning: JWT_SECRET is using the demo default. Set a real value in .env before production use.');
}

const db = new sqlite3.Database(DB_PATH);

const sampleResources = [
  { name: 'City General Hospital', type: 'hospital', lat: 23.3541, lng: 85.3156, dist: '0.8 km' },
  { name: 'Sector 4 Police Station', type: 'police', lat: 23.3371, lng: 85.3206, dist: '1.1 km' },
  { name: 'Central Fire Station', type: 'fire', lat: 23.3481, lng: 85.2966, dist: '1.4 km' },
  { name: "St. Anne's Hospital", type: 'hospital', lat: 23.3301, lng: 85.3056, dist: '1.9 km' },
  { name: 'Riverside Police Post', type: 'police', lat: 23.3611, lng: 85.3116, dist: '2.2 km' },
];

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function seedDemoUsers() {
  const users = [
    { name: 'Asha Verma', email: 'asha@nearhelp.app', role: 'user', password: 'demo1234' },
    { name: 'Rakesh Kumar', email: 'rakesh@nearhelp.app', role: 'responder', password: 'demo1234' },
    { name: 'S. Iyer', email: 'admin@nearhelp.app', role: 'admin', password: 'demo1234' },
  ];

  for (const user of users) {
    const existing = await getQuery('SELECT id FROM users WHERE email = ?', [user.email]);
    if (!existing) {
      const hash = await bcrypt.hash(user.password, 10);
      await runQuery(
        `INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
        [user.name, user.email, hash, user.role, new Date().toISOString()]
      );
    }
  }
}

async function initDb() {
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS guardians (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        relation TEXT DEFAULT 'Guardian',
        status TEXT DEFAULT 'offline',
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        incident_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        responder_name TEXT,
        eta INTEGER,
        chat_json TEXT DEFAULT '[]',
        ai_json TEXT DEFAULT '[]',
        timeline_json TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS welfare (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        from_name TEXT NOT NULL,
        status TEXT NOT NULL,
        time_label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS moderation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        flagged_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`, (err) => { if (err) return reject(err); });

      resolve();
    });
  });

  await seedDemoUsers();

  const guardians = await allQuery('SELECT * FROM guardians WHERE user_id IS NOT NULL');
  if (guardians.length === 0) {
    const user = await getQuery('SELECT id FROM users WHERE email = ?', ['asha@nearhelp.app']);
    if (user) {
      await runQuery('INSERT INTO guardians (user_id, name, relation, status, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, 'Meera Verma', 'Mother', 'online', new Date().toISOString()]);
      await runQuery('INSERT INTO guardians (user_id, name, relation, status, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, 'Sanjay Verma', 'Father', 'offline', new Date().toISOString()]);
      await runQuery('INSERT INTO guardians (user_id, name, relation, status, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, 'Priya Nair', 'Friend', 'online', new Date().toISOString()]);
    }
  }

  const welfareRows = await allQuery('SELECT * FROM welfare');
  if (welfareRows.length === 0) {
    const user = await getQuery('SELECT id FROM users WHERE email = ?', ['asha@nearhelp.app']);
    if (user) {
      await runQuery('INSERT INTO welfare (user_id, from_name, status, time_label, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, 'Meera Verma', 'pending', '10 min ago', new Date().toISOString()]);
    }
  }

  const moderationRows = await allQuery('SELECT * FROM moderation');
  if (moderationRows.length === 0) {
    await runQuery('INSERT INTO moderation (incident_id, flagged_by, reason, status, created_at) VALUES (?, ?, ?, ?, ?)', ['SOS-0877', 'Responder', 'No one present at reported location', 'Under review', new Date().toISOString()]);
    await runQuery('INSERT INTO moderation (incident_id, flagged_by, reason, status, created_at) VALUES (?, ?, ?, ?, ?)', ['SOS-0801', 'Auto-detection', 'Cancelled within 5s of sending', 'Dismissed', new Date().toISOString()]);
  }
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(compression());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'NearHelp backend is running' });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role = 'user' } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  try {
    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await getQuery('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const result = await runQuery(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [String(name).trim(), cleanEmail, hash, role, new Date().toISOString()]
    );

    const safeUser = { id: result.id, name: String(name).trim(), email: cleanEmail, role };
    return res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (error) {
    return res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const user = await getQuery('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    return res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await getQuery('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.get('/api/resources', authMiddleware, (req, res) => {
  res.json({ resources: sampleResources });
});

app.get('/api/guardians', authMiddleware, async (req, res) => {
  try {
    const guardians = await allQuery('SELECT * FROM guardians WHERE user_id = ? ORDER BY id ASC', [req.user.id]);
    res.json({ guardians });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch guardians' });
  }
});

app.post('/api/guardians', authMiddleware, async (req, res) => {
  const { name, relation = 'Guardian', status = 'offline' } = req.body;
  if (!name) return res.status(400).json({ error: 'Guardian name required' });

  try {
    const result = await runQuery(
      'INSERT INTO guardians (user_id, name, relation, status, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, String(name).trim(), relation, status, new Date().toISOString()]
    );
    res.json({ guardian: { id: result.id, user_id: req.user.id, name: String(name).trim(), relation, status } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add guardian' });
  }
});

app.get('/api/welfare', authMiddleware, async (req, res) => {
  const rows = await allQuery('SELECT * FROM welfare WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json({ welfare: rows });
});

app.post('/api/welfare/:id/answer', authMiddleware, async (req, res) => {
  const { id } = req.params;
  await runQuery('DELETE FROM welfare WHERE id = ? AND user_id = ?', [id, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/history', authMiddleware, async (req, res) => {
  const incidents = await allQuery('SELECT * FROM incidents WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);

  const rows = incidents.map((incident) => ({
    id: incident.incident_id,
    type: incident.type,
    priority: incident.priority[0].toUpperCase() + incident.priority.slice(1),
    responder: incident.responder_name || '—',
    status: incident.status === 'resolved' ? 'Resolved' : 'Open',
    date: new Date(incident.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  }));

  res.json({ history: rows.length ? rows : [] });
});

app.get('/api/moderation', authMiddleware, async (req, res) => {
  const rows = await allQuery('SELECT * FROM moderation ORDER BY created_at DESC');
  res.json({ moderation: rows.length ? rows : [] });
});

app.post('/api/moderation/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  await runQuery('UPDATE moderation SET status = ? WHERE id = ?', [status, id]);
  res.json({ ok: true });
});

app.get('/api/incidents/active', authMiddleware, async (req, res) => {
  const incident = await getQuery(
    'SELECT * FROM incidents WHERE user_id = ? AND status != "resolved" ORDER BY created_at DESC LIMIT 1',
    [req.user.id]
  );

  if (!incident) return res.json({ incident: null });

  res.json({
    incident: {
      id: incident.incident_id,
      type: incident.type,
      priority: incident.priority,
      createdAt: incident.created_at,
      status: incident.status,
      responder: { name: incident.responder_name || 'Rakesh Kumar', rating: 4.8 },
      eta: incident.eta || 6,
      chat: JSON.parse(incident.chat_json || '[]'),
      ai: JSON.parse(incident.ai_json || '[]'),
      timeline: JSON.parse(incident.timeline_json || '[]'),
      lat: incident.lat,
      lng: incident.lng,
    },
  });
});

app.post('/api/incidents', authMiddleware, async (req, res) => {
  const { type, priority = 'high', lat = 23.3441, lng = 85.3096 } = req.body;
  if (!type) return res.status(400).json({ error: 'Incident type is required' });

  const incidentId = `SOS-${Date.now().toString().slice(-4)}`;
  const createdAt = new Date().toISOString();
  const chat = [{ who: 'them', text: "This is Rakesh, a nearby responder. I'm on my way — stay where you are if it's safe." }];
  const ai = [{ who: 'ai', text: "I've logged your alert. Stay calm, keep your phone accessible, and follow any instructions from your assigned responder. I'm not a substitute for emergency services." }];
  const timeline = [
    { t: 'Just now', label: 'SOS created — location captured' },
    { t: 'Just now', label: 'Broadcast to nearby responders' },
    { t: 'Just now', label: 'Rakesh Kumar assigned · ETA 6 min' },
  ];

  await runQuery(
    `INSERT INTO incidents (user_id, incident_id, type, priority, status, lat, lng, responder_name, eta, chat_json, ai_json, timeline_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, incidentId, type, priority, 'assigned', lat, lng, 'Rakesh Kumar', 6, JSON.stringify(chat), JSON.stringify(ai), JSON.stringify(timeline), createdAt, createdAt]
  );

  const incident = {
    id: incidentId,
    type,
    priority,
    createdAt,
    status: 'assigned',
    responder: { name: 'Rakesh Kumar', rating: 4.8 },
    eta: 6,
    chat,
    ai,
    timeline,
    lat,
    lng,
  };

  io.emit('incident:updated', incident);
  return res.status(201).json({ incident });
});

app.post('/api/incidents/:id/chat', authMiddleware, async (req, res) => {
  const { text } = req.body;
  const { id } = req.params;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const incident = await getQuery('SELECT * FROM incidents WHERE incident_id = ? AND user_id = ?', [id, req.user.id]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const chat = JSON.parse(incident.chat_json || '[]');
  chat.push({ who: 'me', text });
  await runQuery('UPDATE incidents SET chat_json = ?, updated_at = ? WHERE incident_id = ?', [JSON.stringify(chat), new Date().toISOString(), id]);

  const reply = { who: 'them', text: 'Got it — 3 minutes out, stay on the line if you can.' };
  chat.push(reply);
  await runQuery('UPDATE incidents SET chat_json = ?, updated_at = ? WHERE incident_id = ?', [JSON.stringify(chat), new Date().toISOString(), id]);

  io.emit('incident:updated', { id, chat });
  res.json({ ok: true, chat });
});

app.post('/api/incidents/:id/ai', authMiddleware, async (req, res) => {
  const { text } = req.body;
  const { id } = req.params;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const incident = await getQuery('SELECT * FROM incidents WHERE incident_id = ? AND user_id = ?', [id, req.user.id]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const ai = JSON.parse(incident.ai_json || '[]');
  ai.push({ who: 'me', text });
  const fallback = [
    "I'm a demo assistant with a deterministic fallback — in production this connects to Gemini. For real emergencies always prioritize your human responder's instructions.",
    'If you can move to a safer, well-lit, populated area, do so while staying on the line with your responder.',
    'Try to keep your phone charged and visible — your live location is what responders use to reach you.',
  ];
  ai.push({ who: 'ai', text: fallback[Math.floor(Math.random() * fallback.length)] });
  await runQuery('UPDATE incidents SET ai_json = ?, updated_at = ? WHERE incident_id = ?', [JSON.stringify(ai), new Date().toISOString(), id]);

  io.emit('incident:updated', { id, ai });
  res.json({ ok: true, ai });
});

app.post('/api/incidents/:id/resolve', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const incident = await getQuery('SELECT * FROM incidents WHERE incident_id = ? AND user_id = ?', [id, req.user.id]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  await runQuery('UPDATE incidents SET status = ?, updated_at = ? WHERE incident_id = ?', ['resolved', new Date().toISOString(), id]);
  res.json({ ok: true });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  res.json({ nearby: 7, responders: 18, history: 4, flagged: 2 });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('join', (room) => socket.join(room));
});

async function startServer() {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log(`NearHelp backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize NearHelp:', error);
    process.exit(1);
  }
}

startServer();
