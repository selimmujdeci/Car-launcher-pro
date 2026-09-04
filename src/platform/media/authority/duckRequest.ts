/**
 * duckRequest.ts — MUSIC F6.1 · Kanonik duck İSTEK adaptörü.
 *
 * ÖNCESİ (ölçüldü, F6 raporu §Açık borç 3): TTS · Mavi · klip · dinleme yolları
 * `audioService.duckMedia()` çağırıyordu. O fonksiyon bir **Web Audio**
 * `masterGain` düğümünü kısıyordu; üretimde o zincire HİÇBİR kaynak bağlı
 * değildi (`connectSource` hiç çağrılmıyordu) → çağrı **duyulur hiçbir şey
 * yapmıyordu**. Yani CarOS konuşurken müzik GERÇEKTE kısılmıyordu.
 *
 * SONRASI: tek duck otoritesi `duckPolicy` + `mediaCommandGateway.duck/unduck`
 * (JS tarafı) ve `CarosAudioFocusManager` (native taraf). Bu dosya bir
 * **adaptördür**: kendi duck durumunu TUTMAZ, seviye/öncelik HESAPLAMAZ,
 * ikinci otorite KURMAZ. Yalnız senkron çağrı ergonomisini (eski
 * `duckMedia()`/`unduckMedia()` deseni) token güvenli hale getirir.
 *
 * Yarış güvenliği: `duck()` asenkrondur. Token gelmeden `release()` çağrılırsa
 * token geldiği anda otomatik bırakılır — "duck açık kaldı" sızıntısı olmaz.
 * `release()` idempotenttir; bayat token gateway tarafında zaten sesi
 * YÜKSELTEMEZ.
 *
 * Fail-soft: gateway yüklenemez veya komut reddedilirse ducking olmaz; TTS ve
 * oynatma ETKİLENMEZ (Cross-Domain §16).
 */

import type { DuckReason } from './duckPolicy';

export type { DuckReason };

/** Tek duck isteğinin ömrü. `release()` idempotenttir. */
export interface DuckHandle {
  readonly reason: DuckReason;
  release(): void;
}

type GatewayModule = typeof import('./mediaCommandGateway');

/**
 * Gateway statik DEĞİL dinamik yüklenir: ses/TTS hattı medya otorite grafiğini
 * (backend adaptörleri, native köprü) kendi paketine çekmemelidir.
 */
let _gatewayPromise: Promise<GatewayModule> | null = null;

function gateway(): Promise<GatewayModule> {
  if (_gatewayPromise === null) _gatewayPromise = import('./mediaCommandGateway');
  return _gatewayPromise;
}

/** Ölçüm — LAB/test için: kaç istek açıldı, kaçı bırakıldı, kaçı düştü. */
let _requested = 0;
let _released = 0;
let _failed = 0;

/**
 * Kanonik duck başlatır. Senkron döner; token asenkron gelir.
 *
 * @param reason canonical `DuckReason` — seviye/öncelik `duckPolicy`nindir.
 */
export function requestDuck(reason: DuckReason): DuckHandle {
  _requested++;
  let released = false;
  let token = 0;

  void gateway()
    .then((gw) => gw.duck(reason))
    .then((t) => {
      token = t;
      // release() token gelmeden çağrıldıysa burada kapatılır (sızıntı yok).
      if (released && t > 0) {
        return gateway().then((gw) => { void gw.unduck(t); });
      }
      return undefined;
    })
    .catch(() => { _failed++; });

  return {
    reason,
    release(): void {
      if (released) return;
      released = true;
      _released++;
      if (token > 0) {
        const t = token;
        token = 0;
        void gateway().then((gw) => { void gw.unduck(t); }).catch(() => { _failed++; });
      }
    },
  };
}

/** Salt-okunur sayaçlar (gözlemlenebilirlik; hiçbir karar bunlardan türemez). */
export function getDuckRequestCounters(): Readonly<{
  requested: number; released: number; failed: number;
}> {
  return { requested: _requested, released: _released, failed: _failed };
}

/** Yalnız test: sayaçları ve memoize edilmiş gateway referansını sıfırlar. */
export function __resetDuckRequestForTest(): void {
  _gatewayPromise = null;
  _requested = 0;
  _released = 0;
  _failed = 0;
}
