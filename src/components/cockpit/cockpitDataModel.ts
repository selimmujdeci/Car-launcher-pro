/**
 * cockpitDataModel — Digital Cockpit GÖSTERİM SÖZLEŞMESİ (SAF).
 *
 * ── TEK KURAL ─────────────────────────────────────────────────────────────
 * **Değer UYDURULMAZ.** Ölçülmemiş her alan `null` taşır ve ekrana `—` olarak
 * çıkar. `0` ile "bilinmiyor" burada YAPISAL OLARAK farklıdır: duran araç ile
 * verisi olmayan araç aynı şey değildir (CLAUDE.md §8).
 *
 * Bu dosya yalnız BİÇİMLENDİRİR ve BANTLAR. Hiçbir sinyali kendisi okumaz,
 * hiçbir otoriteyi kopyalamaz — girdiyi `useCockpitData` kanonik kaynaklardan
 * toplar. Bu ayrım testability + "kararın nerede verildiği" netliği içindir.
 *
 * SAF: I/O YOK · React YOK · timer YOK · `Date.now` YOK · global durum YOK.
 */

/** Ölçülmemiş değerin TEK gösterimi. */
export const EM_DASH = '—';

/** Bir ölçümün gösterim sağlığı — bayat değer canlı gibi DONMAZ. */
export type CockpitFreshness = 'LIVE' | 'STALE' | 'UNAVAILABLE';

/* ══════════════════════════════════════════════════════════════════════════
 * Ham (okunmuş) kokpit durumu — hepsi `null` olabilir
 * ════════════════════════════════════════════════════════════════════════ */

export interface CockpitManeuver {
  /** Metre cinsinden manevraya kalan mesafe; bilinmiyorsa `null`. */
  readonly distanceMeters: number | null;
  /** Sokak adı ya da yönerge metni; yoksa `null`. */
  readonly label: string | null;
  /** OSRM manevra tipi ('turn' · 'arrive'…); yoksa `null`. */
  readonly type: string | null;
  /** OSRM yön değiştirici ('left' · 'right' · 'straight'…); yoksa `null`. */
  readonly modifier: string | null;
  /** Dönel kavşak çıkış numarası; sağlayıcı bildirmediyse `null` (UYDURULMAZ). */
  readonly roundaboutExit?: number | null;
  /** Hemen ardından gelen YAKIN manevra (routingService yığını); yoksa `null`. */
  readonly then?: { readonly type: string | null; readonly modifier: string | null } | null;
}

export interface CockpitMedia {
  readonly title: string | null;
  readonly artist: string | null;
  readonly artworkUrl: string | null;
  readonly playing: boolean;
  /** Oynatma otoritesi kullanılabilir mi (izin/kaynak yoksa transport pasif). */
  readonly available: boolean;
}

export interface CockpitState {
  readonly speedKmh: number | null;
  readonly speedLimitKmh: number | null;
  /** Hız limiti KESİN mi (kesin değilse levha kesikli çizilir). */
  readonly speedLimitDefinitive: boolean;
  /** Hız sınırı aşılıyor mu (levha kırmızı) — karar `overspeedModel`. */
  readonly speedOverLimit?: boolean;
  /** Öndeki viraj önerisi (rota geometrisinden); yoksa `null`/tanımsız. */
  readonly curve?: { readonly advisoryKmh: number; readonly direction: 'left' | 'right'; readonly distanceM: number } | null;
  readonly rpm: number | null;
  readonly rpmRedline: number | null;
  readonly coolantTempC: number | null;
  readonly coolantFreshness: CockpitFreshness;
  readonly rangeKm: number | null;
  readonly fuelLevelPct: number | null;
  readonly avgConsumptionL100: number | null;
  readonly odometerKm: number | null;
  readonly ambientTempC: number | null;
  readonly maneuver: CockpitManeuver | null;
  readonly media: CockpitMedia;
  /** Vites göstergesi ('P' · 'R' · 'N' · 'D'); CAN bildirmiyorsa `null`. */
  readonly gear: string | null;
  /** Sürüş modu etiketi ('ECO' · 'SPOR' · 'KONFOR'); ayarlanmamışsa `null`. */
  readonly driveMode: string | null;
  /**
   * ADAS şerit/takip durumu. Bu üründe GERÇEK bir ADAS sinyali YOKTUR
   * (ölçüldü: `laneKeep`/`followingDistance` benzeri hiçbir kanonik alan yok)
   * → her ikisi de `null`dır ve kart o rozetleri GİZLER. Sahte "aktif" YASAK.
   */
  readonly laneAssist: boolean | null;
  readonly followingAssist: boolean | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Fiziksel makullük bantları — bant dışı okuma ÖLÇÜM SAYILMAZ
 * ════════════════════════════════════════════════════════════════════════ */

const BANDS = {
  speed:   { min: 0,    max: 300 },
  rpm:     { min: 0,    max: 12_000 },
  coolant: { min: -40,  max: 200 },
  range:   { min: 0,    max: 2_000 },
  fuel:    { min: 0,    max: 100 },
  consum:  { min: 0,    max: 60 },
  odo:     { min: 0,    max: 2_000_000 },
  ambient: { min: -40,  max: 80 },
} as const;

/** Bant içi sonlu sayı mı; değilse `null` (sahte değer geçirmez). */
export function bandOrNull(v: number | null | undefined, band: { min: number; max: number }): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v >= band.min && v <= band.max ? v : null;
}

export const COCKPIT_BANDS = BANDS;

