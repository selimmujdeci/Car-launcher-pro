/**
 * sonicAnalysisRuntime.ts — MUSIC F17 · Ses analizinin TEK dikişi.
 *
 * Zincir:
 *   `kabul girdileri (sonicSources, salt okuma) → admitSonicAnalysis (SAF)
 *      → native analyzeTrackAudio (ayrı havuz, sınırlı toplu iş)
 *      → makeSonicDescriptor (SAF, fail-closed) → bounded LRU önbellek
 *      → traitRuntime (MEASURED_AUDIO kanıtı)`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER/POLLING YOKTUR.** Yalnız çağrıldığında çalışır.
 *   · Çalma BAŞLATMAZ, kuyruğa dokunmaz, sağlayıcıya komut GÖNDERMEZ.
 *   · Aynı anda TEK tur (in-flight kilidi) — ikinci istek `DEFER` alır.
 *   · Aynı dosya aynı kuşakta bir kez ölçülür; kalıcı başarısızlık da
 *     ÖNBELLEKLENİR (sonsuz yeniden deneme YOK).
 *   · Geçici başarısızlık (zaman aşımı/iptal) sınırlı sayıda yeniden denenir.
 *   · İptal edilebilir: kuşak artar; ESKİ turun sonucu YAZILMAZ (§17).
 *   · Önbellek SINIRLIDIR (LRU) ve yalnız sayısal ölçüm tutar — ad/URI TUTMAZ.
 *   · Native yoksa (tarayıcı) sessizce hiçbir kanıt üretilmez (fail-soft).
 */

import {
  admitSonicAnalysis, type SonicAdmission,
} from './sonicAdmissionModel';
import {
  makeSonicDescriptor, SONIC_SCHEMA_VERSION,
  type SonicAnalysisInput, type SonicDescriptor, type SonicFailureReason,
} from './sonicDescriptor';
import {
  readDeviceTier, readMemoryLevel, readPlaybackActive, readThermalLevel,
} from './sonicSources';
import {
  getSonicTelemetry, noteSonicAdmission, noteSonicCache, noteSonicFailure,
  noteSonicMalformed, noteSonicMeasured, noteSonicNativeError,
  noteSonicReanalysisPrevented, noteSonicRunDuration, noteSonicStaleDropped,
  noteSonicStaleResultDropped,
} from './sonicTelemetry';

/** Ölçüm önbelleği üst sınırı — sınırsız büyüme YOK. */
export const MAX_SONIC_CACHE = 256;
/** Geçici başarısızlıkta (zaman aşımı/iptal) izin verilen EN FAZLA deneme. */
export const MAX_TRANSIENT_RETRY = 2;
/** Bir istekte kuyruğa alınabilecek EN FAZLA aday. */
export const MAX_SONIC_QUEUE = 32;

/** Kalıcı başarısızlık: dosya bu kuşakta bir daha DENENMEZ. */
const PERMANENT_FAILURES: readonly SonicFailureReason[] = Object.freeze([
  'NO_AUDIO_TRACK', 'UNSUPPORTED_CODEC', 'DECODE_FAILED', 'TOO_SHORT', 'SILENT',
]);

/** `null` = ölçüldü ve KALICI OLARAK kanıt yok (tekrar denenmez). */
const cache = new Map<string, SonicDescriptor | null>();
/** Geçici başarısızlık sayacı — sonsuz yeniden deneme kilidi. */
const transientAttempts = new Map<string, number>();

let generation = 0;
let inFlight = false;

function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/**
 * Önbellek anahtarı — şema sürümü + kimlik + dosya kuşağı.
 *
 * Dosya değişirse (`generationModified`) eski ölçüm BAYATTIR; şema değişirse
 * eski satırlar bir daha okunmaz. Kimlik tek başına YETMEZ.
 */
export function sonicCacheKey(id: string, generationModified: number | null): string {
  return SONIC_SCHEMA_VERSION + '|' + id + '|'
    + (generationModified === null ? '-' : String(generationModified));
}

function cacheTouch(key: string): void {
  const hit = cache.get(key);
  if (hit !== undefined) { cache.delete(key); cache.set(key, hit); }
}

