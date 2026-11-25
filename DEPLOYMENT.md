# I-DOJO (Pit 5 Station) — Deployment

เอกสารนี้อธิบายว่า production รันอยู่ที่ไหนและตั้งค่าอย่างไร
**ทุกการแก้โค้ดต้องไม่ทำให้ค่าในเอกสารนี้พัง** ถ้าจำเป็นต้องเปลี่ยน ให้แก้เอกสารนี้ด้วยใน commit เดียวกัน

## Production host

| รายการ | ค่า |
|---|---|
| เครื่อง | Raspberry Pi (`raspberrypi`), user `idojo` |
| OS | Raspberry Pi OS (Debian 13 trixie) |
| Web server | Apache2 (`apache2`, ไม่ใช่ `httpd`) |
| Database | MariaDB 11.8 บนเครื่องเดียวกัน, bind `127.0.0.1` |
| Node.js | จาก Debian repo (`/usr/share/nodejs`) |
| Process manager | PM2, process name `pit5_station`, รันในชื่อ user `idojo` (ห้ามรันเป็น root) |
| Repo path | `/var/www/pit5_station` (owner `idojo:idojo`) |

## URL และ path

- Frontend เข้าที่ `http://<IP ของ Pi>/I-DOJO/`
- API เข้าที่ `http://<IP ของ Pi>/I-DOJO/api/...` → Apache proxy ไป `http://127.0.0.1:5000/api/...`
- Backend (Express) listen port **5000**
- ทุก route ของ backend ต้องขึ้นต้นด้วย `/api/`

## Frontend

- Vite build output: `frontend/` → `../backend/build` (Apache เสิร์ฟจากโฟลเดอร์นี้โดยตรง)
- `vite.config.ts` ต้องมี `base: '/I-DOJO/'` ไม่งั้น asset (JS/CSS) โหลดไม่ขึ้น
- `routes.tsx` ใช้ `basename: '/I-DOJO'` ตายตัว (เลิกรองรับ Netlify แล้ว)
- การเรียก API ต้องเป็น path แบบ relative ที่ขึ้นต้นด้วย base (เช่น `/I-DOJO/api/...` หรือสร้างจาก `import.meta.env.BASE_URL`)
  **ห้าม hardcode `http://localhost:5000`** เพราะจะชี้ไปเครื่องของคนที่เปิดเว็บ

## Backend

- Entry: `backend/index.js`
- ตอนเริ่มจะสร้างตาราง `records`, `app_config`, `game`, `images` และ `gpio_config` เองถ้ายังไม่มี
- ชุดคำถามของเกมเก็บในตาราง `game` (แถวเดียว, JSON) ผ่าน `GET /api/game` (404 = ยังไม่มี) และ `PUT /api/game`
- รูปที่อัปโหลดจากหน้า editor เก็บเป็น `LONGBLOB` ในตาราง `images` (ไม่เขียนไฟล์ลงดิสก์) — `POST /api/upload` (field `image`, `.jpg .jpeg .png .gif .webp` ไม่เกิน 10MB) คืน `{ id }` แล้ว question/answer เก็บ URL `/I-DOJO/api/images/<id>`, เปิดรูปผ่าน `GET /api/images/:id` (ไม่ต้องใช้รหัส) · ไฟล์ผิดชนิด/ใหญ่เกินได้ 400 JSON `{error}` ภาษาไทย · รูปอยู่ใน DB แล้ว **backup DB อย่างเดียวได้รูปครบ** แต่ DB จะโตตามจำนวนรูป และรูปที่เลิกใช้ไม่ถูกลบอัตโนมัติ
- VDO ของแต่ละข้อเก็บเป็น**ไฟล์**ใน `backend/videos/` (ใหญ่เกินจะเก็บใน DB) — `POST /api/upload-video` (field `video`, `.mp4 .m4v .webm .ogv` ไม่เกิน 300MB) คืน `{ filename }` แล้วข้อนั้นเก็บ URL `/I-DOJO/api/videos/<filename>` เสิร์ฟแบบ static (รองรับ Range) · **backup ต้องเอาโฟลเดอร์ `backend/videos/` ไปด้วย** · ถ้า Apache ตั้ง `LimitRequestBody` หรือ `ProxyTimeout` ไว้ต่ำ ต้องเพิ่มให้รับไฟล์ 300MB ได้ · ไฟล์ที่เลิกใช้ไม่ถูกลบอัตโนมัติ
- หน้า `/I-DOJO/editor` และ `PUT /api/game`, `POST /api/upload`, `POST /api/upload-video`, `POST`/`DELETE /api/records`, `POST /api/app-config` ไม่มีการตรวจสิทธิ์แล้ว — ใครที่เข้าถึงหน้านี้ได้ก็บันทึก/อัปโหลดได้ทันที
- Config อยู่ใน `backend/.env` (ไม่ commit, permission `600`, owner `idojo`)
- ต้องมี `backend/.env.example` ที่ระบุ key ทุกตัวโดยไม่มีค่าจริง

ตัวแปรที่ใช้ (ดูชื่อจริงจาก `.env.example`):

```
PORT=5000
DB_HOST=localhost
DB_USER=idojo
DB_PASS=
DB_NAME=pit5_station
```

