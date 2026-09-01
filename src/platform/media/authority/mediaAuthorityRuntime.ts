/**
 * mediaAuthorityRuntime.ts — MÜZİK HUB PAKET A · Otoritenin uygulama içi ömrü.
 *
 * GÖREVİ:
 *   1. Native otoriteyi başlatmak ve event akışını açmak.
 *   2. GÖZLENEN native durumu mevcut `mediaService` state'ine yansıtmak
 *      (UI sözleşmesi korunur — MediaScreen/mini player değişmeden çalışır).
 *   3. Process-death sonrası kurtarma kararını uygulamak (OTOMATİK ÇALMA YOK).
 *   4. Çalma durumunu throttle'lı kalıcılaştırmak.
 *
 * NEDEN BURADA: `mediaService` state şeması (activePackage / hasSession) UI'ın
 * bildiği sözleşmedir. Otorite yeni bir paralel state kurmaz; ESKİ sözleşmeyi
 * GERÇEK gözlemle besler — böylece "UI bir şey gösteriyor, ses başka" ayrışması
 * ortadan kalkar.
 *
 * Zero-Leak: `stopMediaAuthority()` aboneliği ve zamanlayıcıyı temizler.
 */

import { isNative } from '../../bridge';
import type { NativeAuthoritySnapshot } from '../../nativePlugin';
import * as native from './nativeAuthorityBridge';
import type { SourceClass } from './sourceCapabilities';
import type { PlayItem } from './sourceCoordinator';
import {
  clearPersistedState, decideRecovery, markRecoveryAttempt, markRecoverySucceeded,
  persistPlaybackState, readPersistedRaw,
} from './mediaRecovery';
import { recordRecovery, recordRecoverySucceeded } from './mediaAuthorityEvidence';
import { recordMediaEvent } from './mediaAuthorityEvents';
import { configureQueueRecovery, runQueueRecovery } from './queueRecoveryRuntime';

/**
 * Kurtarma bağımlılıklarını bağlar. Gateway ve UI katmanı DİNAMİK yüklenir:
 * otorite modülü ana pakete UI/gateway zincirini çekmesin (düşük-uç bütçesi).
 */
async function configureRecovery(): Promise<void> {
  try {
    const [gw, layer] = await Promise.all([
      import('./mediaCommandGateway'),
      import('../carosMediaLayer'),
    ]);
    configureQueueRecovery({
      isHandoverInFlight: gw.isHandoverInFlight,
      isUserCommandInFlight: gw.isUserCommandInFlight,
      getGeneration: gw.getAuthorityGeneration,
      alignUiIndex: layer.alignUiQueueIndex,
      clearUiQueue: layer.clearUiQueue,
      now: () => Date.now(),
    });
  } catch { /* kurtarma kurulamazsa otorite yine çalışır (fail-soft) */ }
}

/** Kaynak sınıfı → mevcut UI sözleşmesindeki sözde paket adı. */
const SOURCE_PACKAGE: Readonly<Record<string, string>> = {
  LOCAL: 'com.cockpitos.pro',
  STREAM: 'com.cockpitos.pro.stream',
  INTERNET_RADIO: 'com.cockpitos.pro.stream',
};

/** Sözde paket → kaynak sınıfı (ters eşleme, tek kaynaktan türetilir). */
export function packageToSourceClass(pkg: string): SourceClass | null {
  if (pkg === 'com.cockpitos.pro') return 'LOCAL';
  if (pkg === 'com.cockpitos.pro.stream') return 'STREAM';
  if (pkg === 'com.cockpitos.pro.youtube') return 'YOUTUBE';
  if (pkg === 'com.spotify.music') return 'SPOTIFY_CONNECT';
  return null;
}

export function sourceClassToPackage(source: SourceClass): string {
  return SOURCE_PACKAGE[source] ?? '';
}

let _unsubscribe: (() => void) | null = null;
let _started = false;
let _persistTimer: ReturnType<typeof setInterval> | null = null;
/** Kalıcılaştırma için son bilinen kuyruk (native snapshot kuyruk içeriği taşımaz). */
let _lastQueue: readonly PlayItem[] = [];
let _lastSource: SourceClass | null = null;

/** Kalıcılaştırma periyodu — CLAUDE.md §3: yüksek frekanslı disk yazımı YASAK. */
const PERSIST_PERIOD_MS = 10_000;

