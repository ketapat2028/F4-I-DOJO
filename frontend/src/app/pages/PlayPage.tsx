import { useEffect, useRef, useState } from "react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import type { AnswerOption, MatchPair, Theme } from "../types/theme";
import { getGame, NoGameError } from "../utils/gameStore";
import { isEmbedded, listenPortal, forwardKeys, sendResult, type PortalAck, type PortalResult } from "../utils/portalBridge";

// idle    = รอกดเริ่ม (เฉพาะเปิดเกมตรงๆ · บนจอ Station เริ่มเองทันที)
// video   = กำลังดู VDO ของข้อปัจจุบัน (ข้ามไม่ได้)
// answering = เห็นตัวเลือกแล้ว เลือกได้ไม่จำกัดครั้งจนกว่าจะถูก
type Phase = "idle" | "video" | "answering" | "finished" | "timeout";
type Choice = AnswerOption & { letter: string };
type PortalStatus = "idle" | "sending" | "sent" | "error";
type PortalReport = { result: PortalResult; score: number };
type Summary = { allCorrect: boolean; timeout: boolean; firstTry: number; total: number; timeUsedSeconds: number };

// portal ไม่ตอบ ack ภายในเวลานี้ = ถือว่ายังไม่ได้บันทึก (PORTAL_INTEGRATION.md ข้อ 2)
const ACK_TIMEOUT_MS = 10_000;
// บนจอ Station ต้องมีเวลาจำกัดเสมอ ไม่งั้นตอบไม่ครบจะไม่มีผล fail ส่งไปที่จอ
const EMBED_DEFAULT_LIMIT = 300;
// ตอบถูกแล้วค้างให้เห็นสีเขียวสั้นๆ ก่อนขึ้น VDO ข้อถัดไป
const CORRECT_PAUSE_MS = 1300;

