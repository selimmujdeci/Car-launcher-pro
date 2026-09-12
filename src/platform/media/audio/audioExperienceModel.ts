/**
 * audioExperienceModel.ts — MUSIC F6 · Ses Deneyimi / DSP KARAR MODELİ (SAF).
 *
 * NE YAPAR: cihazın BİLDİRDİĞİ DSP yeteneklerini alır; hangi kontrolün
 * çizileceğine, bir preset'in bu cihazın gerçek bant frekanslarına NASIL
 * yansıtılacağına, kullanıcı ayarının nasıl sınırlanacağına ve clipping'i
 * önlemek için ne kadar headroom (güvenlik preamp'i) gerektiğine karar verir.
 *
 * NE YAPMAZ:
 *   · playback truth üretmez (F0 · CarosPlaybackService)
 *   · kullanıcı sesini (userVolume) hesaplamaz (volumePolicy)
 *   · ducking kararı vermez (duckPolicy · CarosAudioFocusManager)
 *   · kaynak devri yapmaz (sourceCoordinator)
 *   · native çağırmaz, kalıcı yazmaz, zamanlayıcı kurmaz
 *
 * DÜRÜSTLÜK SÖZLEŞMESİ:
 *   · Cihaz sorgulanmadıysa yetenek `probed: false` ve HER ŞEY desteklenmiyor
 *     sayılır — "muhtemelen vardır" varsayımı ÜRETİLMEZ.
 *   · Desteklenmeyen kontrol RENDER EDİLMEZ ("disabled mezarlığı" kurulmaz).
 *   · Preset yalnız GERÇEK bir EQ eğrisidir; "AI Sound" / "Studio Quality"
 *     gibi ölçülmemiş iddia YOKTUR.
 *   · Android stereo çıkışta gerçek ön/arka kanal olmadığı için fader
 *     yeteneği UYDURULMAZ; nedeni açıkça taşınır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/* ── Yetenek sözleşmesi ──────────────────────────────────────────────────── */

/**
 * Cihazın gerçekten sunduğu DSP yüzeyi. TEK yetenek modeli budur; UI, LAB ve
 * otorite aynı nesneyi okur (paralel yetenek tablosu kurulmaz).
 */
export interface AudioDspCapabilities {
  /** Native gerçekten sorgulandı mı. `false` → aşağıdaki alanlar VARSAYIM DEĞİL, YOKLUKTUR. */
  readonly probed: boolean;
  readonly supportsEqualizer: boolean;
  /** Cihazın bildirdiği bant sayısı (0 = EQ yok). Ürün "premium görünsün" diye ARTIRILMAZ. */
  readonly eqBandCount: number;
  /** Bant merkez frekansları (Hz) — cihazdan gelir, sabit kabul EDİLMEZ. */
  readonly eqBandFrequenciesHz: readonly number[];
  readonly eqMinGainDb: number;
  readonly eqMaxGainDb: number;
  readonly supportsLoudness: boolean;
  readonly loudnessMaxDb: number;
  /** Sol/sağ denge — uygulama içi kanal kazancıyla gerçekten uygulanabiliyor mu. */
  readonly supportsBalance: boolean;
  /** Ön/arka fader — gerçek çok kanallı çıkış yoksa DAİMA false. */
  readonly supportsFader: boolean;
  readonly faderUnsupportedReason: string;
  readonly supportsVirtualizer: boolean;
  /** Üretici/aftermarket donanım DSP'si bildirildi mi. */
  readonly supportsHardwareDsp: boolean;
  /** Yetenek yoksa NEDEN yok — LAB bunu gösterir, UI kontrolü hiç çizmez. */
  readonly unavailableReason: string;
}

/** Hiçbir şey bilinmiyor. Fail-closed başlangıç durumu. */
export const UNPROBED_CAPABILITIES: AudioDspCapabilities = Object.freeze({
  probed: false,
  supportsEqualizer: false,
  eqBandCount: 0,
  eqBandFrequenciesHz: Object.freeze([]) as readonly number[],
  eqMinGainDb: 0,
  eqMaxGainDb: 0,
  supportsLoudness: false,
  loudnessMaxDb: 0,
  supportsBalance: false,
  supportsFader: false,
  faderUnsupportedReason: 'not_probed',
  supportsVirtualizer: false,
  supportsHardwareDsp: false,
  unavailableReason: 'not_probed',
});

/* ── Preset kataloğu ─────────────────────────────────────────────────────── */

export type PresetId =
  | 'flat'
  | 'vocal'
  | 'rock'
  | 'electronic'
  | 'acoustic'
  | 'bass'
  | 'night'
  | 'custom';

