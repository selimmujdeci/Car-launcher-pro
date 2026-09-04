/**
 * musicIntelligenceRuntime.ts — MUSIC F8 · Sürüş-farkında müzik zekâsının TEK dikişi.
 *
 * Zincir:
 *   `bağlam kaynakları → drivingContextModel (SAF) → preferenceEvidence (sınırlı)
 *      → musicIntelligenceModel (SAF) → KARAR → (kullanıcı onayıyla) kanonik F3/F7 yolu`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER YOKTUR.** Bu modül hiçbir zamanlayıcı kurmaz, hiçbir şeyi
 *     yoklamaz (polling yok). Yalnız (a) dinleme oturumu DEĞİŞTİĞİNDE kanıt
 *     yazar, (b) çağıran değerlendirme istediğinde karar üretir.
 *   · İkinci playback · kuyruk · arama · öneri STORE'u KURMAZ. Kanıt deposu
 *     yalnız `preferenceEvidence`, karar yalnız saf modeldir.
 *   · Yürütme kanonik yollardır: kütüphane niyeti `startLibraryListening` (F3),
 *     "kaldığın yerden devam" `carosMediaLayer.resumeLastMedia` (F7.6 zinciri).
 *     Sağlayıcıya/native'e DOĞRUDAN komut YOKTUR.
 *   · Geri yüklenen (restored) oturum kullanıcı SEÇİMİ sayılmaz — kanıt yazmaz.
 *
 * Zero-Leak: `stopMusicIntelligence()` aboneliği bırakır ve durumu sıfırlar.
 */

import { logError } from '../../crashLogger';
import { getMusicLibrarySnapshot } from '../musicIndex';
import { getSnapshot as getNativeSnapshot } from '../authority/nativeAuthorityBridge';
import type { SourceClass } from '../authority/sourceCapabilities';
import {
  getListeningSession, subscribeListeningSession, type ListeningSession,
} from '../session/listeningSession';
import { startLibraryListening, type StartListeningResult } from '../session/listeningSessionRuntime';
import {
  classifyDrivingContext, type DrivingContext, type MotionClass,
} from './drivingContextModel';
import { readDrivingContextInput } from './drivingContextSources';
import {
  bestPreferenceFor, getPreferenceEvidence, KEPT_MIN_DWELL_MS, notePreferenceOutcome,
} from './preferenceEvidence';
import {
  candidateFromPreference, decideMusicIntelligence,
  type IntelligenceCandidate, type IntelligenceDecision,
} from './musicIntelligenceModel';
import {
  noteIntelligenceApplied, noteIntelligenceDecision, noteIntelligenceObservation,
} from './intelligenceTelemetry';

/** Aynı girdiyle art arda gelen değerlendirmelerde kararın yeniden kullanıldığı pencere. */
export const DECISION_CACHE_MS = 1_000;

let started = false;
let unsubscribe: (() => void) | null = null;

/** Histerezis durumu — bağlam sınıfı bant içinde titremesin. */
let lastMotion: MotionClass = 'UNKNOWN';

/** Kullanıcının son AÇIK seçiminin anı — otomasyon bunun önüne GEÇEMEZ. */
let explicitIntentAtMs: number | null = null;

/** İzlenen son oturum — kalış süresinden KORUNDU/BIRAKILDI türetilir. */
interface TrackedSession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly bucket: string;
  readonly intent: ListeningSession['intent'];
  readonly libraryRef: string | null;
  readonly sourceClass: SourceClass;
}
let tracked: TrackedSession | null = null;

let cache: { key: string; value: IntelligenceDecision; atMs: number } | null = null;

function now(): number { return Date.now(); }
function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/** Bağlamı ölçer (histerezis taşınır). Hot path DEĞİLDİR. */
export function readDrivingContext(nowMs = now()): DrivingContext {
  const context = classifyDrivingContext(readDrivingContextInput(lastMotion, nowMs));
  lastMotion = context.motion;
  return context;
}

/**
 * F0 ses kanıtı. `null` = otorite yok/bilinmiyor — "çalmıyor" DEMEK DEĞİLDİR.
 * Karar modeli bu ayrımı kendi kapılarında kullanır.
 */
