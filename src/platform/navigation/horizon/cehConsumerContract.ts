/**
 * cehConsumerContract.ts — NAV v3 · L3 · CEH TÜKETİCİ SÖZLEŞMESİ (SAF · F5).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.1 · CLAUDE.md §CROSS-DOMAIN 1/2/3.
 *
 * SAF: I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * modül durumu YOK · L4 importu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NEDEN VAR ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5'in işi tüketicileri (Guardian kuralları · sesli yönlendirme · ETA)
 * **tek CEH gerçeğine bağlamaya hazırlamaktır**. Bugün her tüketici kendi
 * "önümde ne var?" hesabını yapıyor (Guardian `enforcementMapSource` kendi
 * koni sorgusuyla, sesli yönlendirme `routeState.distanceToNextTurnMeters`
 * ile). Bu dosya, o soruya CEH'in verdiği cevabın **tek okunuş biçimini**
 * sabitler.
 *
 * ── DÖRT PAZARLIKSIZ KURAL ───────────────────────────────────────────────
 *  1. **Salt-okunur**: bu sözleşme `ElectronicHorizon`u yalnız OKUR; ufuk
 *     üretmez, ufku değiştirmez, kendi eşiğini icat etmez.
 *  2. **Tüketici kendi ahead truth'unu ÜRETMEZ**: cevabı buradan alır. Ham
 *     sağlayıcıya (denetim paketi · rota adımları · Overpass) gitmesi F0
 *     `NAV_LAYER_DEPENDENCY_LAW` ihlalidir.
 *  3. **`NOT_MEASURED` → `NONE` dönüşümü YASAK**: "ölçmedim" ile "ileride yok"
 *     ayrı `CehAheadOutcome` değerleridir ve `distanceM` ikisinde de `null`dır.
 *     Ölçülmemişi "yok" saymak, sessizce kaybolan uyarı demektir.
 *  4. **Belirsizlikte KESİN iddia YOK**: `AMBIGUOUS_PATH` ufkunda hiçbir
 *     tüketici "önünde X var" diyemez (`AMBIGUOUS` sonucu döner).
 *
 * ── `validUntilMonoMs` — DEFER/BASTIRMA SEMANTİĞİ ────────────────────────
 * Bir iddia SONSUZA KADAR geçerli değildir. Bastırılan (bütçe/öncelik nedeniyle
 * o an sunulmayan) bir olayın sonradan yeniden değerlendirilebilmesi için
 * geçerlilik ufkunun TAŞINMASI gerekir. Bu alan o ufku taşır; bütçe DIŞARIDAN
 * verilir (tanımlı tazelik eşiği) — bu dosya süre İCAT ETMEZ.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import { asMonotonic } from '../contracts/navMonotonicTime';
import type {
  ElectronicHorizon, HorizonObject, HorizonObjectKind, HorizonPath,
  HorizonPathProvenance,
} from '../contracts/navHorizon';
import { cehStateAllowsAheadClaim, mostProbablePath } from '../contracts/navHorizon';

/* ══════════════════════════════════════════════════════════════════════════
   1) TÜKETİCİ ALANLARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * "Önümde ne var?" sorusunun sorulabildiği alanlar. Her biri bugün depoda
 * AYRI bir cevaplayıcıya sahiptir; F5 bu alanları TEK ufuk okumasına taşımaya
 * hazırlar (cutover kapısı açılana kadar yalnız gölge).
 */
export type CehAheadDomain =
  /** Sıradaki manevra (dönüş/varış) — sesli yönlendirme ve HUD tüketicisi. */
  | 'MANEUVER'
  /** Denetim noktası (kamera/kırmızı ışık) — Guardian tüketicisi. */
  | 'ENFORCEMENT'
  /** İleride değişen hız limiti — Guardian + levha tüketicisi. */
  | 'SPEED_LIMIT'
  /** İleride viraj (yarıçap) — Guardian viraj riski tüketicisi. */
  | 'CURVE'
  /** İleride eğim/yol sınıfı — Guardian yol profili tüketicisi. */
  | 'ROAD_PROFILE';

export const CEH_AHEAD_DOMAINS: readonly CehAheadDomain[] = [
  'MANEUVER', 'ENFORCEMENT', 'SPEED_LIMIT', 'CURVE', 'ROAD_PROFILE',
] as const;

