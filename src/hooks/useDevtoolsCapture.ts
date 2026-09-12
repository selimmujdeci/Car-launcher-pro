/**
 * useDevtoolsCapture — geliştirici yakalama kanallarının React yaşam döngüsü sarmalayıcısı.
 *
 * Tüm mantık `platform/devtools/devtoolsCapture.ts` içindedir (ref-count + zero-leak);
 * burada yalnız mount → acquire, unmount → release köprüsü vardır. Böylece davranış
 * React mount'u olmadan (jsdom'da createRoot çalışmıyor) doğrudan test edilebilir.
 */

import { useEffect } from 'react';
import { acquireObdTrafficCapture, acquireCanCollect } from '../platform/devtools/devtoolsCapture';

/** Ekran açıkken native OBD ham trafik yakalamasını açar; kapanınca kapatır. */
export function useObdTrafficCapture(): void {
  useEffect(() => acquireObdTrafficCapture(), []);
}

/** Ekran açıkken CAN ham kütük toplamasını açar; kapanınca kapatır. */
export function useCanCollect(): void {
  useEffect(() => acquireCanCollect(), []);
}
