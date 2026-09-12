/**
 * pollCost.ts — POLL MALİYETİNİN TEK JS SÖZLEŞMESİ (P0-VDK-B3).
 *
 * ── SAHA (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA 1788096650111) ────
 * Kopyada `attempted:117 · success:117 · noData:0` yazıyordu — hat kusursuz
 * görünüyordu. AYNI oturumun ham trafiğinde onlarca `NO DATA`, `7F1912` ve her
 * istek çevresinde dört AT komutu (`ATSH7DF·ATAR·ATSH7E0·ATCRA7E8`, ~41 ms/komut)
 * vardı. İkisi çelişmiyordu: `ExtendedPollEvidence` YALNIZ extended PID
 * denemelerini sayar; FAST/SLOW grubu, `ATRV`, tüm AT yönetim komutları ve tarama
 * trafiği hiçbir sayaçta YOKTU. Ürün kendi hat maliyetinin büyük kısmını
 * ölçmüyordu.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * • Bu modül SCHEDULER DEĞİLDİR: PID seçmez, bütçe dağıtmaz, komut göndermez,
 *   timer kurmaz. Poll otoritesi native `pollLoop` + `AdaptivePidScheduler`da
 *   KALIR (bkz. `PollCostLedger` sınıf notu).
 * • Kullanıcı VERİSİ maliyeti ile ADAPTÖR YÖNETİM maliyeti asla toplanmaz.
 * • Ölçülemeyen alan `null`. **Sahte 0 YASAK** — "ölçmedik" ile "sıfırdı" AYRI.
 * • Eski APK / klon adaptör: metot yoksa `UNAVAILABLE`; "ucuz" varsayılıp DAHA
 *   FAZLA trafik gönderilmez (bu modül zaten trafik üretmez).
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import type { NativePollCost, NativePollCycleCost } from '../nativePlugin';

/** Kanıt kanalının durumu — `UNAVAILABLE` ile "maliyet 0" AYNI ŞEY DEĞİLDİR. */
export type PollCostState =
  /** Native ölçüm okundu. */
  | 'MEASURED'
  /** Metot var ama henüz hiç tur kaydedilmedi (bağlantı yeni). */
  | 'NO_CYCLES_YET'
  /** Eski APK / klon köprü: metot yok ya da çağrı düştü → ÖLÇÜLEMEDİ. */
  | 'UNAVAILABLE';

export interface PollCycleCost {
  readonly cycleId: number;
  readonly sessionEpoch: number;
  readonly burst: boolean;
  readonly diagnosticPayloadRequests: number;
  readonly adapterControlCommands: number;
  readonly headerSwitches: number;
  readonly voltageReads: number;
  readonly protocolChecks: number;
  readonly redundantHeaderSwitches: number;
  readonly noResponses: number;
  readonly negativeResponses: number;
  readonly noResponseMs: number;
  readonly payloadMs: number;
  readonly adapterMs: number;
  readonly elapsedMs: number;
  readonly bytesTx: number;
  readonly bytesRx: number;
  /** `null` = ÖLÇÜLMEDİ. */
  readonly retries: number | null;
  readonly provenance: string;
}

export interface PollCostSnapshot {
  readonly state: PollCostState;
  /** Native kanıt yoksa `null` — 0 üretilmez. */
  readonly sessionEpoch: number | null;
  readonly cyclesRecorded: number | null;
  readonly burstCyclesRecorded: number | null;
  readonly unattributedCommands: number | null;
  readonly totals: {
    readonly diagnosticPayloadRequests: number | null;
    readonly adapterControlCommands: number | null;
    readonly headerSwitches: number | null;
    readonly voltageReads: number | null;
    readonly protocolChecks: number | null;
    readonly redundantHeaderSwitches: number | null;
    readonly noResponses: number | null;
    readonly negativeResponses: number | null;
    readonly noResponseMs: number | null;
    readonly payloadMs: number | null;
    readonly adapterMs: number | null;
    readonly bytesTx: number | null;
    readonly bytesRx: number | null;
  };
  readonly lastCycle: PollCycleCost | null;
  readonly recentCycles: readonly PollCycleCost[];
  /** Ölçümün alındığı an (duvar saati) — bayatlık okuyucunun işidir. */
  readonly readAt: number | null;
}

