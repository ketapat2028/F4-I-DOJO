# อัปเกรดเกม Station ให้พร้อมใช้บนจอ Station (Pi 4 + ทีวี 55") — ทำซ้ำกับ station อื่น

> **สำหรับ Claude / dev ที่จะทำกับเกมของ station อื่น** — สรุปทุกอย่างที่ทำกับเกม I-DOJO PIT 4 5S (repo นี้) เมื่อ 2026-11-09
> ให้เปิดเอกสารนี้คู่กับโค้ดของ repo นี้ (`D:\SCRIPT\IOT\F4-I-DOJO`) แล้วทำตามทีละหัวข้อ
> สมมติว่าเกมปลายทางมีโครงเดียวกัน: `frontend/` React + Vite + Tailwind v4 (หน่วย rem), `backend/` Express + MariaDB,
> ถูกฝังเป็น iframe บนจอ Station ของ portal และมี `utils/portalBridge.ts` + `pages/PlayPage.tsx` + `pages/EditPage.tsx` แบบเดียวกัน
> เอกสารประกอบ: `PORTAL_INTEGRATION.md` (สัญญา postMessage), `VIDEO_GUIDE.md` (VDO + ตั้งค่า Pi), สเปกต้นฉบับ `D:\SCRIPT\WEB\I_DOJO_PORTAL\docs\STATION_ACTIVITY.md`

## 0. ก่อนเริ่ม — ของที่ต้องเปลี่ยนตามเกมปลายทาง

ทุกตัวอย่างในเอกสารนี้ใช้ค่าของเกมนี้ เวลาเอาไปใช้ให้เปลี่ยน:

| ในเอกสารนี้ | เปลี่ยนเป็นของเกมปลายทาง |
|---|---|
| base path `/I-DOJO/` (`vite.config.ts` `base`, `routes.tsx` `basename`) | base path ของเกมนั้น |
| IP `192.168.2.28` (เครื่อง Pi ที่รันเกม) | IP ของเกมนั้น — ใช้ใน URL ที่ใส่ใน portal และ Chrome flag |
| prefix class `f1-*`, ไฟล์ `styles/f1.css`, `F1Header` | ชื่อ/ไฟล์ CSS ของเกมนั้น (คง logic เดิม) |
| สีแบรนด์ `f1-brand` (เหลือง) | สีของเกมนั้น |

**ลำดับที่แนะนำ:** 1 → 2 → 3 → 4 → 5 → 8 แล้วตรวจข้อ 9 · ข้อ 6–7 เป็นงานตั้งค่าเครื่อง ทำแยกได้

**ไฟล์ที่ก๊อปจาก repo นี้ไปได้ทั้งไฟล์ (แทบไม่ต้องแก้):**
`frontend/src/app/utils/videoCheck.ts`, `frontend/src/app/utils/videoConvert.ts`, `frontend/src/app/pages/ConvertPage.tsx` (เปลี่ยน import `F1Header`/สี), `frontend/src/vite-env.d.ts`, `tools/convert-video.bat`, `VIDEO_GUIDE.md` (เปลี่ยน IP/URL)

---

## 1. ให้ตรงสเปก portal (`STATION_ACTIVITY.md`)

### 1.1 ฟอนต์ต้องมากับเว็บ (Pi ไม่มีอินเทอร์เน็ต)
โหลดจาก Google Fonts บน Pi = ฟอนต์ไม่ขึ้น

```bash
cd frontend
npm install --save-exact @fontsource/oswald@5.3.0 @fontsource/noto-sans-thai@5.3.0 @fontsource/jetbrains-mono@5.3.0
```

- `frontend/index.html` — **ลบ** `<link rel="preconnect" …googleapis/gstatic>` และ `<link href="https://fonts.googleapis.com/…">`
- `frontend/src/main.tsx` — import เฉพาะน้ำหนักที่ใช้ **ก่อน** `./styles/index.css`:

