/**
 * incomingLocationBridge — başka uygulamadan paylaşılan konumun JS ucu.
 *
 * AKIŞ: WhatsApp/Telegram konum → Android seçici → CarOS Pro →
 * `MainActivity.handleIncomingLocationIntent` → `CarLauncherPlugin` →
 * BU MODÜL → `geoUriParser` (saf) → `destinationHandoff` (TEK kapı) → rota.
 *
 * ⚠️ İKİNCİ NAVİGASYON YOLU KURULMAZ: burada rota hesabı, geocoder veya
 * harita açma mantığı YOKTUR — hepsi mevcut kapıların işi.
 *
 * İKİ TESLİM YOLU (ikisi de gerekli):
 *   · `incomingLocation` olayı — uygulama AÇIKKEN gelen paylaşım.
 *   · `consumePendingLocation()` — SOĞUK AÇILIŞ: uygulama bu intent ile
 *     başlatıldığında olay, JS dinlemeye başlamadan önce yayılır ve boşluğa
 *     düşer. Boot'ta kuyruk bir kez okunur.
 * Çift teslim olursa `destinationHandoff`un aynı-hedef koruması ikinciyi yutar.
 *
 * Zero-leak: `start...` bir cleanup döndürür; SystemBoot LIFO yığınına kaydeder.
 */
import { logError } from '../crashLogger';
import { parseGeoUri } from './geoUriParser';
import {
  acceptHandoffDestination, recordHandoffOutcome,
  type HandoffResult,
} from './destinationHandoff';

/** Son işlenen URI — aynı intent iki yoldan gelirse ikinci kez ayrıştırılmaz. */
let _lastUri: string | null = null;
let _started = false;

/* ── Gözlem sayaçları (hüküm YOK) ────────────────────────────────────────── */
let _received = 0;
let _routed = 0;
let _unresolved = 0;
let _lastKind: 'coords' | 'query' | 'unresolved' | null = null;

export interface IncomingLocationSnapshot {
  readonly started: boolean;
  readonly received: number;
  readonly routed: number;
  readonly unresolved: number;
  readonly lastKind: 'coords' | 'query' | 'unresolved' | null;
}

export function getIncomingLocationSnapshot(): IncomingLocationSnapshot {
  return {
    started: _started,
    received: _received,
    routed: _routed,
    unresolved: _unresolved,
    lastKind: _lastKind,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetIncomingLocationForTest(): void {
  _lastUri = null;
  _started = false;
  _received = 0;
  _routed = 0;
  _unresolved = 0;
  _lastKind = null;
}

/**
 * Tek bir konum URI'sini işler.
 *
 * `coords` → doğrudan hedef kapısı. `query` → mevcut adres çözümleme yolu
 * (yeni geocoder YOK). `unresolved` → SESSİZ KALINMAZ: sayaca yazılır ve
 * kullanıcıya kısa bilgi verilir; sahte koordinat üretilmez.
 */
export async function handleIncomingLocationUri(uri: string): Promise<void> {
  const clean = (uri ?? '').trim();
  if (!clean || clean === _lastUri) return;
  _lastUri = clean;
  _received++;

  const parsed = parseGeoUri(clean);
  _lastKind = parsed.kind;

  if (parsed.kind === 'coords') {
    const outcome: HandoffResult = acceptHandoffDestination({
      lat: parsed.lat,
      lng: parsed.lng,
      label: parsed.label,
      channel: 'GEO_INTENT',
    });
    recordHandoffOutcome(outcome, 'GEO_INTENT');
    if (outcome.ok) _routed++;
    else if (outcome.reason !== 'debounced') _unresolved++;
    return;
  }

  if (parsed.kind === 'query') {
    try {
      const [{ resolveAndNavigate }, { getGPSState }] = await Promise.all([
        import('../addressNavigationEngine'),
        import('../gpsService'),
      ]);
      const gps = getGPSState().location;
      resolveAndNavigate(
        parsed.query,
        gps ? { lat: gps.latitude, lng: gps.longitude } : undefined,
      );
      _routed++;
    } catch (e) {
      _unresolved++;
      logError('IncomingLocation:query', e);
    }
    return;
  }

  /* Çözülemedi — kısa bağlantı (ağ gerektirir) veya tanınmayan biçim.
     Sessiz düşmek "bastım, hiçbir şey olmadı" hissi verirdi. */
  _unresolved++;
  try {
    const { showToast } = await import('../errorBus');
    showToast({
      type: 'error',
      title: 'Konum açılamadı',
      message: parsed.reason === 'short_link'
        ? 'Kısaltılmış harita bağlantısı çözülemedi (koordinat içermiyor).'
        : 'Paylaşılan bağlantıda koordinat bulunamadı.',
      duration: 4000,
    });
  } catch (e) {
    logError('IncomingLocation:toast', e);
  }
}

/**
 * Köprüyü kurar. SystemBoot tek kez çağırır ve dönen cleanup'ı kaydeder.
 * Fail-soft: köprü kurulamazsa ürün davranışı ESKİSİ GİBİ kalır.
 */
export function startIncomingLocationBridge(): () => void {
  if (_started) return () => { /* çift kurulum yok */ };
  _started = true;

  let removeListener: (() => void) | null = null;

  void (async () => {
    try {
      const { CarLauncher } = await import('../nativePlugin');

      // ① Uygulama açıkken gelen paylaşımlar.
      const handle = await CarLauncher.addListener?.(
        'incomingLocation',
        (ev: { uri?: string }) => { void handleIncomingLocationUri(ev?.uri ?? ''); },
      );
      if (!_started) { handle?.remove?.(); return; }
      removeListener = () => { try { handle?.remove?.(); } catch { /* ignore */ } };

      // ② Soğuk açılış kuyruğu — bir kez okunur, kuyruk native'de boşaltılır.
      const pending = await CarLauncher.consumePendingLocation?.();
      if (pending?.uri) void handleIncomingLocationUri(pending.uri);
    } catch (e) {
      /* Web/demo ortamında köprü yoktur — bu bir hata DEĞİLDİR. */
      logError('IncomingLocation:bridge', e);
    }
  })();

  return () => {
    _started = false;
    removeListener?.();
    removeListener = null;
  };
}
