import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Cpu, Lock, RotateCcw, Save, Trash2, Unlock } from "lucide-react";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../components/ui/utils";

// หน้า GPIO ของ Pi สถานี: ดู input สด + log การเปลี่ยนสัญญาณ, สั่ง output / pulse, กล้องตรวจ OK/NG (backend/gpio.js)
const API = `${import.meta.env.BASE_URL}api/gpio`;
const POLL_MS = 300;

type Level = 0 | 1;
type PinState = { level: Level; func: string; pull: string };
type PinRow = PinState & { pin: number; physical: number; note: string; orig: PinState; touched: boolean; busy: string; count: number };
type Edge = { id: number; at: number; pin: number; level: Level };
type InspectRow = { at: number; result: "OK" | "NG" | "TIMEOUT" | "BOTH" | "STUCK"; ms: number; detail?: string; triggerPin: number; okPin: number; ngPin: number };
type Status = {
  driver: string;
  pins: PinRow[];
  edges: Edge[];
  actions: { at: number; msg: string }[];
  inspect: { busy: boolean; history: InspectRow[] };
};
type InspectCfg = {
  triggerPin: number;
  triggerActive: "high" | "low";
  triggerMs: number;
  okPin: number;
  ngPin: number;
  resultActive: "high" | "low";
  pull: "up" | "down" | "none";
  timeoutMs: number;
};
type Config = { labels: Record<string, string>; inspect: InspectCfg };
type Filter = "all" | "input" | "output" | "named";

const RESULT_TEXT: Record<InspectRow["result"], string> = {
  OK: "OK",
  NG: "NG",
  TIMEOUT: "หมดเวลา — กล้องไม่ตอบ",
  BOTH: "OK และ NG ขึ้นพร้อมกัน",
  STUCK: "ขา OK/NG ค้างก่อนสั่งถ่าย",
};
const PIN_OPTIONS = Array.from({ length: 26 }, (_, i) => i + 2);

