export type PromptType = "text" | "image" | "mixed";

// ตัวเลือกคำตอบ 1 ข้อ — แต่ละคำถามมีหลายตัวเลือก และมีตัวที่ถูก 1 ตัว (correct = true)
export interface AnswerOption {
  id: string;
  type: PromptType;
  text: string;
  image?: string;
  correct?: boolean;
}

export interface MatchPair {
  id: string;
  // คำถาม (ฝั่งซ้าย)
  promptType: PromptType;
  promptText: string;
  promptImage?: string; // data URL หรือลิงก์ http(s)
  // VDO ของข้อนี้ — ผู้เล่นต้องดูจนจบก่อนถึงจะเห็นตัวเลือก (ไม่มี = ข้ามไปแสดงตัวเลือกเลย)
  video?: string;
  // ตัวเลือกคำตอบ — ควรมีอย่างน้อย 2 ตัว และมีตัวที่ถูกตัวเดียว
  answers: AnswerOption[];
}

export interface Theme {
  id: string;
  name: string;
  timeLimitSeconds: number; // 0 = ไม่จำกัดเวลา
  pairs: MatchPair[];
  createdAt: number;
  updatedAt: number;
}
