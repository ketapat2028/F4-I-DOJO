import { useEffect, useRef, useState } from "react";
import { CircleCheck, Download, FileVideo, Loader2, TriangleAlert, Upload, X } from "lucide-react";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import { inspectVideo } from "../utils/videoCheck";
import { canConvertVideo, ConvertCanceled, convertForPi, convertUnavailableReason, formatMB, type ConvertResult } from "../utils/videoConvert";

// หน้าแปลง VDO ให้เล่นลื่นบนจอ Station (Pi 4) — ใช้กับ VDO ของ portal ได้ด้วย · ทำในเครื่องนี้ล้วน ไม่อัปโหลดไปไหน
// ลากไฟล์มาวาง → ตรวจ → ไฟล์ที่มีปัญหาแปลงให้ทีละไฟล์ตามคิว → กดดาวน์โหลด <ชื่อ>_pi.mp4

type ItemState = "checking" | "good" | "queued" | "converting" | "done" | "error";
type Item = {
  id: number;
  file: File;
  state: ItemState;
  warnings: string[];
  percent: number;
  result?: ConvertResult;
  url?: string;
  error?: string;
};

let nextId = 1;

export function ConvertPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const supported = canConvertVideo();

  const patch = (id: number, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  // คืน object URL ของไฟล์ที่แปลงแล้วตอนออกจากหน้า
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((it) => it.url && URL.revokeObjectURL(it.url)), []);

  // แปลงทีละไฟล์ (พร้อมกันหลายไฟล์จะแย่งการ์ดจอ ช้ากว่าเดิม)
  useEffect(() => {
    if (busyRef.current) return;
    const next = items.find((it) => it.state === "queued");
    if (!next) return;
    busyRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    patch(next.id, { state: "converting", percent: 0 });
    convertForPi(next.file, { onProgress: (percent) => patch(next.id, { percent }), signal: ctrl.signal })
      .then((result) => patch(next.id, { state: "done", result, url: URL.createObjectURL(result.file) }))
      .catch((e) =>
        patch(next.id, {
          state: "error",
          error: e instanceof ConvertCanceled ? "ยกเลิกแล้ว" : e instanceof Error ? e.message : "แปลงไม่สำเร็จ",
        }),
      )
      .finally(() => {
        busyRef.current = false;
        abortRef.current = null;
        setItems((prev) => [...prev]); // ปลุกให้หยิบไฟล์ถัดไป
      });
  }, [items]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Item[] = [...list].map((file) => ({ id: nextId++, file, state: "checking", warnings: [], percent: 0 }));
    setItems((prev) => [...prev, ...added]);
    for (const it of added) {
      const warnings = await inspectVideo(it.file).catch(() => [] as string[]);
      // ไฟล์ดีอยู่แล้วไม่แปลงเอง (กดแปลงเองได้) · มีปัญหา + แปลงได้ → เข้าคิว
      patch(it.id, { warnings, state: warnings.length === 0 ? "good" : supported ? "queued" : "error", error: supported ? undefined : convertUnavailableReason() });
    }
  }

  function remove(it: Item) {
    if (it.state === "converting") abortRef.current?.abort();
    if (it.url) URL.revokeObjectURL(it.url);
    setItems((prev) => prev.filter((x) => x.id !== it.id));
  }

  return (
    <div className="f1-paper-bg min-h-screen">
      <F1Header />
      <main className="f1-font-display mx-auto max-w-4xl space-y-4 p-4 text-f1-ink sm:p-6">
        <div>
          <h1 className="text-2xl font-bold">แปลง VDO ให้เล่นลื่นบนจอ Station</h1>
          <p className="mt-1 text-sm text-f1-ink-2">
            จอ Station เป็น Raspberry Pi 4 เล่นลื่นเฉพาะ MP4 H.264 ไม่เกิน 1080p — หน้านี้แปลงให้ในเครื่องนี้ (ไม่อัปโหลดไปไหน)
            แล้วกดดาวน์โหลดไฟล์ <code>_pi.mp4</code> ไปใช้ · ใช้กับ VDO ของ portal (หน้า Admin → station-videos) ได้ด้วย ·
            VDO ในเกมนี้ หน้าแก้ไขโจทย์แปลงให้อัตโนมัติอยู่แล้ว
          </p>
        </div>

        {!supported && (
          <div className="flex gap-2 rounded-sm border border-f1-wrong/40 bg-f1-bad-bg p-3 text-sm text-f1-bad">
            <TriangleAlert className="size-5 shrink-0" />
            <p>{convertUnavailableReason()}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors",
            dragOver ? "border-f1-brand bg-f1-brand/10" : "border-f1-line-strong hover:border-f1-brand",
          )}
        >
          <Upload className="size-8 text-f1-brand-ink" />
          <span className="text-lg font-bold">ลากไฟล์ VDO มาวางที่นี่ หรือคลิกเพื่อเลือก</span>
          <span className="text-xs text-f1-mute">เลือกได้หลายไฟล์ · .mp4 .mov .mkv .webm .m4v</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,.mp4,.m4v,.mov,.mkv,.webm,.ogv"
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="space-y-2 rounded-lg border border-f1-line bg-white p-3 text-sm">
                <div className="flex items-center gap-2">
                  <FileVideo className="size-5 shrink-0 text-f1-brand-ink" />
                  <span className="min-w-0 flex-1 truncate font-bold">{it.file.name}</span>
                  <span className="shrink-0 text-xs text-f1-mute">{formatMB(it.file.size)}</span>
                  <button type="button" className="shrink-0 rounded p-1 text-f1-mute hover:bg-zinc-100" onClick={() => remove(it)} aria-label="เอาออก">
                    <X className="size-4" />
                  </button>
                </div>

                {it.warnings.length > 0 && it.state !== "done" && (
                  <ul className="list-disc pl-6 text-xs text-f1-bad">
                    {it.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}

                {it.state === "checking" && (
                  <p className="flex items-center gap-1.5 text-xs text-f1-mute">
                    <Loader2 className="size-3.5 animate-spin" /> กำลังตรวจไฟล์…
                  </p>
                )}
                {it.state === "good" && (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-f1-ok-ink">
                      <CircleCheck className="size-4" /> ไฟล์นี้เล่นลื่นบนจอ Station อยู่แล้ว ใช้ได้เลย
                    </span>
                    {supported && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch(it.id, { state: "queued" })}>
                        แปลงอยู่ดี
                      </Button>
                    )}
                  </div>
                )}
                {it.state === "queued" && <p className="text-xs text-f1-mute">รอคิวแปลง…</p>}
                {it.state === "converting" && (
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div className="h-full w-full origin-left bg-f1-brand transition-transform" style={{ transform: `scaleX(${it.percent / 100})` }} />
                    </div>
                    <p className="f1-font-mono text-xs text-f1-mute">กำลังแปลง {it.percent}% (อย่าปิดหน้านี้)</p>
                  </div>
                )}
                {it.state === "done" && it.result && it.url && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-f1-ok-ink">
                      <CircleCheck className="size-4" />
                      {it.result.reencoded
                        ? `${it.result.from.width}×${it.result.from.height} ${formatMB(it.result.from.size)} → ${it.result.to.width}×${it.result.to.height} ${formatMB(it.result.to.size)}`
                        : `จัดไฟล์ให้เริ่มเล่นทันทีแล้ว (ภาพเดิม) ${formatMB(it.result.to.size)}`}
                    </span>
                    <a
                      href={it.url}
                      download={it.result.file.name}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-f1-brand px-3 text-sm font-bold text-f1-on-brand hover:bg-f1-brand-dark"
                    >
                      <Download className="size-4" /> ดาวน์โหลด {it.result.file.name}
                    </a>
                  </div>
                )}
                {it.state === "error" && <p className="text-xs font-bold text-f1-bad">{it.error}</p>}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-f1-mute">
          ต้องเปิดหน้านี้ด้วย Chrome หรือ Edge บน PC (ไม่ใช่บน Pi) · ไฟล์ที่แปลงไม่ได้ ใช้ <code>tools/convert-video.bat</code> แทน · รายละเอียดใน
          VIDEO_GUIDE.md
        </p>
      </main>
    </div>
  );
}