/**
 * MÜZİK HUB PAKET B · Native'e GÖNDERİLEN kuyruk penceresi.
 *
 * KRİTİK: native timeline, UI kuyruğunun tamamı DEĞİL, ona gönderilen
 * PENCEREdir (yerel müzikte 120 öğelik kayan pencere). Uzlaştırma UI'nin tüm
 * listesiyle yapılırsa binlerce parçalık kütüphanede SÜREKLİ yanlış "uzunluk
 * sapması" üretilir. Bu yüzden karşılaştırma "native'e NE GÖNDERDİM" ile
 * "native'de NE VAR" arasında yapılır.
 */
let _projectedRevision = 0;
let _projectedIndex = -1;

/** Otoritenin çaldığı kuyruğu kaydet (gateway `playSource` sonrası çağırır). */
export function noteQueue(
  source: SourceClass, items: readonly PlayItem[], startIndex = 0,
): void {
  _lastSource = source;
  _lastQueue = items.slice(0, 200);
  _projectedRevision += 1;   // native'e YENİ pencere yazıldı
  _projectedIndex = Math.max(0, Math.min(startIndex, Math.max(0, _lastQueue.length - 1)));
}

/** UI tarafındaki projeksiyon indeksi ilerledi (sonraki/önceki). */
export function noteProjectedIndex(index: number): void {
  if (!Number.isFinite(index)) return;
  _projectedIndex = Math.max(-1, Math.trunc(index));
}

/**
 * Native'e gönderilmiş pencerenin salt-okunur görünümü — uzlaştırma girdisi.
 * Parça başlığı/URI TAŞIMAZ; yalnız kimlik, indeks, uzunluk, revizyon.
 */
export function getProjectedQueueView(): {
  revision: number; length: number; currentIndex: number;
  currentItemId: string | null; source: SourceClass | null;
} | null {
  if (!_lastSource || _lastQueue.length === 0) return null;
  const cur = _projectedIndex >= 0 ? _lastQueue[_projectedIndex] : undefined;
  return {
    revision: _projectedRevision,
    length: _lastQueue.length,
    currentIndex: _projectedIndex,
    currentItemId: cur ? cur.id : null,
    source: _lastSource,
  };
}

/** Native gözlemi mevcut mediaService sözleşmesine yansıtır. */
async function applySnapshotToMediaState(s: NativeAuthoritySnapshot): Promise<void> {
  if (!s.authorityAvailable) return;
  const pkg = SOURCE_PACKAGE[s.activeSource];
  if (!pkg) return;   // otorite boşta (NONE) → harici oturum mantığı dokunulmaz

  const { updateMediaState, getMediaState } = await import('../../mediaService');
  const cur = getMediaState();

  // Harici bir oturum aktifken otorite boş kuyrukla state'i EZMEZ.
  if ((s.queueLength ?? 0) === 0 && cur.activePackage !== pkg) return;

  updateMediaState({
    hasSession: (s.queueLength ?? 0) > 0,
    playing: s.playing === true,
    source: s.activeSource === 'LOCAL' ? 'local' : 'unknown',
    activePackage: pkg,
    activeAppName: s.activeSource === 'LOCAL' ? 'Cihaz Müziği' : (s.title || 'Kaynak'),
    shuffle: s.shuffle === true,
    repeat: s.repeat === 'one' || s.repeat === 'all' ? s.repeat : 'off',
    track: {
      ...cur.track,
      title: s.title || cur.track.title,
      artist: s.artist || cur.track.artist,
      albumArt: s.artworkUri || cur.track.albumArt,
      positionSec: (s.positionMs ?? 0) / 1000,
      durationSec: (s.durationMs ?? 0) / 1000,
    },
  });

  if (s.activeSource === 'LOCAL') {
    const { reflectCanonicalLocalSnapshot } = await import('../../localMusicService');
    reflectCanonicalLocalSnapshot(s);
  }
}

function persistNow(): void {
  const s = native.getSnapshot();
  if (!s.authorityAvailable || !_lastSource || _lastQueue.length === 0) return;
  persistPlaybackState({
    source: _lastSource,
    queueRevision: s.queueRevision ?? 0,
    items: _lastQueue,
    currentIndex: s.currentIndex ?? 0,
    positionMs: s.positionMs ?? 0,
    shuffle: s.shuffle === true,
    repeat: s.repeat === 'one' || s.repeat === 'all' ? s.repeat : 'off',
    userPaused: s.userPaused === true,
    lastObservedPlaying: s.playing === true,
    nowMs: Date.now(),
  });
}

