/**
 * Odometre Δt otoritesi — ÖLÇÜM anı, VARIŞ anı değil (kütük #458).
 *
 * SAHA 2026-08-06, Adana-Şanlıurfa otoyolu, 32 dk:
 *   `[ODO:Guard] Teleport rejected` 8 kez — HEPSİ accuracy 2 m olan mükemmel
 *   fix'lerde. Ham kayıt:
 *     0.264 km > 0.113 km allowed (speedEvidence 94.8 km/h, implied 800 km/h,
 *     Δt 1187 ms)
 *   94,8 km/h'de 264 m ≈ 10 SANİYELİK yoldur; koruyucu Δt'yi 1187 ms görmüştü.
 *
 * KÖK: worker Δt'yi `performance.now()` farkından — yani paketin worker'a VARIŞ
 * anından — hesaplıyordu. Fix'ler tamponlanıp toplu geldiğinde (tünel çıkışı,
 * ana iş parçacığı meşgul) varış farkı çöker, konum deltası büyük kalır → imâ
 * edilen hız 365-800 km/h → MEŞRU hareket teleport sayılır. Reddedilince
 * `_refLat/_refLng = null` yapılıyor ve o mesafe odometreye HİÇ yazılmıyordu.
 * Ölçülen bedel: 8 ret × 73-299 m ≈ 32 dakikada 1,15 km KALICI kayıp.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OdometerGuard } from '../platform/vehicleDataLayer/OdometerGuard';

/* Sahadaki olayın birebir sayıları. */
const SPEED_KMH   = 94.8;
const ARRIVAL_DT  = 1_187;    // ms — paketin worker'a varış farkı (YANLIŞ otorite)
const FIX_DT      = 10_000;   // ms — fix'lerin kaynaktaki ölçüm farkı (DOĞRU otorite)
const MOVED_KM    = 0.264;    // 94,8 km/h × 10 s ≈ 263 m

/** Verilen mesafeyi doğu yönünde koordinat farkına çevirir (yaklaşık). */
function eastOf(lat: number, lng: number, km: number): { lat: number; lng: number } {
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  return { lat, lng: lng + km / kmPerDegLng };
}

const START = { lat: 37.00415, lng: 35.71532 }; // saha koşumundaki gerçek nokta

/** Startup penceresini kapatıp ilk referansı kuran koruyucu üretir. */
function armedGuard(): OdometerGuard {
  const g = new OdometerGuard();
  g.setInitialValue(1_000);          // startup guard hızlandırılır
  g.check(START.lat, START.lng, SPEED_KMH, 1_000, 2); // ilk referans
  return g;
}

describe('#458 · Odometre koruyucusu Δt otoritesi', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('KUSURUN KANITI: varış Δt\'si meşru hareketi teleport sanar', () => {
    const g   = armedGuard();
    const nxt = eastOf(START.lat, START.lng, MOVED_KM);
    // Sahadaki hatalı otorite: 1187 ms
    expect(g.check(nxt.lat, nxt.lng, SPEED_KMH, ARRIVAL_DT, 2)).toBe('invalid');
  });

  it('🔒 DÜZELTME: ölçüm Δt\'si aynı hareketi KABUL eder', () => {
    const g   = armedGuard();
    const nxt = eastOf(START.lat, START.lng, MOVED_KM);
    expect(g.check(nxt.lat, nxt.lng, SPEED_KMH, FIX_DT, 2)).toBe('ok');
  });

  it('🔒 red hâlâ mümkün: gerçek teleport (aynı Δt, 50 km) elenir', () => {
    // Düzeltme korumayı ZAYIFLATMAMALI — fizik dışı sıçrama hâlâ reddedilir.
    const g   = armedGuard();
    const far = eastOf(START.lat, START.lng, 50);
    expect(g.check(far.lat, far.lng, SPEED_KMH, FIX_DT, 2)).toBe('invalid');
  });

  it('🔒 reddedilen fix referansı düşürür — kaybın mekanizması budur', () => {
    // Bu davranış BİLİNÇLİ olarak korunuyor (yanlış baseline kurmamak için);
    // düzeltme reddin kendisini önler, reddin sonucunu değiştirmez.
    const g   = armedGuard();
    const far = eastOf(START.lat, START.lng, 50);
    expect(g.check(far.lat, far.lng, SPEED_KMH, FIX_DT, 2)).toBe('invalid');
    // Referans düştüğü için bir sonraki fix baseline kurar (mesafe üretmez)
    const nxt = eastOf(START.lat, START.lng, MOVED_KM);
    expect(g.check(nxt.lat, nxt.lng, SPEED_KMH, FIX_DT, 2)).toBe('ok');
  });
});

/**
 * Δt seçicisinin kendisi: ölçüm anı geçerliyse o kullanılır, aksi hâlde varış
 * farkına düşülür. Worker modül durumu taşıdığı için mantık burada aynen
 * yeniden kurulur; kaynaktaki eşdeğerliği `regression.guards` kilitler.
 */
const GPS_FIX_DT_MAX_MS = 60_000;
function makeDelta() {
  let prevFixTs = 0;
  return (fixTs: number, arrivalDtMs: number): number => {
    if (Number.isFinite(fixTs) && fixTs > 0) {
      const prev = prevFixTs;
      prevFixTs = fixTs;
      const fixDt = fixTs - prev;
      if (prev > 0 && fixDt > 0 && fixDt < GPS_FIX_DT_MAX_MS) return fixDt;
    }
    return arrivalDtMs;
  };
}

describe('#458 · GPS Δt seçicisi', () => {
  it('🔒 ölçüm anları varsa ölçüm farkını döndürür', () => {
    const d = makeDelta();
    expect(d(1_000_000, 999)).toBe(999);        // ilk fix: referans yok → varış
    expect(d(1_010_000, 1_187)).toBe(10_000);   // tamponlanmış teslimat → ölçüm
  });

  it('🔒 ölçüm anı yoksa varış farkına düşer (fail-soft)', () => {
    const d = makeDelta();
    expect(d(0, 1_187)).toBe(1_187);
    expect(d(Number.NaN, 800)).toBe(800);
  });

  it('🔒 geriye giden saat kabul edilmez', () => {
    const d = makeDelta();
    d(1_000_000, 1_000);
    expect(d(999_000, 1_000)).toBe(1_000);      // negatif fark → varış farkı
  });

  it('🔒 ileri saat sıçraması bandın dışında kalır', () => {
    const d = makeDelta();
    d(1_000_000, 1_000);
    expect(d(1_000_000 + 5 * 60_000, 1_000)).toBe(1_000); // 5 dk sıçrama elendi
  });

  it('🔒 aynı fix iki kez gelirse mesafe üretecek Δt doğmaz', () => {
    const d = makeDelta();
    d(1_000_000, 1_000);
    expect(d(1_000_000, 1_000)).toBe(1_000);    // fark 0 → varış farkına düşer
  });
});