```ts
// ฟอนต์ bundle มากับเว็บ — Pi ของจอ Station ไม่มีอินเทอร์เน็ต ห้ามกลับไปใช้ Google Fonts (STATION_ACTIVITY.md ข้อ 5)
import "@fontsource/oswald/400.css"; // … 500 600 700
import "@fontsource/noto-sans-thai/400.css"; // … 500 600 700
import "@fontsource/jetbrains-mono/500.css"; // … 700
import "./styles/index.css";
```

ชื่อ family ใน CSS (`"Oswald"`, `"Noto Sans Thai"`, `"JetBrains Mono"`) ตรงกับ @fontsource อยู่แล้ว ถ้าเกมปลายทางใช้ฟอนต์อื่นให้ลง `@fontsource/<ชื่อ>` แทน

### 1.2 `score` ต้องเป็นจำนวนเต็ม 0–100
สเปกข้อ 3.1 — ค่าที่ไม่ใช่ 0–100 portal ทิ้ง · หน้าสรุปผลยังแสดง `ถูก X / Y` ได้ เปลี่ยนเฉพาะค่าที่ส่ง

```ts
// PlayPage.tsx ใน finish()
report({ result: passed ? "pass" : "fail", score: total > 0 ? Math.round((100 * s) / total) : 0 });
```

### 1.3 checklist ที่เกมต้องมีอยู่แล้ว (ตรวจให้ครบ)
- รับ `idojo:activity-start` เฉพาะ `event.source === window.parent` และ `version === 1` → จำ `event.origin` · ก่อนได้ใช้ `"*"`
- ส่ง `idojo:activity-result` ครั้งเดียวต่อรอบ ห้ามส่งซ้ำระหว่างรอ ack · ไม่ได้ ack ใน 10 วิ → ปุ่ม "ส่งใหม่" · `ok:false` → แสดง `message` + ส่งใหม่ได้ · ack มาช้าของผลเดียวกันยังรับ
- ส่งต่อ Enter / NumpadEnter / Space เป็น `idojo:key` (ยกเว้นตอนพิมพ์ในช่องกรอก)
- ทำทั้งหมดเฉพาะตอน `window.parent !== window` · ไม่ส่งข้อมูลพนักงาน
- ตอนถูกฝัง: ซ่อนปุ่มเล่นใหม่ (portal โหลด iframe ใหม่เอง) · เว้นขอบล่างให้ปุ่มของ portal (ข้อ 2.3)
- server ห้ามส่ง `X-Frame-Options` / CSP `frame-ancestors` · ห้าม redirect ไป host/port อื่น

---

## 2. รองรับทีวี 55" และทุกขนาดจอ — ตัวหนังสือใหญ่

### 2.1 ขยายทั้งหน้าตามขนาดจอ
Tailwind v4 ใช้ rem ทั้งหมด → เปลี่ยน `font-size` ของ `<html>` ตัวเดียว ทั้งหน้า (ตัวอักษร, padding, ปุ่ม, ไอคอน) ขยายตาม

```css
/* f1.css — หน้าเกม: 1280×720 ≈ 16px · 1920×1080 ≈ 24px · 4K ≈ 48px · เอาตัวเล็กกว่าระหว่าง vw/vh ไม่ล้นจอ */
html.f1-play-scale {
  font-size: clamp(14px, min(1.25vw, 2.22vh), 48px);
}
```

```ts
// PlayPage.tsx — ใส่เฉพาะหน้าเล่น หน้า editor คงขนาดเดิม
useEffect(() => {
  const root = document.documentElement;
  const lite = new URLSearchParams(window.location.search).get("lite") === "1"; // ข้อ 4.4
  root.classList.add("f1-play-scale");
  if (lite) root.classList.add("f1-lite");
  return () => root.classList.remove("f1-play-scale", "f1-lite", "f1-video-playing");
}, []);
```

