/**
 * KANIT MODELİ — konsolun tek hüküm otoritesi (#662).
 *
 * I/O · timer · `Date.now` · global durum · React importu YOK. "Şimdi" DAİMA
 * dışarıdan parametre olarak gelir — model saatin sahibi değildir.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * Bu katman `vehicleTelemetryFreshness` sözleşmesini KULLANIR (OBSERVED /
 * DERIVED / UNAVAILABLE / STALE ailesi); PARALEL BİR SİSTEM KURMAZ. Yaptığı
 * tek şey, o gerçek katmanını konsolun görsel diline (rozet + renk + kanıt
 * satırı) çevirmektir.
 *
 * ── DEMİR KURAL ───────────────────────────────────────────────────────────
 * Kanıtı olmayan metrik YEŞİL BOYANMAZ. `NO_EVIDENCE` yalnız gri/donuk
 * gösterilir; "sağlıklı" ile "bilinmiyor" aynı görünmez. Sahte `0`, sahte
 * tarih, sahte "sağlıklı" ÜRETİLMEZ.
 */

import type {
  Measurement,
  VehicleFreshness,
  FreshnessState,
  DataSource,
} from '@/lib/fleet/vehicleTelemetryFreshness';

/** Konsolun dört hükmü. Sıralama önem derecesidir (büyük = daha acil). */
export type Verdict = 'NO_EVIDENCE' | 'VERIFIED' | 'WARNING' | 'CRITICAL';

export const VERDICT_RANK: Record<Verdict, number> = {
  NO_EVIDENCE: 0,
  VERIFIED: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** Kanıtın nereden geldiği — ölçüldü mü, türetildi mi, yok mu. */
export type EvidenceSource = 'MEASURED' | 'DERIVED' | 'NONE';

export interface EvidenceReading {
  readonly verdict: Verdict;
  /** Ölçülen değer; `null` = KANIT YOK (0 değil). */
  readonly value: number | null;
  readonly source: EvidenceSource;
  /** Kaç örnekten geldiği; bilinmiyorsa `null` — uydurma sayı YOK. */
  readonly samples: number | null;
  /** Veri yaşı (ms); bilinmiyorsa `null`. */
  readonly ageMs: number | null;
  /** Tazelik hükmü — bayat veri canlı gibi sunulamaz. */
  readonly freshness: FreshnessState;
}

export const NO_EVIDENCE: EvidenceReading = {
  verdict: 'NO_EVIDENCE',
  value: null,
  source: 'NONE',
  samples: null,
  ageMs: null,
  freshness: 'UNKNOWN',
};

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'VERIFIED':    return 'KANITLI';
    case 'WARNING':     return 'UYARI';
    case 'CRITICAL':    return 'KRİTİK';
    case 'NO_EVIDENCE': return 'KANIT YOK';
  }
}

export function sourceLabel(s: EvidenceSource): string {
  switch (s) {
    case 'MEASURED': return 'ÖLÇÜLDÜ';
    case 'DERIVED':  return 'TÜRETİLDİ';
    case 'NONE':     return 'KAYNAK YOK';
  }
}

/** Konsol renk tokeni — hüküm doğrudan renge çevrilir, ara yorum YOK. */
export function verdictToken(v: Verdict): 'verified' | 'warning' | 'critical' | 'unknown' {
  switch (v) {
    case 'VERIFIED':    return 'verified';
    case 'WARNING':     return 'warning';
    case 'CRITICAL':    return 'critical';
    case 'NO_EVIDENCE': return 'unknown';
  }
}

/**
 * Veri yaşı → "X saniye/dakika önce". Bilinmiyorsa uydurma zaman YOK.
 * `ageLabel` (freshness katmanı) dakikadan başlar; konsol saniye çözünürlüğü
 * ister (GPS tazeliği saniyelerle ölçülür), bu yüzden ayrı biçimleyici.
 */
