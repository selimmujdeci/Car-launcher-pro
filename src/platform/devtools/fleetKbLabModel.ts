/**
 * fleetKbLabModel — Filo Hafızası ekranının SAF karar katmanı.
 *
 * SÖZLEŞME: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ⚠️ HAFIZA KANIT DEĞİLDİR: bu ekran öğrenilen profili "araç böyle" diye SUNMAZ.
 * Her satır bir İDDİADIR; güven `fleetKb.profileConfidence` ile gelir ve 1'e ASLA
 * ulaşmaz (araç her an değişebilir — sahada yaşandı: dongle Doblo'dan Trafic'e taşındı).
 */
import type { FleetKbProfileRow } from '../obd/fleetKbService';
import type { FleetKbRawSnapshot } from './fleetKbLabSources';
import type { InspectorField, Observability } from './sessionInspectorModel';

/** Kimlik kaynağının Türkçe karşılığı (enum değeri `data-source`'ta AYNEN kalır). */
export const FLEET_FP_SOURCE_LABEL: Readonly<Record<'vin' | 'signature', string>> = {
  vin:       'VIN (hash)',
  signature: 'ECU+PID imzası',
} as const;

/** Tek gözlem KANIT DEĞİLDİR — bu eşiğin altındaki profil "öğreniliyor" sayılır. */
export const ESTABLISHED_OBSERVATIONS = 2;

export interface FleetKbProfileView {
  readonly id:          string;
  readonly fingerprint: string;
  readonly sourceLabel: string;
  readonly source:      'vin' | 'signature';
  readonly observationCount: number;
  /** 0..100 tam sayı. */
  readonly confidencePct: number;
  readonly ecuCount:  number;
  readonly udsCount:  number;
  readonly lastSeenAt: number;
  readonly klass:     Observability;
  readonly note:      string;
}

/**
 * Profil satırları.
 *
 * SINIFLANDIRMA: kayıt gerçekten DİSKTE var → ÖLÇÜLDÜ. Ama içeriği araç hakkında
 * bir İDDİA olduğu için not alanında bu açıkça yazılır — "ölçüldü" burada
 * "bu kayıt var" demektir, "araç şu an böyle" DEMEZ.
 */
export function buildFleetKbProfiles(snap: FleetKbRawSnapshot): readonly FleetKbProfileView[] {
  const rows: readonly FleetKbProfileRow[] = snap.kb?.profiles ?? [];
  return rows.map((p) => ({
    id: p.fingerprint,
    fingerprint: p.fingerprint,
    sourceLabel: FLEET_FP_SOURCE_LABEL[p.source],
    source: p.source,
    observationCount: p.observationCount,
    confidencePct: Math.max(0, Math.min(100, Math.round(p.confidence * 100))),
    ecuCount: p.ecuCount,
    udsCount: p.udsCount,
    lastSeenAt: p.lastSeenAt,
    klass: 'OBSERVED' as Observability,
    note: p.observationCount < ESTABLISHED_OBSERVATIONS
      ? 'Tek gözlem — KANIT DEĞİL. Bir sonraki taramada doğrulanırsa güven artar.'
      : `${p.observationCount} kez doğrulandı; yine de her tarama CANLI kanıtla sınanır.`,
  }));
}

