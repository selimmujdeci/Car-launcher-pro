import { create } from 'zustand';
import type { MapMode, MapSourceState } from './mapSourceTypes';
/* ARCH-06/F2'de bu modül ARM tik-wheel'ine taşınan `mapSource.ping` görevine
   sahipti. F7-B'de o görev ve dayandığı HTTP probu KALDIRILDI (aşağıdaki
   "Bağlantı yansıması" notu) — bu yüzden ARM bağımlılığı da kalmadı. */
import { subscribeConnectivity } from './connectivity/connectivityAuthority';
import { allowsConnectivity } from './connectivity/connectivityGate';

export const useMapSourceStore = create<MapSourceState>(() => ({
  sources: new Map(),
  activeSourceId: null,
  servingFrom: null,
  isOnline: allowsConnectivity('LIGHTWEIGHT_INTERNET'),
  isLoading: false,
  error: null,
  initialized: false,
  mapMode: 'road',
  tileRender: 'vector',  // start in vector (idle); navigation will push to raster
}));

/* ── Bağlantı yansıması (F7-B) ───────────────────────────────
 *
 * Bu store ARTIK KENDİ internet gerçeğini ÜRETMEZ. `isOnline`, kanonik
 * `ConnectivityAuthority` hükmünün salt-okur YANSIMASIDIR; kararı
 * `ConnectivityPolicy` verir. Karo isteği küçük ve tekrar denenebilirdir →
 * `LIGHTWEIGHT_INTERNET` (belirsizlikte denenir, eski davranış korunur).
 *
 * ── KALDIRILDI: `mapSource.ping` (30 sn) + OSM'ye HEAD PROBU ────────────────
 * O prob, `navigator.onLine`ın Android WebView'da güvenilmez olmasının
 * ÇARESİYDİ ("hotspot sonradan bağlanınca false kalıyor"). Kanonik otorite
 * AYNI soruyu `NET_CAPABILITY_VALIDATED` ile PROBSUZ yanıtlar; iki ayrı cevap
 * tutmak tam olarak F7'nin kapattığı borçtur. §28: ping/DNS/HTTP-probe/
 * speedtest YOK — mevcut olan da kaldırıldı; §29: yeni timer YOK, ikinci ağ
 * gözlemcisi YOK.
 *
 * Uydu/hibrit → yol ZORUNLU DÜŞÜRME ve bağlantı dönünce geri yükleme
 * davranışı (`_setOnline`) AYNEN korunur.
 */
let networkListenersAttached = false;

/** Kanonik bağlantı aboneliğini söken thunk. */
let _connectivityUnsub: (() => void) | null = null;

/**
 * When connectivity drops and we force-downgrade from satellite/hybrid → road,
 * we store the user's original choice here so we can restore it when online returns.
 * Cleared when the user explicitly picks a new mode via setMapMode().
 */
let _forcedDowngradeFrom: MapMode | null = null;

export function getForcedDowngradeFrom(): MapMode | null {
  return _forcedDowngradeFrom;
}

export function setForcedDowngradeFrom(mode: MapMode | null): void {
  _forcedDowngradeFrom = mode;
}

function _setOnline(online: boolean): void {
  const { mapMode } = useMapSourceStore.getState();
  if (online) {
    useMapSourceStore.setState({ isOnline: true });
    if (_forcedDowngradeFrom && _forcedDowngradeFrom !== 'road') {
      useMapSourceStore.setState({ mapMode: _forcedDowngradeFrom });
      _forcedDowngradeFrom = null;
    }
  } else {
    if (mapMode === 'satellite' || mapMode === 'hybrid') {
      _forcedDowngradeFrom = mapMode;
      useMapSourceStore.setState({ mapMode: 'road' });
    }
    useMapSourceStore.setState({ isOnline: false });
  }
}

export function attachNetworkListeners(): void {
  if (networkListenersAttached || typeof window === 'undefined') return;
  networkListenersAttached = true;

  /* TEK kaynak: kanonik otorite. Tarayıcının `online`/`offline` olayları artık
     DİNLENMEZ — o ipucu otorite değildir (§16) ve otorite zaten onu kanıt
     olarak yutar. */
  _connectivityUnsub = subscribeConnectivity(() => {
    _setOnline(allowsConnectivity('LIGHTWEIGHT_INTERNET'));
  });

  /* Otorite bu noktada çoktan hüküm kurmuş olabilir (Wave 1'de başlar); ilk
     yansımayı abonelik beklemeden al. O(1) okuma — ağ isteği YOK. */
  _setOnline(allowsConnectivity('LIGHTWEIGHT_INTERNET'));

  window.addEventListener('beforeunload', detachNetworkListeners, { once: true });
}

/**
 * Remove the canonical connectivity subscription. Call when the map module is
 * torn down (e.g. test teardown, future hot-reload scenarios).
 */
export function detachNetworkListeners(): void {
  if (!networkListenersAttached || typeof window === 'undefined') return;
  if (_connectivityUnsub !== null) { _connectivityUnsub(); _connectivityUnsub = null; }
  networkListenersAttached = false;
}
