/**
 * routeRationaleModel.ts — NAV v3 · L4 · "NEDEN BU ROTA?" HESAP VEREBİLİRLİĞİ (F7).
 *
 * Belge: `NAVIGATION_ARCHITECTURE_SPEC_v2.md` §5.5 (`RouteRationale` — ZORUNLU) ·
 * `CAROS-NAV-ARCH-SPEC-3.0` §F7 · CLAUDE.md §GÖZLEMLENEBİLİRLİK · §CROSS-DOMAIN 1/14.
 *
 * SAF (kurucu): I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * ağ YOK. Defter bölümü (§4) modül durumu tutar — `routeProviderLedger` ile
 * BİREBİR aynı desen; saat/ağ yine YOKTUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLMÜŞ GERÇEK: SEÇİM VAR, GEREKÇE YOK (2026-09-04, kod okundu) ──────
 * ══════════════════════════════════════════════════════════════════════════
 * `routingService.fetchRoute` uzak sağlayıcıdan `alternatives=3` ister; ana
 * rota + alternatifler DOĞRULANIR ve `pickBestRoute` bunlar arasından birini
 * AKTİF ROTA yapar (`routingService.ts` → "ROTA DOĞRULUK KAPISI").
 *
 * Sıralama anahtarı `routeRankKey` = `[failCount, warnCount, durationS]`.
 * **Süre ÜÇÜNCÜ ölçüttür:** bir uyarısı daha az olan aday, YİRMİ DAKİKA daha
 * yavaş olsa bile kazanır. Bugün bu takas hiçbir yerde KAYITLI DEĞİLDİR —
 * yalnız `picked.index !== 0` iken bir `console.warn` düşer, o kadar.
 *
 * Sonuç: sistem sürücü adına bir takas yapıyor ve **"neden?" sorusunun cevabı
 * yok.** v2 §5.5'in ifadesiyle: *"Cevabı olmayan zekâ, kullanıcı için
 * arızadır."* Bu dosya o cevabı üretir.
 *
 * ── BU DOSYA NE YAPMAZ (pazarlıksız) ─────────────────────────────────────
 *  · **KARAR VERMEZ.** Rotayı seçen `pickBestRoute`tur ve öyle KALIR. Burada
 *    üretilen hiçbir değer seçime geri BESLENMEZ (ikinci otorite yasağı).
 *  · **YENİDEN SIRALAMAZ.** Anahtar `routeValidationModel.routeRankKey`ten
 *    OKUNUR; ikinci kopya YOKTUR. Seçim anahtarla çelişiyorsa hüküm
 *    `UNKNOWN`tır — uydurma açıklama üretilmez (fail-closed).
 *  · **KOORDİNAT/HEDEF TAŞIMAZ.** Geometri, başlangıç, hedef, adres, isim
 *    buraya GİRMEZ; yalnız sayılar ve denetim kimlikleri (gizlilik kuralı).
 *  · **SAHTE 0 ÜRETMEZ.** Ölçülemeyen mesafe/süre `null`dır.
 */

import type {
  RouteCandidate, RouteValidationResult, RouteVerdict,
} from './routeValidationModel';
import { routeRankKey } from './routeValidationModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM SÖZLÜĞÜ — GERÇEK karar fonksiyonundan türetildi
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Seçimi belirleyen etken.
 *
 * ⚠️ Bu sözlük v2 §5.5'in araç-maliyet sözlüğü (`VEHICLE_THERMAL` ·
 * `VEHICLE_RANGE` · `DRIVER_PREF` …) DEĞİLDİR ve olamaz: o değerler maliyet
 * çarpanlarını gerektirir, çarpan motoru bu binary'de YOKTUR (F7 kapsamı
 * dışı). Kaynağı olmayan etken UYDURULMAZ; sözlük bugünkü GERÇEK karar
 * fonksiyonunun (`routeRankKey`) bileşenlerinden türetilmiştir.
 */
export type RouteDecidingFactor =
  /** Kabul edilen tek aday vardı — takas YAPILMADI. */
  | 'ONLY_OPTION'
  /** Daha AZ ağır kusur (`failCount`) belirledi. */
  | 'VALIDATION_FAIL'
  /** Kusur eşitti; daha AZ uyarı (`warnCount`) belirledi. */
  | 'VALIDATION_WARN'
  /** Kusur ve uyarı eşitti; daha KISA süre belirledi. */
  | 'DURATION'
  /** Üç ölçüt de eşitti → sağlayıcının SIRASI belirledi (gerçek bir tercih değil). */
  | 'TIE_PROVIDER_ORDER'
  /** Aktif rotayı KULLANICI seçti (alternatif dokunuşu) — sistem seçmedi. */
  | 'USER_SELECTED'
  /** Hiçbir aday kabul edilmedi — rota YOK. */
  | 'NO_CANDIDATE'
  /**
   * Seçim, sıralama anahtarıyla AÇIKLANAMADI. Bu bir kusur bildirimidir:
   * ya karar fonksiyonu değişti ve açıklayıcı ona bağlanmadı, ya da seçim
   * anahtar dışında bir yerden geldi. **Uydurma gerekçe yerine "bilmiyorum".**
   */
  | 'UNKNOWN';