- CSS นี้อยู่นอก `@layer` → ชนะ `html { font-size }` ใน `theme.css` ที่อยู่ใน `@layer base`
- ผลข้างเคียง: breakpoint `sm/md/lg` เป็น rem จึงเลื่อนตาม (1080p root 24px → `lg` = 1536px ยังเข้า) — ใช้ `lg:` เป็น "จอทีวี" ได้เลย

### 2.2 ขยายตัวหนังสือเพิ่มอีกขั้นบนจอใหญ่ (`lg:`)
ค่าที่ใช้ในเกมนี้ (ที่ 1080p ≈ ×1.5): คำถาม `text-xl sm:text-3xl lg:text-5xl` · ตัวเลือก `text-base sm:text-xl lg:text-3xl` + ป้าย A/B/C `lg:size-14 lg:text-2xl` · หน้าเริ่ม หัว `lg:text-5xl` กติกา `lg:text-xl` ปุ่ม `lg:h-20 lg:text-3xl` · PASS/FAIL `text-6xl lg:text-8xl` · ปุ่มใน modal `lg:h-16 lg:text-2xl` · `main` `max-w-[120rem]`
ผลที่วัดได้: 1920×1080 ตัวเลือก ≈ 45px คำถาม ≈ 72px · 4K ≈ 90/144px · 1280×600 ≈ 26/42px

### 2.3 ขอบล่างของ portal ต้องเป็น px คงที่
ปุ่ม "ENTER / SPACEBAR" ของ portal (~90px) ไม่ได้ขยายตาม root ของเรา → ห้ามใช้ `pb-28` (rem)

```ts
const PORTAL_BOTTOM_GAP = "pb-[96px]"; // ใช้กับ root ของหน้าและ overlay ของทุก modal ตอน embedded
```

### 2.4 modal สรุปผลต้องไม่ล้นลงใต้ปุ่ม portal
กล่อง: `flex max-h-full flex-col [&>*]:shrink-0` · รายการผลรายข้อ: `min-h-0 overflow-y-auto` + `style={{ flexShrink: 1 }}` (inline ชนะ `[&>*]:shrink-0`) → กล่องสูงไม่เกินพื้นที่ เลื่อนเฉพาะรายการ

---

## 3. ทุก step นุ่มและเด้งดึ๋ง (CSS ล้วน ไม่ใช้ library)

ก๊อป block keyframe จาก `frontend/src/styles/f1.css` ของ repo นี้ (ตั้งแต่ `:root { --f1-spring … }` ถึง `.f1-fade-in`) ใช้ spring curve เดียวทั้งเกม:

```css
:root {
  --f1-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --f1-spring-soft: cubic-bezier(0.22, 1.25, 0.4, 1);
}
```

| step | class | ใส่ที่ไหน |
|---|---|---|
| ปุ่ม/การ์ดทุกอัน กดยุบ-เด้งคืน | `.f1-press` (transition transform/translate + `:active` scale .94) | ปุ่มทั้งหมดในหน้าเล่น |
| หน้าเริ่ม / หน้าโหลด เด้งเข้า | `.f1-pop-in-spring` | การ์ด START |
| เปลี่ยนข้อ | `.f1-q-enter` | `<section key={\`${roundId}:${index}\`}>` การ์ดคำถาม |
| ตัวเลือกโผล่ทีละใบ | `.f1-option-in` + `style={{ animationDelay: i*80ms }}` | **กรอบนอก** ของแต่ละตัวเลือก |
| ตอบถูก / ผิด | `.f1-jelly` / `.f1-wobble` · ไอคอน ✓✗ `.f1-icon-pop` | **ปุ่มข้างใน** |
| คะแนนเพิ่ม | `.f1-bump` + `key={score}` | ตัวเลข "ถูก N" |
| จุดความคืบหน้า | `.f1-dot` (transition width/สี) · ข้อที่เพิ่งถูก `.f1-dot-pop` · ข้อปัจจุบันกว้างขึ้น | แถบจุด |
| สรุปผล | `.f1-modal-pop` กล่อง · `.f1-stamp` ตรา PASS/FAIL · `.f1-rise-in` + delay ไล่ทีละแถว | modal |
| VDO ของข้อ เปิดเต็มจอ | `.f1-fade-in` พื้นดำ + `.f1-pop-in-spring` กล่อง VDO | modal `fixed inset-0 z-50` (ไม่อยู่ในการ์ดคำถาม) แถบบน "ข้อ N / M + โจทย์" · ฝังใน portal ใช้ `PORTAL_BOTTOM_GAP` แทน padding ล่าง (อย่าใส่ `lg:p-*` ทับ ไม่งั้น `pb-[96px]` โดนแทน) · `videoDone` แล้ว modal หาย ตัวเลือกเด้งขึ้น |

