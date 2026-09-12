/**
 * nativeAuthorityBridge.ts — MÜZİK HUB PAKET A · JS ↔ native otorite köprüsü.
 *
 * TEK TÜKETİCİ: MediaCommandGateway. Bileşenler, servisler veya Mavi bu modülü
 * doğrudan çağırmaz; komut kapısı tektir.
 *
 * DÜRÜSTLÜK: `command()` yalnız "kabul edildi mi" bilgisini döner. Oynatmanın
 * gerçekten başladığı YALNIZCA snapshot'taki `renderingVerified` ile bilinir.
 * Bu ayrım burada bozulmaz.
 *
 * WEB MODU: native yoksa hiçbir çağrı yapılmaz ve `authorityAvailable: false`
 * döner (uydurma "çalışıyor" durumu üretilmez).
 *
 * Zero-Leak: `stop()` event aboneliğini kaldırır; abonelik iki kez kurulmaz.
 */

import { isNative } from '../../bridge';
import { CarLauncher } from '../../nativePlugin';
import type { NativeAuthoritySnapshot } from '../../nativePlugin';
import { logError } from '../../crashLogger';
/* ARCH-06/F1 — T0 sayaç (tek tamsayı artırımı). Bu satır hiçbir kararı,
   kadansı ya da sahipliği DEĞİŞTİRMEZ. */
import { bumpPerf } from '../../perf/perfCounters';

export type NativeCommand =
  | 'setQueue'
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'next'
  | 'previous'
  | 'setShuffle'
  | 'setRepeat'
  | 'setVolume'
  | 'duck'
  | 'unduck'
  /** MUSIC F20 — parça sınırı geçiş politikası (fade süreleri). */
  | 'setTransitionPolicy';

export interface NativeCommandResult {
  readonly accepted: boolean;
  readonly failureCode: string;
}

/** Native yokken dönen dürüst "otorite yok" görüntüsü. */
export const UNAVAILABLE_SNAPSHOT: NativeAuthoritySnapshot = {
  authorityAvailable: false,
  activeSource: 'NONE',
  focusState: 'NONE',
  audioRoute: 'UNKNOWN',
  playing: false,
  renderingVerified: false,
};

let _snapshot: NativeAuthoritySnapshot = UNAVAILABLE_SNAPSHOT;
let _listenerStop: (() => void) | null = null;
let _started = false;
let _commandSeq = 0;
let _listenerGeneration = 0;

const _subscribers = new Set<(s: NativeAuthoritySnapshot) => void>();

/** Aynı işlemde tekil komut kimliği — native tarafta replay koruması bunu kullanır. */
export function nextCommandId(prefix = 'cmd'): string {
  _commandSeq += 1;
  return `${prefix}-${_commandSeq}`;
}

function _emit(s: NativeAuthoritySnapshot): void {
  _snapshot = s;
  _subscribers.forEach((fn) => {
    try { fn(s); } catch { /* abone hatası köprüyü bozmaz */ }
  });
}

/**
 * Gelen native yükünü doğrular. Bozuk/eksik alanlar UYDURULMAZ; yalnız
 * tip güvenliği sağlanır ve bilinmeyen alanlar düşürülür.
 */
