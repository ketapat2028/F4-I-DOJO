# Changelog

## [Unreleased]

### Changed (โหมดเล่นใหม่: ดู VDO → ตอบทีละข้อ)
- เปลี่ยนวิธีเล่นจาก "จับคู่คำถาม–คำตอบในหน้าเดียว" เป็นเล่นทีละข้อ: ดู VDO ให้จบ (ไม่มีแถบกรอ ข้ามไม่ได้) → ตัวเลือกคำตอบขึ้นมา → กดเลือกแล้วตรวจทันที · ผิดเลือกใหม่ได้ไม่จำกัด (ตัวที่ผิดถูกล็อก) · ถูกแล้วไป VDO ข้อถัดไปเอง จนจบ
- `MatchPair.video` + `AnswerOption.correct` (`SpecRecord.videoUrl` / `answers[].correct`): แต่ละข้อมีตัวเลือกอย่างน้อย 2 ตัว และถูกตัวเดียว · ข้อมูลรูปแบบเก่าที่ไม่มี `correct` จะถือว่าตัวแรกคือตัวที่ถูก · ข้อที่ไม่มี VDO แสดงตัวเลือกทันที
- เวลาจำกัดนับรวมทั้งเกมเฉพาะตอนตอบ (ไม่นับเวลาดู VDO และช่วงค้างสีเขียวหลังตอบถูก) · ส่งผลไป portal: ตอบถูกครบ = `pass`, หมดเวลา = `fail`, `score` = % ที่ตอบถูกตั้งแต่ครั้งแรก
- editor: อัปโหลด VDO ต่อข้อ (โชว์ % ความคืบหน้า) และติ๊กตัวเลือกที่ถูก

### Added
- `POST /api/upload-video` (ต้องใช้ `x-admin-secret`, .mp4 .m4v .webm .ogv ไม่เกิน 300MB) เก็บเป็นไฟล์ใน `backend/uploads/videos/` ชื่อ `<uuid>.<ext>` และเสิร์ฟที่ `GET /api/videos/<file>` ด้วย `express.static` (รองรับ Range) — ต่างจากรูปที่เก็บใน DB เพราะ VDO ใหญ่เกินไป · **ต้องสำรองโฟลเดอร์นี้ด้วย** ถ้าสำรอง DB
- คำถาม 1 ข้อมีคำตอบได้หลายใบ (`MatchPair.answers[]` / `SpecRecord.answers[]`) ต้องวางให้ครบทุกใบถึงจะถูก · ยังอ่านรูปแบบเก่า (`answer` เดี่ยว และแบบข้อความล้วน) ได้ · ปุ่ม "👁️ เฉลย" ในผลตรวจ และป๊อปอัพเลือกคำตอบแบบใหม่ (จาก branch `NewDsign` รอบ 2)
- เชื่อมเกมกับจอ Station ของ I-Dojo LPB portal ตาม `PORTAL_INTEGRATION.md`: `utils/portalBridge.ts` ส่งผล `pass` เมื่อถูกครบ / `fail` เมื่อหมดเวลา (ผิดแต่เวลาเหลือไม่ส่ง) กันส่งซ้ำระหว่างรอ ack (10 วิ) แสดงสถานะ "กำลังส่งผล / ส่งผลแล้ว / ส่งไม่สำเร็จ [ส่งใหม่]" ใน modal ผล และส่งต่อปุ่ม Enter/Space ของวิทยากร — ทำงานเฉพาะตอนถูกฝังใน iframe
- route `GET/PUT /api/game` + ตาราง `game` เก็บชุดคำถามที่ backend และ `GET /api/admin/check` ให้ editor ตรวจรหัส
- หน้า editor ถามรหัสผู้ดูแลก่อนแก้ (เก็บใน sessionStorage) · ถ้า server ยังไม่มีชุดคำถาม ดึงข้อมูลเดิมจาก localStorage ของเครื่องนั้นมาให้ย้ายขึ้น server หรือเริ่มจากชุดตัวอย่าง F1
- เพิ่ม `PORTAL_INTEGRATION.md` สัญญาการส่งผล ผ่าน/ไม่ผ่าน (`postMessage`) เมื่อเกมถูกฝังเป็น iframe บนจอ Station ของ I-Dojo LPB portal
- เพิ่ม `CLAUDE.md` อธิบายคำสั่ง build/dev และสถาปัตยกรรม พร้อมหัวข้อ "กฎสำหรับการแก้โค้ด" อ้างอิง `DEPLOYMENT.md` และ `PORTAL_INTEGRATION.md`
- เพิ่ม `DEPLOYMENT.md` อธิบายสภาพ production บน Raspberry Pi (Apache + PM2 + MariaDB)