export const ROUTE_DECIDING_FACTORS: readonly RouteDecidingFactor[] = [
  'ONLY_OPTION', 'VALIDATION_FAIL', 'VALIDATION_WARN', 'DURATION',
  'TIE_PROVIDER_ORDER', 'USER_SELECTED', 'NO_CANDIDATE', 'UNKNOWN',
] as const;

export const ROUTE_DECIDING_FACTOR_LABEL:
  Readonly<Record<RouteDecidingFactor, string>> = Object.freeze({
    ONLY_OPTION:        'tek seçenek',
    VALIDATION_FAIL:    'daha az ağır kusur',
    VALIDATION_WARN:    'daha az uyarı',
    DURATION:           'daha kısa süre',
    TIE_PROVIDER_ORDER: 'eşitlik — sağlayıcı sırası',
    USER_SELECTED:      'kullanıcı seçti',
    NO_CANDIDATE:       'kabul edilen aday yok',
    UNKNOWN:            'açıklanamadı',
  });

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek adayın özeti. **Geometri/koordinat TAŞIMAZ.** */
export interface RouteCandidateSummary {
  /** Sağlayıcının verdiği sıradaki indeks (0 = sağlayıcının ilk rotası). */
  readonly index: number;
  /** Ölçülemezse `null` — sahte 0 YOK. */
  readonly distanceM: number | null;
  readonly durationS: number | null;
  readonly verdict: RouteVerdict;
  readonly failCount: number;
  readonly warnCount: number;
  /** Düşen denetimlerin kimlikleri (serbest metin DEĞİL, kimlik). */
  readonly failedCheckIds: readonly string[];
  /** Doğrulama kapısından geçti mi (`REJECTED` değil). */
  readonly accepted: boolean;
}

