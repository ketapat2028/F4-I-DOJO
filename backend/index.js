require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// Fix BigInt JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

// ========== MIDDLEWARE ==========
// เปิดตรง port 5000 (ไม่มี Apache) frontend จะเรียก /I-DOJO/api/... — ตัด /I-DOJO ออกแบบเดียวกับ Apache/vite proxy
app.use((req, res, next) => {
  if (req.url.startsWith('/I-DOJO/api/')) req.url = req.url.slice('/I-DOJO'.length);
  next();
});
app.use(cors());
// ชุดคำถามเก่า/ที่ import มาอาจยังมีรูปเป็น base64 ฝังอยู่ จึงเผื่อขนาดไว้
app.use(express.json({ limit: '10mb' }));
// รูปที่อัปโหลดใหม่เก็บใน DB (ตาราง images) แล้ว — เหลือเสิร์ฟโฟลเดอร์นี้ไว้เผื่อชุดคำถามเก่าที่ยังอ้างอิงไฟล์อยู่
// อ้างจากที่อยู่ของไฟล์นี้ ไม่ขึ้นกับว่า PM2 start จากโฟลเดอร์ไหน
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));
// VDO ของแต่ละข้อ (ถึง 300MB) ใหญ่เกินจะเก็บใน DB — เขียนลงดิสก์ที่ backend/videos แล้วเสิร์ฟแบบ static
// express.static รองรับ Range request ทำให้ <video> เลื่อน/โหลดทีละส่วนได้
const VIDEO_DIR = path.join(__dirname, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });
app.use('/api/videos', express.static(VIDEO_DIR, { maxAge: '365d', immutable: true }));

// งานที่แก้ข้อมูล (บันทึกชุดคำถาม, อัปโหลดรูป, เขียน/ลบ records, app-config) ต้องส่ง header x-admin-secret ตรงกับ ADMIN_SECRET
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || !secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ========== Multer config ==========
// เก็บไฟล์ไว้ใน memory แล้วค่อยเขียนลง DB (ตาราง images) ไม่เขียนลงดิสก์แล้ว
// content-type ที่เสิร์ฟกลับกำหนดจากนามสกุลเอง ไม่เชื่อ mimetype ที่ browser ส่งมา (กันเก็บ text/html แล้วเสิร์ฟจาก origin เรา)
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const IMAGE_MAX_MB = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_TYPES[ext]) {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพ .jpg .jpeg .png .gif .webp เท่านั้น'));
    }
  }
});

// error ของ multer (ไฟล์ผิดชนิด/ใหญ่เกิน) ตอบเป็น JSON 400 ให้หน้า editor แสดงข้อความได้
function uploadImageField(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${IMAGE_MAX_MB}MB` : err.message;
    res.status(400).json({ error: message });
  });
}

const VIDEO_EXTS = ['.mp4', '.m4v', '.webm', '.ogv'];
const VIDEO_MAX_MB = 300;
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: VIDEO_DIR,
    // ตั้งชื่อเอง ไม่ใช้ชื่อไฟล์จาก browser (กันชื่อซ้ำ/อักขระแปลก)
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (VIDEO_EXTS.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`รองรับเฉพาะไฟล์ VDO ${VIDEO_EXTS.join(' ')} เท่านั้น`));
    }
  }
});

function uploadVideoField(req, res, next) {
  uploadVideo.single('video')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${VIDEO_MAX_MB}MB` : err.message;
    res.status(400).json({ error: message });
  });
}