// เวลาที่ใช้จริง: ตอนถูกฝังแต่ตั้งไว้ 0 (ไม่จำกัด) ใช้ 5 นาทีแทน
function effectiveLimit(game: Theme, embedded: boolean): number {
  return embedded && game.timeLimitSeconds <= 0 ? EMBED_DEFAULT_LIMIT : game.timeLimitSeconds;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// สลับลำดับตัวเลือกของทุกข้อไว้ล่วงหน้า (ตอนโหลด/เล่นใหม่) — ตัวอักษร A, B, C ติดตามตำแหน่งหลังสลับ
// ไม่สลับใหม่ทุกครั้งที่ render ไม่งั้นตัวเลือกจะวิ่งหนีตอนผู้เล่นกำลังจะกด
function makeChoices(pairs: MatchPair[]): Record<string, Choice[]> {
  const out: Record<string, Choice[]> = {};
  for (const p of pairs) {
    out[p.id] = shuffle(p.answers).map((a, i) => ({ ...a, letter: String.fromCharCode(65 + i) }));
  }
  return out;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function resultTier(firstTry: number, total: number): { title: string; sub?: string } {
  if (firstTry === total) return { title: "PERFECT LAP! 🏆", sub: "ตอบถูกทุกข้อตั้งแต่ครั้งแรก รถแข่งพุ่งผ่านธงตาหมากรุก! 🏁" };
  if (firstTry * 8 >= total * 3) return { title: "PODIUM FINISH!" };
  return { title: "KEEP PUSHING!" };
}

function GameTitle({ name }: { name: string }) {
  const m = name.match(/^(.*\S)\s+RED$/);
  return (
    <h1 className="f1-font-display text-2xl font-bold text-f1-ink fit:text-xl">
      🏁 {m ? m[1] : name}
      {m && <span className="text-[#DC0000]"> RED</span>}
    </h1>
  );
}

export function PlayPage() {
  const [game, setGame] = useState<Theme | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [qIndex, setQIndex] = useState(0);
  // ตัวเลือกที่กดผิดไปแล้วในข้อปัจจุบัน — กดซ้ำไม่ได้ แต่ตัวอื่นยังเลือกได้
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  // ตัวเลือกที่ถูกที่เพิ่งกด (ช่วงค้างสีเขียวก่อนไปข้อต่อไป) · ระหว่างนี้ล็อกการกดและหยุดเวลา
  const [correctId, setCorrectId] = useState<string | null>(null);
  // pairId → true = ถูกตั้งแต่ครั้งแรก · false = ถูกหลังตอบผิดมาก่อน · ไม่มี key = ยังไม่ได้ตอบถูก
  const [solved, setSolved] = useState<Record<string, boolean>>({});
  // เวลานับเฉพาะตอนตอบคำถาม ไม่นับตอนดู VDO
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showSummary, setShowSummary] = useState(true);

  const [videoProgress, setVideoProgress] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoAttempt, setVideoAttempt] = useState(0);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [portalStatus, setPortalStatus] = useState<PortalStatus>("idle");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const embedded = isEmbedded();
  const videoRef = useRef<HTMLVideoElement>(null);
  const maxWatchedRef = useRef(0); // ตำแหน่งไกลสุดที่ดูถึง — กันกรอข้ามไปข้างหน้า
  const nextTimerRef = useRef<number | null>(null);
  // ผลที่ส่งแล้วกำลังรอ ack (กันส่งซ้ำ) และผลล่าสุดไว้กด "ส่งใหม่"
  const pendingRef = useRef<PortalReport | null>(null);
  const lastReportRef = useRef<PortalReport | null>(null);
  const ackTimerRef = useRef<number | null>(null);
  const portalStatusRef = useRef<PortalStatus>("idle");
  portalStatusRef.current = portalStatus;

  useEffect(() => {
    setLoadError(null);
    getGame()
      .then((g) => {
        setGame(g);
        setChoices(makeChoices(g.pairs));
        // บนจอ Station เริ่มทันที ไม่รอผู้เล่นแตะ
        if (embedded) beginQuestion(g.pairs[0]);
      })
      .catch((e) => {
        setLoadError(
          e instanceof NoGameError
            ? "ยังไม่มีชุดคำถาม — ให้ผู้ดูแลตั้งค่าที่หน้า /I-DOJO/editor"
            : `โหลดชุดคำถามไม่ได้${e instanceof Error ? ` (${e.message})` : ""}`,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  useEffect(() => {
    function handleAck(ack: PortalAck) {
      // ack ที่มาช้ากว่า ACK_TIMEOUT_MS ของผลเดียวกัน ยังนับ (จอบันทึกแล้ว ไม่ต้องกดส่งใหม่)
      const late = !pendingRef.current && portalStatusRef.current === "error" && ack.result === lastReportRef.current?.result;
      if (!pendingRef.current && !late) return;
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
      pendingRef.current = null;
      setPortalStatus(ack.ok ? "sent" : "error");
      setPortalMsg(ack.ok ? null : (ack.message ?? "จอบันทึกผลไม่สำเร็จ"));
    }
    const stopListen = listenPortal(handleAck);
    const stopKeys = forwardKeys();
    return () => {
      stopListen();
      stopKeys();
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
      if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current);
    };
  }, []);

  // เวลานับเฉพาะตอนเห็นตัวเลือกและยังไม่ได้ตอบถูก
  const timerRunning = phase === "answering" && correctId === null;
  useEffect(() => {
    if (!timerRunning) return;
    const timer = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [timerRunning]);

  useEffect(() => {
    if (!timerRunning || !game) return;
    const limit = effectiveLimit(game, embedded);
    if (limit > 0 && elapsed >= limit) finishGame(false, solved, elapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, timerRunning, game]);

  // เริ่มข้อใหม่: ถ้ามี VDO ก็ขึ้น VDO ก่อน ไม่มีก็ข้ามไปตัวเลือกเลย
  useEffect(() => {
    if (phase !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    maxWatchedRef.current = 0;
    setVideoProgress(0);
    setNeedsTap(false);
    setVideoError(false);
    // เบราว์เซอร์/iframe อาจบล็อก autoplay ที่มีเสียง → โชว์ปุ่มให้แตะเริ่ม
    v.play().catch(() => setNeedsTap(true));
  }, [phase, qIndex, videoAttempt]);

  if (!game) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="f1-font-display mx-auto max-w-3xl space-y-3 p-6 text-f1-red">
          <p>{loadError ?? "กำลังโหลด..."}</p>
          {loadError && (
            <Button className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={() => setLoadAttempt((n) => n + 1)}>
              ลองใหม่
            </Button>
          )}
        </main>
      </div>
    );
  }

  const total = game.pairs.length;
  const pair = game.pairs[Math.min(qIndex, total - 1)];
  const options = choices[pair.id] ?? [];
  const solvedCount = Object.keys(solved).length;
  const limit = effectiveLimit(game, embedded);
  const hasLimit = limit > 0;
  const remaining = hasLimit ? Math.max(0, limit - elapsed) : null;
  const lowTime = remaining !== null && remaining <= 60;
  const over = phase === "finished" || phase === "timeout";
  // ตอนถูกฝัง: ส่งผลไปแล้ว (กำลังรอ/ได้ ack) → ไม่ให้เล่นต่อเอง รอจอจัดการ
  const resultHandedOff = embedded && (portalStatus === "sending" || portalStatus === "sent");
  const tier = summary ? resultTier(summary.firstTry, summary.total) : null;

  function beginQuestion(p: MatchPair) {
    setWrongIds(new Set());
    setCorrectId(null);
    setPhase(p.video ? "video" : "answering");
  }

  // ส่งผลขึ้นจอ Station เฉพาะตอนถูกฝัง · ระหว่างรอ ack ห้ามส่งซ้ำ
  function report(next: PortalReport) {
    if (!embedded || pendingRef.current) return;
    pendingRef.current = next;
    lastReportRef.current = next;
    setPortalStatus("sending");
    setPortalMsg(null);
    sendResult(next.result, next.score);
    ackTimerRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      setPortalStatus("error");
      setPortalMsg("ยังไม่ได้รับการยืนยันจากจอ");
    }, ACK_TIMEOUT_MS);
  }

  function resendReport() {
    if (lastReportRef.current) report(lastReportRef.current);
  }

  function finishGame(allCorrect: boolean, solvedMap: Record<string, boolean>, timeUsed: number) {
    if (!game) return;
    const firstTry = Object.values(solvedMap).filter(Boolean).length;
    const pct = Math.round((100 * firstTry) / game.pairs.length);
    setSummary({ allCorrect, timeout: !allCorrect, firstTry, total: game.pairs.length, timeUsedSeconds: timeUsed });
    setShowSummary(true);
    setPhase(allCorrect ? "finished" : "timeout");
    // ตอบถูกครบ = pass · หมดเวลา = fail (score = % ที่ตอบถูกตั้งแต่ครั้งแรก เก็บไว้ดูเท่านั้น)
    report({ result: allCorrect ? "pass" : "fail", score: pct });
  }

  function startGame() {
    // ต้องกดปุ่มเองก่อน เบราว์เซอร์จึงยอมให้ VDO เล่นเองพร้อมเสียงในข้อถัดๆ ไป
    beginQuestion(game!.pairs[0]);
  }

  function resetAll() {
    if (!game) return;
    if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current);
    // ผลที่ยังรอ ack อยู่ปล่อยให้รอต่อ ส่วนสถานะอื่นเริ่มใหม่
    if (!pendingRef.current) {
      setPortalStatus("idle");
      setPortalMsg(null);
    }
    setChoices(makeChoices(game.pairs));
    setSolved({});
    setQIndex(0);
    setWrongIds(new Set());
    setCorrectId(null);
    setElapsed(0);
    setSummary(null);
    setPhase("idle");
  }

  function handleVideoEnded() {
    setPhase("answering");
  }

  function handleVideoTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    maxWatchedRef.current = Math.max(maxWatchedRef.current, v.currentTime);
    if (v.duration > 0) setVideoProgress(v.currentTime / v.duration);
  }

  // กรอไปข้างหน้าไม่ได้ (ไม่มีแถบควบคุมให้กรออยู่แล้ว กันกรณีกดคีย์ลัดของเบราว์เซอร์)
  function handleVideoSeeking() {
    const v = videoRef.current;
    if (v && v.currentTime > maxWatchedRef.current + 0.5) v.currentTime = maxWatchedRef.current;
  }

  function handlePick(option: Choice) {
    if (phase !== "answering" || correctId !== null || wrongIds.has(option.id) || !game) return;
    if (!option.correct) {
      setWrongIds((prev) => new Set(prev).add(option.id));
      return;
    }
    // ถูกตั้งแต่ครั้งแรกก็ต่อเมื่อยังไม่เคยกดผิดในข้อนี้
    const nextSolved = { ...solved, [pair.id]: wrongIds.size === 0 };
    setSolved(nextSolved);
    setCorrectId(option.id);
    const isLast = qIndex >= game.pairs.length - 1;
    const timeUsed = elapsed;
    nextTimerRef.current = window.setTimeout(() => {
      if (isLast) {
        finishGame(true, nextSolved, timeUsed);
        return;
      }
      const nextIndex = qIndex + 1;
      setQIndex(nextIndex);
      beginQuestion(game.pairs[nextIndex]);
    }, CORRECT_PAUSE_MS);
  }

  function renderPrompt(p: MatchPair) {
    const hasImg = p.promptType !== "text" && Boolean(p.promptImage);
    return (
      <div className="flex min-w-0 flex-col items-center gap-3 rounded-sm border-2 border-f1-line border-l-[6px] border-l-[#DC0000] bg-white p-4 shadow-sm fit:gap-2 fit:p-3">
        {hasImg && (
          <img
            src={p.promptImage}
            alt={p.promptText}
            draggable={false}
            className="max-h-48 w-auto max-w-full object-contain fit:max-h-[22vh]"
          />
        )}
        {p.promptText && (
          <p className="f1-font-display break-words text-center text-xl font-bold text-f1-ink lg:text-3xl fit:text-xl fit:2xl:text-3xl">
            {p.promptText}
          </p>
        )}
      </div>
    );
  }

  const progressDots = (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`ข้อที่ ${qIndex + 1} จาก ${total}`}>
      {game.pairs.map((p, i) => (
        <span
          key={p.id}
          className={cn(
            "h-2.5 w-6 rounded-full",
            p.id in solved ? "bg-[#15803D]" : i === qIndex && !over ? "bg-[#DC0000]" : "bg-zinc-300",
          )}
        />
      ))}
    </div>
  );

  return (
    // ตอนถูกฝัง portal วางปุ่ม "ผ่านสถานี" ทับขอบล่าง ~90px จึงเว้นที่ไว้
    <div
      className={cn(
        "f1-paper-bg min-h-screen fit:flex fit:h-dvh fit:flex-col fit:overflow-y-auto fit:pb-0",
        embedded ? "pb-28" : "pb-16",
      )}
    >
      <F1Header />
      <main className="flex w-full flex-1 flex-col gap-4 px-6 py-6 lg:px-12 fit:gap-2 fit:px-8 fit:py-2">
        <div className="flex flex-col gap-3 fit:flex-row fit:items-center fit:gap-4">
          <div className="fit:shrink-0">
            <GameTitle name={game.name} />
            <p className="f1-font-display mt-1 text-sm font-medium tracking-widest text-f1-red fit:mt-0 fit:text-xs">
              WATCH • ANSWER • NEXT LAP
            </p>
          </div>

          <div className="flex flex-col gap-2 fit:flex-1">
            <div className="f1-font-mono flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border-2 border-[#DC0000] bg-f1-ink px-4 py-3 fit:py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-zinc-400">⏱ TIME</span>
                <span
                  className={cn(
                    "text-2xl font-bold text-white",
                    lowTime && timerRunning && "f1-timer-blink text-f1-red-bright",
                  )}
                >
                  {remaining !== null ? formatTime(remaining) : formatTime(elapsed)}
                </span>
              </div>
              <p className="f1-font-display text-sm text-zinc-300">
                · ข้อ{" "}
                <strong className="text-white">
                  {over ? total : Math.min(qIndex + 1, total)}/{total}
                </strong>{" "}
                · ตอบถูกแล้ว <strong className="text-white">{solvedCount}</strong>
              </p>
              <div className="ml-auto">{progressDots}</div>
            </div>

            {remaining !== null && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-300">
                <div
                  className={cn(
                    "h-full rounded-full bg-[#DC0000] transition-all",
                    lowTime && timerRunning && "f1-timer-blink",
                  )}
                  style={{ width: `${(remaining / limit) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ===== หน้าเริ่มเกม (เฉพาะเปิดเกมตรงๆ) ===== */}
        {phase === "idle" && (
          <div className="f1-font-display mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-sm border-2 border-f1-line bg-white p-8 text-center text-f1-ink">
            <p className="text-lg font-bold text-f1-red">🚦 READY TO RACE</p>
            <ol className="space-y-1 text-left text-sm">
              <li>1. ดู VDO ให้จบ (ข้ามหรือกรอไม่ได้)</li>
              <li>2. เมื่อ VDO จบ ตัวเลือกคำตอบจะขึ้นมา — เลือกคำตอบที่ถูก</li>
              <li>3. ถ้าตอบผิด เลือกใหม่ได้เรื่อยๆ จนกว่าจะถูก</li>
              <li>4. ตอบถูกแล้วจะไป VDO ข้อถัดไปเอง จนครบทั้ง {total} ข้อ</li>
              {hasLimit && <li>⏱ เวลารวม {formatTime(limit)} นาที (ไม่นับเวลาที่ดู VDO)</li>}
            </ol>
            <Button className="f1-glow f1-font-display bg-red-600 px-8 text-white hover:bg-red-700" onClick={startGame}>
              🏁 เริ่มเกม
            </Button>
          </div>
        )}

        {/* ===== ดู VDO ===== */}
        {phase === "video" && pair.video && (
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-2">
            <div className="f1-font-display flex items-center justify-between text-sm font-bold text-f1-red">
              <span>🎬 ข้อที่ {qIndex + 1} — ดู VDO ให้จบก่อนตอบ</span>
              <span className="f1-font-mono text-xs text-f1-mute">{Math.round(videoProgress * 100)}%</span>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-sm border-4 border-f1-ink bg-black">
              <video
                key={`${pair.id}-${videoAttempt}`}
                ref={videoRef}
                src={pair.video}
                playsInline
                controls={false}
                disablePictureInPicture
                controlsList="nodownload noplaybackrate noremoteplayback"
                onContextMenu={(e) => e.preventDefault()}
                onEnded={handleVideoEnded}
                onTimeUpdate={handleVideoTimeUpdate}
                onSeeking={handleVideoSeeking}
                onPlay={() => setNeedsTap(false)}
                onError={() => setVideoError(true)}
                className="max-h-[70vh] w-full object-contain fit:max-h-full"
              />
              {needsTap && !videoError && (
                <button
                  type="button"
                  onClick={() => videoRef.current?.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true))}
                  className="f1-font-display absolute inset-0 flex items-center justify-center bg-black/60 text-2xl font-bold text-white"
                >
                  ▶ แตะเพื่อเริ่มดู VDO
                </button>
              )}
              {videoError && (
                <div className="f1-font-display absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-white">
                  <p className="text-lg font-bold">โหลด VDO ไม่ได้</p>
                  <div className="flex gap-2">
                    <Button className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={() => setVideoAttempt((n) => n + 1)}>
                      ลองใหม่
                    </Button>
                    {/* VDO เสียทำให้เกมค้างทั้งสถานี จึงยอมให้ไปตอบเลยได้เฉพาะกรณีโหลดไม่ได้จริงๆ */}
                    <Button variant="outline" className="border-white bg-transparent text-white hover:bg-white/10" onClick={handleVideoEnded}>
                      ข้ามไปตอบเลย
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-300">
              <div className="h-full rounded-full bg-[#DC0000]" style={{ width: `${videoProgress * 100}%` }} />
            </div>
          </div>
        )}

        {/* ===== ตอบคำถาม ===== */}
        {(phase === "answering" || over) && (
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 fit:gap-2">
            <h2 className="f1-font-display text-lg font-bold tracking-wide text-f1-ink fit:text-sm">
              📝 ข้อที่ {Math.min(qIndex + 1, total)} • เลือกคำตอบที่ถูก
            </h2>
            {renderPrompt(pair)}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 fit:gap-2">
              {options.map((opt) => {
                const isCorrect = correctId === opt.id;
                const isWrong = wrongIds.has(opt.id);
                const hasImg = opt.type !== "text" && Boolean(opt.image);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={over || correctId !== null || isWrong}
                    onClick={() => handlePick(opt)}
                    className={cn(
                      "f1-font-display relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-4 p-3 text-center text-lg font-medium text-f1-ink transition-colors fit:min-h-16 fit:text-base fit:2xl:text-xl",
                      "border-[#8B8B95] bg-white hover:border-[#DC0000] hover:bg-[#DC0000]/5",
                      isCorrect && "f1-correct-bounce border-[#15803D] bg-f1-ok-bg hover:border-[#15803D] hover:bg-f1-ok-bg",
                      isWrong && "f1-shake border-[#DC0000] bg-[#DC0000]/10 opacity-70 hover:border-[#DC0000]",
                    )}
                  >
                    {hasImg && (
                      <img src={opt.image} alt="" draggable={false} className="max-h-32 w-full object-contain fit:max-h-[14vh]" />
                    )}
                    <span className="leading-snug">
                      <span className="mr-1 text-f1-red">{opt.letter}.</span>
                      {opt.text}
                    </span>
                    {isCorrect && (
                      <span className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#15803D] text-base font-bold text-white shadow">
                        ✓
                      </span>
                    )}
                    {isWrong && (
                      <span className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#DC0000] text-base font-bold text-white shadow">
                        ✗
                      </span>
                    )}
                    {isCorrect && <div className="f1-checkered-flash pointer-events-none absolute inset-0 rounded-xl" />}
                    {isWrong && <div className="f1-redflag-flash pointer-events-none absolute inset-0 rounded-xl" />}
                  </button>
                );
              })}
            </div>

            <p className="f1-font-display min-h-6 text-center text-sm font-bold" aria-live="polite">
              {correctId !== null && <span className="text-[#15803D]">✅ ถูกต้อง!{qIndex < total - 1 ? " กำลังไปข้อถัดไป…" : ""}</span>}
              {correctId === null && wrongIds.size > 0 && !over && (
                <span className="text-[#DC0000]">❌ ยังไม่ถูก ลองเลือกใหม่อีกครั้ง</span>
              )}
            </p>
          </div>
        )}

        {!embedded && phase !== "idle" && !over && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              className="f1-font-display border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
              onClick={resetAll}
            >
              เริ่มใหม่ทั้งหมด
            </Button>
          </div>
        )}
      </main>

      {summary?.allCorrect && showSummary && <Confetti />}

      {summary && tier && showSummary && (
        <div
          className={cn(
            "fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4",
            embedded && "pb-28",
          )}
        >
          <div className="f1-font-display relative my-auto w-full max-w-lg rounded-sm border-4 border-[#DC0000] bg-white p-6 text-f1-ink">
            <button
              type="button"
              onClick={() => setShowSummary(false)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#DC0000] font-bold text-white"
              aria-label="ปิดสรุปผล"
            >
              ✕
            </button>
            <p className="px-6 text-center text-xs font-medium tracking-widest text-f1-red">🏆 RACE RESULT • SUMMARY</p>
            <p className="mt-1 px-6 text-center text-2xl font-bold">
              {summary.timeout && "⏰ หมดเวลา! "}
              {tier.title}
            </p>
            {tier.sub && <p className="mt-1 text-center text-sm text-f1-red">{tier.sub}</p>}

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center justify-center gap-2 rounded-sm px-3 py-2 text-center text-sm",
                  portalStatus === "sending" && "bg-zinc-100 text-f1-ink",
                  portalStatus === "sent" && "bg-f1-ok-bg text-f1-ok-ink",
                  portalStatus === "error" && "bg-f1-bad-bg text-f1-bad",
                )}
              >
                {portalStatus === "sending" && "📡 กำลังส่งผลไปที่จอ…"}
                {portalStatus === "sent" && "✓ ส่งผลไปที่จอแล้ว"}
                {portalStatus === "error" && (
                  <>
                    <span>ส่งผลไม่สำเร็จ: {portalMsg}</span>
                    <Button size="sm" className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={resendReport}>
                      ส่งใหม่
                    </Button>
                  </>
                )}
              </div>
            )}

            <div className="f1-font-mono mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">TIME USED</p>
                <p className="text-lg font-bold">{formatTime(summary.timeUsedSeconds)}</p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">FIRST TRY</p>
                <p className="text-lg font-bold">
                  {summary.firstTry}/{summary.total}
                </p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">ACCURACY</p>
                <p className="text-lg font-bold">{Math.round((summary.firstTry / summary.total) * 100)}%</p>
              </div>
            </div>

            <p className="mt-4 text-center font-bold text-f1-red">ผลทีละข้อ</p>
            <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {game.pairs.map((p, i) => (
                <div key={p.id} className="flex items-start justify-between gap-3 rounded-sm border border-f1-line bg-zinc-100 p-2 text-sm">
                  <span className="min-w-0 break-words font-bold">
                    {i + 1}. {p.promptText || "(ภาพ)"}
                  </span>
                  <span className="shrink-0">
                    {!(p.id in solved) ? "⬜ ยังไม่ได้ตอบ" : solved[p.id] ? "✅ ถูกครั้งแรก" : "🔁 ถูกหลังลองใหม่"}
                  </span>
                </div>
              ))}
            </div>

            {/* บนจอ Station ส่งผลแล้วจอเป็นคนไปต่อ: ผ่าน → สถานีถัดไป, ไม่ผ่าน → โหลดเกมใหม่ (docs/STATION_ACTIVITY.md ของ portal) */}
            {resultHandedOff && (
              <p className="mt-4 text-center text-sm font-medium text-f1-mute">
                {lastReportRef.current?.result === "pass"
                  ? "ผ่านแล้ว — จอจะไปสถานีถัดไปเอง"
                  : "จอจะโหลดเกมใหม่ให้ลองอีกครั้ง"}
              </p>
            )}

            {!embedded && (
              <div className="mt-5 flex justify-center">
                <Button className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={resetAll}>
                  เล่นใหม่
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
