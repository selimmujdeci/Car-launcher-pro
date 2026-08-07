/**
 * cameraFollowAuthority.ts — harita kamera takibinin TEK kanonik otoritesi.
 *
 * ── ÇÖZDÜĞÜ ARIZA (MINI_MAP_NIGHT_CAMERA_SPEED_LIMIT_P0) ────────────────────
 * Takip/pan durumu `FullMapView` içinde bir `useState` + `useRef` ikilisiydi
 * (`isFollowing` / `isFollowingRef`) ve **mini haritada HİÇ YOKTU**: mini harita
 * `dragstart` bile dinlemiyordu. Sonuçlar:
 *   • Kullanıcı mini haritayı sürükleyince kamera otoritesi bundan HABERSİZDİ;
 *     bir sonraki GPS fix'i haritayı sessizce aracın üstüne geri atıyordu
 *     (kullanıcı incelediği yeri kaybediyordu).
 *   • "Ortala" düğmesi yalnız tam ekranda ve yalnız navigasyon KAPALIYKEN vardı
 *     (`{!isFollowing && !isNavigating && …}`) → navigasyon sırasında kullanıcı
 *     haritayı kaydırdıysa araca dönmenin HİÇBİR yolu yoktu.
 *   • İki görünüm aynı kavramı iki ayrı yerde tutuyordu → tam ekran ↔ mini
 *     geçişinde takip durumu kayboluyordu.
 *
 * Bu modül o durumu görünümlerden alır. Görünümler yalnız **bildirir**
 * (pan başladı/bitti) ve **okur** (takip ediyor muyum, düğme görünsün mü).
 *
 * ── SINIRLAR (bilinçli) ─────────────────────────────────────────────────────
 * • Haritaya DOKUNMAZ: MapLibre örneği bu modüle GİRMEZ. Kamerayı gerçekten
 *   süren kod görünümde kalır (`enterNavigationView` / `setDrivingView`); burada
 *   yalnız "kim sahibi" kararı yaşar.
 * • Yeni navigasyon durumu / eşik / rota kararı ÜRETMEZ.
 * • Otomatik dönüş gecikmesi UYDURULMADI: mevcut ürün sözleşmesi korunmuştur
 *   (`FullMapView` içindeki 3 sn navigasyonda / 10 sn dışında) — bkz.
 *   `AUTO_FOLLOW_DELAY_NAV_MS` / `AUTO_FOLLOW_DELAY_IDLE_MS`.
 * • Zoom seçmez: `followZoom` yalnız GÖZLEM için kaydedilir; kamera politikası
 *   (hıza göre zoom/pitch) `mapService`'te kalır.
 */

/* ── Durum ────────────────────────────────────────────────────────────────── */

export const CameraFollowState = {
  /** Kamera aracı takip ediyor — GPS fix'i kamerayı sürebilir. */
  FOLLOWING:        'FOLLOWING',
  /** Kullanıcı ŞU AN haritayı sürüklüyor/yakınlaştırıyor. */
  USER_PANNING:     'USER_PANNING',
  /** Kullanıcı bıraktı; harita kullanıcının bıraktığı yerde DURUYOR. */
  FOLLOW_SUSPENDED: 'FOLLOW_SUSPENDED',
  /** Ortalama uygulanıyor (geçici) — çift istek engellenir. */
  RECENTERING:      'RECENTERING',
  /** Bilinmiyor — fail-closed: kamera SÜRÜLMEZ. */
  UNKNOWN:          'UNKNOWN',
} as const;

export type CameraFollowState = typeof CameraFollowState[keyof typeof CameraFollowState];

/** Ortalamanın neden istendiği — gözlem/teşhis için (LAB). */
export type RecenterReason =
  | 'USER_BUTTON'        // kullanıcı "Ortala"ya bastı
  | 'AUTO_TIMEOUT'       // pan sonrası sözleşmedeki gecikme doldu
  | 'NAV_START'          // navigasyon başladı / sürüş moduna girildi
  | 'NAV_END'            // oturum kapandı — durum temizlendi
  | 'NONE';

/* ── Otomatik dönüş gecikmesi — MEVCUT ÜRÜN SÖZLEŞMESİ ──────────────────────
 * Bu iki sayı UYDURULMADI: `FullMapView`'ın `scheduleAutoFollow` fonksiyonunda
 * zaten yürürlükteydi (`isNav ? 3_000 : 10_000`). Otorite taşınırken sözleşme
 * AYNEN korunmuştur; yeni bir süre icat edilmemiştir. */