/**
 * Process-death kurtarması. Kuyruk YÜKLENİR ama ÇALMAZ — kullanıcı play'e
 * basana kadar araçta beklenmedik ses çıkmaz.
 */
async function runRecovery(): Promise<void> {
  const decision = decideRecovery(readPersistedRaw(), Date.now());
  if (decision.action === 'NONE') {
    if (decision.reason === 'corrupt_json' || decision.reason === 'corrupt_shape') {
      clearPersistedState();   // bozuk kayıt fail-soft silinir
    }
    return;
  }
  // Deneme sayacı ÖNCE yazılır: kurtarma çökerse sonsuz döngü oluşmaz.
  markRecoveryAttempt(decision.state);
  recordRecovery();

  const { playSource } = await import('./mediaCommandGateway');
  noteQueue(decision.state.source, decision.state.items, decision.state.currentIndex);
  const truth = await playSource({
    source: decision.state.source,
    items: decision.state.items,
    startIndex: decision.state.currentIndex,
    positionMs: decision.state.positionMs,
    autoPlay: false,   // ASLA otomatik çalma
  });

  /* Kurtarma TAMAMLANDI → deneme sayacı sıfırlanır.
     Sayacın amacı "kurtarma denemesi süreci öldürüyor mu" korumasıdır; komut
     hata/zaman aşımı ÜRETMEDEN döndüyse döngü kırılmıştır. Sıfırlama YAPILMAZSA
     her açılış sayacı bir artırır ve üçüncü açılıştan sonra `attempts_exhausted`
     ile kurtarma KALICI olarak kapanır — çalışan bir sistemde bile.

     ⚠️ `autoPlay:false` olduğu için "ses çıktı" İDDİA EDİLMEZ: burada ölçülen
     tek şey kuyruğun geri yüklenebildiğidir (istek ≠ ses — `honestClaim` ayrımı). */
  if (truth.outcome === 'VERIFIED' || truth.outcome === 'ACCEPTED_UNVERIFIED') {
    markRecoverySucceeded(decision.state);
    recordRecoverySucceeded();
  }
}

/** Otoriteyi başlatır — idempotent. */
export async function startMediaAuthority(): Promise<void> {
  if (_started) return;
  _started = true;
  if (!isNative) return;

  await native.startNativeAuthority();
  recordMediaEvent({ type: 'service_created', source: 'NONE' });

  // PAKET B: kurtarma dünyayı buradan okur — POLLING YOK, yalnız native anlık
  // görüntü değiştiğinde bir tur koşar.
  await configureRecovery();

  _unsubscribe = native.subscribe((s) => {
    void applySnapshotToMediaState(s);
    // Kurtarma fail-soft'tur ve ASLA oynatma komutu göndermez.
    try { runQueueRecovery(); } catch { /* kurtarma akışı bozamaz */ }
  });

  if (_persistTimer) clearInterval(_persistTimer);
  _persistTimer = setInterval(persistNow, PERSIST_PERIOD_MS);

  try { await runRecovery(); } catch { /* kurtarma ASLA açılışı bozmaz */ }
}

/** Zero-Leak teardown. */
export function stopMediaAuthority(): void {
  _started = false;
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_persistTimer) { clearInterval(_persistTimer); _persistTimer = null; }
  native.stopNativeAuthority();
  _lastQueue = [];
  _lastSource = null;
}

/** Otorite bu paketi (kaynağı) sahipleniyor mu — legacy yönlendirme kapısı. */
export function isAuthorityOwnedPackage(pkg: string): boolean {
  const s = packageToSourceClass(pkg);
  return s === 'LOCAL' || s === 'STREAM' || s === 'INTERNET_RADIO';
}

/** Native otorite şu an kullanılabilir mi (web'de her zaman false). */
export function isAuthorityAvailable(): boolean {
  return isNative && native.getSnapshot().authorityAvailable;
}

export function __resetRuntimeForTest(): void {
  _started = false;
  _lastQueue = [];
  _lastSource = null;
  _projectedRevision = 0;
  _projectedIndex = -1;
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_persistTimer) { clearInterval(_persistTimer); _persistTimer = null; }
}