// ========== STATIC FILE SERVING + SPA FALLBACK ==========
// ใช้ตอนรันโดยไม่มี Apache (เปิดตรง port 5000) — บน Pi ส่วนนี้ Apache เสิร์ฟจาก backend/build เอง
const BUILD_PATH = path.join(__dirname, 'build');
if (fs.existsSync(BUILD_PATH)) {
  app.use('/I-DOJO', express.static(BUILD_PATH));

  app.get('/I-DOJO', (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
  app.get('/I-DOJO/*', (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
}

// ========== DATABASE CONFIGURATION ==========
const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  acquireTimeout: 30000,
  timezone: '+07:00'
});

async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(sql, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// ========== DB INIT ==========
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS records (
      id         VARCHAR(36)  NOT NULL PRIMARY KEY,
      title      VARCHAR(200) NOT NULL,
      detail     TEXT,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS app_config (
      singleton  TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
      config     TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // ชุดคำถามของเกม (มีชุดเดียว) — data = { name, timeLimitSeconds, passPercent, pairs: [SpecRecord] }
  await query(`
    CREATE TABLE IF NOT EXISTS game (
      singleton  TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
      data       MEDIUMTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // รูปที่อัปโหลดจากหน้า editor — เก็บตัวไฟล์จริงในนี้ (ไม่เขียนลงดิสก์) question/answer อ้างอิงกลับมาด้วย /api/images/<id>
  await query(`
    CREATE TABLE IF NOT EXISTS images (
      id          VARCHAR(36)  NOT NULL PRIMARY KEY,
      data        LONGBLOB     NOT NULL,
      mime_type   VARCHAR(50)  NOT NULL,
      uploaded_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('DB ready — records, app_config, game & images tables ensured');
}

// ========== API ROUTES ==========
app.get('/api/records', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM records ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/records', requireAdmin, async (req, res) => {
  const { title, detail } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await query(
      'INSERT INTO records (id, title, detail) VALUES (?, ?, ?)',
      [id, title, detail || '']
    );
    const [row] = await query('SELECT * FROM records WHERE id = ?', [id]);
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/records', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM records');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/upload', requireAdmin, uploadImageField, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const id = crypto.randomUUID();
    await query(
      'INSERT INTO images (id, data, mime_type) VALUES (?, ?, ?)',
      [id, req.file.buffer, IMAGE_TYPES[path.extname(req.file.originalname).toLowerCase()]]
    );
    res.json({ id });
  } catch (err) {
    console.error('POST /api/upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// requireAdmin มาก่อน multer — รหัสผิดจะไม่มีไฟล์ถูกเขียนลงดิสก์
app.post('/api/upload-video', requireAdmin, uploadVideoField, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ filename: req.file.filename });
});

// ให้หน้า editor ตรวจรหัสผู้ดูแลก่อนเริ่มแก้
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// อ่านได้โดยไม่ต้องใช้รหัส — หน้าเกมบนจอ Station ต้องโหลดรูปเอง
app.get('/api/images/:id', async (req, res) => {
  try {
    const rows = await query('SELECT data, mime_type FROM images WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'no image' });
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    console.error('GET /api/images/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/game', async (req, res) => {
  try {
    const rows = await query('SELECT data FROM game WHERE singleton = 1');
    if (rows.length === 0) return res.status(404).json({ error: 'no game' });
    res.json(JSON.parse(rows[0].data));
  } catch (err) {
    console.error('GET /api/game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/game', requireAdmin, async (req, res) => {
  const { name, timeLimitSeconds, passPercent, pairs } = req.body || {};
  if (!Array.isArray(pairs) || pairs.length < 2) {
    return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 คู่' });
  }
  try {
    const json = JSON.stringify({
      name: typeof name === 'string' ? name : '',
      timeLimitSeconds: Number.isFinite(timeLimitSeconds) ? Math.max(0, timeLimitSeconds) : 0,
      // เกณฑ์ผ่าน (% ของจำนวนข้อ) — ไม่ส่งมา frontend ใช้ค่าเริ่มต้น 70
      ...(Number.isFinite(passPercent) ? { passPercent: Math.min(100, Math.max(1, Math.round(passPercent))) } : {}),
      pairs,
    });
    await query(
      `INSERT INTO game (singleton, data) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
      [json]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/app-config', async (req, res) => {
  try {
    const rows = await query('SELECT config FROM app_config WHERE singleton = 1');
    if (rows.length === 0) return res.json({});
    res.json(JSON.parse(rows[0].config));
  } catch (err) {
    console.error('GET /api/app-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/app-config', requireAdmin, async (req, res) => {
  try {
    const json = JSON.stringify(req.body);
    await query(
      `INSERT INTO app_config (singleton, config) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = NOW()`,
      [json]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/app-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== START ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`I-DOJO Server running on port ${PORT}`);
  initDB().catch(err => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });
});