export function sanitizeAuthoritySnapshot(raw: unknown): NativeAuthoritySnapshot {
  if (!raw || typeof raw !== 'object') return UNAVAILABLE_SNAPSHOT;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.length <= 512 ? v : fallback;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

  const reasons = Array.isArray(r.duckReasons)
    ? (r.duckReasons as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .slice(0, 16)
    : undefined;

  return {
    authorityAvailable: r.authorityAvailable === true,
    activeSource: str(r.activeSource, 'NONE'),
    focusState: str(r.focusState, 'NONE'),
    hasAudioFocus: bool(r.hasAudioFocus),
    userPaused: bool(r.userPaused),
    pausedByFocus: bool(r.pausedByFocus),
    duckVolume: num(r.duckVolume),
    duckReasons: reasons,
    userVolume: num(r.userVolume),
    effectiveVolume: num(r.effectiveVolume),
    audioRoute: str(r.audioRoute, 'UNKNOWN'),
    noisyReceiver: bool(r.noisyReceiver),
    lastPauseReason: str(r.lastPauseReason, ''),
    lastFailureCode: str(r.lastFailureCode, ''),
    queueRevision: num(r.queueRevision),
    queueLength: num(r.queueLength),
    currentIndex: num(r.currentIndex),
    queueEntryIds: Array.isArray(r.queueEntryIds) ? r.queueEntryIds.filter((id): id is string => typeof id === 'string').slice(0, 120) : undefined,
    positionMs: num(r.positionMs),
    durationMs: num(r.durationMs),
    buffering: bool(r.buffering),
    playing: r.playing === true,
    playWhenReady: bool(r.playWhenReady),
    renderingVerified: r.renderingVerified === true,
    /* MUSIC F20 — geçiş gözlem alanları. Native ZATEN yayınlıyordu; bu
       allowlist'te olmadıkları için düşüyorlardı (telefon ön doğrulaması).
       Playback truth ÜRETMEZLER: `playing`/`renderingVerified` yukarıda
       ayrı ve bunlardan BAĞIMSIZ okunur. */
    fadeEnabled: bool(r.fadeEnabled),
    fadeOutMs: num(r.fadeOutMs),
    fadeInMs: num(r.fadeInMs),
    transitionGain: num(r.transitionGain),
    transitionActive: bool(r.transitionActive),
    gaplessSupported: bool(r.gaplessSupported),
    recoveryCount: num(r.recoveryCount),
    shuffle: bool(r.shuffle),
    repeat: str(r.repeat, 'off'),
    title: str(r.title, ''),
    artist: str(r.artist, ''),
    artworkUri: str(r.artworkUri, ''),
    currentTrackId: str(r.currentTrackId, ''),
  };
}

/** Otoriteyi başlatır ve event akışını açar. Çift çağrı güvenlidir. */
export async function startNativeAuthority(): Promise<void> {
  if (_started) return;
  _started = true;
  const generation = ++_listenerGeneration;
  if (!isNative) return;   // web: sessiz, otorite YOK

  try {
    const handle = await CarLauncher.addListener('mediaAuthorityEvent', (data) => {
      bumpPerf('bridge.mediaAuthorityEvent.received');
      if (!_started || generation !== _listenerGeneration) return;
      _emit(sanitizeAuthoritySnapshot(data));
    });
    _listenerStop = () => { try { handle.remove(); } catch { /* ignore */ } };
  } catch (e) {
    logError('MediaAuthority:Listener', e);
  }

  try {
    await CarLauncher.mediaAuthorityConnect();
    await refreshSnapshot();
  } catch (e) {
    logError('MediaAuthority:Connect', e);
  }
}

/** Zero-Leak teardown — abonelik kaldırılır, durum sıfırlanır. */
export function stopNativeAuthority(): void {
  _started = false;
  _listenerGeneration += 1;
  if (_listenerStop) {
    const stop = _listenerStop;
    _listenerStop = null;
    try { stop(); } catch { /* ignore */ }
  }
  _snapshot = UNAVAILABLE_SNAPSHOT;
}

/** Anlık durum — event akışı yoksa bile elle tazelenebilir. */
export async function refreshSnapshot(): Promise<NativeAuthoritySnapshot> {
  if (!isNative) return UNAVAILABLE_SNAPSHOT;
  try {
    const raw = await CarLauncher.mediaAuthoritySnapshot();
    const s = sanitizeAuthoritySnapshot(raw);
    _emit(s);
    return s;
  } catch {
    // Okunamadı: SON BİLİNEN durumu "doğru" diye sunmayız — otorite yok deriz.
    _emit(UNAVAILABLE_SNAPSHOT);
    return UNAVAILABLE_SNAPSHOT;
  }
}

export function getSnapshot(): NativeAuthoritySnapshot {
  return _snapshot;
}

export function subscribe(fn: (s: NativeAuthoritySnapshot) => void): () => void {
  _subscribers.add(fn);
  return () => { _subscribers.delete(fn); };
}

/** Native tarafta gerçekten ses üretiliyor mu (tek doğrulama kaynağı). */
export function isRenderingVerified(): boolean {
  return _snapshot.authorityAvailable && _snapshot.renderingVerified;
}

/**
 * Typed komut gönderir. Dönen `accepted` "komut kabul edildi" demektir;
 * "çalıyor" DEMEZ — bunu çağıran karıştırmamalıdır.
 */
export async function command(
  cmd: NativeCommand,
  payload?: Record<string, unknown>,
  commandId?: string,
): Promise<NativeCommandResult> {
  if (!isNative) return { accepted: false, failureCode: 'authority_unavailable' };
  try {
    const res = await CarLauncher.mediaAuthorityCommand({
      commandId: commandId ?? nextCommandId(cmd),
      command: cmd,
      payload: payload ?? {},
    });
    const out: NativeCommandResult = {
      accepted: res?.accepted === true,
      failureCode: typeof res?.failureCode === 'string' ? res.failureCode : '',
    };
    // Komuttan sonra gözlemi tazele — "gönderdim, oldu saydım" tuzağını kapatır.
    void refreshSnapshot();
    return out;
  } catch (e) {
    logError(`MediaAuthority:${cmd}`, e);
    return { accepted: false, failureCode: 'bridge_error' };
  }
}

/** Test/teardown yardımcı — modül durumunu sıfırlar. */
export function __resetForTest(): void {
  _snapshot = UNAVAILABLE_SNAPSHOT;
  _started = false;
  _commandSeq = 0;
  _subscribers.clear();
  if (_listenerStop) { try { _listenerStop(); } catch { /* ignore */ } }
  _listenerStop = null;
}
