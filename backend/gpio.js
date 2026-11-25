// GPIO ของ Pi สถานี — ดู input สด / สั่ง output / pulse / กล้องตรวจ OK-NG (หน้า /I-DOJO/gpio)
//
// - สั่งขาผ่านคำสั่ง `raspi-gpio` (ไม่ claim ขาแบบ library จึงไม่ชนโปรแกรมอื่น และไม่ต้องลง dependency — Pi ไม่มีเน็ต)
//   user ที่รัน backend ต้องอยู่กลุ่ม `gpio`
// - ไม่แตะขาไหนจนกว่าจะสั่ง: จดสถานะเดิมของทุกขาไว้ตอนเริ่ม แล้วคืนให้เมื่อกด "ปล่อย" / pulse จบ / ปิดโปรแกรม
// - ไม่มี raspi-gpio (เครื่อง dev) หรือ GPIO_MOCK=1 → ขาจำลองในหน่วยความจำ
// - อ่านขาด้วยการเรียก raspi-gpio ทีละครั้ง (~3 ms บน Pi 4): ตอนตรวจกล้องอ่านทุก ~10 ms → สัญญาณ OK/NG ต้องค้าง ≥ 20 ms
//   log ขอบขึ้น/ลงอ่านทุก 100 ms → pulse ที่สั้นกว่านั้นอาจไม่ขึ้นใน log

const { execFile, execFileSync } = require('child_process');
const express = require('express');

const PINS = Array.from({ length: 26 }, (_, i) => i + 2); // GPIO 2–27 (0/1 = ID EEPROM ของ HAT ไม่ให้แตะ)
// BCM → ขา physical บน header 40 ขา
const PHYSICAL = {
  2: 3, 3: 5, 4: 7, 5: 29, 6: 31, 7: 26, 8: 24, 9: 21, 10: 19, 11: 23, 12: 32, 13: 33, 14: 8,
  15: 10, 16: 36, 17: 11, 18: 12, 19: 35, 20: 38, 21: 40, 22: 15, 23: 16, 24: 18, 25: 22, 26: 37, 27: 13,
};
// ขาที่มีหน้าที่พิเศษ — สั่งได้แต่เตือน
const NOTES = {
  2: 'I2C SDA', 3: 'I2C SCL', 7: 'SPI CE1', 8: 'SPI CE0', 9: 'SPI MISO', 10: 'SPI MOSI', 11: 'SPI SCLK',
  14: 'UART TX', 15: 'UART RX',
};
const PULL_ARG = { UP: 'pu', DOWN: 'pd', NONE: 'pn' };
const MAX_MS = 60_000;
const MONITOR_MS = 100; // รอบอ่านขาตอนมีคนเปิดหน้า GPIO
const WATCH_IDLE_MS = 10_000; // ไม่มีใครขอสถานะนานเท่านี้ = หยุดอ่าน (ไม่กิน CPU ของ Pi ระหว่างเล่น VDO)
const INSPECT_POLL_MS = 10;
const CLEAR_WAIT_MS = 1000;
const EDGE_MAX = 300;
const HISTORY_MAX = 50;
const ACTION_MAX = 50;

class GpioError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// ---------------------------------------------------------------- drivers
class RaspiGpio {
  constructor() {
    this.name = 'raspi-gpio';
    this.re = /GPIO (\d+): level=(\d) fsel=\d+(?: alt=\d+)? func=(\S+)(?: pull=(\S+))?/g;
  }
  run(args) {
    return new Promise((resolve, reject) => {
      execFile('raspi-gpio', args, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err || /Unknown/.test(stdout)) reject(new Error((stderr || stdout || String(err)).trim()));
        else resolve(stdout);
      });
    });
  }
  async read(pins) {
    const out = await this.run(['get', pins.join(',')]);
    const res = {};
    for (const m of out.matchAll(this.re)) {
      res[Number(m[1])] = { level: Number(m[2]), func: m[3], pull: m[4] || 'NONE' };
    }
    return res;
  }
  drive(pin, level) {
    return this.run(['set', String(pin), 'op', level ? 'dh' : 'dl']);
  }
  input(pin, pull) {
    return this.run(['set', String(pin), 'ip', PULL_ARG[pull] || 'pn']);
  }
}

