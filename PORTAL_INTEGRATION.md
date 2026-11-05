# เชื่อมกับจอ Station ของ I-Dojo LPB portal (iframe)

> **สำหรับ Claude / dev ที่ทำงานใน repo นี้** — เกมนี้จะถูกเปิดใน `<iframe>` บนจอ Station ของ portal I-Dojo LPB ในช่วงอบรม
> และต้อง**ส่งผล ผ่าน/ไม่ผ่าน กลับไปที่ portal** ตามสัญญาข้างล่าง · เขียนจากฝั่ง portal เมื่อ 2026-10-17 (ยังไม่ได้แก้โค้ดของ repo นี้)
> ต้นฉบับสเปก: `D:\SCRIPT\WEB\I_DOJO_PORTAL\docs\STATION_ACTIVITY.md` · หน้าตัวอย่างที่ใช้ได้จริง: `D:\SCRIPT\WEB\I_DOJO_PORTAL\client\public\station-activity-demo.html`
> ทำงานตามกฎของ repo นี้เสมอ (`CLAUDE.md`, `DEPLOYMENT.md`): base path `/I-DOJO/`, ไม่ hardcode IP/port, route ใหม่อยู่ใต้ `/api/`

## 1. ภาพรวม

```
portal (Jetson)  /station/<รหัสจอ>                       เกมนี้ (Pi 192.168.2.28)
┌──────────────────────────────┐   iframe src=http://192.168.2.28/I-DOJO/
│ วิดีโอ 1 → วิดีโอ 2 → [iframe] ├──────────────▶ PlayPage
│                              │ ◀── idojo:activity-result (pass/fail)
│ บันทึกผล → ack ──────────────▶│     idojo:activity-ack
└──────────────────────────────┘
```

- Admin ของ portal ใส่ URL `http://192.168.2.28/I-DOJO/` เป็น "กิจกรรม (iframe)" ของ Station
- ถึงคิวกิจกรรม จอเปิด iframe แล้ว**รอผล** — ผ่าน = กลุ่มผ่าน Station นี้ · ไม่ผ่าน = บันทึก แล้วโหลด iframe ใหม่ (~2.5 วิ) ให้เล่นใหม่
- วิทยากรกด Enter/Spacebar ที่จอ = ผ่านทันทีได้ทุกเมื่อ (เกมไม่ต้องจัดการ)
- ผลเป็นของ**ทั้งกลุ่ม** — ห้ามส่งชื่อ/รหัสพนักงานใด ๆ ไป portal
- iframe ของ portal: `sandbox="allow-scripts allow-same-origin allow-forms"` + `allow="autoplay; fullscreen"` → ไม่มี popup, ไม่เปลี่ยนหน้าบนสุด, เล่นวิดีโอ/เสียงได้

## 2. สัญญา postMessage (version 1)

ทุกข้อความเป็น object มี `version: 1` (ตัวเลข) · ข้อความที่ผิดรูปแบบ portal จะละไว้เงียบ ๆ

| ทิศทาง | ข้อความ | เมื่อไหร่ |
|---|---|---|
| portal → เกม | `{ type: "idojo:activity-start", version: 1, stationNo, sessionId }` | ทุกครั้งที่ iframe โหลดเสร็จ — **จำ `event.origin` ไว้** เป็นปลายทางส่งกลับ |
| เกม → portal | `{ type: "idojo:activity-result", version: 1, result: "pass" \| "fail", score?: 0–100 }` | จบเกม (ดูข้อ 3) · `score` จำนวนเต็ม 0–100 ไม่บังคับ เก็บไว้ดูเท่านั้น |
| portal → เกม | `{ type: "idojo:activity-ack", version: 1, result: "pass" \| "fail", ok: true }` หรือ `ok: false, message` | หลังบันทึก · `ok:false` = บันทึกไม่สำเร็จ → แสดง `message` ให้ส่งใหม่ได้ |
| เกม → portal | `{ type: "idojo:key", version: 1, key: "Enter" \| "Space" }` | ส่งต่อปุ่มของวิทยากร เมื่อ focus อยู่ในเกม (portal ถือว่า = ผ่าน) |

- ส่งด้วย `window.parent.postMessage(msg, screenOrigin)` — ก่อนได้ `activity-start` ใช้ `"*"` ได้ (portal ตรวจ origin เอง)
- รับเฉพาะข้อความที่ `event.source === window.parent`
- **ทำทั้งหมดนี้เฉพาะตอนถูกฝัง** (`window.parent !== window`) — เปิดเกมตรง ๆ ต้องทำงานเหมือนเดิมทุกอย่าง
- ส่งผล 1 ครั้งต่อ 1 เกม · ระหว่างรอ ack ห้ามส่งซ้ำ (portal จะไม่ตอบข้อความซ้ำ) · ไม่ได้ ack ใน ~10 วิ = ถือว่ายังไม่บันทึก