function cacheSet(key: string, value: SonicDescriptor | null): void {
  cache.set(key, value);
  while (cache.size > MAX_SONIC_CACHE) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Bir parçanın ESKİ kuşak satırlarını düşürür (dosya değişti / yeni ölçüm). */
function dropStaleRows(id: string, keepKey: string): void {
  const marker = '|' + id + '|';
  for (const key of [...cache.keys()]) {
    if (key !== keepKey && key.includes(marker)) {
      cache.delete(key);
      noteSonicStaleDropped();
    }
  }
}

export interface SonicTrackRef {
  readonly id: string;
  readonly contentUri: string;
  readonly generationModified?: number | null;
}

/**
 * Ölçülmüş betimleyici — YOKSA `null`. **TEK okuyucudur.**
 *
 * "Henüz ölçülmedi" ile "ölçüldü, kanıt çıkmadı" AYNI DEĞİLDİR; ikincisi
 * önbellekte `null` olarak durur ve yeniden analiz İSTENMEZ.
 *
 * Bu okuma SAYAÇ DEĞİŞTİRMEZ. Sebebi iki katlıdır:
 *   1. F3.2'de kilitlenen sözleşme — LAB gözlemi üretim sayaçlarını oynatamaz.
 *   2. Aday taraması (F10 · 400 parça) her istekte yüzlerce okuma yapar;
 *      bunları "önbellek ıskası" saymak sayaçları anlamsızlaştırırdı.
 * İsabet/ıska yalnız ANALİZ KUYRUĞU kararında (`pendingSonicTracks`) sayılır —
 * orası gerçekten "bu dosyayı ölçmeli miyim" sorusunun sorulduğu yerdir.
 */
export function peekSonicDescriptor(
  id: string, generationModified: number | null = null,
): SonicDescriptor | null {
  return cache.get(sonicCacheKey(id, generationModified)) ?? null;
}

/**
 * İstenen parçalardan GERÇEKTEN analiz edilmesi gerekenleri süzer.
 *
 * Zaten çözümlenmiş olan veya geçici deneme hakkını tüketmiş olan dosya
 * havuza GİRMEZ — "aynı dosya tekrar tekrar analiz edilmez" kuralı burada
 * zorlanır, çağıran atlayamaz.
 */
export function pendingSonicTracks(
  tracks: readonly SonicTrackRef[],
): readonly SonicTrackRef[] {
  const out: SonicTrackRef[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    if (out.length >= MAX_SONIC_QUEUE) break;
    if (typeof t.id !== 'string' || t.id.length === 0) continue;
    if (typeof t.contentUri !== 'string' || t.contentUri.length === 0) continue;
    const key = sonicCacheKey(t.id, t.generationModified ?? null);
    if (seen.has(key)) continue;
    seen.add(key);
    if (cache.has(key)) {
      noteSonicCache(true);
      noteSonicReanalysisPrevented();
      cacheTouch(key);
      continue;
    }
    noteSonicCache(false);
    if ((transientAttempts.get(key) ?? 0) >= MAX_TRANSIENT_RETRY) {
      noteSonicReanalysisPrevented();
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Kabul kararını ÜRETİR (yan etkisiz okuma + saf model). */
export function evaluateSonicAdmission(pendingCount: number, nativeAvailable: boolean): SonicAdmission {
  return admitSonicAnalysis({
    nativeAvailable,
    thermalLevel: readThermalLevel(),
    memoryLevel: readMemoryLevel(),
    deviceTier: readDeviceTier(),
    playbackActive: readPlaybackActive(),
    inFlight,
    pendingCount,
  });
}

/**
 * Devam eden analizi iptal eder — kuşak artar, ESKİ sonuç YAZILAMAZ.
 *
 * Native tarafa da iptal iletilir; iletilemezse yerel kuşak yine de artmıştır
 * ve gecikmiş sonuç düşürülür (fail-soft, ama sessiz sızma YOK).
 */
export async function cancelSonicAnalysis(): Promise<void> {
  generation += 1;
  try {
    const { CarLauncher } = await import('../../nativePlugin');
    await CarLauncher.cancelTrackAudioAnalysis();
  } catch {
    /* Native yoksa yerel kuşak artışı yeterlidir. */
  }
}

/**
 * SINIRLI bir analiz turu koşar.
 *
 * · Çalma yolunda DEĞİLDİR: yalnız kullanıcı bir karakter/benzerlik isteği
 *   yaptığında veya keşif yüzeyi açıldığında çağrılır.
 * · Native taraf ayrı bir havuzda çalışır ve dosya başına bütçe uygular.
 * · Kabul edilmezse HİÇ ölçüm yapılmaz (kaba ölçüm kanıt sayılmaz).
 *
 * @returns bu turda GERÇEKTEN ölçülen dosya sayısı.
 */
export async function runSonicAnalysis(tracks: readonly SonicTrackRef[]): Promise<number> {
  const pending = pendingSonicTracks(tracks);
  const tier = readDeviceTier();

  let CarLauncher: typeof import('../../nativePlugin').CarLauncher | null = null;
  try {
    ({ CarLauncher } = await import('../../nativePlugin'));
  } catch {
    CarLauncher = null;
  }
  const nativeAvailable = CarLauncher !== null
    && typeof CarLauncher.analyzeTrackAudio === 'function';

  const admission = evaluateSonicAdmission(pending.length, nativeAvailable);
  noteSonicAdmission({
    decision: admission.decision,
    reason: admission.reason,
    batchSize: admission.batchSize,
    tier,
    atMs: Date.now(),
  });
  if (admission.decision !== 'ADMIT' || CarLauncher === null) return 0;

  const batch = pending.slice(0, admission.batchSize);
  const runGeneration = generation;
  const startedAt = mono();
  inFlight = true;

  let raw: { results?: readonly SonicAnalysisInput[] } | null = null;
  try {
    raw = await CarLauncher.analyzeTrackAudio({
      uris: batch.map((t) => t.contentUri),
      maxItems: admission.batchSize,
    });
  } catch {
    noteSonicNativeError();
    raw = null;
  } finally {
    inFlight = false;
    noteSonicRunDuration(mono() - startedAt);
  }

  /* §17 — eski oturumun/kuşağın sonucu yeni gerçeği DEĞİŞTİREMEZ. */
  if (runGeneration !== generation) { noteSonicStaleResultDropped(); return 0; }
  if (raw === null || !Array.isArray(raw.results)) return 0;

  const byUri = new Map<string, SonicAnalysisInput>();
  for (const row of raw.results) {
    const uri = (row as { uri?: unknown }).uri;
    if (typeof uri === 'string' && uri.length > 0) byUri.set(uri, row);
  }

  let measured = 0;
  for (const t of batch) {
    const row = byUri.get(t.contentUri);
    if (row === undefined) continue;
    const key = sonicCacheKey(t.id, t.generationModified ?? null);

    if (row.analyzed !== true) {
      const reason = (row.reason ?? 'DECODE_FAILED') as SonicFailureReason;
      noteSonicFailure(reason);
      if (PERMANENT_FAILURES.includes(reason)) {
        /* Kalıcı: bir daha DENENMEZ (kanıt yok olarak işaretlenir). */
        cacheSet(key, null);
        dropStaleRows(t.id, key);
      } else {
        /* Geçici: sınırlı yeniden deneme hakkı düşer. */
        transientAttempts.set(key, (transientAttempts.get(key) ?? 0) + 1);
      }
      continue;
    }

    const descriptor = makeSonicDescriptor(row);
    if (descriptor === null) {
      /* Native "ölçtüm" dedi ama alanlar geçersiz → kanıt SAYILMAZ. */
      noteSonicMalformed();
      cacheSet(key, null);
      dropStaleRows(t.id, key);
      continue;
    }
    noteSonicMeasured(descriptor.tempoBpm !== null);
    cacheSet(key, descriptor);
    dropStaleRows(t.id, key);
    transientAttempts.delete(key);
    measured += 1;
  }
  return measured;
}

export function getSonicCacheSize(): number { return cache.size; }
export function getSonicGeneration(): number { return generation; }
export function isSonicAnalysisRunning(): boolean { return inFlight; }
export { getSonicTelemetry };

export function _resetSonicRuntimeForTest(): void {
  cache.clear();
  transientAttempts.clear();
  generation = 0;
  inFlight = false;
}

/** @internal test dikişi — ölçüm sonucunu taklit eder. */
export function _setSonicDescriptorForTest(
  id: string, descriptor: SonicDescriptor | null, generationModified: number | null = null,
): void {
  cacheSet(sonicCacheKey(id, generationModified), descriptor);
}