**กฎที่ต้องทำตาม (เจอปัญหามาแล้ว):**
- แอนิเมชันตอนเข้า (pop-in, q-enter, option-in, icon-pop, stamp, rise-in, fade-in) ใช้ fill-mode **`backwards`** ไม่ใช่ `both` — `both` ค้าง `transform` หลังจบ ทำให้ `:active` กดยุบและ jelly/wobble ไม่ทำงาน
- **แยก element**: แอนิเมชันเข้าอยู่กรอบนอก, กด/ถูก/ผิดอยู่ปุ่มข้างใน — ถ้าอยู่ตัวเดียวกัน พอถอด class jelly/wobble ออก animation ตอนเข้าจะเล่นซ้ำ
- ใช้ `key` ให้ element ใหม่เมื่อต้องการเล่นซ้ำ (เปลี่ยนข้อ, คะแนนเพิ่ม)
- ทุก class ใหม่ต้องเพิ่มใน block `@media (prefers-reduced-motion: reduce)` และใน block โหมดเบา (ข้อ 4.4)

---

## 4. ลื่นบน Raspberry Pi 4

### 4.1 animate ได้แค่ `transform` กับ `opacity`
| เดิม (หนัก) | เปลี่ยนเป็น |
|---|---|
| ปุ่มเรืองแสง `@keyframes` animate `box-shadow` | เงาวาดครั้งเดียวใน `.f1-glow::after` แล้ว animate `opacity` + ตัวปุ่ม `transform: scale` |
| นาฬิกาเต้น animate `box-shadow` | `.f1-clock-pulse::after` แบบเดียวกัน |
| แถบเวลา transition `width` (layout ทุกวินาที) | `w-full origin-left` + `style={{ transform: \`scaleX(${remaining / limit})\` }}` |
| `transition-all` ใน `ui/button.tsx` | `transition-[color,background-color,border-color,opacity]` |
| จุดความคืบหน้า transition `box-shadow` | ตัดออก |

เพิ่ม `will-change: opacity` ให้แฟลชเต็มจอ, `will-change: transform` ให้ confetti และลด confetti 48 → 28 ชิ้น (`Confetti.tsx`)

### 4.2 หยุดแอนิเมชันที่วนไม่หยุดระหว่าง VDO เล่น
```ts
// PlayPage.tsx
function setVideoPlaying(on: boolean) {
  document.documentElement.classList.toggle("f1-video-playing", on);
}
// <video onPlaying={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} …>
// ใน QuestionVideo: useEffect(() => () => setVideoPlaying(false), []);
```
```css
html.f1-video-playing .f1-glow, html.f1-video-playing .f1-glow::after,
html.f1-video-playing .f1-timer-blink,
html.f1-video-playing .f1-clock-pulse, html.f1-video-playing .f1-clock-pulse::after {
  animation-play-state: paused;
}
```

### 4.3 โหลด VDO ข้อถัดไปล่วงหน้า
เฉพาะตอน VDO ข้อปัจจุบันจบแล้ว (ไม่แย่งตัวถอดรหัส) และข้อเดียว:
```tsx
{phase === "playing" && videoDone && rounds[index + 1]?.pair.video && (
  <video key={rounds[index + 1].pair.video} src={rounds[index + 1].pair.video} preload="auto" muted playsInline className="hidden" aria-hidden />
)}
```

