/**
 * loudnessRuntime.ts — MUSIC F19 · Seviye tutarlılığının TEK dikişi.
 *
 * Zincir (kanonik — yeni otorite YOK):
 *   `gömülü ReplayGain/R128 etiketi (native) + F17 ölçümü (RMS)
 *      → loudnessEvidence (SAF) → computeNormalization (SAF)
 *      → mediaCommandGateway.setSourceNormalization → volumePolicy`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER/POLLING YOKTUR.** Yalnız kanonik dinleme oturumu değiştiğinde
 *     (parça sınırı) çalışır — çalma sırasında ses OYNATILMAZ, "pumping" yok.
 *   · **Kullanıcı sesine DOKUNMAZ.** Yalnız `sourceNormalization` beslenir.
 *   · **Duck'a DOKUNMAZ.** Duck'ı native uygular (F6.1).
 *   · **DSP güvenlik preamp'ine DOKUNMAZ.** O ayrı bir katsayıdır ve DSP
 *     zincirinin içindedir; ikisi de yalnız KISAR, çakışmazlar.
 *   · Kanıt yoksa çarpan tam olarak 1.0 (nötr) — tahmin YOK.
 *   · Yalnız YEREL parçada kanıt aranır: sağlayıcı akışında ne etiket okunabilir
 *     ne de ses ölçülebilir (F17 #1167) — sahte normalizasyon ÜRETİLMEZ.
 */

import { logError } from '../../crashLogger';
import { getListeningSession, subscribeListeningSession } from '../session/listeningSession';
import { getMusicLibrarySnapshot } from '../musicIndex';
import { peekSonicDescriptor } from '../sonic/sonicAnalysisRuntime';
import {
  computeNormalization, fromGainTag, fromMeasuredRms, NEUTRAL_NORMALIZATION,
  NO_LOUDNESS_EVIDENCE, strongerLoudness,
  type LoudnessEvidence, type NormalizationResult,
} from './loudnessEvidence';
import {
  noteLoudnessApplyFailure, noteLoudnessDecision, noteLoudnessUnchanged,
} from './loudnessTelemetry';

/** Etiket önbelleği üst sınırı — sınırsız büyüme YOK. */
export const MAX_GAIN_CACHE = 256;

interface GainTag {
  readonly gainDb: number | null;
  readonly gainPeak: number | null;
  readonly gainSource: string;
}

/** Kimlik → gömülü seviye etiketi. `null` = okundu, etiket YOK. */
const gainTags = new Map<string, GainTag | null>();

let started = false;
let unsubscribe: (() => void) | null = null;
/**
 * En son değerlendirilen parça kimliği.
 *
 * `undefined` = HENÜZ değerlendirilmedi. Bu ayrım gereklidir: `null` (yerel
 * parça yok — sağlayıcı akışı) da GEÇERLİ bir gözlemdir ve bir kez nötre
 * çekilmelidir. Tek bir `null` kullanmak, ilk gözlemin sessizce atlanmasına
 * ve önceki parçanın çarpanının sızmasına yol açardı.
 */
let trackedId: string | null | undefined = undefined;
let lastResult: NormalizationResult = NEUTRAL_NORMALIZATION;

function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

function cacheSet(id: string, tag: GainTag | null): void {
  gainTags.set(id, tag);
  while (gainTags.size > MAX_GAIN_CACHE) {
    const oldest = gainTags.keys().next();
    if (oldest.done) break;
    gainTags.delete(oldest.value);
  }
}

/**
 * Gömülü seviye etiketlerini SINIRLI bir toplu işle okur.
 *
 * `readTrackTraits` ZATEN var olan native yüzeydir (F10.1); F19 yeni bir
 * native çağrı AÇMAZ — aynı okumanın yanında gelen alanları kullanır.
 * Okunmuş parça tekrar OKUNMAZ (etiketi olmayan da işaretlenir).
 */
export async function primeGainTags(
  tracks: readonly { readonly id: string; readonly contentUri: string }[],
): Promise<number> {
  const pending = tracks.filter(
    (t) => !gainTags.has(t.id)
      && typeof t.contentUri === 'string' && t.contentUri.length > 0,
  ).slice(0, 24);
  if (pending.length === 0) return 0;

  try {
    const { CarLauncher } = await import('../../nativePlugin');
    const result = await CarLauncher.readTrackTraits({ uris: pending.map((t) => t.contentUri) });
    const byUri = new Map(result.traits.map((r) => [r.uri, r]));
    for (const t of pending) {
      const row = byUri.get(t.contentUri);
      cacheSet(t.id, row === undefined ? null : Object.freeze({
        gainDb: typeof row.gainDb === 'number' ? row.gainDb : null,
        gainPeak: typeof row.gainPeak === 'number' ? row.gainPeak : null,
        gainSource: typeof row.gainSource === 'string' ? row.gainSource : 'NONE',
      }));
    }
    return pending.length;
  } catch {
    /* Native yoksa (tarayıcı) veya izin reddedildiyse: kanıt YOK, uydurma YOK. */
    return 0;
  }
}

/**
 * Bir parçanın seviye kanıtı — GÜÇLÜDEN ZAYIFA.
 *
 * Etiket (üretim aracının kararı) F17 RMS yaklaşımından GÜÇLÜDÜR; yalnız
 * etiket yoksa ölçüme düşülür. **Yan etkisi yoktur** (LAB güvenle çağırır).
 */
