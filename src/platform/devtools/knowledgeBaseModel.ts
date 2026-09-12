/**
 * knowledgeBaseModel — CAROS LAB · Bilgi Tabanı Gezgini SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Depo okunamadıysa `UNAVAILABLE`; "hiç araç öğrenilmedi" ile KARIŞTIRILMAZ.
 *  · TEK gözlemli kayıt KANIT DEĞİLDİR — ekranda açıkça öyle işaretlenir
 *    (zero-trust telemetry: bir kez görülen sinyal tekrar edilmemiş demektir).
 *  · Güven 1'e ASLA ulaşmaz; %100 gösterilmez.
 *  · Damgasız kayıtta yaş HESAPLANMAZ.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';
import type { KnowledgeVehicleShape } from './knowledgeBaseSources';

const SRC_KB = 'vehicleKnowledgeBase.vehicleKnowledgeBaseStore';

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export type KnowledgeVerdict =
  | 'UNAVAILABLE'
  /** Hiç araç öğrenilmemiş. */
  | 'EMPTY'
  /** Kayıt var ama hepsi tek gözlemli → kanıt sayılmaz. */
  | 'UNCONFIRMED'
  /** En az bir araç birden çok kez görülmüş. */
  | 'CONFIRMED'
  /** Depo tavanına ulaşıldı — yeni araç en eskiyi düşürür (LRU). */
  | 'AT_CAPACITY';

export const KNOWLEDGE_VERDICT_LABEL: Readonly<Record<KnowledgeVerdict, string>> = {
  UNAVAILABLE: 'OKUNAMADI',
  EMPTY:       'BOŞ — hiç araç öğrenilmedi',
  UNCONFIRMED: 'DOĞRULANMAMIŞ — tümü tek gözlemli',
  CONFIRMED:   'DOĞRULANMIŞ PROFİL VAR',
  AT_CAPACITY: 'TAVAN DOLU — en eski araç düşecek (LRU)',
} as const;

export type KnowledgeTone = 'ok' | 'muted' | 'warn';

export function knowledgeVerdictTone(v: KnowledgeVerdict): KnowledgeTone {
  return v === 'CONFIRMED' ? 'ok'
    : (v === 'AT_CAPACITY' || v === 'UNCONFIRMED') ? 'warn'
      : 'muted';
}

/** Bir kayıt KANIT sayılır mı — tek gözlem yeterli DEĞİLDİR. */
export function isConfirmed(v: KnowledgeVehicleShape): boolean {
  return v.totalConnections >= 2;
}

/**
 * Genel hüküm. SIRA: okunamadı > boş > tavan > doğrulanmış > doğrulanmamış.
 *
 * `AT_CAPACITY` `CONFIRMED`'ı EZER: tavan dolu bir depoda öğrenme kaybı
 * başlamıştır ve bu, "doğrulanmış profilim var" iyi haberinden daha önemlidir.
 */
export function deriveKnowledgeVerdict(input: {
  readonly vehicles: readonly KnowledgeVehicleShape[] | null;
  readonly maxRecords: number;
}): KnowledgeVerdict {
  const v = input.vehicles;
  if (v === null) return 'UNAVAILABLE';
  if (v.length === 0) return 'EMPTY';
  if (v.length >= input.maxRecords) return 'AT_CAPACITY';
  return v.some(isConfirmed) ? 'CONFIRMED' : 'UNCONFIRMED';
}

export interface KnowledgeSummary {
  readonly vehicleCount: number;
  readonly confirmedCount: number;
  readonly totalPids: number;
  readonly totalDids: number;
  readonly totalEcus: number;
}

export function summarizeKnowledge(
  vehicles: readonly KnowledgeVehicleShape[] | null,
): KnowledgeSummary {
  if (vehicles === null) {
    return { vehicleCount: 0, confirmedCount: 0, totalPids: 0, totalDids: 0, totalEcus: 0 };
  }
  let confirmedCount = 0, totalPids = 0, totalDids = 0, totalEcus = 0;
  for (const v of vehicles) {
    if (isConfirmed(v)) confirmedCount += 1;
    totalPids += v.pidCount;
    totalDids += v.didCount;
    totalEcus += v.ecuCount;
  }
  return { vehicleCount: vehicles.length, confirmedCount, totalPids, totalDids, totalEcus };
}

/* ── Alanlar ─────────────────────────────────────────────────────────────── */

