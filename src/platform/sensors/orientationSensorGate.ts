/**
 * orientationSensorGate — Cihaz yön/hareket Web event'leri için MERKEZİ,
 * ref-count'lu abonelik kapısı (multiplexer).
 *
 * NEDEN (kanıt): Bugün `deviceorientationabsolute` / `deviceorientation` /
 * `devicemotion` event'lerine ≥6 servis (gpsService compass, smartDrivingEngine,
 * arAlignmentService, dashcamService, blackBoxService, deviceApi) AYRI AYRI
 * `window.addEventListener` ile abone oluyor. İkisi (compass + accelerometer)
 * kök layout'ta app-ömrü boyunca bağlı → Ayarlar dahil HER ekranda sensör aktif.
 * Bu kapı, tüketicilerin ham event'e doğrudan abone olması yerine TEK fiziksel
 * listener üzerinden fan-out yapmasını ve görünürlük (visibility) durumuna göre
 * fiziksel listener'ın açılıp kapanmasını sağlar.
 *
 * BU DOSYANIN YAPMADIĞI (foundation — PR 1):
 *   - Hiçbir tüketiciyi (gpsService/smartDrivingEngine/arAlignment/…) bağlamaz.
 *     Gerçek wiring AYRI PR'lardır (PR 2 on-demand, PR 3 always-on talep-güdümlü).
 *   - Native sampling rate'i DEĞİŞTİRMEZ / böyle bir iddia taşımaz. Legacy
 *     DeviceOrientation/DeviceMotion event API'sinin frekans parametresi yoktur;
 *     bu kapı yalnız JS-tarafı aboneliği yönetir. Fiziksel listener bağlıyken
 *     native sampling 60 Hz olabilir — CPU/samplingPeriod kazancı PR 2/3 wiring'i
 *     (özellikle talep-güdümlü acquire + background pause) ile ölçülür.
 *   - Permission (izin) akışına dokunmaz — izin sorma/erişim tüketicide kalır.
 *   - Generic Sensor API eklemez, JS throttle eklemez.
 *
 * TASARIM İLKELERİ:
 *   - Event türü başına TEK fiziksel `window` listener (dedup).
 *   - Callback Set ile ref-count; ilk consumer → bağla, son consumer → sök.
 *   - `document.visibilityState !== 'visible'` → fiziksel listener sökülür;
 *     görünür + aktif consumer → yeniden bağlanır.
 *   - Deterministik dağıtım sırası (Set insertion order, sabit dizi snapshot'ı).
 *   - Event başına YENİ array/object allocation YOK (index'li döngü, kararlı dizi).
 *   - Bir callback fırlatırsa diğerleri ETKİLENMEZ (izolasyon, fail-soft).
 *   - Public API ASLA throw etmez; dispose sonrası güvenli no-op.
 *   - Import yan etkisiz (modül seviyesinde HİÇBİR listener kurulmaz; ilk abonelik
 *     çağrısına kadar `visibilitychange` bile bağlanmaz), timer/rAF/polling YOK.
 *   - Bağımsız modül: HİÇBİR import YOK.
 */

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC TYPES                                                    */
/* ─────────────────────────────────────────────────────────────── */

export type OrientationCallback = (event: DeviceOrientationEvent) => void;
export type MotionCallback      = (event: DeviceMotionEvent) => void;

/** Aboneliği kaldıran fonksiyon. İdempotenttir (birden çok çağrı güvenli). */
export type Release = () => void;

export interface OrientationGateChannelStatus {
  subscriberCount:  number;
  listenerAttached: boolean;
}

export interface OrientationGateSubscriberCounts {
  orientationAbsolute: number;
  orientation:         number;
  motion:              number;
  total:               number;
}

