// ตรวจไฟล์ VDO ก่อนอัปโหลด ว่าจะเล่นลื่นบนจอ Station (Raspberry Pi 4 + Chromium) ไหม — ดู VIDEO_GUIDE.md
// Pi 4 ถอดรหัสด้วยฮาร์ดแวร์ได้เฉพาะ H.264 ไม่เกิน 1080p · codec อื่นหรือภาพใหญ่กว่านี้ใช้ CPU → กระตุก
// คืนคำเตือนภาษาไทย (ว่าง = ผ่าน) · แค่เตือน ไม่ขวางการอัปโหลด · อ่านไฟล์ไม่ออกก็ไม่เตือน

const MAX_W = 1920;
const MAX_H = 1080;
const MAX_MBPS = 8;
// moov ใหญ่กว่านี้ไม่อ่านทั้งก้อน (ปกติไม่กี่ MB)
const MOOV_READ_LIMIT = 16 * 1024 * 1024;

type Box = { type: string; start: number; size: number };

async function readBytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

// อ่านกล่องชั้นบนสุดของ MP4 (ftyp, moov, mdat, ...) โดยอ่านแค่หัวกล่องทีละอัน ไม่โหลดทั้งไฟล์
async function topLevelBoxes(file: Blob): Promise<Box[]> {
  const boxes: Box[] = [];
  let pos = 0;
  while (pos + 8 <= file.size && boxes.length < 64) {
    const head = await readBytes(file, pos, 16);
    const view = new DataView(head.buffer);
    let size = view.getUint32(0);
    const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break; // ไม่ใช่ MP4
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(view.getBigUint64(8)); // ขนาด 64-bit (ไฟล์ใหญ่)
    } else if (size === 0) {
      size = file.size - pos; // กล่องสุดท้ายยาวถึงท้ายไฟล์
    }
    if (size < 8) break;
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

function findAscii(bytes: Uint8Array, word: string): boolean {
  const c = [...word].map((ch) => ch.charCodeAt(0));
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === c[0] && bytes[i + 1] === c[1] && bytes[i + 2] === c[2] && bytes[i + 3] === c[3]) return true;
  }
  return false;
}

// codec ของภาพ จาก sample entry ใน moov
function videoCodec(moov: Uint8Array): string | null {
  if (findAscii(moov, "avc1") || findAscii(moov, "avc3")) return "h264";
  if (findAscii(moov, "hvc1") || findAscii(moov, "hev1")) return "h265";
  if (findAscii(moov, "vp09")) return "vp9";
  if (findAscii(moov, "av01")) return "av1";
  if (findAscii(moov, "mp4v")) return "mpeg4";
  return null;
}

function readMeta(file: Blob): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (r: { width: number; height: number; duration: number } | null) => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(r);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    };
    v.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

export async function inspectVideo(file: File): Promise<string[]> {
  const warnings: string[] = [];
  const ext = file.name.toLowerCase().split(".").pop() ?? "";

  if (ext === "webm" || ext === "ogv") {
    warnings.push(`ไฟล์ .${ext} (VP8/VP9/Theora) Pi ต้องถอดรหัสด้วย CPU — แนะนำแปลงเป็น MP4 (H.264)`);
  } else {
    try {
      const boxes = await topLevelBoxes(file);
      const moov = boxes.find((b) => b.type === "moov");
      const mdat = boxes.find((b) => b.type === "mdat");
      if (moov && mdat && moov.start > mdat.start) {
        warnings.push("ไฟล์ไม่ได้ทำ faststart (ข้อมูลหัวไฟล์อยู่ท้ายไฟล์) — VDO จะเริ่มเล่นช้า");
      }
      if (moov && moov.size <= MOOV_READ_LIMIT) {
        const codec = videoCodec(await readBytes(file, moov.start, moov.size));
        if (codec === "h265") warnings.push("VDO เป็น H.265 (HEVC) — Chromium บน Pi ถอดรหัสด้วยฮาร์ดแวร์ไม่ได้ จะกระตุก");
        else if (codec === "vp9" || codec === "av1") {
          warnings.push(`VDO เป็น ${codec.toUpperCase()} — Pi ต้องถอดรหัสด้วย CPU จะกระตุก`);
        } else if (codec === "mpeg4") warnings.push("VDO เป็น MPEG-4 Part 2 (codec เก่า) — แนะนำแปลงเป็น H.264");
      }
    } catch {
      // อ่านโครงไฟล์ไม่ออก — ข้ามการตรวจส่วนนี้
    }
  }

  const meta = await readMeta(file);
  if (meta && meta.width > 0) {
    const big = Math.max(meta.width, meta.height) > MAX_W || Math.min(meta.width, meta.height) > MAX_H;
    if (big) warnings.push(`ภาพใหญ่ ${meta.width}×${meta.height} — Pi เล่นได้ลื่นไม่เกิน ${MAX_W}×${MAX_H}`);
    if (Number.isFinite(meta.duration) && meta.duration > 0) {
      const mbps = (file.size * 8) / meta.duration / 1_000_000;
      if (mbps > MAX_MBPS) warnings.push(`bitrate สูง ${mbps.toFixed(1)} Mbps — แนะนำไม่เกิน 6 Mbps`);
    }
  }
  return warnings;
}
