export type PromptType = "text" | "image" | "mixed";

// ตัวเลือก 1 ตัวของคำถามแบบเลือกตอบ — ต้องมี correct = true พอดี 1 ตัวต่อข้อ
export interface AnswerOption {
  id: string;
  type: PromptType;
  text: string;
  image?: string;
  correct?: boolean;
}

export interface MatchPair {
  id: string;
  promptType: PromptType;
  promptText: string;
  promptImage?: string; // data URL หรือลิงก์ http(s)
  video?: string; // VDO ของข้อนี้ (ไม่บังคับ) เล่นจบก่อนถึงจะแสดงตัวเลือก
  // ตัวเลือก — อย่างน้อย 2 ตัว ถูกพอดี 1 ตัว
  answers: AnswerOption[];
}

export interface Theme {
  id: string;
  name: string;
  // เกมจิ๊กซอ (นอกเว็บ) นับถอยหลังเฉย ๆ · 0 = ข้ามเฟสนี้ไปเลย
  jigsawTimeLimitSeconds: number;
  // เกมไหนเล่นก่อน: "jigsaw" = จิ๊กซอก่อนแล้วค่อยเข้าเกมนี้ (เดิม) · "quiz" = เกมนี้ก่อนแล้วค่อยนับถอยหลังจิ๊กซอปิดท้าย
  firstGame: "jigsaw" | "quiz";
  timeLimitSeconds: number; // เวลารวมทั้งเกม · 0 = ไม่จำกัดเวลา
  passPercent: number; // เกณฑ์ผ่าน: ตอบถูกอย่างน้อยกี่ % ของจำนวนข้อ (ปัดขึ้น)
  brandColor?: string; // สีธีมหลัก (#rrggbb) — ไม่มี = ขาวดำ
  pairs: MatchPair[];
  createdAt: number;
  updatedAt: number;
}