### 4.4 โหมดเบา `?lite=1`
ใส่ท้าย URL กิจกรรมในหน้า Admin ของ portal (`http://<IP>/<BASE>/?lite=1` — origin เดิม ผลยังส่งได้) → class `f1-lite` ที่ `<html>` (ข้อ 2.1)
ใน CSS: entry animation ทั้งหมด → `f1-fade-in 0.2s` · jelly/wobble/icon-pop/bump/dot-pop/glow/clock-pulse/timer-blink → `animation: none` · แฟลชเต็มจอ + confetti → `display: none` (ดู block `html.f1-lite` ท้าย `f1.css`)

### 4.5 ผลที่วัดได้
headless Chrome ลด CPU 4 เท่า (ประมาณ Pi 4) เล่นทั้งรอบที่ 1920×1080: เฟรมที่ช้ากว่า 33ms **2.5–6% → ~1.2%** · Layout −60% · Paint −50%

---

## 5. VDO — ตรวจ แปลง แล้วค่อยอัปโหลด

Pi 4 + Chromium ถอดรหัสด้วยฮาร์ดแวร์ได้แค่ **MP4 H.264 ≤ 1920×1080** (แนวตั้ง ≤ 1080×1920) — HEVC/VP9/AV1/4K = CPU = กระตุก
สเปกเต็ม + ตั้งค่า Pi ดู `VIDEO_GUIDE.md` (ก๊อปไปแล้วเปลี่ยน IP)

### 5.1 ตรวจไฟล์ — `utils/videoCheck.ts` (ก๊อปทั้งไฟล์)
`inspectVideo(file): Promise<string[]>` คืนคำเตือนภาษาไทย (ว่าง = ผ่าน) อ่านในเบราว์เซอร์ล้วน:
อ่านกล่อง MP4 ชั้นบน (`moov` ก่อน `mdat` = faststart) · หา fourcc ใน `moov` (`avc1` ผ่าน · `hvc1/hev1/vp09/av01/mp4v` เตือน) · `.webm/.ogv` เตือน · โหลด metadata เตือน > 1920×1080 หรือ > 8 Mbps

### 5.2 แปลงในเบราว์เซอร์ — `utils/videoConvert.ts` (ก๊อปทั้งไฟล์)
```bash
cd frontend && npm install --save-exact mediabunny@1.62.1
```
- `convertForPi(file, { onProgress, signal })` → `{ file: <ชื่อ>_pi.mp4, reencoded, from, to }`
  - ผลลัพธ์: H.264 · ย่อให้พอดี 1920×1080 / 1080×1920 ไม่ขยาย · ≤ 30fps · ~5 Mbps แต่**ไม่เกิน bitrate เดิม** · AAC (เครื่องไม่มี AAC encoder → Opus) · `fastStart: 'in-memory'` · keyframe ทุก 2 วิ
  - ต้นฉบับเป็น H.264 อยู่แล้ว ขนาด/fps/bitrate ไม่เกิน → **ไม่เข้ารหัสใหม่** แค่จัดไฟล์ใหม่ (0.2 วิ ไม่เสียคุณภาพ)
- `canConvertVideo()` / `convertUnavailableReason()` — เช็ค WebCodecs + secure context แล้วบอกวิธีแก้เป็นภาษาไทย
- `import("mediabunny")` แบบ dynamic → แยก chunk (~750 kB) โหลดเฉพาะตอนแปลง หน้าเกมไม่หนักขึ้น