> **อัปเดตโหมดเล่นใหม่ (ดู VDO → ตอบทีละข้อ):** ตารางด้านล่างเขียนตามโหมดจับคู่เดิม · ในโหมดใหม่ `pass` ส่งเมื่อตอบถูกครบทุกข้อ (`finishGame(true)`), `fail` เมื่อหมดเวลา (`finishGame(false)`), `score` = % ข้อที่ตอบถูกตั้งแต่ครั้งแรก · ตอบผิดระหว่างเล่นไม่ส่งอะไร (เลือกใหม่ได้ไม่จำกัด) · เวลานับเฉพาะตอนตอบ ไม่นับตอนดู VDO · VDO ข้อแรกเริ่มเล่นเองทันที ถ้า iframe บล็อก autoplay จะขึ้นปุ่ม "แตะเพื่อเริ่มดู VDO" (ถ้าจะให้เล่นเองได้ ต้องใส่ `allow="autoplay"` ที่ iframe ฝั่ง portal)

## 3. จับคู่กับโค้ดเกมที่มีอยู่ (`frontend/src/app/pages/PlayPage.tsx` → `handleCheck`)

| สถานการณ์ในเกม | ส่งอะไร |
|---|---|
| ตรวจแล้วถูกครบ (`allCorrect`, `phase → "finished"`) | `pass`, `score = Math.round(100 * score / total)` |
| หมดเวลา (`isAuto && !allCorrect`, `phase → "timeout"`) | `fail`, `score` เหมือนกัน — portal จะโหลดเกมใหม่เอง |
| กดตรวจแล้วยังมีข้อผิด แต่เวลายังไม่หมด | **ไม่ส่ง** — ให้แก้ต่อ ("ลองใหม่เฉพาะข้อผิด") จนกว่าจะถูกครบหรือหมดเวลา (Korn 2026-10-17) |
| เกมไม่จำกัดเวลา (`timeLimitSeconds: 0`) | ตอนถูกฝังใช้ 5 นาทีแทน (`EMBED_DEFAULT_LIMIT`) และนาฬิกาเริ่มนับทันทีที่โหลดเกม ไม่รอผู้เล่นแตะ — จึงมี `fail` เสมอ (Korn 2026-10-20) |
| ปุ่ม "เล่นใหม่" / "รีเซ็ตทั้งหมด" | ตอนถูกฝัง**ซ่อน** (รีเซ็ต = เวลาเริ่มใหม่) · หลังส่งผลแล้วซ่อน "ลองใหม่เฉพาะข้อผิด" ด้วย แสดงว่า "จอจะไปสถานีถัดไปเอง" (pass) / "จอจะโหลดเกมใหม่ให้ลองอีกครั้ง" (fail) ให้ portal จัดการต่อ · เหลือแค่ "ส่งใหม่" ตอนส่งไม่สำเร็จ |
| ack มาช้ากว่า 10 วิ | ขึ้น "ส่งไม่สำเร็จ" ก่อน แต่ถ้า ack ของผลเดียวกันตามมาทีหลัง เปลี่ยนเป็น "ส่งผลแล้ว" ไม่ต้องกดส่งซ้ำ |

แนะนำ: ส่งผลตอนเปิด modal ผลการแข่ง (ผู้เล่นยังเห็นสรุปคะแนนระหว่าง portal บันทึก) และแสดงสถานะ "กำลังส่งผล… / ส่งผลแล้ว / ส่งไม่สำเร็จ [ส่งใหม่]" ใน modal เมื่อถูกฝัง

## 4. โค้ดที่แนะนำ

ไฟล์ใหม่ `frontend/src/app/utils/portalBridge.ts` แล้วเรียกจาก `PlayPage` (คอมเมนต์ในโค้ดเป็นภาษาไทยตามธรรมเนียม repo นี้):

