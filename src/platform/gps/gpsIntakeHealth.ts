/**
 * gpsIntakeHealth — GPS ALIM SAĞLIĞI (saha 2026-08-05 · kütük #401 · #406 · #423).
 *
 * NEDEN VAR: Konya→Tarsus koşumunda (399 örnek / 420 s / gerçek sürüş, 94 km/h)
 * ölçülen en ağır kusur, konumun **medyanda 19,5 saniye bayat** olmasıydı
 * (94 km/h'de ~509 m körlük; fix > 10 s oranı %61). Aynı oturumda konsolda
 * `[GPS] JumpGuard: atlama reddedildi` 30+ kez göründü (accuracy 500 m – 3 800 m)
 * ve doğruluk p95 7 578 m ölçüldü. Yani sistem çöp fix'leri DOĞRU eliyordu ama:
 *   1. kaç fix'in elendiği ve NEDEN elendiği hiçbir yerde SAYILMIYORDU (yalnız console),
 *   2. tüketiciler (navigasyon, off-route, ETA) ellerindeki konumun BAYAT olduğunu
 *      bilmiyor, taze veriymiş gibi karar veriyordu.
 *
 * Bu modül ikinci maddeyi çözer ve birincisini ölçülebilir kılar.
 * SAF: I/O yok, timer yok, React yok, global durum yalnız kendi ring buffer'ı.
 * `Date.now()` çağırmaz — zaman DIŞARIDAN verilir (test edilebilirlik + saat sıçraması).
 */

/** Bir fix'in neden kabul edilmediği — "sessiz kayıp" bırakmamak için. */
export type GpsRejectReason =
  | 'JUMP_GUARD'      // accuracy kötü VE sıçrama > eşik (fusionCore.isJumpInvalid)
  | 'INVALID_COORDS'  // NaN/Infinity koordinat
  | 'THROTTLED';      // örnekleme throttle'ı — kayıp değil, bilinçli seyreltme

/**
 * Konumun kullanılabilirlik sınıfı.
 *
 * Eşikler 94 km/h (ölçülen medyan hız) üzerinden seçildi:
 *   FRESH ≤ 3 s   → ≤ ~78 m belirsizlik: şerit değil ama manevra seviyesinde kullanılabilir.
 *   STALE ≤ 15 s  → ~390 m: karar verilebilir ama KARARIN GÜVENİ DÜŞÜKTÜR.
 *   DEAD  > 15 s  → konum artık aracın yerini temsil etmiyor.
 */
export type GpsFreshness = 'FRESH' | 'STALE' | 'DEAD' | 'UNKNOWN';

export const FRESH_MAX_MS = 3_000;
export const STALE_MAX_MS = 15_000;

/** Son N kabul edilen fix üzerinden istatistik — sabit boyut (zero-alloc hot path). */
const RING = 64;

const _gapMs    = new Float64Array(RING);   // kabul edilen fix'ler arası ms
const _accuracy = new Float64Array(RING);   // kabul edilen fix'lerin doğruluğu (m)
let   _ringLen  = 0;                        // dolu eleman sayısı (≤ RING)
let   _ringIdx  = 0;                        // sıradaki yazma konumu

let _arrivals = 0;
let _accepted = 0;
const _rejected: Record<GpsRejectReason, number> = {
  JUMP_GUARD: 0, INVALID_COORDS: 0, THROTTLED: 0,
};
let _lastArrivalTs:  number | null = null;
let _lastAcceptedTs: number | null = null;
let _worstAccuracyM: number | null = null;
/** Ardışık red serisi — "GPS şu an kör" kararının kanıtı. */
let _rejectStreak = 0;
let _maxRejectStreak = 0;

export interface GpsIntakeSnapshot {
  /** handlePosition'a ULAŞAN fix sayısı (kabul edilsin ya da edilmesin). */
  arrivals: number;
  /** Store'a yazılan (konumu gerçekten güncelleyen) fix sayısı. */
  accepted: number;
  /** Neden bazında elenen fix sayıları. */
  rejected: Readonly<Record<GpsRejectReason, number>>;
  /** Kabul oranı 0..1, hiç varış yoksa null (sahte 1.0 üretilmez). */
  acceptRatio: number | null;
  lastArrivalTs:  number | null;
  lastAcceptedTs: number | null;
  /** Kabul edilen fix'ler arası aralık (ms) — p50 / max. Örnek yoksa null. */
  gapMsP50: number | null;
  gapMsMax: number | null;
  /** Kabul edilen fix doğruluğu (m) — p50 / p95. Örnek yoksa null. */
  accuracyP50: number | null;
  accuracyP95: number | null;
  /** Görülen en kötü doğruluk (reddedilenler DAHİL) — çöp fix kanıtı. */
  worstAccuracyM: number | null;
  /** En uzun ardışık red serisi. */
  maxRejectStreak: number;
  /** Şu anki ardışık red serisi. */
  rejectStreak: number;
}