/** Kanıt yokken dönen dürüst boşluk — her alan `null`, hiçbir sayı UYDURULMAZ. */
export const EMPTY_POLL_COST: PollCostSnapshot = {
  state: 'UNAVAILABLE',
  sessionEpoch: null,
  cyclesRecorded: null,
  burstCyclesRecorded: null,
  unattributedCommands: null,
  totals: {
    diagnosticPayloadRequests: null, adapterControlCommands: null,
    headerSwitches: null, voltageReads: null, protocolChecks: null,
    redundantHeaderSwitches: null, noResponses: null, negativeResponses: null,
    noResponseMs: null, payloadMs: null, adapterMs: null,
    bytesTx: null, bytesRx: null,
  },
  lastCycle: null,
  recentCycles: [],
  readAt: null,
};

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
/** Sayaç alanı: ölçülmediyse `null` (0'a DÜŞÜLMEZ). */
function _count(v: unknown): number {
  const n = _num(v);
  return n === null ? 0 : n;
}

/** Ham native tur maliyetini sözleşmeye çevirir. Saf — I/O yok. */
export function normalizeCycleCost(raw: NativePollCycleCost | null | undefined): PollCycleCost | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    cycleId: _count(raw.cycleId),
    sessionEpoch: _count(raw.sessionEpoch),
    burst: raw.burst === true,
    diagnosticPayloadRequests: _count(raw.diagnosticPayloadRequests),
    adapterControlCommands: _count(raw.adapterControlCommands),
    headerSwitches: _count(raw.headerSwitches),
    voltageReads: _count(raw.voltageReads),
    protocolChecks: _count(raw.protocolChecks),
    redundantHeaderSwitches: _count(raw.redundantHeaderSwitches),
    noResponses: _count(raw.noResponses),
    negativeResponses: _count(raw.negativeResponses),
    noResponseMs: _count(raw.noResponseMs),
    payloadMs: _count(raw.payloadMs),
    adapterMs: _count(raw.adapterMs),
    elapsedMs: _count(raw.elapsedMs),
    bytesTx: _count(raw.bytesTx),
    bytesRx: _count(raw.bytesRx),
    /* Native `-1`/eksik alanı `null` gönderir; burada 0'a ÇEVRİLMEZ. */
    retries: _num(raw.retries),
    provenance: typeof raw.provenance === 'string' ? raw.provenance : 'UNKNOWN',
  };
}

/** Ham native anlık görüntüyü sözleşmeye çevirir. Saf — I/O yok. */
export function normalizePollCost(raw: NativePollCost | null | undefined, readAt: number): PollCostSnapshot {
  if (!raw || raw.present !== true) return { ...EMPTY_POLL_COST, readAt };
  const t = raw.totals ?? null;
  const cycles = _num(raw.cyclesRecorded) ?? 0;
  const recent = Array.isArray(raw.recentCycles)
    ? raw.recentCycles.map(normalizeCycleCost).filter((c): c is PollCycleCost => c !== null)
    : [];
  return {
    /* Metot cevap verdi ama hiç tur kapanmadıysa bu "maliyet 0" DEĞİL,
       "henüz ölçüm penceresi kapanmadı" demektir. */
    state: cycles > 0 ? 'MEASURED' : 'NO_CYCLES_YET',
    sessionEpoch: _num(raw.sessionEpoch),
    cyclesRecorded: cycles,
    burstCyclesRecorded: _num(raw.burstCyclesRecorded),
    unattributedCommands: _num(raw.unattributedCommands),
    totals: {
      diagnosticPayloadRequests: t ? _num(t.diagnosticPayloadRequests) : null,
      adapterControlCommands:    t ? _num(t.adapterControlCommands) : null,
      headerSwitches:            t ? _num(t.headerSwitches) : null,
      voltageReads:              t ? _num(t.voltageReads) : null,
      protocolChecks:            t ? _num(t.protocolChecks) : null,
      redundantHeaderSwitches:   t ? _num(t.redundantHeaderSwitches) : null,
      noResponses:               t ? _num(t.noResponses) : null,
      negativeResponses:         t ? _num(t.negativeResponses) : null,
      noResponseMs:              t ? _num(t.noResponseMs) : null,
      payloadMs:                 t ? _num(t.payloadMs) : null,
      adapterMs:                 t ? _num(t.adapterMs) : null,
      bytesTx:                   t ? _num(t.bytesTx) : null,
      bytesRx:                   t ? _num(t.bytesRx) : null,
    },
    lastCycle: normalizeCycleCost(raw.lastCycle),
    recentCycles: recent,
    readAt,
  };
}

/* ── Türetilmiş ÖLÇÜLER (saf · yalnız gösterim; hiçbir karara beslenmez) ──── */

