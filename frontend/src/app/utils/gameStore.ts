import type { AnswerOption, MatchPair, PromptType, Theme } from "../types/theme";

// key เดิมตอนยังเก็บใน localStorage — เหลือไว้อ่านเพื่อย้ายข้อมูลขึ้น server เท่านั้น (readLegacyLocalGame)
export const PAIRS_KEY = "f1-dojo-pairs-v4-click-match";
const META_KEY = "idojo.f1.meta.v4";
const DEFAULT_NAME = "I-DOJO - PIT 4 5S";
// ชื่อตัวอย่างเดิมที่ยังค้างใน DB — อ่านแล้วแทนด้วยชื่อใหม่ (บันทึกจาก editor ครั้งถัดไปจะเขียนชื่อใหม่ลง DB)
const LEGACY_NAMES = ["DOJO · F1 RACING RED", "I-DOJO - PIT 5 DOMINO IMPACT"];
const DEFAULT_TIME = 300;
const DEFAULT_PASS_PERCENT = 70;
// ข้อแบบเก่า (ไม่มีช่อง correct) แปลงเป็นเลือกตอบ: คำตอบเดิม = ตัวถูก + ตัวลวงจากข้ออื่นอีกไม่เกินเท่านี้
const LEGACY_DISTRACTORS = 3;

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
export const IMAGE_MAX_MB = 10;
export const VIDEO_EXTS = [".mp4", ".m4v", ".webm", ".ogv"];
export const VIDEO_MAX_MB = 300;

// crypto.randomUUID ใช้ได้เฉพาะ secure context — เปิดผ่าน http://<IP ของ Pi> จะไม่มี
export function genId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeEmptyAnswer(correct = false): AnswerOption {
  return { id: genId(), type: "text", text: "", correct };
}

export function makeEmptyPair(): MatchPair {
  return { id: genId(), promptType: "text", promptText: "", answers: [makeEmptyAnswer(true), makeEmptyAnswer()] };
}

// ===== รูปแบบข้อมูลสำหรับ Import/Export (ตามโครงสร้าง EDIT MODE) =====
interface SpecSide {
  id?: string;
  type?: string;
  text?: string;
  imageUrl?: string;
  correct?: boolean;
}

export interface SpecRecord {
  id?: string;
  question?: SpecSide;
  videoUrl?: string;
  // answer = รูปแบบเก่า (คำตอบเดียว) เหลือไว้อ่านข้อมูลเดิม ไม่เขียนออกแล้ว — ดู fromAnyRecord
  answer?: SpecSide;
  answers?: SpecSide[];
}

