require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const bcrypt         = require('bcryptjs');
const { pool, initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Upload ────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'inspection-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

// ─── Role config ───────────────────────────────────────────────
const ROLES = {
  assembler:  { label: "Yig'uvchi", canAdd: true,  canClose: false, canAction: false, filter: 'own' },
  logistics:  { label: 'Logistika', canAdd: false, canClose: false, canAction: true,  filter: 'logistics' },
  production: { label: 'Production',canAdd: false, canClose: true,  canAction: true,  filter: 'all' },
  admin:      { label: 'Admin',     canAdd: true,  canClose: true,  canAction: true,  filter: 'all' },
};

// ─── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Login kerak' });
}

// ─── Visible records query ─────────────────────────────────────
function visibleWhere(user) {
  const f = ROLES[user.role]?.filter;
  if (f === 'own')       return `WHERE added_by = '${user.username}'`;
  if (f === 'logistics') return `WHERE dept = 'logistics'`;
  return '';
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username va parol kiriting' });
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
    const user = rows[0];
    const ok = await bcrypt.compare(password.trim(), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
    req.session.user = { id: user.id, username: user.username, name: user.full_name, role: user.role, line: user.line };
    res.json({ ok: true, user: { name: user.full_name, role: user.role, line: user.line, username: user.username, roleLabel: ROLES[user.role]?.label } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', auth, (req, res) => {
  const u = req.session.user;
  res.json({ ...u, roleLabel: ROLES[u.role]?.label, roleCfg: ROLES[u.role] });
});

// ══════════════════════════════════════════════════════════════
//  RECORDS ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/records', auth, async (req, res) => {
  try {
    const where = visibleWhere(req.session.user);
    const { rows } = await pool.query(`SELECT * FROM records ${where} ORDER BY created_at ASC`);
    res.json(rows.map(dbToClient));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/records/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM records WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    const r = rows[0];
    const where = visibleWhere(req.session.user);
    const { rows: vis } = await pool.query(`SELECT id FROM records ${where} AND id = $1`, [r.id]);
    if (!vis.length) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    res.json(dbToClient(r));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/records', auth, upload.fields([{ name: 'imgBefore', maxCount: 1 }, { name: 'imgAfter', maxCount: 1 }]), async (req, res) => {
  try {
    const u = req.session.user;
    if (!ROLES[u.role]?.canAdd) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { date, time, line, type, problem, station, auditor, action } = req.body;
    if (!station?.trim() || !problem?.trim()) return res.status(400).json({ error: 'Stansiya va muammo tavsifini kiriting' });
    const dept = (type === 'Material' || type === 'Machine') ? 'logistics' : 'production';
    const d = new Date(date);
    const fmt = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getFullYear()).slice(2)}`;
    const imgBefore = req.files?.imgBefore ? '/uploads/' + req.files.imgBefore[0].filename : '';
    const imgAfter  = req.files?.imgAfter  ? '/uploads/' + req.files.imgAfter[0].filename  : '';
    const { rows } = await pool.query(
      `INSERT INTO records (date,time,line,type,problem,station,auditor,action,status,added_by,dept,img_before,img_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12) RETURNING *`,
      [fmt, time || '', line, type, problem.trim(), station.trim(), auditor, action?.trim() || '—', u.username, dept, imgBefore, imgAfter]
    );
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/records/:id', auth, async (req, res) => {
  try {
    const u = req.session.user;
    const rc = ROLES[u.role];
    if (!rc?.canAction) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { status, action } = req.body;
    if (status === 'closed' && !rc.canClose) return res.status(403).json({ error: 'Yopish ruxsati yo\'q' });
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (status) { vals.push(status); sets.push(`status = $${vals.length}`); }
    if (action) { vals.push(action); sets.push(`action = $${vals.length}`); }
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE records SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/stats', auth, async (req, res) => {
  try {
    const where = visibleWhere(req.session.user);
    const { rows } = await pool.query(`SELECT line, status FROM records ${where}`);
    const byLine = {};
    let open = 0, closed = 0;
    rows.forEach(r => {
      byLine[r.line] = (byLine[r.line] || 0) + 1;
      if (r.status === 'open') open++;
      else if (r.status === 'closed') closed++;
    });
    res.json({ total: rows.length, open, closed, byLine });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN: User management
// ══════════════════════════════════════════════════════════════
app.get('/api/users', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  const { rows } = await pool.query('SELECT id,username,full_name,role,line,created_at FROM users ORDER BY id');
  res.json(rows);
});

app.post('/api/users', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { username, password, full_name, role, line } = req.body;
    if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Barcha maydonlarni kiriting' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username,password_hash,full_name,role,line) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,full_name,role,line',
      [username.toLowerCase(), hash, full_name, role, line || '']
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    console.error(e); res.status(500).json({ error: 'Server xatosi' });
  }
});

app.delete('/api/users/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  if (+req.params.id === req.session.user.id) return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ─── Helper ────────────────────────────────────────────────────
function dbToClient(r) {
  return {
    id:         r.id,
    date:       r.date,
    time:       r.time,
    line:       r.line,
    type:       r.type,
    problem:    r.problem,
    station:    r.station,
    auditor:    r.auditor,
    action:     r.action,
    status:     r.status,
    addedBy:    r.added_by,
    dept:       r.dept,
    imgBefore:  r.img_before,
    imgAfter:   r.img_after,
  };
}

// ─── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅  Running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌  DB init failed:', err.message);
  process.exit(1);
});