- ไม่มี `DB_PORT` — โค้ดไม่ได้อ่าน ใช้ default ของ mariadb (3306)
- `backend/uploads/` เหลือไว้เสิร์ฟแบบ static เผื่อชุดคำถามเก่าที่ยังอ้างอิงไฟล์อยู่ (`/I-DOJO/api/uploads/<file>`, อ้างจากที่อยู่ของ `index.js`) แต่รูปที่อัปโหลดใหม่ทั้งหมดเก็บในตาราง `images` แล้ว ไม่ได้เขียนไฟล์เพิ่มอีก
- Express ยังเสิร์ฟ `backend/build` ที่ `/I-DOJO` ด้วย (ไว้ทดสอบตรง port 5000 โดยไม่มี Apache) และตัด `/I-DOJO` ออกจาก `/I-DOJO/api/...` เองแบบเดียวกับ Apache — บน Pi ส่วนนี้ Apache เสิร์ฟเอง
- เกมถูกฝังเป็น iframe บนจอ Station ของ portal — **ห้ามเพิ่ม `X-Frame-Options` หรือ CSP `frame-ancestors`** ใน Apache (ดู `PORTAL_INTEGRATION.md`)

### GPIO (หน้า `/I-DOJO/gpio`)

- `backend/gpio.js` สั่งขาผ่านคำสั่ง `raspi-gpio` (มีใน Raspberry Pi OS อยู่แล้ว) → **user ที่รัน PM2 ต้องอยู่กลุ่ม `gpio`** เช็คด้วย `groups` (Pi สถานีที่ `192.168.3.95` รันเป็น `pi` ซึ่งอยู่กลุ่ม `gpio` แล้ว) · ไม่ต้องลง package เพิ่ม
- route `GET /api/gpio` (สถานะทุกขา + log), `POST /api/gpio/pin/:n/{high|low|input|pulse|release}`, `POST /api/gpio/release-all`, `POST /api/gpio/edges/clear`, `GET`/`PUT /api/gpio/config` (ตาราง `gpio_config`: ชื่อขา + ตั้งค่ากล้อง), `POST /api/gpio/inspect` (สั่งกล้องถ่ายรูปตรวจ รอขา OK/NG)
- ไม่แตะขาไหนจนกว่าจะสั่งจากหน้าเว็บ · `pm2 restart` / `stop` แล้วขาที่สั่งไว้จะคืนค่าเดิม (ค่าตอน backend เริ่ม)
- เครื่องที่ไม่มี `raspi-gpio` หรือตั้ง `GPIO_MOCK=1` ใน `.env` = ขาจำลอง (หน้าเว็บขึ้นป้าย "ขาจำลอง")
- ไม่มีการตรวจสิทธิ์เหมือน route อื่น — ใครเข้าหน้าเว็บได้ก็สั่งขาได้ (มีแค่สวิตช์ "ปลดล็อกสั่งขา" กันกดพลาด)
- **ห้ามรันโปรแกรมอื่นที่สั่งขาเดียวกันพร้อมกัน** · เครื่องมือเดิม `~/gpio_trigger/gpio_trigger.py` (พอร์ต 8090) ถูกแทนด้วยหน้านี้และลบออกจาก Pi แล้ว (2026-11-25)

## Apache config

ไฟล์ `/etc/apache2/sites-available/pit5_station.conf` (เปิดด้วย `a2ensite`, ปิด `000-default` แล้ว)
Module ที่ต้องเปิด: `rewrite proxy proxy_http`

```apache
<VirtualHost *:80>
    ServerName 127.0.0.1

    Alias /I-DOJO /var/www/pit5_station/backend/build

    <Directory /var/www/pit5_station/backend/build>
        Options FollowSymLinks
        AllowOverride None
        Require all granted

        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /I-DOJO/index.html [QSA,L]
    </Directory>

    ProxyPass        /I-DOJO/api/ http://127.0.0.1:5000/api/
    ProxyPassReverse /I-DOJO/api/ http://127.0.0.1:5000/api/

    <LocationMatch "^/I-DOJO/\.">
        Require all denied
    </LocationMatch>
</VirtualHost>
```

ถ้าเพิ่ม WebSocket / Socket.io ต้องเปิด `proxy_wstunnel` และเพิ่ม ProxyPass สำหรับ `ws://`

## ขั้นตอน deploy บน Pi

```bash
cd /var/www/pit5_station
git pull

cd backend
npm install --omit=dev

cd ../frontend
npm install
npm run build

pm2 restart pit5_station
```

ครั้งแรกเท่านั้น:

```bash
cd /var/www/pit5_station/backend
pm2 start index.js --name pit5_station
pm2 save
pm2 startup systemd   # แล้วรันคำสั่ง sudo ที่มันพิมพ์ออกมา
```

## ตรวจสอบหลัง deploy

```bash
grep -o 'src="[^"]*"' backend/build/index.html   # ต้องเห็น /I-DOJO/assets/...
curl -I http://localhost/I-DOJO/                  # ต้องได้ 200
curl -s http://localhost/I-DOJO/api/gpio | head -c 80   # ต้องขึ้น {"driver":"raspi-gpio",...
pm2 logs pit5_station --lines 20
```

## กฎสำหรับการแก้โค้ด

- ห้าม commit `.env`, `node_modules/`
- ห้าม hardcode IP, port หรือ `localhost` ในโค้ด frontend
- เพิ่ม route ใหม่ฝั่ง backend ให้อยู่ใต้ `/api/`
- ถ้าเปลี่ยน port, base path หรือโฟลเดอร์ build ให้แก้เอกสารนี้และ Apache config ด้วย