function svg(markup: string, width = 320): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} 180'>${markup}</svg>`,
  )}`;
}

const IMG_FERRARI_CAR = svg(
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f4f4f5'/><stop offset='1' stop-color='#d4d4d8'/></linearGradient></defs>" +
    "<rect width='640' height='180' fill='url(#g)'/>" +
    "<path d='M0 180 L150 0 H210 L60 180Z' fill='#DC0000' opacity='0.18'/><path d='M60 180 L210 0 H232 L82 180Z' fill='#111113' opacity='0.12'/>" +
    "<rect y='132' width='640' height='48' fill='#3f3f46'/><path d='M0 156 H640' stroke='#f4f4f5' stroke-width='4' stroke-dasharray='34 26'/>" +
    "<g transform='translate(140 -6)'>" +
    "<path d='M40 118 L70 98 L130 92 L170 78 L230 82 L262 100 L292 104 L292 122 L40 122 Z' fill='#DC0000'/>" +
    "<rect x='258' y='84' width='40' height='6' fill='#DC0000'/><rect x='30' y='96' width='22' height='5' fill='#DC0000'/>" +
    "<circle cx='96' cy='126' r='24' fill='#111113' stroke='#8b8b95' stroke-width='4'/><circle cx='236' cy='126' r='24' fill='#111113' stroke='#8b8b95' stroke-width='4'/>" +
    "</g>" +
    "<text x='480' y='78' font-family='Arial' font-weight='bold' font-size='40' fill='#111113' text-anchor='middle'>SF-23</text>",
  640,
);
const IMG_FERRARI_LOGO = svg(
  "<path d='M105 22 H215 V92 Q215 140 160 160 Q105 140 105 92 Z' fill='#FFD60A' stroke='#111113' stroke-width='4'/>" +
    "<rect x='105' y='22' width='110' height='14' fill='#22C55E'/><rect x='105' y='36' width='110' height='8' fill='#f4f4f5'/><rect x='105' y='44' width='110' height='8' fill='#DC0000'/>" +
    "<text x='160' y='104' font-family='Arial' font-weight='bold' font-size='34' fill='#111' text-anchor='middle'>SF</text>" +
    "<text x='160' y='130' font-family='Arial' font-weight='bold' font-size='16' fill='#DC0000' text-anchor='middle'>FERRARI</text>",
);
const IMG_REDBULL = svg(
  "<rect x='40' y='34' width='240' height='112' rx='16' fill='#1E3A8A'/>" +
    "<circle cx='160' cy='78' r='28' fill='#FFD60A'/><path d='M96 78 h36 M188 78 h36' stroke='#DC0000' stroke-width='12'/>" +
    "<text x='160' y='128' font-family='Arial' font-weight='bold' font-size='18' fill='#fff' text-anchor='middle'>RED BULL RACING</text>",
);
const IMG_TROPHY = svg(
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f4f4f5'/><stop offset='1' stop-color='#d4d4d8'/></linearGradient></defs>" +
    "<rect width='640' height='180' fill='url(#g)'/>" +
    "<path d='M400 180 L520 0 H580 L460 180Z' fill='#DC0000' opacity='0.18'/><path d='M460 180 L580 0 H602 L482 180Z' fill='#111113' opacity='0.12'/>" +
    "<path d='M0 0 H120 L0 120Z' fill='#111113' opacity='0.06'/>" +
    "<g transform='translate(320 40) scale(0.78) translate(-160 -38)'>" +
    "<path d='M115 38 H205 V82 Q205 118 160 124 Q115 118 115 82 Z' fill='#FFD60A' stroke='#B8860B' stroke-width='3'/>" +
    "<path d='M115 50 H92 Q92 86 118 92 M205 50 H228 Q228 86 202 92' fill='none' stroke='#FFD60A' stroke-width='8'/>" +
    "<rect x='150' y='124' width='20' height='26' fill='#FFD60A'/><rect x='126' y='150' width='68' height='12' fill='#FFD60A'/>" +
    "</g>" +
    "<text x='470' y='96' font-family='Arial' font-weight='bold' font-size='44' fill='#111113' text-anchor='middle'>2023</text>",
  640,
);

function seedPairs(): MatchPair[] {
  type TextSeed = [string, string];
  const textSeeds: TextSeed[] = [
    ["DRS", "ระบบลดแรงต้านอากาศ"],
    ["ERS", "ระบบคืนพลังงานไฟฟ้า"],
    ["Undercut", "กลยุทธ์เข้าพิตก่อนเพื่อแซง"],
    ["Pole Position", "ออกตัวอันดับ 1 จากควอลิฟาย"],
    ["Safety Car", "รถนำขบวนช่วงอุบัติเหตุ"],
    ["DRS Zone", "โซนที่อนุญาตให้เปิด DRS"],
  ];
  const pairs: MatchPair[] = textSeeds.map(([q, a], i) => ({
    id: `p${i + 1}`,
    promptType: "text",
    promptText: q,
    answers: [{ id: genId(), type: "text", text: a }],
  }));
  pairs.push(
    {
      id: "p7",
      promptType: "image",
      promptText: "Ferrari SF-23",
      promptImage: IMG_FERRARI_CAR,
      answers: [{ id: genId(), type: "image", text: "Ferrari", image: IMG_FERRARI_LOGO }],
    },
    {
      id: "p8",
      promptType: "mixed",
      promptText: "ทีมแชมป์โลก 2023 คือ?",
      promptImage: IMG_TROPHY,
      answers: [{ id: genId(), type: "image", text: "Red Bull Racing", image: IMG_REDBULL }],
    },
  );
  return pairs;
}

export function toSpecRecord(pair: MatchPair): SpecRecord {
  return {
    id: pair.id,
    question: { type: pair.promptType, text: pair.promptText, imageUrl: pair.promptImage ?? "" },
    videoUrl: pair.video ?? "",
    answers: pair.answers.map((a) => ({
      id: a.id,
      type: a.type,
      text: a.text,
      imageUrl: a.image ?? "",
      correct: Boolean(a.correct),
    })),
  };
}

function normalizeType(value: unknown): PromptType {
  return value === "image" || value === "mixed" ? value : "text";
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toAnswerOption(raw: unknown): AnswerOption {
  const r = isObject(raw) ? raw : {};
  return {
    id: typeof r.id === "string" ? r.id : genId(),
    type: normalizeType(r.type),
    text: String(r.text ?? ""),
    image: optString(r.imageUrl),
    // ไม่มีช่องนี้ = ข้อมูลรูปแบบเก่า (ดู upgradeLegacyPairs)
    correct: typeof r.correct === "boolean" ? r.correct : undefined,
  };
}

// รองรับ 3 รูปแบบ: (1) answers[] ใหม่ (2) answer object เดี่ยวรูปแบบก่อนหน้า (3) answer เป็นข้อความล้วนแบบเก่าสุด
function extractAnswers(record: Record<string, unknown>): AnswerOption[] {
  if (Array.isArray(record.answers) && record.answers.length > 0) {
    return record.answers.map(toAnswerOption);
  }
  if (isObject(record.answer)) {
    return [toAnswerOption(record.answer)];
  }
  return [
    {
      id: genId(),
      type: normalizeType(record.answerType),
      text: String((typeof record.answer === "string" ? record.answer : record.answerText) ?? ""),
      image: optString(record.answerImage),
    },
  ];
}

// รองรับทั้งรูปแบบใหม่ (question เป็น object) และรูปแบบเก่า (topic เป็นข้อความ)
function fromAnyRecord(record: Record<string, unknown>): MatchPair {
  const q = isObject(record.question) ? record.question : undefined;
  return {
    id: typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : genId(),
    promptType: normalizeType(q ? q.type : (record.type ?? record.promptType)),
    promptText: String((q ? q.text : (record.topic ?? record.promptText)) ?? ""),
    promptImage: optString(q ? q.imageUrl : (record.imageUrl ?? record.promptImage)),
    video: optString(record.videoUrl ?? record.video),
    answers: extractAnswers(record),
  };
}

function recordsToPairs(data: unknown): MatchPair[] {
  const list: unknown[] = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.pairs)
      ? data.pairs
      : [];
  const pairs = list.filter(isObject).map(fromAnyRecord);
  // id ซ้ำจะทำให้การ์ดชนกัน จึงสร้าง id ใหม่ให้ตัวที่ซ้ำ
  const seen = new Set<string>();
  return upgradeLegacyPairs(
    pairs.map((p) => {
      if (seen.has(p.id)) return { ...p, id: genId() };
      seen.add(p.id);
      return p;
    }),
  );
}

const answerKey = (a: AnswerOption) => `${a.type}|${a.text.trim()}|${a.image ?? ""}`;

// ข้อแบบเก่า (เกมจับคู่ — ไม่มี correct ในตัวเลือกไหนเลย) → ข้อเลือกตอบ
// คำตอบแรกของข้อ = ตัวถูก · ตัวลวง = คำตอบแรกของข้อถัด ๆ ไป (ไม่ซ้ำกัน)
// คำตอบที่ 2 เป็นต้นไปของข้อเดิมตัดทิ้ง เพราะในเกมเดิมมันก็ "ถูก" เหมือนกัน เอามาเป็นตัวลวงไม่ได้
function upgradeLegacyPairs(pairs: MatchPair[]): MatchPair[] {
  return pairs.map((p, i) => {
    if (p.answers.some((a) => a.correct !== undefined)) {
      return { ...p, answers: p.answers.map((a) => ({ ...a, correct: Boolean(a.correct) })) };
    }
    const correct: AnswerOption = { ...p.answers[0], correct: true };
    const used = new Set([answerKey(correct)]);
    const distractors: AnswerOption[] = [];
    for (let k = 1; k < pairs.length && distractors.length < LEGACY_DISTRACTORS; k++) {
      const src = pairs[(i + k) % pairs.length].answers[0];
      if (!src || used.has(answerKey(src))) continue;
      used.add(answerKey(src));
      distractors.push({ ...src, id: genId(), correct: false });
    }
    return { ...p, answers: [correct, ...distractors] };
  });
}

// ===== ชุดคำถามเก็บที่ backend (/api/game) =====
// เกมถูกฝังเป็น iframe ข้ามเว็บบนจอ Station — Chromium แยก localStorage ของ iframe จึงต้องอ่านจาก API เท่านั้น
const API = `${import.meta.env.BASE_URL}api`;

export class NoGameError extends Error {
  constructor() {
    super("ยังไม่มีชุดคำถามบน server");
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("รหัสผู้ดูแลไม่ถูกต้อง");
  }
}

function toPayload(game: Theme) {
  return {
    name: game.name,
    timeLimitSeconds: game.timeLimitSeconds,
    passPercent: game.passPercent,
    pairs: game.pairs.map(toSpecRecord),
  };
}

function fromPayload(data: unknown): Theme {
  const m = isObject(data) ? data : {};
  return {
    id: "f1-board",
    name: typeof m.name === "string" && m.name && !LEGACY_NAMES.includes(m.name) ? m.name : DEFAULT_NAME,
    timeLimitSeconds: Number.isFinite(m.timeLimitSeconds) ? Math.max(0, m.timeLimitSeconds as number) : DEFAULT_TIME,
    passPercent: Number.isFinite(m.passPercent)
      ? Math.min(100, Math.max(1, Math.round(m.passPercent as number)))
      : DEFAULT_PASS_PERCENT,
    pairs: recordsToPairs(data),
    createdAt: 0,
    updatedAt: 0,
  };
}

async function failure(res: Response, what: string): Promise<Error> {
  if (res.status === 401) return new UnauthorizedError();
  let detail = "";
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = `: ${body.error}`;
  } catch {
    // ไม่มี body เป็น JSON
  }
  return new Error(`${what}ไม่สำเร็จ (${res.status})${detail}`);
}

export async function getGame(): Promise<Theme> {
  const res = await fetch(`${API}/game`, { cache: "no-store" });
  if (res.status === 404) throw new NoGameError();
  if (!res.ok) throw await failure(res, "โหลดชุดคำถาม");
  const game = fromPayload(await res.json());
  if (game.pairs.length < 2) throw new NoGameError();
  return game;
}

export async function saveGame(game: Theme, adminSecret: string): Promise<Theme> {
  const res = await fetch(`${API}/game`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
    body: JSON.stringify(toPayload(game)),
  });
  if (!res.ok) throw await failure(res, "บันทึก");
  return { ...game, updatedAt: Date.now() };
}

// รูปเก็บเป็นแถวในตาราง images บน server (ไม่ใช่ไฟล์) คืน URL (/I-DOJO/api/images/<id>) ไว้เก็บแทน base64
export async function verifyAdmin(adminSecret: string): Promise<boolean> {
  const res = await fetch(`${API}/admin/check`, { headers: { "x-admin-secret": adminSecret } });
  if (res.status === 401) return false;
  if (!res.ok) throw await failure(res, "ตรวจรหัส");
  return true;
}

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : "";
}

// ตรวจชนิด/ขนาดไฟล์ก่อนส่ง (server ตรวจซ้ำอีกชั้น) คืนข้อความ error หรือ null
export function checkImageFile(file: File): string | null {
  if (!IMAGE_EXTS.includes(extOf(file.name))) return `รองรับเฉพาะรูป ${IMAGE_EXTS.join(" ")}`;
  if (file.size > IMAGE_MAX_MB * 1024 * 1024) return `รูปใหญ่เกิน ${IMAGE_MAX_MB}MB`;
  return null;
}

export function checkVideoFile(file: File): string | null {
  if (!VIDEO_EXTS.includes(extOf(file.name))) return `รองรับเฉพาะ VDO ${VIDEO_EXTS.join(" ")}`;
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) return `VDO ใหญ่เกิน ${VIDEO_MAX_MB}MB`;
  return null;
}

export async function uploadImage(file: Blob, adminSecret: string): Promise<string> {
  if (file.size > IMAGE_MAX_MB * 1024 * 1024) throw new Error(`รูปใหญ่เกิน ${IMAGE_MAX_MB}MB`);
  const form = new FormData();
  const name = file instanceof File ? file.name : "image.jpg";
  form.append("image", file, name);
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "x-admin-secret": adminSecret },
    body: form,
  });
  if (!res.ok) throw await failure(res, "อัปโหลดรูป");
  const { id } = await res.json();
  return `${API}/images/${id}`;
}

// VDO ใหญ่ (ถึง 300MB) ใช้ XMLHttpRequest เพราะ fetch ไม่บอกความคืบหน้าการอัปโหลด
// onProgress ได้ค่า 0–100 · คืน URL (/I-DOJO/api/videos/<file>)
export function uploadVideo(file: File, adminSecret: string, onProgress?: (percent: number) => void): Promise<string> {
  const invalid = checkVideoFile(file);
  if (invalid) return Promise.reject(new Error(invalid));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/upload-video`);
    xhr.setRequestHeader("x-admin-secret", adminSecret);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((100 * e.loaded) / e.total));
    };
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new UnauthorizedError());
      let body: { filename?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ไม่มี body เป็น JSON
      }
      if (xhr.status < 200 || xhr.status >= 300 || !body.filename) {
        return reject(new Error(`อัปโหลด VDO ไม่สำเร็จ (${xhr.status})${body.error ? `: ${body.error}` : ""}`));
      }
      resolve(`${API}/videos/${body.filename}`);
    };
    xhr.onerror = () => reject(new Error("อัปโหลด VDO ไม่สำเร็จ (เชื่อมต่อ server ไม่ได้)"));
    const form = new FormData();
    form.append("video", file, file.name);
    xhr.send(form);
  });
}