export function agoLabel(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return 'zaman bilinmiyor';
  if (ageMs < 0) return 'şimdi';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `${sec} sn önce`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} sa önce`;
  return `${Math.floor(hour / 24)} gün önce`;
}

/** Kanıt satırı: "ÖLÇÜLDÜ · 3 örnek · 12 sn önce". Bilinmeyen parça YAZILMAZ. */
export function evidenceLine(r: EvidenceReading): string {
  const parts: string[] = [sourceLabel(r.source)];
  if (r.samples !== null) parts.push(`${r.samples} örnek`);
  parts.push(agoLabel(r.ageMs));
  return parts.join(' · ');
}

/** Tazelik hükmü → kanıt kaynağı. Okunamamış/hiç görülmemiş veri kaynaksızdır. */
function sourceFromState(state: FreshnessState, dataSource: DataSource): EvidenceSource {
  if (state === 'UNKNOWN' || state === 'NEVER_SEEN') return 'NONE';
  if (dataSource === 'UNKNOWN') return 'DERIVED';
  return 'MEASURED';
}

export interface ThresholdRule {
  /** Bu değerin ÜSTÜ kritik. */
  readonly criticalAbove?: number;
  /** Bu değerin ALTI kritik. */
  readonly criticalBelow?: number;
  readonly warnAbove?: number;
  readonly warnBelow?: number;
}

/**
 * Ölçüm + eşik → hüküm.
 *
 * İKİ KAPI (pazarlıksız):
 *  1. Değer `null` ise hüküm DAİMA `NO_EVIDENCE` — eşiklere hiç bakılmaz.
 *  2. Veri CANLI değilse (`STALE`/`OFFLINE`) hüküm en fazla `WARNING`'e
 *     çıkar ve ASLA `VERIFIED` olmaz: bayat ölçüm "sağlıklı" kanıtı değildir.
 *     Ama bayat veri kritik eşiği aşıyorsa kritik KALIR — güvenlik sinyali
 *     tazelik yüzünden yumuşatılmaz.
 */
export function judge(
  m: Measurement | null | undefined,
  rule: ThresholdRule = {},
): EvidenceReading {
  if (!m || m.value === null || !Number.isFinite(m.value)) return NO_EVIDENCE;

  const value = m.value;
  const source = sourceFromState(m.state, m.source);
  if (source === 'NONE') {
    return { verdict: 'NO_EVIDENCE', value: null, source: 'NONE', samples: null, ageMs: m.ageMs, freshness: m.state };
  }

  let verdict: Verdict = 'VERIFIED';
  if (rule.warnAbove !== undefined && value > rule.warnAbove) verdict = 'WARNING';
  if (rule.warnBelow !== undefined && value < rule.warnBelow) verdict = 'WARNING';
  if (rule.criticalAbove !== undefined && value > rule.criticalAbove) verdict = 'CRITICAL';
  if (rule.criticalBelow !== undefined && value < rule.criticalBelow) verdict = 'CRITICAL';

  /* Bayat veri "kanıtlı sağlıklı" olamaz — en fazla uyarıdır. */
  if (verdict === 'VERIFIED' && m.state !== 'LIVE') verdict = 'WARNING';

  return { verdict, value, source, samples: null, ageMs: m.ageMs, freshness: m.state };
}

/* ── Araç düzeyi hüküm ─────────────────────────────────────────────────── */

export interface VehicleVerdict {
  readonly verdict: Verdict;
  /** Hükmü belirleyen metrik adı — "neden" görünür olmalı. */
  readonly reason: string;
  readonly readings: {
    readonly battery: EvidenceReading;
    readonly engineTemp: EvidenceReading;
    readonly gpsFreshness: EvidenceReading;
    readonly speed: EvidenceReading;
  };
}

export const BATTERY_RULE: ThresholdRule  = { criticalBelow: 11.8, warnBelow: 12.2, warnAbove: 14.8 };
export const ENGINE_RULE: ThresholdRule   = { criticalAbove: 110, warnAbove: 100 };
export const GPS_AGE_RULE: ThresholdRule  = { criticalAbove: 6, warnAbove: 3 };

/**
 * Bir aracın toplam hükmü — en acil metrik kazanır.
 *
 * HİÇBİR metrikte kanıt yoksa araç `NO_EVIDENCE`'tır: "sorun yok" DEĞİL,
 * "bilmiyoruz". Bu ayrım ürünün tamamında korunur.
 */
export function judgeVehicle(
  t: VehicleFreshness | null | undefined,
  batteryVolts: number | null,
): VehicleVerdict {
  const engineTemp = judge(t?.engineTempC, ENGINE_RULE);
  const speed = judge(t?.speedKmh);

  /* Akü voltajı telemetri gerçek katmanında ayrı bir ölçüm olarak taşınmaz;
     elde varsa ham değer, cihaz tazeliğiyle birlikte hükme sokulur. */
  const battery: EvidenceReading =
    batteryVolts === null || !Number.isFinite(batteryVolts) || !t
      ? NO_EVIDENCE
      : judge(
          {
            value: batteryVolts,
            state: t.device,
            observedAt: t.deviceLastSeenAt,
            ageMs: t.deviceAgeMs,
            source: 'HEAD_UNIT_OBD',
          },
          BATTERY_RULE,
        );

  /* GPS TAZELİĞİ bir ölçüm DEĞİL, ölçümün yaşıdır: konumun kendisi varsa
     yaşı saniyeye çevrilip hükme sokulur. Konum hiç yoksa kanıt yoktur. */
  const gpsFreshness: EvidenceReading =
    !t || t.locationAgeMs === null || t.location === 'NEVER_SEEN' || t.location === 'UNKNOWN'
      ? NO_EVIDENCE
      : judge(
          {
            value: Math.round(t.locationAgeMs / 1000),
            state: t.location,
            observedAt: t.locationObservedAt,
            ageMs: t.locationAgeMs,
            source: t.locationSource,
          },
          GPS_AGE_RULE,
        );

  const candidates: Array<[string, EvidenceReading]> = [
    ['Motor sıcaklığı', engineTemp],
    ['Akü voltajı', battery],
    ['GPS tazeliği', gpsFreshness],
  ];

  let verdict: Verdict = 'NO_EVIDENCE';
  let reason = 'Hiçbir metrikte kanıt yok';
  for (const [name, reading] of candidates) {
    if (VERDICT_RANK[reading.verdict] > VERDICT_RANK[verdict]) {
      verdict = reading.verdict;
      reason = name;
    }
  }
  if (verdict === 'VERIFIED') reason = 'Tüm ölçümler eşik içinde';

  return { verdict, reason, readings: { battery, engineTemp, gpsFreshness, speed } };
}

/* ── Filo düzeyi sayım ─────────────────────────────────────────────────── */

export interface FleetTally {
  readonly total: number;
  readonly verified: number;
  readonly warning: number;
  readonly critical: number;
  readonly noEvidence: number;
  readonly offline: number;
}

export function tallyFleet(
  verdicts: readonly { verdict: Verdict; offline: boolean }[],
): FleetTally {
  let verified = 0, warning = 0, critical = 0, noEvidence = 0, offline = 0;
  for (const v of verdicts) {
    if (v.offline) offline += 1;
    switch (v.verdict) {
      case 'VERIFIED':    verified += 1; break;
      case 'WARNING':     warning += 1; break;
      case 'CRITICAL':    critical += 1; break;
      case 'NO_EVIDENCE': noEvidence += 1; break;
    }
  }
  return { total: verdicts.length, verified, warning, critical, noEvidence, offline };
}