// ขาจำลอง — กล้องจำลองตอบ OK → NG → ไม่ตอบ วนไปทีละครั้ง (หรือตาม GPIO_MOCK_CAMERA=OK|NG|NONE)
class MockGpio {
  constructor() {
    this.name = 'mock';
    this.state = {};
    this.forced = {}; // ระดับที่ "ภายนอก" จ่ายเข้ามาที่ขา input (POST /api/gpio/mock)
    this.cameraTurn = 0;
    for (const n of PINS) {
      const pull = n <= 8 ? 'UP' : 'DOWN';
      this.state[n] = { level: pull === 'UP' ? 1 : 0, func: 'INPUT', pull };
    }
  }
  level(n) {
    const s = this.state[n];
    if (s.func === 'OUTPUT') return s.level;
    if (this.forced[n] !== undefined) return this.forced[n];
    return s.pull === 'UP' ? 1 : s.pull === 'DOWN' ? 0 : s.level;
  }
  async read(pins) {
    const res = {};
    for (const n of pins) if (this.state[n]) res[n] = { ...this.state[n], level: this.level(n) };
    return res;
  }
  async drive(pin, level) {
    this.state[pin] = { ...this.state[pin], func: 'OUTPUT', level: level ? 1 : 0 };
  }
  async input(pin, pull) {
    this.state[pin] = { ...this.state[pin], func: 'INPUT', pull };
  }
  force(pin, level) {
    if (level === null) delete this.forced[pin];
    else this.forced[pin] = level ? 1 : 0;
  }
  simulateCamera(cfg) {
    const order = ['OK', 'NG', 'NONE'];
    const env = String(process.env.GPIO_MOCK_CAMERA || '').toUpperCase();
    const answer = order.includes(env) ? env : order[this.cameraTurn++ % order.length];
    if (answer === 'NONE') return;
    const pin = answer === 'OK' ? cfg.okPin : cfg.ngPin;
    const active = cfg.resultActive === 'high' ? 1 : 0;
    setTimeout(() => this.force(pin, active), 250);
    setTimeout(() => this.force(pin, null), 450);
  }
}