/** Depo geneli özet. */
export function buildKnowledgeFields(input: {
  readonly vehicles: readonly KnowledgeVehicleShape[] | null;
  readonly maxRecords: number;
  readonly nowMs: number;
}): readonly InspectorField[] {
  if (input.vehicles === null) {
    return [unavailable({
      id: 'kb-store', label: 'Bilgi tabanı deposu', source: SRC_KB, note: '',
    }, 'Okuma hata verdi — "hiç araç öğrenilmedi" ile KARIŞTIRILMAZ.')];
  }

  const s = summarizeKnowledge(input.vehicles);
  return [
    observed({
      id: 'kb-vehicles', label: 'Öğrenilen araç', source: SRC_KB,
      note: 'Tavan LRU\'dur (eMMC yıpranmasına karşı); dolunca en eski kayıt düşer.',
    }, `${s.vehicleCount}/${input.maxRecords}`),
    observed({
      id: 'kb-confirmed', label: 'Doğrulanmış profil', source: SRC_KB,
      note: 'TEK gözlem KANIT DEĞİLDİR — en az iki bağlantı gerekir (zero-trust telemetry).',
    }, s.confirmedCount),
    observed({
      id: 'kb-signals', label: 'Öğrenilen sinyal', source: SRC_KB,
      note: 'Tüm araçlardaki toplam keşif — PID (Mode 01) + DID (Mode 22).',
    }, `${s.totalPids} PID · ${s.totalDids} DID`),
    observed({
      id: 'kb-ecus', label: 'Gözlemlenen ECU', source: SRC_KB,
      note: 'Adres ADEDİ; ham adres listesi bu ekrana GELMEZ.',
    }, s.totalEcus),
  ];
}

/** Tek aracın satır alanları — VIN maskeli, hash kısaltılmış. */
export function buildVehicleFields(
  v: KnowledgeVehicleShape, nowMs: number,
): readonly InspectorField[] {
  return [
    observed({
      id: `veh-${v.fingerprintPrefix}-id`, label: 'Parmak izi', source: SRC_KB,
      note: 'Yalnız ilk 12 karakter — tam hash araç-arası eşleştirmeye izin verirdi.',
    }, v.fingerprintPrefix),
    v.vinMasked === null
      ? unavailable({
          id: `veh-${v.fingerprintPrefix}-vin`, label: 'VIN', source: SRC_KB, note: '',
        }, 'Kayıtta VIN yok veya maskelenemedi — ham değer ASLA gösterilmez.')
      : observed({
          id: `veh-${v.fingerprintPrefix}-vin`, label: 'VIN (maskeli)', source: SRC_KB,
          note: 'Yalnız WMI açık; gerisi maskelidir.',
        }, v.vinMasked),
    observed({
      id: `veh-${v.fingerprintPrefix}-obs`, label: 'Bağlantı / keşif', source: SRC_KB,
      note: isConfirmed(v)
        ? 'İki veya daha fazla bağlantı — profil doğrulanmış sayılır.'
        : 'TEK bağlantı — bu profil KANIT DEĞİLDİR, tekrar görülmesi gerekir.',
    }, `${v.totalConnections} bağlantı · ${v.totalDiscoveries} gözlem`),
    observed({
      id: `veh-${v.fingerprintPrefix}-sig`, label: 'Sinyal', source: SRC_KB,
      note: 'Bu araçta öğrenilmiş sinyaller.',
    }, `${v.pidCount} PID · ${v.didCount} DID · ${v.ecuCount} ECU`),
    v.protocol === null
      ? unavailable({
          id: `veh-${v.fingerprintPrefix}-proto`, label: 'Protokol', source: SRC_KB, note: '',
        }, 'Kayıtta protokol yok.')
      : observed({
          id: `veh-${v.fingerprintPrefix}-proto`, label: 'Protokol', source: SRC_KB,
          note: v.profileHint ? `Profil ipucu: ${v.profileHint}` : 'Öğrenilmiş aktif protokol.',
        }, v.protocol),
    derived({
      id: `veh-${v.fingerprintPrefix}-conf`, label: 'Güven', source: SRC_KB,
      note: 'Güven 1\'e ASLA ulaşmaz — kapalı bir sistemi tam bildiğimizi iddia edemeyiz.',
    }, `%${Math.round(v.confidence * 100)}`),
    v.lastSeenMs > 0
      ? derived({
          id: `veh-${v.fingerprintPrefix}-seen`, label: 'Son görülme', source: SRC_KB,
          note: 'Damgadan türetildi.', updatedAt: v.lastSeenMs,
        }, formatAge(v.lastSeenMs, nowMs))
      : unavailable({
          id: `veh-${v.fingerprintPrefix}-seen`, label: 'Son görülme', source: SRC_KB, note: '',
        }, 'Damga yok — yaş HESAPLANMAZ.'),
  ];
}