function readPlaybackActive(): boolean | null {
  try {
    const s = getNativeSnapshot();
    if (s.authorityAvailable !== true) return null;
    return s.playing === true || s.renderingVerified === true;
  } catch {
    return null;
  }
}

/**
 * Kütüphane kökenli niyetin kanonik referansı.
 *
 * Sağlayıcı kökenli oturumda `null` döner: sağlayıcı İÇERİK kimliği tercih
 * modeline YAZILMAZ (gizlilik sınırı — `preferenceEvidence` başlığı).
 */
function libraryRefOf(session: ListeningSession): string | null {
  const providerNs = session.currentItem?.providerNamespace ?? null;
  const isLibrary = providerNs === 'MEDIASTORE';
  if (!isLibrary) return null;
  if (session.intentRef !== null && session.intentRef.length > 0) return session.intentRef;
  /* Düz parça listesinde niyet referansı yoktur; kanonik kütüphane kimliği
     kullanılır (cihaz-yerel `musicIndex` kimliği — ad/URI DEĞİL). */
  return session.currentItem?.libraryId ?? null;
}

/** Önceki oturumu kalış süresine göre kapat — timer GEREKTİRMEZ. */
function flushTracked(nowMs: number): void {
  const prev = tracked;
  tracked = null;
  if (prev === null) return;
  const dwell = nowMs - prev.startedAt;
  const outcome = dwell >= KEPT_MIN_DWELL_MS ? 'KEPT' : 'ABANDONED';
  if (prev.bucket === 'UNKNOWN') { noteIntelligenceObservation('DROPPED_UNKNOWN'); return; }
  notePreferenceOutcome({
    bucket: prev.bucket,
    intent: prev.intent,
    libraryRef: prev.libraryRef,
    sourceClass: prev.sourceClass,
    outcome,
    nowMs,
  });
  noteIntelligenceObservation(outcome);
}

/**
 * Dinleme oturumu değişti — kanıt yaz.
 *
 * Aynı oturumun içindeki güncellemeler (parça değişimi, süreklilik notu) kanıt
 * ÜRETMEZ: tercih, kullanıcının BAŞLATTIĞI bağlamdır.
 */
function onListeningSessionChanged(): void {
  const nowMs = now();
  let session: ListeningSession | null = null;
  try { session = getListeningSession(); } catch { session = null; }

  if (session === null) { flushTracked(nowMs); return; }
  if (tracked !== null && tracked.sessionId === session.sessionId) return;

  flushTracked(nowMs);

  /* Geri yüklenen oturum bir SEÇİM değildir — kanıt yazmaz, izlenmez. */
  if (session.restored) return;

  /* AÇIK KULLANICI NİYETİ buradan TÜRETİLİR — F5/F7 modüllerine F8 çağrısı
     eklemeye gerek yoktur (ters bağımlılık kurulmaz). Geri yükleme dışında
     başlayan her dinleme bağlamı kullanıcının kendi seçimidir; F8 bu andan
     itibaren `EXPLICIT_INTENT_TTL_MS` boyunca SUSAR. */
  explicitIntentAtMs = nowMs;
  cache = null;

  const context = readDrivingContext(nowMs);
  const entry: TrackedSession = Object.freeze({
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    bucket: context.bucket,
    intent: session.intent,
    libraryRef: libraryRefOf(session),
    sourceClass: session.originSource,
  });
  tracked = entry;

  if (entry.bucket === 'UNKNOWN') { noteIntelligenceObservation('DROPPED_UNKNOWN'); return; }
  notePreferenceOutcome({
    bucket: entry.bucket,
    intent: entry.intent,
    libraryRef: entry.libraryRef,
    sourceClass: entry.sourceClass,
    outcome: 'STARTED',
    nowMs,
  });
  noteIntelligenceObservation('STARTED');
}

/**
 * Kullanıcı AÇIK bir seçim yaptı (arama sonucu · keşif · liste · sesli komut).
 *
 * Bu çağrıdan sonra F8 belirli bir süre SUSAR: otomasyon kullanıcının önüne
 * geçemez (`EXPLICIT_INTENT_TTL_MS`).
 */
export function noteExplicitUserIntent(nowMs = now()): void {
  explicitIntentAtMs = Number.isFinite(nowMs) ? nowMs : null;
  cache = null;
}