/** Preset = frekans/dB eğrisi. Cihazın bant sayısı NE OLURSA OLSUN yansıtılır. */
export interface AudioPreset {
  readonly id: PresetId;
  readonly label: string;
  /** [Hz, dB] çiftleri — artan frekans sırasında. `custom` için boştur. */
  readonly curve: readonly (readonly [number, number])[];
}

/**
 * Sabit DSP profilleri. Her biri ÖLÇÜLEBİLİR bir EQ eğrisidir; pazarlama
 * iddiası taşımaz. Değerler ±6 dB bandında tutulur — daha agresif eğriler
 * kabin hoparlörlerinde headroom'u tüketip clipping riskini büyütür.
 */
export const AUDIO_PRESETS: readonly AudioPreset[] = Object.freeze([
  { id: 'flat', label: 'Düz', curve: Object.freeze([]) },
  {
    id: 'vocal',
    label: 'Vokal',
    curve: Object.freeze([[60, -3], [250, -1], [1000, +3], [3000, +4], [8000, +1], [16000, -1]]),
  },
  {
    id: 'rock',
    label: 'Rock',
    curve: Object.freeze([[60, +4], [250, +1], [1000, -1], [3000, +2], [8000, +3], [16000, +2]]),
  },
  {
    id: 'electronic',
    label: 'Elektronik',
    curve: Object.freeze([[60, +5], [250, +1], [1000, -2], [3000, +1], [8000, +3], [16000, +4]]),
  },
  {
    id: 'acoustic',
    label: 'Akustik',
    curve: Object.freeze([[60, +2], [250, 0], [1000, +1], [3000, +2], [8000, +2], [16000, +1]]),
  },
  {
    id: 'bass',
    label: 'Bas',
    curve: Object.freeze([[60, +6], [250, +3], [1000, 0], [3000, -1], [8000, 0], [16000, 0]]),
  },
  {
    /* GECE: gürültü tabanı düşükken bas basıncını azaltır, konuşma bandını
       hafifçe öne alır. Bir kompresör DEĞİLDİR ve öyle sunulmaz. */
    id: 'night',
    label: 'Gece',
    curve: Object.freeze([[60, -4], [250, -2], [1000, +2], [3000, +2], [8000, 0], [16000, -2]]),
  },
  { id: 'custom', label: 'Özel', curve: Object.freeze([]) },
]) as readonly AudioPreset[];

const PRESET_IDS: readonly PresetId[] = AUDIO_PRESETS.map((p) => p.id);

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
}

export function getPreset(id: PresetId): AudioPreset {
  return AUDIO_PRESETS.find((p) => p.id === id) ?? AUDIO_PRESETS[0];
}

/* ── Kullanıcı ayarı ─────────────────────────────────────────────────────── */

export interface AudioExperienceConfig {
  /** DSP açık mı. `false` = tam bypass (efektler devre dışı, ses değişmez). */
  readonly enabled: boolean;
  readonly presetId: PresetId;
  /** Bant kazançları (dB) — uzunluğu DAİMA `caps.eqBandCount`. */
  readonly bandGainsDb: readonly number[];
  readonly loudnessDb: number;
  /** -1 = tam sol · 0 = merkez · +1 = tam sağ. */
  readonly balance: number;
}

export const DEFAULT_CONFIG: AudioExperienceConfig = Object.freeze({
  enabled: true,
  presetId: 'flat' as PresetId,
  bandGainsDb: Object.freeze([]) as readonly number[],
  loudnessDb: 0,
  balance: 0,
});

/* ── Güvenlik sınırları (deterministik, sabit) ───────────────────────────── */

/** Kullanıcının verebileceği en büyük tekil bant kazancı — cihaz izinden bağımsız tavan. */
export const MAX_USER_BAND_GAIN_DB = 9;
/** Güvenlik preamp'inin inebileceği en düşük değer. */
export const MAX_HEADROOM_DB = 12;
/** Komşu bantların örtüşen kazancı için muhafazakâr katkı payı. */
const SPILL_FACTOR = 0.25;
/** Loudness kazancının tepe seviyeye katkı payı (bounded boost varsayımı). */
const LOUDNESS_HEADROOM_FACTOR = 0.5;
/** Ürün tavanı: cihaz daha fazlasına izin verse de loudness bu değeri aşmaz. */
export const MAX_USER_LOUDNESS_DB = 6;

/* ── Sayısal yardımcılar ─────────────────────────────────────────────────── */

function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo > 0 ? lo : 0;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** 0.1 dB adımına yuvarlar — float drift'i kalıcı ayara sızmaz. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/* ── Preset → cihazın gerçek bantları ────────────────────────────────────── */

/**
 * Eğriyi log-frekans ekseninde doğrusal ara değerlemeyle örnekler.
 * Eğrinin dışındaki frekanslarda uç değer KORUNUR (ekstrapolasyon yapılmaz —
 * uydurma bir kazanç üretmemek için).
 */