**บทเรียน (อย่าเสียเวลาซ้ำ):**
- ❌ `new Quality(5_000_000)` → แปลงพังด้วย `Encoding error.` · ✅ `new Quality({ bitrate: 5_000_000 })`
- หลัง `npm install mediabunny` ครั้งแรก Vite dev จะ optimize แล้ว **reload หน้าเอง 1 ครั้ง** — test อัตโนมัติที่รันตอนนั้นจะพัง ("Execution context was destroyed") ไม่ใช่บั๊ก รันใหม่
- **WebCodecs ใช้ได้เฉพาะ https หรือ localhost** — เปิดผ่าน `http://<IP ของ Pi>` ไม่มี `VideoEncoder` (ทดสอบแล้ว) → ต้องตั้ง Chrome flag ข้อ 7 · ตั้งแล้วใช้ได้ (ทดสอบแล้ว)

### 5.3 หน้า editor แปลงให้อัตโนมัติ — `VideoField` ใน `EditPage.tsx`
ยก component `VideoField` จาก repo นี้ไปแทนของเดิม (ใช้ `onUpload(file, onProgress)` ตัวเดิมของ EditPage) ลำดับ:
1. เกิน 2GB → ปฏิเสธ
2. `inspectVideo` → ไม่มีคำเตือน + ≤ 300MB + นามสกุลที่ backend รับ → อัปโหลดเลย
3. มีปัญหา → `canConvertVideo()` ไม่ได้ → กล่องแดงบอกวิธีตั้ง flag + ปุ่ม "อัปโหลดไฟล์เดิมไปก่อน"
4. แปลง (แถบ % + ปุ่มยกเลิก) → อัปโหลด `_pi.mp4` → ขึ้น "3840×2160 44.9MB → 1920×1080 10.1MB"
5. แปลงพัง → แสดงเหตุผล + ปุ่ม "อัปโหลดไฟล์เดิมไปก่อน"
- `accept` รับ `.mov .mkv` เพิ่ม (แปลงเป็น MP4 เสมอ) · backend ไม่ต้องแก้ (ได้ไฟล์ `.mp4` ≤ 300MB เหมือนเดิม)

### 5.4 หน้าแปลงแยก `/convert` — สำหรับ VDO ของ portal
- ก๊อป `pages/ConvertPage.tsx` · `routes.tsx` เพิ่ม `{ path: '/convert', Component: ConvertPage }` · header เพิ่มลิงก์ "แปลง VDO"
- ลากหลายไฟล์ → ตรวจ → ไฟล์ที่มีปัญหาเข้าคิวแปลงทีละไฟล์ → ปุ่มดาวน์โหลด `_pi.mp4` · ไฟล์ดีอยู่แล้วบอก "ใช้ได้เลย" (กด "แปลงอยู่ดี" ได้)
- portal ใช้หน้าเดียวกันได้จาก station ไหนก็ได้ ไม่ต้องมีทุกเกมก็ได้

### 5.5 ทางสำรอง — `tools/convert-video.bat` (ก๊อปทั้งไฟล์)
ลากไฟล์ไปวาง ใช้ ffmpeg (`winget install Gyan.FFmpeg`) — สำหรับไฟล์ที่เบราว์เซอร์อ่านไม่ได้ (เช่น HEVC บน PC ที่การ์ดจอไม่รองรับ, ไฟล์เสีย)

### 5.6 สิ่งที่เจอในไฟล์จริง (2026-11-09)
- VDO ของ portal มีไฟล์ **4K 23 Mbps** และ **720p 10.8 Mbps ไม่มี faststart** → แปลงแล้วได้ 1080p 10.6MB / ~5 Mbps
- มีไฟล์ VP9 320×180 ยาว 1–2 วิ หลายไฟล์ (น่าจะเป็น fixture ทดสอบของ portal) — เบราว์เซอร์อ่านไม่ได้ ใช้ .bat
- VDO เกมนี้เป็น H.264 แนวตั้ง แต่ไม่มี faststart → จัดไฟล์ใหม่
→ ตรวจ VDO ของ station ใหม่ด้วยหน้า `/convert` ก่อนใช้จริง

---