export function getExplicitUserIntentAtMs(): number | null { return explicitIntentAtMs; }

/**
 * Kararı üretir.
 *
 * Ölçüm: karar süresi `intelligenceTelemetry`ye yazılır. Aynı girdi 1 sn
 * içinde tekrar sorulursa yeniden hesaplanmaz (render döngüsü maliyeti).
 */
export function evaluateMusicIntelligence(nowMs = now()): IntelligenceDecision {
  const startedAtMono = mono();
  const context = readDrivingContext(nowMs);
  const preference = getPreferenceEvidence(nowMs);
  const playbackActive = readPlaybackActive();
  let sessionId: string | null = null;
  try { sessionId = getListeningSession()?.sessionId ?? null; } catch { sessionId = null; }

  const key = [
    context.bucket, context.journey, context.confidence,
    String(playbackActive), sessionId ?? '-',
    String(explicitIntentAtMs ?? '-'), String(preference.revision),
  ].join('|');

  if (cache !== null && cache.key === key && nowMs - cache.atMs <= DECISION_CACHE_MS) {
    return cache.value;
  }

  const value = decideMusicIntelligence({
    context,
    preference,
    playbackActive,
    sessionActive: sessionId !== null,
    explicitIntentAtMs,
    nowMs,
  });

  noteIntelligenceDecision({
    action: value.action,
    reason: value.reason,
    suppressedBy: value.suppressedBy,
    bucket: value.bucket,
    elapsedMs: mono() - startedAtMono,
    atMs: nowMs,
  });
  cache = { key, value, atMs: nowMs };
  return value;
}

/**
 * Adayı KANONİK yoldan uygular.
 *
 * Kütüphane niyeti F3'ün `startLibraryListening`ine iner; "kaldığın yerden
 * devam" ise F7.6 zincirini kullanan kanonik `resumeLastMedia`ya. Burada
 * sağlayıcıya veya native'e doğrudan komut YOKTUR.
 *
 * Uygulama KULLANICI EYLEMİDİR: çağıran, kullanıcının onayladığını (öneri
 * kartına dokunma / çal tuşu) bilir. Bu fonksiyon kendi başına tetiklenmez.
 */
export async function applyIntelligenceCandidate(
  candidate: IntelligenceCandidate, nowMs = now(),
): Promise<boolean> {
  try {
    let ok = false;
    switch (candidate.selection.kind) {
      case 'ALBUM':
        ok = (await startLibraryListening({ kind: 'ALBUM', albumId: candidate.selection.albumId })).started;
        break;
      case 'ARTIST':
        ok = (await startLibraryListening({ kind: 'ARTIST', artistId: candidate.selection.artistId })).started;
        break;
      case 'FOLDER':
        ok = (await startLibraryListening({ kind: 'FOLDER', folderId: candidate.selection.folderId })).started;
        break;
      case 'TRACKS': {
        const trackId = candidate.selection.trackId;
        const result: StartListeningResult = await startLibraryListening({
          kind: 'TRACKS', trackIds: [trackId], startTrackId: trackId,
        });
        ok = result.started;
        break;
      }
      case 'RESUME': {
        const layer = await import('../carosMediaLayer');
        ok = layer.resumeLastMedia();
        break;
      }
      default:
        ok = false;
    }
    noteIntelligenceApplied(ok);
    /* Uygulama kullanıcı onayıyla olur → açık niyet penceresi başlar. */
    if (ok) noteExplicitUserIntent(nowMs);
    return ok;
  } catch (e) {
    logError('MusicIntelligence:Apply', e);
    noteIntelligenceApplied(false);
    return false;
  }
}

/**
 * MUSIC F9 · AÇIK kullanıcı isteği için kanıt okuması.
 *
 * Fark şudur: `evaluateMusicIntelligence` **istenmemiş** otomasyonun kapılarını
 * uygular (ses çıkıyor · açık niyet · yolculuk evresi …). Kullanıcı AÇIKÇA
 * "yola uygun bir şey aç" dediğinde o kapılar anlamsızdır — istek zaten
 * kullanıcının kendisinden gelmiştir (Cross-Domain §12: Mavi requester'dır).
 *
 * Bu fonksiyon YALNIZ kanıt okur: tercih kanıtı YAZMAZ, oturum başlatmaz,
 * komut göndermez ve üretim histerezisini ilerletmez.
 */
