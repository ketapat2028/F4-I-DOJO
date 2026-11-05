import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { AnswerOption, MatchPair, PromptType, Theme } from "../types/theme";
import { fileToUploadableImage } from "../utils/image";
import {
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
  UnauthorizedError,
  uploadImage,
  uploadVideo,
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

// ลบตัวเลือกที่ถูกไปแล้วต้องไม่เหลือข้อที่ไม่มีคำตอบถูก — ให้ตัวแรกเป็นตัวถูกแทน
function keepOneCorrect(answers: AnswerOption[]): AnswerOption[] {
  return answers.some((a) => a.correct) ? answers : answers.map((a, i) => ({ ...a, correct: i === 0 }));
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
              type === t ? "border-[#DC0000] bg-[#DC0000] text-white" : "border-f1-line bg-white text-zinc-700"
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
              className="f1-font-display bg-[#DC0000] text-white hover:bg-[#b00000]"
              onClick={() => fileRef.current?.click()}
            >
              📁 เลือกรูปจากเครื่อง
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
                className="text-[#DC0000] hover:bg-[#DC0000]/10 hover:text-[#B00000]"
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

interface VideoFieldProps {
  video?: string;
  onVideo: (v: string | undefined) => void;
  // throw Error = แสดงข้อความตรงกล่อง VDO · คืน undefined = ไม่ต้องทำอะไร (เช่น ต้องใส่รหัสใหม่)
  onUpload: (file: File, onProgress: (pct: number) => void) => Promise<string | undefined>;
}

function VideoField({ video, onVideo, onUpload }: VideoFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // error แสดงตรงกล่อง VDO เลย (status ด้านล่างสุดของหน้าอยู่ไกลและหายเร็ว ผู้ดูแลมักไม่เห็น)
  const [error, setError] = useState<string | null>(null);
  async function handleUpload(file: File | null) {
    if (!file) return;
    setProgress(0);
    setError(null);
    try {
      const url = await onUpload(file, setProgress);
      if (url) onVideo(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลด VDO ไม่สำเร็จ");
    } finally {
      setProgress(null);
    }
  }
  return (
    <div className="space-y-2 rounded-sm border border-f1-line bg-zinc-50 p-3 text-sm text-zinc-700">
      <p className="f1-font-display text-sm font-bold text-f1-ink">🎬 VDO ของข้อนี้</p>
      <p className="text-xs text-f1-mute">
        ผู้เล่นต้องดูจนจบ (ข้ามไม่ได้) ก่อนจะเห็นตัวเลือกคำตอบ · รองรับ .mp4 .webm (แนะนำ mp4 H.264) · ถ้าไม่ใส่ VDO จะแสดงตัวเลือกทันที
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {video && <video src={video} controls preload="metadata" className="h-24 rounded-sm border-2 border-f1-line bg-black" />}
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/ogg,.mp4,.m4v,.webm,.ogv"
          className="hidden"
          disabled={progress !== null}
          onChange={(e) => {
            handleUpload(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={progress !== null}
          className="f1-font-display bg-[#DC0000] text-white hover:bg-[#b00000]"
          onClick={() => fileRef.current?.click()}
        >
          🎞️ {video ? "เปลี่ยน VDO" : "เลือก VDO จากเครื่อง"}
        </Button>
        <span className="text-xs text-f1-mute">
          {progress !== null ? `กำลังอัปโหลด ${progress}%${progress >= 100 ? " (รอ server บันทึก…)" : ""}` : video ? "มี VDO แล้ว" : "ยังไม่มี VDO"}
        </span>
        {error && <p className="w-full text-sm font-bold text-f1-bad">⚠️ {error}</p>}
        {video && progress === null && (
          <Button
            variant="ghost"
            size="sm"
            className="text-[#DC0000] hover:bg-[#DC0000]/10 hover:text-[#B00000]"
            onClick={() => onVideo(undefined)}
          >
            ลบ VDO
          </Button>
        )}
      </div>
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
    try {
      return await uploadImage(await fileToUploadableImage(file), secret);
    } catch (e) {
      if (e instanceof UnauthorizedError) forgetSecret("รหัสผู้ดูแลหมดอายุหรือไม่ถูกต้อง ใส่ใหม่อีกครั้ง");
      else setStatus(errorText(e, "อัปโหลดรูปไม่สำเร็จ"));
      return undefined;
    }
  }

  async function handleUploadVideo(file: File, onProgress: (pct: number) => void): Promise<string | undefined> {
    try {
      return await uploadVideo(file, secret, onProgress);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        forgetSecret("รหัสผู้ดูแลหมดอายุหรือไม่ถูกต้อง ใส่ใหม่อีกครั้ง");
        return undefined;
      }
      // 404 = backend ยังรันโค้ดเก่า (ไม่มี route อัปโหลด VDO) ต้อง restart
      if (e instanceof Error && /\(404\)/.test(e.message)) {
        throw new Error("server ไม่รู้จักการอัปโหลด VDO (404) — ต้อง restart backend ให้ใช้โค้ดล่าสุดก่อน");
      }
      throw e;
    }
  }

  if (!secret) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="mx-auto max-w-md space-y-3 p-6">
          <h1 className="f1-font-display text-2xl font-bold text-f1-ink">🔒 EDIT MODE</h1>
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
                className="f1-font-display bg-[#DC0000] text-white hover:bg-[#b00000]"
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

  // ติ๊กตัวเลือกที่ถูก — ถูกได้ตัวเดียว
  function setCorrectAnswer(pairId: string, answerId: string) {
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
                ? { ...p, answers: keepOneCorrect(p.answers.filter((a) => a.id !== answerId)) }
                : p,
            ),
          }
        : prev,
    );
  }

  async function handleSave() {
    if (!game) return;
    const badIndex = game.pairs.findIndex((p) => !isPairComplete(p));
    if (badIndex !== -1) {
      setStatus(
        `ข้อที่ ${badIndex + 1} ยังไม่ครบ: ต้องมีคำถาม และตัวเลือกอย่างน้อย 2 ตัวที่กรอกครบ (ประเภทข้อความต้องมีข้อความ, ประเภทรูปภาพต้องมีรูป, ประเภทผสมต้องมีทั้งสองอย่าง) และเลือกตัวที่ถูก 1 ตัว`,
      );
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
        <h1 className="f1-font-display text-2xl font-bold text-f1-ink">🛠️ EDIT MODE • แก้ไขโจทย์</h1>
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
            <span>จำกัดเวลารวมทั้งเกม (วินาที, 0 = ไม่จำกัด · ไม่นับเวลาดู VDO)</span>
            <Input
              type="number"
              min={0}
              value={game.timeLimitSeconds}
              onChange={(e) =>
                setGame({ ...game, timeLimitSeconds: Math.max(0, Number(e.target.value) || 0) })
              }
              className="border-[#8B8B95] bg-white text-f1-ink"
            />
            {game.timeLimitSeconds <= 0 && (
              <span className="block text-xs text-f1-mute">
                ไม่จำกัดเวลาใช้ได้เฉพาะเปิดเกมตรง ๆ — บนจอ Station จะจำกัด 5 นาทีแทน
              </span>
            )}
          </label>
        </div>

        <h2 className="f1-font-display text-sm font-bold text-f1-ink">คำถามแต่ละข้อ (เล่นเรียงตามลำดับ)</h2>

        {game.pairs.map((pair, idx) => (
          <div key={pair.id} className="space-y-3 rounded-sm border-2 border-f1-line bg-white/90 p-4">
            <div className="flex items-center justify-between">
              <span className="f1-font-display text-f1-ink">ข้อที่ {idx + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-[#DC0000] hover:bg-[#DC0000]/10 hover:text-[#B00000]"
                disabled={game.pairs.length <= MIN_PAIRS}
                onClick={() => removePair(pair.id)}
              >
                ลบข้อนี้
              </Button>
            </div>

            <VideoField
              video={pair.video}
              onVideo={(v) => updatePair(pair.id, { video: v })}
              onUpload={handleUploadVideo}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <SideFields
                title="📝 คำถาม"
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
                    <div className="flex items-center justify-between">
                      <label className="f1-font-mono flex cursor-pointer items-center gap-2 text-xs text-f1-mute">
                        <input
                          type="radio"
                          name={`correct-${pair.id}`}
                          checked={Boolean(answer.correct)}
                          onChange={() => setCorrectAnswer(pair.id, answer.id)}
                          className="accent-[#15803D]"
                        />
                        ตัวเลือกที่ {aIdx + 1}
                        {answer.correct && <strong className="text-[#15803D]">✓ คำตอบที่ถูก</strong>}
                      </label>
                      {pair.answers.length > MIN_ANSWERS && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-[#DC0000] hover:bg-[#DC0000]/10 hover:text-[#B00000]"
                          onClick={() => removeAnswer(pair.id, answer.id)}
                        >
                          ลบตัวเลือกนี้
                        </Button>
                      )}
                    </div>
                    <SideFields
                      title={`✅ ตัวเลือก #${aIdx + 1}`}
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
                  className="border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
                  onClick={() => addAnswer(pair.id)}
                >
                  + เพิ่มตัวเลือก
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          className="border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
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
            className="f1-font-display bg-[#DC0000] text-white hover:bg-[#b00000]"
            onClick={handleSave}
          >
            อัปโหลดแล้วไปเล่น
          </Button>
        </div>
      </main>
    </div>
  );
}
