/**
 * batteryEvidenceSource.ts — CİHAZDA KANIT ÜRETİMİ (kütük #490 · ADR-286 Adım 3/1).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE YAPAR ─────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * OBD'den gelen akü/sistem voltajını `ai_evidence` biçiminde **yerel kanıda**
 * çevirir. Bugüne kadar cihazda kanıt üreten hiçbir ürün kodu yoktu (#286/#490);
 * kanıt omurgası yalnız sunucuda yaşıyordu ve motor beslenmiyordu.
 *
 * ⚠️ **HÜKÜM ÜRETMEZ.** Bu parça yalnız kanıt üretir. `maviReasoningEngine`i
 * bağlamak ADR-286 Adım 3'ün İKİNCİ parçasıdır ve burada YAPILMAZ.
 *
 * ── AĞ YOK VARSAYIMI ──────────────────────────────────────────────────────
 * Hiçbir ağ çağrısı yoktur. Buluta yazma bu parçanın kapsamı DIŞINDADIR.
 * Kanıt yerelde yaşar; ağ olmadan da üretilir ve okunur.
 *
 * ── ZERO-LEAK ─────────────────────────────────────────────────────────────
 * Kendi `setInterval`i YOKTUR. Üretim OBD olayına biner: örnek eklenir ve
 * yeterli süre geçtiyse aynı çağrıda karar verilir. `start` bir `cleanup`
 * döndürür; abonelik orada bırakılır.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Kanıt yalnız metrik adı ve sayısal voltaj taşır. VIN · plaka · konum ·
 * sürücü kimliği YOKTUR ve bu dosyada üretilemez.
 */

import { onOBDData, getOBDDataSnapshot } from '../obdService';
import { validateEvidenceInput } from './core/evidenceInputGuard';
import {
  decideBatteryEvidence, BATTERY_EVIDENCE_POLICY_VERSION,
  CONSISTENCY_WINDOW_MS,
  type VoltageSample, type BatterySkipReason,
} from './core/batteryEvidenceModel';
import {
  EVIDENCE_VERSION, deriveEvidenceConfidence, type AiEvidence,
} from '../fleet/aiEvidence';

/* ── Sabitler ──────────────────────────────────────────────────────────── */

/** Kanıt üretim aralığı — tutarlılık penceresiyle aynı; daha sık üretmek
 *  aynı okumaları tekrar tekrar kanıtlamak olurdu. */
const PRODUCE_INTERVAL_MS = CONSISTENCY_WINDOW_MS;
/** Örnek halkası — pencereyi besleyecek kadar, fazlası bellek israfı. */
const SAMPLE_RING = 32;
/** Yerel kanıt halkası. Sınırsız defter cihazda depolama sorunudur. */
const EVIDENCE_RING = 64;
/** Kanıt ömrü — süresiz kanıt YOKTUR (omurga sözleşmesi). */
const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;

/** Cihaz kanıtının öznesi. Yerelde tek araç vardır; kiracı kavramı YOKTUR. */
const LOCAL_COMPANY_ID = 'local-device';
const LOCAL_VEHICLE_ID = 'local-vehicle';

/* ── Durum ─────────────────────────────────────────────────────────────── */

const _samples: VoltageSample[] = [];
const _evidence: AiEvidence[] = [];
let _lastProducedAtMs = 0;
let _unsub: (() => void) | null = null;
let _seq = 0;

/**
 * Kanıt YAZILDIKTAN sonra tetiklenen dinleyiciler.
 *
 * ⚠️ Hüküm üretimi neden buraya bağlanır: OBD akışı hot-path'tir (saniyede
 * birkaç paket), kanıt üretimi ise `PRODUCE_INTERVAL_MS` kapısıyla seyrektir.
 * Hükmü OBD olayına bağlamak onu hot-path'e sokardı (#283 kesişim kuralı:
 * hüküm üretimi sürüş hot-path'inde KOŞMAZ). Kanıda bağlamak, hükmün tam
 * olarak kanıt kadar sık üretilmesini garanti eder.
 */
const _listeners: Array<() => void> = [];