export interface ExplicitRequestEvaluation {
  readonly candidate: IntelligenceCandidate | null;
  readonly confidence: DrivingContext['confidence'];
  readonly bucket: string;
  readonly motion: DrivingContext['motion'];
  readonly journey: DrivingContext['journey'];
  /** Bu kovada KORUNMUŞ bir dinleme kanıtı var mı. */
  readonly hasEvidence: boolean;
}

export function evaluateForExplicitRequest(nowMs = now()): ExplicitRequestEvaluation {
  const context = peekDrivingContext(nowMs);
  const preference = getPreferenceEvidence(nowMs);
  const entry = bestPreferenceFor(context.bucket, preference);
  const candidate = entry === null ? null : candidateFromPreference(entry);
  return Object.freeze({
    candidate,
    confidence: context.confidence,
    bucket: context.bucket,
    motion: context.motion,
    journey: context.journey,
    hasEvidence: candidate !== null,
  });
}

/**
 * Adayın KULLANICIYA gösterilecek adı.
 *
 * Ad kanonik kütüphaneden (`musicIndex`) çözülür; çözülemezse `null` döner ve
 * öneri GÖSTERİLMEZ — silinmiş bir albüm için satır UYDURULMAZ.
 *
 * Kullanıcıya skor · gerekçe · kova · güven GÖSTERİLMEZ (bunlar yalnız LAB).
 */
export function resolveCandidateLabel(
  candidate: IntelligenceCandidate,
): { readonly title: string; readonly subtitle: string | null } | null {
  try {
    const lib = getMusicLibrarySnapshot();
    switch (candidate.selection.kind) {
      case 'ALBUM': {
        const id = candidate.selection.albumId;
        const a = lib.albums.find((x) => x.id === id);
        return a && a.title ? { title: a.title, subtitle: a.artist } : null;
      }
      case 'ARTIST': {
        const id = candidate.selection.artistId;
        const a = lib.artists.find((x) => x.id === id);
        return a && a.name ? { title: a.name, subtitle: null } : null;
      }
      case 'FOLDER': {
        const id = candidate.selection.folderId;
        const f = lib.folders.find((x) => x.id === id);
        if (!f) return null;
        const leaf = f.path.split(/[\\/]/).filter(Boolean).pop() ?? f.path;
        return { title: leaf, subtitle: null };
      }
      case 'TRACKS': {
        const id = candidate.selection.trackId;
        const tr = lib.tracks.find((x) => x.id === id && x.availability === 'AVAILABLE');
        return tr ? { title: tr.title ?? 'Parça', subtitle: tr.artist } : null;
      }
      case 'RESUME':
        return { title: 'Kaldığın yerden devam', subtitle: null };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * LAB/teşhis okuması — karar ÜRETMEZ ve **üretim durumunu DEĞİŞTİRMEZ**.
 *
 * `readDrivingContext` histerezis durumunu ilerletir; LAB'ın bunu yapması
 * gözlemin gözleneni etkilemesi olurdu (LAB ikinci otorite OLAMAZ). Bu yüzden
 * burada aynı sınıflandırma YAZMADAN çalıştırılır.
 */
export function peekDrivingContext(nowMs = now()): DrivingContext {
  return classifyDrivingContext(readDrivingContextInput(lastMotion, nowMs));
}

/**
 * Başlatır. TIMER KURMAZ — yalnız kanonik dinleme oturumuna abone olur.
 * İdempotenttir; `stopMusicIntelligence` LIFO cleanup ile güvenlidir.
 */
export function startMusicIntelligence(): void {
  if (started) return;
  started = true;
  try {
    unsubscribe = subscribeListeningSession(() => {
      try { onListeningSessionChanged(); } catch (e) { logError('MusicIntelligence:Observe', e); }
    });
  } catch (e) {
    logError('MusicIntelligence:Start', e);
    started = false;
  }
}

export function stopMusicIntelligence(): void {
  started = false;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  tracked = null;
  cache = null;
}

export function isMusicIntelligenceStarted(): boolean { return started; }

export function _resetMusicIntelligenceForTest(): void {
  stopMusicIntelligence();
  lastMotion = 'UNKNOWN';
  explicitIntentAtMs = null;
}
