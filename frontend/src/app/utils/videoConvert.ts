// แปลง VDO ในเบราว์เซอร์ของ PC ผู้ดูแล ให้เล่นลื่นบนจอ Station (Raspberry Pi 4) — ดู VIDEO_GUIDE.md
// ได้ MP4 · H.264 · ไม่เกิน 1920×1080 (แนวตั้ง 1080×1920, ไม่ขยายไฟล์เล็ก) · ไม่เกิน 30fps · ~5 Mbps · AAC · faststart
// ใช้ WebCodecs ของ Chrome/Edge (ใช้การ์ดจอของ PC) ผ่าน mediabunny — โหลดไลบรารีเฉพาะตอนแปลง (dynamic import)
// ไฟล์ไม่ถูกส่งไปไหน ทำในเครื่องล้วน · ห้ามเรียกบน Pi (ช้ามาก)

const MAX_LONG = 1920;
const MAX_SHORT = 1080;
const MAX_FPS = 30;
const VIDEO_BPS = 5_000_000;
const MIN_VIDEO_BPS = 1_500_000;
// ต้นฉบับ H.264 bitrate เกินนี้ถึงจะเข้ารหัสใหม่ (ตรงกับเกณฑ์เตือนใน videoCheck.ts)
const MAX_SOURCE_BPS = 8_000_000;
const AUDIO_BPS = 128_000;

export type ConvertResult = {
  file: File;
  // false = แค่จัดไฟล์ใหม่ (faststart) ภาพเดิม ไม่ได้เข้ารหัสใหม่
  reencoded: boolean;
  from: { width: number; height: number; size: number };
  to: { width: number; height: number; size: number };
};

export class ConvertCanceled extends Error {
  constructor() {
    super("ยกเลิกการแปลงแล้ว");
  }
}

// WebCodecs ใช้ได้เฉพาะ secure context (https หรือ localhost) — เปิดผ่าน http://<IP> จะไม่มี
export function canConvertVideo(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "VideoEncoder" in window && "VideoDecoder" in window;
}

// ข้อความอธิบายตอนแปลงไม่ได้เพราะเปิดผ่าน http ธรรมดา
export function convertUnavailableReason(): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return (
      `เบราว์เซอร์ไม่ยอมให้แปลง VDO บนหน้าที่เปิดผ่าน ${window.location.origin} (ไม่ใช่ https) — ` +
      `ตั้งครั้งเดียวที่ Chrome/Edge: เปิด chrome://flags/#unsafely-treat-insecure-origin-as-secure ` +
      `ใส่ ${window.location.origin} แล้วกด Enable → Relaunch · หรือใช้ tools/convert-video.bat แทน`
    );
  }
  return "เบราว์เซอร์นี้แปลง VDO ไม่ได้ — ใช้ Chrome หรือ Edge รุ่นใหม่ หรือใช้ tools/convert-video.bat แทน";
}

// ขนาดใหม่: ย่อให้พอดีกรอบ 1920×1080 (แนวตั้ง 1080×1920) ไม่ขยาย · เลขคู่เสมอ (H.264 ต้องการ)
function fitSize(w: number, h: number): { width: number; height: number } {
  const portrait = h > w;
  const boxW = portrait ? MAX_SHORT : MAX_LONG;
  const boxH = portrait ? MAX_LONG : MAX_SHORT;
  const scale = Math.min(1, boxW / w, boxH / h);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(w), height: even(h) };
}

