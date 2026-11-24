import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, RotateCcw, Square, Timer, TrendingDown, TrendingUp } from "lucide-react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import { forwardKeys, isEmbedded, listenPortal, sendResult, type PortalAck } from "../utils/portalBridge";
import { PORTAL_BOTTOM_GAP } from "./PlayPage";

// จับเวลา 5S BEFORE / AFTER (/timed): นาฬิกาจับเวลาล้วน ไม่มีคำถาม
// กดเริ่ม → ทำกิจกรรมที่สถานีจริง → กด "เสร็จ" · ทำ 2 รอบ (ก่อน/หลังจัด 5S) แล้วเทียบเวลา
// ส่ง portal เป็น pass เสมอเมื่อจับครบ 2 รอบ (Korn 2026-11-24) · score = % ที่เร็วขึ้น (0–100)

type Round = "before" | "after";
type PortalStatus = "idle" | "sending" | "sent" | "error";

const ACK_TIMEOUT_MS = 10_000;
// อัปเดตตัวเลขทุก 0.1 วิ (ไม่ใช้ requestAnimationFrame — เบากว่าบน Pi 4) เวลาจริงคิดจาก performance.now()
const TICK_MS = 100;

const ROUNDS: { id: Round; label: string; sub: string }[] = [
  { id: "before", label: "BEFORE", sub: "ก่อนทำ 5S" },
  { id: "after", label: "AFTER", sub: "หลังทำ 5S" },
];

