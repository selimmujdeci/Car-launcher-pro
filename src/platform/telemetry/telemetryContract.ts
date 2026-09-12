/**
 * telemetryContract.ts — HEAD UNIT → BACKEND TELEMETRİ SÖZLEŞMESİ (SAF).
 *
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────
 * `push_vehicle_event` RPC payload'dan `speed · fuel · temp · rpm · lat · lng ·
 * heading` okuyor; `TelemetryPayload` ise **`rpm` ve `temp` taşımıyordu**.
 * Sonuç: `vehicle_telemetry.rpm` ve `.temp` HİÇ güncellenmiyor, veritabanında
 * kalıcı `0` duruyor ve Fleet tarafında "motor verisi" diye gösterilirse
 * YALAN OLUR. Bu modül sözleşmeyi tek yerde tanımlar ve dürüstlük kurallarını
 * makine düzeyinde zorlar.
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ─────────────────────────────────
 *  1. Bilinmeyen değer `null`'dır — `0`, `false` veya "normal" DEĞİL.
 *  2. `0` YALNIZ gerçekten ölçülen `0` ise gönderilir.
 *  3. `NaN` · `Infinity` · aralık dışı değer REDDEDİLİR (→ `null`).
 *  4. BAYAT kaynak payload'a HİÇ eklenmez (eski değeri yeni gibi sunmak yasak).
 *  5. `observedAt` gözlem anıdır; sunucu `received_at`'i AYRI tutar — istemci
 *     saati tek otorite DEĞİLDİR.
 *  6. Alan yokluğu ile "değer 0" ayrımı korunur: yokluk = anahtar HİÇ konmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK · React YOK.
 * Zaman ve tüm girdiler DIŞARIDAN verilir → testler saat oynatır, cihaz gerekmez.
 */

/* ── Kaynak sözleşmesi ─────────────────────────────────────────────────── */

/**
 * Verinin FİZİKSEL kaynağı. Gelecekte harici GPS eklenebilsin diye enum açık
 * bırakıldı — bu paket harici GPS UYGULAMAZ, yalnız yeri ayrılmıştır.
 */
export const TELEMETRY_SOURCES = [
  'HEAD_UNIT_GPS',
  'HEAD_UNIT_OBD',
  'UNKNOWN',
] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

/* ── Doğrulama sınırları ───────────────────────────────────────────────── */

/**
 * Aralıklar. Gerekçe:
 *  · `rpm` 0–20000 — OBD PID 010C ham çözünürlüğü ((A*256+B)/4) 16383.75'e kadar
 *    çıkar; üst sınır bunu kapsayacak biçimde yuvarlanmıştır.
 *  · `engineTempC` -50–250 — PID 0105 kodlaması `A-40` → -40..215 °C; ölçüm
 *    hatası payıyla genişletildi.
 *  · `speedKmh` 0–400 — `UnifiedVehicleStore` hız güvenlik kapısıyla aynı mertebe.
 *  · `fuelPercent` 0–100 — PID 012F yüzde.
 *  · `headingDeg` 0–360 (360 kabul, 360'a normalize edilmez; ham tutulur).
 *  · `accuracyM` 0–10000 — GPS doğruluğu; üstü anlamsız/çöp kabul edilir.
 */
export const TELEMETRY_RANGES = {
  rpm:          { min: 0,    max: 20_000 },
  engineTempC:  { min: -50,  max: 250 },
  speedKmh:     { min: 0,    max: 400 },
  fuelPercent:  { min: 0,    max: 100 },
  latitude:     { min: -90,  max: 90 },
  longitude:    { min: -180, max: 180 },
  headingDeg:   { min: 0,    max: 360 },
  accuracyM:    { min: 0,    max: 10_000 },
} as const satisfies Record<string, { min: number; max: number }>;

export type TelemetryRangeKey = keyof typeof TELEMETRY_RANGES;

/**
 * Sayısal değeri sözleşmeye göre süzer.
 * `null` döner: yok · null · undefined · NaN · ±Infinity · aralık dışı.
 * `0` GEÇER (ölçülen sıfır meşrudur).
 */