export function sampleCurveDb(
  curve: readonly (readonly [number, number])[],
  hz: number,
): number {
  if (curve.length === 0) return 0;
  if (!Number.isFinite(hz) || hz <= 0) return 0;
  if (hz <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (hz >= last[0]) return last[1];

  for (let i = 0; i < curve.length - 1; i++) {
    const [f0, g0] = curve[i];
    const [f1, g1] = curve[i + 1];
    if (hz >= f0 && hz <= f1) {
      const span = Math.log10(f1) - Math.log10(f0);
      if (span <= 0) return g0;
      const t = (Math.log10(hz) - Math.log10(f0)) / span;
      return g0 + (g1 - g0) * t;
    }
  }
  return last[1];
}

/**
 * Preset'i BU cihazın bant sayısı ve merkez frekanslarına yansıtır.
 * `custom` ve `flat` düz sıfır döner. Sonuç cihaz sınırlarına kırpılır.
 */
export function projectPresetToBands(
  presetId: PresetId,
  caps: AudioDspCapabilities,
): readonly number[] {
  const count = Math.max(0, Math.floor(caps.eqBandCount));
  if (count === 0) return [];
  const preset = getPreset(presetId);
  if (preset.curve.length === 0) return new Array<number>(count).fill(0);

  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const hz = caps.eqBandFrequenciesHz[i];
    const raw = Number.isFinite(hz) ? sampleCurveDb(preset.curve, hz as number) : 0;
    out[i] = round1(clampBandGainDb(raw, caps));
  }
  return out;
}

/** Tek bandı hem CİHAZ sınırına hem ÜRÜN tavanına kırpar (ikisinin kesişimi). */
export function clampBandGainDb(db: number, caps: AudioDspCapabilities): number {
  const lo = Math.max(caps.eqMinGainDb, -MAX_USER_BAND_GAIN_DB);
  const hi = Math.min(caps.eqMaxGainDb, MAX_USER_BAND_GAIN_DB);
  if (hi < lo) return 0;
  return clampNum(db, lo, hi);
}

/** Bant dizisini cihazın bant SAYISINA hizalar: eksikler 0, fazlalar atılır. */
export function alignBands(
  bands: readonly number[],
  caps: AudioDspCapabilities,
): readonly number[] {
  const count = Math.max(0, Math.floor(caps.eqBandCount));
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const v = bands[i];
    out[i] = typeof v === 'number' ? round1(clampBandGainDb(v, caps)) : 0;
  }
  return out;
}

/* ── Ayar doğrulama ──────────────────────────────────────────────────────── */

/**
 * Herhangi bir kaynaktan (kalıcı depo · UI · geri yükleme) gelen ayarı
 * cihazın GERÇEK yeteneklerine göre güvenli hâle getirir.
 *
 * Kural: desteklenmeyen alan varsayılana ÇEKİLİR, "kullanıcı böyle istemişti"
 * diye korunmaz — cihazda karşılığı olmayan bir ayar sessiz bir yalandır.
 */
export function sanitizeConfig(
  raw: unknown,
  caps: AudioDspCapabilities,
): AudioExperienceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const presetId = isPresetId(r.presetId) ? r.presetId : DEFAULT_CONFIG.presetId;

  let bands: readonly number[] = [];
  if (caps.supportsEqualizer && caps.eqBandCount > 0) {
    const rawBands = Array.isArray(r.bandGainsDb) ? (r.bandGainsDb as unknown[]) : null;
    if (presetId === 'custom' && rawBands) {
      bands = alignBands(
        rawBands.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)),
        caps,
      );
    } else {
      bands = projectPresetToBands(presetId, caps);
    }
  }

  const loudnessDb = caps.supportsLoudness
    ? round1(clampNum(
      typeof r.loudnessDb === 'number' ? r.loudnessDb : 0,
      0,
      Math.min(caps.loudnessMaxDb, MAX_USER_LOUDNESS_DB),
    ))
    : 0;

  const balance = caps.supportsBalance
    ? round1(clampNum(typeof r.balance === 'number' ? r.balance : 0, -1, 1))
    : 0;

  return Object.freeze({
    enabled: r.enabled === undefined ? DEFAULT_CONFIG.enabled : r.enabled === true,
    presetId,
    bandGainsDb: Object.freeze(bands.slice()) as readonly number[],
    loudnessDb,
    balance,
  });
}

/** Aynı ayar mı — gereksiz native yazımını engeller (coalescing girdisi). */
export function configEquals(a: AudioExperienceConfig, b: AudioExperienceConfig): boolean {
  if (a.enabled !== b.enabled) return false;
  if (a.presetId !== b.presetId) return false;
  if (a.loudnessDb !== b.loudnessDb) return false;
  if (a.balance !== b.balance) return false;
  if (a.bandGainsDb.length !== b.bandGainsDb.length) return false;
  for (let i = 0; i < a.bandGainsDb.length; i++) {
    if (a.bandGainsDb[i] !== b.bandGainsDb[i]) return false;
  }
  return true;
}

