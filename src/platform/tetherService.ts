/**
 * tetherService — Bluetooth internet paylaşımı köprüsü.
 *
 * Android, üçüncü parti uygulamalara BluetoothPan.connect() API'sini açmaz
 * (Android 10+ non-SDK block). Garantili çözüm: kullanıcıyı doğrudan
 * Bluetooth Ayarları ekranına yönlendirmek.
 *
 * Kullanıcı akışı:
 *   Bluetooth Ayarları açılır → eşleşmiş telefona tıklanır → "İnternet erişimi" açılır
 *
 *   hotspotMode === 'auto' → uygulama açılınca direkt BT ayarları açılır
 *   hotspotMode === 'ask'  → modal gösterilir, kullanıcı karar verir
 *   hotspotMode === 'off'  → hiçbir şey yapılmaz
 */

import { bridge } from './bridge';
import { getWifiState } from './wifiService';

/**
 * Android Wireless Settings ekranını açar.
 * Kullanıcı buradan "Mobil Hotspot" veya "Bağlantı Noktası ve Tethering" menüsüne girer.
 */
export function openHotspotSettings(): void {
  bridge.launchHotspotSettings();
}

/**
 * Zaten internete bağlı mı? (Wi-Fi veya başka bir kaynak)
 * Bağlıysa hotspot prompt göstermeye gerek yok.
 */
export function isAlreadyConnected(): boolean {
  return getWifiState().connected;
}