/** Alanın ufuk nesnesi karşılığı. `ROAD_PROFILE` iki türü de kabul eder. */
export function aheadDomainMatchesKind(domain: CehAheadDomain, kind: HorizonObjectKind): boolean {
  switch (domain) {
    case 'MANEUVER':     return kind === 'MANEUVER';
    case 'ENFORCEMENT':  return kind === 'ENFORCEMENT';
    case 'SPEED_LIMIT':  return kind === 'SPEED_LIMIT';
    case 'CURVE':        return kind === 'CURVE';
    case 'ROAD_PROFILE': return kind === 'SLOPE' || kind === 'ROAD_CLASS';
    default:             return false;
  }
}

/**
 * Bu kolda BU alan gerçekten ölçüldü mü (F6).
 *
 * `path.objects` boş olması tek başına hüküm DEĞİLDİR: kaynak hiç bakamamış
 * da olabilir (kesik koridor · paket hazır değil · fiziksel çapa yok). Kol
 * `measuredKinds` ile hangi türlerde ÖLÇÜM ürettiğini söyler; alan orada
 * yoksa hüküm `NOT_MEASURED`tır.
 *
 * Şekil eksikse (eski/elle kurulmuş kol) **fail-closed**: ölçülmemiş sayılır.
 */
export function pathMeasuresDomain(
  path: HorizonPath | null | undefined, domain: CehAheadDomain,
): boolean {
  const kinds = path?.measuredKinds;
  if (!Array.isArray(kinds)) return false;
  for (const k of kinds) if (aheadDomainMatchesKind(domain, k)) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ — "ölçülmedi" ile "yok" YAPISAL OLARAK AYRI
   ══════════════════════════════════════════════════════════════════════════ */

export type CehAheadOutcome =
  /** Kesin iddia üretildi: bu alanda ileride şu var, şu mesafede. */
  | 'CLAIM'
  /** Ufuk KAPSANDI ve bu alanda nesne YOK — bir ÖLÇÜMDÜR. */
  | 'NO_OBJECT_IN_HORIZON'
  /** Kol belirsiz → kesin iddia ÜRETİLEMEZ (zorla indirgeme yasak). */
  | 'AMBIGUOUS'
  /** Ufuk yok/bayat/çapasız → soru cevaplanamaz. */
  | 'HORIZON_UNAVAILABLE'
  /** Bu alan HİÇ ölçülmedi — **"yok" DEĞİL** (öznitelik portu bağlanmadı). */
  | 'NOT_MEASURED';

export const CEH_AHEAD_OUTCOMES: readonly CehAheadOutcome[] = [
  'CLAIM', 'NO_OBJECT_IN_HORIZON', 'AMBIGUOUS', 'HORIZON_UNAVAILABLE', 'NOT_MEASURED',
] as const;

/**
 * Bir tüketicinin okuyacağı TEK yapı. **Şekil sabittir** (V8 hidden-class):
 * her alan her zaman vardır; bilinmeyen alan `null` taşır, silinmez.
 */
export interface CehAheadClaim {
  readonly domain: CehAheadDomain;
  readonly outcome: CehAheadOutcome;
  /** Kaynak ufkun üretim kimliği — eski iddia yeni sanılamaz (F0 §17). */
  readonly generation: number | null;
  /** Yol-boyu mesafe (m). **Yalnız `CLAIM`de sayıdır**; aksi hâlde `null`. */
  readonly distanceM: number | null;
  /** Makine-okur etiket (`turn:left` · `camera:fixed_speed`). */
  readonly label: string | null;
  /** [0,1] — kolun ve nesnenin kanıtından; uydurma güven YOK. */
  readonly confidence: number | null;
  readonly provenance: HorizonPathProvenance | null;
  /** Kol fiziksel eşleşmeyle doğrulandı mı (niyet ≠ doğrulama). */
  readonly physicallyConfirmed: boolean;
  /**
   * İddianın geçerlilik ufku. `null` = geçerlilik hesaplanamadı → bastırılan
   * olay **ertelenemez** (fail-closed; bkz. bastırma sözleşmesi).
   */
  readonly validUntilMonoMs: MonotonicMs | null;
}

/** Cevapsız iddia — fail-closed varsayılan. */
export function noCehAheadClaim(
  domain: CehAheadDomain, outcome: CehAheadOutcome, generation: number | null,
): CehAheadClaim {
  return {
    domain,
    outcome,
    generation,
    distanceM: null,
    label: null,
    confidence: null,
    provenance: null,
    physicallyConfirmed: false,
    validUntilMonoMs: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) OKUYUCU (saf)
   ══════════════════════════════════════════════════════════════════════════ */

function _num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Bir ufuk nesnesinin YOL-BOYU mesafesi. Kanıt derecesi `UNAVAILABLE` ise
 * mesafe İDDİA EDİLMEZ (`null`) — uydurma mesafe, yanlış zamanlı uyarı demektir.
 */
function _objectDistanceM(o: HorizonObject): number | null {
  if (o.distanceFromEgoM.grade === 'UNAVAILABLE') return null;
  return _num(o.distanceFromEgoM.value);
}

/** Bu koldaki, bu alana ait EN YAKIN nesne. Yoksa `null`. */
export function nearestObjectInPath(
  path: HorizonPath, domain: CehAheadDomain,
): HorizonObject | null {
  let best: HorizonObject | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of path.objects) {
    if (!aheadDomainMatchesKind(domain, o.kind)) continue;
    const d = _objectDistanceM(o);
    if (d === null || d < 0) continue;          // mesafesiz nesne iddia ÜRETEMEZ
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

export interface CehAheadReadOptions {
  /**
   * İddianın geçerlilik bütçesi (ms). Çağıran TANIMLI bir eşik verir
   * (ör. `freshnessPolicy.GPS_FIX_STALE_MS`); bu dosya süre İCAT ETMEZ.
   * `null` → `validUntilMonoMs` `null` kalır (erteleme hakkı doğmaz).
   */
  readonly validityBudgetMs: number | null;
  /**
   * Bu alan için ufuk öznitelik portu GERÇEKTEN bağlandı mı. `false` iken boş
   * nesne listesi **"ileride yok" DEMEK DEĞİLDİR** → `NOT_MEASURED` döner.
   * Yalnız `MANEUVER` bugün üretimde gerçekten üretilir (rota niyetinden).
   */
  readonly domainMeasured: boolean;
}

/**
 * Tüketicinin TEK okuma noktası. **Saf** — aynı ufuk + aynı seçenek daima
 * aynı iddiayı verir.
 *
 * Sıra bilinçlidir ve fail-closed'dır:
 *   ufuk yok → belirsiz → durum iddiaya izin vermiyor → MPP yok →
 *   alan ölçülmedi → nesne yok (ölçülmüş yokluk) → iddia.
 */
export function readCehAhead(
  horizon: ElectronicHorizon | null | undefined,
  domain: CehAheadDomain,
  options: CehAheadReadOptions,
): CehAheadClaim {
  if (!horizon) return noCehAheadClaim(domain, 'HORIZON_UNAVAILABLE', null);
  const gen = horizon.generation;

  /* Belirsiz kol → KESİN iddia YASAK (zorla indirgeme yapılmaz). */
  if (horizon.ambiguous) return noCehAheadClaim(domain, 'AMBIGUOUS', gen);

  /* Durum kesin iddiaya izin vermiyorsa (ego yok/bayat, harita yok…). */
  if (!cehStateAllowsAheadClaim(horizon.state)) {
    return noCehAheadClaim(domain, 'HORIZON_UNAVAILABLE', gen);
  }

  const mpp = mostProbablePath(horizon);
  if (mpp === null) return noCehAheadClaim(domain, 'HORIZON_UNAVAILABLE', gen);

  /* Alanın kaynağı hiç bağlanmadıysa boş liste bir ÖLÇÜM DEĞİLDİR. */
  if (options.domainMeasured !== true) {
    return noCehAheadClaim(domain, 'NOT_MEASURED', gen);
  }

  const obj = nearestObjectInPath(mpp, domain);
  if (obj === null) {
    /* ── BOŞ LİSTE TEK BAŞINA "YOK" DEĞİLDİR (F6) ────────────────────────
       Port bağlı olabilir (`options.domainMeasured`) ama BU TİK'te ölçüm
       üretmemiş olabilir: koridor tavanla kesildi · denetim paketi hazır
       değil · fiziksel çapa yok. O hâlde hüküm `NOT_MEASURED`tır.
       ÖLÇÜLDÜ (§F6.8): gerçek grafta 2 000 m bütçede 300 örneğin 74'ü
       (%24,7) kesik koridor üretiyor — bu, kenar durum değil olağan hâl. */
    if (!pathMeasuresDomain(mpp, domain)) {
      return {
        ...noCehAheadClaim(domain, 'NOT_MEASURED', gen),
        provenance: mpp.provenance,
        physicallyConfirmed: mpp.physicallyConfirmed,
      };
    }
    /* Ölçüldü ve bu bütçede nesne yok — `NOT_MEASURED`ten AYRI hüküm. */
    return {
      ...noCehAheadClaim(domain, 'NO_OBJECT_IN_HORIZON', gen),
      provenance: mpp.provenance,
      physicallyConfirmed: mpp.physicallyConfirmed,
    };
  }

  const d = _objectDistanceM(obj);
  if (d === null) {
    /* Nesne var ama mesafesi ölçülemedi → mesafe UYDURULMAZ. */
    return {
      ...noCehAheadClaim(domain, 'NOT_MEASURED', gen),
      label: obj.label.grade === 'UNAVAILABLE' ? null : obj.label.value,
      provenance: mpp.provenance,
      physicallyConfirmed: mpp.physicallyConfirmed,
    };
  }

  const budget = _num(options.validityBudgetMs);
  const confObj = _num(obj.distanceFromEgoM.confidence);
  const confPath = _num(mpp.confidence);

  return {
    domain,
    outcome: 'CLAIM',
    generation: gen,
    distanceM: d,
    label: obj.label.grade === 'UNAVAILABLE' ? null : obj.label.value,
    /* Güven zincirin EN ZAYIF halkasıdır — kolun güveni nesneyi yükseltemez. */
    confidence: (confObj === null || confPath === null)
      ? null
      : Math.max(0, Math.min(1, Math.min(confObj, confPath))),
    provenance: mpp.provenance,
    physicallyConfirmed: mpp.physicallyConfirmed,
    validUntilMonoMs: (budget === null || budget <= 0)
      ? null
      : asMonotonic(horizon.tsMonoMs + budget),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SAF DOĞRULAYICILAR — tüketici kendi kuralını KURMAZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu iddia bir SÜRÜCÜ KARARINA (uyarı/anons) temel olabilir mi.
 *
 * `CLAIM` olmayan hiçbir sonuç karar üretemez; ayrıca fiziksel doğrulaması
 * olmayan (yalnız rota niyetinden gelen) bir iddia **mutlak-doğruluk**
 * gerektiren alanlarda (denetim · limit · viraj · eğim) karar üretemez —
 * paralel yolda rota aynen "doğru" görünür (v2 FMEA F05).
 */
export function cehClaimIsActionable(c: CehAheadClaim | null | undefined): boolean {
  if (!c || c.outcome !== 'CLAIM') return false;
  if (c.distanceM === null) return false;
  if (c.domain === 'MANEUVER') return true;
  return c.physicallyConfirmed === true;
}

/**
 * "Ölçülmedi" hükmü mü. Bu `true` iken tüketicinin `NONE`/`SAFE`/`0`
 * varsayması **YASAKTIR** (kilit test bu ayrımı denetler).
 */
export function cehClaimIsUnmeasured(c: CehAheadClaim | null | undefined): boolean {
  return !!c && (c.outcome === 'NOT_MEASURED' || c.outcome === 'HORIZON_UNAVAILABLE');
}

/** Ölçülmüş yokluk mu ("tarandı, ileride yok"). */
export function cehClaimIsMeasuredAbsence(c: CehAheadClaim | null | undefined): boolean {
  return !!c && c.outcome === 'NO_OBJECT_IN_HORIZON';
}

/** İddia bu anda hâlâ geçerli mi. Geçerlilik ufku yoksa `false` (fail-closed). */
export function cehClaimStillValid(
  c: CehAheadClaim | null | undefined, nowMonoMs: MonotonicMs | number,
): boolean {
  if (!c || c.validUntilMonoMs === null) return false;
  if (typeof nowMonoMs !== 'number' || !Number.isFinite(nowMonoMs)) return false;
  return nowMonoMs <= c.validUntilMonoMs;
}
