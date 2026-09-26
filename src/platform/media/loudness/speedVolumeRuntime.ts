/**
 * speedVolumeRuntime — MUSIC · Hıza bağlı ses telafisi (SVC).
 *
 * `volumePolicy`nin baştan hazır bıraktığı TEK giriş (`speedCompensation`)
 * burada beslenir; ikinci bir gain otoritesi KURULMAZ (spec F6 açık borç #2).
 *
 * MODEL — yalnız KISAR (≤ 1): durağanken kullanıcı seviyesinin biraz ALTINDA
 * başlar, hız arttıkça kullanıcının ayarladığı seviyeye çıkar. Kullanıcı
 * seviyesinin ÜSTÜNE çıkmaz → aşırı yükseklik ya da clipping riski YOKTUR.
 *
 * HIZ — kanonik füzyondan (`speedFusion`: CAN → OBD → GPS). Kaynak yoksa
 * (`source: 'none'`) füzyon 0 km/h yazar; bu bir ölçüm DEĞİLDİR → hız
 * BİLİNMİYOR sayılır ve telafi NÖTR (1) kalır. Sahte sıfıra göre kısılmaz.
 *
 * PERFORMANS — timer/polling YOK: hız olayında hesaplanır; en az 1 sn aralık
 * ve %2 histerezis ile yazılır (ses yoluna gereksiz yazım yok). Nötre dönüş
 * (kapatma / hız bilinmiyor) BEKLETİLMEZ.
 */

import { logError } from '../../crashLogger';

export type SvcLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

/** Durağanken uygulanan en büyük kısma (1 − çarpan). */
export const SVC_DEPTH: Readonly<Record<SvcLevel, number>> = { OFF: 0, LOW: 0.15, MEDIUM: 0.25, HIGH: 0.35 };
/** Bu hızda ve üstünde telafi tamamlanır (kullanıcı seviyesi). */
export const SVC_FULL_SPEED_KMH = 100;
export const SVC_MIN_APPLY_INTERVAL_MS = 1_000;
export const SVC_HYSTERESIS = 0.02;

export const SVC_LEVEL_LABEL: Readonly<Record<SvcLevel, string>> = {
  OFF: 'Kapalı', LOW: 'Düşük', MEDIUM: 'Orta', HIGH: 'Yüksek',
};

export function isSvcLevel(v: unknown): v is SvcLevel {
  return v === 'OFF' || v === 'LOW' || v === 'MEDIUM' || v === 'HIGH';
}

/** SAF: hız (km/h, bilinmiyorsa null) + seviye → çarpan (0.65..1, 0.01 adım). */
export function computeSpeedCompensation(speedKmh: number | null, level: SvcLevel): number {
  const depth = SVC_DEPTH[level] ?? 0;
  if (depth <= 0 || speedKmh === null || !Number.isFinite(speedKmh) || speedKmh < 0) return 1;
  const ratio = Math.min(speedKmh, SVC_FULL_SPEED_KMH) / SVC_FULL_SPEED_KMH;
  return Math.round((1 - depth * (1 - ratio)) * 100) / 100;
}

export interface SpeedSample { readonly speed: number; readonly source: string }

export interface SpeedVolumeDeps {
  readonly subscribeSpeed: (fn: (s: SpeedSample) => void) => () => void;
  readonly subscribeLevel: (fn: () => void) => () => void;
  readonly getLevel: () => SvcLevel;
  readonly apply: (factor: number) => Promise<unknown>;
  readonly now: () => number;
}

let started = false;
let deps: SpeedVolumeDeps | null = null;
let cleanups: (() => void)[] = [];
let lastSample: SpeedSample | null = null;
let lastApplied = 1;
let lastAppliedAt = Number.NEGATIVE_INFINITY;

function evaluate(): void {
  if (!deps) return;
  const speed = lastSample && lastSample.source !== 'none' ? lastSample.speed : null;
  const next = computeSpeedCompensation(speed, deps.getLevel());
  const neutral = next === 1;
  if (next === lastApplied) return;
  if (!neutral && Math.abs(next - lastApplied) < SVC_HYSTERESIS) return;
  const nowMs = deps.now();
  if (!neutral && nowMs - lastAppliedAt < SVC_MIN_APPLY_INTERVAL_MS) return;
  lastApplied = next;
  lastAppliedAt = nowMs;
  void deps.apply(next).catch((e) => logError('SpeedVolume:Apply', e));
}

async function defaultDeps(): Promise<SpeedVolumeDeps> {
  const [{ onFusedSpeed }, { useStore }, { setSpeedCompensation }] = await Promise.all([
    import('../../speedFusion'),
    import('../../../store/useStore'),
    import('../authority/mediaCommandGateway'),
  ]);
  const getLevel = (): SvcLevel => {
    const v = useStore.getState().settings.speedVolumeLevel;
    return isSvcLevel(v) ? v : 'OFF';
  };
  return {
    subscribeSpeed: (fn) => onFusedSpeed((d) => fn({ speed: d.speed, source: d.source })),
    subscribeLevel: (fn) => {
      let prev = getLevel();
      return useStore.subscribe(() => { const cur = getLevel(); if (cur !== prev) { prev = cur; fn(); } });
    },
    getLevel,
    apply: setSpeedCompensation,
    now: () => Date.now(),
  };
}

/** Başlatır — idempotent; timer KURMAZ. Test bağımlılık verebilir. */
export async function startSpeedVolumeCompensation(injected?: SpeedVolumeDeps): Promise<void> {
  if (started) return;
  started = true;
  try {
    deps = injected ?? await defaultDeps();
    if (!started) return;   // başlarken durdurulduysa abone OLUNMAZ
    cleanups = [
      deps.subscribeSpeed((s) => { lastSample = s; evaluate(); }),
      deps.subscribeLevel(() => evaluate()),
    ];
  } catch (e) {
    logError('SpeedVolume:Start', e);
    started = false;
  }
}

/** Durdurur ve çarpanı NÖTRE döndürür — sebebi kalkmış bir kısma ses yolunda KALMAZ. */
export function stopSpeedVolumeCompensation(): void {
  started = false;
  cleanups.forEach((c) => { try { c(); } catch { /* yoksay */ } });
  cleanups = [];
  const d = deps;
  if (d && lastApplied !== 1) void d.apply(1).catch((e) => logError('SpeedVolume:Release', e));
  deps = null;
  lastSample = null;
  lastApplied = 1;
  lastAppliedAt = Number.NEGATIVE_INFINITY;
}

export function getAppliedSpeedCompensation(): number { return lastApplied; }