export interface OrientationGateStatus {
  disposed:                   boolean;
  visible:                    boolean;
  visibilityListenerAttached: boolean;
  droppedSubscriptions:       number;
  callbackErrors:             number;
  channels: {
    orientationAbsolute: OrientationGateChannelStatus;
    orientation:         OrientationGateChannelStatus;
    motion:              OrientationGateChannelStatus;
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* BOUNDS                                                          */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Kanal başına en fazla eşzamanlı consumer. Gerçekte 3-4 tüketici beklenir
 * (bkz. dosya başı); 64 bol bir güvenlik tavanı. Aşımda fail-soft: yeni
 * abonelik sessizce reddedilir (no-op release, droppedSubscriptions++),
 * mevcut consumer'lar ETKİLENMEZ, throw YOK.
 */
const MAX_SUBSCRIBERS_PER_CHANNEL = 64;

/* ─────────────────────────────────────────────────────────────── */
/* INTERNAL CHANNEL MODEL                                          */
/* ─────────────────────────────────────────────────────────────── */

type RawCallback = (event: Event) => void;
type ChannelEventName = 'deviceorientationabsolute' | 'deviceorientation' | 'devicemotion';

interface Channel {
  readonly eventName: ChannelEventName;
  /** Üyelik + dedup için (kimlik referansına göre). */
  readonly cbs: Set<RawCallback>;
  /** Hot-path dağıtımı için kararlı snapshot — yalnız abonelik değişince yeniden kurulur. */
  arr: RawCallback[];
  /** Kararlı fiziksel handler referansı (add/removeEventListener aynı referansı kullanır). */
  handler: RawCallback;
  attached: boolean;
}

function _makeChannel(eventName: ChannelEventName): Channel {
  const ch: Channel = {
    eventName,
    cbs:      new Set<RawCallback>(),
    arr:      [],
    handler:  _noop as RawCallback,
    attached: false,
  };
  // Kararlı referans: her event'te aynı fonksiyon — add/remove eşleşir, alloc yok.
  ch.handler = (event: Event): void => _dispatch(ch, event);
  return ch;
}

/* ─────────────────────────────────────────────────────────────── */
/* MODULE STATE                                                    */
/* ─────────────────────────────────────────────────────────────── */

const _noop: Release = () => { /* no-op */ };

let _disposed = false;
let _visibilityAttached = false;
let _droppedSubscriptions = 0;
let _callbackErrors = 0;

const _chAbs    = _makeChannel('deviceorientationabsolute');
const _chRel    = _makeChannel('deviceorientation');
const _chMotion = _makeChannel('devicemotion');

// Sabit kanal listesi (görünürlük reconcile'ı için — event başına alloc değil).
const _channels: readonly Channel[] = [_chAbs, _chRel, _chMotion];

const _onVisibilityChange = (): void => { _reconcileAll(); };

/* ─────────────────────────────────────────────────────────────── */
/* INTERNAL HELPERS                                                */
/* ─────────────────────────────────────────────────────────────── */

function _hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** Belge görünür mü? Belge yoksa (DOM'suz ortam) görünür kabul edilir. */
function _isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Hot-path dağıtımı — index'li döngü, event başına YENİ array/object YOK. */
function _dispatch(ch: Channel, event: Event): void {
  const arr = ch.arr;
  for (let i = 0; i < arr.length; i++) {
    try {
      arr[i](event);
    } catch {
      // İzolasyon: bir callback'in hatası diğerlerini engellemez (fail-soft).
      _callbackErrors++;
    }
  }
}

/** cbs değişince kararlı dağıtım dizisini yeniden kur (insertion order korunur). */
function _rebuild(ch: Channel): void {
  ch.arr = Array.from(ch.cbs);
}

/** Kanalın fiziksel listener durumunu istenen duruma getir (idempotent). */
function _reconcile(ch: Channel): void {
  if (!_hasWindow()) return;
  const shouldAttach = !_disposed && ch.cbs.size > 0 && _isVisible();
  if (shouldAttach && !ch.attached) {
    window.addEventListener(ch.eventName, ch.handler);
    ch.attached = true;
  } else if (!shouldAttach && ch.attached) {
    window.removeEventListener(ch.eventName, ch.handler);
    ch.attached = false;
  }
}

function _reconcileAll(): void {
  _reconcile(_chAbs);
  _reconcile(_chRel);
  _reconcile(_chMotion);
}

function _ensureVisibilityListener(): void {
  if (_visibilityAttached || _disposed || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', _onVisibilityChange);
  _visibilityAttached = true;
}

function _removeVisibilityListener(): void {
  if (_visibilityAttached && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  }
  _visibilityAttached = false;
}

function _detachAllPhysical(): void {
  if (!_hasWindow()) return;
  for (let i = 0; i < _channels.length; i++) {
    const ch = _channels[i];
    if (ch.attached) {
      window.removeEventListener(ch.eventName, ch.handler);
      ch.attached = false;
    }
  }
}

function _clearChannels(): void {
  for (let i = 0; i < _channels.length; i++) {
    _channels[i].cbs.clear();
    _channels[i].arr = [];
  }
}

/**
 * Ortak abonelik yolu. rawCb, çağrının cast'lenmiş callback'idir — cast
 * derleme-zamanıdır, runtime'da AYNI fonksiyon referansı korunur (dedup ve
 * release kimliği bozulmaz).
 */
function _subscribe(ch: Channel, rawCb: RawCallback): Release {
  // Fail-soft: dispose sonrası veya DOM'suz ortamda güvenli no-op.
  if (_disposed || !_hasWindow()) return _noop;

  // Duplicate: tek kayıt korunur — no-op release döndür (orijinal release yönetir).
  if (ch.cbs.has(rawCb)) return _noop;

  // Bounded: tavan aşılırsa fail-soft reddet (throw yok).
  if (ch.cbs.size >= MAX_SUBSCRIBERS_PER_CHANNEL) {
    _droppedSubscriptions++;
    return _noop;
  }

  ch.cbs.add(rawCb);
  _rebuild(ch);
  _ensureVisibilityListener();
  _reconcile(ch);

  let released = false;
  return (): void => {
    if (released) return;          // idempotent
    released = true;
    if (ch.cbs.delete(rawCb)) {
      _rebuild(ch);
      _reconcile(ch);
    }
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                      */
/* ─────────────────────────────────────────────────────────────── */

/**
 * `deviceorientationabsolute` event'ine abone ol (Android absolute pusula).
 * İdempotent release döndürür. Aynı callback iki kez verilirse tek kayıt tutulur.
 */
export function subscribeOrientationAbsolute(callback: OrientationCallback): Release {
  return _subscribe(_chAbs, callback as unknown as RawCallback);
}

/**
 * `deviceorientation` event'ine abone ol (iOS webkitCompassHeading / fallback).
 */
export function subscribeOrientation(callback: OrientationCallback): Release {
  return _subscribe(_chRel, callback as unknown as RawCallback);
}

/**
 * `devicemotion` event'ine abone ol (ivmeölçer + jiroskop rotationRate).
 */
export function subscribeMotion(callback: MotionCallback): Release {
  return _subscribe(_chMotion, callback as unknown as RawCallback);
}

/** Kanal başına ve toplam aktif consumer sayısı (dondurulmuş kopya). */
export function getSubscriberCounts(): OrientationGateSubscriberCounts {
  const a = _chAbs.cbs.size;
  const r = _chRel.cbs.size;
  const m = _chMotion.cbs.size;
  return Object.freeze({
    orientationAbsolute: a,
    orientation:         r,
    motion:              m,
    total:               a + r + m,
  });
}

/** Kapının tam anlık durumu (dondurulmuş, teşhis/test amaçlı). */
export function getStatus(): OrientationGateStatus {
  return Object.freeze({
    disposed:                   _disposed,
    visible:                    _isVisible(),
    visibilityListenerAttached: _visibilityAttached,
    droppedSubscriptions:       _droppedSubscriptions,
    callbackErrors:             _callbackErrors,
    channels: Object.freeze({
      orientationAbsolute: Object.freeze({ subscriberCount: _chAbs.cbs.size,    listenerAttached: _chAbs.attached }),
      orientation:         Object.freeze({ subscriberCount: _chRel.cbs.size,    listenerAttached: _chRel.attached }),
      motion:              Object.freeze({ subscriberCount: _chMotion.cbs.size, listenerAttached: _chMotion.attached }),
    }),
  }) as OrientationGateStatus;
}

/**
 * Tüm consumer'ları ve fiziksel listener'ları temizle, modülü YENİDEN
 * KULLANILABİLİR temiz duruma döndür (sayaçlar sıfırlanır, disposed=false).
 */
export function reset(): void {
  _detachAllPhysical();
  _clearChannels();
  _removeVisibilityListener();
  _droppedSubscriptions = 0;
  _callbackErrors = 0;
  _disposed = false;
}

/**
 * Kapıyı kalıcı olarak kapat: tüm fiziksel + görünürlük listener'larını sök,
 * consumer'ları temizle. Zero-leak. Sonrasında public API güvenli no-op olur
 * (yeniden kullanmak için `reset()` gerekir).
 */
export function dispose(): void {
  _detachAllPhysical();
  _clearChannels();
  _removeVisibilityListener();
  _disposed = true;
}