### Changed
- รวม branch `NewDsign` รอบ 2 (ketapat2028): ดีไซน์ใหม่ + คำตอบหลายใบ + รูปเก็บใน DB + ตัดวิดีโอ — **ยังคงระบบรหัสผู้ดูแล** (ไม่รับส่วนที่ NewDsign ตัด `ADMIN_SECRET` ออก) และยังคงพฤติกรรมตอนถูกฝังบนจอ Station ของ support_api
- รูปที่อัปโหลดจากหน้า editor ย้ายจากเก็บเป็นไฟล์ใน `backend/uploads/` ไปเก็บเป็น `LONGBLOB` ในตาราง `images` ใหม่แทน — `POST /api/upload` คืน `{ id }` (เดิมคืน `{ filename }`), เปิดรูปผ่าน `GET /api/images/:id`, URL ที่เก็บในชุดคำถามเปลี่ยนจาก `/api/uploads/<file>` เป็น `/api/images/<id>` · ยังเสิร์ฟ `/api/uploads/` แบบ static ไว้เผื่อชุดคำถามเก่าที่ยังอ้างอิงไฟล์เดิมอยู่
- ตอนถูกฝังบนจอ Station: นาฬิกาเริ่มนับทันทีที่โหลดเกม · ตั้งไม่จำกัดเวลา (0) จะใช้ 5 นาทีแทน ทำให้มีผล fail ส่งไปจอเสมอ · editor แสดงหมายเหตุนี้ใต้ช่องจำกัดเวลา
- ตอนถูกฝัง: ซ่อนปุ่ม "เล่นใหม่" / "รีเซ็ตทั้งหมด" และหลังส่งผลแล้วซ่อน "ลองใหม่เฉพาะข้อผิด" แสดงว่าจอจะไปสถานีถัดไป (ผ่าน) หรือโหลดเกมใหม่ (ไม่ผ่าน) ตามพฤติกรรมของ portal · เปิดเกมตรง ๆ ยังเหมือนเดิม
- หน้าใส่รหัสผู้ดูแลและแถบสถานะการส่งผลเปลี่ยนเป็นธีมสว่างให้เข้ากับดีไซน์ NewDsign
- รวม branch `NewDsign`: เปลี่ยนเป็นธีมสว่าง (หน้าเกม, editor, header, confetti, `f1.css` เพิ่ม variant `fit` สำหรับจอใหญ่) · ปุ่ม "📁 เลือกรูปจากเครื่อง" ใน editor · รูปตัวอย่าง F1 ชุดใหม่ · เพิ่ม `run-dev.bat` เปิด dev server — ไม่แตะ API และการส่งผลไป portal
- ชุดคำถามย้ายจาก localStorage ไปเก็บที่ backend — เกมใน iframe ข้ามเว็บมองไม่เห็น localStorage ของหน้า editor · ถ้าโหลดไม่ได้หรือยังไม่มีชุดคำถาม หน้าเกมแสดงข้อความแทน (ไม่ใช้ข้อมูลตัวอย่างเงียบ ๆ)
- รูปในชุดคำถามอัปโหลดขึ้น server (`/api/upload`) แล้วเก็บเป็น URL แทน base64 (ยังย่อเหลือกว้าง 900px ก่อนส่ง) รูป base64 เดิมยังใช้ได้
- `express.json` รับได้ถึง 10mb เผื่อชุดคำถามเก่าที่มีรูป base64
- Express ตัด `/I-DOJO` ออกจาก `/I-DOJO/api/...` เอง ทำให้เปิดตรง port 5000 (ไม่มี Apache) แล้วเรียก API ได้
- เว้นขอบล่างเพิ่มตอนถูกฝัง ไม่ให้ปุ่ม "ผ่านสถานี" ของ portal ทับ
- ย้ายการเสิร์ฟไฟล์อัปโหลดจาก `/uploads` และ `/I-DOJO/uploads` ไปที่ `/api/uploads` ให้ Apache บน Pi proxy ถึง และลบ proxy `/I-DOJO/uploads` ใน `vite.config.ts`