export interface RouteRationale {
  /** Aktif rota olan adayın indeksi; hiçbiri seçilmediyse `null`. */
  readonly chosenIdx: number | null;
  readonly candidates: readonly RouteCandidateSummary[];
  readonly decidingFactor: RouteDecidingFactor;
  /**
   * **F7'nin asıl sayısı:** seçilen rota, kabul edilen EN HIZLI adaydan kaç
   * saniye daha uzun sürüyor. `0` = takas yok. Ölçülemezse `null`.
   *
   * Bu sayı olmadan "doğrulama kapısı sürücüye 20 dakika ödetti mi" sorusu
   * cevaplanamaz — bugün cevaplanamıyor.
   */
  readonly durationPenaltyS: number | null;
  /** Aynı takas oran olarak (`penalty / enHızlı`). Ölçülemezse `null`. */
  readonly durationPenaltyRatio: number | null;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  /** Kararın alındığı sağlayıcı katmanı (`REMOTE_OSRM` · `OFFLINE_GRAPH` …). */
  readonly provider: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KURUCU (SAF)
   ══════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function _summary(
  index: number, candidate: RouteCandidate, validation: RouteValidationResult,
): RouteCandidateSummary {
  const checks = Array.isArray(validation?.checks) ? validation.checks : [];
  return {
    index,
    distanceM: _num(candidate?.distanceM),
    durationS: _num(candidate?.durationS),
    verdict: validation?.verdict ?? 'UNKNOWN',
    failCount: typeof validation?.failCount === 'number' ? validation.failCount : 0,
    warnCount: typeof validation?.warnCount === 'number' ? validation.warnCount : 0,
    failedCheckIds: checks.filter((c) => c.status === 'FAIL').map((c) => c.id),
    accepted: validation?.verdict !== 'REJECTED',
  };
}

/**
 * Seçimin gerekçesini üretir. **SAF ve KARAR VERMEZ.**
 *
 * @param chosenIdx `pickBestRoute`un DÖNDÜRDÜĞÜ indeks. Bu fonksiyon onu
 *        yeniden HESAPLAMAZ; yalnız sıralama anahtarıyla AÇIKLAR. Anahtar
 *        seçimi doğrulamıyorsa hüküm `UNKNOWN` olur (fail-closed).
 */
export function buildRouteRationale(
  results: readonly { candidate: RouteCandidate; validation: RouteValidationResult }[],
  chosenIdx: number | null,
  provider: string,
): RouteRationale {
  const list = Array.isArray(results) ? results : [];
  const candidates = list.map((r, i) => _summary(i, r.candidate, r.validation));
  const acceptedCount = candidates.filter((c) => c.accepted).length;
  const rejectedCount = candidates.length - acceptedCount;

  const base = {
    candidates,
    acceptedCount,
    rejectedCount,
    provider: typeof provider === 'string' ? provider : 'UNKNOWN',
  };

  if (chosenIdx === null || chosenIdx < 0 || chosenIdx >= list.length) {
    return {
      ...base,
      chosenIdx: null,
      decidingFactor: acceptedCount === 0 ? 'NO_CANDIDATE' : 'UNKNOWN',
      durationPenaltyS: null,
      durationPenaltyRatio: null,
    };
  }

  /* ── Süre takası: seçilen ile kabul edilen EN HIZLI aday arasındaki fark ── */
  let fastestS: number | null = null;
  for (const c of candidates) {
    if (!c.accepted || c.durationS === null) continue;
    if (fastestS === null || c.durationS < fastestS) fastestS = c.durationS;
  }
  const chosenS = candidates[chosenIdx].durationS;
  const penaltyS = (chosenS !== null && fastestS !== null)
    ? Math.max(0, Math.round(chosenS - fastestS))
    : null;
  const penaltyRatio = (penaltyS !== null && fastestS !== null && fastestS > 0)
    ? penaltyS / fastestS
    : null;

  /* ── Etken: SEÇİMİ YAPAN anahtarla AÇIKLA (yeniden sıralama YOK) ──────── */
  const chosenKey = routeRankKey(list[chosenIdx].candidate, list[chosenIdx].validation);
  let rivalKey: [number, number, number] | null = null;
  for (let i = 0; i < list.length; i++) {
    if (i === chosenIdx || !candidates[i].accepted) continue;
    const k = routeRankKey(list[i].candidate, list[i].validation);
    if (rivalKey === null || _keyLess(k, rivalKey)) rivalKey = k;
  }

  let factor: RouteDecidingFactor;
  if (!candidates[chosenIdx].accepted) {
    /* Reddedilmiş aday aktif rota OLAMAZ — açıklanacak bir tercih yok. */
    factor = 'UNKNOWN';
  } else if (rivalKey === null) {
    factor = 'ONLY_OPTION';
  } else if (_keyLess(rivalKey, chosenKey)) {
    /* Daha iyi bir aday vardı ama seçilmedi → açıklayıcı ile karar ayrışmış. */
    factor = 'UNKNOWN';
  } else if (chosenKey[0] < rivalKey[0]) {
    factor = 'VALIDATION_FAIL';
  } else if (chosenKey[1] < rivalKey[1]) {
    factor = 'VALIDATION_WARN';
  } else if (chosenKey[2] < rivalKey[2]) {
    factor = 'DURATION';
  } else {
    factor = 'TIE_PROVIDER_ORDER';
  }

  return {
    ...base,
    chosenIdx,
    decidingFactor: factor,
    durationPenaltyS: penaltyS,
    durationPenaltyRatio: penaltyRatio,
  };
}

function _keyLess(a: readonly number[], b: readonly number[]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/**
 * Tek adaylı (seçimsiz) katmanların gerekçesi — yerel daemon · çevrimdışı graf.
 *
 * Bu katmanlar alternatif ÜRETMEZ; dolayısıyla bir takas da yapılmaz. Buna
 * `ONLY_OPTION` demek doğrudur ve `durationPenaltyS = 0`dır (ölçülmüş sıfır,
 * uydurma değil: kabul edilen tek aday hem seçilen hem en hızlıdır).
 */
export function buildSingleCandidateRationale(
  candidate: RouteCandidate, validation: RouteValidationResult, provider: string,
): RouteRationale {
  return buildRouteRationale([{ candidate, validation }], 0, provider);
}

/**
 * Kullanıcının alternatif seçmesi. **Sistem kararı DEĞİLDİR** ve öyle
 * gösterilmemelidir: aktif rota artık bir kullanıcı tercihidir.
 *
 * Süre takası KORUNUR (kullanıcı da bir takas yapmış olabilir) ama etken
 * `USER_SELECTED`e sabitlenir — sıralama anahtarıyla açıklanmaya ÇALIŞILMAZ.
 */
export function asUserSelectedRationale(
  prev: RouteRationale | null, chosenIdx: number,
): RouteRationale {
  const candidates = prev?.candidates ?? [];
  const inRange = chosenIdx >= 0 && chosenIdx < candidates.length;

  let fastestS: number | null = null;
  for (const c of candidates) {
    if (!c.accepted || c.durationS === null) continue;
    if (fastestS === null || c.durationS < fastestS) fastestS = c.durationS;
  }
  const chosenS = inRange ? candidates[chosenIdx].durationS : null;
  const penaltyS = (chosenS !== null && fastestS !== null)
    ? Math.max(0, Math.round(chosenS - fastestS))
    : null;

  return {
    chosenIdx: inRange ? chosenIdx : null,
    candidates,
    decidingFactor: 'USER_SELECTED',
    durationPenaltyS: penaltyS,
    durationPenaltyRatio: (penaltyS !== null && fastestS !== null && fastestS > 0)
      ? penaltyS / fastestS
      : null,
    acceptedCount: prev?.acceptedCount ?? 0,
    rejectedCount: prev?.rejectedCount ?? 0,
    provider: prev?.provider ?? 'UNKNOWN',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) DEFTER — bounded, salt-okunur gözlem (`routeProviderLedger` deseni)
   ══════════════════════════════════════════════════════════════════════════ */

/** Defterde taşınan en fazla gerekçe. Sınırsız büyüme YOK. */
export const ROUTE_RATIONALE_MAX_RECORDS = 8;

export interface RouteRationaleLedgerSnapshot {
  /** En yeni gerekçe; hiç rota kurulmadıysa `null` ("ölçülmedi"). */
  readonly last: RouteRationale | null;
  /** En yeniden eskiye, en fazla `ROUTE_RATIONALE_MAX_RECORDS` kayıt. */
  readonly recent: readonly RouteRationale[];
  /** Toplam kaç seçim kaydedildi. */
  readonly decisions: number;
  /**
   * Doğrulama kapısının sağlayıcının İLK rotasını reddettiği tur sayısı
   * (`chosenIdx > 0`). Sahada "kapı ne sıklıkla devreye giriyor" sorusudur.
   */
  readonly overrodeProviderFirst: number;
  /** Ölçülen en büyük süre takası (sn). Hiç ölçülmediyse `null`. */
  readonly maxDurationPenaltyS: number | null;
  /** Etken dağılımı — hangi gerekçe kaç kez. */
  readonly factorCounts: Readonly<Record<RouteDecidingFactor, number>>;
}

function _emptyFactorCounts(): Record<RouteDecidingFactor, number> {
  const out = {} as Record<RouteDecidingFactor, number>;
  for (const f of ROUTE_DECIDING_FACTORS) out[f] = 0;
  return out;
}

let _recent: RouteRationale[] = [];
let _decisions = 0;
let _overrodeFirst = 0;
let _maxPenaltyS: number | null = null;
let _factorCounts: Record<RouteDecidingFactor, number> = _emptyFactorCounts();

/**
 * Gerekçeyi deftere yazar. **Hiçbir üretim yoluna geri beslenmez.**
 * Kayıt sırasında hata olsa bile rota akışı ETKİLENMEZ (çağıran fail-soft).
 */
export function recordRouteRationale(r: RouteRationale): void {
  _decisions++;
  _factorCounts = { ..._factorCounts, [r.decidingFactor]: (_factorCounts[r.decidingFactor] ?? 0) + 1 };
  if (typeof r.chosenIdx === 'number' && r.chosenIdx > 0) _overrodeFirst++;
  if (r.durationPenaltyS !== null) {
    _maxPenaltyS = _maxPenaltyS === null ? r.durationPenaltyS : Math.max(_maxPenaltyS, r.durationPenaltyS);
  }
  _recent = [r, ..._recent].slice(0, ROUTE_RATIONALE_MAX_RECORDS);
}

/** Salt-okunur anlık görüntü — CAROS LAB'ın TEK okuma ucu. Yan etkisi YOKTUR. */
export function getRouteRationaleLedger(): RouteRationaleLedgerSnapshot {
  return {
    last: _recent.length > 0 ? _recent[0] : null,
    recent: _recent,
    decisions: _decisions,
    overrodeProviderFirst: _overrodeFirst,
    maxDurationPenaltyS: _maxPenaltyS,
    factorCounts: _factorCounts,
  };
}

/** @internal testler arası izolasyon. */
export function _resetRouteRationaleForTest(): void {
  _recent = [];
  _decisions = 0;
  _overrodeFirst = 0;
  _maxPenaltyS = null;
  _factorCounts = _emptyFactorCounts();
}
