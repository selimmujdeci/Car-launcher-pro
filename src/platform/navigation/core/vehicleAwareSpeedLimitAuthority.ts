/**
 * vehicleAwareSpeedLimitAuthority.ts — UYGULANABİLİR hız sınırı TEK OTORİTESİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK · global durum YOK.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `speedLimitTruthModel` "yolun levhası ne ve hâlâ geçerli mi?" sorusunu
 * cevaplar. Ama sürücünün gerçekten uyması gereken sınır YOLUN ve ARACIN
 * BİRLİKTE belirlediği sınırdır: aynı otoyolda otomobil 130 giderken ruhsatta
 * kamyonet (N1) yazan bir Doblo 95 ile sınırlıdır.
 *
 * ── TEK MOTOR KURALI (görev §0, pazarlıksız) ────────────────────────────────
 * Mini harita ve tam ekran AYNI bu otoriteyi çağırır. İkinci bir hız limiti
 * motoru KURULMAZ. Bu dosya yeni bir VERİ KAYNAĞI da değildir: mevcut yol
 * hükmünü + mevcut araç sınıfı profilini + versiyonlu politika tablosunu
 * birleştirir, hepsi bu.
 *
 * ── ALTIN KURAL ─────────────────────────────────────────────────────────────
 * `effectiveLimitKmh = min(doğrulanmış yol/levha sınırı, doğrulanmış araç tavanı)`
 * Araç sınıfı tablosu levhayı **ASLA YÜKSELTMEZ** — yalnız düşürebilir.
 * `AVAILABLE`/`ROAD_ONLY` dışında hiçbir durumda sayı dönmez.
 */

import type { SpeedLimitVerdict } from './speedLimitTruthModel';
import type { RoadClassVerdict } from '../policy/roadClassResolver';
import {
  vehicleClassCap, type PolicyRoadClass, type VehicleClassCapResult,
  POLICY_COUNTRY, POLICY_VERSION, POLICY_EFFECTIVE_FROM, POLICY_SOURCE_AUTHORITY,
} from '../policy/turkeySpeedPolicy';
import {
  isVehicleClassApplicable, type VehicleClassProfile,
} from '../../vehicle/legalVehicleClass';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum ve gerekçe
 * ════════════════════════════════════════════════════════════════════════ */

export type EffectiveSpeedLimitState =
  /** Yol + araç birlikte kesin bir sınır verdi → GÖSTERİLİR. */
  | 'AVAILABLE'
  /** Yol sınırı var, araç sınıfı yok → yalnız yol sınırı, "YOL SINIRI" etiketiyle. */
  | 'ROAD_ONLY'
  /** Araç tavanı biliniyor ama yol sınırı/sınıfı yok → kesin sınır ÜRETİLMEZ. */
  | 'VEHICLE_ONLY'
  /** Araç sınıfı belirsiz (ör. N1 kamyonet mi panelvan mı) → muhafazakâr tavan. */
  | 'AMBIGUOUS'
  /** Kaynaklar çelişiyor (yol içinde veya kullanıcı↔internet). */
  | 'CONFLICTED'
  /** Yol değeri bayat (araç başka yola geçti / değer yaşlandı). */
  | 'STALE'
  /** Kaynak cevap verdi ama kullanılabilir değer yok. */
  | 'UNAVAILABLE'
  /** Henüz hiç sorulmadı. */
  | 'UNKNOWN';

export const EFFECTIVE_LIMIT_STATE_LABEL: Readonly<Record<EffectiveSpeedLimitState, string>> = {
  AVAILABLE:    'UYGULANABİLİR',
  ROAD_ONLY:    'YALNIZ YOL SINIRI',
  VEHICLE_ONLY: 'YALNIZ ARAÇ TAVANI',
  AMBIGUOUS:    'BELİRSİZ SINIF',
  CONFLICTED:   'ÇELİŞKİLİ',
  STALE:        'BAYAT',
  UNAVAILABLE:  'KAYNAK YOK',
  UNKNOWN:      'BİLİNMİYOR',
} as const;

export type EffectiveLimitReason =
  /** Sınırı yolun levhası belirledi. */
  | 'ROAD_POSTED'
  /** Sınırı aracın yasal sınıf tavanı belirledi (tavan < levha). */
  | 'VEHICLE_CLASS_CAP'
  /** Araç sınıfı belirsiz — adaylardan en düşüğü uygulandı. */
  | 'AMBIGUOUS_CLASS_CONSERVATIVE'
  /** Kullanıcı beyanı ile dış kaynak çelişiyor — kullanıcı uygulandı. */
  | 'VEHICLE_CLASS_CONFLICT'
  /** Hiçbir sınır üretilmedi. */
  | 'NONE';

/** Kartta gösterilecek küçük kaynak etiketi (görev §9). */
export type SpeedLimitSourceLabel =
  | 'YOL SINIRI' | 'ARAÇ SINIRI' | 'YEREL LEVHA' | 'DOĞRULANMADI';