/** Kanıt üretildiğinde haber ver. Dönen fonksiyon aboneliği bırakır. */
export function onBatteryEvidenceProduced(fn: () => void): () => void {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

const _stats = {
  samplesSeen: 0,
  produced: 0,
  rejectedByGuard: 0,
  skipped: 0,
  bySkipReason: {} as Record<string, number>,
  bySeverity: {} as Record<string, number>,
  lastProducedAtMs: null as number | null,
  lastSkipReason: null as BatterySkipReason | null,
};

export interface BatteryEvidenceStats {
  readonly samplesSeen: number;
  readonly produced: number;
  readonly rejectedByGuard: number;
  readonly skipped: number;
  readonly bySkipReason: Readonly<Record<string, number>>;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly lastProducedAtMs: number | null;
  readonly lastSkipReason: BatterySkipReason | null;
  readonly ledgerSize: number;
  readonly policyVersion: string;
}

/** CAROS LAB okuma ucu — senkron, yan etkisiz, salt-okunur kopya. */
export function readBatteryEvidenceStats(): BatteryEvidenceStats {
  return {
    samplesSeen: _stats.samplesSeen,
    produced: _stats.produced,
    rejectedByGuard: _stats.rejectedByGuard,
    skipped: _stats.skipped,
    bySkipReason: { ..._stats.bySkipReason },
    bySeverity: { ..._stats.bySeverity },
    lastProducedAtMs: _stats.lastProducedAtMs,
    lastSkipReason: _stats.lastSkipReason,
    ledgerSize: _evidence.length,
    policyVersion: BATTERY_EVIDENCE_POLICY_VERSION,
  };
}

/** Yerel kanıt defteri — salt-okunur kopya (motor bağlanınca girdisi olacak). */
export function readLocalBatteryEvidence(): readonly AiEvidence[] {
  return _evidence.slice();
}

/* ── Üretim ────────────────────────────────────────────────────────────── */

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Bir voltaj örneği kaydeder ve gerekiyorsa kanıt üretir.
 *
 * Dışa açıktır çünkü testler zamanı kontrol etmek zorundadır; ürün yolunda
 * `startBatteryEvidenceSource` çağırır.
 */
export function ingestVoltageSample(
  voltage: number, rpm: number, nowMs: number,
): void {
  /* Voltaj gelmiyorsa ÖRNEK BİLE YAZILMAZ — "0 V ölçtük" demek uydurmaktır. */
  if (!Number.isFinite(voltage)) return;

  _stats.samplesSeen++;
  _samples.push({ voltage, rpm, atMs: nowMs });
  if (_samples.length > SAMPLE_RING) _samples.splice(0, _samples.length - SAMPLE_RING);

  if (nowMs - _lastProducedAtMs < PRODUCE_INTERVAL_MS) return;

  const decision = decideBatteryEvidence(_samples, nowMs);
  if (!decision.produce) {
    _stats.skipped++;
    _stats.lastSkipReason = decision.reason;
    bump(_stats.bySkipReason, decision.reason);
    /* Atlama da bir sonuçtur: pencere kapanır, aksi hâlde her OBD paketinde
       yeniden denenip sayaç şişerdi. */
    _lastProducedAtMs = nowMs;
    return;
  }

  const candidate: AiEvidence = {
    id: `bat-${nowMs}-${_seq++}`,
    companyId: LOCAL_COMPANY_ID,
    vehicleId: LOCAL_VEHICLE_ID,
    driverId: null,
    tripId: null,
    source: 'TELEMETRY',          // canlı telemetri — BLACKBOX demek yanlış olurdu
    category: 'BATTERY',
    severity: decision.severity,
    /* ── GÜVEN TÜRETİLİR, YAZILMAZ ─────────────────────────────────────────
       Sunucuda bunu `_ai_evidence_write_guard` trigger'ı yapar; CİHAZDA öyle
       bir kapı YOKTUR. Bu yüzden omurganın TEK güven fonksiyonu burada
       çağrılır — formül yeniden yazılmaz, ikinci otorite doğmaz.
       Yer tutucu `UNKNOWN` bırakmak, tüm kanıtların güvenini bilinmez yapar
       ve motor haklı olarak `EVIDENCE_UNKNOWN_CONFIDENCE` hükmü verirdi. */
    confidence: deriveEvidenceConfidence({
      source: 'TELEMETRY', provenance: 'MEASURED', sampleCount: decision.sampleCount,
    }),
    provenance: 'MEASURED',       // adaptör gerçekten ölçüyor, türetme yok
    metric: decision.metric,
    value: decision.value,
    sampleCount: decision.sampleCount,
    createdAt: nowMs,
    lastSeenAt: nowMs,
    expiresAt: nowMs + EVIDENCE_TTL_MS,
    state: 'ACTIVE',
    refreshCount: 0,
    evidenceVersion: EVIDENCE_VERSION,
    rejectReason: null,
  };

  /* ── GİRDİ KAPISI ZORUNLU (#497 madde 2) ────────────────────────────────
     Kendi ürettiğimiz kanıt bile kapıdan geçer: enum sürüklenmesi burada da
     olabilir (ör. `EvidenceSeverity` değişir, model eski değeri üretir).
     Reddedilen SAYILIR — sessizce yutulmaz. */
  const guard = validateEvidenceInput(candidate, nowMs);
  if (!guard.accepted) {
    _stats.rejectedByGuard++;
    _lastProducedAtMs = nowMs;
    return;
  }

  /* ── AYNI METRİĞİN ESKİ KAYDI YERİNE GEÇİLİR (SUPERSEDED) ───────────────
     Bunu yapmazsak aynı metrik için birden çok AKTİF kanıt birikir ve motor
     bunu haklı olarak ÇELİŞKİ sayar (`REVISION_DIVERGENCE`: aynı kaynağın iki
     revizyonu birden aktif) → sağlıklı araçta bile `CONFLICTED_EVIDENCE`
     çıkardı. Kanıt SİLİNMEZ, `SUPERSEDED` olur: karar sonradan "neye
     dayanıyordun" sorusuna cevap verebilmelidir. */
  for (let i = 0; i < _evidence.length; i++) {
    const e = _evidence[i]!;
    if (e.state === 'ACTIVE' && e.metric === candidate.metric && e.source === candidate.source) {
      _evidence[i] = { ...e, state: 'SUPERSEDED' };
    }
  }

  _evidence.push(candidate);
  if (_evidence.length > EVIDENCE_RING) {
    _evidence.splice(0, _evidence.length - EVIDENCE_RING);
  }
  _stats.produced++;
  _stats.lastProducedAtMs = nowMs;
  bump(_stats.bySeverity, decision.severity);
  _lastProducedAtMs = nowMs;

  /* Dinleyici hatası kanıt üretimini DÜŞÜREMEZ: kanıt zaten yazıldı, hüküm
     üretilemezse hüküm yok demektir — kanıt kaybolmaz. */
  for (const fn of _listeners.slice()) {
    try { fn(); } catch { /* fail-soft */ }
  }
}

/**
 * OBD akışına bağlanır. Kendi timer'ı YOKTUR — üretim OBD olayına biner.
 * Dönen `cleanup` aboneliği bırakır (zero-leak).
 */
export function startBatteryEvidenceSource(): () => void {
  if (_unsub !== null) return _unsub;          // çift başlatma güvenli

  const off = onOBDData(() => {
    try {
      const snap = getOBDDataSnapshot();
      const v = snap.batteryVoltage;
      /* Voltaj YOKSA hiçbir şey yapılmaz — varsayılan/sahte örnek yazılmaz. */
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      ingestVoltageSample(v, typeof snap.rpm === 'number' ? snap.rpm : -1, Date.now());
    } catch {
      /* fail-soft: kanıt üretimi düşse bile OBD akışı ve ürün çalışmaya devam
         eder. Kanıt yoksa hüküm de yoktur — sessiz sağlıklı iddiası doğmaz. */
    }
  });

  _unsub = () => { try { off(); } catch { /* ignore */ } _unsub = null; };
  return _unsub;
}

export function stopBatteryEvidenceSource(): void {
  if (_unsub !== null) _unsub();
}

/** Yalnız testler için — durum ve sayaçları sıfırlar. */
export function _resetBatteryEvidenceForTest(): void {
  _listeners.length = 0;
  _samples.length = 0;
  _evidence.length = 0;
  _lastProducedAtMs = 0;
  _seq = 0;
  _stats.samplesSeen = 0;
  _stats.produced = 0;
  _stats.rejectedByGuard = 0;
  _stats.skipped = 0;
  _stats.bySkipReason = {};
  _stats.bySeverity = {};
  _stats.lastProducedAtMs = null;
  _stats.lastSkipReason = null;
}