export function resolveLoudnessEvidence(id: string | null): LoudnessEvidence {
  if (id === null || id.length === 0) return NO_LOUDNESS_EVIDENCE;

  const tag = gainTags.get(id) ?? null;
  const tagEvidence = tag === null ? NO_LOUDNESS_EVIDENCE : fromGainTag(tag);

  const generation = safe<number | null>(
    () => getMusicLibrarySnapshot().tracks.find((t) => t.id === id)?.generationModified ?? null,
    null,
  );
  const descriptor = safe(() => peekSonicDescriptor(id, generation), null);
  const measured = descriptor === null ? NO_LOUDNESS_EVIDENCE : fromMeasuredRms({
    rmsDbfs: descriptor.rmsDbfs, peakDbfs: descriptor.peakDbfs,
  });

  return strongerLoudness(tagEvidence, measured);
}

/** Şu an çalan YEREL parçanın kimliği — sağlayıcı akışında `null`. */
function currentLocalId(): string | null {
  return safe<string | null>(
    () => getListeningSession()?.currentItem?.libraryId ?? null, null,
  );
}

/**
 * Geçerli parça için normalizasyonu HESAPLAR ve UYGULAR.
 *
 * Parça sınırında çalışır; aynı parça için tekrar çağrılırsa hiçbir şey
 * yazmaz (gereksiz native yazımı yok → "pumping" yok).
 */
export async function applyLoudnessForCurrentItem(nowMs = Date.now()): Promise<NormalizationResult> {
  const id = currentLocalId();
  if (id === trackedId) { noteLoudnessUnchanged(); return lastResult; }
  trackedId = id;

  const startedAt = mono();

  /* Etiket henüz okunmadıysa YALNIZ BU parça için okunur (tek dosya, ucuz
     metadata okuması — decode DEĞİL). Kütüphanenin tamamı taranmaz: seviye
     kanıtı çalınan parçaya aittir, toplu tarama gereksiz bir iştir. */
  if (id !== null && !gainTags.has(id)) {
    const uri = safe<string | null>(
      () => getMusicLibrarySnapshot().tracks.find((t) => t.id === id)?.contentUri ?? null,
      null,
    );
    if (uri !== null) await primeGainTags([{ id, contentUri: uri }]);
  }

  const evidence = resolveLoudnessEvidence(id);
  const result = computeNormalization(evidence);
  lastResult = result;

  noteLoudnessDecision({
    provenance: result.provenance,
    factor: result.factor,
    appliedDb: result.appliedDb,
    requestedDb: result.requestedDb,
    clamped: result.clamped,
    bypassReason: result.bypassReason,
    elapsedMs: mono() - startedAt,
    atMs: nowMs,
  });

  try {
    const { setSourceNormalization } = await import('../authority/mediaCommandGateway');
    await setSourceNormalization(result.factor);
  } catch (e) {
    /* Ses yolu yazılamadıysa NORMALİZASYON YOK — ama oynatma ETKİLENMEZ. */
    noteLoudnessApplyFailure();
    logError('Loudness:Apply', e);
  }
  return result;
}

/**
 * Başlatır. TIMER KURMAZ — yalnız kanonik dinleme oturumuna abone olur.
 * İdempotenttir; `stopLoudnessNormalization` LIFO cleanup ile güvenlidir.
 */
export function startLoudnessNormalization(): void {
  if (started) return;
  started = true;
  try {
    unsubscribe = subscribeListeningSession(() => {
      void applyLoudnessForCurrentItem().catch((e) => logError('Loudness:Observe', e));
    });
  } catch (e) {
    logError('Loudness:Start', e);
    started = false;
  }
}

/**
 * Durdurur ve **çarpanı nötre geri çeker.**
 *
 * Sızıntı kilidi: katman kapanırken son parçanın kısması ses yolunda
 * KALAMAZ — kullanıcı, sebebi artık ortadan kalkmış bir kısmayla baş başa
 * bırakılmaz. Geri çekme fail-soft'tur (yazılamazsa oynatma etkilenmez).
 */
export function stopLoudnessNormalization(): void {
  started = false;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const hadAttenuation = lastResult.factor < 1;
  trackedId = undefined;
  lastResult = NEUTRAL_NORMALIZATION;
  if (hadAttenuation) {
    void (async () => {
      try {
        const { setSourceNormalization } = await import('../authority/mediaCommandGateway');
        await setSourceNormalization(1);
      } catch (e) {
        noteLoudnessApplyFailure();
        logError('Loudness:Release', e);
      }
    })();
  }
}

export function isLoudnessNormalizationStarted(): boolean { return started; }
export function getLastNormalization(): NormalizationResult { return lastResult; }
export function getGainTagCacheSize(): number { return gainTags.size; }

export function _resetLoudnessRuntimeForTest(): void {
  stopLoudnessNormalization();
  gainTags.clear();
}

/** @internal test dikişi — gömülü etiket okumasını taklit eder. */
export function _setGainTagForTest(
  id: string, tag: { gainDb: number | null; gainPeak: number | null; gainSource: string } | null,
): void {
  cacheSet(id, tag === null ? null : Object.freeze({ ...tag }));
}
