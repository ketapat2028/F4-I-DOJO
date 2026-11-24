// ธีมสีที่ผู้ดูแลกำหนดเองได้: เลือกสีหลัก 1 สี แล้วคำนวณสีที่เหลือ (hover / ตัวหนังสือบนปุ่ม /
// สีตัวอักษรบนพื้นขาว / สีบนแถบหัวมืด) ให้อ่านออกเสมอ (contrast ≥ 4.5) แล้วเขียนทับ CSS variable ของ Tailwind
// สีที่เลือกเก็บไว้ในชุดคำถามบน server (ทุกจอใช้สีเดียวกัน) และ cache ใน localStorage ให้หน้าแรกไม่กระพริบสีเก่า

export const DEFAULT_BRAND_COLOR = "#111113";

export const BRAND_PRESETS: { name: string; color: string }[] = [
  { name: "ขาวดำ", color: "#111113" },
  { name: "เหลือง F1", color: "#f5c400" },
  { name: "น้ำเงินอ่อน", color: "#7cb8f7" },
  { name: "น้ำเงิน", color: "#1d4ed8" },
  { name: "เขียว", color: "#16a34a" },
  { name: "ม่วง", color: "#7c3aed" },
  { name: "ส้ม", color: "#f97316" },
  { name: "ชมพู", color: "#ec4899" },
];

const CACHE_KEY = "f1-dojo-brand-color";
const INK = "#111113";
const WHITE = "#ffffff";
const HEADER_BG = "#18181b";

type RGB = [number, number, number];

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// เลื่อนสีเข้าหา target ทีละนิดจนตัดกับ against ได้ ≥ 4.5
function untilReadable(color: string, target: string, against: string): string {
  let c = color;
  for (let t = 0.05; contrast(c, against) < 4.5 && t <= 1; t += 0.05) c = mix(color, target, t);
  return c;
}

export function deriveBrandPalette(input: string) {
  const brand = normalizeHex(input) ?? DEFAULT_BRAND_COLOR;
  const onBrand = contrast(brand, WHITE) >= contrast(brand, INK) ? WHITE : INK;
  return {
    brand,
    onBrand,
    // hover: สีอ่อนเข้มขึ้น สีเข้มสว่างขึ้น
    brandDark: luminance(brand) > 0.18 ? mix(brand, "#000000", 0.12) : mix(brand, WHITE, 0.2),
    // สีแบรนด์ที่ใช้เป็นตัวหนังสือ/ไอคอนบนพื้นขาว
    brandInk: untilReadable(brand, "#000000", WHITE),
    // สีแบรนด์บนแถบหัวสีถ่าน / overlay มืด (ดำเกือบสนิทใช้ขาวไปเลย)
    brandBright: luminance(brand) < 0.05 ? WHITE : untilReadable(brand, WHITE, HEADER_BG),
  };
}

// cache = false: แค่ดูตัวอย่างในหน้า Edit ยังไม่บันทึก
export function applyBrandColor(input: string | undefined, cache = true) {
  const p = deriveBrandPalette(input ?? DEFAULT_BRAND_COLOR);
  const s = document.documentElement.style;
  s.setProperty("--color-f1-brand", p.brand);
  s.setProperty("--color-f1-brand-dark", p.brandDark);
  s.setProperty("--color-f1-brand-ink", p.brandInk);
  s.setProperty("--color-f1-brand-bright", p.brandBright);
  s.setProperty("--color-f1-on-brand", p.onBrand);
  if (!cache) return;
  try {
    localStorage.setItem(CACHE_KEY, p.brand);
  } catch {
    // localStorage ถูกปิด — ไม่เป็นไร รอโหลดจาก server
  }
}

// เรียกตอนเปิดเว็บ ก่อนโหลดชุดคำถาม
export function applyCachedBrandColor() {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // ignore
  }
  applyBrandColor(normalizeHex(cached) ?? DEFAULT_BRAND_COLOR);
}

// อ่านสีที่ใช้อยู่ตอนนี้ (สำหรับ confetti ที่ใส่สีเป็น inline style)
export function currentBrandColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return [v("--color-f1-brand"), v("--color-f1-brand-ink"), v("--color-f1-brand-bright"), WHITE, "#8b8b95"].filter(Boolean);
}
