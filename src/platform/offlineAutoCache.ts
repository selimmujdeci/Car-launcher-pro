/**
 * Offline Auto-Cache — "offline harita kendiliğinden çalışır" omurgası.
 *
 * Strateji (Google modeli, kullanıcıya "önce indir" dedirtmeden):
 *   • İnternet VARKEN, GPS konumu geldikçe bulunulan bölgenin POI verisini
 *     (mahalle/benzinlik/hastane vb.) sessizce arka planda indir → internet
 *     kesilince o bölgede offline ARAMA + adres çözümü çalışır.
 *   • Harita TILE'ları zaten sürüş sırasında görüntülendikçe (caros-tile →
 *     Service Worker → IndexedDB) doğal olarak cache'lenir; ayrıca toplu tile
 *     indirme yalnız MANUEL "alan indir" akışında yapılır (OSM'i yormamak için).
 *
 * Throttle: triggerAutoDownload kendi içinde online + >5 km hareket + cooldown
 * guard'larına sahiptir → Overpass yorulmaz, IP ban riski yok.
 */

import { onGPSLocation } from './gpsService';
import { triggerAutoDownload } from './offlineDataService';

let _started = false;
let _unsub: (() => void) | null = null;

/**
 * Uygulama açılışında bir kez çağır (SystemBoot / App). GPS konumuna abone olur
 * ve bulunulan bölgeyi (internet varken) arka planda cache'ler.
 */
export function startOfflineAutoCache(): void {
  if (_started) return;
  _started = true;

  _unsub = onGPSLocation((loc) => {
    if (!loc) return;
    // Geçersiz/çok kaba fix'i yok say (şehir-ölçeği bölge için yeterli doğruluk).
    if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
    // triggerAutoDownload: online + >5 km + cooldown guard'lı (sessiz, throttle'lı).
    triggerAutoDownload(loc.latitude, loc.longitude);
  });
}

export function stopOfflineAutoCache(): void {
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  _started = false;
}