/** Bir turda adaptör yönetiminin toplam maliyet içindeki payı (0–1). */
export function adapterOverheadShare(c: PollCycleCost | null): number | null {
  if (!c) return null;
  const total = c.payloadMs + c.adapterMs;
  if (total <= 0) return null;                 // ölçülmedi → oran UYDURULMAZ
  return c.adapterMs / total;
}

/** Bilgi üretmeyen (cevapsız + negatif) sürenin payı (0–1). */
export function wastedShare(c: PollCycleCost | null): number | null {
  if (!c) return null;
  const total = c.payloadMs + c.adapterMs;
  if (total <= 0) return null;
  return Math.min(1, c.noResponseMs / total);
}

/** En pahalı komut sınıfı — `null` = ayırt edilemedi (eşitlik ya da ölçüm yok). */
export function costliestClass(c: PollCycleCost | null): string | null {
  if (!c) return null;
  const rows: readonly [string, number][] = [
    ['DIAGNOSTIC_PAYLOAD', c.diagnosticPayloadRequests],
    ['HEADER_SWITCH', c.headerSwitches],
    ['VOLTAGE_READ', c.voltageReads],
    ['PROTOCOL_CHECK', c.protocolChecks],
    ['ADAPTER_CONTROL',
      Math.max(0, c.adapterControlCommands - c.headerSwitches - c.voltageReads - c.protocolChecks)],
  ];
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return null;
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;   // eşitlik → iddia YOK
  return sorted[0][0];
}

/** Burst turları ile normal turların ortalama süresi — starvation kanıtı. */
export function burstVsNormal(snap: PollCostSnapshot): {
  burstCycles: number; normalCycles: number;
  burstAvgMs: number | null; normalAvgMs: number | null;
  burstAvgPayload: number | null; normalAvgPayload: number | null;
} {
  const b = snap.recentCycles.filter((c) => c.burst);
  const n = snap.recentCycles.filter((c) => !c.burst);
  const avg = (xs: readonly PollCycleCost[], pick: (c: PollCycleCost) => number): number | null =>
    xs.length === 0 ? null : Math.round(xs.reduce((s, c) => s + pick(c), 0) / xs.length);
  return {
    burstCycles: b.length,
    normalCycles: n.length,
    burstAvgMs: avg(b, (c) => c.elapsedMs),
    normalAvgMs: avg(n, (c) => c.elapsedMs),
    burstAvgPayload: avg(b, (c) => c.diagnosticPayloadRequests),
    normalAvgPayload: avg(n, (c) => c.diagnosticPayloadRequests),
  };
}

/* ── Native okuma (fail-soft · önbellekli · TETİKLEYİCİ DEĞİL) ────────────── */

let _cache: PollCostSnapshot = EMPTY_POLL_COST;
let _refreshedAt: number | null = null;

/**
 * Native maliyet defterini okur. **Hiçbir OBD komutu tetiklemez** — yalnız
 * native'in zaten tuttuğu sayaçları alır. Eski APK'da metot yoktur → `UNAVAILABLE`.
 */
export async function refreshPollCost(): Promise<PollCostSnapshot> {
  try {
    /* Web/demo modunda native yok; eski APK'da metot yok — ikisi de ÖLÇÜLEMEDİ. */
    if (!Capacitor.isNativePlatform() || !CarLauncher.getObdPollCost) {
      _cache = { ...EMPTY_POLL_COST, readAt: Date.now() };
      _refreshedAt = Date.now();
      return _cache;
    }
    const raw = await CarLauncher.getObdPollCost();
    _cache = normalizePollCost(raw, Date.now());
    _refreshedAt = Date.now();
    return _cache;
  } catch {
    /* Köprü düştü → "maliyet yok" DEĞİL, "ölçülemedi". */
    _cache = { ...EMPTY_POLL_COST, readAt: Date.now() };
    _refreshedAt = Date.now();
    return _cache;
  }
}

/** Son okunan anlık görüntü (senkron — kopya/LAB yolu senkrondur). */
export function getPollCostSnapshot(): PollCostSnapshot {
  return _cache;
}

/** Önbelleğin tazelendiği an; `null` = hiç okunmadı. */
export function getPollCostRefreshedAt(): number | null {
  return _refreshedAt;
}

/** Test yardımcısı — modül durumunu sıfırlar. */
export function _resetPollCostForTest(): void {
  _cache = EMPTY_POLL_COST;
  _refreshedAt = null;
}