## 6. ตั้งค่า Pi 4 ของจอ Station (ทำที่เครื่อง ทุกจอ)
รายละเอียดใน `VIDEO_GUIDE.md` ข้อ 3 สรุป:
1. ส่งภาพออกจอ **1920×1080@60 ไม่ใช่ 4K** (Screen Configuration / `wlr-randr --output HDMI-A-1 --mode 1920x1080@60` / `video=HDMI-A-1:1920x1080@60` ใน `/boot/firmware/cmdline.txt`)
2. ใช้ Chromium จาก repo ของ Raspberry Pi OS (ไม่ใช่ snap/flatpak)
3. เปิด VDO แล้วดู `chrome://media-internals` → `kVideoDecoderName` ต้องเป็น `V4L2…` (ฮาร์ดแวร์) — ใช้เช็ค VDO แนวตั้ง 1080×1920 ด้วย (ยังไม่ได้ยืนยันบนเครื่องจริง)
4. ฮีตซิงก์/พัดลม + อะแดปเตอร์ 5V 3A · `vcgencmd get_throttled` ต้องได้ `0x0`
5. kiosk แท็บเดียว · ยังกระตุก → URL กิจกรรมใส่ `?lite=1`

## 7. ตั้งค่า PC ผู้ดูแล (ครั้งเดียวต่อเครื่อง)
ให้แปลง VDO ในหน้า editor / `/convert` ได้:
1. Chrome `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (Edge `edge://flags/#unsafely-treat-insecure-origin-as-secure`)
2. ใส่ `http://<IP ของเกม station นั้น>` (หลายเกมคั่นด้วย `,` เช่น `http://192.168.2.28,http://192.168.2.29`) → **Enabled** → **Relaunch**
- ใช้ Chrome/Edge บน PC เท่านั้น ไม่แปลงบน Pi (ช้ามาก)

## 8. อื่น ๆ ที่แก้ระหว่างทาง
- `frontend/src/vite-env.d.ts` = `/// <reference types="vite/client" />` (แก้ error `import.meta.env`)
- `main.tsx` → `import App from "./app/App"` (ไม่ใส่ `.tsx`)
- → `npx tsc --noEmit -p frontend` ต้องไม่มี error

---

## 9. ตรวจหลังทำ (checklist)
- [ ] `npx tsc --noEmit -p frontend` สะอาด · `npm run build` ผ่าน
- [ ] `grep -r "googleapis\|gstatic" backend/build` ไม่เจอ · มีไฟล์ `.woff2` ใน `backend/build/assets` และ URL ขึ้นต้นด้วย base path
- [ ] mediabunny อยู่ chunk แยก (build มี `.js` ใหญ่ ~750 kB อีกไฟล์) ไม่ได้อยู่ใน bundle หลัก
- [ ] เล่นทั้งรอบ (เริ่ม → ตอบผิด → ป๊อปอัป → ตอบถูกจนจบ → สรุปผล) ที่ 3840×2160, 1920×1080, 1366×768, 1280×600, มือถือ 390×844 — ไม่มี scrollbar / ไม่ล้นจอ
- [ ] ฝังใน iframe 1920×960 และ 1280×600 (หน้า html ชั่วคราวที่มี `<iframe sandbox="allow-scripts allow-same-origin allow-forms">`) — ทุก modal จบเหนือขอบล่าง 96px
- [ ] หน้า `/editor` ขนาดตัวอักษรเดิม (ไม่โดน `f1-play-scale`)
- [ ] `?lite=1` → `<html>` มี `f1-lite` · ตอบผิดไม่มีแฟลช · จบไม่มี confetti
- [ ] ข้อที่มี VDO: ระหว่างเล่น `<html>` มี `f1-video-playing` · จบแล้วหายและตัวเลือกขึ้น · ข้อก่อนหน้ามี `<video class="hidden" preload="auto">` ของข้อถัดไป
- [ ] DevTools → Rendering → `prefers-reduced-motion: reduce` → ไม่มีแอนิเมชัน เกมยังเล่นได้
- [ ] score ที่ส่ง portal เป็น 0–100
- [ ] editor: เลือกไฟล์ 4K → แปลง → อัปโหลดไฟล์ `_pi.mp4` (ไม่ใช่ต้นฉบับ) → URL เข้าข้อ · ไฟล์ H.264 ที่ไม่มี faststart → "จัดไฟล์ให้เริ่มเล่นได้ทันทีแล้ว"
- [ ] `/convert`: ลากหลายไฟล์ → ดาวน์โหลดได้ · เปิดผ่าน `http://<IP>` โดยยังไม่ตั้ง flag → กล่องแดงบอกวิธี
- [ ] บนจอ Station จริง: ทำ 4 ข้อของ `STATION_ACTIVITY.md` ข้อ 7 (fail → โหลดใหม่, pass → สถานีถัดไป, Enter = ผ่าน, ถอด LAN → ok:false → ส่งใหม่) + `chrome://media-internals` + `vcgencmd get_throttled`

