/**
 * vehicleTelemetryFreshness.ts — SİNYAL BAŞINA TAZELİK VE KAYNAK MODELİ (SAF).
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────
 * `vehicleOfflineStatus.ts` içindeki `Connectivity` sözleşmesi telefon
 * doğrulamasının (15/15) dayandığı yüzeydir; enum değerleri DEĞİŞTİRİLMEZ.
 * Bu modül ONUN YERİNE GEÇMEZ, EKLER: cihazın ayakta olması ile her bir
 * sinyalin taze olması AYRI gerçeklerdir.
 *
 * ── ONARILAN YANLIŞ ───────────────────────────────────────────────────
 * Eskiden tek ölçüt vardı: `updated_at < 11 dk → online`. Bu üç ayrı şeyi
 * karıştırıyordu:
 *   · Head unit heartbeat TAZE ama GPS 2 saat eski → konum "canlı" görünüyordu.
 *   · OBD hiç bağlanmamış → `rpm/temp` NULL, ama UI `0` gösteriyordu.
 *   · Araç kapalı → son bilinen konum "şu anki konum" gibi sunuluyordu.
 *
 * ── KURALLAR ──────────────────────────────────────────────────────────
 *   1. `null` ölçüm ASLA `0`/`false`/"normal" olarak sunulmaz → `UNAVAILABLE`.
 *   2. Taze olmayan ölçüm `STALE`'dir; değeri gösterilebilir ama ETİKETLİ.
 *   3. Konum bayatsa "son bilinen konum"dur — canlı DEĞİL.
 *   4. Kaynak bilinmiyorsa `UNKNOWN` (uydurma kaynak YOK).
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

/* ── Sözleşmeler ───────────────────────────────────────────────────────── */