export const AUTO_FOLLOW_DELAY_NAV_MS  = 3_000;
export const AUTO_FOLLOW_DELAY_IDLE_MS = 10_000;

/* ── İç durum ─────────────────────────────────────────────────────────────── */

let _state: CameraFollowState = CameraFollowState.FOLLOWING;
let _lastUserPanAt:  number | null = null;   // performance.now()
let _lastRecenterAt: number | null = null;
let _recenterReason: RecenterReason = 'NONE';
let _followZoom:     number | null = null;
let _autoTimer: ReturnType<typeof setTimeout> | null = null;
/** Otomatik dönüş için hangi gecikme geçerli — çağıran bildirir (nav mı değil mi). */
let _navActive = false;

type Listener = (s: CameraFollowState) => void;
const _listeners = new Set<Listener>();

function _emit(): void {
  for (const fn of [..._listeners]) {
    try { fn(_state); } catch { /* fail-soft: bir dinleyici diğerlerini düşürmez */ }
  }
}

function _set(next: CameraFollowState): void {
  if (_state === next) return;
  _state = next;
  _emit();
}

function _now(): number {
  try { return performance.now(); } catch { return 0; }
}

function _clearAutoTimer(): void {
  if (_autoTimer !== null) { clearTimeout(_autoTimer); _autoTimer = null; }
}

/* ── Okuma ────────────────────────────────────────────────────────────────── */

export function getCameraFollowState(): CameraFollowState {
  return _state;
}

/**
 * Kamera GPS fix'i ile sürülebilir mi?
 *
 * FAIL-CLOSED: yalnız `FOLLOWING` iken `true`. `UNKNOWN` dahil diğer tüm
 * durumlarda `false` döner — bilinmeyen durumda kamerayı sürmek, kullanıcı
 * haritayı incelerken ekranı altından çekmek demektir.
 */
export function canDriveCamera(): boolean {
  return _state === CameraFollowState.FOLLOWING;
}

/** "Ortala" düğmesi gösterilmeli mi? Araç merkezdeyken (FOLLOWING) gizlenir. */
export function isRecenterAvailable(): boolean {
  return _state === CameraFollowState.USER_PANNING ||
         _state === CameraFollowState.FOLLOW_SUSPENDED ||
         _state === CameraFollowState.UNKNOWN;
}

