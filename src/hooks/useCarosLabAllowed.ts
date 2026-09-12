/**
 * useCarosLabAllowed — CAROS LAB erişim kapısının React okuyucusu.
 *
 * Yeni yetki sistemi YOK ve ARTIK ROL DE OKUNMAZ: karar tek derleme-zamanı
 * otoritesinden gelir (`DEVELOPER_FEATURES_ENABLED`). Geliştirme/test APK'sında
 * her rolde (driver dâhil) açıktır; satış build'inde kapalıdır.
 *
 * Hook olarak kalması bilinçlidir: çağrı noktaları (DockBar · DrawerPanel · dört
 * tema yerleşimi) değişmeden çalışır ve kapı ileride yeniden reaktif bir kaynağa
 * bağlanmak isterse tek dokunma noktası burasıdır.
 */

import { isCarosLabAllowedFromEnv } from '../platform/devtools/carosLabGate';

export function useCarosLabAllowed(): boolean {
  return isCarosLabAllowedFromEnv();
}
