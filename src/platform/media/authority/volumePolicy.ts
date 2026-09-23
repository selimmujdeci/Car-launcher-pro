/**
 * volumePolicy.ts — MÜZİK HUB PAKET A · Tek ses otoritesi (SAF).
 *
 * ÖNCESİ (paralel otoriteler): UI store ses yüzdesi · Web Audio masterGain ·
 * `streamSetVolume` HTML5 element sesi · Android STREAM_MUSIC sistem sesi ·
 * `duckMusicForListening` sistem sesini DOĞRUDAN değiştirip geri yüklüyordu.
 * Beş ayrı yazar → "sesi kıstım, kendi kendine açıldı" davranışı.
 *
 * SONRASI: etkin ses TEK bir deterministik formülle hesaplanır:
 *
 *   effective = clamp01( userVolume × duckLevel × safetyAttenuation × sourceNormalization )
 *   mute → 0
 *
 * Kimse bu formülün dışında ses yazmaz; native taraf da aynı çarpımı uygular.
 *
 * SVC (hıza bağlı ses telafisi) bu alanı `speedVolumeRuntime` üzerinden besler:
 * yalnız KISAR (≤ 1), geçersiz değer NÖTRdür (1) ve `SPEED_COMPENSATION_FLOOR`
 * altına inemez — bir hata sesi hiçbir koşulda kapatamaz.
 *
 * SAFLIK: I/O · timer · Date.now · global durum YOK.
 */

export interface VolumeInputs {
  /** Kullanıcının seçtiği medya sesi (0..1). */
  readonly userVolume: number;
  /** duckPolicy.effectiveDuckLevel() çıktısı (0..1). */
  readonly duckLevel: number;
  /** Güvenlik kısıtı (ör. sürüş sırasında tavan) — 0..1, varsayılan 1. */
  readonly safetyAttenuation: number;
  /** Kaynak ses seviyesi normalizasyonu (radyo/yerel farkı) — 0..1, varsayılan 1. */
  readonly sourceNormalization: number;
  /** Hıza bağlı telafi çarpanı (≤ 1) — `speedVolumeRuntime` yazar; varsayılan 1. */
  readonly speedCompensation: number;
  readonly muted: boolean;
}

export const DEFAULT_VOLUME_INPUTS: VolumeInputs = {
  userVolume: 1,
  duckLevel: 1,
  safetyAttenuation: 1,
  sourceNormalization: 1,
  speedCompensation: 1,
  muted: false,
};

/** SVC'nin inebileceği en düşük çarpan — hata/bozuk değer sesi KAPATAMAZ. */
export const SPEED_COMPENSATION_FLOOR = 0.5;

function speedCompensationOf(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 1;   // geçersiz → NÖTR (asla 0)
  return Math.max(SPEED_COMPENSATION_FLOOR, Math.min(1, v));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Girdileri sınırlar — bozuk değer sessizce 0/1'e çekilir, ASLA NaN yayılmaz. */
export function sanitizeVolumeInputs(input: Partial<VolumeInputs>): VolumeInputs {
  return {
    userVolume: clamp01(input.userVolume ?? DEFAULT_VOLUME_INPUTS.userVolume),
    duckLevel: clamp01(input.duckLevel ?? DEFAULT_VOLUME_INPUTS.duckLevel),
    safetyAttenuation: clamp01(input.safetyAttenuation ?? DEFAULT_VOLUME_INPUTS.safetyAttenuation),
    sourceNormalization: clamp01(
      input.sourceNormalization ?? DEFAULT_VOLUME_INPUTS.sourceNormalization,
    ),
    speedCompensation: speedCompensationOf(input.speedCompensation),
    muted: input.muted === true,
  };
}

/** Deterministik etkin ses — tek hesap noktası. */
export function computeEffectiveVolume(input: Partial<VolumeInputs>): number {
  const v = sanitizeVolumeInputs(input);
  if (v.muted) return 0;
  return clamp01(
    v.userVolume * v.duckLevel * v.safetyAttenuation * v.sourceNormalization * v.speedCompensation,
  );
}

/** Aynı girdilerden Android STREAM_MUSIC adımı (0..15) — tek dönüşüm noktası. */
export function toSystemVolumeStep(effective: number, maxStep = 15): number {
  const e = clamp01(effective);
  const step = Math.round(e * maxStep);
  return Math.max(0, Math.min(maxStep, step));
}

/** Yüzde (0..100) → 0..1; UI slider'ının TEK giriş kapısı. */
export function percentToUnit(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return clamp01(percent / 100);
}

export function unitToPercent(unit: number): number {
  return Math.round(clamp01(unit) * 100);
}