/** Fix hattına bir paket ULAŞTI (kabul kararından ÖNCE çağrılır). */
export function noteArrival(nowMs: number): void {
  _arrivals++;
  _lastArrivalTs = nowMs;
}

/** Fix KABUL EDİLDİ ve konumu güncelledi. */
export function noteAccepted(nowMs: number, accuracyM: number | null): void {
  if (_lastAcceptedTs != null) {
    const gap = nowMs - _lastAcceptedTs;
    // Saat geriye sıçrarsa (batarya kopması/NTP) negatif aralık kaydedilmez.
    if (gap >= 0) {
      _gapMs[_ringIdx]    = gap;
      _accuracy[_ringIdx] = Number.isFinite(accuracyM ?? NaN) ? (accuracyM as number) : NaN;
      _ringIdx = (_ringIdx + 1) % RING;
      if (_ringLen < RING) _ringLen++;
    }
  }
  _accepted++;
  _lastAcceptedTs = nowMs;
  _rejectStreak = 0;
  if (Number.isFinite(accuracyM ?? NaN)) _noteWorst(accuracyM as number);
}

/** Fix ELENDİ — neden bilgisiyle. */
export function noteRejected(reason: GpsRejectReason, accuracyM: number | null): void {
  _rejected[reason]++;
  // THROTTLED bilinçli seyreltmedir, "körlük" serisi sayılmaz.
  if (reason !== 'THROTTLED') {
    _rejectStreak++;
    if (_rejectStreak > _maxRejectStreak) _maxRejectStreak = _rejectStreak;
  }
  if (Number.isFinite(accuracyM ?? NaN)) _noteWorst(accuracyM as number);
}

function _noteWorst(a: number): void {
  if (_worstAccuracyM == null || a > _worstAccuracyM) _worstAccuracyM = a;
}

/** Salt-okunur anlık görüntü — LAB ve tanı yüzeyleri için. */
export function getGpsIntakeSnapshot(): GpsIntakeSnapshot {
  return {
    arrivals: _arrivals,
    accepted: _accepted,
    rejected: { ..._rejected },
    acceptRatio: _arrivals > 0 ? _accepted / _arrivals : null,
    lastArrivalTs:  _lastArrivalTs,
    lastAcceptedTs: _lastAcceptedTs,
    gapMsP50:    _percentile(_gapMs, 0.50),
    gapMsMax:    _percentile(_gapMs, 1.00),
    accuracyP50: _percentile(_accuracy, 0.50),
    accuracyP95: _percentile(_accuracy, 0.95),
    worstAccuracyM: _worstAccuracyM,
    maxRejectStreak: _maxRejectStreak,
    rejectStreak: _rejectStreak,
  };
}

function _percentile(buf: Float64Array, q: number): number | null {
  if (_ringLen === 0) return null;
  const vals: number[] = [];
  for (let i = 0; i < _ringLen; i++) {
    const v = buf[i]!;
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const idx = Math.min(vals.length - 1, Math.max(0, Math.ceil(q * vals.length) - 1));
  return vals[idx]!;
}

/**
 * Konum tazeliği sınıfı. `fixTs` yoksa UNKNOWN — "taze" VARSAYILMAZ.
 * Bu ayrım #401'in ürün etkisidir: bayat konumla alınan off-route/ETA kararı,
 * karar gibi görünen bir tahmindir.
 */
export function classifyFreshness(fixTs: number | null | undefined, nowMs: number): GpsFreshness {
  if (fixTs == null || !Number.isFinite(fixTs)) return 'UNKNOWN';
  const age = nowMs - fixTs;
  if (age < 0) return 'UNKNOWN';          // saat sıçraması — iddia etme
  if (age <= FRESH_MAX_MS) return 'FRESH';
  if (age <= STALE_MAX_MS) return 'STALE';
  return 'DEAD';
}

/** Test/oturum sıfırlama — üretimde yalnız GPS izleme yeniden başlarken çağrılır. */
export function resetGpsIntakeHealth(): void {
  _gapMs.fill(0); _accuracy.fill(0);
  _ringLen = 0; _ringIdx = 0;
  _arrivals = 0; _accepted = 0;
  _rejected.JUMP_GUARD = 0; _rejected.INVALID_COORDS = 0; _rejected.THROTTLED = 0;
  _lastArrivalTs = null; _lastAcceptedTs = null; _worstAccuracyM = null;
  _rejectStreak = 0; _maxRejectStreak = 0;
}
