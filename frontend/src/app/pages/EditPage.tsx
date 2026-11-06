import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Film, FolderOpen, Lock, TriangleAlert, Wrench } from "lucide-react";
import { useNavigate } from "react-router";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { AnswerOption, MatchPair, PromptType, Theme } from "../types/theme";
import { fileToUploadableImage } from "../utils/image";
import {
  checkImageFile,
  exportGameJson,
  getGame,
  isPairComplete,
  makeDemoGame,
  makeEmptyAnswer,
  makeEmptyPair,
  NoGameError,
  parseImportedPairs,
  readLegacyLocalGame,
  saveGame,
  sideComplete,
  UnauthorizedError,
  uploadImage,
  uploadVideo,
  VIDEO_EXTS,
  VIDEO_MAX_MB,
  verifyAdmin,
} from "../utils/gameStore";

const MIN_PAIRS = 2;
const MIN_ANSWERS = 2;
// รหัสผู้ดูแลเก็บไว้แค่ใน tab นี้ ปิด tab แล้วต้องใส่ใหม่
const SECRET_KEY = "idojo.adminSecret";

function readSecret(): string {
  try {
    return sessionStorage.getItem(SECRET_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSecret(value: string) {
  try {
    if (value) sessionStorage.setItem(SECRET_KEY, value);
    else sessionStorage.removeItem(SECRET_KEY);
  } catch {
    // ไม่มี sessionStorage ก็ใช้แค่ใน state
  }
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
const TYPE_LABEL: Record<PromptType, string> = { text: "ข้อความ", image: "รูปภาพ", mixed: "ผสม (ภาพ + ข้อความ)" };

interface SideFieldsProps {
  title: string;
  type: PromptType;
  text: string;
  image?: string;
  onType: (t: PromptType) => void;
  onText: (v: string) => void;
  onImage: (v: string | undefined) => void;
  onUpload: (file: File) => Promise<string | undefined>;
}

function SideFields({ title, type, text, image, onType, onText, onImage, onUpload }: SideFieldsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  async function handleUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    const url = await onUpload(file);
    setUploading(false);
    if (url) onImage(url);
  }
  const needsImage = type === "image" || type === "mixed";
  return (
    <div className="space-y-3 rounded-sm border border-f1-line bg-zinc-50 p-3">
      <p className="f1-font-display text-sm font-bold text-f1-ink">{title}</p>
      <div className="flex flex-wrap gap-2">
        {(["text", "image", "mixed"] as PromptType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onType(t)}
            className={`f1-font-display rounded-sm border px-3 py-1 text-xs font-medium ${
              type === t ? "border-f1-brand bg-f1-brand text-f1-ink" : "border-f1-line bg-white text-zinc-700"
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="block space-y-1 text-sm text-zinc-700">
        <span>{type === "image" ? "ข้อความกำกับภาพ (ไม่บังคับ แต่ใช้แสดงในรายการข้อผิด)" : "ข้อความ"}</span>
        <Input value={text} onChange={(e) => onText(e.target.value)} className="border-[#8B8B95] bg-white text-f1-ink" />
      </label>
      {needsImage && (
        <div className="space-y-2 text-sm text-zinc-700">
          <span>รูปภาพ (ใส่ลิงก์หรืออัปโหลด)</span>
          <div className="flex flex-wrap items-center gap-3">
            {image && (
              <img src={image} alt="" className="h-16 w-24 rounded-sm border-2 border-f1-line bg-zinc-100 object-contain" />
            )}
            <Input
              value={image && !image.startsWith("data:") ? image : ""}
              onChange={(e) => onImage(e.target.value || undefined)}
              placeholder={image?.startsWith("data:") ? "(ใช้รูปที่อัปโหลดอยู่)" : "วางลิงก์รูป https://..."}
              className="w-60 border-[#8B8B95] bg-white text-f1-ink"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setFileName(file ? file.name : null);
                handleUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={uploading}
              className="f1-font-display bg-f1-brand text-f1-ink hover:bg-f1-brand-dark"
              onClick={() => fileRef.current?.click()}
            >
              <FolderOpen /> เลือกรูปจากเครื่อง
            </Button>
            <span className="max-w-48 truncate text-xs text-f1-mute" title={fileName ?? undefined}>
              {uploading
                ? "กำลังอัปโหลด..."
                : fileName ?? (image ? "มีรูปอยู่แล้ว" : "ยังไม่ได้เลือกไฟล์")}
            </span>
            {image && (
              <Button
                variant="ghost"
                size="sm"
                className="text-f1-brand-ink hover:bg-f1-brand/10 hover:text-f1-brand-ink"
                onClick={() => {
                  setFileName(null);
                  onImage(undefined);
                }}
              >
                ลบรูป
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// เหตุผลที่ข้อนี้ยังไม่สมบูรณ์ (ว่าง = เล่นได้) — กติกาเดียวกับ isPairComplete
function pairProblems(p: MatchPair): string[] {
  const out: string[] = [];
  if (!sideComplete(p.promptType, p.promptText, p.promptImage)) out.push("คำถามยังไม่ครบตามรูปแบบที่เลือก");
  if (p.answers.length < MIN_ANSWERS) out.push(`ต้องมีตัวเลือกอย่างน้อย ${MIN_ANSWERS} ตัว`);
  const bad = p.answers.flatMap((a, i) => (sideComplete(a.type, a.text, a.image) ? [] : [i + 1]));
  if (bad.length > 0) out.push(`ตัวเลือกที่ ${bad.join(", ")} ยังไม่ครบตามรูปแบบที่เลือก`);
  const correct = p.answers.filter((a) => a.correct).length;
  if (correct !== 1) out.push(correct === 0 ? "ยังไม่ได้เลือกตัวที่ถูก" : "เลือกตัวที่ถูกได้ตัวเดียว");
  return out;
}

interface VideoFieldProps {
  video?: string;
  onVideo: (v: string | undefined) => void;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string | undefined>;
}

function VideoField({ video, onVideo, onUpload }: VideoFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  async function handleFile(file: File | null) {
    if (!file) return;
    setPercent(0);
    const url = await onUpload(file, setPercent);
    setPercent(null);
    if (url) onVideo(url);
  }
  return (
    <div className="space-y-2 rounded-sm border border-f1-line bg-zinc-50 p-3 text-sm text-zinc-700">
      <p className="f1-font-display flex items-center gap-1.5 font-bold text-f1-ink">
        <Film className="size-4 text-f1-brand-ink" /> VDO ของข้อนี้ (ไม่บังคับ — เล่นจบก่อนถึงจะแสดงตัวเลือก ผู้เล่นข้ามไม่ได้)
      </p>
      {video && <video src={video} controls preload="metadata" className="max-h-48 w-full rounded-sm bg-black" />}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={video ?? ""}
          onChange={(e) => onVideo(e.target.value || undefined)}
          placeholder="วางลิงก์ VDO หรืออัปโหลด"
          className="w-72 border-[#8B8B95] bg-white text-f1-ink"
        />
        <input
          ref={fileRef}
          type="file"
          accept={VIDEO_EXTS.join(",")}
          className="hidden"
          disabled={percent !== null}
          onChange={(e) => {
            handleFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={percent !== null}
          className="f1-font-display bg-f1-brand text-f1-ink hover:bg-f1-brand-dark"
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen /> เลือก VDO จากเครื่อง
        </Button>
        {video && percent === null && (
          <Button
            variant="ghost"
            size="sm"
            className="text-f1-brand-ink hover:bg-f1-brand/10 hover:text-f1-brand-ink"
            onClick={() => onVideo(undefined)}
          >
            ลบ VDO
          </Button>
        )}
      </div>
      {percent !== null ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-f1-brand transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="f1-font-mono text-xs text-f1-mute">กำลังอัปโหลด {percent}%</p>
        </div>
      ) : (
        <p className="text-xs text-f1-mute">
          {VIDEO_EXTS.join(" ")} ไม่เกิน {VIDEO_MAX_MB}MB
        </p>
      )}
    </div>
  );
}

export function EditPage() {
  const navigate = useNavigate();
  const [secret, setSecret] = useState<string>(readSecret);
  const [secretInput, setSecretInput] = useState("");
  const [checkingSecret, setCheckingSecret] = useState(false);
  const [game, setGame] = useState<Theme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!secret || game) return;
    getGame()
      .then(setGame)
      .catch((e) => {
        if (!(e instanceof NoGameError)) {
          setLoadError(errorText(e, "โหลดชุดคำถามไม่ได้"));
          return;
        }
        const legacy = readLegacyLocalGame();
        if (legacy) {
          setGame(legacy);
          setNotice("server ยังไม่มีชุดคำถาม — นำข้อมูลเดิมจากเครื่องนี้มาให้ กดอัปโหลดเพื่อขึ้น server");
        } else {
          setGame(makeDemoGame());
          setNotice("server ยังไม่มีชุดคำถาม — เริ่มจากชุดตัวอย่าง F1 แก้แล้วกดอัปโหลด");
        }
      });
  }, [secret, game]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status]);

  function forgetSecret(message: string) {
    writeSecret("");
    setSecret("");
    setStatus(null);
    setLoadError(message);
  }

  async function handleSubmitSecret() {
    const value = secretInput.trim();
    if (!value) return;
    setCheckingSecret(true);
    try {
      if (await verifyAdmin(value)) {
        writeSecret(value);
        setSecret(value);
        setSecretInput("");
        setLoadError(null);
      } else {
        setLoadError("รหัสผู้ดูแลไม่ถูกต้อง");
      }
    } catch (e) {
      setLoadError(errorText(e, "ตรวจรหัสไม่สำเร็จ"));
    } finally {
      setCheckingSecret(false);
    }
  }

  async function handleUploadImage(file: File): Promise<string | undefined> {
    const invalid = checkImageFile(file);
    if (invalid) {
      setStatus(invalid);
      return undefined;
    }
    try {
      return await uploadImage(await fileToUploadableImage(file), secret);
    } catch (e) {
      if (e instanceof UnauthorizedError) forgetSecret("รหัสผู้ดูแลหมดอายุหรือไม่ถูกต้อง ใส่ใหม่อีกครั้ง");
      else setStatus(errorText(e, "อัปโหลดรูปไม่สำเร็จ"));
      return undefined;
    }
  }

  async function handleUploadVideo(file: File, onProgress: (percent: number) => void): Promise<string | undefined> {
    try {
      return await uploadVideo(file, secret, onProgress);
    } catch (e) {
      if (e instanceof UnauthorizedError) forgetSecret("รหัสผู้ดูแลหมดอายุหรือไม่ถูกต้อง ใส่ใหม่อีกครั้ง");
      else setStatus(errorText(e, "อัปโหลด VDO ไม่สำเร็จ"));
      return undefined;
    }
  }

  if (!secret) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="mx-auto max-w-md space-y-3 p-6">
          <h1 className="f1-font-display flex items-center gap-2 text-2xl font-bold text-f1-ink">
            <Lock className="size-6 text-f1-brand-ink" /> EDIT MODE
          </h1>
          <form
            className="space-y-3 rounded-sm border-2 border-f1-line bg-white/90 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitSecret();
            }}
          >
            <label className="block space-y-1 text-sm text-zinc-700">
              <span>รหัสผู้ดูแล</span>
              <Input
                type="password"
                autoFocus
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                className="border-[#8B8B95] bg-white text-f1-ink"
              />
            </label>
            {loadError && <p className="text-sm text-f1-bad">{loadError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="border-f1-line text-f1-ink" onClick={() => navigate("/")}>
                กลับไปเล่น
              </Button>
              <Button
                type="submit"
                disabled={checkingSecret || !secretInput.trim()}
                className="f1-font-display bg-f1-brand text-f1-ink hover:bg-f1-brand-dark"
              >
                {checkingSecret ? "กำลังตรวจ..." : "เข้าสู่ EDIT MODE"}
              </Button>
            </div>
          </form>
        </main>
      </div>
    );
  }


  if (!game) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="mx-auto max-w-3xl p-6 text-zinc-700">{loadError ?? "กำลังโหลด..."}</main>
      </div>
    );
  }

  function updatePair(pairId: string, patch: Partial<MatchPair>) {
    setGame((prev) =>
      prev
        ? { ...prev, pairs: prev.pairs.map((p) => (p.id === pairId ? { ...p, ...patch } : p)) }
        : prev,
    );
  }

  function addPair() {
    setGame((prev) => (prev ? { ...prev, pairs: [...prev.pairs, makeEmptyPair()] } : prev));
  }

  function removePair(pairId: string) {
    setGame((prev) =>
      prev && prev.pairs.length > MIN_PAIRS
        ? { ...prev, pairs: prev.pairs.filter((p) => p.id !== pairId) }
        : prev,
    );
  }

  function movePair(pairId: string, delta: -1 | 1) {
    setGame((prev) => {
      if (!prev) return prev;
      const from = prev.pairs.findIndex((p) => p.id === pairId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.pairs.length) return prev;
      const pairs = [...prev.pairs];
      [pairs[from], pairs[to]] = [pairs[to], pairs[from]];
      return { ...prev, pairs };
    });
  }

  // ตัวที่ถูกเลือกได้ตัวเดียว — เลือกตัวใหม่ = ตัวอื่นกลายเป็นไม่ถูก
  function setCorrect(pairId: string, answerId: string) {
    setGame((prev) =>
      prev
        ? {
            ...prev,
            pairs: prev.pairs.map((p) =>
              p.id === pairId ? { ...p, answers: p.answers.map((a) => ({ ...a, correct: a.id === answerId })) } : p,
            ),
          }
        : prev,
    );
  }

  function updateAnswer(pairId: string, answerId: string, patch: Partial<AnswerOption>) {
    setGame((prev) =>
      prev
        ? {
            ...prev,
            pairs: prev.pairs.map((p) =>
              p.id === pairId
                ? { ...p, answers: p.answers.map((a) => (a.id === answerId ? { ...a, ...patch } : a)) }
                : p,
            ),
          }
        : prev,
    );
  }

  function addAnswer(pairId: string) {
    setGame((prev) =>
      prev
        ? {
            ...prev,
            pairs: prev.pairs.map((p) =>
              p.id === pairId ? { ...p, answers: [...p.answers, makeEmptyAnswer()] } : p,
            ),
          }
        : prev,
    );
  }

  function removeAnswer(pairId: string, answerId: string) {
    setGame((prev) =>
      prev
        ? {
            ...prev,
            pairs: prev.pairs.map((p) =>
              p.id === pairId && p.answers.length > MIN_ANSWERS
                ? {
                    ...p,
                    answers: (() => {
                      const removed = p.answers.find((a) => a.id === answerId);
                      const rest = p.answers.filter((a) => a.id !== answerId);
                      // ลบตัวที่ถูกทิ้ง → ให้ตัวแรกที่เหลือเป็นตัวถูกแทน (แก้ได้ทีหลัง)
                      return removed?.correct ? rest.map((a, i) => ({ ...a, correct: i === 0 })) : rest;
                    })(),
                  }
                : p,
            ),
          }
        : prev,
    );
  }

  async function handleSave() {
    if (!game) return;
    // ข้อที่ไม่สมบูรณ์บันทึกได้ (หน้าเล่นข้ามให้) แต่ต้องมีข้อที่เล่นได้อย่างน้อย 2 ข้อ
    if (game.pairs.filter(isPairComplete).length < MIN_PAIRS) {
      setStatus(`ต้องมีข้อที่สมบูรณ์อย่างน้อย ${MIN_PAIRS} ข้อถึงจะบันทึกได้ — ดูคำเตือนสีแดงในแต่ละข้อ`);
      return;
    }
    setSaving(true);
    try {
      await saveGame(game, secret);
      navigate("/");
    } catch (e) {
      setStatus(errorText(e, "อัปโหลดไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyJson() {
    if (!game) return;
    await navigator.clipboard.writeText(exportGameJson(game));
    setStatus("คัดลอก JSON แล้ว");
  }

  function handleDownloadJson() {
    if (!game) return;
    const blob = new Blob([exportGameJson(game)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "f1-dojo-pairs.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File | null) {
    if (!file || !game) return;
    try {
      const pairs = parseImportedPairs(await file.text());
      setGame({ ...game, pairs });
      setStatus(`นำเข้า ${pairs.length} ข้อแล้ว`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "นำเข้าไฟล์ไม่สำเร็จ");
    }
  }

  return (
    <div className="f1-paper-bg min-h-screen pb-16">
      <F1Header />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <h1 className="f1-font-display flex items-center gap-2 text-2xl font-bold text-f1-ink">
          <Wrench className="size-6 text-f1-brand-ink" /> EDIT MODE • แก้ไขโจทย์
        </h1>
        {notice && (
          <p className="rounded-sm border border-f1-line bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{notice}</p>
        )}

        <div className="grid gap-3 rounded-sm border-2 border-f1-line bg-white/90 p-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-zinc-700">
            <span>ชื่อเกม</span>
            <Input
              value={game.name}
              onChange={(e) => setGame({ ...game, name: e.target.value })}
              className="border-[#8B8B95] bg-white text-f1-ink"
            />
          </label>
          <label className="space-y-1 text-sm text-zinc-700">
            <span>จำกัดเวลา (วินาที, 0 = ไม่จำกัด)</span>
            <Input
              type="number"
              min={0}
              value={game.timeLimitSeconds}
              onChange={(e) =>
                setGame({ ...game, timeLimitSeconds: Math.max(0, Number(e.target.value) || 0) })
              }
              className="border-[#8B8B95] bg-white text-f1-ink"
            />
            <span className="block text-xs text-f1-mute">เวลารวมทั้งเกม · หยุดเดินระหว่างเล่น VDO</span>
          </label>
          <label className="space-y-1 text-sm text-zinc-700">
            <span>เกณฑ์ผ่าน (% ของจำนวนข้อ ปัดขึ้น)</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={game.passPercent}
              onChange={(e) =>
                setGame({ ...game, passPercent: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))) })
              }
              className="border-[#8B8B95] bg-white text-f1-ink"
            />
            <span className="block text-xs text-f1-mute">
              ตอนนี้ต้องตอบถูกอย่างน้อย{" "}
              {Math.ceil((game.pairs.filter(isPairComplete).length * game.passPercent) / 100)} จาก{" "}
              {game.pairs.filter(isPairComplete).length} ข้อ
            </span>
          </label>
        </div>

        <h2 className="f1-font-display text-sm font-bold text-f1-ink">
          คำถาม ({game.pairs.filter(isPairComplete).length}/{game.pairs.length} ข้อพร้อมเล่น)
        </h2>

        {game.pairs.map((pair, idx) => {
          const problems = pairProblems(pair);
          return (
          <div
            key={pair.id}
            className={`space-y-3 rounded-sm border-2 bg-white/90 p-4 ${problems.length > 0 ? "border-f1-wrong" : "border-f1-line"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="f1-font-display text-f1-ink">ข้อที่ {idx + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="เลื่อนขึ้น"
                  className="text-f1-brand-ink hover:bg-f1-brand/10"
                  disabled={idx === 0}
                  onClick={() => movePair(pair.id, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="เลื่อนลง"
                  className="text-f1-brand-ink hover:bg-f1-brand/10"
                  disabled={idx === game.pairs.length - 1}
                  onClick={() => movePair(pair.id, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-f1-brand-ink hover:bg-f1-brand/10 hover:text-f1-brand-ink"
                  disabled={game.pairs.length <= MIN_PAIRS}
                  onClick={() => removePair(pair.id)}
                >
                  ลบข้อนี้
                </Button>
              </div>
            </div>

            {problems.length > 0 && (
              <div className="rounded-sm border border-red-200 bg-f1-bad-bg px-3 py-2 text-sm text-f1-bad">
                <p className="flex items-center gap-1.5 font-bold">
                  <TriangleAlert className="size-4" /> ข้อนี้ยังไม่สมบูรณ์ — จะไม่ถูกนำไปเล่น
                </p>
                <ul className="ml-6 list-disc">
                  {problems.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {!pair.video && (
              <p className="flex items-center gap-1.5 rounded-sm border border-f1-line bg-zinc-50 px-3 py-1.5 text-xs text-f1-mute">
                <TriangleAlert className="size-3.5" /> ข้อนี้ยังไม่มี VDO (ไม่บังคับ)
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <SideFields
                title="คำถาม"
                type={pair.promptType}
                text={pair.promptText}
                image={pair.promptImage}
                onType={(t) => updatePair(pair.id, { promptType: t })}
                onText={(v) => updatePair(pair.id, { promptText: v })}
                onImage={(v) => updatePair(pair.id, { promptImage: v })}
                onUpload={handleUploadImage}
              />
              <div className="space-y-2">
                {pair.answers.map((answer, aIdx) => (
                  <div key={answer.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="radio"
                          name={`correct-${pair.id}`}
                          checked={Boolean(answer.correct)}
                          onChange={() => setCorrect(pair.id, answer.id)}
                          className="size-4 accent-[#15803D]"
                        />
                        <span className={answer.correct ? "font-bold text-f1-ok-ink" : "text-f1-mute"}>
                          {answer.correct ? "ตัวที่ถูก" : "ตั้งเป็นตัวที่ถูก"}
                        </span>
                      </label>
                      {pair.answers.length > MIN_ANSWERS && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-f1-brand-ink hover:bg-f1-brand/10 hover:text-f1-brand-ink"
                          onClick={() => removeAnswer(pair.id, answer.id)}
                        >
                          ลบตัวเลือกนี้
                        </Button>
                      )}
                    </div>
                    <SideFields
                      title={`ตัวเลือกที่ ${aIdx + 1}`}
                      type={answer.type}
                      text={answer.text}
                      image={answer.image}
                      onType={(t) => updateAnswer(pair.id, answer.id, { type: t })}
                      onText={(v) => updateAnswer(pair.id, answer.id, { text: v })}
                      onImage={(v) => updateAnswer(pair.id, answer.id, { image: v })}
                      onUpload={handleUploadImage}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-f1-brand bg-white text-f1-brand-ink hover:bg-f1-brand/10"
                  onClick={() => addAnswer(pair.id)}
                >
                  + เพิ่มตัวเลือก
                </Button>
              </div>
            </div>

            <VideoField
              video={pair.video}
              onVideo={(v) => updatePair(pair.id, { video: v })}
              onUpload={handleUploadVideo}
            />
          </div>
          );
        })}

        <Button
          variant="outline"
          className="border-f1-brand bg-white text-f1-brand-ink hover:bg-f1-brand/10"
          onClick={addPair}
        >
          + เพิ่มข้อ
        </Button>

        <div className="space-y-3 rounded-sm border-2 border-f1-line bg-white/90 p-4">
          <h2 className="f1-font-display text-sm font-bold text-f1-ink">Import / Export JSON</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="border-f1-line text-f1-ink" onClick={handleCopyJson}>
              คัดลอก
            </Button>
            <Button variant="outline" size="sm" className="border-f1-line text-f1-ink" onClick={handleDownloadJson}>
              ดาวน์โหลดไฟล์
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-f1-line text-f1-ink"
              onClick={() => importFileRef.current?.click()}
            >
              อัปโหลดไฟล์
            </Button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {status && <p className="text-sm text-zinc-700">{status}</p>}

        <div className="flex justify-end gap-2 border-t-2 border-f1-line pt-4">
          <Button variant="outline" className="border-f1-line text-f1-ink" onClick={() => navigate("/")}>
            ยกเลิก
          </Button>
          <Button
            disabled={saving}
            className="f1-font-display bg-f1-brand text-f1-ink hover:bg-f1-brand-dark"
            onClick={handleSave}
          >
            อัปโหลดแล้วไปเล่น
          </Button>
        </div>
      </main>
    </div>
  );
}