```ts
// เชื่อมกับจอ Station ของ portal I-Dojo — สัญญาใน PORTAL_INTEGRATION.md (version 1)
const VERSION = 1;
export type PortalAck = { result: "pass" | "fail"; ok: boolean; message?: string };

export const isEmbedded = (): boolean => window.parent !== window;
let screenOrigin: string | null = null;

function send(msg: Record<string, unknown>) {
  if (!isEmbedded()) return;
  window.parent.postMessage({ version: VERSION, ...msg }, screenOrigin ?? "*");
}

// ฟัง activity-start / activity-ack — คืนฟังก์ชันยกเลิก (ใช้ใน useEffect)
export function listenPortal(onAck: (ack: PortalAck) => void, onStart?: (d: { stationNo: number | null; sessionId: number | null }) => void) {
  function onMessage(e: MessageEvent) {
    if (e.source !== window.parent || e.data?.version !== VERSION) return;
    if (e.data.type === "idojo:activity-start") { screenOrigin = e.origin; onStart?.(e.data); }
    if (e.data.type === "idojo:activity-ack") onAck({ result: e.data.result, ok: Boolean(e.data.ok), message: e.data.message });
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export function sendResult(result: "pass" | "fail", score?: number) {
  send({ type: "idojo:activity-result", result, ...(Number.isInteger(score) ? { score } : {}) });
}

// ส่งต่อ Enter/Spacebar ของวิทยากรขึ้นไปที่จอ (ยกเว้นตอนพิมพ์ในช่องกรอก)
export function forwardKeys() {
  function onKey(e: KeyboardEvent) {
    if (!isEmbedded() || (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (["Enter", "NumpadEnter", "Space"].includes(e.code)) { e.preventDefault(); send({ type: "idojo:key", key: e.code === "Space" ? "Space" : "Enter" }); }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
```

ใน `PlayPage`: `useEffect(() => listenPortal(setAck), [])` + `useEffect(() => forwardKeys(), [])` · ใน `handleCheck` ถ้า `allCorrect` → `sendResult("pass", pct)`, ถ้า `isAuto && !allCorrect` → `sendResult("fail", pct)` · กันส่งซ้ำด้วย state `sending` จนกว่าจะได้ ack
⚠ `forwardKeys` จะกิน Enter/Space ทั้งหน้า — เช็คว่าไม่มีปุ่ม/การลากในเกมที่ต้องใช้ Space/Enter (ตอนนี้ไม่มี keydown ในเกม) · ปุ่มที่ focus อยู่จะไม่ถูกกด Enter อีกต่อไปเมื่อถูกฝัง — ยอมรับได้เพราะเล่นด้วยการแตะ

## 5. งานที่ต้องทำก่อนใช้จริง: ย้ายชุดคำถามไป backend (Korn 2026-10-17)

**ปัญหา:** ตอนนี้ชุดคำถาม (`gameStore.ts`) เก็บใน **localStorage อย่างเดียว** และ Chromium **แยก storage ของ iframe ที่ฝังข้ามเว็บ** (portal อยู่ `192.168.2.35`, เกมอยู่ `192.168.2.28` = คนละ site)
→ ชุดคำถามที่แก้ในหน้า `/I-DOJO/editor` (เปิดตรง) จะ**ไม่เห็นในเกมที่อยู่ใน iframe** — จอ Station จะเห็นแค่ข้อมูล demo F1 และแต่ละจอ/browser ก็แยกกัน

**ทำ:**
- เก็บเกม (ชื่อ, เวลาจำกัด, pairs) ใน MariaDB ของ repo นี้ — ใช้ `/api/app-config` (singleton JSON ที่มีอยู่) หรือทำ table/route ใหม่ใต้ `/api/` ก็ได้
- `gameStore.ts` คืน Promise อยู่แล้ว → สลับ `getGame`/`saveGame` เป็น API โดยไม่ต้องแก้หน้าเกม · คง import/export JSON ทั้ง 2 รูปแบบ (`SpecRecord` + legacy) ตามกฎใน `CLAUDE.md`
- รูปเลิกเก็บเป็น base64 → อัปโหลดผ่าน `/api/upload` ที่มีอยู่ แล้วเก็บ URL (`/I-DOJO/api/uploads/<file>`)
- **การบันทึกต้องมีการป้องกัน** — `POST /api/app-config` ตอนนี้ไม่ตรวจสิทธิ์ ใครใน LAN ก็แก้ข้อสอบได้ อย่างน้อยใช้ `x-admin-secret` แบบเดียวกับ `DELETE /api/records`
- เกมที่โหลดใน iframe ต้องอ่านจาก API เท่านั้น (ไม่ fallback ไป demo เงียบ ๆ ถ้าโหลดไม่ได้ — แสดงข้อความแทน)
- เพิ่ม env ใหม่ (ถ้ามี) ใน `.env.example` + ตารางใน `DEPLOYMENT.md`

## 6. ข้อควรระวังอื่น