export function sanitizeMetric(
  value: unknown,
  key: TelemetryRangeKey,
): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;         // NaN · Infinity
  const { min, max } = TELEMETRY_RANGES[key];
  if (value < min || value > max) return null;      // aralık dışı → BİLİNMİYOR
  return value;
}

/**
 * OBD "desteklenmiyor" işaretçisi. `OBDData` alanları desteklenmeyen sinyali
 * `-1` ile gösterir (ör. EV'de `rpm: -1`). Bu `0` DEĞİLDİR ve buluta
 * gönderilmemelidir.
 */
export function isUnsupportedObdValue(value: unknown): boolean {
  return typeof value === 'number' && value === -1;
}

/** OBD alanını süzer: `-1` (desteklenmiyor) ve aralık dışı → `null`. */
export function sanitizeObdMetric(
  value: unknown,
  key: TelemetryRangeKey,
): number | null {
  if (isUnsupportedObdValue(value)) return null;
  return sanitizeMetric(value, key);
}

/* ── Girdi sözleşmesi ──────────────────────────────────────────────────── */

/** OBD tarafından gözlenen anlık değerler + tazelik kanıtı. */
export interface ObdObservation {
  /** OBD transport bağlı ve kaynak gerçek mi (`source === 'real'`). */
  readonly connected: boolean;
  /** ECU verisi TAZE mi (`OBDData.dataFresh`). */
  readonly fresh: boolean;
  /** Son GEÇERLİ ECU frame'i (Unix ms). `0` = hiç alınmadı. */
  readonly lastSeenMs: number;
  /** Aktif protokol kadansından türeyen tazelik penceresi (ms). */
  readonly freshWindowMs: number;
  readonly rpm?: unknown;
  readonly engineTempC?: unknown;
  readonly speedKmh?: unknown;
  readonly fuelPercent?: unknown;
}

/** GPS tarafından gözlenen konum + tazelik kanıtı. */
export interface GpsObservation {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly headingDeg?: unknown;
  readonly accuracyM?: unknown;
  /** Son konum düzeltmesi (Unix ms). `0`/yok = hiç alınmadı. */
  readonly lastFixMs?: number;
  /** Konumun bayat sayılacağı süre (ms). */
  readonly freshWindowMs?: number;
}

export interface TelemetryBuildInput {
  readonly nowMs: number;
  readonly obd?: ObdObservation | null;
  readonly gps?: GpsObservation | null;
  /** OBD dışı, füzyonlanmış hız (km/h) — OBD yoksa yedek. */
  readonly fusedSpeedKmh?: unknown;
  readonly speedConfidence?: unknown;
  readonly reverse?: boolean;
}

/* ── Çıktı sözleşmesi ──────────────────────────────────────────────────── */

/**
 * Buluta giden alanlar.
 *
 * ⚠️ ANAHTAR ADLARI `push_vehicle_event` ile UYUMLU olmak ZORUNDA:
 * RPC `payload->>'speed' | 'fuel' | 'temp' | 'rpm' | 'lat' | 'lng' | 'heading'`
 * okur. Normalize adlar (`speedKmh` vb.) EK olarak taşınır — RPC anahtarları
 * kaldırılırsa mevcut yazma yolu sessizce ölür.
 *
 * Bir alan BİLİNMİYORSA anahtar HİÇ KONMAZ (`undefined`) — böylece
 * `NULLIF(payload->>'x','')` `NULL` görür ve sunucu eski değeri KORUR.
 */
export interface TelemetryFields {
  /* RPC uyumlu anahtarlar */
  speed?:   number;
  fuel?:    number;
  temp?:    number;
  rpm?:     number;
  lat?:     number;
  lng?:     number;
  heading?: number;

  /* Normalize + gözlemlenebilirlik alanları */
  speedKmh?:      number;
  fuelPercent?:   number;
  engineTempC?:   number;
  latitude?:      number;
  longitude?:     number;
  headingDeg?:    number;
  accuracyM?:     number;