วิธีทดสอบอัตโนมัติที่ใช้กับ repo นี้: `puppeteer-core` + Chrome ในเครื่อง + mock API เล็ก ๆ (node `http`) ตอบ `/api/game`, `/api/admin/check`, `/api/upload-video` แล้ว `page.setRequestInterception` ชี้ `/<BASE>/api/` ไป mock · วัดเฟรมด้วย `page.emulateCPUThrottling(4)` + `requestAnimationFrame` · ทดสอบ origin ที่ไม่ secure ด้วย `--host-resolver-rules=MAP fake.test 127.0.0.1` แล้วเสิร์ฟ `backend/build`

---

## 10. รายการไฟล์ทั้งหมด (repo นี้)

| ไฟล์ | ใหม่/แก้ | เอาไปใช้ |
|---|---|---|
| `frontend/src/app/utils/videoCheck.ts` | ใหม่ | ก๊อปทั้งไฟล์ |
| `frontend/src/app/utils/videoConvert.ts` | ใหม่ | ก๊อปทั้งไฟล์ |
| `frontend/src/app/pages/ConvertPage.tsx` | ใหม่ | ก๊อป แล้วเปลี่ยน header/สี |
| `frontend/src/vite-env.d.ts` | ใหม่ | ก๊อปทั้งไฟล์ |
| `tools/convert-video.bat` | ใหม่ | ก๊อปทั้งไฟล์ |
| `VIDEO_GUIDE.md` | ใหม่ | ก๊อป แล้วเปลี่ยน IP/URL |
| `frontend/src/styles/f1.css` | แก้ | ก๊อป block: play-scale, spring/keyframe ใหม่, glow/clock-pulse `::after`, `will-change`, reduced-motion, `f1-video-playing`, `f1-lite` |
| `frontend/src/app/pages/PlayPage.tsx` | แก้ | ทำตามข้อ 1.2, 2, 3, 4 (ปรับเข้ากับเกมนั้น) |
| `frontend/src/app/pages/EditPage.tsx` | แก้ | ยก `VideoField` (ข้อ 5.3) |
| `frontend/src/app/routes.tsx`, `components/F1Header.tsx` | แก้ | route + ลิงก์ `/convert` |
| `frontend/src/app/components/ui/button.tsx` | แก้ | เลิก `transition-all` |
| `frontend/src/app/components/Confetti.tsx` | แก้ | 28 ชิ้น |
| `frontend/src/main.tsx`, `frontend/index.html` | แก้ | ฟอนต์ @fontsource, import ไม่มีนามสกุล |
| `frontend/package.json` | แก้ | `@fontsource/oswald`, `@fontsource/noto-sans-thai`, `@fontsource/jetbrains-mono` 5.3.0 · `mediabunny` 1.62.1 |
| `CLAUDE.md`, `CHANGELOG.md` | แก้ | เขียนของเกมนั้นเอง |

backend **ไม่ได้แก้** (ใช้ `/api/upload-video` เดิม ≤ 300MB)
