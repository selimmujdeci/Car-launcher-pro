/**
 * batteryVerdictService.ts — `maviReasoningEngine`in İLK ÜRETİM BAĞLANTISI.
 * (ADR-286 Adım 3/2 · kütük #490)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE DEĞİŞTİ ────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `maviReasoningEngine` 751 satırdı, testleri yeşildi ve **hiçbir ürün
 * çağıranı yoktu** — ölü koddu. Bu dosya onu ilk kez üretim yoluna bağlar:
 * cihazda üretilen yerel akü kanıdı → motor → hüküm.
 *
 * ── MOTORUN KURALINA DOKUNULMAZ ───────────────────────────────────────────
 * Burada karar mantığı YOKTUR: eşik, oran, güven, sıra — hiçbiri. Bu dosya
 * yalnız GİRDİ toplar ve ÇIKTIYI saklar. İkinci bir karar otoritesi doğarsa
 * TS↔SQL paritesi (#488) kırılır. Kilit: bu dosyada `severity`/`confidence`
 * hesabı aranır ve bulunursa test düşer.
 *
 * ── KAPSAM: AKÜ, ARAÇ DEĞİL (ŞART 4 · seçenek a) ──────────────────────────
 * Niyet `BATTERY`'dir, `VEHICLE_HEALTH` DEĞİL. Sebep: `categoriesForIntent`
 * `BATTERY` için tek kategori bekler → kapsam **1/1 tam** → *"akü sağlığı
 * SUPPORTED"* dürüst bir cümledir. `VEHICLE_HEALTH` beş kategori bekler; tek
 * sinyalle olumlu hüküm vermek kullanıcıya *"araç sağlıklı"* diye ulaşırdı ve
 * bu **sahte veri** olurdu. Olumsuz hüküm serbesttir; **olumlu haber kapsam
 * ister.**
 *
 * ── HOT-PATH DOKUNULMAZLIĞI (#283 kesişimi) ───────────────────────────────
 * Hüküm üretimi sürüş hot-path'inde KOŞMAZ. Tetikleyici OBD paketi değil,
 * **kanıt üretimi** olayıdır (20 sn'de bir kapılı). Kendi timer'ı yoktur.
 * Safety katmanı bir hükme bakacaksa `readBatteryVerdict()` ile **önbellekten**
 * okur; hüküm senkron hesaplanmaz.
 *
 * ── AĞ YOK ────────────────────────────────────────────────────────────────
 * Hiçbir ağ çağrısı yoktur; buluta yazma kapsam DIŞIDIR. Hüküm yerelde doğar,
 * yerelde okunur.
 */

import { reason } from './maviReasoningEngine';
import {
  readLocalBatteryEvidence, onBatteryEvidenceProduced,
} from './batteryEvidenceSource';
import type { MaviReasoning } from './maviReasoning';
import type { EvidenceLedger } from '../fleet/aiEvidenceEngine';

/** Politika sürümü — TTL/tetikleme değişirse yükselir, LAB'da görünür. */
export const BATTERY_VERDICT_POLICY_VERSION = 'BVD-2026.08.09' as const;

/**
 * Hüküm ömrü — **15 dakika**.
 *
 * Kanıt 24 saat yaşar (uzun ömürlü KAYIT), ama hüküm anlık durumun
 * YORUMUDUR: 15 dakika içinde motor durmuş, çalışmış, yük değişmiş olabilir.
 * Kanıt TTL'ini hükme vermek "son bilinen iyi hükmü" bir gün boyunca taşımak
 * olurdu — tam da yasaklanan şey. Süre dolduğunda hüküm **düşer**, en son
 * hüküm sunulmaz.
 */
export const VERDICT_TTL_MS = 15 * 60 * 1000;

const LOCAL_COMPANY_ID = 'local-device';
const LOCAL_VEHICLE_ID = 'local-vehicle';

/* ── Durum ─────────────────────────────────────────────────────────────── */

let _verdict: MaviReasoning | null = null;
let _verdictAtMs = 0;
let _unsub: (() => void) | null = null;

const _stats = {
  produced: 0,
  byDecision: {} as Record<string, number>,
  byConfidence: {} as Record<string, number>,
  byReason: {} as Record<string, number>,
  lastAtMs: null as number | null,
  expiredDrops: 0,
};

export interface BatteryVerdictStats {
  readonly produced: number;
  readonly byDecision: Readonly<Record<string, number>>;
  readonly byConfidence: Readonly<Record<string, number>>;
  readonly byReason: Readonly<Record<string, number>>;
  readonly lastAtMs: number | null;
  /** TTL dolduğu için kaç kez hüküm düşürüldü. */
  readonly expiredDrops: number;
  readonly ttlMs: number;
  readonly policyVersion: string;
}

