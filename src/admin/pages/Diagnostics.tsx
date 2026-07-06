/**
 * Diagnostics — Tanı (saha verisi), super_admin GEREKTİRMEZ.
 *
 * "Superadmin sorunlu" (IncidentCenter super_admin JWT + RLS istiyordu) →
 * bu sayfa sıradan AdminLayout altında yaşar (yalnız giriş şart, RoleGuard
 * yok) ve veriyi get_recent_diagnostics RPC'sinden (migration 025) çeker.
 * IncidentCenter bileşeni loader prop'uyla yeniden kullanılır — tek gösterim,
 * kod duplikasyonu yok. Aynı satır/detay/filtre + cihazda & görüntülemede
 * sanitize (konum/VIN/plaka/MAC yok).
 */

import { IncidentCenter } from './superadmin/IncidentCenter'
import { getRecentDiagnostics } from '../services/diagnostics.service'

export function Diagnostics() {
  return (
    <IncidentCenter
      loader={getRecentDiagnostics}
      title="TANI — SAHA VERİSİ"
      subtitle="Cihazlardan gelen support_snapshot · obd_diag · critical_error · voice_diag — super_admin gerektirmez"
    />
  )
}