const two = (n: number) => String(n).padStart(2, "0");
function clock(ms: number) {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(API + path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
  return json as T;
}

function Led({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block size-4 shrink-0 rounded-full border", on ? "border-[#15803D] bg-[#22C55E]" : "border-zinc-400 bg-zinc-200", className)}
      aria-label={on ? "HIGH" : "LOW"}
    />
  );
}

function PinSelect({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <label className="space-y-1 text-sm text-zinc-700">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block h-9 w-full rounded-md border border-[#8B8B95] bg-white px-2 text-f1-ink"
      >
        {PIN_OPTIONS.map((n) => (
          <option key={n} value={n}>
            GPIO{n}
          </option>
        ))}
      </select>
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="space-y-1 text-sm text-zinc-700">
      <span>{label}</span>
      <div className="flex gap-1">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "f1-font-display h-9 flex-1 rounded-sm border px-2 text-xs font-medium",
              value === v ? "border-f1-brand bg-f1-brand text-f1-on-brand" : "border-f1-line bg-white text-zinc-700",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GpioPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cfgDirty, setCfgDirty] = useState(false);
  const [armed, setArmed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [pulse, setPulse] = useState({ ms: 200, active: "high" as "high" | "low", count: 1, gap: 200 });
  const [inspecting, setInspecting] = useState(false);
  const [lastInspect, setLastInspect] = useState<InspectRow | null>(null);
  const savedRef = useRef<Config | null>(null); // ค่าที่อยู่ใน DB ล่าสุด

  const refresh = useCallback(async () => {
    try {
      setStatus(await call<Status>(""));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // อ่านสถานะทุก POLL_MS เฉพาะตอนแท็บเปิดอยู่ (backend หยุดอ่านขาเองเมื่อไม่มีใครขอ)
  useEffect(() => {
    let stop = false;
    let t: number | undefined;
    const loop = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") await refresh();
      if (!stop) t = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [refresh]);

  useEffect(() => {
    call<Config>("/config")
      .then((c) => {
        savedRef.current = c;
        setCfg(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function act(path: string, body?: unknown) {
    try {
      await call(path, { method: "POST", body: body ?? {} });
      setNotice(null);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function putConfig(next: Config) {
    try {
      const saved = await call<Config>("/config", { method: "PUT", body: next });
      savedRef.current = saved;
      return saved;
    } catch (e) {
      setNotice(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async function saveConfig(next: Config) {
    const saved = await putConfig(next);
    if (!saved) return null;
    setCfg(saved);
    setCfgDirty(false);
    setNotice("บันทึกการตั้งค่าแล้ว");
    return saved;
  }

  function editInspect(patch: Partial<InspectCfg>) {
    if (!cfg) return;
    setCfg({ ...cfg, inspect: { ...cfg.inspect, ...patch } });
    setCfgDirty(true);
  }

  async function saveLabel(pin: number, name: string) {
    const base = savedRef.current;
    if (!base || (base.labels[pin] ?? "") === name.trim()) return;
    const labels = { ...base.labels };
    if (name.trim()) labels[pin] = name.trim();
    else delete labels[pin];
    // บันทึกเฉพาะชื่อขา — ค่ากล้องที่แก้ค้างไว้แต่ยังไม่กดบันทึก ไม่ถูกเขียนลง DB และยังค้างอยู่ในฟอร์ม
    const saved = await putConfig({ ...base, labels });
    if (saved) setCfg((c) => (c ? { ...c, labels: saved.labels } : saved));
  }

  async function inspect() {
    if (!cfg) return;
    if (cfgDirty && !(await saveConfig(cfg))) return;
    setInspecting(true);
    setLastInspect(null);
    try {
      setLastInspect(await call<InspectRow>("/inspect", { method: "POST", body: {} }));
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setInspecting(false);
      void refresh();
    }
  }

  const labels = cfg?.labels ?? {};
  const nameOf = (pin: number) => (labels[pin] ? `GPIO${pin} · ${labels[pin]}` : `GPIO${pin}`);
  const pins = (status?.pins ?? []).filter((p) =>
    filter === "input" ? p.func === "INPUT" : filter === "output" ? p.func === "OUTPUT" : filter === "named" ? Boolean(labels[p.pin]) : true,
  );
  const pinById = (n: number) => status?.pins.find((p) => p.pin === n);
  const ic = cfg?.inspect;
  const resultActive = ic?.resultActive === "high" ? 1 : 0;

  return (
    <div className="f1-paper-bg min-h-screen pb-16">
      <F1Header />
      <main className="mx-auto max-w-7xl space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="f1-font-display flex items-center gap-2 text-2xl font-bold text-f1-ink">
            <Cpu className="size-6 text-f1-brand-ink" /> GPIO • สัญญาณเข้า-ออก
          </h1>
          {status && (
            <span
              className={cn(
                "rounded-sm px-2 py-0.5 text-xs font-medium",
                status.driver === "mock" ? "bg-f1-bad-bg text-f1-bad" : "bg-zinc-100 text-zinc-700",
              )}
            >
              {status.driver === "mock" ? "ขาจำลอง (ไม่ใช่ Pi)" : `ขาจริง · ${status.driver}`}
            </span>
          )}
          <label
            className={cn(
              "ml-auto flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-sm font-medium",
              armed ? "border-f1-wrong bg-f1-bad-bg text-f1-bad" : "border-f1-line bg-white text-zinc-700",
            )}
          >
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            {armed ? <Unlock className="size-4" /> : <Lock className="size-4" />} ปลดล็อกสั่งขา
          </label>
        </div>
        <p className="text-sm text-zinc-600">
          ดูสถานะได้เลย · จะสั่ง HIGH / LOW / pulse / ถ่ายรูปตรวจ ต้องติ๊ก "ปลดล็อกสั่งขา" ก่อน · กด "ปล่อย" หรือปิด backend แล้วขาจะกลับเป็นค่าเดิมก่อนแตะ · เลขขาเป็นเลข BCM
        </p>
        {error && <p className="rounded-sm border border-f1-wrong/40 bg-f1-bad-bg px-3 py-2 text-sm text-f1-bad">เชื่อมต่อ GPIO ไม่ได้: {error}</p>}
        {notice && <p className="rounded-sm border border-f1-line bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{notice}</p>}

        {/* กล้องตรวจ OK / NG */}
        <section className="space-y-3 rounded-sm border-2 border-f1-line bg-white/90 p-4" aria-label="กล้องตรวจ OK/NG">
          <h2 className="f1-font-display flex items-center gap-2 text-lg font-bold text-f1-ink">
            <Camera className="size-5 text-f1-brand-ink" /> กล้องถ่ายรูปตรวจ OK / NG
          </h2>
          {ic ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PinSelect label="ขา trigger (ส่งไปกล้อง)" value={ic.triggerPin} onChange={(n) => editInspect({ triggerPin: n })} />
                <Choice label="trigger active" value={ic.triggerActive} options={[["high", "HIGH"], ["low", "LOW"]]} onChange={(v) => editInspect({ triggerActive: v })} />
                <label className="space-y-1 text-sm text-zinc-700">
                  <span>ความยาว pulse (ms)</span>
                  <Input type="number" min={1} max={5000} value={ic.triggerMs} onChange={(e) => editInspect({ triggerMs: Number(e.target.value) || 1 })} className="border-[#8B8B95] bg-white text-f1-ink" />
                </label>
                <label className="space-y-1 text-sm text-zinc-700">
                  <span>รอผลไม่เกิน (ms)</span>
                  <Input type="number" min={100} max={60000} value={ic.timeoutMs} onChange={(e) => editInspect({ timeoutMs: Number(e.target.value) || 100 })} className="border-[#8B8B95] bg-white text-f1-ink" />
                </label>
                <PinSelect label="ขา OK (รับจากกล้อง)" value={ic.okPin} onChange={(n) => editInspect({ okPin: n })} />
                <PinSelect label="ขา NG (รับจากกล้อง)" value={ic.ngPin} onChange={(n) => editInspect({ ngPin: n })} />
                <Choice label="OK/NG active" value={ic.resultActive} options={[["high", "HIGH"], ["low", "LOW"]]} onChange={(v) => editInspect({ resultActive: v })} />
                <Choice label="pull ของขา OK/NG" value={ic.pull} options={[["down", "DOWN"], ["up", "UP"], ["none", "NONE"]]} onChange={(v) => editInspect({ pull: v })} />
              </div>
              <p className="text-xs text-f1-mute">
                ตั้งสัญญาณ OK/NG ของกล้องให้ค้างอย่างน้อย 20 ms · ถ้าขา OK/NG ยัง active ค้างจากรอบก่อนเกิน 1 วิ จะไม่สั่งถ่ายและขึ้นว่า "ค้าง"
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={!cfgDirty}
                  onClick={() => cfg && void saveConfig(cfg)}
                  className="border-f1-line"
                >
                  <Save /> บันทึกการตั้งค่า
                </Button>
                <Button
                  disabled={!armed || inspecting || status?.inspect.busy}
                  onClick={() => void inspect()}
                  className="h-12 bg-f1-brand px-6 text-lg font-bold text-f1-on-brand hover:bg-f1-brand-dark"
                >
                  <Camera className="size-5" /> {inspecting ? "กำลังตรวจ…" : "ถ่ายรูปตรวจ"}
                </Button>
                <span className="flex items-center gap-2 text-sm text-zinc-700">
                  <Led on={pinById(ic.okPin)?.level === resultActive} /> OK
                  <Led on={pinById(ic.ngPin)?.level === resultActive} className="ml-2" /> NG
                  <span className="text-xs text-f1-mute">(active ตอนนี้)</span>
                </span>
                {lastInspect && (
                  <span
                    role="status"
                    className={cn(
                      "f1-font-display rounded-md px-4 py-2 text-xl font-bold",
                      lastInspect.result === "OK" ? "bg-[#15803D] text-white" : lastInspect.result === "NG" ? "bg-f1-wrong text-white" : "bg-zinc-200 text-f1-ink",
                    )}
                  >
                    {RESULT_TEXT[lastInspect.result]} · {lastInspect.ms} ms
                  </span>
                )}
              </div>
              {status && status.inspect.history.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-f1-mute">
                    <tr>
                      <th className="py-1 pr-3 font-medium">เวลา</th>
                      <th className="py-1 pr-3 font-medium">ผล</th>
                      <th className="py-1 pr-3 font-medium">ใช้เวลา</th>
                      <th className="py-1 font-medium">ขา trigger / OK / NG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.inspect.history.slice(0, 10).map((h) => (
                      <tr key={h.at} className="border-t border-f1-line">
                        <td className="py-1 pr-3 font-mono">{clock(h.at)}</td>
                        <td className={cn("py-1 pr-3 font-bold", h.result === "OK" ? "text-f1-ok-ink" : h.result === "NG" ? "text-f1-wrong" : "text-zinc-600")}>
                          {RESULT_TEXT[h.result]}
                        </td>
                        <td className="py-1 pr-3 font-mono">{h.ms} ms</td>
                        <td className="py-1 font-mono text-zinc-600">
                          {h.triggerPin} / {h.okPin} / {h.ngPin}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="text-sm text-f1-mute">กำลังโหลดการตั้งค่า…</p>
          )}
        </section>

        <div className="grid gap-4 2xl:grid-cols-[1fr_22rem]">
          {/* ตารางขา */}
          <section className="space-y-3 rounded-sm border-2 border-f1-line bg-white/90 p-4" aria-label="ขา GPIO">
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="f1-font-display text-lg font-bold text-f1-ink">ขา GPIO 2–27</h2>
              <div className="flex gap-1">
                {(
                  [
                    ["all", "ทุกขา"],
                    ["input", "Input"],
                    ["output", "Output"],
                    ["named", "ที่ตั้งชื่อ"],
                  ] as [Filter, string][]
                ).map(([v, text]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFilter(v)}
                    className={cn(
                      "f1-font-display rounded-sm border px-3 py-1 text-xs font-medium",
                      filter === v ? "border-f1-brand bg-f1-brand text-f1-on-brand" : "border-f1-line bg-white text-zinc-700",
                    )}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-end gap-2 text-xs text-zinc-700">
                <label>
                  pulse (ms)
                  <Input type="number" min={1} max={60000} value={pulse.ms} onChange={(e) => setPulse({ ...pulse, ms: Number(e.target.value) || 1 })} className="h-8 w-20 border-[#8B8B95] bg-white" />
                </label>
                <label>
                  ครั้ง
                  <Input type="number" min={1} max={1000} value={pulse.count} onChange={(e) => setPulse({ ...pulse, count: Number(e.target.value) || 1 })} className="h-8 w-16 border-[#8B8B95] bg-white" />
                </label>
                <label>
                  เว้น (ms)
                  <Input type="number" min={1} max={60000} value={pulse.gap} onChange={(e) => setPulse({ ...pulse, gap: Number(e.target.value) || 1 })} className="h-8 w-20 border-[#8B8B95] bg-white" />
                </label>
                <label>
                  active
                  <select value={pulse.active} onChange={(e) => setPulse({ ...pulse, active: e.target.value as "high" | "low" })} className="block h-8 rounded-md border border-[#8B8B95] bg-white px-1">
                    <option value="high">HIGH</option>
                    <option value="low">LOW</option>
                  </select>
                </label>
                <Button size="sm" variant="outline" disabled={!armed} onClick={() => void act("/release-all")} className="h-8 border-f1-line">
                  <RotateCcw /> ปล่อยทุกขา
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="text-xs text-f1-mute">
                  <tr>
                    <th className="py-1 pr-2 font-medium">ขา</th>
                    <th className="py-1 pr-2 font-medium">ชื่อ</th>
                    <th className="py-1 pr-2 font-medium">ระดับ</th>
                    <th className="py-1 pr-2 font-medium">โหมด</th>
                    <th className="py-1 pr-2 font-medium">เปลี่ยน</th>
                    <th className="py-1 font-medium">สั่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {pins.map((p) => (
                    <tr key={p.pin} className={cn("border-t border-f1-line align-middle", p.touched && "bg-f1-bad-bg/40")}>
                      <td className="py-1.5 pr-2">
                        <span className="font-mono font-bold text-f1-ink">GPIO{p.pin}</span>
                        <span className="block text-xs text-f1-mute">
                          ขา {p.physical}
                          {p.note && ` · ${p.note}`}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          key={`${p.pin}-${labels[p.pin] ?? ""}`}
                          defaultValue={labels[p.pin] ?? ""}
                          placeholder="ตั้งชื่อ…"
                          maxLength={40}
                          aria-label={`ชื่อ GPIO${p.pin}`}
                          onBlur={(e) => void saveLabel(p.pin, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          className="h-8 w-36 border-[#8B8B95] bg-white"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="flex items-center gap-1.5 font-mono font-bold">
                          <Led on={p.level === 1} /> {p.level ? "HIGH" : "LOW"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-xs">
                        <span className={cn("font-bold", p.func === "OUTPUT" ? "text-f1-brand-ink" : "text-zinc-700")}>{p.func === "OUTPUT" ? "OUT" : p.func === "INPUT" ? "IN" : p.func}</span>
                        {p.func === "INPUT" && <span className="text-f1-mute"> · pull {p.pull}</span>}
                        <span className="block text-f1-mute">{p.busy ? p.busy : p.touched ? "สั่งจากหน้านี้" : "ค่าเดิม"}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{p.count}</td>
                      <td className="py-1.5">
                        <div className="flex gap-1 whitespace-nowrap">
                          {(["up", "down", "none"] as const).map((pull) => (
                            <Button key={pull} size="sm" variant="outline" disabled={!armed} onClick={() => void act(`/pin/${p.pin}/input`, { pull })} className="h-7 border-f1-line px-2 text-xs">
                              IN {pull.toUpperCase()}
                            </Button>
                          ))}
                          <Button size="sm" disabled={!armed} onClick={() => void act(`/pin/${p.pin}/high`)} className="h-7 bg-f1-brand px-2 text-xs text-f1-on-brand">
                            HIGH
                          </Button>
                          <Button size="sm" disabled={!armed} onClick={() => void act(`/pin/${p.pin}/low`)} className="h-7 bg-f1-brand px-2 text-xs text-f1-on-brand">
                            LOW
                          </Button>
                          <Button size="sm" disabled={!armed || Boolean(p.busy)} onClick={() => void act(`/pin/${p.pin}/pulse`, pulse)} className="h-7 bg-f1-brand px-2 text-xs text-f1-on-brand">
                            pulse
                          </Button>
                          <Button size="sm" variant="outline" disabled={!armed || !p.touched} onClick={() => void act(`/pin/${p.pin}/release`)} className="h-7 border-f1-line px-2 text-xs">
                            ปล่อย
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* log การเปลี่ยนสัญญาณ */}
          <section className="space-y-2 rounded-sm border-2 border-f1-line bg-white/90 p-4" aria-label="log การเปลี่ยนสัญญาณ">
            <div className="flex items-center gap-2">
              <h2 className="f1-font-display text-lg font-bold text-f1-ink">log สัญญาณ</h2>
              <Button size="sm" variant="outline" onClick={() => void act("/edges/clear")} className="ml-auto h-7 border-f1-line px-2 text-xs">
                <Trash2 /> ล้าง
              </Button>
            </div>
            <p className="text-xs text-f1-mute">อ่านขาทุก 0.1 วิ ตอนเปิดหน้านี้ — pulse ที่สั้นกว่านั้นอาจไม่ขึ้น</p>
            <ol className="max-h-80 space-y-0.5 2xl:max-h-[32rem] overflow-y-auto font-mono text-xs">
              {(status?.edges ?? []).map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="text-f1-mute">{clock(e.at)}</span>
                  <span className={e.level ? "text-f1-ok-ink" : "text-f1-wrong"}>{e.level ? "↑ HIGH" : "↓ LOW"}</span>
                  <span className="truncate text-f1-ink">{nameOf(e.pin)}</span>
                </li>
              ))}
              {status && status.edges.length === 0 && <li className="text-f1-mute">ยังไม่มีการเปลี่ยนสัญญาณ</li>}
            </ol>
            {status && status.actions.length > 0 && (
              <>
                <h3 className="pt-2 text-sm font-bold text-f1-ink">คำสั่งล่าสุด</h3>
                <ol className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-zinc-700">
                  {status.actions.slice(0, 15).map((a, i) => (
                    <li key={`${a.at}-${i}`}>
                      <span className="font-mono text-f1-mute">{clock(a.at)}</span> {a.msg}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
