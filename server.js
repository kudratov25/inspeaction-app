require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const pgSession      = require('connect-pg-simple')(session);
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const bcrypt         = require('bcryptjs');
const XLSX           = require('xlsx');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle } = require('docx');
const { pool, initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

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
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
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
  logistics:  { label: 'Logistika', canAdd: false, canClose: true,  canAction: true,  filter: 'logistics' },
  production: { label: 'Production',canAdd: false, canClose: true,  canAction: true,  filter: 'all' },
  admin:      { label: 'Admin',     canAdd: true,  canClose: true,  canAction: true,  filter: 'all' },
};

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
  const f = ROLES[user.role]?.filter;
  if (f === 'own')       return { clause: 'WHERE added_by = $1', params: [user.username] };
  if (f === 'logistics') return { clause: 'WHERE dept = $1',     params: ['logistics'] };
  return { clause: 'WHERE 1=1', params: [] };
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username va parol kiriting' });
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
    const user = rows[0];
    const ok = await bcrypt.compare(password.trim(), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Username yoki parol noto\'g\'ri' });
    loginAttempts.delete(req.ip || req.socket.remoteAddress);
    req.session.user = { id: user.id, username: user.username, name: user.full_name, role: user.role, line: user.line };
    req.session.save(err => {
      if (err) { console.error('Session save error:', err); return res.status(500).json({ error: 'Session xatosi' }); }
      res.json({ ok: true, user: { name: user.full_name, role: user.role, line: user.line, username: user.username, roleLabel: ROLES[user.role]?.label } });
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', auth, (req, res) => {
  const u = req.session.user;
  res.json({ ...u, roleLabel: ROLES[u.role]?.label, roleCfg: ROLES[u.role] });
});

app.get('/api/config', (req, res) => {
  res.json({ demo: process.env.NODE_ENV !== 'production' });
});