export interface BatteryVerdictView {
  readonly decision: string;
  readonly confidence: string;
  readonly confidenceReason: string;
  readonly evidenceCount: number;
  readonly producedAtMs: number;
  /** Kapsam etiketi — ürün kuralı, gizlenmez. */
  readonly scope: 'BATTERY_ONLY';
}

function bump(m: Record<string, number>, k: string): void { m[k] = (m[k] ?? 0) + 1; }

/**
 * Geçerli hükmü döndürür — **TTL dolduysa `null`**.
 *
 * ⚠️ "Son bilinen iyi hüküm" sonsuza kadar taşınmaz: bayat hüküm, hüküm
 * değildir. Okuma anında süre kontrol edilir; düşen hüküm SAYILIR.
 */
export function readBatteryVerdict(nowMs: number = Date.now()): BatteryVerdictView | null {
  if (_verdict === null) return null;
  if (nowMs - _verdictAtMs > VERDICT_TTL_MS) {
    _verdict = null;
    _stats.expiredDrops++;
    return null;
  }
  return {
    decision: _verdict.decision,
    confidence: _verdict.confidence,
    confidenceReason: _verdict.confidenceReason,
    evidenceCount: _verdict.evidenceIds.length,
    producedAtMs: _verdictAtMs,
    scope: 'BATTERY_ONLY',
  };
}

export function readBatteryVerdictStats(): BatteryVerdictStats {
  return {
    produced: _stats.produced,
    byDecision: { ..._stats.byDecision },
    byConfidence: { ..._stats.byConfidence },
    byReason: { ..._stats.byReason },
    lastAtMs: _stats.lastAtMs,
    expiredDrops: _stats.expiredDrops,
    ttlMs: VERDICT_TTL_MS,
    policyVersion: BATTERY_VERDICT_POLICY_VERSION,
  };
}

/**
 * Yerel kanıttan hüküm üretir.
 *
 * Dışa açıktır çünkü testler zamanı kontrol etmek zorundadır; ürün yolunda
 * kanıt üretimi olayı çağırır.
 */
export function produceBatteryVerdict(nowMs: number = Date.now()): void {
  const entries = readLocalBatteryEvidence();

  /* ── FAIL-CLOSED ───────────────────────────────────────────────────────
     Kanıt yoksa motor ÇAĞRILMAZ. Çağrılsaydı `INSUFFICIENT_EVIDENCE` hükmü
     üretilirdi ve bu "değerlendirdik, yetersiz" demektir; oysa gerçek
     "hiç kanıt gelmedi"dir. İkisi ayrı şeydir — bir tanesi bile kanıt
     olmadan hüküm kaydı açmayız. */
  if (entries.length === 0) return;

  /* Motorun beklediği defter şekli. Cihazda adaptör durumu ve zincir yoktur;
     boş bırakılır — uydurulmaz. */
  const ledger: EvidenceLedger = {
    entries, mergeCount: 0, rejectedCount: 0, chain: [],
  };

  const out = reason(ledger, {
    subject: { companyId: LOCAL_COMPANY_ID, vehicleId: LOCAL_VEHICLE_ID },
    /* Niyet AÇIKÇA verilir. Türetmeye bırakmak, defterde başka kategori
       belirdiği gün hükmün sessizce başka bir şeye dönüşmesi demekti. */
    requestedIntent: 'BATTERY',
    observedAt: nowMs,
    ttlMs: VERDICT_TTL_MS,
  });

  _verdict = out.reasoning;
  _verdictAtMs = nowMs;
  _stats.produced++;
  _stats.lastAtMs = nowMs;
  bump(_stats.byDecision, out.reasoning.decision);
  bump(_stats.byConfidence, out.reasoning.confidence);
  bump(_stats.byReason, out.reasoning.confidenceReason);
}

/** Kanıt üretimine abone olur. Kendi timer'ı YOKTUR. */
export function startBatteryVerdictService(): () => void {
  if (_unsub !== null) return _unsub;
  const off = onBatteryEvidenceProduced(() => {
    try { produceBatteryVerdict(Date.now()); } catch { /* fail-soft: hüküm yoksa hüküm yok */ }
  });
  _unsub = () => { try { off(); } catch { /* ignore */ } _unsub = null; };
  return _unsub;
}

export function stopBatteryVerdictService(): void {
  if (_unsub !== null) _unsub();
}

/** Yalnız testler için. */
export function _resetBatteryVerdictForTest(): void {
  _verdict = null;
  _verdictAtMs = 0;
  _stats.produced = 0;
  _stats.byDecision = {};
  _stats.byConfidence = {};
  _stats.byReason = {};
  _stats.lastAtMs = null;
  _stats.expiredDrops = 0;
}