- **URL ที่ใส่ใน portal** = `http://192.168.2.28/I-DOJO/` → portal รับผลจาก origin `http://192.168.2.28` เท่านั้น ห้าม redirect ไป host/port อื่น (เช่น `:5000`) ไม่งั้นผลถูกทิ้ง
- **ห้ามส่ง `X-Frame-Options` หรือ CSP `frame-ancestors`** ที่บล็อกการฝัง (Apache ใน `DEPLOYMENT.md` ไม่ส่งอยู่แล้ว — อย่าเพิ่ม) ไม่งั้น iframe ว่าง
- **ขอบล่างประมาณ 90px** ตรงกลาง portal วางปุ่ม "ENTER / SPACEBAR · ผ่านสถานี" ทับ — อย่าวางปุ่มสำคัญตรงนั้นตอนถูกฝัง
- พื้นที่ iframe ≈ 1920×960 บนทีวี (ขั้นต่ำ 1280×600) · จอสัมผัส · Chromium บน Pi ของ portal
- Pi ไม่มีอินเทอร์เน็ต — ฟอนต์/JS/รูปต้องมาจาก LAN ทั้งหมด · ไม่มีวิดีโอสอนในเกมแล้ว (ตัดออกทั้งฟีเจอร์)
- หลังได้ `fail` portal จะโหลด iframe ใหม่ = state เกมเริ่มใหม่หมด (ไม่ต้องรีเซ็ตเอง)

## 7. ทดสอบ

**ทดสอบเดี่ยว (ไม่ต้องมี portal):** หน้า HTML ชั่วคราวนอก repo ฝังเกมแล้ว log ข้อความ

```html
<!doctype html><meta charset="utf-8">
<iframe id="f" src="http://192.168.2.28/I-DOJO/" style="width:1280px;height:720px" sandbox="allow-scripts allow-same-origin allow-forms" allow="autoplay; fullscreen"></iframe>
<pre id="log"></pre>
<script>
  const f = document.getElementById('f'), log = t => document.getElementById('log').textContent += t + '\n'
  f.onload = () => f.contentWindow.postMessage({ type: 'idojo:activity-start', version: 1, stationNo: 1, sessionId: 1 }, 'http://192.168.2.28')
  addEventListener('message', e => {
    if (e.source !== f.contentWindow) return
    log(e.origin + ' ' + JSON.stringify(e.data))
    if (e.data?.type === 'idojo:activity-result')
      f.contentWindow.postMessage({ type: 'idojo:activity-ack', version: 1, result: e.data.result, ok: true }, e.origin)
  })
</script>
```

ตรวจ: ถูกครบ → `pass` + score 100 · หมดเวลา → `fail` · ตอบผิดบางข้อตอนเวลายังเหลือ → ไม่มีข้อความ · แตะในเกมแล้วกด Enter → `idojo:key` · เปิด `/I-DOJO/` ตรง ๆ → ไม่มี error และเล่นได้เหมือนเดิม

**ทดสอบกับ portal จริง** (เครื่อง dev ของ portal `D:\SCRIPT\WEB\I_DOJO_PORTAL`):
1. `cd server && npm run db:fixtures && npm run dev` · `cd client && npm run dev`
2. login `FX001` / `Fixture-2026` → `http://localhost:5173/admin/station-videos` → เลือก **ST2** → การ์ด "ระหว่างอบรม" → **+ กิจกรรม (iframe)** ใส่ `http://192.168.2.28/I-DOJO/` → **บันทึกการเปลี่ยนแปลง**
3. เปิด `http://localhost:5173/station/FX-R3-ST2` → เล่นจนหมดเวลา = ท้ายจอขึ้น "ยังไม่ผ่าน" แล้วเกมโหลดใหม่ · เล่นถูกครบ = ST2 ผ่าน

## 8. Checklist

- [x] `portalBridge.ts` + เรียกใน `PlayPage` (ส่งเฉพาะตอนถูกฝัง)
- [x] pass ตอนถูกครบ · fail ตอนหมดเวลา · ไม่ส่งตอนผิดแต่เวลาเหลือ · กันส่งซ้ำ · แสดงสถานะ ack
- [x] ส่งต่อ Enter/Space
- [x] ย้ายชุดคำถาม + รูปไป backend (ข้อ 5) พร้อมป้องกันการบันทึก — `GET/PUT /api/game` + `x-admin-secret` (ผู้ดูแลกรอกรหัสในหน้า editor) · รูปเก็บใน DB (`/api/images/<id>`)
- [ ] ทดสอบเดี่ยว + ทดสอบกับ portal (ข้อ 7) + เปิดเกมตรง ๆ ยังใช้ได้ — ทดสอบเดี่ยวผ่านแล้วบนเครื่อง dev (headless Chrome + DB จำลอง, 2026-10-17) · **ยังไม่ได้ทดสอบบน Pi จริงและกับ portal จริง**
- [x] `npm run build` (base `/I-DOJO/`) · อัปเดต `CHANGELOG.md` · ถ้าเปลี่ยน env/route อัปเดต `DEPLOYMENT.md`
- [ ] แจ้ง portal ถ้าต้องเปลี่ยนสัญญา — อย่าเปลี่ยนรูปแบบข้อความเอง (portal ตรวจ `version: 1` ตรงตัว)
