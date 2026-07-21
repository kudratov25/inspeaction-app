require('dotenv').config();
const express        = require('express');
const http           = require('http');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const bcrypt         = require('bcryptjs');
const XLSX           = require('xlsx');
const nodemailer     = require('nodemailer');
const { pool, initDB } = require('./db');

// ─── Email transporter ─────────────────────────────────────────
const _mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.office365.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { ciphers: 'SSLv3' },
});

async function sendMail({ to, subject, html }) {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your@company.com') return;
  try {
    await _mailer.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (e) {
    console.error('Email xatosi:', e.message);
  }
}

async function notifyByEmail(type, data) {
  // type: 'new_record' | 'record_closed' | 'deadline' | 'new_audit'
  const { rows: users } = await pool.query('SELECT email, full_name FROM users WHERE email IS NOT NULL');
  if (!users.length) return;

  let subject = '', html = '';
  const appUrl = `http://${process.env.SMTP_HOST ? '64.226.102.253' : 'localhost'}:3000`;

  if (type === 'new_record') {
    subject = `🔴 Yangi muammo: ${data.line} — ${data.station}`;
    html = `<div style="font-family:Arial;padding:20px">
      <h2 style="color:#B71C1C">Yangi muammo qo'shildi</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;color:#666">Liniya:</td><td style="padding:6px;font-weight:bold">${data.line}</td></tr>
        <tr><td style="padding:6px;color:#666">Stansiya:</td><td style="padding:6px">${data.station}</td></tr>
        <tr><td style="padding:6px;color:#666">Muammo turi:</td><td style="padding:6px">${data.type}</td></tr>
        <tr><td style="padding:6px;color:#666">Tavsif:</td><td style="padding:6px">${data.problem}</td></tr>
        <tr><td style="padding:6px;color:#666">Auditor:</td><td style="padding:6px">${data.auditor}</td></tr>
        <tr><td style="padding:6px;color:#666">Muddat:</td><td style="padding:6px;color:#E65100">${data.deadline||'—'}</td></tr>
      </table>
      <a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#1565C0;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ilovani ochish</a>
    </div>`;
    for (const u of users) await sendMail({ to: u.email, subject, html });

  } else if (type === 'record_closed') {
    subject = `✅ Muammo yopildi: #${data.id} — ${data.line}`;
    html = `<div style="font-family:Arial;padding:20px">
      <h2 style="color:#2E7D32">Muammo yopildi ✓</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;color:#666">ID:</td><td style="padding:6px">#${data.id}</td></tr>
        <tr><td style="padding:6px;color:#666">Liniya:</td><td style="padding:6px;font-weight:bold">${data.line}</td></tr>
        <tr><td style="padding:6px;color:#666">Stansiya:</td><td style="padding:6px">${data.station}</td></tr>
        <tr><td style="padding:6px;color:#666">Yopdi:</td><td style="padding:6px">${data.closedBy}</td></tr>
        <tr><td style="padding:6px;color:#666">Harakat:</td><td style="padding:6px">${data.action||'—'}</td></tr>
      </table>
      <a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#2E7D32;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ilovani ochish</a>
    </div>`;
    for (const u of users) await sendMail({ to: u.email, subject, html });

  } else if (type === 'new_audit') {
    subject = `🔍 Yangi audit muammosi: ${data.workshop} — ${data.station}`;
    html = `<div style="font-family:Arial;padding:20px">
      <h2 style="color:#1565C0">Yangi audit muammosi</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;color:#666">Workshop:</td><td style="padding:6px;font-weight:bold">${data.workshop}</td></tr>
        <tr><td style="padding:6px;color:#666">Liniya:</td><td style="padding:6px">${data.line_body}</td></tr>
        <tr><td style="padding:6px;color:#666">Stansiya:</td><td style="padding:6px">${data.station}</td></tr>
        <tr><td style="padding:6px;color:#666">Tavsif:</td><td style="padding:6px">${data.description}</td></tr>
        <tr><td style="padding:6px;color:#666">Mas'ul:</td><td style="padding:6px">${data.responsible_person||'—'}</td></tr>
        <tr><td style="padding:6px;color:#666">Muddat:</td><td style="padding:6px;color:#E65100">${data.target_date||'—'}</td></tr>
      </table>
      <a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#1565C0;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ilovani ochish</a>
    </div>`;
    for (const u of users) await sendMail({ to: u.email, subject, html });
  }
}

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;
app.set('trust proxy', 1);

// ─── Upload ────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')),
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Faqat rasm yoki video yuklash mumkin'));
  }
});

// ─── Middleware ────────────────────────────────────────────────
const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'inspection-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(sessionMiddleware);

// ─── Role config ───────────────────────────────────────────────
const ROLES = {
  assembler:  { label: "Yig'uvchi", canAdd: true, canClose: true, canAction: true, filter: 'all' },
  logistics:  { label: 'Logistika', canAdd: true, canClose: true, canAction: true, filter: 'all' },
  production: { label: 'Production',canAdd: true, canClose: true, canAction: true, filter: 'all' },
  admin:      { label: 'Admin',     canAdd: true, canClose: true, canAction: true, filter: 'all' },
};

// ─── Rating: penalize a user for missing a deadline ─────────────
const RATING_PENALTY = 5;
async function penalizeRating(username, points = RATING_PENALTY) {
  if (!username) return;
  try {
    await pool.query(
      'UPDATE users SET rating = GREATEST(0, rating - $1) WHERE username = $2',
      [points, username]
    );
  } catch (e) { console.error('Rating penalty error:', e.message); }
}

// ─── Login rate limiting ───────────────────────────────────────
const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
  const ip     = req.ip || req.socket.remoteAddress;
  const now    = Date.now();
  const WINDOW = 15 * 60 * 1000;
  const MAX    = 10;
  let entry = loginAttempts.get(ip) || { count: 0, resetAt: now + WINDOW };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + WINDOW; }
  if (entry.count >= MAX) {
    const wait = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({ error: `Juda ko'p urinish. ${wait} daqiqadan so'ng qayta urinib ko'ring` });
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  next();
}

// ─── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Login kerak' });
}