function outName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}_pi.mp4`;
}

export async function convertForPi(
  file: File,
  opts: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<ConvertResult> {
  if (!canConvertVideo()) throw new Error(convertUnavailableReason());
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);
  if (!videoTrack) throw new Error("อ่านไฟล์นี้ไม่ได้ หรือไม่มีภาพ VDO");

  const from = { width: videoTrack.displayWidth, height: videoTrack.displayHeight, size: file.size };
  const size = fitSize(from.width, from.height);
  // เฟรมเรตเกิน 30 (เช่น 60fps จากมือถือ) → ลดเหลือ 30 · ไม่เกินก็คงเดิม
  let fps: number | undefined;
  let sourceBps = 0;
  try {
    const stats = await videoTrack.computePacketStats(120);
    if (stats.averagePacketRate > MAX_FPS + 1) fps = MAX_FPS;
    sourceBps = stats.averageBitrate;
  } catch {
    // คำนวณไม่ได้ ใช้เฟรมเรตเดิม
  }

  // ต้องเข้ารหัสใหม่ไหม — ถ้าเป็น H.264 อยู่แล้ว ขนาด/เฟรมเรต/bitrate ไม่เกิน แค่จัดไฟล์ใหม่ให้เป็น faststart
  // (คัดลอกภาพเดิม ไม่เสียคุณภาพ เร็วมาก)
  const resized = size.width !== from.width || size.height !== from.height;
  const reencode = videoTrack.codec !== "avc" || resized || fps !== undefined || sourceBps > MAX_SOURCE_BPS;
  // ไม่ตั้ง bitrate สูงกว่าต้นฉบับ (ไม่งั้นไฟล์ใหญ่ขึ้นเปล่า ๆ)
  const videoBps = sourceBps > 0 ? Math.min(VIDEO_BPS, Math.max(MIN_VIDEO_BPS, Math.round(sourceBps))) : VIDEO_BPS;

  if (reencode && !(await mb.canEncodeVideo("avc", { width: size.width, height: size.height }))) {
    throw new Error("เบราว์เซอร์นี้เข้ารหัส H.264 ไม่ได้ — ใช้ Chrome หรือ Edge รุ่นใหม่ หรือใช้ tools/convert-video.bat แทน");
  }
  // เสียง: AAC อยู่แล้ว = คัดลอก · อย่างอื่นแปลงเป็น AAC · เครื่องนี้เข้ารหัส AAC ไม่ได้ ใช้ Opus (Chromium บน Pi เล่น Opus ใน MP4 ได้)
  const audioCodec = (await mb.canEncodeAudio("aac", { bitrate: AUDIO_BPS })) ? "aac" : "opus";

  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: "primary",
    showWarnings: false,
    video: reencode
      ? {
          codec: "avc",
          width: size.width,
          height: size.height,
          fit: "contain",
          ...(fps ? { frameRate: fps } : {}),
          quality: new mb.Quality({ bitrate: videoBps }),
          keyFrameInterval: 2,
          forceTranscode: true,
        }
      : { codec: "avc" },
    audio: { codec: audioCodec, quality: new mb.Quality({ bitrate: AUDIO_BPS }) },
  });
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join(", ");
    throw new Error(
      reasons.includes("undecodable")
        ? "เบราว์เซอร์นี้อ่าน/ถอดรหัสไฟล์ต้นฉบับไม่ได้ (เช่น HEVC บนเครื่องที่การ์ดจอไม่รองรับ หรือไฟล์เสีย) — ใช้ tools/convert-video.bat แทน"
        : `แปลงไฟล์นี้ไม่ได้ (${reasons || "ไม่ทราบสาเหตุ"})`,
    );
  }

  conversion.onProgress = (p) => opts.onProgress?.(Math.min(99, Math.round(p * 100)));
  const onAbort = () => void conversion.cancel();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    await conversion.execute();
  } catch (e) {
    if (e instanceof mb.ConversionCanceledError || opts.signal?.aborted) throw new ConvertCanceled();
    throw new Error(`แปลง VDO ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    input.dispose?.();
  }
  if (!target.buffer) throw new Error("แปลง VDO ไม่สำเร็จ (ไม่มีข้อมูลออกมา)");
  opts.onProgress?.(100);
  const out = new File([target.buffer], outName(file.name), { type: "video/mp4" });
  return { file: out, reencoded: reencode, from, to: { ...size, size: out.size } };
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
