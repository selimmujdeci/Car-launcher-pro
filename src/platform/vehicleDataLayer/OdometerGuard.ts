/**
 * OdometerGuard — GPS tabanlı odometer sanity katmanı.
 *
 * İki koruma mekanizması:
 *
 * 1. Startup Guard
 *    Uygulama açıldığında ilk STARTUP_SKIP GPS fix'i yoksayılır.
 *    Neden: GNSS alıcısı TTFF (Time-To-First-Fix) sırasında henüz tam
 *    kilitlenmemiş olabilir; ephemeris yüklenirken anlık konum ~km hatalı
 *    gelebilir. Battery reconnect veya timezone geçişinden kaynaklanan
 *    saat atlama da ilk fix'te koordinat sıçraması üretir.
 *    Startup penceresi boyunca _prevOdoBuf güncellenir → pencere kapandığında
 *    ilk delta doğru basepoint'ten başlar.
 *
 * 2. Jump Guard
 *    Son geçerli GPS referansından MAX_JUMP_KM (100 km) fazla uzak yeni
 *    konumlar reddedilir ve referans sıfırlanır. Sonraki geçerli okuma yeni
 *    baseline kurar.
 *    Hedeflenen senaryolar:
 *    - Tünel/otopark çıkışında anlık GPS teleport
 *    - A-GPS önbelleği bozukluğundan kaynaklanan yanlış başlangıç konumu
 *    - Büyük clock-jump × hız → sahte mesafe
 *
 * Entegrasyon (VehicleCompute.worker.ts):
 *   const guard = new OdometerGuard();
 *   // INIT handler: guard.reset()
 *   // GPS_DATA handler _updateOdometerGps():
 *   const result = guard.check(loc.lat, loc.lng);
 *   if (result !== 'ok') { /* skip or invalidate _prevOdo * / return; }
 */

const STARTUP_SKIP = 3;   // atlanacak ilk GPS fix sayısı
const MAX_JUMP_KM  = 100; // tek adımda kabul edilen max mesafe (km)

/** Küre üzerinde iki nokta arası mesafe (Haversine, km). */
function _haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 6_371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class OdometerGuard {
  private _startupCount = 0;
  private _startupDone  = false;
  private _refLat: number | null = null;
  private _refLng: number | null = null;

  /**
   * GPS koordinatını odometer hesabına geçmeden önce denetle.
   *
   * @returns
   *   'skip'    — Startup penceresi (STARTUP_SKIP fix tamamlanmadı).
   *               Çağıran _prevOdoBuf'u bu konuma ilerletmeli, delta hesaplamamalı.
   *   'invalid' — 100 km sıçrama. Referans sıfırlandı; çağıran _prevOdoActive=false yapmalı.
   *   'ok'      — Geçerli; odometer delta hesaplanabilir.
   */
  check(lat: number, lng: number): 'skip' | 'invalid' | 'ok' {
    // ── Startup Guard ──────────────────────────────────────────────────────
    if (!this._startupDone) {
      this._startupCount++;
      // Startup boyunca referansı ilerlet (pencere kapandığında delta doğru başlar)
      this._refLat = lat;
      this._refLng = lng;
      if (this._startupCount <= STARTUP_SKIP) return 'skip';
      this._startupDone = true;
    }

    // ── Jump Guard ─────────────────────────────────────────────────────────
    if (this._refLat !== null && this._refLng !== null) {
      const dist = _haversineKm(this._refLat, this._refLng, lat, lng);
      if (dist > MAX_JUMP_KM) {
        // Referansı sıfırla → sonraki geçerli okuma yeni baseline kurar
        console.warn(`[ODO:Guard] GPS jump rejected: ${dist.toFixed(1)} km from reference`);
        this._refLat = null;
        this._refLng = null;
        return 'invalid';
      }
    }

    // Geçerli okuma → referansı güncelle
    this._refLat = lat;
    this._refLng = lng;
    return 'ok';
  }

  /**
   * Harici konumla referansı senkronize et.
   * OBD sync veya dead reckoning referans kaydırmasından sonra çağırılmalı;
   * aksi hâlde bir sonraki GPS okuması yanlış jump mesafesi üretir.
   */
  setReference(lat: number, lng: number): void {
    this._refLat = lat;
    this._refLng = lng;
  }

  /** Guard'ı başlangıç durumuna döndür (yeni oturum / test teardown). */
  reset(): void {
    this._startupCount = 0;
    this._startupDone  = false;
    this._refLat       = null;
    this._refLng       = null;
  }
}