  /** Gözlem anı (Unix ms) — sunucu `received_at`'i AYRI tutar. */
  observedAt?:    number;
  /** OBD alanlarının gözlem anı; OBD bayatsa HİÇ konmaz. */
  obdObservedAt?: number;
  /** GPS alanlarının gözlem anı; GPS bayatsa HİÇ konmaz. */
  gpsObservedAt?: number;
  /** Baskın kaynak — hangi alt sistemden veri geldiği. */
  source?:        TelemetrySource;
  /** Konumun kaynağı (bu pakette daima head unit GPS'i). */
  locationSource?: TelemetrySource;

  reverse?:         boolean;
  speedConfidence?: number;
}

/** Neyin niçin düşürüldüğünü açıklar — LAB gözlemi ve testler için. */
export interface TelemetryBuildReport {
  readonly fields: TelemetryFields;
  /** Payload'a giren anahtarlar (LAB `lastPayloadFieldPresence`). */
  readonly presentKeys: readonly string[];
  /** OBD bayat/bağlı değil → OBD alanları atlandı. */
  readonly obdSkipped: boolean;
  readonly obdSkipReason: 'not_connected' | 'not_fresh' | 'stale_window' | 'no_data' | null;
  /** GPS bayat/yok → konum atlandı. */
  readonly gpsSkipped: boolean;
  readonly gpsSkipReason: 'no_fix' | 'stale_window' | 'invalid_coords' | null;
  /** Aralık/NaN yüzünden reddedilen alanlar. */
  readonly rejected: readonly string[];
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

/**
 * Telemetri alanlarını KANIT'a göre kurar.
 *
 * Kural: bir kaynak bayatsa o kaynağın TÜM alanları atlanır — kısmen taze
 * göstermek "eski veriyi canlı gibi sunmak"tır ve yasaktır.
 */
export function buildTelemetryFields(input: TelemetryBuildInput): TelemetryBuildReport {
  const fields: TelemetryFields = {};
  const rejected: string[] = [];

  /* ── OBD ────────────────────────────────────────────────────────────── */
  let obdSkipped = true;
  let obdSkipReason: TelemetryBuildReport['obdSkipReason'] = 'no_data';
  const obd = input.obd ?? null;

  if (obd) {
    if (!obd.connected) {
      obdSkipReason = 'not_connected';
    } else if (!obd.fresh) {
      obdSkipReason = 'not_fresh';
    } else if (!(obd.lastSeenMs > 0)) {
      obdSkipReason = 'no_data';
    } else if (
      Number.isFinite(obd.freshWindowMs) && obd.freshWindowMs > 0 &&
      input.nowMs - obd.lastSeenMs > obd.freshWindowMs
    ) {
      obdSkipReason = 'stale_window';
    } else {
      obdSkipped = false;
      obdSkipReason = null;

      const rpm  = sanitizeObdMetric(obd.rpm, 'rpm');
      const temp = sanitizeObdMetric(obd.engineTempC, 'engineTempC');
      const spd  = sanitizeObdMetric(obd.speedKmh, 'speedKmh');
      const fuel = sanitizeObdMetric(obd.fuelPercent, 'fuelPercent');

      if (obd.rpm !== undefined && rpm === null && !isUnsupportedObdValue(obd.rpm)) rejected.push('rpm');
      if (obd.engineTempC !== undefined && temp === null && !isUnsupportedObdValue(obd.engineTempC)) rejected.push('engineTempC');
      if (obd.speedKmh !== undefined && spd === null && !isUnsupportedObdValue(obd.speedKmh)) rejected.push('speedKmh');
      if (obd.fuelPercent !== undefined && fuel === null && !isUnsupportedObdValue(obd.fuelPercent)) rejected.push('fuelPercent');

      // RPC anahtarı + normalize ad birlikte yazılır (ikisi de sözleşmenin parçası).
      if (rpm  !== null) fields.rpm = rpm;                              // `rpm` her iki sözleşmede aynı
      if (temp !== null) { fields.temp  = temp; fields.engineTempC = temp; }
      if (spd  !== null) { fields.speed = spd;  fields.speedKmh    = spd; }
      if (fuel !== null) { fields.fuel  = fuel; fields.fuelPercent = fuel; }

      if (rpm !== null || temp !== null || spd !== null || fuel !== null) {
        fields.obdObservedAt = obd.lastSeenMs;
        fields.source = 'HEAD_UNIT_OBD';
      }
    }
  }

  /* ── Füzyonlanmış hız (OBD hızı yoksa yedek) ────────────────────────── */
  if (fields.speed === undefined) {
    const fused = sanitizeMetric(input.fusedSpeedKmh, 'speedKmh');
    if (fused !== null) {
      fields.speed = fused;
      fields.speedKmh = fused;
      if (fields.source === undefined) fields.source = 'HEAD_UNIT_GPS';
    } else if (input.fusedSpeedKmh !== undefined && input.fusedSpeedKmh !== null) {
      rejected.push('fusedSpeedKmh');
    }
  }

  /* ── GPS ────────────────────────────────────────────────────────────── */
  let gpsSkipped = true;
  let gpsSkipReason: TelemetryBuildReport['gpsSkipReason'] = 'no_fix';
  const gps = input.gps ?? null;

  if (gps) {
    const lat = sanitizeMetric(gps.latitude,  'latitude');
    const lng = sanitizeMetric(gps.longitude, 'longitude');
    const fixMs = typeof gps.lastFixMs === 'number' ? gps.lastFixMs : 0;
    const win   = typeof gps.freshWindowMs === 'number' ? gps.freshWindowMs : 0;

    if (lat === null || lng === null) {
      gpsSkipReason = (gps.latitude !== undefined || gps.longitude !== undefined)
        ? 'invalid_coords' : 'no_fix';
      if (gps.latitude !== undefined && lat === null) rejected.push('latitude');
      if (gps.longitude !== undefined && lng === null) rejected.push('longitude');
    } else if (!(fixMs > 0)) {
      gpsSkipReason = 'no_fix';
    } else if (win > 0 && input.nowMs - fixMs > win) {
      // BAYAT KONUM GÖNDERİLMEZ — eski konumu canlı gibi sunmak yasak.
      gpsSkipReason = 'stale_window';
    } else {
      gpsSkipped = false;
      gpsSkipReason = null;
      fields.lat = lat;      fields.latitude  = lat;
      fields.lng = lng;      fields.longitude = lng;

      const hdg = sanitizeMetric(gps.headingDeg, 'headingDeg');
      if (hdg !== null) { fields.heading = hdg; fields.headingDeg = hdg; }
      else if (gps.headingDeg !== undefined && gps.headingDeg !== null) rejected.push('headingDeg');

      const acc = sanitizeMetric(gps.accuracyM, 'accuracyM');
      if (acc !== null) fields.accuracyM = acc;
      else if (gps.accuracyM !== undefined && gps.accuracyM !== null) rejected.push('accuracyM');

      fields.gpsObservedAt  = fixMs;
      fields.locationSource = 'HEAD_UNIT_GPS';
      if (fields.source === undefined) fields.source = 'HEAD_UNIT_GPS';
    }
  }

  /* ── Ortak alanlar ──────────────────────────────────────────────────── */
  if (typeof input.reverse === 'boolean') fields.reverse = input.reverse;

  const conf = typeof input.speedConfidence === 'number' && Number.isFinite(input.speedConfidence)
    ? Math.max(0, Math.min(1, input.speedConfidence))
    : null;
  if (conf !== null) fields.speedConfidence = conf;

  // Gözlem anı: en TAZE alt kaynak. Hiç kaynak yoksa yine `nowMs` (heartbeat'in
  // kendisi bir gözlemdir: "cihaz ayakta") — ama ölçüm alanı EKLENMEZ.
  const stamps = [fields.obdObservedAt, fields.gpsObservedAt].filter(
    (x): x is number => typeof x === 'number' && x > 0,
  );
  fields.observedAt = stamps.length > 0 ? Math.max(...stamps) : input.nowMs;
  if (fields.source === undefined) fields.source = 'UNKNOWN';

  return {
    fields,
    presentKeys: Object.keys(fields).sort(),
    obdSkipped,
    obdSkipReason,
    gpsSkipped,
    gpsSkipReason,
    rejected,
  };
}