export interface EffectiveSpeedLimit {
  /** Yolun doğrulanmış sınırı (km/sa) — `null` = yok. */
  readonly roadLimitKmh: number | null;
  /** Aracın yasal sınıf tavanı (km/sa) — `null` = bilinmiyor/uygulanamaz. */
  readonly vehicleClassCapKmh: number | null;
  /** Sürücüye gösterilecek sayı — YALNIZ `AVAILABLE`/`ROAD_ONLY`/`AMBIGUOUS`/`CONFLICTED`'te dolu. */
  readonly effectiveLimitKmh: number | null;
  readonly effectiveLimitReason: EffectiveLimitReason;
  readonly state: EffectiveSpeedLimitState;
  /** [0..1] — yol güveni × sınıf güveni × yol-sınıfı güveni. */
  readonly confidence: number;
  /** Yol değerinin yaşı (ms) — `null` = damga yok. */
  readonly sourceAgeMs: number | null;
  readonly roadClass: PolicyRoadClass;
  readonly sourceLabel: SpeedLimitSourceLabel;
  /** İnsan-okur gerekçe — LAB, park ekranı ve testler için. */
  readonly reason: string;
  /** Politika künyesi — LAB'da gösterilir. */
  readonly policyCountry: string;
  readonly policyVersion: string;
  readonly policyEffectiveFrom: string;
  readonly policySourceAuthority: string;
}

export const EMPTY_EFFECTIVE_SPEED_LIMIT: EffectiveSpeedLimit = {
  roadLimitKmh: null, vehicleClassCapKmh: null, effectiveLimitKmh: null,
  effectiveLimitReason: 'NONE', state: 'UNKNOWN', confidence: 0, sourceAgeMs: null,
  roadClass: 'UNKNOWN', sourceLabel: 'DOĞRULANMADI', reason: 'henüz değerlendirilmedi',
  policyCountry: POLICY_COUNTRY, policyVersion: POLICY_VERSION,
  policyEffectiveFrom: POLICY_EFFECTIVE_FROM, policySourceAuthority: POLICY_SOURCE_AUTHORITY,
} as const;

export interface EffectiveSpeedLimitInput {
  /** `speedLimitTruthModel.classifySpeedLimit` çıktısı — TEK yol otoritesi. */
  readonly road: SpeedLimitVerdict;
  readonly roadClass: RoadClassVerdict;
  readonly vehicleClass: VehicleClassProfile;
}

function _base(state: EffectiveSpeedLimitState, reason: string,
               over: Partial<EffectiveSpeedLimit> = {}): EffectiveSpeedLimit {
  return { ...EMPTY_EFFECTIVE_SPEED_LIMIT, state, reason, ...over };
}

/**
 * Uygulanabilir hız sınırını hesaplar.
 *
 * ── ELE ALINAN DURUMLAR (görev §7) ──────────────────────────────────────────
 *  · Yol bayat/çelişkili → sayı YOK (eski yolun limiti yeni segmente taşınmaz;
 *    bu kapı zaten `speedLimitTruthModel` içinde mesafe/yaş ile kurulmuştur).
 *  · Yol biliniyor + araç sınıfı bilinmiyor → `ROAD_ONLY`. Otomobil tavanı
 *    VARSAYILMAZ; kart "YOL SINIRI" etiketiyle çıkar (fail-closed ürün kararı:
 *    kartı tamamen gizlemek yerine, ne olduğunu AÇIKÇA söyleyerek göster).
 *  · Araç sınıfı biliniyor + yol sınıfı bilinmiyor → `VEHICLE_ONLY`, sayı YOK.
 *  · Araç sınıfı belirsiz → adaylardan en DÜŞÜK tavan, durum `AMBIGUOUS`.
 *  · Yerel/geçici levha daha düşükse zaten `min()` onu seçer — tablo levhayı
 *    yükseltemez.
 */