/* ══════════════════════════════════════════════════════════════════════════
 * Biçimlendiriciler — `null` girerse HEP `EM_DASH` çıkar
 * ════════════════════════════════════════════════════════════════════════ */

export function fmtSpeed(v: number | null): string {
  const n = bandOrNull(v, BANDS.speed);
  return n === null ? EM_DASH : String(Math.round(n));
}

/** Devir x1000 gösterimi (referans: `1.8`). */
export function fmtRpmThousands(v: number | null): string {
  const n = bandOrNull(v, BANDS.rpm);
  return n === null ? EM_DASH : (n / 1000).toFixed(1);
}

export function fmtCoolant(v: number | null): string {
  const n = bandOrNull(v, BANDS.coolant);
  return n === null ? EM_DASH : `${Math.round(n)}°C`;
}

export function fmtRange(v: number | null): string {
  const n = bandOrNull(v, BANDS.range);
  return n === null ? EM_DASH : String(Math.round(n));
}

export function fmtConsumption(v: number | null): string {
  const n = bandOrNull(v, BANDS.consum);
  return n === null ? EM_DASH : `${n.toFixed(1)} L/100km`;
}

/** Odometre — tr-TR binlik ayracı (referans: `8.326 km`). */
export function fmtOdometer(v: number | null): string {
  const n = bandOrNull(v, BANDS.odo);
  if (n === null) return EM_DASH;
  return `${Math.round(n).toLocaleString('tr-TR')} km`;
}

export function fmtAmbient(v: number | null): string {
  const n = bandOrNull(v, BANDS.ambient);
  return n === null ? EM_DASH : `${Math.round(n)}°C`;
}

/**
 * Manevra mesafesi — 1 km altında metre (50 m'ye yuvarlanmış), üstünde km.
 * `null` → `EM_DASH` (yakında/şimdi gibi uydurma ifade YOK).
 */
export function fmtManeuverDistance(meters: number | null): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return EM_DASH;
  if (meters < 1000) {
    const step = meters < 200 ? 10 : 50;
    return `${Math.max(0, Math.round(meters / step) * step)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Oran hesapları (çubuk/yay dolulukları) — ölçüm yoksa 0 DEĞİL `null`
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Motor sıcaklığı çubuğunun doluluğu (0–1). Bant: 40 °C (soğuk) → 120 °C (sıcak).
 * Referans overlay'de 250 px'lik çubuğun 165 px'i dolu (≈0,66) ve değer 92 °C —
 * bu bant o gözlemle tutarlıdır: (92-40)/(120-40) = 0,65.
 */
export function coolantFill(tempC: number | null): number | null {
  const n = bandOrNull(tempC, BANDS.coolant);
  if (n === null) return null;
  return Math.max(0, Math.min(1, (n - 40) / 80));
}

/** Yakıt çubuğu doluluğu (0–1) — yüzde ölçülmediyse `null`. */
export function fuelFill(pct: number | null): number | null {
  const n = bandOrNull(pct, BANDS.fuel);
  return n === null ? null : Math.max(0, Math.min(1, n / 100));
}

/** Devir yayının doluluğu (0–1). Kırmızı çizgi bilinmiyorsa 8000 rpm tabanı. */
export function rpmFill(rpm: number | null, redline: number | null): number | null {
  const n = bandOrNull(rpm, BANDS.rpm);
  if (n === null) return null;
  const max = bandOrNull(redline, BANDS.rpm) ?? 8000;
  if (max <= 0) return null;
  return Math.max(0, Math.min(1, n / max));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Vites / sürüş modu etiketleri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * CAN vites konumu → gösterim. `UnifiedVehicleStore.canGearPos` sözleşmesi:
 * -1 = R · 0 = N/P · 1–8 = ileri vites. Sayı bilinmiyorsa `null` (uydurma yok).
 *
 * NOT: 0 KASITLI olarak `'N'` değil `'P'` de değildir — CAN bu ikisini tek
 * değerde birleştiriyor; hangisi olduğunu BİLMİYORUZ. Bu yüzden `'N/P'` yazılır.
 */
export function gearLabel(canGearPos: number | null | undefined): string | null {
  if (typeof canGearPos !== 'number' || !Number.isFinite(canGearPos)) return null;
  if (canGearPos < 0) return 'R';
  if (canGearPos === 0) return 'N/P';
  if (canGearPos >= 1 && canGearPos <= 8) return 'D';
  return null;
}

/** Araç profilindeki sürüş modu tercihi → Türkçe rozet. Ayarlanmamışsa `null`. */
export function driveModeLabel(mode: 'comfort' | 'sport' | 'eco' | undefined | null): string | null {
  switch (mode) {
    case 'eco':     return 'ECO';
    case 'sport':   return 'SPOR';
    case 'comfort': return 'KONFOR';
    default:        return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Boş durum — mock/kapalı hâl ve testler için TEK kaynak
 * ════════════════════════════════════════════════════════════════════════ */

export const EMPTY_COCKPIT_STATE: CockpitState = Object.freeze({
  speedKmh: null,
  speedLimitKmh: null,
  speedLimitDefinitive: false,
  rpm: null,
  rpmRedline: null,
  coolantTempC: null,
  coolantFreshness: 'UNAVAILABLE',
  rangeKm: null,
  fuelLevelPct: null,
  avgConsumptionL100: null,
  odometerKm: null,
  ambientTempC: null,
  maneuver: null,
  media: Object.freeze({
    title: null, artist: null, artworkUrl: null, playing: false, available: false,
  }),
  gear: null,
  driveMode: null,
  laneAssist: null,
  followingAssist: null,
});