function hasRaspiGpio() {
  try {
    execFileSync('raspi-gpio', ['get', '2'], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- config (ตาราง gpio_config)
const DEFAULT_CONFIG = {
  labels: {},
  inspect: {
    triggerPin: 17, triggerActive: 'high', triggerMs: 100,
    okPin: 27, ngPin: 22, resultActive: 'high', pull: 'down', timeoutMs: 3000,
  },
};

function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const i = c.inspect && typeof c.inspect === 'object' ? c.inspect : {};
  const d = DEFAULT_CONFIG.inspect;
  const pin = (v, def) => (PINS.includes(Number(v)) ? Number(v) : def);
  const labels = {};
  if (c.labels && typeof c.labels === 'object') {
    for (const [k, v] of Object.entries(c.labels)) {
      const name = typeof v === 'string' ? v.trim().slice(0, 40) : '';
      if (PINS.includes(Number(k)) && name) labels[Number(k)] = name;
    }
  }
  return {
    labels,
    inspect: {
      triggerPin: pin(i.triggerPin, d.triggerPin),
      triggerActive: i.triggerActive === 'low' ? 'low' : 'high',
      triggerMs: clampInt(i.triggerMs, 1, 5000, d.triggerMs),
      okPin: pin(i.okPin, d.okPin),
      ngPin: pin(i.ngPin, d.ngPin),
      resultActive: i.resultActive === 'low' ? 'low' : 'high',
      pull: ['up', 'down', 'none'].includes(i.pull) ? i.pull : d.pull,
      timeoutMs: clampInt(i.timeoutMs, 100, 60_000, d.timeoutMs),
    },
  };
}

// ---------------------------------------------------------------- controller
class GpioController {
  constructor(driver) {
    this.driver = driver;
    this.snapshot = null; // สถานะเดิมก่อนแตะ
    this.cur = {};
    this.readAt = 0;
    this.reading = null;
    this.touched = new Set();
    this.busy = {}; // pin -> คำอธิบายงานที่กำลังทำ
    this.gen = {}; // pin -> เลขรุ่น · เพิ่มเมื่อยกเลิกงานของขานั้น
    this.wakers = {}; // pin -> ตัวปลุก sleep ที่ยกเลิกได้
    this.edges = [];
    this.counts = {};
    this.actions = [];
    this.history = [];
    this.inspecting = false;
    this.wantedAt = 0;
    this.edgeSeq = 0;
    for (const n of PINS) {
      this.gen[n] = 0;
      this.wakers[n] = new Set();
      this.counts[n] = 0;
    }
  }

  async init() {
    this.snapshot = await this.driver.read(PINS);
    this.cur = this.snapshot;
    this.readAt = Date.now();
    this.timer = setInterval(() => {
      if (Date.now() - this.wantedAt < WATCH_IDLE_MS && !this.reading) this.refresh().catch(() => {});
    }, MONITOR_MS);
    this.timer.unref?.();
  }

  note(msg) {
    this.actions.unshift({ at: Date.now(), msg });
    this.actions.length = Math.min(this.actions.length, ACTION_MAX);
    console.log(`[gpio] ${msg}`);
  }

  // อ่านทุกขาแล้วจดขอบขึ้น/ลง (เรียกซ้อนกันได้ — ใช้ผลรอบเดียวกัน)
  refresh() {
    if (!this.reading) {
      this.reading = this.driver
        .read(PINS)
        .then((next) => {
          const at = Date.now();
          for (const n of PINS) {
            const a = this.cur[n], b = next[n];
            if (a && b && a.level !== b.level) this.edge(n, b.level, at);
          }
          this.cur = next;
          this.readAt = at;
        })
        .finally(() => {
          this.reading = null;
        });
    }
    return this.reading;
  }

  edge(pin, level, at) {
    this.counts[pin] += 1;
    this.edges.unshift({ id: ++this.edgeSeq, at, pin, level });
    this.edges.length = Math.min(this.edges.length, EDGE_MAX);
  }

  clearEdges() {
    this.edges = [];
    for (const n of PINS) this.counts[n] = 0;
  }

  async status() {
    this.wantedAt = Date.now();
    if (Date.now() - this.readAt > MONITOR_MS * 2) await this.refresh();
    return {
      driver: this.driver.name,
      pins: PINS.filter((n) => this.cur[n]).map((n) => ({
        pin: n, physical: PHYSICAL[n], note: NOTES[n] || '', ...this.cur[n],
        orig: this.snapshot[n], touched: this.touched.has(n), busy: this.busy[n] || '', count: this.counts[n],
      })),
      edges: this.edges,
      actions: this.actions,
      inspect: { busy: this.inspecting, history: this.history },
    };
  }

  check(pin) {
    const n = Number(pin);
    if (!PINS.includes(n)) throw new GpioError(`ไม่มีขา GPIO${pin} (ใช้ได้ GPIO 2–27)`);
    return n;
  }

  // ยกเลิกงานที่ค้างของขานี้ (pulse) — งานนั้นจะไม่คืนค่าขาทับคำสั่งใหม่
  cancel(pin) {
    this.gen[pin] += 1;
    delete this.busy[pin];
    for (const wake of [...this.wakers[pin]]) wake();
  }

  wait(pin, ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wakers[pin].delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.wakers[pin].add(done);
    });
  }

  async restorePin(pin) {
    const s = this.snapshot[pin];
    if (s.func === 'OUTPUT') await this.driver.drive(pin, s.level);
    else await this.driver.input(pin, s.pull); // ขา alt function (I2C/SPI/UART) คืนได้แค่เป็น input ตาม pull เดิม
  }

  async setLevel(pin, level) {
    const n = this.check(pin);
    this.cancel(n);
    this.touched.add(n);
    await this.driver.drive(n, level);
    this.note(`GPIO${n} → ${level ? 'HIGH' : 'LOW'} (ค้าง)`);
    await this.refresh();
  }

  async setInput(pin, pull) {
    const n = this.check(pin);
    const p = String(pull || '').toUpperCase();
    if (!PULL_ARG[p]) throw new GpioError('pull ต้องเป็น up / down / none');
    this.cancel(n);
    this.touched.add(n);
    await this.driver.input(n, p);
    this.note(`GPIO${n} → INPUT pull=${p}`);
    await this.refresh();
  }

  async release(pin) {
    const n = this.check(pin);
    this.cancel(n);
    await this.restorePin(n);
    this.touched.delete(n);
    this.note(`GPIO${n} คืนค่าเดิม (${this.snapshot[n].func} pull=${this.snapshot[n].pull})`);
    await this.refresh();
  }

  async releaseAll() {
    for (const n of [...this.touched]) {
      this.cancel(n);
      try {
        await this.restorePin(n);
      } catch (e) {
        console.error(`[gpio] คืนค่า GPIO${n} ไม่ได้: ${e.message}`);
      }
    }
    this.touched.clear();
  }

  // เริ่ม pulse แล้วคืนทันที (ไม่รอจบ) · resolve ของ promise ที่คืน = pulse จบ
  pulse(pin, { ms = 200, active = 'high', count = 1, gap = 200 } = {}) {
    const n = this.check(pin);
    if (this.busy[n]) throw new GpioError(`GPIO${n} กำลังทำงานอยู่ (${this.busy[n]})`, 409);
    const width = clampInt(ms, 1, MAX_MS, 200);
    const times = clampInt(count, 1, 1000, 1);
    const space = clampInt(gap, 1, MAX_MS, 200);
    const high = active !== 'low' && active !== '0' && active !== 0 && active !== false;
    const my = this.gen[n];
    const label = `pulse ${high ? 'HIGH' : 'LOW'} ${width}ms x${times}`;
    this.busy[n] = label;
    this.touched.add(n);
    this.note(`GPIO${n} ${label}${times > 1 ? ` (เว้น ${space}ms)` : ''}`);
    const job = (async () => {
      try {
        for (let i = 0; i < times && this.gen[n] === my; i++) {
          await this.driver.drive(n, high);
          await this.wait(n, width);
          if (this.gen[n] !== my) return;
          await this.driver.drive(n, !high);
          if (i < times - 1) await this.wait(n, space);
        }
        if (this.gen[n] === my) {
          await this.restorePin(n);
          this.touched.delete(n);
        }
      } catch (e) {
        this.note(`GPIO${n} pulse ผิดพลาด: ${e.message}`);
      } finally {
        if (this.gen[n] === my) delete this.busy[n];
      }
    })();
    return job;
  }

  // กล้องตรวจ: pulse ขา trigger แล้วรอขา OK / NG ขาไหน active ก่อน
  async inspect(cfg) {
    const c = normalizeConfig({ inspect: cfg }).inspect;
    if (new Set([c.triggerPin, c.okPin, c.ngPin]).size !== 3) throw new GpioError('ขา trigger / OK / NG ต้องไม่ซ้ำกัน');
    if (this.inspecting) throw new GpioError('กำลังตรวจอยู่ รอผลรอบก่อน', 409);
    this.inspecting = true;
    const started = Date.now();
    const active = c.resultActive === 'high' ? 1 : 0;
    const finish = (result, extra = {}) => {
      const row = { at: started, result, ms: Date.now() - started, ...extra,
        triggerPin: c.triggerPin, okPin: c.okPin, ngPin: c.ngPin };
      this.history.unshift(row);
      this.history.length = Math.min(this.history.length, HISTORY_MAX);
      this.note(`ตรวจกล้อง: ${result} (${row.ms} ms)`);
      return row;
    };
    try {
      for (const p of [c.okPin, c.ngPin]) {
        this.cancel(p);
        await this.driver.input(p, c.pull.toUpperCase());
        this.touched.add(p);
      }
      // ผลรอบก่อนอาจยังค้างอยู่ — รอให้ขา OK/NG กลับเป็นปกติก่อน (ไม่เกิน CLEAR_WAIT_MS) ไม่งั้นแปลว่าสายค้าง
      const clearBy = Date.now() + CLEAR_WAIT_MS;
      for (;;) {
        const pre = await this.driver.read([c.okPin, c.ngPin]);
        if (pre[c.okPin]?.level !== active && pre[c.ngPin]?.level !== active) break;
        if (Date.now() >= clearBy) return finish('STUCK', { detail: 'ขา OK/NG active ค้างอยู่ก่อนสั่งถ่าย' });
        await sleep(INSPECT_POLL_MS);
      }
      this.cancel(c.triggerPin);
      const pulseDone = this.pulse(c.triggerPin, { ms: c.triggerMs, active: c.triggerActive });
      this.driver.simulateCamera?.(c);
      const until = started + c.timeoutMs;
      let result = 'TIMEOUT';
      while (Date.now() < until) {
        const r = await this.driver.read([c.okPin, c.ngPin]);
        const ok = r[c.okPin]?.level === active, ng = r[c.ngPin]?.level === active;
        if (ok || ng) {
          result = ok && ng ? 'BOTH' : ok ? 'OK' : 'NG';
          break;
        }
        await sleep(INSPECT_POLL_MS);
      }
      const row = finish(result);
      await pulseDone;
      return row;
    } finally {
      this.inspecting = false;
      this.refresh().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- router (/api/gpio)
async function loadConfig(query) {
  const rows = await query('SELECT data FROM gpio_config WHERE singleton = 1');
  return normalizeConfig(rows.length ? JSON.parse(rows[0].data) : null);
}

// ready = promise ของ controller จาก setupGpio() (null = เปิด GPIO ไม่ได้ → 503)
function createGpioRouter({ query, ready }) {
  const router = express.Router();
  const send = (fn) => async (req, res) => {
    try {
      const ctl = await ready;
      if (!ctl) throw new GpioError('เปิด GPIO ไม่ได้ — ดู log ของ backend', 503);
      res.json(await fn(req, ctl));
    } catch (e) {
      if (!(e instanceof GpioError)) console.error('[gpio]', e);
      res.status(e.status || 500).json({ error: e.message || 'GPIO error' });
    }
  };
  const ok = { ok: true };

  router.get('/', send((req, ctl) => ctl.status()));
  router.post('/pin/:pin/high', send(async (req, ctl) => (await ctl.setLevel(req.params.pin, true), ok)));
  router.post('/pin/:pin/low', send(async (req, ctl) => (await ctl.setLevel(req.params.pin, false), ok)));
  router.post('/pin/:pin/input', send(async (req, ctl) => (await ctl.setInput(req.params.pin, req.body?.pull), ok)));
  router.post('/pin/:pin/release', send(async (req, ctl) => (await ctl.release(req.params.pin), ok)));
  router.post('/pin/:pin/pulse', send(async (req, ctl) => (ctl.pulse(req.params.pin, req.body || {}), ok)));
  router.post('/release-all', send(async (req, ctl) => {
    await ctl.releaseAll();
    ctl.note('ปล่อยทุกขา คืนค่าเดิม');
    return ok;
  }));
  router.post('/edges/clear', send(async (req, ctl) => (ctl.clearEdges(), ok)));
  router.get('/config', send(() => loadConfig(query)));
  router.put('/config', send(async (req) => {
    const cfg = normalizeConfig(req.body);
    await query(
      `INSERT INTO gpio_config (singleton, data) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
      [JSON.stringify(cfg)]
    );
    return cfg;
  }));
  router.post('/inspect', send(async (req, ctl) => ctl.inspect((await loadConfig(query)).inspect)));
  // ขาจำลองเท่านั้น: จ่ายระดับเข้าขา input เหมือนมีสัญญาณจากภายนอก ({ level: 0 | 1 | null })
  router.post('/mock/:pin', send(async (req, ctl) => {
    if (!ctl.driver.force) throw new GpioError('ใช้ได้เฉพาะโหมดขาจำลอง', 404);
    const n = ctl.check(req.params.pin);
    const level = req.body?.level;
    ctl.driver.force(n, level === null || level === undefined ? null : Number(level) ? 1 : 0);
    await ctl.refresh();
    return ok;
  }));
  return router;
}

// สร้าง controller ตัวเดียวของ process + คืนค่าขาตอนปิดโปรแกรม (pm2 stop/restart = SIGINT)
async function setupGpio() {
  const mock = process.env.GPIO_MOCK === '1' || !hasRaspiGpio();
  const ctl = new GpioController(mock ? new MockGpio() : new RaspiGpio());
  try {
    await ctl.init();
  } catch (e) {
    console.error(`[gpio] เปิด GPIO ไม่ได้: ${e.message}`);
    return null;
  }
  console.log(`[gpio] พร้อม (${ctl.driver.name})`);
  let closing = false;
  const close = (signal) => {
    if (closing) return;
    closing = true;
    ctl.releaseAll().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));
  return ctl;
}

module.exports = { setupGpio, createGpioRouter, GpioController, MockGpio, normalizeConfig, PINS };
