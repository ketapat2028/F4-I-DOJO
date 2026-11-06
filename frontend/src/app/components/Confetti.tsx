const COLORS = ["#F5C400", "#18181B", "#FFD84D", "#FFFFFF", "#22C55E"];

const PIECES = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 100) / 100,
  duration: 2 + ((i * 29) % 100) / 60,
  color: COLORS[i % COLORS.length],
}));

export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="f1-confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
