/**
 * useCarosLabAllowed — CAROS LAB erişim kapısının React okuyucusu.
 *
 * Yeni yetki sistemi YOK: mevcut `usePermission('canDebug')` + derleme bayrağı
 * (`DEBUG_ENABLED`) AND'lenir — App.tsx'teki DebugPanel kapısıyla aynı kural.
 */

import { usePermission } from '../platform/roleSystem';
import { isCarosLabAllowedFromEnv } from '../platform/devtools/carosLabGate';

export function useCarosLabAllowed(): boolean {
  const canDebug = usePermission('canDebug');
  return isCarosLabAllowedFromEnv(canDebug);
}
