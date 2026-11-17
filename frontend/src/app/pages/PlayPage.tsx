import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleX, Flag, Home, Loader2, Play, RotateCcw, ThumbsUp, Trophy, X } from "lucide-react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import type { AnswerOption, MatchPair, Theme } from "../types/theme";
import { getGame, isPairComplete, NoGameError } from "../utils/gameStore";
import { forwardKeys, isEmbedded, listenPortal, sendResult, type PortalAck, type PortalResult } from "../utils/portalBridge";

// idle = รอกดเริ่ม · jigsaw = นับถอยหลังเกมจิ๊กซอนอกเว็บ · jigsawDone = หมดเวลาจิ๊กซอ
// playing = กำลังเล่น (เกมตอบคำถาม) · finished = จบเกมตอบคำถาม (ตอบครบหรือหมดเวลา)
// จิ๊กซออยู่ก่อนหรือหลังเกมตอบคำถามได้ (game.firstGame) — jigsaw/jigsawDone ใช้ซ้ำทั้ง 2 ตำแหน่ง ดูบริบทจาก game.firstGame ตอน render
type Phase = "idle" | "jigsaw" | "jigsawDone" | "playing" | "finished";
// 1 ข้อที่จะเล่น: ตัวเลือกสลับลำดับไว้แล้วตอนเริ่มรอบ
type Round = { pair: MatchPair; options: AnswerOption[] };
type Summary = { score: number; total: number; required: number; passed: boolean; timeout: boolean; timeUsed: number };
type PortalStatus = "idle" | "sending" | "sent" | "error";
type PortalReport = { result: PortalResult; score: number };

// portal ไม่ตอบ ack ภายในเวลานี้ = ถือว่ายังไม่ได้บันทึก (PORTAL_INTEGRATION.md ข้อ 2)
const ACK_TIMEOUT_MS = 10_000;
// หน่วงหลังตอบ ให้ผู้เล่นเห็นผลก่อนไปข้อถัดไป (GAMEPLAY.md 3.3 ข้อ 6)
const REVEAL_MS = 2200;
// ตอบผิด: ให้เห็นเอฟเฟกต์ผิดก่อน แล้วค่อยเด้งป๊อปอัปถามดู VDO ซ้ำ
const WRONG_REVEAL_MS = 700;
// จิ๊กซอเป็นเกมที่สอง (ปิดท้าย): ให้เห็นหน้าสรุปผล PASS/FAIL แป๊บนึงก่อนขึ้นนับถอยหลังต่อเอง
const SECOND_GAME_DELAY_MS = 3000;
// เวลาเหลือเท่านี้ (วินาที) ตัวเลขเริ่มกะพริบ
const LOW_TIME_S = 30;
const LETTERS = "ABCDEFGHIJ";
// ตอนถูกฝัง: เว้นขอบล่างให้ปุ่ม "ENTER / SPACEBAR · ผ่านสถานี" ของ portal (~90px, STATION_ACTIVITY.md ข้อ 5)
const PORTAL_BOTTOM_GAP = "pb-[96px]";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ข้อเรียงตามที่บันทึกไว้ · ตัวเลือกสุ่มลำดับทุกรอบ (ไม่งั้นตัวถูกอยู่ตำแหน่งเดิมเสมอ)
function makeRounds(game: Theme): Round[] {
  return game.pairs.filter(isPairComplete).map((pair) => ({ pair, options: shuffle(pair.answers) }));
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function GameTitle({ name }: { name: string }) {
  // "I-DOJO - PIT 4 5S" → ส่วนหลัง " - " เป็นสีแบรนด์
  const m = name.match(/^(.*?\S)\s+-\s+(.+)$/);
  return (
    <h1 className="f1-font-display truncate text-lg font-bold leading-tight text-f1-ink sm:text-2xl lg:text-3xl">
      <Flag className="mr-2 inline size-5 align-[-0.1em] text-f1-brand-ink sm:size-6 lg:size-8" />
      {m ? `${m[1]} - ` : name}
      {m && <span className="text-f1-brand-ink">{m[2]}</span>}
    </h1>
  );
}

// นาฬิกาแข่ง: ตัวเลขใหญ่ + วงแหวนเวลาที่เหลือ · ≤ 30 วิ แดงกะพริบ · ≤ 10 วิ กรอบเต้น
function RaceClock({ remaining, elapsed, limit, running }: { remaining: number | null; elapsed: number; limit: number; running: boolean }) {
  const low = remaining !== null && remaining <= LOW_TIME_S;
  const critical = remaining !== null && remaining <= 10;
  const ratio = remaining !== null && limit > 0 ? remaining / limit : 1;
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border-2 pl-1.5 pr-4 shadow-md transition-colors duration-500 sm:h-14 sm:gap-3 sm:pr-5 lg:h-16 lg:pr-6",
        low && running ? "border-f1-wrong shadow-[0_0_24px_rgba(220,0,0,0.6)]" : "border-f1-brand-bright",
        critical && running && "f1-clock-pulse",
      )}
      style={{ backgroundColor: "#18181b" }}
      role="timer"
      aria-label={remaining !== null ? "เวลาที่เหลือ" : "เวลาที่ใช้"}
    >
      <svg viewBox="0 0 36 36" className="size-8 shrink-0 -rotate-90 sm:size-11 lg:size-13">
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="4" className="stroke-white/15" />
        <circle
          cx="18"
          cy="18"
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-1000 ease-linear",
            remaining === null ? "stroke-white/40" : low ? "stroke-f1-wrong-bright" : "stroke-f1-brand-bright",
          )}
        />
      </svg>
      <span
        className={cn(
          "f1-font-mono text-2xl font-bold tabular-nums leading-none sm:text-4xl lg:text-5xl",
          low && running ? "f1-timer-blink text-f1-wrong-bright" : "text-white",
        )}
      >
        {formatTime(remaining ?? elapsed)}
      </span>
    </div>
  );
}

