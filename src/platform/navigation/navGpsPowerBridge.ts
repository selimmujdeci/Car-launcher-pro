/**
 * navGpsPowerBridge — navigasyon oturumu ↔ native GPS güç politikası köprüsü.
 *
 * KÖK NEDEN (SAHADA ÖLÇÜLDÜ 2026-08-08, Siverek):
 * `CarLauncherForegroundService` 5 dakikalık hareketsizlikten sonra 1 Hz GPS
 * akışını kısıyor (pil sızıntısı düzeltmesi). Bu kısma NAVİGASYONDAN HABERSİZDİ:
 * uzun ışıkta / trafikte rota sürerken GPS kapanıyor, araç kalkınca da geri
 * dönüş park referansından **60 m** uzaklaşmaya bağlı olduğu için ilk ~60 m
 * navigasyon kör gidiyordu.
 *
 * SÖZLEŞME — bu köprü NE YAPMAZ:
 *   · Konum İZNİ istemez.
 *   · Yeni bir konum akışı BAŞLATMAZ, abonelik açmaz.
 *   · İkinci bir konum/GPS otoritesi KURMAZ — `gpsService` tek sahiptir.
 *   · Ürün davranışını web modunda DEĞİŞTİRMEZ (native yoksa sessiz no-op).
 * Tek yaptığı: zaten çalışan akışın navigasyon sürerken kısılmasını engelleyen
 * bir BAYRAK geçmek. Çağrı fail-soft'tur: köprü düşerse navigasyon etkilenmez.
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';

/** Son gönderilen değer — aynı değeri tekrar tekrar göndermeyi engeller. */
let _lastSent: boolean | null = null;

/**
 * Navigasyon canlılığını dinleyen JS tarafı gözlemcisi (bugün: güç kapısı).
 *
 * KAYIT DESENİ — bu köprü gözlemciyi İMPORT ETMEZ. Nedeni mimari: köprü
 * navigasyon testlerinin ağır bağımlılık zincirine (gpsService, wakeWordService,
 * voiceService…) hiçbir modül eklememelidir. Gözlemci kendini kaydeder;
 * kaydeden yoksa köprü ESKİSİ GİBİ çalışır.
 */
export type NavPowerObserver = (active: boolean) => void;
let _observer: NavPowerObserver | null = null;

/** Gözlemciyi kaydeder/söker. Tek slot — son kaydeden kazanır (zero-leak). */
export function setNavPowerObserver(fn: NavPowerObserver | null): void {
  _observer = fn;
}

/** Test/tanı için: köprünün şu ana kadar gönderdiği son değer (hiç göndermediyse null). */
export function getNavGpsPowerLastSent(): boolean | null {
  return _lastSent;
}

/** Test izolasyonu. */
export function _resetNavGpsPowerBridgeForTest(): void {
  _lastSent = null;
  _observer = null;
}

/**
 * Navigasyon oturumunun canlı olup olmadığını native servise bildirir.
 *
 * @param active `true` → park kısması devre dışı (rota sürüyor);
 *               `false` → normal pil politikası geri döner.
 */
export function setNavigationGpsPower(active: boolean): void {
  const next = active === true;
  if (_lastSent === next) return;         // idempotent — köprü trafiği yok
  _lastSent = next;

  // JS tarafındaki gözlemciye de aynı sinyal: arka plan kısması navigasyondan
  // habersiz kalmasın (native `sNavigationActive` istisnasının JS ikizi).
  // Fail-soft: gözlemci düşerse navigasyon ETKİLENMEZ.
  if (_observer) {
    try { _observer(next); }
    catch (e) { logError('NavGpsPower:observer', e); }
  }

  try {
    if (!Capacitor.isNativePlatform()) return;   // web/demo: sessiz no-op
    void CarLauncher.setNavigationActive({ active: next })
      .catch((e) => { logError('NavGpsPower:call', e); });
  } catch (e) {
    // Köprü yoksa/eski APK ise navigasyon ETKİLENMEZ — yalnız kısma eski gibi kalır.
    logError('NavGpsPower:bridge', e);
  }
}