export function computeEffectiveSpeedLimit(input: EffectiveSpeedLimitInput): EffectiveSpeedLimit {
  const { road, roadClass, vehicleClass } = input;

  /* ── 1) Araç tavanı (yoldan bağımsız olarak hesaplanabilir) ─────────────── */
  const classApplicable = isVehicleClassApplicable(vehicleClass);
  const capResult: VehicleClassCapResult | null =
    (classApplicable && roadClass.roadClass !== 'UNKNOWN')
      ? vehicleClassCap({
        legalVehicleCategory: vehicleClass.legalVehicleCategory,
        registrationBodyType: vehicleClass.registrationBodyType,
        roadClass: roadClass.roadClass,
        motorwayOperatorKnown: roadClass.motorwayOperatorKnown,
      })
      : null;
  const capKmh = capResult?.capKmh ?? null;
  const capAmbiguous = capResult?.ambiguous === true;
  const classConflicted = vehicleClass.resolutionState === 'CONFLICTED';

  const common = {
    vehicleClassCapKmh: capKmh,
    roadClass: roadClass.roadClass,
    sourceAgeMs: road.ageMs,
  };

  /* ── 2) Yol tarafı kullanılabilir değilse ───────────────────────────────── */
  if (road.state !== 'AVAILABLE' || road.kmh === null) {
    if (road.state === 'STALE') {
      return _base('STALE', 'yol sınırı bayat — sayı gösterilmez', common);
    }
    if (road.state === 'CONFLICTED') {
      return _base('CONFLICTED', 'yol üzerinde çelişen limitler', common);
    }
    if (capKmh !== null) {
      return _base('VEHICLE_ONLY',
        'araç tavanı biliniyor ama yol sınırı yok — kesin sınır üretilmez', common);
    }
    return road.state === 'UNAVAILABLE'
      ? _base('UNAVAILABLE', `yol sınırı yok: ${road.reason}`, common)
      : _base('UNKNOWN', `yol sınırı henüz bilinmiyor: ${road.reason}`, common);
  }

  const roadLimitKmh = road.kmh;
  const withRoad = { ...common, roadLimitKmh };

  /* ── 3) Araç sınıfı yoksa → yalnız yol sınırı, AÇIK etiketle ────────────── */
  if (capKmh === null) {
    const why = !classApplicable
      ? `araç sınıfı uygulanamaz (${vehicleClass.resolutionState})`
      : roadClass.roadClass === 'UNKNOWN'
        ? 'yol sınıfı çözülemedi — araç tavanı uygulanamaz'
        : (capResult?.reason ?? 'araç tavanı yok');
    return _base('ROAD_ONLY', `yalnız yol sınırı — ${why}`, {
      ...withRoad,
      effectiveLimitKmh: roadLimitKmh,
      effectiveLimitReason: 'ROAD_POSTED',
      sourceLabel: 'YOL SINIRI',
      confidence: road.confidence,
    });
  }

  /* ── 4) ALTIN KURAL: min(yol, araç tavanı) ──────────────────────────────── */
  const effective = Math.min(roadLimitKmh, capKmh);
  const capBinds = capKmh < roadLimitKmh;

  const confidence = Math.max(0, Math.min(1,
    road.confidence * vehicleClass.confidence * Math.max(0.1, roadClass.confidence)));

  if (classConflicted) {
    return _base('CONFLICTED',
      'kullanıcı beyanı dış kaynakla çelişiyor — kullanıcı beyanı uygulandı, muhafazakâr min alındı', {
        ...withRoad,
        effectiveLimitKmh: effective,
        effectiveLimitReason: 'VEHICLE_CLASS_CONFLICT',
        sourceLabel: capBinds ? 'ARAÇ SINIRI' : 'YOL SINIRI',
        confidence,
      });
  }

  if (capAmbiguous) {
    return _base('AMBIGUOUS',
      'araç gövde cinsi belirsiz — adaylardan en düşük tavan uygulandı', {
        ...withRoad,
        effectiveLimitKmh: effective,
        effectiveLimitReason: capBinds ? 'AMBIGUOUS_CLASS_CONSERVATIVE' : 'ROAD_POSTED',
        sourceLabel: capBinds ? 'ARAÇ SINIRI' : 'YOL SINIRI',
        confidence: confidence * 0.7,
      });
  }

  return _base('AVAILABLE',
    capBinds
      ? 'araç sınıfı tavanı yol sınırından düşük — tavan uygulandı'
      : 'yol sınırı araç tavanının altında — yol sınırı uygulandı', {
      ...withRoad,
      effectiveLimitKmh: effective,
      effectiveLimitReason: capBinds ? 'VEHICLE_CLASS_CAP' : 'ROAD_POSTED',
      sourceLabel: capBinds ? 'ARAÇ SINIRI' : 'YOL SINIRI',
      confidence,
    });
}

/** Kart gösterime uygun mu — UI tek satırda sorar. */
export function isEffectiveLimitDisplayable(v: EffectiveSpeedLimit): boolean {
  return v.effectiveLimitKmh !== null
    && v.effectiveLimitKmh > 0
    && (v.state === 'AVAILABLE' || v.state === 'ROAD_ONLY'
      || v.state === 'AMBIGUOUS' || v.state === 'CONFLICTED');
}

/**
 * Kart sayısının "kesin" mi yoksa "yalnız yol/muhafazakâr" mı olduğunu söyler.
 * UI bunu kesikli çerçeve / alt etiket ile AYIRT EDER — tahmini sayıyı kesin
 * hız sınırı gibi göstermek yasaktır (görev §9).
 */
export function isEffectiveLimitDefinitive(v: EffectiveSpeedLimit): boolean {
  return v.state === 'AVAILABLE';
}