### Fixed
- ack จากจอที่มาช้ากว่า 10 วิ ตอนนี้ยังนับเป็น "ส่งผลแล้ว" ไม่ค้างที่ "ส่งไม่สำเร็จ"
- อัปโหลดไฟล์ผิดชนิดหรือใหญ่เกินได้ข้อความภาษาไทยแทน "(500)" (multer error ตอบเป็น JSON 400)
- โฟลเดอร์ `uploads` (เหลือเสิร์ฟไฟล์เก่า) อ้างจากที่อยู่ของ `index.js` ไม่ขึ้นกับว่า PM2 start จากโฟลเดอร์ไหน
- ป้ายข้างปุ่มเลือกรูปใน editor ขึ้น "มีรูปอยู่แล้ว" เมื่อรูปเป็น URL บน server (เดิมขึ้น "ยังไม่ได้เลือกไฟล์")
- สร้าง id คู่คำถามใหม่ไม่พังเมื่อเปิดผ่าน `http://<IP ของ Pi>` (`crypto.randomUUID` ใช้ไม่ได้นอก secure context)
- แก้ชื่อ env ใน `DEPLOYMENT.md` ให้ตรงกับโค้ด: `DB_PASSWORD` → `DB_PASS`, ตัด `DB_PORT` ที่โค้ดไม่ได้อ่าน, เพิ่ม `ADMIN_SECRET`

### Security
- รูปใน DB เสิร์ฟด้วย content-type ที่กำหนดจากนามสกุล (jpg/png/gif/webp) ไม่ใช้ mimetype ที่ browser ส่งมา · `GET /api/images/:id` อ่านได้โดยไม่ต้องใช้รหัส ส่วน `POST /api/upload` ต้องใช้ `x-admin-secret`
- `POST /api/records` และ `POST /api/app-config` (โค้ดตัวอย่าง) ต้องใช้ `x-admin-secret` แล้ว — เดิมใครใน LAN ก็เขียน DB ได้
- การบันทึกชุดคำถามและอัปโหลดรูปต้องใช้ `x-admin-secret` (= `ADMIN_SECRET`) ที่ผู้ดูแลกรอกเอง ไม่ฝังใน bundle · `DELETE /api/records` ใช้ตัวตรวจเดียวกัน

### Removed
- เอาฟีเจอร์วิดีโอสอนออกทั้งหมด: ลบช่องกรอก Video URL/ชื่อ/คำอธิบายในหน้า editor, ปุ่ม "ดูวิดีโอสอน" + modal เล่นวิดีโอตอนตอบผิดในหน้าเกม, ลบคอมโพเนนต์ `VideoPlayer.tsx`, ลบ `videoUrl`/`videoTitle`/`videoDesc` ออกจาก `MatchPair`/`SpecRecord` และชุดตัวอย่าง F1 (ทั้ง YouTube และการอัปโหลด .mp4 / `POST /api/upload-video`) · ข้อมูลเก่าที่ยังมี field วิดีโอจะถูกข้ามไป
- เลิกรองรับ Netlify: ลบ `netlify.toml`, script `build:hosted`, โหมด `hosted` ใน `vite.config.ts` และ `utils/mode.ts` (`IS_HOSTED`) — basename `/I-DOJO` ตายตัว
- ลบ `VITE_ADMIN_SECRET` / `VITE_DEMO_MODE` ออกจาก `frontend/.env.example` (frontend ไม่ได้อ่านแล้ว)