// 83400 → "01:23.4"
function formatMs(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

export function TimerPage() {
  const [times, setTimes] = useState<Partial<Record<Round, number>>>({});
  // รอบที่กำลังจับอยู่ (null = ยังไม่ได้กดเริ่ม)
  const [running, setRunning] = useState<Round | null>(null);
  const startRef = useRef(0);
  const [now, setNow] = useState(0);
  const [portalStatus, setPortalStatus] = useState<PortalStatus>("idle");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const ackTimerRef = useRef<number | null>(null);
  const portalStatusRef = useRef<PortalStatus>("idle");
  portalStatusRef.current = portalStatus;
  const embedded = isEmbedded();

  // ขยายตามขนาดจอเหมือนหน้าเกม
  useEffect(() => {
    const root = document.documentElement;
    const lite = new URLSearchParams(window.location.search).get("lite") === "1";
    root.classList.add("f1-play-scale");
    if (lite) root.classList.add("f1-lite");
    return () => root.classList.remove("f1-play-scale", "f1-lite");
  }, []);

  useEffect(() => {
    function handleAck(ack: PortalAck) {
      // ack ที่มาช้ากว่า timeout ยังนับ (จอบันทึกแล้ว)
      if (!pendingRef.current && portalStatusRef.current !== "error") return;
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
      pendingRef.current = false;
      setPortalStatus(ack.ok ? "sent" : "error");
      setPortalMsg(ack.ok ? null : (ack.message ?? "จอบันทึกผลไม่สำเร็จ"));
    }
    const stopListen = listenPortal(handleAck);
    const stopKeys = forwardKeys();
    return () => {
      stopListen();
      stopKeys();
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, [running]);

  const before = times.before;
  const after = times.after;
  const done = before !== undefined && after !== undefined;
  // รอบที่รอกดเริ่ม
  const next: Round | null = running ? null : before === undefined ? "before" : after === undefined ? "after" : null;
  const diff = done ? before - after : 0; // บวก = เร็วขึ้น
  const pct = done && before > 0 ? Math.round((100 * diff) / before) : 0;
  const score = Math.min(100, Math.max(0, pct));

  function report() {
    if (!embedded || pendingRef.current) return;
    pendingRef.current = true;
    setPortalStatus("sending");
    setPortalMsg(null);
    sendResult("pass", score);
    ackTimerRef.current = window.setTimeout(() => {
      pendingRef.current = false;
      setPortalStatus("error");
      setPortalMsg("ยังไม่ได้รับการยืนยันจากจอ");
    }, ACK_TIMEOUT_MS);
  }

  // ครบ 2 รอบ → ส่งผลครั้งเดียว
  useEffect(() => {
    if (done && portalStatusRef.current === "idle") report();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function start(round: Round) {
    const t = performance.now();
    startRef.current = t;
    setNow(t);
    setRunning(round);
  }

  function stop() {
    if (!running) return;
    const ms = performance.now() - startRef.current;
    setTimes((prev) => ({ ...prev, [running]: ms }));
    setRunning(null);
  }

  // ลบผลตั้งแต่รอบนี้เป็นต้นไป (จับรอบนี้ใหม่)
  function redo(round: Round) {
    setRunning(null);
    setTimes((prev) => (round === "before" ? {} : { before: prev.before }));
    // ผลที่ส่งไม่สำเร็จ → จับใหม่ครบแล้วส่งผลใหม่อัตโนมัติ
    if (!pendingRef.current) {
      setPortalStatus("idle");
      setPortalMsg(null);
    }
  }

  const resultSent = embedded && (portalStatus === "sending" || portalStatus === "sent");

  return (
    <div className={cn("f1-paper-bg flex h-dvh flex-col overflow-hidden", embedded && PORTAL_BOTTOM_GAP)}>
      <F1Header />
      <main className="mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-6 lg:px-10">
        {/* my-auto แทน justify-center: เนื้อหาสูงเกินจอแล้วเลื่อนได้ ไม่โดนตัดด้านบน */}
        <div className={cn("my-auto flex w-full flex-col items-center", done ? "gap-3 lg:gap-5" : "gap-4 lg:gap-8")}>
        <div className="f1-font-display shrink-0 text-center text-f1-ink">
          <h1 className="text-2xl font-bold sm:text-4xl lg:text-6xl">
            <Timer className="mr-2 inline size-7 align-[-0.12em] text-f1-brand-ink sm:size-10 lg:size-14" />
            5S จับเวลา <span className="text-f1-brand-ink">BEFORE / AFTER</span>
          </h1>
          <p className="mt-1 text-base text-f1-mute sm:text-xl lg:mt-3 lg:text-3xl">
            {running
              ? "ทำกิจกรรมให้เสร็จ แล้วกด “เสร็จ”"
              : next === "before"
                ? "รอบแรก: จับเวลาก่อนทำ 5S"
                : next === "after"
                  ? "รอบสอง: จัด 5S เรียบร้อยแล้ว จับเวลาอีกครั้ง"
                  : "จับเวลาครบ 2 รอบแล้ว"}
          </p>
        </div>

        <div className="grid w-full max-w-6xl shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-8">
          {ROUNDS.map((r, i) => {
            const value = running === r.id ? now - startRef.current : times[r.id];
            const active = running === r.id || next === r.id;
            return (
              <div key={r.id} className="f1-pop-in-spring" style={{ animationDelay: `${i * 100}ms` }}>
                <div
                  className={cn(
                    "f1-font-display rounded-2xl border-2 bg-white p-4 text-center shadow-sm transition-colors duration-300 lg:rounded-3xl lg:border-4",
                    done ? "lg:p-5" : "lg:p-8",
                    active ? "border-f1-brand ring-4 ring-f1-brand/30" : "border-f1-line",
                    value === undefined && !active && "opacity-60",
                  )}
                >
                  <p className="text-xl font-black tracking-widest text-f1-ink sm:text-2xl lg:text-4xl">{r.label}</p>
                  <p className="text-sm text-f1-mute lg:text-2xl">{r.sub}</p>
                  <p
                    className={cn(
                      "f1-font-mono mt-2 font-bold tabular-nums leading-none lg:mt-4",
                      done ? "text-4xl sm:text-5xl lg:text-7xl" : "text-5xl sm:text-6xl lg:text-8xl",
                      running === r.id ? "text-f1-brand-ink" : value === undefined ? "text-zinc-300" : "text-f1-ink",
                    )}
                  >
                    {formatMs(value ?? 0)}
                  </p>
                  {/* จับรอบนี้ใหม่ได้ (กดพลาด) — จนกว่าจะส่งผลขึ้นจอแล้ว */}
                  {!running && times[r.id] !== undefined && !resultSent && (
                    <button
                      type="button"
                      onClick={() => redo(r.id)}
                      className="f1-press mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-f1-mute hover:bg-zinc-100 lg:mt-4 lg:text-xl"
                    >
                      <RotateCcw className="size-4 lg:size-6" /> จับ {r.label} ใหม่
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {running && (
          <Button
            key="stop"
            className="f1-glow f1-press f1-pop-in-spring h-16 w-full max-w-xl shrink-0 bg-[#15803D] text-2xl font-bold text-white hover:bg-[#166534] lg:h-28 lg:rounded-2xl lg:text-5xl"
            onClick={stop}
          >
            <Square className="size-6 lg:size-12" fill="currentColor" /> เสร็จ
          </Button>
        )}

        {next && (
          <Button
            key={`start-${next}`}
            className="f1-glow f1-press f1-pop-in-spring h-16 w-full max-w-xl shrink-0 bg-f1-brand text-2xl font-bold text-f1-ink hover:bg-f1-brand-dark lg:h-28 lg:rounded-2xl lg:text-5xl"
            onClick={() => start(next)}
          >
            <Play className="size-6 lg:size-12" fill="currentColor" /> เริ่มจับเวลา {next === "before" ? "BEFORE" : "AFTER"}
          </Button>
        )}

        {done && (
          <div className="f1-font-display f1-modal-pop w-full max-w-5xl shrink-0 rounded-2xl border-4 border-f1-brand bg-white p-4 text-center text-f1-ink lg:rounded-3xl lg:border-8 lg:p-6">
            <p
              className={cn(
                "f1-stamp flex flex-wrap items-center justify-center gap-x-2 text-3xl font-black sm:text-4xl lg:gap-x-4 lg:text-6xl",
                diff > 0 ? "text-f1-ok-ink" : diff < 0 ? "text-f1-wrong" : "text-f1-ink",
              )}
            >
              {diff > 0 ? <TrendingDown className="size-8 lg:size-16" /> : diff < 0 ? <TrendingUp className="size-8 lg:size-16" /> : null}
              {diff > 0 ? "เร็วขึ้น" : diff < 0 ? "ช้าลง" : "เท่าเดิม"}{" "}
              {diff !== 0 && (
                <span className="f1-font-mono tabular-nums">
                  {(Math.abs(diff) / 1000).toFixed(1)} วิ ({pct > 0 ? "-" : "+"}
                  {Math.abs(pct)}%)
                </span>
              )}
            </p>
            <p className="f1-rise-in mt-1 text-base text-f1-mute [animation-delay:450ms] lg:mt-3 lg:text-2xl">
              {diff > 0 ? "5S ช่วยให้ทำงานได้เร็วขึ้น!" : "ลองจัด 5S ให้หาของง่ายขึ้นอีก"}
            </p>

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "f1-rise-in mt-3 flex flex-wrap items-center justify-center gap-2 rounded-lg px-3 py-2 text-base lg:mt-5 lg:gap-3 lg:text-2xl",
                  portalStatus === "error" ? "bg-f1-bad-bg text-f1-bad" : "bg-zinc-100 text-f1-ink",
                )}
              >
                {portalStatus === "sending" && (
                  <>
                    <Loader2 className="size-4 animate-spin lg:size-7" /> กำลังส่งผลไปที่จอ…
                  </>
                )}
                {portalStatus === "sent" && (
                  <>
                    <Check className="f1-icon-pop size-4 lg:size-7" /> ส่งผลไปที่จอสำเร็จ — จอจะไปสถานีถัดไปเอง
                  </>
                )}
                {portalStatus === "error" && (
                  <>
                    <span>ส่งผลไม่สำเร็จ: {portalMsg}</span>
                    <Button size="sm" className="f1-press bg-f1-brand text-f1-ink hover:bg-f1-brand-dark lg:h-14 lg:px-6 lg:text-2xl" onClick={report}>
                      ส่งใหม่
                    </Button>
                  </>
                )}
              </div>
            )}

            {!embedded && (
              <Button
                className="f1-press f1-rise-in mt-4 h-12 bg-f1-brand px-6 text-lg text-f1-ink [animation-delay:700ms] hover:bg-f1-brand-dark lg:mt-6 lg:h-16 lg:rounded-xl lg:px-10 lg:text-2xl"
                onClick={() => redo("before")}
              >
                <RotateCcw className="lg:size-7" /> เริ่มใหม่
              </Button>
            )}
          </div>
        )}
        </div>
      </main>
      {done && diff > 0 && <Confetti />}
    </div>
  );
}
