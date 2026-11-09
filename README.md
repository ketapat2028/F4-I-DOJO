# I-DOJO

โครงสร้างโปรเจกต์นี้อ้างอิงจาก mecha1-team-building: แยก `frontend` (React + Vite + Tailwind) กับ `backend` (Node/Express + MariaDB) และมี `gas/Code.gs` สำหรับเชื่อมต่อ Google Apps Script แยกส่วนกัน

## โครงสร้าง

```
i-dojo/
├── backend/            Node.js + Express API
│   ├── index.js
│   ├── package.json
│   └── .env.example
├── frontend/           React + Vite + TypeScript + Tailwind
│   └── src/
│       ├── main.tsx
│       ├── styles/
│       └── app/
│           ├── App.tsx
│           ├── routes.tsx
│           ├── components/
│           │   └── ui/        UI primitives (button, card, input, ...)
│           ├── pages/         PlayPage, EditPage, DashboardPage
│           └── utils/         gameStore (API /api/game), portalBridge, apiClient
└── gas/Code.gs         Google Apps Script template
```

## เริ่มใช้งาน

### Backend
```
cd backend
cp .env.example .env   # ตั้งค่า DB ของตัวเอง
npm install
npm run dev             # http://localhost:5000
```

### Frontend
```
cd frontend
npm install
npm run dev              # http://localhost:5173
```

ชุดคำถามของเกมเก็บที่ backend (`/api/game`) แก้ได้ที่หน้า `/I-DOJO/editor` ด้วยรหัสผู้ดูแล (`ADMIN_SECRET`) · เกมถูกฝังเป็น iframe บนจอ Station ของ I-Dojo LPB portal ดู `PORTAL_INTEGRATION.md` · production บน Raspberry Pi ดู `DEPLOYMENT.md`

VDO ต้องเป็น MP4 H.264 ไม่เกิน 1080p ถึงจะลื่นบนจอ Station (Pi 4) — หน้า editor แปลงให้เองตอนอัปโหลด, VDO ของ portal ใช้หน้า `/I-DOJO/convert` ดู `VIDEO_GUIDE.md` · ทำแบบเดียวกันกับเกมของ station อื่น ดู `STATION_UPGRADE.md`

`/api/records`, `/api/app-config` และหน้า `/dashboard` ยังเป็นโค้ดตัวอย่างจาก template