// ชุดตัวอย่าง F1 ให้ editor ใช้เป็นจุดเริ่มเมื่อ server ยังไม่มีข้อมูล
export function makeDemoGame(): Theme {
  // seed เขียนแบบเก่า (คำตอบเดียวต่อข้อ) — แปลงเป็นเลือกตอบ ตัวลวงมาจากข้ออื่น
  return { ...fromPayload({}), pairs: upgradeLegacyPairs(seedPairs()) };
}

// ข้อมูลเดิมที่เคยเก็บใน localStorage ของ browser นี้ (ก่อนย้ายไป backend) — ใช้ย้ายขึ้น server ครั้งเดียว
export function readLegacyLocalGame(): Theme | null {
  try {
    const raw = localStorage.getItem(PAIRS_KEY);
    if (!raw) return null;
    const pairs = recordsToPairs(JSON.parse(raw));
    if (pairs.length < 2) return null;
    const meta = JSON.parse(localStorage.getItem(META_KEY) ?? "{}");
    return { ...fromPayload(meta), pairs };
  } catch {
    return null;
  }
}

export function exportGameJson(game: Theme): string {
  return JSON.stringify(toPayload(game), null, 2);
}

export function sideComplete(type: PromptType, text: string, image?: string): boolean {
  if (type === "text") return Boolean(text.trim());
  if (type === "image") return Boolean(image);
  return Boolean(text.trim()) && Boolean(image);
}

export function isPairComplete(p: MatchPair): boolean {
  return (
    sideComplete(p.promptType, p.promptText, p.promptImage) &&
    p.answers.length >= 2 &&
    p.answers.every((a) => sideComplete(a.type, a.text, a.image)) &&
    p.answers.filter((a) => a.correct).length === 1
  );
}

export function parseImportedPairs(raw: string): MatchPair[] {
  const pairs = recordsToPairs(JSON.parse(raw)).filter(isPairComplete);
  if (pairs.length < 2) {
    throw new Error("ไฟล์ต้องมีข้อที่สมบูรณ์อย่างน้อย 2 ข้อ (คำถามครบ ตัวเลือกอย่างน้อย 2 ตัว และมีตัวที่ถูก 1 ตัว)");
  }
  return pairs;
}