// ─── Visible records filter (parameterized) ───────────────────
function visibleWhere(user) {
  if (user.role === 'admin') return { clause: 'WHERE 1=1', params: [] };
  if (user.line)             return { clause: 'WHERE line = $1', params: [user.line] };
  return { clause: 'WHERE 1=1', params: [] };
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username va parol kiriting' });
    const input = username.trim().toLowerCase();
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR LOWER(email) = $1', [input]
    );
    if (!rows.length) return res.status(401).json({ error: 'Username/email yoki parol noto\'g\'ri' });
    const user = rows[0];
    const ok = await bcrypt.compare(password.trim(), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
    loginAttempts.delete(req.ip || req.socket.remoteAddress);
    req.session.user = { id: user.id, username: user.username, name: user.full_name, role: user.role, line: user.line, position: user.position || '', email: user.email || null };
    req.session.save(err => {
      if (err) { console.error('Session save error:', err); return res.status(500).json({ error: 'Session xatosi' }); }
      res.json({ ok: true, user: { name: user.full_name, role: user.role, line: user.line, username: user.username, roleLabel: ROLES[user.role]?.label, position: user.position || '', email: user.email || null } });
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

app.get('/api/me', auth, async (req, res) => {
  const u = req.session.user;
  const { rows } = await pool.query('SELECT rating FROM users WHERE username = $1', [u.username]);
  res.json({ ...u, rating: rows[0]?.rating ?? 100, roleLabel: ROLES[u.role]?.label, roleCfg: ROLES[u.role] });
});

app.post('/api/me/password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Barcha maydonlarni kiriting' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Yangi parol kamida 4 ta belgi bo\'lishi kerak' });
    const bcrypt = require('bcryptjs');
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    const ok = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Joriy parol noto\'g\'ri' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/me/email', auth, async (req, res) => {
  try {
    const { email } = req.body;
    const val = email ? email.trim().toLowerCase() : null;
    if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return res.status(400).json({ error: 'Email formati noto\'g\'ri' });
    await pool.query('UPDATE users SET email=$1 WHERE id=$2', [val, req.session.user.id]);
    req.session.user.email = val;
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/config', (req, res) => {
  res.json({ demo: process.env.NODE_ENV !== 'production' });
});

app.get('/api/assemblers', auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT full_name FROM users ORDER BY full_name");
    res.json(rows.map(r => r.full_name));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/notify-targets', auth, async (req, res) => {
  try {
    const line = req.query.line || '';
    const u = req.session.user;
    const { rows } = await pool.query(
      `SELECT full_name, position FROM users WHERE username != $1
       AND (role = 'admin'
            OR (line = $2 AND (
              position ILIKE '%boshlig%' OR position ILIKE '%direktor%' OR
              position ILIKE '%menejer%' OR position ILIKE '%mas%ul%' OR
              position ILIKE '%muhandis%' OR position ILIKE '%texnolog%'
            )))
       ORDER BY full_name`,
      [u.username, line]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Xato' }); }
});

// ══════════════════════════════════════════════════════════════
//  RECORDS ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/records', auth, async (req, res) => {
  try {
    // scope=all → barcha liniyalar (home dashboard uchun), aks holda faqat o'z liniyasi
    const useAll = req.query.scope === 'all';
    const { clause, params } = useAll ? { clause: 'WHERE 1=1', params: [] } : visibleWhere(req.session.user);
    let query = `SELECT * FROM records ${clause}`;
    const qParams = [...params];
    if (req.query.search) {
      qParams.push(`%${req.query.search}%`);
      query += ` AND (problem ILIKE $${qParams.length} OR station ILIKE $${qParams.length} OR auditor ILIKE $${qParams.length})`;
    }
    query += ' ORDER BY created_at ASC';
    const { rows } = await pool.query(query, qParams);
    res.json(rows.map(dbToClient));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/records/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM records WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/records', auth, upload.fields([
  { name: 'imgBefore',   maxCount: 1  },
  { name: 'imgAfter',    maxCount: 1  },
  { name: 'mediaBefore', maxCount: 20 },
  { name: 'mediaAfter',  maxCount: 20 },
]), async (req, res) => {
  try {
    const u = req.session.user;
    if (!ROLES[u.role]?.canAdd) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { date, time, line, type, problem, station, auditor, action, deadline, dept: deptParam } = req.body;
    if (!station?.trim() || !problem?.trim()) return res.status(400).json({ error: 'Stansiya va muammo tavsifini kiriting' });
    const dept = deptParam?.trim() || 'production';
    const d = new Date(date);
    const fmt = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getFullYear()).slice(2)}`;
    // Build media_files array from new multi-upload fields
    const mediaFiles = [];
    (req.files?.mediaBefore || []).forEach(f => mediaFiles.push({ url: '/uploads/' + f.filename, type: f.mimetype.startsWith('video/') ? 'video' : 'image', label: 'before' }));
    (req.files?.mediaAfter  || []).forEach(f => mediaFiles.push({ url: '/uploads/' + f.filename, type: f.mimetype.startsWith('video/') ? 'video' : 'image', label: 'after'  }));
    // Backward-compat single fields
    if (req.files?.imgBefore) mediaFiles.unshift({ url: '/uploads/' + req.files.imgBefore[0].filename, type: 'image', label: 'before' });
    if (req.files?.imgAfter)  mediaFiles.push(   { url: '/uploads/' + req.files.imgAfter[0].filename,  type: 'image', label: 'after'  });
    const imgBefore = mediaFiles.find(f => f.label === 'before' && f.type === 'image')?.url || '';
    const imgAfter  = mediaFiles.find(f => f.label === 'after'  && f.type === 'image')?.url || '';
    const { rows } = await pool.query(
      `INSERT INTO records (date,time,line,type,problem,station,auditor,action,status,added_by,dept,img_before,img_after,deadline,media_files)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14) RETURNING *`,
      [fmt, time || '', line, type, problem.trim(), station.trim(), auditor, action?.trim() || '—', u.username, dept, imgBefore, imgAfter, deadline || null, JSON.stringify(mediaFiles)]
    );
    const rec = rows[0];
    // Notify responsible users: same line OR matching dept role
    try {
      const { rows: targets } = await pool.query(
        `SELECT DISTINCT username, full_name FROM users WHERE username != $1
         AND (role = 'admin'
              OR (line = $2 AND (
                position ILIKE '%boshlig%' OR position ILIKE '%direktor%' OR
                position ILIKE '%menejer%' OR position ILIKE '%mas%ul%' OR
                position ILIKE '%muhandis%' OR position ILIKE '%texnolog%'
              )))`,
        [u.username, line]
      );
      const title = `Yangi muammo: ${line} · ${station.trim()}`;
      const body  = `[${dept === 'logistics' ? 'Logistika' : 'Ishlab chiqarish'}] ${problem.trim().substring(0, 90)}`;
      for (const target of targets) {
        await pool.query(
          'INSERT INTO user_notifications (to_username, record_id, title, body) VALUES ($1,$2,$3,$4)',
          [target.username, rec.id, title, body]
        );
      }
    } catch (ne) { console.error('Notification error:', ne.message); }
    // Email bildirishnoma
    notifyByEmail('new_record', { line, station: station.trim(), type, problem: problem.trim(), auditor, deadline });
    res.json(dbToClient(rec));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/records/:id', auth, async (req, res) => {
  try {
    const u = req.session.user;
    const rc = ROLES[u.role];
    if (!rc?.canAction) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { status, action, deadline, is_recurring } = req.body;
    let existing = null;
    if (status === 'closed') {
      const ex = await pool.query('SELECT action, deadline, added_by, rating_penalized FROM records WHERE id = $1', [req.params.id]);
      if (!ex.rows.length) return res.status(404).json({ error: 'Topilmadi' });
      existing = ex.rows[0];
      const finalAction = action?.trim() || existing.action;
      if (!finalAction || finalAction === '—' || !finalAction.trim()) {
        return res.status(400).json({ error: 'Yopish uchun harakat rejasi kiritilishi shart' });
      }
    }
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (status)                     { vals.push(status);        sets.push(`status = $${vals.length}`); }
    if (action !== undefined)       { vals.push(action || '—'); sets.push(`action = $${vals.length}`); }
    if (deadline !== undefined)     { vals.push(deadline || null); sets.push(`deadline = $${vals.length}`); }
    if (is_recurring !== undefined) { vals.push(is_recurring);  sets.push(`is_recurring = $${vals.length}`); }
    if (status === 'closed')        { vals.push(u.username);    sets.push(`resolved_by = $${vals.length}`); }
    // Closed after its deadline had already passed → the responsible user's rating takes a hit
    const closedLate = status === 'closed' && existing?.deadline && !existing.rating_penalized
      && String(existing.deadline).slice(0, 10) < new Date().toISOString().slice(0, 10);
    if (closedLate) { vals.push(true); sets.push(`rating_penalized = $${vals.length}`); }
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE records SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    if (closedLate) await penalizeRating(existing.added_by);
    if (status === 'closed') {
      const r = rows[0];
      notifyByEmail('record_closed', { id: r.id, line: r.line, station: r.station, closedBy: u.full_name, action: r.action });
    }
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/records/:id/media', auth, upload.fields([{ name: 'mediaClose', maxCount: 10 }]), async (req, res) => {
  try {
    if (!ROLES[req.session.user.role]?.canAction) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const newFiles = (req.files?.mediaClose || []).map(f => ({
      url: '/uploads/' + f.filename,
      type: f.mimetype.startsWith('video/') ? 'video' : 'image',
      label: 'after'
    }));
    if (!newFiles.length) return res.json({ ok: true });
    const ex = await pool.query('SELECT media_files FROM records WHERE id = $1', [req.params.id]);
    if (!ex.rows.length) return res.status(404).json({ error: 'Topilmadi' });
    const existing = (() => { try { return JSON.parse(ex.rows[0].media_files || '[]'); } catch { return []; } })();
    await pool.query('UPDATE records SET media_files = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify([...existing, ...newFiles]), req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.delete('/api/records/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { rowCount } = await pool.query('DELETE FROM records WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/stats', auth, async (req, res) => {
  try {
    const useAll = req.query.scope === 'all';
    const { clause, params } = useAll ? { clause: 'WHERE 1=1', params: [] } : visibleWhere(req.session.user);
    const { rows } = await pool.query(`SELECT line, status, dept, is_recurring, deadline FROM records ${clause}`, params);
    const byLine = {}, byDept = {}, byLineDetail = {};
    let open = 0, closed = 0, inprogress = 0, risky = 0, overdue = 0, recurring = 0;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    rows.forEach(r => {
      byLine[r.line] = (byLine[r.line] || 0) + 1;
      byDept[r.dept] = (byDept[r.dept] || 0) + 1;
      if (!byLineDetail[r.line]) byLineDetail[r.line] = { total: 0, open: 0, inprogress: 0, closed: 0 };
      byLineDetail[r.line].total++;
      byLineDetail[r.line][r.status] = (byLineDetail[r.line][r.status] || 0) + 1;
      if (r.status === 'open')        open++;
      else if (r.status === 'closed') closed++;
      else if (r.status === 'inprogress') inprogress++;
      if (r.is_recurring) recurring++;
      if (r.deadline && r.status !== 'closed') {
        const dl = new Date(String(r.deadline).split('T')[0] + 'T00:00:00');
        const days = Math.round((dl - now) / 86400000);
        if (days < 0) overdue++;
        else if (days <= 2) risky++;
      }
    });
    res.json({ total: rows.length, open, closed, inprogress, risky, overdue, recurring, byLine, byDept, byLineDetail });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN: User management
// ══════════════════════════════════════════════════════════════
app.get('/api/users', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  const { rows } = await pool.query('SELECT id,username,full_name,role,line,email,rating,created_at FROM users ORDER BY id');
  res.json(rows);
});

app.post('/api/users', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { username, password, full_name, role, line, email } = req.body;
    if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Barcha maydonlarni kiriting' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username,password_hash,full_name,role,line,email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,username,full_name,role,line,email',
      [username.toLowerCase(), hash, full_name, role, line || '', email || null]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu username yoki email allaqachon mavjud' });
    console.error(e); res.status(500).json({ error: 'Server xatosi' });
  }
});

app.patch('/api/users/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { full_name, role, line, password, email } = req.body;
    if (!full_name || !role) return res.status(400).json({ error: 'Ism va rol kiritilishi shart' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    const sets = ['full_name=$1','role=$2','line=$3','email=$4'];
    const vals = [full_name, role, line || '', email || null];
    if (password && password.trim()) {
      vals.push(await bcrypt.hash(password.trim(), 10));
      sets.push(`password_hash=$${vals.length}`);
    }
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,username,full_name,role,line,email`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.delete('/api/users/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  if (+req.params.id === req.session.user.id) return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  Rating / ranking
// ══════════════════════════════════════════════════════════════
app.get('/api/ranking', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT username, full_name, role, line, rating FROM users ORDER BY rating DESC, full_name ASC'
    );
    res.json(rows.map((r, i) => ({ rank: i + 1, ...r })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/ranking/history', auth, async (req, res) => {
  try {
    let month = req.query.month;
    if (!month) {
      const { rows: last } = await pool.query('SELECT month FROM rating_history ORDER BY month DESC LIMIT 1');
      month = last[0]?.month || null;
    }
    if (!month) return res.json({ month: null, rows: [] });
    const { rows } = await pool.query(
      'SELECT rank, username, full_name, role, line, rating FROM rating_history WHERE month = $1 ORDER BY rank ASC',
      [month]
    );
    res.json({ month, rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

const RANKING_I18N = {
  uz: { title: 'Reyting', headers: ['O\'rin', 'F.I.Sh', 'Foydalanuvchi', 'Rol', 'Liniya', 'Reyting'] },
  ru: { title: 'Рейтинг', headers: ['Место', 'Ф.И.О', 'Логин', 'Роль', 'Линия', 'Рейтинг'] },
  en: { title: 'Ranking', headers: ['Rank', 'Full name', 'Username', 'Role', 'Line', 'Rating'] },
};

app.get('/api/ranking/export', auth, async (req, res) => {
  try {
    const lang = ['uz', 'ru', 'en'].includes(req.query.lang) ? req.query.lang : 'uz';
    const tr = RANKING_I18N[lang];
    const { rows } = await pool.query(
      'SELECT username, full_name, role, line, rating FROM users ORDER BY rating DESC, full_name ASC'
    );
    const data = [
      tr.headers,
      ...rows.map((r, i) => [i + 1, r.full_name, r.username, ROLES[r.role]?.label || r.role, r.line || '—', r.rating]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [8, 26, 16, 14, 14, 10].map(w => ({ wch: w }));
    tr.headers.forEach((_, ci) => {
      const cell = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (!ws[cell]) return;
      ws[cell].s = {
        font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        fill:      { patternType: 'solid', fgColor: { rgb: '1565C0' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border:    { top:{style:'thin',color:{rgb:'CCCCCC'}}, bottom:{style:'thin',color:{rgb:'CCCCCC'}}, left:{style:'thin',color:{rgb:'CCCCCC'}}, right:{style:'thin',color:{rgb:'CCCCCC'}} },
      };
    });
    rows.forEach((r, ri) => {
      const rowIdx = ri + 1;
      const medalBg = ri === 0 ? 'FFF9C4' : ri === 1 ? 'F1F1F1' : ri === 2 ? 'FFE0B2' : (ri % 2 === 0 ? 'FFFFFF' : 'F5F8FF');
      for (let ci = 0; ci < tr.headers.length; ci++) {
        const cell = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
        if (!ws[cell]) ws[cell] = { t: 's', v: '' };
        ws[cell].s = {
          fill:      { patternType: 'solid', fgColor: { rgb: medalBg } },
          font:      { sz: 10, color: { rgb: '1A2535' }, bold: ci === 0 },
          alignment: { vertical: 'middle', horizontal: ci === 0 || ci === 5 ? 'center' : 'left' },
          border:    { top:{style:'thin',color:{rgb:'E0E7EF'}}, bottom:{style:'thin',color:{rgb:'E0E7EF'}}, left:{style:'thin',color:{rgb:'E0E7EF'}}, right:{style:'thin',color:{rgb:'E0E7EF'}} },
        };
      }
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: tr.headers.length - 1 } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tr.title.substring(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    res.setHeader('Content-Disposition', `attachment; filename="reyting-${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export xatosi: ' + e.message }); }
});

// ─── Helper ────────────────────────────────────────────────────
function dbToClient(r) {
  const deadline = r.deadline
    ? (r.deadline instanceof Date ? r.deadline.toISOString() : String(r.deadline)).split('T')[0]
    : null;
  let daysLeft = null, isRisky = false, isOverdue = false;
  if (deadline && r.status !== 'closed') {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const dl  = new Date(deadline + 'T00:00:00');
    daysLeft  = Math.round((dl - now) / 86400000);
    isOverdue = daysLeft < 0;
    isRisky   = !isOverdue && daysLeft <= 2;
  }
  return {
    id:          r.id,
    date:        r.date,
    time:        r.time,
    line:        r.line,
    type:        r.type,
    problem:     r.problem,
    station:     r.station,
    auditor:     r.auditor,
    action:      r.action,
    status:      r.status,
    addedBy:     r.added_by,
    dept:        r.dept,
    imgBefore:   r.img_before,
    imgAfter:    r.img_after,
    mediaFiles:  (() => { try { return JSON.parse(r.media_files || '[]'); } catch { return []; } })(),
    deadline,
    isRecurring: r.is_recurring || false,
    resolvedBy:  r.resolved_by  || null,
    daysLeft,
    isRisky,
    isOverdue,
  };
}

// ─── Export translations ────────────────────────────────────────
const EXPORT_I18N = {
  uz: {
    title: 'Tekshiruv Nazorat — Muammolar Ro\'yxati',
    generated: 'Yaratildi',
    headers: ['#', 'Sana', 'Vaqt', 'Liniya', 'Tur', 'Stansiya', 'Auditor', 'Muammo', 'Harakat rejasi', 'Status', 'Muddat', 'Qo\'shgan'],
    status: { open: 'Ochiq', inprogress: 'Jarayonda', closed: 'Yopilgan' },
    total: 'Jami',
  },
  ru: {
    title: 'Система контроля — Список проблем',
    generated: 'Создано',
    headers: ['#', 'Дата', 'Время', 'Линия', 'Тип', 'Станция', 'Аудитор', 'Проблема', 'План действий', 'Статус', 'Срок', 'Добавил'],
    status: { open: 'Открыто', inprogress: 'В процессе', closed: 'Закрыто' },
    total: 'Итого',
  },
  en: {
    title: 'Inspection Control — Issue List',
    generated: 'Generated',
    headers: ['#', 'Date', 'Time', 'Line', 'Type', 'Station', 'Auditor', 'Problem', 'Action Plan', 'Status', 'Deadline', 'Added By'],
    status: { open: 'Open', inprogress: 'In Progress', closed: 'Closed' },
    total: 'Total',
  },
};

// ─── Export ─────────────────────────────────────────────────────
app.get('/api/export', auth, async (req, res) => {
  try {
    const lang     = ['uz','ru','en'].includes(req.query.lang) ? req.query.lang : 'uz';
    const filter   = req.query.filter || 'all';
    const tr       = EXPORT_I18N[lang];
    const { clause, params } = visibleWhere(req.session.user);
    let query = `SELECT * FROM records ${clause}`;
    const qParams = [...params];
    const today = new Date().toISOString().split('T')[0];
    const twoDays = new Date(Date.now() + 2*86400000).toISOString().split('T')[0];
    if (filter === 'open')       { query += ` AND status='open'`; }
    else if (filter === 'inprogress') { query += ` AND status='inprogress'`; }
    else if (filter === 'closed')     { query += ` AND status='closed'`; }
    else if (filter === 'risky')      { query += ` AND status!='closed' AND deadline IS NOT NULL AND deadline > '${today}' AND deadline <= '${twoDays}'`; }
    else if (filter === 'overdue')    { query += ` AND status!='closed' AND deadline IS NOT NULL AND deadline < '${today}'`; }
    else if (filter === 'recurring')  { query += ` AND is_recurring=true`; }
    else if (['Trim','Chassis','Final'].includes(filter)) { qParams.push(filter); query += ` AND line=$${qParams.length}`; }
    query += ' ORDER BY created_at ASC';
    const { rows } = await pool.query(query, qParams);
    const now = new Date().toLocaleDateString('uz-UZ');

    if (true) {
      const statusColors = { open: 'FFD54F', inprogress: '90CAF9', closed: 'A5D6A7' };
      const data = [
        tr.headers,
        ...rows.map((r, i) => [
          i+1, r.date, r.time, r.line, r.type, r.station, r.auditor,
          r.problem, r.action, tr.status[r.status]||r.status,
          r.deadline||'—', r.added_by,
        ])
      ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [4,9,6,8,10,10,12,38,38,12,10,12].map(w => ({ wch: w }));
      // header row: bold + blue bg + white font
      tr.headers.forEach((_, ci) => {
        const cell = XLSX.utils.encode_cell({ r: 0, c: ci });
        if (!ws[cell]) return;
        ws[cell].s = {
          font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
          fill:      { patternType: 'solid', fgColor: { rgb: '1565C0' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border:    { top:{style:'thin',color:{rgb:'CCCCCC'}}, bottom:{style:'thin',color:{rgb:'CCCCCC'}}, left:{style:'thin',color:{rgb:'CCCCCC'}}, right:{style:'thin',color:{rgb:'CCCCCC'}} },
        };
      });
      // data rows: alternating bg + status color on col 9 + borders
      rows.forEach((r, ri) => {
        const rowIdx = ri + 1;
        const bg = ri % 2 === 0 ? 'FFFFFF' : 'F5F8FF';
        for (let ci = 0; ci < tr.headers.length; ci++) {
          const cell = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
          if (!ws[cell]) ws[cell] = { t: 's', v: '' };
          const isStatus = ci === 9;
          ws[cell].s = {
            fill:      { patternType: 'solid', fgColor: { rgb: isStatus ? (statusColors[r.status]||bg) : bg } },
            font:      { sz: 10, color: { rgb: '1A2535' } },
            alignment: { vertical: 'top', wrapText: true, horizontal: ci <= 1 || ci === 9 ? 'center' : 'left' },
            border:    { top:{style:'thin',color:{rgb:'E0E7EF'}}, bottom:{style:'thin',color:{rgb:'E0E7EF'}}, left:{style:'thin',color:{rgb:'E0E7EF'}}, right:{style:'thin',color:{rgb:'E0E7EF'}} },
          };
        }
      });
      // summary row
      const sumRow = rows.length + 1;
      ws[XLSX.utils.encode_cell({r:sumRow,c:0})] = { t:'s', v:`${tr.total}: ${rows.length}`, s:{ font:{bold:true,sz:11}, fill:{patternType:'solid',fgColor:{rgb:'E3F2FD'}} } };
      ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:sumRow,c:tr.headers.length-1}});
      ws['!rows'] = [{ hpt: 22 }, ...rows.map(() => ({ hpt: 40 }))];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, tr.title.substring(0, 31));
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
      res.setHeader('Content-Disposition', `attachment; filename="tekshiruv-${lang}-${Date.now()}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export xatosi: '+e.message }); }
});

// ─── Inbox ─────────────────────────────────────────────────────
app.get('/api/inbox', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, r.line, r.station, r.type, r.status, r.deadline
       FROM user_notifications n
       LEFT JOIN records r ON r.id = n.record_id
       WHERE n.to_username = $1
       ORDER BY n.created_at DESC LIMIT 50`,
      [req.session.user.username]
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/inbox/read-all', auth, async (req, res) => {
  try {
    await pool.query('UPDATE user_notifications SET is_read=true WHERE to_username=$1', [req.session.user.username]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/inbox/:id/read', auth, async (req, res) => {
  try {
    await pool.query('UPDATE user_notifications SET is_read=true WHERE id=$1 AND to_username=$2', [req.params.id, req.session.user.username]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server xatosi' }); }
});

// ─── Notifications ─────────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const { clause, params } = visibleWhere(req.session.user);
    const twoDays = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const { rows } = await pool.query(
      `SELECT * FROM records ${clause} AND status != 'closed' AND deadline IS NOT NULL AND deadline <= $${params.length + 1} ORDER BY deadline ASC`,
      [...params, twoDays]
    );
    res.json(rows.map(dbToClient));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ─── Process Audit ─────────────────────────────────────────────
function auditStatus(r) {
  if (r.status === 'closed') return 'closed';
  if (r.target_date) {
    const td = r.target_date instanceof Date ? r.target_date.toISOString().slice(0,10) : String(r.target_date).slice(0,10);
    if (td < new Date().toISOString().slice(0,10)) return 'overdue';
  }
  return r.status;
}
function auditToClient(r) {
  return {
    id: r.id,
    questionCode: r.question_code || '',
    workshop: r.workshop,
    lineBody: r.line_body,
    station: r.station,
    problemCategory: r.problem_category || '',
    problemLevel: r.problem_level || 'Medium',
    description: r.description,
    discoveryDept: r.discovery_dept || '',
    responsiblePerson: r.responsible_person || '',
    targetDate: r.target_date ? (r.target_date instanceof Date ? r.target_date.toISOString().slice(0,10) : String(r.target_date).slice(0,10)) : null,
    status: auditStatus(r),
    progress: r.progress || '',
    correctiveAction: r.corrective_action || '',
    mediaFiles: (() => { try { return JSON.parse(r.media_files || '[]'); } catch { return []; } })(),
    addedBy: r.added_by,
    closedBy: r.closed_by || '',
    createdAt: r.created_at,
  };
}

app.get('/api/audit/export', auth, async (req, res) => {
  try {
    const { workshop, line, station } = req.query;
    const conds = ['1=1']; const params = [];
    if (workshop) { params.push(`%${workshop}%`); conds.push(`workshop ILIKE $${params.length}`); }
    if (line)     { params.push(`%${line}%`);     conds.push(`line_body ILIKE $${params.length}`); }
    if (station)  { params.push(`%${station}%`);  conds.push(`station ILIKE $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM audit_issues WHERE ${conds.join(' AND ')} ORDER BY created_at ASC`, params
    );

    // BYD Template 1: 工艺纪律检查问题清单
    const STATUS_UZ = { open:'Ochiq', processing:'Jarayonda', pending_verification:'Tekshirishda', closed:'Yopilgan', overdue:'Kechikkan' };
    const LEVEL_UZ  = { Low:'Past', Medium:"O'rta", High:'Yuqori', Critical:'Kritik' };
    const COLS = 13;

    const title1 = Array(COLS).fill(''); title1[0] = '工艺纪律检查问题清单';
    const title2 = Array(COLS).fill(''); title2[0] = "Jarayon intizomini tekshirish bo'yicha savollar ro'yxati";
    const headers = [
      '序号NO.\nNo.',
      '检查日期\nTekshirish sanasi',
      '工序/岗位/设备/设施\nJarayon/lavozim/uskunalar',
      '问题描述\nMuammo tavsifi',
      '问题分级\nMuammo Tasnifi',
      '问题状态\nMuammo holati',
      '整改期限\nTuzatish Oxirgi muddat',
      '责任人\nMa\'sul',
      '整改措施\nTuzatish choralari',
      '整改日期\nTuzatish sanasi',
      '措施状态\nO\'lchov holati',
      '问题关闭状态\nMuammo',
      '备注\nIzoh'
    ];

    const dataRows = rows.map((r, i) => {
      const st = auditStatus(r);
      const closeDate = r.status === 'closed' && r.updated_at ? String(r.updated_at).slice(0,10) : '';
      return [
        i + 1,
        r.created_at ? r.created_at.toISOString().slice(0,10) : '',
        [r.workshop, r.line_body, r.station].filter(Boolean).join(' / '),
        r.description || '',
        LEVEL_UZ[r.problem_level] || r.problem_level || '',
        STATUS_UZ[st] || st,
        r.target_date ? String(r.target_date).slice(0,10) : '',
        r.responsible_person || '',
        r.corrective_action || '',
        closeDate,
        r.progress || '',
        r.status === 'closed' ? 'Yopilgan ✓' : '',
        '',
      ];
    });
    while (dataRows.length < 10) dataRows.push(Array(COLS).fill(''));

    const signRow = Array(COLS).fill('');
    signRow[0] = '审核人员签字 / Auditor imzosi:';
    signRow[10] = '使用部门：制造工程部';
    const formRow = Array(COLS).fill('');
    formRow[10] = 'Texnologiyalar departamenti';
    formRow[11] = '表单编号：';
    formRow[12] = 'FM-WI-C04-UZ-02-11-01A';

    const aoa = [title1, title2, headers, ...dataRows, signRow, formRow];
    const ws  = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:COLS-1} },
      { s:{r:1,c:0}, e:{r:1,c:COLS-1} },
    ];
    ws['!cols'] = [
      {wch:6},{wch:14},{wch:22},{wch:28},{wch:14},{wch:14},
      {wch:14},{wch:16},{wch:28},{wch:14},{wch:16},{wch:14},{wch:12}
    ];
    const rowH = [{hpt:32},{hpt:20},{hpt:44}];
    dataRows.forEach(()=>rowH.push({hpt:28}));
    rowH.push({hpt:24},{hpt:18});
    ws['!rows'] = rowH;
    for (let c = 0; c < COLS; c++) {
      const ref = XLSX.utils.encode_cell({r:2,c});
      if (!ws[ref]) ws[ref] = {v:headers[c],t:'s'};
      ws[ref].s = { alignment:{wrapText:true,vertical:'center',horizontal:'center'}, font:{bold:true} };
    }
    ['A1','A2'].forEach((ref,i) => {
      if (!ws[ref]) ws[ref] = {};
      ws[ref].s = { alignment:{horizontal:'center',vertical:'center'}, font:{bold:true,sz:i===0?14:12} };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Muammolar royxati');
    const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx', cellStyles:true });
    res.setHeader('Content-Disposition', 'attachment; filename="Jarayon_Intizomi_Muammolar.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// BYD Template 2: 工艺纪律检查记录表 (blank inspection form)
app.get('/api/audit/form-template', auth, (req, res) => {
  try {
    const C = 7;
    const fill = (n=C) => Array(n).fill('');
    const t1 = fill(); t1[0] = '工艺纪律检查记录表';
    const t2 = fill(); t2[0] = 'Jarayon intizomi auditi yozuvi shakli';
    const i1 = ['Audit Sanasi (检查日期):', '', '', 'Audit Departmenti (审核部门):', '', '', ''];
    const i2 = ['Audit Liniyasi (生产线):', '', '', "Audit Posti (岗位):", '', '', ''];
    const i3 = ["Kalit jarayon yoki yo'q Y/N (关键工序):", '', 'Y  /  N', '', '', '', ''];
    const th = ['要素\nElementlar','序号\nNo.','检查内容\nTarkibni tekshirish','记录\nYozuv','NG','OK','NA'];
    const s1rows = [
      ['工艺文件\nJarayon\nhujjatlari', 1, "是否有工艺参数、操作规程、材料、工具完整有效的作业指导书\nJarayon hujjatidagi ma'lumotlar to'liq va amalda bor?",'','','',''],
      ['', 2, "现场使用的文件是否受控？\nJoyda ishlatilayotgan hujjatlar nazorat qilinadimi?",'','','',''],
      ['', 3, "控制计划、作业指导书、工艺参数、材料、工具是否一致\nNazarat rejasi, ko'rsatmalar va jarayon parametrlari mos keladimi?",'','','',''],
    ];
    const s2rows = [
      ['现场执行\nOn-site\nexecution', 1, "现场操作人员是否具备岗位任职资格要求\nAmaliyotchilar lavozim malaka talablarini qanoatlantiradimi?",'','','',''],
      ['', 2, "现场操作步骤与作业指导书的描述是否一致\nOperatsiya bosqichlari ko'rsatmalar bilan mos keladimi?",'','','',''],
      ['', 3, "工艺参数、设备、工具点检是否按要求进行\nJarayon parametrlari va uskunalar talabga muvofiq tekshirilmoqdami?",'','','',''],
    ];
    const s3rows = [
      ['现场相关记录\nSaytga tegishli\nyozuvlar', 1, "过程记录、检验记录、参数记录等是否充整、准确\nJarayon, tekshiruv va parametr yozuvlari to'liq va aniqmi?",'','','',''],
      ['', 2, "对工作中发生的质量问题是否有对策及对策是否有效\nSifat muammolariga qarshi choralar bormi va samaralimi?",'','','',''],
      ['', 3, "质量问题发生部位的相关部门是否在进行对策\nSifat muammosi joyi tomonidan qarshi choralar qo'llanilmoqdami?",'','','',''],
    ];
    const sigH = ['', '作业员 Operator', '', '', '审员 Auditor', '', ''];
    const sigR = ['', '质量 Sifat', '生产 Master', '', '制造工程部 Texnologiyalar departamenti', '', ''];
    const sigL = ['', '_______________', '_______________', '', '_______________', '', ''];
    const nt   = ["注：N/A — tegishli emas, ko'rib chiqish paytida OK, NG va N/A ko'rsatiladi", ...fill(C-1)];
    const fr   = [...fill(5), '表单编号：', 'FM-WI-C04-UZ-02-11-02A'];

    // row indices: 0=t1,1=t2,2=gap,3=i1,4=i2,5=i3,6=gap,7=th,8-10=s1,11-13=s2,14-16=s3,17=gap,18=sigH,19=sigR,20=sigL,21=nt,22=fr
    const aoa = [t1,t2,fill(),i1,i2,i3,fill(),th,...s1rows,...s2rows,...s3rows,fill(),sigH,sigR,sigL,nt,fr];
    const ws2 = XLSX.utils.aoa_to_sheet(aoa);
    ws2['!merges'] = [
      {s:{r:0,c:0},e:{r:0,c:C-1}},{s:{r:1,c:0},e:{r:1,c:C-1}},
      {s:{r:3,c:0},e:{r:3,c:2}},{s:{r:3,c:3},e:{r:3,c:6}},
      {s:{r:4,c:0},e:{r:4,c:2}},{s:{r:4,c:3},e:{r:4,c:6}},
      {s:{r:5,c:0},e:{r:5,c:6}},
      {s:{r:8,c:0},e:{r:10,c:0}},
      {s:{r:11,c:0},e:{r:13,c:0}},
      {s:{r:14,c:0},e:{r:16,c:0}},
      {s:{r:21,c:0},e:{r:21,c:5}},
      {s:{r:22,c:0},e:{r:22,c:4}},
    ];
    ws2['!cols'] = [{wch:18},{wch:6},{wch:52},{wch:22},{wch:6},{wch:6},{wch:6}];
    ws2['!rows'] = [
      {hpt:30},{hpt:18},{hpt:8},{hpt:22},{hpt:22},{hpt:22},{hpt:8},
      {hpt:44},
      {hpt:60},{hpt:60},{hpt:60},
      {hpt:60},{hpt:60},{hpt:60},
      {hpt:60},{hpt:60},{hpt:60},
      {hpt:10},{hpt:22},{hpt:22},{hpt:26},{hpt:22},{hpt:18}
    ];
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws2, 'Tekshiruv varagi');
    const buf2 = XLSX.write(wb2, { type:'buffer', bookType:'xlsx', cellStyles:true });
    res.setHeader('Content-Disposition', 'attachment; filename="Jarayon_Auditi_Tekshiruv_Varagi.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf2);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ─── Checklist endpoints ─────────────────────────────────────────
app.get('/api/checklist', auth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(`
      SELECT ci.id, ci.category, ci.question, ci.sub_label, ci.order_num,
             cr.status AS response, cr.responded_by
      FROM checklist_items ci
      LEFT JOIN checklist_responses cr ON ci.id = cr.item_id AND cr.response_date = $1
      WHERE ci.active = true
      ORDER BY ci.order_num, ci.id
    `, [date]);
    const groups = {};
    rows.forEach(r => {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push({
        id: r.id, question: r.question, subLabel: r.sub_label,
        response: r.response || null, respondedBy: r.responded_by || null
      });
    });
    const total    = rows.length;
    const answered = rows.filter(r => r.response !== null).length;
    const ok       = rows.filter(r => r.response === 'ok').length;
    const nok      = rows.filter(r => r.response === 'nok').length;
    res.json({ date, groups, total, answered, ok, nok });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/checklist/respond', auth, async (req, res) => {
  try {
    const { item_id, status, date } = req.body;
    const rd = date || new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO checklist_responses (item_id, response_date, status, responded_by)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (item_id, response_date) DO UPDATE SET status=$3, responded_by=$4
    `, [item_id, rd, status, req.session.user.username]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/checklist/items', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM checklist_items ORDER BY order_num, id');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/checklist/items', auth, async (req, res) => {
  try {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: "Ruxsat yo'q" });
    const { category, question, sub_label, order_num } = req.body;
    if (!category || !question) return res.status(400).json({ error: "Kategoriya va savol kerak" });
    const { rows } = await pool.query(
      'INSERT INTO checklist_items (category,question,sub_label,order_num) VALUES ($1,$2,$3,$4) RETURNING *',
      [category, question, sub_label || '', parseInt(order_num) || 0]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/checklist/items/:id', auth, async (req, res) => {
  try {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: "Ruxsat yo'q" });
    const { active } = req.body;
    const { rows } = await pool.query(
      'UPDATE checklist_items SET active=$1 WHERE id=$2 RETURNING *',
      [active, req.params.id]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Server xatosi' }); }
});

app.delete('/api/checklist/items/:id', auth, async (req, res) => {
  try {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: "Ruxsat yo'q" });
    await pool.query('DELETE FROM checklist_items WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/audit', auth, async (req, res) => {
  try {
    const { workshop, line, station, page = 1, limit = 20 } = req.query;
    const conds = ['1=1']; const params = [];
    if (workshop) { params.push(`%${workshop}%`); conds.push(`workshop ILIKE $${params.length}`); }
    if (line)     { params.push(`%${line}%`);     conds.push(`line_body ILIKE $${params.length}`); }
    if (station)  { params.push(`%${station}%`);  conds.push(`station ILIKE $${params.length}`); }
    const w = conds.join(' AND ');
    const countR = await pool.query(`SELECT COUNT(*) FROM audit_issues WHERE ${w}`, params);
    const total = parseInt(countR.rows[0].count);
    const offset = (parseInt(page)-1) * parseInt(limit);
    const p2 = [...params, parseInt(limit), offset];
    const { rows } = await pool.query(`SELECT * FROM audit_issues WHERE ${w} ORDER BY created_at DESC LIMIT $${p2.length-1} OFFSET $${p2.length}`, p2);
    res.json({ total, page: parseInt(page), limit: parseInt(limit), rows: rows.map(auditToClient) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/audit/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_issues WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(auditToClient(rows[0]));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/audit', auth, upload.fields([{ name: 'auditMedia', maxCount: 10 }]), async (req, res) => {
  try {
    const u = req.session.user;
    const { question_code, workshop, line_body, station, problem_category, problem_level, description, discovery_dept, responsible_person, target_date } = req.body;
    if (!workshop?.trim() || !line_body?.trim() || !station?.trim() || !description?.trim() || !problem_category?.trim() || !responsible_person?.trim()) {
      return res.status(400).json({ error: "Majburiy maydonlarni to'ldiring" });
    }
    if (target_date && target_date < new Date().toISOString().slice(0,10)) {
      return res.status(400).json({ error: "Muddat bugundan katta bo'lishi kerak" });
    }
    const mf = (req.files?.auditMedia || []).map(f => ({ url: '/uploads/'+f.filename, type: f.mimetype.startsWith('video/')?'video':'image' }));
    const { rows } = await pool.query(
      `INSERT INTO audit_issues (question_code,workshop,line_body,station,problem_category,problem_level,description,discovery_dept,responsible_person,target_date,added_by,media_files)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [question_code||null, workshop.trim(), line_body.trim(), station.trim(), problem_category.trim(), problem_level||'Medium', description.trim(), discovery_dept||null, responsible_person.trim(), target_date||null, u.username, JSON.stringify(mf)]
    );
    notifyByEmail('new_audit', { workshop: workshop.trim(), line_body: line_body.trim(), station: station.trim(), description: description.trim(), responsible_person: responsible_person.trim(), target_date: target_date||null });
    res.json(auditToClient(rows[0]));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/audit/:id', auth, async (req, res) => {
  try {
    const u = req.session.user;
    const ex = await pool.query('SELECT status FROM audit_issues WHERE id = $1', [req.params.id]);
    if (!ex.rows.length) return res.status(404).json({ error: 'Topilmadi' });
    if (ex.rows[0].status === 'closed' && u.role !== 'admin') {
      return res.status(403).json({ error: 'Yopilgan muammoni tahrirlash mumkin emas' });
    }
    const { status, progress, corrective_action, responsible_person, target_date, description } = req.body;
    const sets = ['updated_at = NOW()']; const vals = [];
    if (status !== undefined)             { vals.push(status);                sets.push(`status = $${vals.length}`); }
    if (progress !== undefined)           { vals.push(progress||'');          sets.push(`progress = $${vals.length}`); }
    if (corrective_action !== undefined)  { vals.push(corrective_action||''); sets.push(`corrective_action = $${vals.length}`); }
    if (responsible_person !== undefined) { vals.push(responsible_person||null); sets.push(`responsible_person = $${vals.length}`); }
    if (target_date !== undefined)        { vals.push(target_date||null);     sets.push(`target_date = $${vals.length}`); }
    if (description !== undefined)        { vals.push(description);           sets.push(`description = $${vals.length}`); }
    if (status === 'closed')              { vals.push(u.username);            sets.push(`closed_by = $${vals.length}`); }
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE audit_issues SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`, vals);
    res.json(auditToClient(rows[0]));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.delete('/api/audit/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { rowCount } = await pool.query('DELETE FROM audit_issues WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ─── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ─────────────────────────────────────────────────────
// ── Deadline eslatmasi: har kuni soat 08:00 da ──────────────────
function scheduleDeadlineCheck() {
  const now = new Date();
  const next8 = new Date(now);
  next8.setHours(8, 0, 0, 0);
  if (next8 <= now) next8.setDate(next8.getDate() + 1);
  const ms = next8 - now;
  setTimeout(async () => {
    try {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const tStr = tomorrow.toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT r.*, u.email, u.full_name FROM records r
         LEFT JOIN users u ON u.username = r.added_by
         WHERE r.status != 'closed' AND r.deadline = $1`, [tStr]
      );
      for (const r of rows) {
        const { rows: admins } = await pool.query('SELECT email FROM users WHERE email IS NOT NULL');
        const toList = admins.map(a => a.email);
        if (r.email && !toList.includes(r.email)) toList.push(r.email);
        for (const to of toList) {
          await sendMail({
            to,
            subject: `⚠️ Deadline ertaga: #${r.id} — ${r.line} ${r.station}`,
            html: `<div style="font-family:Arial;padding:20px">
              <h2 style="color:#E65100">⚠️ Muammo muddati ertaga tugaydi!</h2>
              <table style="border-collapse:collapse">
                <tr><td style="padding:6px;color:#666">ID:</td><td>#${r.id}</td></tr>
                <tr><td style="padding:6px;color:#666">Liniya:</td><td>${r.line}</td></tr>
                <tr><td style="padding:6px;color:#666">Stansiya:</td><td>${r.station}</td></tr>
                <tr><td style="padding:6px;color:#666">Muammo:</td><td>${(r.problem||'').substring(0,100)}</td></tr>
                <tr><td style="padding:6px;color:#666">Deadline:</td><td style="color:#B71C1C;font-weight:bold">${r.deadline}</td></tr>
              </table>
            </div>`
          });
        }
      }
      console.log(`⏰ Deadline check: ${rows.length} ta eslatma yuborildi`);

      // Muddati o'tgan, hali yopilmagan va jarima berilmagan muammolar uchun reytingni pasaytirish
      const todayStr = new Date().toISOString().slice(0, 10);
      const { rows: overdue } = await pool.query(
        `SELECT id, added_by FROM records
         WHERE status != 'closed' AND deadline IS NOT NULL AND deadline < $1 AND rating_penalized = false`,
        [todayStr]
      );
      for (const r of overdue) {
        await penalizeRating(r.added_by);
        await pool.query('UPDATE records SET rating_penalized = true WHERE id = $1', [r.id]);
      }
      if (overdue.length) console.log(`⏰ Rating jarimasi: ${overdue.length} ta muammo uchun`);
    } catch (e) { console.error('Deadline check error:', e.message); }
    scheduleDeadlineCheck();
  }, ms);
  console.log(`⏰ Deadline check ${Math.round(ms/60000)} daqiqadan keyin ishga tushadi`);
}

// ── Oylik reyting: har oyning 1-kuni 00:05 da arxivlanadi va qayta boshlanadi ──
function monthLabel(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

async function archiveAndResetRating() {
  const client = await pool.connect();
  try {
    const month = monthLabel(new Date(Date.now() - 86400000)); // yakunlangan oy
    const { rows } = await client.query('SELECT username, full_name, role, line, rating FROM users ORDER BY rating DESC, full_name ASC');
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await client.query(
        'INSERT INTO rating_history (month, rank, username, full_name, role, line, rating) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [month, i + 1, r.username, r.full_name, r.role, r.line, r.rating]
      );
    }
    await client.query('UPDATE users SET rating = 100');
    await client.query('COMMIT');
    console.log(`🏆 Oylik reyting arxivlandi (${month}), ${rows.length} ta foydalanuvchi qayta 100 ball bilan boshladi`);

    const top3 = rows.slice(0, 3);
    if (top3.length) {
      const { rows: admins } = await client.query('SELECT email FROM users WHERE role = \'admin\' AND email IS NOT NULL');
      const medals = ['🥇','🥈','🥉'];
      const listHtml = top3.map((r, i) => `<tr><td style="padding:6px">${medals[i]||''} ${r.full_name}</td><td style="padding:6px;font-weight:bold">${r.rating}</td></tr>`).join('');
      for (const a of admins) {
        await sendMail({
          to: a.email,
          subject: `🏆 ${month} oyi reytingi — g'oliblarni rag'batlantirish vaqti`,
          html: `<div style="font-family:Arial;padding:20px"><h2 style="color:#E65100">🏆 ${month} oyi eng yuqori reytingli xodimlari</h2><table style="border-collapse:collapse">${listHtml}</table><p style="color:#666;margin-top:12px">Ushbu xodimlarni rag'batlantirishni unutmang.</p></div>`
        });
      }
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Rating arxivlash xatosi:', e.message);
  } finally {
    client.release();
  }
}

function scheduleMonthlyRatingReset() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 5, 0, 0);
  const ms = next - now;
  setTimeout(async () => {
    await archiveAndResetRating();
    scheduleMonthlyRatingReset();
  }, ms);
  console.log(`🏆 Oylik reyting arxivi ${next.toISOString()} da ishga tushadi`);
}

initDB().then(() => {
  server.listen(PORT, () => console.log(`✅  Running on http://localhost:${PORT}`));
  scheduleDeadlineCheck();
  scheduleMonthlyRatingReset();
}).catch(err => {
  console.error('❌  DB init failed:', err.message);
  process.exit(1);
});