app.get('/api/assemblers', auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT full_name FROM users WHERE role='assembler' ORDER BY full_name");
    res.json(rows.map(r => r.full_name));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

// ══════════════════════════════════════════════════════════════
//  RECORDS ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/records', auth, async (req, res) => {
  try {
    const { clause, params } = visibleWhere(req.session.user);
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
    const { clause, params } = visibleWhere(req.session.user);
    const { rows } = await pool.query(
      `SELECT * FROM records ${clause} AND id = $${params.length + 1}`,
      [...params, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi yoki ruxsat yo\'q' });
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.post('/api/records', auth, upload.fields([{ name: 'imgBefore', maxCount: 1 }, { name: 'imgAfter', maxCount: 1 }]), async (req, res) => {
  try {
    const u = req.session.user;
    if (!ROLES[u.role]?.canAdd) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { date, time, line, type, problem, station, auditor, action, deadline } = req.body;
    if (!station?.trim() || !problem?.trim()) return res.status(400).json({ error: 'Stansiya va muammo tavsifini kiriting' });
    const dept = (type === 'Material' || type === 'Machine') ? 'logistics' : 'production';
    const d = new Date(date);
    const fmt = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getFullYear()).slice(2)}`;
    const imgBefore = req.files?.imgBefore ? '/uploads/' + req.files.imgBefore[0].filename : '';
    const imgAfter  = req.files?.imgAfter  ? '/uploads/' + req.files.imgAfter[0].filename  : '';
    const { rows } = await pool.query(
      `INSERT INTO records (date,time,line,type,problem,station,auditor,action,status,added_by,dept,img_before,img_after,deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13) RETURNING *`,
      [fmt, time || '', line, type, problem.trim(), station.trim(), auditor, action?.trim() || '—', u.username, dept, imgBefore, imgAfter, deadline || null]
    );
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.patch('/api/records/:id', auth, async (req, res) => {
  try {
    const u = req.session.user;
    const rc = ROLES[u.role];
    if (!rc?.canAction) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { status, action, deadline, is_recurring } = req.body;
    if (status === 'closed') {
      if (!rc.canClose) return res.status(403).json({ error: 'Yopish ruxsati yo\'q' });
      const ex = await pool.query('SELECT action, dept FROM records WHERE id = $1', [req.params.id]);
      if (!ex.rows.length) return res.status(404).json({ error: 'Topilmadi' });
      if (u.role === 'logistics' && ex.rows[0].dept !== 'logistics') {
        return res.status(403).json({ error: 'Siz faqat logistics muammolarini yopa olasiz' });
      }
      const finalAction = action?.trim() || ex.rows[0].action;
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
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE records SET ${sets.join(',')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });
    res.json(dbToClient(rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

app.get('/api/stats', auth, async (req, res) => {
  try {
    const { clause, params } = visibleWhere(req.session.user);
    const { rows } = await pool.query(`SELECT line, status, dept, is_recurring, deadline FROM records ${clause}`, params);
    const byLine = {}, byDept = {};
    let open = 0, closed = 0, inprogress = 0, risky = 0, overdue = 0, recurring = 0;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    rows.forEach(r => {
      byLine[r.line] = (byLine[r.line] || 0) + 1;
      byDept[r.dept] = (byDept[r.dept] || 0) + 1;
      if (r.status === 'open')       open++;
      else if (r.status === 'closed')    closed++;
      else if (r.status === 'inprogress') inprogress++;
      if (r.is_recurring) recurring++;
      if (r.deadline && r.status !== 'closed') {
        const dl = new Date(String(r.deadline).split('T')[0] + 'T00:00:00');
        const days = Math.round((dl - now) / 86400000);
        if (days < 0) overdue++;
        else if (days <= 2) risky++;
      }
    });
    res.json({ total: rows.length, open, closed, inprogress, risky, overdue, recurring, byLine, byDept });
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

app.patch('/api/users/:id', auth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Faqat admin' });
  try {
    const { full_name, role, line, password } = req.body;
    if (!full_name || !role) return res.status(400).json({ error: 'Ism va rol kiritilishi shart' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    const sets = ['full_name=$1','role=$2','line=$3'];
    const vals = [full_name, role, line || ''];
    if (password && password.trim()) {
      vals.push(await bcrypt.hash(password.trim(), 10));
      sets.push(`password_hash=$${vals.length}`);
    }
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,username,full_name,role,line`,
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
    const format   = req.query.format === 'word' ? 'word' : 'excel';
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

    if (format === 'excel') {
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

    // ── Word ────────────────────────────────────────────────────
    const cellBorder = { top:{style:BorderStyle.SINGLE,size:4,color:'CCCCCC'}, bottom:{style:BorderStyle.SINGLE,size:4,color:'CCCCCC'}, left:{style:BorderStyle.SINGLE,size:4,color:'CCCCCC'}, right:{style:BorderStyle.SINGLE,size:4,color:'CCCCCC'} };
    const colWidths  = [600,900,600,800,900,900,1100,2800,2800,1000,900,1100];
    const headerCells = tr.headers.map((h, i) => new TableCell({
      children: [new Paragraph({ children:[new TextRun({text:h,bold:true,size:18,color:'FFFFFF'})], alignment:AlignmentType.CENTER })],
      shading: { fill:'1565C0', color:'auto' },
      width:   { size: colWidths[i]||800, type: WidthType.DXA },
      borders: cellBorder,
    }));

    const docChildren = [
      new Paragraph({ children:[new TextRun({text:tr.title, bold:true, size:28, color:'1565C0'})], alignment:AlignmentType.CENTER, spacing:{after:100} }),
      new Paragraph({ children:[new TextRun({text:`${tr.generated}: ${now}   |   ${tr.total}: ${rows.length}`, italics:true, size:18, color:'5A6A7E'})], spacing:{after:200} }),
    ];

    for (const [ri, r] of rows.entries()) {
      const bg = ri % 2 === 0 ? 'FFFFFF' : 'F5F8FF';
      const textVals = [
        ri+1, r.date, r.time, r.line, r.type, r.station, r.auditor,
        r.problem, r.action, tr.status[r.status]||r.status,
        r.deadline||'—', r.added_by,
      ];
      const cells = textVals.map((val, ci) => new TableCell({
        children: [new Paragraph({ children:[new TextRun({text:String(val??'—'),size:16})], spacing:{before:40,after:40} })],
        shading: { fill: ci===9 ? ({open:'FFF9C4',inprogress:'E3F2FD',closed:'E8F5E9'}[r.status]||bg) : bg, color:'auto' },
        width: { size: colWidths[ci]||800, type: WidthType.DXA },
        borders: cellBorder,
      }));

      // add image cells if this record has photos
      const hasImg = r.img_before || r.img_after;
      if (hasImg) {
        const imgCells = [];
        for (const [label, imgPath] of [[tr.before||'Before', r.img_before],[tr.after||'After', r.img_after]]) {
          if (!imgPath) continue;
          const fullPath = path.join(__dirname, imgPath);
          let imgRun;
          try {
            const imgBuf = fs.readFileSync(fullPath);
            const { ImageRun } = require('docx');
            imgRun = new ImageRun({ data: imgBuf, transformation:{ width:120, height:90 } });
          } catch { imgRun = new TextRun({ text: label+': '+imgPath, size:14, italics:true }); }
          imgCells.push(new TableCell({
            children: [
              new Paragraph({ children:[new TextRun({text:label,bold:true,size:14})], spacing:{after:40} }),
              new Paragraph({ children:[imgRun] }),
            ],
            borders: cellBorder,
          }));
        }
        if (imgCells.length) {
          docChildren.push(new Table({ rows:[new TableRow({children:cells})], width:{size:100,type:WidthType.PERCENTAGE} }));
          docChildren.push(new Table({ rows:[new TableRow({children:imgCells})], width:{size:100,type:WidthType.PERCENTAGE} }));
          docChildren.push(new Paragraph({text:'', spacing:{after:120}}));
          continue;
        }
      }
      docChildren.push(new Table({ rows:[new TableRow({children:[...cells]})], width:{size:100,type:WidthType.PERCENTAGE} }));
    }

    const doc = new Document({
      sections: [{ properties:{ page:{ size:{ orientation:'landscape', width:16838, height:11906 } } }, children: [
        new Table({ rows:[new TableRow({children:headerCells,tableHeader:true}),...rows.map((_,ri)=>{
          const r=rows[ri];
          const bg=ri%2===0?'FFFFFF':'F5F8FF';
          return new TableRow({children:[ri+1,r.date,r.time,r.line,r.type,r.station,r.auditor,r.problem,r.action,tr.status[r.status]||r.status,r.deadline||'—',r.added_by].map((val,ci)=>new TableCell({children:[new Paragraph({children:[new TextRun({text:String(val??'—'),size:16})],spacing:{before:40,after:40}})],shading:{fill:ci===9?({open:'FFF9C4',inprogress:'E3F2FD',closed:'E8F5E9'}[r.status]||bg):bg,color:'auto'},width:{size:colWidths[ci]||800,type:WidthType.DXA},borders:cellBorder}))});
        })], width:{size:100,type:WidthType.PERCENTAGE} }),
        new Paragraph({text:'', spacing:{after:300}}),
        new Paragraph({children:[new TextRun({text:`${tr.title}   |   ${tr.generated}: ${now}   |   ${tr.total}: ${rows.length}`,italics:true,size:16,color:'5A6A7E'})]})
      ]}],
    });
    const buf = await Packer.toBuffer(doc);
    res.setHeader('Content-Disposition', `attachment; filename="tekshiruv-${lang}-${Date.now()}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export xatosi: '+e.message }); }
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

// ─── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅  Running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌  DB init failed:', err.message);
  process.exit(1);
});