// ระหว่าง VDO กำลังเล่น หยุดแอนิเมชันที่วนไม่หยุด (html.f1-video-playing ใน f1.css) ให้ Pi ถอดรหัส VDO ได้เต็มที่
function setVideoPlaying(on: boolean) {
  document.documentElement.classList.toggle("f1-video-playing", on);
}

// VDO ของข้อ: อยู่ในการ์ดคำถามตลอด เล่นวนซ้ำไปเรื่อย ๆ ไม่บังคับดูจบ — ตัวเลือกโผล่ทันที
// browser บล็อกเล่นอัตโนมัติ (มีเสียง ยังไม่เคยมี user gesture) → แสดงปุ่มให้แตะเล่น
function PromptVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  function tryPlay() {
    const v = ref.current;
    if (!v) return;
    setBlocked(false);
    v.play().catch((e: unknown) => {
      // error อื่น (ไฟล์เสีย/โหลดไม่ได้) ปล่อยผ่าน ไม่บล็อกเกม
      if (e instanceof DOMException && e.name === "NotAllowedError") setBlocked(true);
    });
  }

  // เปลี่ยนข้อ (src เปลี่ยน) → เล่นตัวใหม่ทันที · ออกจากข้อนี้ → เอา class ออก แอนิเมชันที่วนไม่หยุดกลับมาเล่นต่อ
  useEffect(() => {
    tryPlay();
    return () => setVideoPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg bg-black">
      <video
        ref={ref}
        src={src}
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        onPlaying={() => setVideoPlaying(true)}
        onPause={() => setVideoPlaying(false)}
        // ครอปเต็มกรอบเสมอ (object-cover) — กรอบขนาดไม่เท่าสัดส่วนวิดีโอ จะไม่มีแถบดำซ้าย-ขวา/บน-ล่าง
        // object-left: ครอปแล้วยึดฝั่งซ้ายของวิดีโอไว้เสมอ (ส่วนที่โดนตัดออกจะอยู่ขวา)
        className="h-full w-full object-cover object-left"
      />
      {blocked && (
        <button
          type="button"
          onClick={tryPlay}
          className="f1-font-display f1-press absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-lg font-bold text-white lg:text-3xl"
        >
          <span className="f1-glow flex size-16 items-center justify-center rounded-full bg-f1-brand-bright text-f1-ink shadow-lg lg:size-24">
            <Play className="size-8 translate-x-0.5 lg:size-12" fill="currentColor" />
          </span>
          แตะเพื่อเล่น VDO
        </button>
      )}
    </div>
  );
}

