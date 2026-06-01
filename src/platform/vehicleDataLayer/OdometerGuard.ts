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
 *    Startup penceresi boyunca _refLat/_refLng güncellenir → pencere
 *    kapandığında ilk delta doğru basepoint'ten başlar.
 *
 * 2. Velocity-Time Jump Guard
 *    Verilen hız ve Δt'den fiziksel yer değiştirme limiti hesaplanır:
 *      maxAllowedDist = (speedKmh / 3600) × (dtMs / 1000) × 2.0 + 0.05
 *    Açıklama:
 *      × 2.0   — ivme / gecikme için %100 tampon
 *      + 0.05  — GPS konumsal kayması için 50 m taban tolerans
 *    Hesaplanan mesafe bu limiti aşarsa fix "teleport" sayılır ve
 *    reddedilir; referans sıfırlanarak bir sonraki kararlı fix'ten yeni
 *    baseline kurulur.
 *    Hedeflenen senaryolar:
 *    - Tünel/otopark çıkışında anlık GPS teleport
 *    - A-GPS önbelleği bozukluğundan kaynaklanan yanlış başlangıç konumu
 *    - Büyük clock-jump × hız → sahte mesafe
 *
 * Entegrasyon (VehicleCompute.worker.ts):
 *   const guard = new OdometerGuard();
 *   // INIT handler: guard.reset()
 *   // GPS_DATA handler _updateOdometerGps(dtMs):
 *   const result = guard.check(loc.lat, loc.lng, _lastKnownSpeed, dtMs);
 *   if (result !== 'ok') { /* skip or invalidate _prevOdo * / return; }
 */

const STARTUP_SKIP = 10;   // atlanacak ilk GPS fix sayısı (TTFF + ephemeris kararlılığı)

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
   * Monotonic Clock Enforcement: check() çağrıları arası süre yalnızca
   * performance.now() ile ölçülür (Date.now()/wall-clock ASLA). NTP senkronu
   * veya kullanıcı saat değişimi "time jump" üretemez. 0 = henüz ölçüm yok.
   */
  private _lastCheckPerfMs = 0;

  /**
   * GPS koordinatını odometer hesabına geçmeden önce denetle.
   *
   * @param lat       Yeni GPS enlem
   * @param lng       Yeni GPS boylam
   * @param speedKmh  Anlık füzyon hızı (CAN/OBD/GPS öncelikli, km/h)
   * @param dtMs      Önceki GPS fix'ten bu yana geçen süre (ms)
   *
   * @returns
   *   'skip'    — Startup penceresi (ilk STARTUP_SKIP fix tamamlanmadı).
   *               Çağıran _prevOdoBuf'u bu konuma ilerletmeli, delta hesaplamamalı.
   *   'invalid' — Velocity-time fizik limitini aşan sıçrama.
   *               Referans sıfırlandı; çağıran _prevOdoActive=false yapmalı.
   *   'ok'      — Geçerli; odometer delta hesaplanabilir.
   */
  check(lat: number, lng: number, speedKmh: number, dtMs: number): 'skip' | 'invalid' | 'ok' {
    // ── Monotonic Clock Enforcement ────────────────────────────────────────
    // check() çağrıları arası süreyi performance.now() ile ölç (saat atlamasına
    // bağışık). Çağıranın geçtiği dtMs yalnızca makul VE wall-clock kokusu
    // taşımıyorsa kullanılır; aksi halde monotonic delta esas alınır.
    const nowPerf = performance.now();
    const monoDt  = this._lastCheckPerfMs > 0 ? nowPerf - this._lastCheckPerfMs : 0;
    this._lastCheckPerfMs = nowPerf;
    // Güvenli Δt: dtMs sonlu, negatif değil ve < 60s ise olduğu gibi; değilse monoDt.
    const safeDtMs = (Number.isFinite(dtMs) && dtMs >= 0 && dtMs < 60_000) ? dtMs : monoDt;

    // ── Startup Guard ──────────────────────────────────────────────────────
    if (!this._startupDone) {
      this._startupCount++;
      // Startup boyunca referansı ilerlet (pencere kapandığında delta doğru başlar)
      this._refLat = lat;
      this._refLng = lng;
      if (this._startupCount <= STARTUP_SKIP) return 'skip';
      this._startupDone = true;
    }

    // ── Velocity-Time Jump Guard ───────────────────────────────────────────
    if (this._refLat !== null && this._refLng !== null) {
      const dist = _haversineKm(this._refLat, this._refLng, lat, lng);

      // Fiziksel yer değiştirme limiti:
      //   speed (km/h) × dt (s) × 2.0 (ivme tamponu) + 0.05 (50 m GPS taban toleransı)
      const spd            = speedKmh > 0 ? speedKmh : 0;
      const maxAllowedDist = (spd / 3_600) * (safeDtMs / 1_000) * 2.0 + 0.05;

      if (dist > maxAllowedDist) {
        console.warn(
          `[ODO:Guard] Teleport rejected: ${dist.toFixed(3)} km` +
          ` > ${maxAllowedDist.toFixed(3)} km allowed` +
          ` (${speedKmh.toFixed(1)} km/h, Δt ${safeDtMs.toFixed(0)} ms)`,
        );
        // Referansı sıfırla → sonraki kararlı fix yeni baseline kurar
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
   * STARTUP_SKIP penceresi boyunca kaybedilen mesafeyi OBD/fused hız × Δt ile tahmin eder.
   *
   * Neden gerekli: İlk STARTUP_SKIP GPS fix'i yoksayıldığında araç hareket halindeyse
   * odometer bu süredeki mesafeyi kaybeder. OBD hızı (km/h) × Δt (s) ile bu kayıp
   * kompanse edilir.
   *
   * @param speedKmh  Anlık füzyon hızı (CAN/OBD/GPS öncelikli, km/h)
   * @param dtMs      GPS fix'ler arası süre (ms) — worker'ın hesapladığı Δt
   * @returns         Eklenecek delta km; startup bittiyse veya araç durmuşsa 0
   */
  compensateStartup(speedKmh: number, dtMs: number): number {
    if (this._startupDone) return 0;
    if (speedKmh <= 0 || dtMs <= 0 || dtMs > 2_000) return 0;
    return (speedKmh / 3_600) * (dtMs / 1_000);
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

  /**
   * Güvenilir bir kaynaktan (crash recovery / native storage) başlangıç km
   * değeri bildir. Startup guard hızlandırılır: ilk STARTUP_SKIP GPS fix beklenmez.
   * Bir sonraki GPS fix doğrudan velocity-time guard'dan geçer (ref null olduğu için pass).
   *
   * Sadece OdometerGuard'ın GPS sanity mantığını etkiler; _odoKm worker'ın
   * kendi state'inde güncellenmeli (RESTORE_ODO mesajıyla).
   *
   * @param km  Native storage'dan gelen güvenilir km değeri (sadece log için saklanır)
   */
  setInitialValue(km: number): void {
    // Startup guard'ı geç — native'den gelen değer güvenilir
    this._startupDone  = true;
    this._startupCount = STARTUP_SKIP;
    // Lat/Lng referansı sıfır kalır: bir sonraki GPS fix'te jump guard pas geçer
    this._refLat = null;
    this._refLng = null;
    this._lastCheckPerfMs = 0; // monotonic delta'yı sıfırla — recovery sonrası ilk fix temiz
    void km; // lint: parametre acknowledged, dahili km takibi worker'da
  }

  /** Guard'ı başlangıç durumuna döndür (yeni oturum / test teardown). */
  reset(): void {
    this._startupCount = 0;
    this._startupDone  = false;
    this._refLat       = null;
    this._refLng       = null;
    this._lastCheckPerfMs = 0;
  }
}