/** Durum değişimine abone ol. Dönen fonksiyon aboneliği bırakır (Zero-Leak). */
export function subscribeCameraFollow(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/* ── Bildirimler (görünümlerden) ──────────────────────────────────────────── */

/** Navigasyon aktif mi — otomatik dönüş gecikmesini seçer (3 sn / 10 sn). */
export function setCameraNavActive(active: boolean): void {
  _navActive = active;
}

/**
 * Kullanıcı haritayı sürüklemeye/yakınlaştırmaya BAŞLADI.
 * Bekleyen otomatik dönüş İPTAL edilir — kullanıcı hâlâ inceliyorsa kamera
 * altından çekilmez (görev kuralı: "tekrar pan yapılırsa bekleyen recenter
 * iptal edilsin").
 */
export function notifyUserPanStart(): void {
  _clearAutoTimer();
  _lastUserPanAt = _now();
  _set(CameraFollowState.USER_PANNING);
}

/**
 * Kullanıcı hareketi BİTTİ → `FOLLOW_SUSPENDED`. Harita kullanıcının bıraktığı
 * yerde DURUR; kendiliğinden araca ATLAMAZ.
 *
 * Sözleşmedeki gecikme dolduğunda `onAutoRecenter` çağrılır (varsa). Çağıran
 * bunu kamerayı yumuşak biçimde araca almak için kullanır. Geri çağrı
 * verilmezse otomatik dönüş YAPILMAZ ve yalnız elle "Ortala" kalır.
 */
export function notifyUserPanEnd(onAutoRecenter?: () => void): void {
  if (_state !== CameraFollowState.USER_PANNING) return;
  _lastUserPanAt = _now();
  _set(CameraFollowState.FOLLOW_SUSPENDED);

  _clearAutoTimer();
  if (!onAutoRecenter) return;
  const delay = _navActive ? AUTO_FOLLOW_DELAY_NAV_MS : AUTO_FOLLOW_DELAY_IDLE_MS;
  _autoTimer = setTimeout(() => {
    _autoTimer = null;
    // Kullanıcı bu arada yeniden pan yaptıysa durum USER_PANNING'dir → dokunma.
    if (_state !== CameraFollowState.FOLLOW_SUSPENDED) return;
    beginRecenter('AUTO_TIMEOUT');
    try { onAutoRecenter(); } catch { /* fail-soft */ }
    completeRecenter();
  }, delay);
}

/**
 * Ortalama BAŞLADI. Çağıran kamerayı gerçekten hareket ettirmeden hemen önce
 * çağırır; `RECENTERING` durumu çift isteği (kamera fırtınası) engeller.
 */
export function beginRecenter(reason: RecenterReason): void {
  _clearAutoTimer();
  _recenterReason = reason;
  _lastRecenterAt = _now();
  _set(CameraFollowState.RECENTERING);
}

/** Ortalama uygulandı → takibe dön. */
export function completeRecenter(): void {
  _set(CameraFollowState.FOLLOWING);
}

/** Takip zoom'u — yalnız GÖZLEM için kaydedilir; politika `mapService`'tedir. */
export function noteFollowZoom(zoom: number | null): void {
  _followZoom = (typeof zoom === 'number' && Number.isFinite(zoom)) ? zoom : null;
}

/**
 * Oturum/görünüm sıfırlaması — navigasyon bitince veya kamera sahipliği
 * belirsizleşince. Bekleyen otomatik dönüş iptal edilir (Zero-Leak).
 */
export function resetCameraFollow(reason: RecenterReason = 'NAV_END'): void {
  _clearAutoTimer();
  _recenterReason = reason;
  _lastUserPanAt  = null;
  _followZoom     = null;
  _set(CameraFollowState.FOLLOWING);
}

/* ── Gözlem (CAROS LAB · salt-okunur, KOORDİNAT TAŞIMAZ) ───────────────────── */

export interface CameraFollowSnapshot {
  readonly cameraMode: CameraFollowState;
  /** Araç kamera merkezinde sayılıyor mu (yalnız FOLLOWING). */
  readonly isVehicleCentered: boolean;
  /** Son kullanıcı pan'ının üzerinden geçen süre (ms) — `null` = hiç pan yok. */
  readonly lastUserPanAgeMs: number | null;
  /** "Ortala" düğmesi gösterilmeli mi. */
  readonly recenterAvailable: boolean;
  /** Son ortalamanın üzerinden geçen süre (ms) — `null` = hiç ortalanmadı. */
  readonly lastRecenterAgeMs: number | null;
  readonly recenterReason: RecenterReason;
  /** Son bilinen takip zoom'u — `null` = kaydedilmedi. */
  readonly followZoom: number | null;
  /** Bekleyen otomatik dönüş var mı. */
  readonly autoRecenterPending: boolean;
  /** Yürürlükteki otomatik dönüş gecikmesi (ms). */
  readonly autoRecenterDelayMs: number;
  /** Kaç görünüm bu otoriteyi dinliyor (abonelik sızıntısı görünür olsun). */
  readonly listenerCount: number;
}

export function getCameraFollowSnapshot(): CameraFollowSnapshot {
  const now = _now();
  return {
    cameraMode:          _state,
    isVehicleCentered:   _state === CameraFollowState.FOLLOWING,
    lastUserPanAgeMs:    _lastUserPanAt  !== null ? Math.max(0, Math.round(now - _lastUserPanAt))  : null,
    recenterAvailable:   isRecenterAvailable(),
    lastRecenterAgeMs:   _lastRecenterAt !== null ? Math.max(0, Math.round(now - _lastRecenterAt)) : null,
    recenterReason:      _recenterReason,
    followZoom:          _followZoom,
    autoRecenterPending: _autoTimer !== null,
    autoRecenterDelayMs: _navActive ? AUTO_FOLLOW_DELAY_NAV_MS : AUTO_FOLLOW_DELAY_IDLE_MS,
    listenerCount:       _listeners.size,
  };
}

/** YALNIZ testler için — tüm durumu başlangıca al. */
export function _resetCameraFollowForTest(): void {
  _clearAutoTimer();
  _state = CameraFollowState.FOLLOWING;
  _lastUserPanAt = null;
  _lastRecenterAt = null;
  _recenterReason = 'NONE';
  _followZoom = null;
  _navActive = false;
  _listeners.clear();
}