export function PlayPage() {
  const [game, setGame] = useState<Theme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [index, setIndex] = useState(0);
  // ผลของข้อที่ตอบถูกแล้ว ตามลำดับ (ทุกตัวเป็น true — ต้องตอบจนถูกถึงจะผ่านข้อ) · คะแนน = จำนวนข้อที่ตอบถูกแล้ว
  const [results, setResults] = useState<boolean[]>([]);
  // จำนวนครั้งที่ตอบจนถูก ของแต่ละข้อที่ผ่านแล้ว (ใช้แสดงในหน้าสรุป)
  const [tries, setTries] = useState<number[]>([]);
  // ตัวเลือกที่ตอบผิดไปแล้วในข้อปัจจุบัน — กดซ้ำไม่ได้
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  // ป๊อปอัปหลังตอบผิด: ให้ตอบใหม่
  const [retryPrompt, setRetryPrompt] = useState(false);
  // ตัวเลือกที่เพิ่งกด (ระหว่างหน่วงโชว์ผล) — มีค่า = ล็อกไม่ให้กดซ้ำ
  const [picked, setPicked] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // เวลาที่นับถอยหลังไปแล้วในเฟสจิ๊กซอ (เกมแรก) — แยกจาก elapsed ของเกมตอบคำถาม
  const [jigsawElapsed, setJigsawElapsed] = useState(0);
  // เอฟเฟกต์ทับหน้าจอ · n เปลี่ยนทุกครั้งให้แอนิเมชันเริ่มใหม่
  const [flash, setFlash] = useState<{ ok: boolean; n: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // เพิ่มทุกครั้งที่เริ่มรอบใหม่ — ใช้เป็น key ให้ VDO เริ่มใหม่แม้เป็นข้อเดิม
  const [roundId, setRoundId] = useState(0);

  const [portalStatus, setPortalStatus] = useState<PortalStatus>("idle");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const embedded = isEmbedded();
  const advanceTimerRef = useRef<number | null>(null);
  // finish() ถูกเรียกจาก setTimeout ของ render ก่อนหน้า — อ่านเวลาล่าสุดผ่าน ref
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;
  // ผลที่ส่งแล้วกำลังรอ ack (กันส่งซ้ำ) และผลล่าสุดไว้กด "ส่งใหม่" ตอน portal ตอบว่าบันทึกไม่สำเร็จ
  const pendingRef = useRef<PortalReport | null>(null);
  const lastReportRef = useRef<PortalReport | null>(null);
  const reportedRef = useRef(false);
  const ackTimerRef = useRef<number | null>(null);
  const portalStatusRef = useRef<PortalStatus>("idle");
  portalStatusRef.current = portalStatus;

  // ขยายทั้งหน้าตามขนาดจอ (html.f1-play-scale ใน f1.css) — เฉพาะหน้าเกม หน้า editor คงขนาดเดิม
  // ?lite=1 = โหมดเบาสำหรับจอที่เครื่องไม่แรง (ตั้งใน URL กิจกรรมที่หน้า Admin ของ portal) — ดู VIDEO_GUIDE.md
  useEffect(() => {
    const root = document.documentElement;
    const lite = new URLSearchParams(window.location.search).get("lite") === "1";
    root.classList.add("f1-play-scale");
    if (lite) root.classList.add("f1-lite");
    return () => root.classList.remove("f1-play-scale", "f1-lite", "f1-video-playing");
  }, []);

  useEffect(() => {
    setLoadError(null);
    getGame()
      .then((g) => {
        if (g.pairs.filter(isPairComplete).length < 2) throw new NoGameError();
        setGame(g);
      })
      .catch((e) => {
        setLoadError(
          e instanceof NoGameError
            ? "ยังไม่มีชุดคำถามบน server"
            : `โหลดชุดคำถามไม่ได้${e instanceof Error ? ` (${e.message})` : ""}`,
        );
      });
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
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const clockRunning = phase === "playing";
  useEffect(() => {
    if (!clockRunning) return;
    const timer = window.setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => window.clearInterval(timer);
  }, [clockRunning]);

  const limit = game?.timeLimitSeconds ?? 0;
  useEffect(() => {
    if (phase === "playing" && limit > 0 && elapsed >= limit) finish(results, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, phase, limit]);

  const jigsawLimit = game?.jigsawTimeLimitSeconds ?? 0;
  const jigsawRunning = phase === "jigsaw";
  useEffect(() => {
    if (!jigsawRunning) return;
    const timer = window.setInterval(() => setJigsawElapsed((prev) => prev + 1), 1000);
    return () => window.clearInterval(timer);
  }, [jigsawRunning]);
  useEffect(() => {
    if (phase === "jigsaw" && jigsawElapsed >= jigsawLimit) setPhase("jigsawDone");
  }, [jigsawElapsed, phase, jigsawLimit]);

  if (!game) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="f1-font-display f1-pop-in-spring mx-auto max-w-3xl space-y-3 p-6 text-f1-ink lg:max-w-5xl lg:space-y-5">
          <p className="text-lg font-bold lg:text-4xl">{loadError ?? "กำลังโหลด..."}</p>
          {loadError && (
            <>
              <p className="text-sm text-f1-mute lg:text-2xl">ผู้ดูแลตั้งค่าชุดคำถามได้ที่หน้า /I-DOJO/editor (ต้องมีข้อที่สมบูรณ์อย่างน้อย 2 ข้อ)</p>
              <Button className="f1-press bg-f1-brand text-f1-on-brand hover:bg-f1-brand-dark lg:h-14 lg:px-8 lg:text-2xl" onClick={() => setLoadAttempt((n) => n + 1)}>
                ลองใหม่
              </Button>
            </>
          )}
        </main>
      </div>
    );
  }

  const total = rounds.length;
  const current = rounds[index];
  // โชว์ overlay เฉลยกลางจอตอนตอบถูก — อยู่พร้อมกันกับช่วงที่ปุ่มตัวเลือกเขียวเด้ง (picked ถูกเคลียร์ตอนไปข้อถัดไป)
  const pickedCorrectOption = picked ? current?.options.find((o) => o.id === picked && o.correct) : undefined;
  const hasLimit = limit > 0;
  const remaining = hasLimit ? Math.max(0, limit - elapsed) : null;
  const lowTime = remaining !== null && remaining <= LOW_TIME_S;
  const jigsawRemaining = Math.max(0, jigsawLimit - jigsawElapsed);
  const jigsawLowTime = jigsawRemaining <= LOW_TIME_S;
  // จิ๊กซอถูกตั้งเป็นเกมที่สอง (ปิดท้าย) — ไม่มี "เกมถัดไป" ให้ไปต่อแล้วหลังจิ๊กซอรอบนี้จบ
  const jigsawIsSecondGame = game.firstGame === "quiz" && jigsawLimit > 0;
  const score = results.filter(Boolean).length;
  const playableCount = game.pairs.filter(isPairComplete).length;
  const requiredOf = (n: number) => Math.ceil((n * game.passPercent) / 100);
  // ตอนถูกฝัง: ส่งผลไปแล้ว (กำลังรอ/ได้ ack) → ให้จอจัดการต่อ
  const resultHandedOff = embedded && (portalStatus === "sending" || portalStatus === "sent");

  // ส่งผลขึ้นจอ Station · ส่งครั้งเดียวต่อรอบ — ส่งซ้ำได้เฉพาะกด "ส่งใหม่" หลัง portal ตอบว่าไม่สำเร็จ/ไม่ตอบ
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

  // กดเริ่มเกมจากหน้าหลัก: จิ๊กซอเป็นเกมแรก + มีเวลาตั้งไว้ → เข้าเฟสนับถอยหลังก่อน
  // ไม่งั้น (ข้ามจิ๊กซอ หรือจิ๊กซอถูกตั้งให้เป็นเกมที่สอง) → เข้าเกมตอบคำถามเลย
  function startFlow() {
    if (!game) return;
    if (game.firstGame === "jigsaw" && game.jigsawTimeLimitSeconds > 0) {
      setJigsawElapsed(0);
      setPhase("jigsaw");
      return;
    }
    startGame();
  }

  function startGame() {
    if (!game) return;
    const next = makeRounds(game);
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    if (!pendingRef.current) {
      setPortalStatus("idle");
      setPortalMsg(null);
    }
    reportedRef.current = false;
    setRounds(next);
    setRoundId((n) => n + 1);
    setIndex(0);
    setResults([]);
    setTries([]);
    setWrongIds([]);
    setRetryPrompt(false);
    setPicked(null);
    setElapsed(0);
    setFlash(null);
    setSummary(null);
    setPhase("playing");
  }

  // จบเกม: หยุดเวลา คิดผล ส่ง portal · คะแนน = ข้อที่ตอบถูกแล้ว (ไม่สนว่ากี่ครั้ง) · ข้อที่ยังตอบไม่ถูกตอนหมดเวลา นับว่าผิด
  function finish(finalResults: boolean[], timeout: boolean) {
    if (!game || reportedRef.current) return;
    reportedRef.current = true;
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    const s = finalResults.filter(Boolean).length;
    const required = requiredOf(total);
    const passed = s >= required;
    setPhase("finished");
    setPicked(null);
    setRetryPrompt(false);
    setSummary({ score: s, total, required, passed, timeout, timeUsed: hasLimit ? Math.min(elapsedRef.current, limit) : elapsedRef.current });
    // score ที่ส่ง portal = % ของข้อที่ตอบถูก จำนวนเต็ม 0–100 (STATION_ACTIVITY.md 3.1) — หน้าสรุปยังแสดงเป็นจำนวนข้อ
    report({ result: passed ? "pass" : "fail", score: total > 0 ? Math.round((100 * s) / total) : 0 });
    // จิ๊กซอเป็นเกมที่สอง (ปิดท้าย) → ส่งผลไป portal ไปแล้วด้านบน (ไม่รอ ack) แล้วค่อยขึ้นนับถอยหลังต่อเองหลังให้เห็นผลแป๊บนึง
    if (game.firstGame === "quiz" && game.jigsawTimeLimitSeconds > 0) {
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        setJigsawElapsed(0);
        setPhase("jigsaw");
      }, SECOND_GAME_DELAY_MS);
    }
  }

  // ตอบผิด → เอฟเฟกต์ผิด แล้วเด้งป๊อปอัปให้เลือกดู VDO ซ้ำ/ตอบใหม่ · อยู่ข้อเดิมจนกว่าจะตอบถูก
  // ตอบถูก → เอฟเฟกต์ถูก แล้วไปข้อถัดไป (ได้คะแนนข้อนี้ ไม่ว่าจะตอบกี่ครั้ง)
  function choose(option: AnswerOption) {
    if (phase !== "playing" || picked || retryPrompt || !current) return;
    if (wrongIds.includes(option.id)) return;
    const ok = Boolean(option.correct);
    setPicked(option.id);
    setFlash((prev) => ({ ok, n: (prev?.n ?? 0) + 1 }));
    if (!ok) {
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        setPicked(null);
        setWrongIds((prev) => [...prev, option.id]);
        setRetryPrompt(true);
      }, WRONG_REVEAL_MS);
      return;
    }
    const nextResults = [...results, true];
    setResults(nextResults);
    setTries((prev) => [...prev, wrongIds.length + 1]);
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (index + 1 >= total) {
        finish(nextResults, false);
        return;
      }
      setIndex(index + 1);
      setPicked(null);
      setWrongIds([]);
    }, REVEAL_MS);
  }

  // กลับหน้าหลัก = หน้าเริ่มเกม ("พร้อมออกตัว?") รอกดเริ่มรอบใหม่
  function goHome() {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    if (!pendingRef.current) {
      setPortalStatus("idle");
      setPortalMsg(null);
    }
    setSummary(null);
    setFlash(null);
    setPicked(null);
    setRetryPrompt(false);
    setElapsed(0);
    setJigsawElapsed(0);
    setPhase("idle");
  }

  function renderPrompt(pair: MatchPair) {
    const hasVideo = Boolean(pair.video);
    const hasImg = !hasVideo && pair.promptType !== "text" && Boolean(pair.promptImage);
    const hasText = Boolean(pair.promptText.trim());
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 sm:gap-3 lg:gap-4">
        {hasVideo && <PromptVideo src={pair.video!} />}
        {hasImg && (
          <img
            src={pair.promptImage}
            alt={pair.promptText}
            draggable={false}
            className="min-h-0 w-full flex-1 rounded-lg object-contain"
          />
        )}
        {hasText && (
          <p className="f1-font-display shrink-0 text-center text-xl font-bold leading-snug text-f1-ink sm:text-3xl lg:text-5xl">
            {pair.promptText}
          </p>
        )}
      </div>
    );
  }

  function renderOption(option: AnswerOption, i: number) {
    const revealing = picked !== null;
    const isPicked = picked === option.id;
    const isCorrect = Boolean(option.correct);
    // หลังตอบ: ตัวที่กดถูก = เขียวเด้ง · กดผิด = แดงสั่น (ไม่เฉลยตัวที่ถูก) · ตัวอื่นจาง
    const showOk = revealing && isPicked && isCorrect;
    const showBad = revealing && isPicked && !isCorrect;
    // ตัวที่ตอบผิดไปแล้วในข้อนี้ — จาง มีกากบาท กดซ้ำไม่ได้
    const eliminated = !isPicked && wrongIds.includes(option.id);
    const hasImg = option.type !== "text" && Boolean(option.image);
    return (
      // กรอบนอกเล่นแอนิเมชันโผล่ทีละใบ · ปุ่มข้างในเล่นกดยุบ/เยลลี่/สั่น (แยกกันไม่ให้ animation ทับกันแล้วเล่นซ้ำ)
      // flex-1: เรียงแนวตั้งฝั่งขวา แบ่งพื้นที่เท่ากันทุกตัวเลือก
      <div key={option.id} className="f1-option-in flex min-h-0 min-w-0 flex-1" style={{ animationDelay: `${i * 80}ms` }}>
        <button
          type="button"
          disabled={revealing || retryPrompt || eliminated}
          onClick={() => choose(option)}
          className={cn(
            "f1-font-display f1-press relative flex min-h-0 min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-xl border-2 bg-white p-2 text-left shadow-sm sm:p-3 lg:gap-4 lg:rounded-2xl lg:border-4 lg:p-4",
            !revealing && !eliminated && "border-f1-line hover:-translate-y-1 hover:border-f1-brand hover:shadow-lg",
            eliminated && "cursor-not-allowed border-f1-line opacity-40 grayscale",
            showOk && "f1-jelly border-[#15803D] bg-f1-ok-bg ring-4 ring-[#15803D]/40",
            showBad && "f1-wobble border-f1-wrong bg-f1-bad-bg",
            revealing && !showOk && !showBad && "border-f1-line opacity-50",
          )}
        >
          <span
            className={cn(
              "f1-font-mono flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold transition-colors duration-200 sm:size-10 sm:text-lg lg:size-14 lg:rounded-lg lg:text-2xl",
              // พื้นเหลืองใช้ตัวอักษรเข้ม (ขาวบนเหลืองอ่านไม่ออก)
              showOk ? "bg-[#15803D] text-white" : showBad || eliminated ? "bg-f1-wrong text-white" : "bg-f1-brand text-f1-on-brand",
            )}
          >
            {showOk ? (
              <Check className="f1-icon-pop size-5 lg:size-8" strokeWidth={3} />
            ) : showBad || eliminated ? (
              <X className={cn("size-5 lg:size-8", showBad && "f1-icon-pop")} strokeWidth={3} />
            ) : (
              LETTERS[i]
            )}
          </span>
          <span className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 sm:flex-row sm:justify-start sm:gap-3">
            {hasImg && (
              <img src={option.image} alt="" draggable={false} className="max-h-full min-h-0 w-full flex-1 rounded-md object-contain sm:w-auto sm:max-w-[50%] sm:flex-none" />
            )}
            {option.text && (
              <span className="line-clamp-3 text-base font-bold leading-snug text-f1-ink sm:text-xl lg:text-3xl">{option.text}</span>
            )}
          </span>
        </button>
      </div>
    );
  }

  return (
    // เต็มจอทุกอุปกรณ์ (h-dvh) · ตอนถูกฝัง portal วางปุ่ม "ผ่านสถานี" ทับขอบล่าง ~90px จึงเว้นที่ไว้
    // เว้นเป็น px คงที่ (ปุ่มของ portal ไม่ได้ขยายตาม html.f1-play-scale เหมือนหน้านี้)
    <div className={cn("f1-paper-bg flex h-dvh flex-col overflow-hidden", embedded && PORTAL_BOTTOM_GAP)}>
      <F1Header />
      {/* แถบเวลาบาง ๆ ใต้ header */}
      <div className="h-[3px] w-full shrink-0 bg-zinc-200 lg:h-1.5">
        {remaining !== null && (
          // ย่อด้วย transform (ไม่ต้องคำนวณ layout ใหม่ทุกวินาที — เบากว่าบน Pi)
          <div
            className={cn(
              "h-full w-full origin-left transition-[transform,background-color] duration-1000 ease-linear",
              lowTime && clockRunning ? "f1-timer-blink bg-f1-wrong" : "bg-f1-brand",
            )}
            style={{ transform: `scaleX(${remaining / limit})` }}
          />
        )}
      </div>

      <main className="mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col gap-3 px-3 py-3 sm:px-6 lg:gap-4 lg:px-10">
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <GameTitle name={game.name} />
            {phase === "playing" && (
              <p className="f1-font-display mt-0.5 truncate text-xs font-medium text-f1-mute sm:text-base lg:text-xl">
                ข้อ <strong className="text-f1-ink">{index + 1} / {total}</strong> • ถูก{" "}
                {/* key ตามคะแนน: เพิ่มทีไรตัวเลขเด้งที */}
                <strong key={score} className={cn("text-f1-ok-ink", score > 0 && "f1-bump")}>
                  {score}
                </strong>
              </p>
            )}
          </div>
          <RaceClock remaining={remaining} elapsed={elapsed} limit={limit} running={clockRunning} />
        </div>

        {phase === "idle" && (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="f1-font-display f1-pop-in-spring w-full max-w-lg space-y-4 rounded-2xl border-2 border-f1-line bg-white p-6 text-center shadow-md lg:max-w-3xl lg:space-y-6 lg:rounded-3xl lg:border-4 lg:p-10">
              <p className="text-xs font-medium tracking-widest text-f1-brand-ink lg:text-lg">START LINE</p>
              <p className="text-3xl font-bold text-f1-ink lg:text-5xl">พร้อมออกตัว?</p>
              <ul className="space-y-1 text-left text-base text-f1-ink-2 lg:space-y-2 lg:text-xl">
                {jigsawLimit > 0 && game.firstGame === "jigsaw" && (
                  <li>• เริ่มจากต่อจิ๊กซอ {formatTime(jigsawLimit)} ก่อน แล้วค่อยเข้าเกมตอบคำถาม</li>
                )}
                {jigsawLimit > 0 && game.firstGame === "quiz" && (
                  <li>• ตอบคำถามให้จบก่อน แล้วจะมีต่อจิ๊กซออีก {formatTime(jigsawLimit)} ปิดท้าย</li>
                )}
                <li>• คำถามทั้งหมด {playableCount} ข้อ เลือกคำตอบที่ถูกข้อละ 1 ตัว</li>
                <li>• ต้องตอบให้ถูกถึงจะไปข้อถัดไป ตอบผิดได้ตอบใหม่เรื่อย ๆ</li>
                <li>• ข้อที่มี VDO ประกอบ จะเล่นวนให้ดูตลอดโดยไม่ต้องรอ</li>
                <li>
                  {limit > 0 ? (
                    <>
                      • มีเวลา {formatTime(limit)} — ต้องตอบถูกอย่างน้อย {requiredOf(playableCount)} ข้อ ({game.passPercent}%) ก่อนหมดเวลาถึงจะผ่าน
                    </>
                  ) : (
                    <>• ตอบถูกครบทุกข้อ = ผ่าน</>
                  )}
                </li>
              </ul>
              <Button
                size="lg"
                className="f1-glow f1-press h-14 w-full bg-f1-brand text-xl font-bold text-f1-on-brand hover:bg-f1-brand-dark lg:h-20 lg:rounded-xl lg:text-3xl"
                onClick={startFlow}
              >
                <Flag className="lg:size-8" /> เริ่มเกม
              </Button>
            </div>
          </div>
        )}

        {phase === "jigsaw" && (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="f1-font-display f1-pop-in-spring w-full max-w-lg space-y-4 rounded-2xl border-2 border-f1-line bg-white p-6 text-center shadow-md lg:max-w-3xl lg:space-y-6 lg:rounded-3xl lg:border-4 lg:p-10">
              <p className="text-xs font-medium tracking-widest text-f1-brand-ink lg:text-lg">JIGSAW</p>
              <p className="text-2xl font-bold text-f1-ink lg:text-4xl">กำลังต่อจิ๊กซอ…</p>
              <p
                className={cn(
                  "f1-font-mono text-6xl font-bold tabular-nums leading-none text-f1-ink lg:text-9xl",
                  jigsawLowTime && "f1-timer-blink text-f1-wrong-bright",
                )}
              >
                {formatTime(jigsawRemaining)}
              </p>
            </div>
          </div>
        )}

        {phase === "jigsawDone" && (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="f1-font-display f1-pop-in-spring w-full max-w-lg space-y-4 rounded-2xl border-2 border-f1-line bg-white p-6 text-center shadow-md lg:max-w-3xl lg:space-y-6 lg:rounded-3xl lg:border-4 lg:p-10">
              <p className="text-3xl font-bold text-f1-wrong lg:text-5xl">หมดเวลาแล้ว</p>
              {jigsawIsSecondGame ? (
                // จิ๊กซอเป็นเกมที่สอง (ปิดท้าย) — จบกิจกรรมแล้ว ไม่มีเกมถัดไป
                embedded ? (
                  <p className="text-lg text-f1-mute lg:text-2xl">
                    {summary?.passed ? "ผ่านแล้ว — จอจะไปสถานีถัดไปเอง" : "จอจะโหลดเกมใหม่ให้ลองอีกครั้ง"}
                  </p>
                ) : (
                  <>
                    <p className="text-lg text-f1-ink-2 lg:text-2xl">จบกิจกรรมแล้ว</p>
                    <Button
                      size="lg"
                      className="f1-glow f1-press h-14 w-full bg-f1-brand text-xl font-bold text-f1-on-brand hover:bg-f1-brand-dark lg:h-20 lg:rounded-xl lg:text-3xl"
                      onClick={goHome}
                    >
                      <Home className="lg:size-8" /> กลับไปหน้าหลัก
                    </Button>
                  </>
                )
              ) : (
                <>
                  <p className="text-lg text-f1-ink-2 lg:text-2xl">เริ่มเกมถัดไปหรือไม่</p>
                  <Button
                    size="lg"
                    className="f1-glow f1-press h-14 w-full bg-f1-brand text-xl font-bold text-f1-on-brand hover:bg-f1-brand-dark lg:h-20 lg:rounded-xl lg:text-3xl"
                    onClick={startGame}
                  >
                    <Flag className="lg:size-8" /> เริ่มเกมถัดไป
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* โชว์การ์ดคำถามตอน "playing" (เล่นอยู่) และ "finished" (ให้เห็นเลือนรางหลัง modal สรุปผล) เท่านั้น
            ไม่ใช่ตอน "jigsaw"/"jigsawDone" — ไม่งั้นการ์ดข้อสุดท้ายค้างโผล่ใต้การ์ดนับถอยหลัง */}
        {(phase === "playing" || phase === "finished") && current && (
          <div className="flex min-h-0 flex-1 gap-2 sm:gap-3 lg:gap-5">
            {/* key ตามข้อ: เปลี่ยนข้อทีไรการ์ดคำถามเลื่อนเข้าแล้วเด้งใหม่ · ซ้าย = โจทย์ (วิดีโอ/รูป/ข้อความ) ขวา = ตัวเลือกเรียงแนวตั้ง */}
            <section
              key={`${roundId}:${index}`}
              className="f1-q-enter flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-f1-line bg-white p-3 shadow-sm sm:p-4 lg:gap-3 lg:rounded-3xl lg:border-2 lg:p-6"
            >
              <p className="f1-font-mono shrink-0 text-xs font-bold tracking-widest text-f1-brand-ink sm:text-base lg:text-xl">
                ข้อ {index + 1} / {total}
              </p>
              <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row lg:gap-6">
                <div className="flex min-h-0 flex-[3] flex-col">{renderPrompt(current.pair)}</div>
                <div className="flex min-h-0 flex-[2] flex-col gap-2 overflow-y-auto sm:gap-3 lg:gap-4">
                  {current.options.map(renderOption)}
                </div>
              </div>
            </section>

            {/* เส้นทางข้อ: ธงเช็กพอยต์ไล่จากบนลงล่าง 1 ธงต่อข้อ มีเลขข้อกำกับ
                (เขียว = ถูก · แดง = ผิด · ธงสีแบรนด์เรืองเหลือง = ข้อปัจจุบัน · เทา = ยังไม่ถึง) */}
            <aside
              className="relative flex w-10 shrink-0 flex-col items-center justify-between py-1 sm:w-14 sm:py-2 lg:w-20 lg:py-3"
              aria-hidden
            >
              <div className="pointer-events-none absolute inset-y-2 left-1/2 border-l-2 border-dashed border-f1-line lg:inset-y-3 lg:border-l-[3px]" />
              {rounds.map((r, i) => {
                const isCurrent = i === index && phase === "playing";
                const answered = i < results.length;
                return (
                  <div key={r.pair.id} className="relative z-10 shrink-0">
                    <span
                      className={cn(
                        // ข้อปัจจุบันใหญ่กว่า · ข้อที่เพิ่งตอบถูกเด้ง · ring สีพื้นหน้า ตัดเส้นทางด้านหลังออกรอบธง
                        "f1-dot flex items-center justify-center rounded-full ring-4 ring-f1-paper lg:ring-[6px]",
                        isCurrent ? "size-9 sm:size-11 lg:size-14" : "size-6 sm:size-7 lg:size-10",
                        answered ? (results[i] ? "bg-[#15803D]" : "bg-f1-wrong") : isCurrent ? "bg-f1-brand" : "bg-zinc-300",
                        isCurrent && "shadow-[0_0_0.75rem_rgba(245,196,0,0.8)]",
                        i === results.length - 1 && "f1-dot-pop",
                      )}
                    >
                      <Flag
                        className={cn(
                          answered || isCurrent ? "text-white" : "text-zinc-500",
                          isCurrent ? "size-4 sm:size-5 lg:size-7" : "size-3 sm:size-3.5 lg:size-5",
                        )}
                        fill="currentColor"
                      />
                    </span>
                    {/* ป้ายเลขข้อมุมขวาล่างของธง */}
                    <span className="f1-font-mono absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border border-f1-line bg-white text-[0.6rem] font-bold leading-none text-f1-ink sm:size-5 sm:text-xs lg:size-6 lg:text-sm">
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </aside>
          </div>
        )}
      </main>

      {flash && (
        <div
          key={flash.n}
          className={cn("pointer-events-none fixed inset-0 z-[55]", flash.ok ? "f1-checkered-flash" : "f1-redflag-flash")}
          aria-hidden
        />
      )}

      {/* เฉลยคำตอบที่ถูกแบบ overlay กลางจอ — โผล่พร้อมกันกับช่วงปุ่มเขียวเด้ง แล้วหายไปเองตอนเปลี่ยนข้อ */}
      {pickedCorrectOption && (
        <div key={pickedCorrectOption.id} className="pointer-events-none fixed inset-0 z-[56] flex items-center justify-center p-4">
          <div className="f1-pop-in-spring flex max-w-xs flex-col items-center gap-2 rounded-2xl border-2 border-[#15803D] bg-white px-6 py-5 text-center shadow-xl sm:max-w-sm sm:gap-3 sm:px-10 sm:py-7 lg:max-w-md lg:rounded-3xl lg:border-4 lg:px-14 lg:py-9">
            <span className="flex size-14 items-center justify-center rounded-full bg-[#15803D] text-white shadow-md sm:size-20 lg:size-24">
              <ThumbsUp className="f1-icon-pop size-8 sm:size-12 lg:size-14" strokeWidth={2.5} fill="currentColor" />
            </span>
            <p className="f1-font-display text-xl font-bold text-[#15803D] sm:text-3xl lg:text-4xl">เยี่ยมมาก! ถูกต้อง</p>
            {pickedCorrectOption.type !== "text" && pickedCorrectOption.image && (
              <img src={pickedCorrectOption.image} alt="" draggable={false} className="max-h-24 rounded-lg object-contain sm:max-h-32 lg:max-h-40" />
            )}
            {pickedCorrectOption.text && (
              <p className="line-clamp-3 text-sm font-bold leading-snug text-f1-ink sm:text-lg lg:text-xl">{pickedCorrectOption.text}</p>
            )}
          </div>
        </div>
      )}

      {retryPrompt && current && phase === "playing" && (
        <div
          className={cn(
            "f1-backdrop-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
            embedded && PORTAL_BOTTOM_GAP,
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby="retry-title"
        >
          <div className="f1-font-display f1-modal-pop w-full max-w-md rounded-xl border-4 border-f1-wrong bg-white p-6 text-center text-f1-ink lg:max-w-3xl lg:rounded-3xl lg:border-8 lg:p-10">
            <span className="f1-icon-pop mx-auto flex size-14 items-center justify-center rounded-full bg-f1-bad-bg text-f1-wrong [animation-delay:150ms] lg:size-24">
              <X className="size-8 lg:size-14" strokeWidth={3} />
            </span>
            <p id="retry-title" className="mt-3 text-3xl font-bold lg:mt-5 lg:text-5xl">
              ยังไม่ถูก ลองอีกครั้ง!
            </p>
            <p className="mt-1 text-base text-f1-mute lg:mt-3 lg:text-2xl">ต้องตอบข้อนี้ให้ถูกก่อนถึงจะไปข้อถัดไปได้</p>
            <div className="mt-5 flex justify-center lg:mt-8">
              <Button
                autoFocus
                className="f1-press h-12 bg-f1-brand text-lg text-f1-on-brand hover:bg-f1-brand-dark lg:h-16 lg:rounded-xl lg:px-8 lg:text-2xl"
                onClick={() => setRetryPrompt(false)}
              >
                <RotateCcw className="lg:size-7" /> ตอบใหม่
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* summary ไม่เคลียร์ทันทีตอนจิ๊กซอเป็นเกมที่สอง (เอาไว้ให้หน้าจิ๊กซอขึ้น pass/fail ต่อได้) — โชว์ modal/confetti นี้เฉพาะตอนยังอยู่ phase "finished" จริง ๆ */}
      {phase === "finished" && summary?.passed && <Confetti />}

      {phase === "finished" && summary && (
        <div
          className={cn(
            "f1-backdrop-fade fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4",
            embedded && PORTAL_BOTTOM_GAP,
          )}
        >
          {/* สูงไม่เกินพื้นที่ที่เหลือ (ไม่ล้นลงไปใต้ปุ่มของ portal) — ถ้าไม่พอ เลื่อนเฉพาะรายการผลรายข้อ */}
          <div className="f1-font-display f1-modal-pop relative flex max-h-full w-full max-w-lg flex-col rounded-xl border-4 border-f1-brand bg-white p-6 text-f1-ink [&>*]:shrink-0 lg:max-w-4xl lg:rounded-3xl lg:border-8 lg:p-8">
            <p className="text-center text-sm font-medium tracking-widest text-f1-brand-ink lg:text-xl">
              <Trophy className="inline size-4 align-text-bottom lg:size-7" /> RACE RESULT • สรุปผล
            </p>
            {summary.timeout && <p className="mt-1 text-center text-base font-bold text-f1-wrong lg:text-3xl">หมดเวลา!</p>}
            <p className="mt-1 text-center">
              {/* ตรา PASS/FAIL ปั๊มลงมา */}
              <span
                className={cn(
                  "f1-stamp text-6xl font-black tracking-wider lg:text-8xl",
                  summary.passed ? "text-f1-brand-ink" : "text-f1-wrong",
                )}
              >
                {summary.passed ? "PASS" : "FAIL"}
              </span>
            </p>
            <p className="f1-rise-in mt-1 text-center text-base text-f1-mute [animation-delay:450ms] lg:text-2xl">
              {summary.passed ? "ผ่านเส้นชัย! ยอดเยี่ยม" : `ต้องตอบถูกอย่างน้อย ${summary.required} ข้อถึงจะผ่าน`}
            </p>

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "f1-rise-in mt-3 flex flex-wrap items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-base lg:mt-5 lg:gap-3 lg:px-5 lg:py-3 lg:text-2xl",
                  portalStatus === "sending" && "bg-zinc-100 text-f1-ink",
                  portalStatus === "sent" && "bg-zinc-100 text-f1-ink",
                  portalStatus === "error" && "bg-f1-bad-bg text-f1-bad",
                )}
              >
                {portalStatus === "sending" && (
                  <>
                    <Loader2 className="size-4 animate-spin lg:size-7" /> กำลังส่งผลไปที่จอ…
                  </>
                )}
                {portalStatus === "sent" && (
                  <>
                    <Check className="f1-icon-pop size-4 lg:size-7" /> ส่งผลไปที่จอสำเร็จ
                  </>
                )}
                {portalStatus === "error" && (
                  <>
                    <span>ส่งผลไม่สำเร็จ: {portalMsg}</span>
                    {lastReportRef.current && (
                      <Button
                        size="sm"
                        className="f1-press bg-f1-brand text-f1-on-brand hover:bg-f1-brand-dark lg:h-14 lg:px-6 lg:text-2xl"
                        onClick={() => lastReportRef.current && report(lastReportRef.current)}
                      >
                        ส่งใหม่
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="f1-font-mono mt-4 grid grid-cols-2 gap-2 text-center lg:mt-6 lg:gap-4">
              <div className="f1-rise-in rounded-lg bg-zinc-100 p-2 [animation-delay:550ms] lg:p-4">
                <p className="text-xs text-f1-brand-ink lg:text-lg">คะแนน</p>
                <p className="text-xl font-bold lg:text-4xl">
                  ถูก {summary.score} / {summary.total}
                </p>
              </div>
              <div className="f1-rise-in rounded-lg bg-zinc-100 p-2 [animation-delay:650ms] lg:p-4">
                <p className="text-xs text-f1-brand-ink lg:text-lg">เวลาที่ใช้</p>
                <p className="text-xl font-bold lg:text-4xl">{formatTime(summary.timeUsed)}</p>
              </div>
            </div>

            <ol className="mt-4 min-h-0 space-y-1.5 overflow-y-auto pr-1 text-base lg:mt-6 lg:space-y-2 lg:text-xl" style={{ flexShrink: 1 }}>
              {rounds.map((r, i) => {
                const answered = i < results.length;
                const ok = answered && results[i];
                return (
                  <li
                    key={r.pair.id}
                    className="f1-rise-in flex items-center gap-2 rounded-lg border border-f1-line bg-zinc-50 px-2 py-1 lg:gap-3 lg:px-4 lg:py-2"
                    style={{ animationDelay: `${750 + Math.min(i, 12) * 60}ms` }}
                  >
                    {ok ? (
                      <CircleCheck className="size-5 shrink-0 text-f1-ok-ink lg:size-7" />
                    ) : (
                      <CircleX className="size-5 shrink-0 text-f1-wrong lg:size-7" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {i + 1}. {r.pair.promptText || "(ภาพ)"}
                    </span>
                    {!answered ? (
                      <span className="shrink-0 text-sm text-f1-mute lg:text-lg">ยังตอบไม่ถูก</span>
                    ) : (
                      tries[i] > 1 && <span className="shrink-0 text-sm text-f1-mute lg:text-lg">ตอบ {tries[i]} ครั้ง</span>
                    )}
                  </li>
                );
              })}
            </ol>

            {/* บนจอ Station ส่งผลแล้วจอเป็นคนไปต่อ: ผ่าน → สถานีถัดไป, ไม่ผ่าน → โหลดเกมใหม่ */}
            {resultHandedOff && (
              <p className="mt-4 text-center text-base font-medium text-f1-mute lg:mt-6 lg:text-2xl">
                {summary.passed ? "ผ่านแล้ว — จอจะไปสถานีถัดไปเอง" : "จอจะโหลดเกมใหม่ให้ลองอีกครั้ง"}
              </p>
            )}

            {/* จิ๊กซอเป็นเกมที่สอง (ปิดท้าย) → ไม่ต้องมีปุ่มตรงนี้ จะขึ้นนับถอยหลังต่อเอง (ดู finish()) */}
            {!embedded && !jigsawIsSecondGame && (
              <div className="f1-rise-in mt-5 flex justify-center [animation-delay:900ms] lg:mt-8">
                {/* ผ่าน → กลับหน้าหลัก (หน้าเริ่มเกม) · ไม่ผ่าน → เล่นใหม่ทันที */}
                {summary.passed ? (
                  <Button className="f1-press h-12 bg-f1-brand px-6 text-lg text-f1-on-brand hover:bg-f1-brand-dark lg:h-16 lg:rounded-xl lg:px-10 lg:text-2xl" onClick={goHome}>
                    <Home className="lg:size-7" /> กลับไปหน้าหลัก
                  </Button>
                ) : (
                  <Button className="f1-press h-12 bg-f1-brand px-6 text-lg text-f1-on-brand hover:bg-f1-brand-dark lg:h-16 lg:rounded-xl lg:px-10 lg:text-2xl" onClick={startGame}>
                    <RotateCcw className="lg:size-7" /> เล่นใหม่
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