/** Bir sinyalin (konum/motor/sağlık) tazelik hükmü. */
export const FRESHNESS_STATES = [
  'LIVE',        // taze pencere içinde gözlendi
  'STALE',       // gözlendi ama penceresi geçti — "son bilinen"
  'OFFLINE',     // cihaz hiç ulaşılamıyor (heartbeat penceresi de geçti)
  'NEVER_SEEN',  // bu sinyal HİÇ gözlenmedi
  'UNKNOWN',     // okunamadı — hüküm verilemez
] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** Verinin fiziksel kaynağı. `EXTERNAL_GPS` bu paketin KAPSAMI DIŞINDA. */
export const DATA_SOURCES = ['HEAD_UNIT_GPS', 'HEAD_UNIT_OBD', 'EXTERNAL_GPS', 'UNKNOWN'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export function normalizeDataSource(raw: unknown): DataSource {
  return (DATA_SOURCES as readonly string[]).includes(String(raw))
    ? (raw as DataSource)
    : 'UNKNOWN';
}

/** Ölçüm + hükmü birlikte taşır — değer ile durum ASLA ayrılmaz. */
export interface Measurement {
  /** Ölçülen değer; `null` = BİLİNMİYOR (0 değil). */
  readonly value: number | null;
  readonly state: FreshnessState;
  /** Gözlem anı (epoch ms); bilinmiyorsa null. */
  readonly observedAt: number | null;
  /** Veri yaşı (ms); bilinmiyorsa null. */
  readonly ageMs: number | null;
  readonly source: DataSource;
}

const UNAVAILABLE_MEASUREMENT: Measurement = {
  value: null, state: 'UNKNOWN', observedAt: null, ageMs: null, source: 'UNKNOWN',
};

/* ── Pencereler ────────────────────────────────────────────────────────── */

/**
 * Tazelik pencereleri.
 *
 * `DEVICE`: 11 dk — mevcut `OFFLINE_TIMEOUT_MS` ile AYNI (head unit `parked`
 * heartbeat'i 10 dk olduğu için bir kaçırılan atıma tolerans). Değiştirilmedi
 * ki mevcut "online" davranışı bozulmasın.
 * `LOCATION`: 5 dk — head unit'in konum gönderme bayatlık kapısıyla aynı.
 * `ENGINE`: 2 dk — OBD kadansı saniyeler mertebesindedir; 2 dk sonrası motor
 * verisi için "canlı" iddiası edilemez.
 * `HEALTH`: 30 dk — `system_health` 10 dk periyotludur; üç atım toleransı.
 */
export const FRESHNESS_WINDOWS_MS = {
  DEVICE:   11 * 60_000,
  LOCATION:  5 * 60_000,
  ENGINE:    2 * 60_000,
  HEALTH:   30 * 60_000,
} as const;

/* ── Girdi ─────────────────────────────────────────────────────────────── */

/**
 * `vehicle_telemetry` satırının gözlem için gereken alanları.
 * Satır HİÇ yoksa `null` verilir (boş nesne ile KARIŞTIRILMAZ).
 */
export interface TelemetryRow {
  readonly updatedAt?:        string | number | null;
  readonly observedAt?:       string | number | null;
  readonly receivedAt?:       string | number | null;
  readonly gpsObservedAt?:    string | number | null;
  readonly obdObservedAt?:    string | number | null;
  readonly healthObservedAt?: string | number | null;
  readonly lat?:        number | null;
  readonly lng?:        number | null;
  readonly accuracyM?:  number | null;
  readonly speed?:      number | null;
  readonly rpm?:        number | null;
  readonly temp?:       number | null;
  readonly fuel?:       number | null;
  readonly telemetrySource?: unknown;
  readonly locationSource?:  unknown;
}

export interface FreshnessInput {
  readonly now: number;
  /** Telemetri satırı okunamadıysa veya hiç yoksa `null`. */
  readonly row: TelemetryRow | null;
  /** Satırın okunup okunamadığı — `null` "yok" ile "okunamadı"yı ayırır. */
  readonly readable: boolean;
  readonly windows?: Partial<typeof FRESHNESS_WINDOWS_MS>;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

export interface VehicleFreshness {
  /** Cihazın kendisi (heartbeat) — LIVE/OFFLINE/NEVER_SEEN/UNKNOWN. */
  readonly device:   FreshnessState;
  readonly deviceLastSeenAt: number | null;
  readonly deviceAgeMs:      number | null;

  /** Konum hükmü + kaynak. `STALE` = SON BİLİNEN konum. */
  readonly location: FreshnessState;
  readonly locationSource: DataSource;
  readonly locationObservedAt: number | null;
  readonly locationAgeMs: number | null;
  readonly latitude:  number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  /** Konum canlı mı — `false` iken UI "son bilinen konum" DEMEK ZORUNDA. */
  readonly locationIsLive: boolean;

  /** Motor verisi (OBD) hükmü. */
  readonly engine: FreshnessState;
  readonly engineObservedAt: number | null;

  readonly speedKmh:    Measurement;
  readonly rpm:         Measurement;
  readonly engineTempC: Measurement;
  readonly fuelPercent: Measurement;

  readonly health: FreshnessState;
  readonly healthObservedAt: number | null;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** ISO veya epoch ms → epoch ms. Geçersizse `null` (uydurma tarih YOK). */
export function toEpochMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ts = Date.parse(v);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Bir sinyalin hükmünü verir.
 *
 * `deviceState` girdisi ŞART: cihaz tamamen çevrimdışıysa alt sinyal
 * "STALE" değil **OFFLINE**'dır — kullanıcıya "veri eskimiş" değil
 * "araç çevrimdışı" demek doğrudur.
 */
export function judgeFreshness(
  observedAt: number | null,
  now: number,
  windowMs: number,
  deviceState: FreshnessState,
  readable: boolean,
): { state: FreshnessState; ageMs: number | null } {
  if (!readable) return { state: 'UNKNOWN', ageMs: null };
  if (observedAt === null) {
    // Cihaz hiç görülmediyse sinyal de görülmemiştir.
    return { state: deviceState === 'NEVER_SEEN' ? 'NEVER_SEEN' : 'NEVER_SEEN', ageMs: null };
  }
  const age = now - observedAt;
  if (age <= windowMs) return { state: 'LIVE', ageMs: age };
  // Pencere geçti: cihaz da çevrimdışıysa OFFLINE, değilse STALE.
  return { state: deviceState === 'OFFLINE' ? 'OFFLINE' : 'STALE', ageMs: age };
}

/** Ölçümü hükümle birlikte kurar. Değer `null` ise durum daima UNAVAILABLE-eş. */
function measure(
  value: number | null | undefined,
  state: FreshnessState,
  observedAt: number | null,
  ageMs: number | null,
  source: DataSource,
): Measurement {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (v === null) {
    // BİLİNMİYOR: değer yok → 0 GÖSTERİLMEZ, durum da ölçüm yokluğunu yansıtır.
    return { value: null, state: state === 'UNKNOWN' ? 'UNKNOWN' : 'NEVER_SEEN', observedAt, ageMs, source };
  }
  return { value: v, state, observedAt, ageMs, source };
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildVehicleFreshness(input: FreshnessInput): VehicleFreshness {
  const W = { ...FRESHNESS_WINDOWS_MS, ...(input.windows ?? {}) };
  const { now, row, readable } = input;

  if (!readable || row === null) {
    const state: FreshnessState = readable ? 'NEVER_SEEN' : 'UNKNOWN';
    return {
      device: state, deviceLastSeenAt: null, deviceAgeMs: null,
      location: state, locationSource: 'UNKNOWN', locationObservedAt: null,
      locationAgeMs: null, latitude: null, longitude: null, accuracyM: null,
      locationIsLive: false,
      engine: state, engineObservedAt: null,
      speedKmh:    { ...UNAVAILABLE_MEASUREMENT, state },
      rpm:         { ...UNAVAILABLE_MEASUREMENT, state },
      engineTempC: { ...UNAVAILABLE_MEASUREMENT, state },
      fuelPercent: { ...UNAVAILABLE_MEASUREMENT, state },
      health: state, healthObservedAt: null,
    };
  }

  /* ── Cihaz (heartbeat) ──────────────────────────────────────────────── */
  const deviceAt = toEpochMs(row.updatedAt ?? row.receivedAt ?? row.observedAt ?? null);
  let device: FreshnessState;
  let deviceAgeMs: number | null = null;
  if (deviceAt === null) {
    device = 'NEVER_SEEN';
  } else {
    deviceAgeMs = now - deviceAt;
    device = deviceAgeMs <= W.DEVICE ? 'LIVE' : 'OFFLINE';
  }

  /* ── Konum ──────────────────────────────────────────────────────────── */
  const locAt = toEpochMs(row.gpsObservedAt ?? null);
  const locSource = normalizeDataSource(row.locationSource);
  const hasCoords =
    typeof row.lat === 'number' && Number.isFinite(row.lat) &&
    typeof row.lng === 'number' && Number.isFinite(row.lng);

  let location: FreshnessState;
  let locationAgeMs: number | null = null;
  if (!hasCoords) {
    location = 'NEVER_SEEN';
  } else if (locAt === null) {
    /* Koordinat var ama gözlem damgası YOK (042 öncesi yazılmış satır).
       "Canlı" İDDİA EDİLMEZ → STALE (cihaz çevrimdışıysa OFFLINE). */
    location = device === 'OFFLINE' ? 'OFFLINE' : 'STALE';
  } else {
    const j = judgeFreshness(locAt, now, W.LOCATION, device, true);
    location = j.state;
    locationAgeMs = j.ageMs;
  }

  /* ── Motor (OBD) ────────────────────────────────────────────────────── */
  const obdAt = toEpochMs(row.obdObservedAt ?? null);
  const engineJudge = judgeFreshness(obdAt, now, W.ENGINE, device, true);
  const engine = engineJudge.state;
  const engineSource: DataSource = obdAt === null ? 'UNKNOWN' : 'HEAD_UNIT_OBD';

  /* ── Sağlık ─────────────────────────────────────────────────────────── */
  const healthAt = toEpochMs(row.healthObservedAt ?? null);
  const health = judgeFreshness(healthAt, now, W.HEALTH, device, true).state;

  /* ── Ölçümler ───────────────────────────────────────────────────────── */
  const telSource = normalizeDataSource(row.telemetrySource);

  return {
    device, deviceLastSeenAt: deviceAt, deviceAgeMs,
    location, locationSource: locSource, locationObservedAt: locAt,
    locationAgeMs,
    latitude:  hasCoords ? (row.lat as number) : null,
    longitude: hasCoords ? (row.lng as number) : null,
    accuracyM: typeof row.accuracyM === 'number' && Number.isFinite(row.accuracyM) ? row.accuracyM : null,
    locationIsLive: location === 'LIVE',
    engine, engineObservedAt: obdAt,
    speedKmh:    measure(row.speed, engine, obdAt, engineJudge.ageMs, telSource),
    rpm:         measure(row.rpm,   engine, obdAt, engineJudge.ageMs, engineSource),
    engineTempC: measure(row.temp,  engine, obdAt, engineJudge.ageMs, engineSource),
    fuelPercent: measure(row.fuel,  engine, obdAt, engineJudge.ageMs, engineSource),
    health, healthObservedAt: healthAt,
  };
}

/** Canlı (realtime) güncelleme paketi — bilinmeyen alan `Number.isFinite` düşer. */
export interface FreshnessUpdate {
  readonly lat?: number; readonly lng?: number;
  readonly speed?: number; readonly fuel?: number;
  readonly engineTemp?: number; readonly rpm?: number;
  readonly timestamp: number;
}

/**
 * Canlı güncellemeyi gerçek katmanına uygular.
 *
 * Kural: gelen değer geçerli DEĞİLSE önceki gerçek KORUNUR (null ise null
 * kalır) — eksik alan `0` yapılmaz. Geçerli alan `LIVE` olur; güncellemede
 * hiç yer almayan alanların tazeliği DEĞİŞMEZ.
 */
export function applyFreshnessUpdate(
  prev: VehicleFreshness | undefined,
  u: FreshnessUpdate,
): VehicleFreshness | undefined {
  if (!prev) return prev;
  const at = Number.isFinite(u.timestamp) ? u.timestamp : null;
  const live = (m: Measurement, v: number | undefined, source: DataSource): Measurement =>
    typeof v === 'number' && Number.isFinite(v)
      ? { value: v, state: 'LIVE', observedAt: at, ageMs: 0, source }
      : m;

  const hasCoords = Number.isFinite(u.lat) && Number.isFinite(u.lng);
  return {
    ...prev,
    device: at === null ? prev.device : 'LIVE',
    deviceLastSeenAt: at ?? prev.deviceLastSeenAt,
    deviceAgeMs: at === null ? prev.deviceAgeMs : 0,
    location: hasCoords ? 'LIVE' : prev.location,
    locationObservedAt: hasCoords ? at : prev.locationObservedAt,
    locationAgeMs: hasCoords ? 0 : prev.locationAgeMs,
    latitude:  hasCoords ? (u.lat as number) : prev.latitude,
    longitude: hasCoords ? (u.lng as number) : prev.longitude,
    locationIsLive: hasCoords ? true : prev.locationIsLive,
    engine: Number.isFinite(u.rpm) || Number.isFinite(u.engineTemp) || Number.isFinite(u.speed)
      ? 'LIVE' : prev.engine,
    engineObservedAt: Number.isFinite(u.rpm) || Number.isFinite(u.engineTemp)
      ? at : prev.engineObservedAt,
    speedKmh:    live(prev.speedKmh,    u.speed,      prev.speedKmh.source),
    rpm:         live(prev.rpm,         u.rpm,        'HEAD_UNIT_OBD'),
    engineTempC: live(prev.engineTempC, u.engineTemp, 'HEAD_UNIT_OBD'),
    fuelPercent: live(prev.fuelPercent, u.fuel,       'HEAD_UNIT_OBD'),
  };
}

/**
 * Aracı çevrimdışı olarak işaretler — ÖLÇÜMLERİ SİLMEDEN.
 *
 * Bekçi (watchdog) süresi dolduğunda önceden `speed: 0, rpm: 0` yazılıyordu;
 * bu uydurma ölçümdü. Doğrusu: son ölçüm KORUNUR, ama artık `LIVE` DEĞİL —
 * `OFFLINE` olarak etiketlenir ve UI "araç çevrimdışı" der.
 * Hiç ölçülmemiş (`null`) alanlar `NEVER_SEEN` kalır: yokluk çevrimdışılıkla
 * karıştırılmaz.
 */
export function markVehicleOffline(f: VehicleFreshness): VehicleFreshness {
  const demote = (m: Measurement): Measurement =>
    m.value === null ? m : { ...m, state: 'OFFLINE' };
  return {
    ...f,
    device:   'OFFLINE',
    location: f.location === 'NEVER_SEEN' || f.location === 'UNKNOWN' ? f.location : 'OFFLINE',
    engine:   f.engine   === 'NEVER_SEEN' || f.engine   === 'UNKNOWN' ? f.engine   : 'OFFLINE',
    health:   f.health   === 'NEVER_SEEN' || f.health   === 'UNKNOWN' ? f.health   : 'OFFLINE',
    locationIsLive: false,
    speedKmh:    demote(f.speedKmh),
    rpm:         demote(f.rpm),
    engineTempC: demote(f.engineTempC),
    fuelPercent: demote(f.fuelPercent),
  };
}

/* ── Kullanıcıya dönük etiketler (düz Türkçe, teknik sızıntı YOK) ─────── */

export function freshnessLabel(state: FreshnessState): string {
  switch (state) {
    case 'LIVE':       return 'Canlı';
    case 'STALE':      return 'Eski veri';
    case 'OFFLINE':    return 'Araç çevrimdışı';
    case 'NEVER_SEEN': return 'Veri yok';
    case 'UNKNOWN':    return 'Okunamadı';
  }
}

export function dataSourceLabel(source: DataSource): string {
  switch (source) {
    case 'HEAD_UNIT_GPS': return 'Araç ünitesi GPS';
    case 'HEAD_UNIT_OBD': return 'Araç ünitesi OBD';
    case 'EXTERNAL_GPS':  return 'Harici GPS';
    case 'UNKNOWN':       return 'Bilinmiyor';
  }
}

/** Konum etiketi — canlı olmayan konum ASLA "şu anki konum" denmez. */
export function locationLabel(f: VehicleFreshness): string {
  if (f.location === 'LIVE')       return 'Canlı konum';
  if (f.location === 'STALE')      return 'Son bilinen konum';
  if (f.location === 'OFFLINE')    return 'Son bilinen konum (araç çevrimdışı)';
  if (f.location === 'NEVER_SEEN') return 'Konum verisi yok';
  return 'Konum okunamadı';
}

/**
 * Ölçüm metni. `null` → "Veri yok"; ölçülen `0` → "0 <birim>".
 * Bayat değer gösterilir ama ETİKETLENİR — sessizce canlı gibi sunulmaz.
 */
export function measurementLabel(m: Measurement, unit: string): string {
  if (m.value === null) return 'Veri yok';
  const value = `${m.value} ${unit}`.trim();
  if (m.state === 'LIVE') return value;
  if (m.state === 'STALE') return `${value} · eski veri`;
  if (m.state === 'OFFLINE') return `${value} · araç çevrimdışı`;
  return value;
}

/** Veri yaşını insan diline çevirir. */
export function ageLabel(ageMs: number | null): string {
  if (ageMs === null) return 'Bilinmiyor';
  if (ageMs < 0) return 'Şimdi';
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return 'Az önce';
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