/** Özet alanlar — depolama sağlığı ve kapasite. */
export function buildFleetKbFields(snap: FleetKbRawSnapshot): readonly InspectorField[] {
  const kb = snap.kb;
  const out: InspectorField[] = [];

  out.push({
    id: 'storage',
    label: 'Hafıza deposu',
    value: kb === null ? '—' : 'OKUNDU',
    klass: kb === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'fleetKbService.getFleetKbSnapshot() · safeStorage caros.fleetkb.v1',
    updatedAt: null,
    note: kb === null
      ? 'Depo okunamadı — bu "profil yok" DEMEK DEĞİL, "bilmiyoruz" demektir.'
      : 'Ham VIN diske YAZILMAZ: kimlik FNV-1a hash veya ECU+PID imzasıdır.',
  });

  out.push({
    id: 'profile-count',
    label: 'Kayıtlı araç profili',
    value: kb === null ? '—' : `${kb.profileCount} / ${kb.maxProfiles}`,
    klass: kb === null ? 'UNAVAILABLE' : 'OBSERVED',
    source: 'fleetKbService (LRU: en son görülen kalır)',
    updatedAt: null,
    note: 'Tavana ulaşınca en eski GÖRÜLEN profil düşer — eMMC yıpranmasına karşı sınır.',
  });

  out.push({
    id: 'last-seen',
    label: 'Son öğrenme',
    value: kb && kb.profiles.length > 0 ? 'kayıt var' : '—',
    klass: kb && kb.profiles.length > 0 ? 'OBSERVED' : 'UNAVAILABLE',
    source: 'fleetKbService profiles[0].lastSeenAt',
    /* Damga GERÇEKTİR — kayıt yoksa null kalır, yaş HESAPLANMAZ. */
    updatedAt: kb && kb.profiles.length > 0 ? kb.profiles[0].lastSeenAt : null,
    note: 'Öğrenme yalnız tam araç taraması (runFullVehicleScan) sonunda işlenir.',
  });

  out.push({
    id: 'error',
    label: 'Depolama hatası',
    value: snap.error ?? 'YOK',
    klass: snap.error ? 'STALE' : 'OBSERVED',
    source: 'fleetKbService._lastError',
    updatedAt: null,
    note: snap.error
      ? 'Hata sessizce yutulmadı: öğrenme atlanmış olabilir, teşhis akışı ETKİLENMEZ.'
      : 'Son okuma/yazma temiz.',
  });

  return out;
}

export type FleetKbVerdict =
  /** Depo okunamadı — hiçbir şey iddia edilmez. */
  | 'UNREADABLE'
  /** Hiç profil yok — bu araç(lar) hiç öğrenilmemiş. */
  | 'EMPTY'
  /** Profil var ama hepsi tek gözlemli — henüz KANIT sayılmaz. */
  | 'LEARNING'
  /** En az bir profil birden çok kez doğrulanmış. */
  | 'ESTABLISHED';

export const FLEET_KB_VERDICT_LABEL: Readonly<Record<FleetKbVerdict, string>> = {
  UNREADABLE:  'HAFIZA OKUNAMADI',
  EMPTY:       'HİÇ ÖĞRENİLMEDİ',
  LEARNING:    'ÖĞRENİYOR (tek gözlem)',
  ESTABLISHED: 'DOĞRULANMIŞ PROFİL VAR',
} as const;

export interface FleetKbVerdictResult {
  readonly status:  FleetKbVerdict;
  readonly reasons: readonly string[];
}

export function deriveFleetKbVerdict(
  snap: FleetKbRawSnapshot,
  profiles: readonly FleetKbProfileView[],
): FleetKbVerdictResult {
  const reasons: string[] = [];

  if (snap.kb === null) {
    reasons.push(snap.error ? `Okuma hatası: ${snap.error}` : 'Hafıza okunamadı.');
    return { status: 'UNREADABLE', reasons };
  }

  if (profiles.length === 0) {
    reasons.push('Kayıtlı profil yok — tam araç taraması hiç tamamlanmamış olabilir.');
    reasons.push('Öğrenme yalnız kimlik (VIN veya ECU+PID imzası) üretilebildiğinde yapılır.');
    return { status: 'EMPTY', reasons };
  }

  const established = profiles.filter((p) => p.observationCount >= ESTABLISHED_OBSERVATIONS);
  reasons.push(`${profiles.length} profil · ${established.length} tanesi birden çok kez doğrulandı`);
  if (snap.error) reasons.push(`Depolama hatası: ${snap.error}`);

  return established.length > 0
    ? { status: 'ESTABLISHED', reasons }
    : { status: 'LEARNING', reasons };
}
