import { useMemo } from "react";
import { currentBrandColors } from "../utils/brandColor";

const PIECES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 100) / 100,
  duration: 2 + ((i * 29) % 100) / 60,
}));

export function Confetti() {
  // สีตามธีมที่ผู้ดูแลเลือกอยู่ตอนนี้
  const colors = useMemo(currentBrandColors, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="f1-confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: colors[i % colors.length],
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