/* ── Clipping / gain güvenliği ───────────────────────────────────────────── */

/**
 * Pozitif EQ boost'u ve loudness kazancı birleşince oluşan tepe artışını
 * telafi eden DETERMİNİSTİK headroom (≤ 0 dB).
 *
 * Neden ayrı bir kazanç: kullanıcı sesini (userVolume) düşürmek YASAKTIR —
 * o başka bir otoritenin (volumePolicy · CarosPlaybackService.userVolume)
 * mülküdür. Güvenlik kazancı DSP zincirinin içinde, sınırlı ve gözlemlenebilir
 * bir ayrı katsayıdır.
 *
 * Model: en büyük pozitif bant kazancı tepe belirleyicidir; diğer pozitif
 * bantlar örtüşme payıyla (0.25) katkı verir; loudness yarı ağırlıkla eklenir.
 * Sonuç [-12, 0] dB'e kırpılır.
 */
export function computeSafetyPreampDb(
  cfg: AudioExperienceConfig,
  caps: AudioDspCapabilities,
): number {
  if (!cfg.enabled) return 0;
  if (!caps.probed) return 0;

  let peak = 0;
  let sumPositive = 0;
  for (const g of cfg.bandGainsDb) {
    if (g > 0) {
      sumPositive += g;
      if (g > peak) peak = g;
    }
  }
  const spill = Math.max(0, sumPositive - peak);
  const loud = caps.supportsLoudness ? Math.max(0, cfg.loudnessDb) : 0;

  const estimatedPeakDb = peak + SPILL_FACTOR * spill + LOUDNESS_HEADROOM_FACTOR * loud;
  if (estimatedPeakDb <= 0) return 0;
  return -round1(Math.min(MAX_HEADROOM_DB, estimatedPeakDb));
}

/** dB → doğrusal kazanç. Güvenlik preamp'i native'e bu biçimde iner. */
export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

/**
 * Denge → kanal kazançları. YALNIZ uzak kanalı kısar, hiçbir kanalı 1.0'ın
 * ÜSTÜNE çıkarmaz — denge ayarı tek başına clipping ÜRETEMEZ.
 */
export function balanceToChannelGains(balance: number): { left: number; right: number } {
  const b = clampNum(balance, -1, 1);
  return {
    left: b <= 0 ? 1 : Math.max(0, 1 - b),
    right: b >= 0 ? 1 : Math.max(0, 1 + b),
  };
}

/* ── UI görünürlük kararı ────────────────────────────────────────────────── */

export interface VisibleControls {
  readonly presets: boolean;
  readonly eqBands: boolean;
  readonly loudness: boolean;
  readonly balance: boolean;
  readonly fader: boolean;
  readonly bypass: boolean;
  /** Hiçbir kontrol yoksa UI panelin tamamını çizmez. */
  readonly any: boolean;
}

/**
 * Hangi kontrol GERÇEKTEN çizilir. Desteklenmeyen kontrol için "kapalı"
 * görünen bir kutu ÜRETİLMEZ (§13 capability honesty).
 */
export function visibleControls(caps: AudioDspCapabilities): VisibleControls {
  const eq = caps.probed && caps.supportsEqualizer && caps.eqBandCount > 0;
  const loudness = caps.probed && caps.supportsLoudness && caps.loudnessMaxDb > 0;
  const balance = caps.probed && caps.supportsBalance;
  const fader = caps.probed && caps.supportsFader;
  const any = eq || loudness || balance || fader;
  return Object.freeze({
    presets: eq,
    eqBands: eq,
    loudness,
    balance,
    fader,
    bypass: any,
    any,
  });
}

/* ── Sürüş dikkat politikası ─────────────────────────────────────────────── */

export type AudioInteractionMode =
  /** Tüm ince ayarlar açık. */
  | 'FULL'
  /** Sürüş: preset seçimi ve bypass açık; bant/denge sürükleme KAPALI. */
  | 'REDUCED';

/**
 * Sürüşte hangi etkileşim düzeyi geçerlidir.
 *
 * Kısıtlanan şey ZEKÂ değil, yalnız ince sürükleme etkileşimidir: preset
 * seçimi ve bypass sürüşte de erişilebilir kalır (büyük dokunma hedefi).
 */
export function interactionModeFor(drivingMode: 'idle' | 'normal' | 'driving'): AudioInteractionMode {
  return drivingMode === 'driving' ? 'REDUCED' : 'FULL';
}
