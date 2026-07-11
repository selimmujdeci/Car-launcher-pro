/**
 * compassForegroundDemand.test.ts — Compass Foreground Demand Gating (saha fix 2026-07-11).
 *
 * SAHA KANITI (Xiaomi zircon, `dumpsys sensorservice`): uygulama BOŞTA ANA EKRANDA
 * `rot_vec` (0x0b, absolute orientation) ve `game_rotvec` (0x0f, relative) sensörlerini
 * 60 Hz'de açık tutuyordu. Kaynak: `gpsService._startCompassListener()` `startGPSTracking()`
 * ile koşulsuz açılıyor, ön planda HİÇ kapanmıyordu (Ledger #42'deki bilinen sınırlama).
 *
 * BU PR: compass artık yalnız GERÇEK heading tüketicisi talep ettiğinde açılır:
 *   - FullMapView (heading-up harita ekranı) → mount'ta acquire, unmount'ta release
 *   - MiniMapWidget → YALNIZ kendi `isDriving` histerezisi açıkken (park = kuzey-yukarı → talep yok)
 * Konum takibi, blend/smoothing, izin ve fallback davranışı DEĞİŞMEZ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  acquireCompassDemand,
  releaseCompassDemand,
  hasCompassDemand,
  getCompassDemandCount,
  getCompassOwners,
  subscribeCompassDemand,
  resetCompassDemand,
  MAX_COMPASS_OWNERS,
} from '../platform/gps/compassDemand';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const GPS_SRC   = read('src', 'platform', 'gpsService.ts');
const FULL_SRC  = read('src', 'components', 'map', 'FullMapView.tsx');
const MINI_SRC  = read('src', 'components', 'map', 'MiniMapWidget.tsx');
const BLACK_SRC = read('src', 'platform', 'security', 'blackBoxService.ts');
const SMART_SRC = read('src', 'platform', 'smartDrivingEngine.ts');
const GATE_SRC  = read('src', 'platform', 'sensors', 'orientationSensorGate.ts');

/** gpsService'in compass gate aboneliğini modelleyen sadık simülasyon. */
function createCompassSim() {
  let tracking = false;
  let listenerOn = false;
  let physicalSubscribes = 0;      // gate'e yapılan fiziksel abonelik sayısı
  let unsub: (() => void) | null = null;

  const apply = () => {
    const want = tracking && hasCompassDemand();
    if (want && !listenerOn)  { listenerOn = true;  physicalSubscribes++; }
    if (!want && listenerOn)  { listenerOn = false; }
  };

  return {
    startGPS() { tracking = true; if (!unsub) unsub = subscribeCompassDemand(apply); apply(); },
    stopGPS()  { tracking = false; if (unsub) { unsub(); unsub = null; } apply(); },
    get compassOn()   { return listenerOn; },
    get subscribeCount() { return physicalSubscribes; },
    get hasGpsSub()   { return unsub !== null; },
  };
}

beforeEach(() => { resetCompassDemand(); });
afterEach(() => { resetCompassDemand(); vi.restoreAllMocks(); });

/* ── 1-5: Talep → compass yaşam döngüsü ──────────────────────────────────── */

describe('Talep → compass aboneliği', () => {
  it('1. talep yokken compass aboneliği YOK', () => {
    const sim = createCompassSim();
    sim.startGPS();
    expect(hasCompassDemand()).toBe(false);
    expect(sim.compassOn).toBe(false);
    expect(sim.subscribeCount).toBe(0);
  });

  it('2. ilk harita tüketicisi compass\'ı AÇAR', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');
    expect(hasCompassDemand()).toBe(true);
    expect(sim.compassOn).toBe(true);
    expect(sim.subscribeCount).toBe(1);
  });

  it('3. ikinci tüketici DUPLICATE fiziksel abonelik üretmez', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');
    acquireCompassDemand('map:mini');
    expect(getCompassDemandCount()).toBe(2);
    expect(sim.subscribeCount).toBe(1);   // tek fiziksel abonelik
  });

  it('4. bir tüketici ayrılınca diğeri DEVAM eder', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');
    acquireCompassDemand('map:mini');
    releaseCompassDemand('map:mini');
    expect(hasCompassDemand()).toBe(true);
    expect(sim.compassOn).toBe(true);
  });

  it('5. SON tüketici ayrılınca compass KAPANIR', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');
    acquireCompassDemand('map:mini');
    releaseCompassDemand('map:mini');
    releaseCompassDemand('map:full');
    expect(hasCompassDemand()).toBe(false);
    expect(sim.compassOn).toBe(false);
  });
});

/* ── 6-10: Ekran senaryoları ─────────────────────────────────────────────── */

describe('Ekran senaryoları', () => {
  it('6. AYARLAR ekranında talep YOK → compass kapalı', () => {
    const sim = createCompassSim();
    sim.startGPS();
    const releaseMap = acquireCompassDemand('map:full');   // haritadaydık
    releaseMap();                                          // Ayarlar'a geçildi (harita unmount)
    expect(hasCompassDemand()).toBe(false);
    expect(sim.compassOn).toBe(false);
  });

  it('7. harita mount → acquire, unmount → release', () => {
    const sim = createCompassSim();
    sim.startGPS();
    const release = acquireCompassDemand('map:full');      // mount
    expect(sim.compassOn).toBe(true);
    release();                                             // unmount
    expect(sim.compassOn).toBe(false);
    expect(getCompassOwners()).toEqual([]);
  });

  it('8. navigasyon aktifken (harita açık) compass AÇIK', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');    // navigasyon full map üzerinde koşar
    expect(sim.compassOn).toBe(true);
  });

  it('9. navigasyon bitince, başka tüketici yoksa compass KAPALI', () => {
    const sim = createCompassSim();
    sim.startGPS();
    const release = acquireCompassDemand('map:full');
    release();                            // harita kapandı
    expect(sim.compassOn).toBe(false);
  });

  it('10. HEADING-UP kapalıysa (mini harita park/kuzey-yukarı) gereksiz acquire YOK', () => {
    const sim = createCompassSim();
    sim.startGPS();
    // Mini harita park dalında → talep etmez
    expect(hasCompassDemand()).toBe(false);
    expect(sim.compassOn).toBe(false);

    // Sürüş başlayınca (isDriving true) talep eder
    acquireCompassDemand('map:mini');
    expect(sim.compassOn).toBe(true);

    // Park'a dönünce bırakır
    releaseCompassDemand('map:mini');
    expect(sim.compassOn).toBe(false);
  });
});

/* ── 11-13: Davranış koruması ────────────────────────────────────────────── */

describe('Davranış koruması', () => {
  it('11. izin/fallback davranışı KORUNUYOR (gate ve izin yolu değişmedi)', () => {
    // gpsService hâlâ gate'ten abone oluyor (ham window listener yok)
    expect(GPS_SRC).toMatch(/subscribeOrientationAbsolute\(_onDeviceOrientation\)/);
    expect(GPS_SRC).toMatch(/subscribeOrientation\(_onDeviceOrientation\)/);
    expect(GPS_SRC).not.toMatch(/window\.addEventListener\(['"]deviceorientation/);
    // GPS izin akışı dokunulmadı
    expect(GPS_SRC).toMatch(/Geolocation\.requestPermissions\(\)/);
  });

  it('12. bearing/smoothing DEĞİŞMEDİ (blend çekirdeği aynı)', () => {
    expect(GPS_SRC).toMatch(/computeBlendedHeading/);
    expect(GPS_SRC).toMatch(/applyCompassSmoothing/);
    expect(GPS_SRC).toMatch(/COMPASS_THROTTLE_MS\s*=\s*100/);   // mevcut JS throttle korunuyor
  });

  it('13. background/foreground gate davranışı KORUNUYOR (gate visibility yönetir)', () => {
    expect(GATE_SRC).toMatch(/visibilitychange/);
    // gpsService gate'in SAHİBİ değil — visibility'yi kendisi yönetmiyor
    expect(GPS_SRC).not.toMatch(/visibilitychange/);
  });

  it('13b. GPS KONUM takibi compass talebinden BAĞIMSIZ (talep yokken de sürer)', () => {
    // _applyCompassDemand yalnız compass listener'ını açıp kapatır; watch'a dokunmaz
    expect(GPS_SRC).toMatch(/function _applyCompassDemand\(\): void \{[\s\S]{0,200}_startCompassListener\(\)[\s\S]{0,120}_stopCompassListener\(\)/);
    expect(GPS_SRC).not.toMatch(/_applyCompassDemand[\s\S]{0,200}clearWatch/);
  });
});

/* ── 14-16: Sözleşme kuralları ───────────────────────────────────────────── */

describe('Sözleşme — duplicate / idempotent / bounded / zero-leak', () => {
  it('14. DUPLICATE owner engelleniyor (aynı owner sayacı artırmaz)', () => {
    acquireCompassDemand('map:full');
    acquireCompassDemand('map:full');
    acquireCompassDemand('map:full');
    expect(getCompassDemandCount()).toBe(1);
  });

  it('15. release İDEMPOTENT (bilinmeyen/tekrar release güvenli)', () => {
    const sim = createCompassSim();
    sim.startGPS();
    const release = acquireCompassDemand('map:full');
    release();
    release();                              // ikinci kez
    releaseCompassDemand('hic-olmayan');    // bilinmeyen owner
    expect(getCompassDemandCount()).toBe(0);
    expect(sim.compassOn).toBe(false);
  });

  it('16. dispose/cleanup ZERO-LEAK: stopGPS gate aboneliğini bırakır', () => {
    const sim = createCompassSim();
    sim.startGPS();
    acquireCompassDemand('map:full');
    expect(sim.hasGpsSub).toBe(true);
    sim.stopGPS();
    expect(sim.hasGpsSub).toBe(false);
    expect(sim.compassOn).toBe(false);
  });

  it('16b. owner sayısı BOUNDED (kaçak tüketici belleği şişiremez)', () => {
    for (let i = 0; i < MAX_COMPASS_OWNERS + 10; i++) acquireCompassDemand(`owner-${i}`);
    expect(getCompassDemandCount()).toBe(MAX_COMPASS_OWNERS);
    expect(hasCompassDemand()).toBe(true);   // fail-safe: talep var → compass açık kalır
  });

  it('16c. talep dinleyicisi YALNIZ 0↔1 geçişlerinde tetiklenir (gereksiz iş yok)', () => {
    const cb = vi.fn();
    subscribeCompassDemand(cb);
    acquireCompassDemand('a');    // 0→1 → tetikler
    acquireCompassDemand('b');    // 1→2 → tetiklemez
    releaseCompassDemand('b');    // 2→1 → tetiklemez
    releaseCompassDemand('a');    // 1→0 → tetikler
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('16d. bozuk owner (boş string) fail-soft yok sayılır', () => {
    const r = acquireCompassDemand('');
    expect(getCompassDemandCount()).toBe(0);
    expect(() => r()).not.toThrow();
  });
});

/* ── 17-23: Kapsam kilitleri ─────────────────────────────────────────────── */

describe('Kapsam kilitleri — bu PR yalnız compass demand-gating', () => {
  it('17. blackBoxService DEĞİŞMEDİ (always-on devicemotion aynen duruyor)', () => {
    expect(BLACK_SRC).toMatch(/subscribeMotion\(handler\)/);
    expect(BLACK_SRC).not.toMatch(/compassDemand|acquireCompassDemand/);
  });

  it('18. smartDrivingEngine DEĞİŞMEDİ (talep-güdümlü accel aynen)', () => {
    expect(SMART_SRC).toMatch(/_evaluateAccelDemand/);
    expect(SMART_SRC).toMatch(/subscribeMotion\(_handleDeviceMotion\)/);
    expect(SMART_SRC).not.toMatch(/compassDemand|acquireCompassDemand/);
  });

  it('19. Generic Sensor API EKLENMEDİ', () => {
    for (const src of [GPS_SRC, GATE_SRC, FULL_SRC, MINI_SRC]) {
      expect(src).not.toMatch(/new (Accelerometer|Gyroscope|AbsoluteOrientationSensor|RelativeOrientationSensor|Magnetometer)\b/);
    }
  });

  it('20. native sampling rate DÜŞÜŞÜ İDDİA EDİLMİYOR (frequency/samplingPeriod KOD AYARI yok)', () => {
    // Bare kelime DEĞİL, gerçek bir kod ayarı (option key / atama) aranır: gate'in
    // foundation yorumu (PR #56) "samplingPeriod"dan düz metin olarak bahseder —
    // bu bir sampling-rate iddiası değildir, testi tripletmemeli.
    for (const src of [GPS_SRC, GATE_SRC]) {
      expect(src).not.toMatch(/frequency\s*:/);
      expect(src).not.toMatch(/samplingPeriod\s*[:=]/);
    }
  });

  it('21. FullMapView\'da YALNIZ compass talebi eklendi — render/kamera yolu korunuyor', () => {
    expect(FULL_SRC).toMatch(/acquireCompassDemand\('map:full'\)/);
    // Mevcut harita davranış yolları duruyor (silinmedi)
    expect(FULL_SRC).toMatch(/setDrivingView\(/);
    expect(FULL_SRC).toMatch(/updateUserMarker\(/);
    expect(FULL_SRC).toMatch(/requestAnimationFrame\(tick\)/);
    // GPS abonelik yoluna dokunulmadı
    expect(FULL_SRC).not.toMatch(/watchPosition|clearWatch/);
  });

  it('22. GPS KONUM abonelikleri (watch) bu PR\'da değişmedi', () => {
    expect(GPS_SRC).toMatch(/Geolocation\.watchPosition\(/);
    expect(GPS_SRC).toMatch(/navigator\.geolocation\.watchPosition\(/);
    // Tek-abonelik (PR #62) mantığı bu branch'te YOK — kapsam ayrı
    expect(GPS_SRC).not.toMatch(/_maybeSuspendCapacitorWatch/);
  });

  it('23. Platform Kernel / HAL / Event Bus / Deep Scan import EDİLMEDİ', () => {
    for (const src of [GPS_SRC, FULL_SRC, MINI_SRC]) {
      expect(src).not.toMatch(/from\s+['"].*(platformKernel|vehicleHal|platformEventBus|capabilityRegistry|deepScan)/i);
    }
  });

  it('23b. compassDemand import YAN ETKİSİZ (timer/polling/listener yok)', () => {
    const SRC = read('src', 'platform', 'gps', 'compassDemand.ts');
    expect(SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(SRC).not.toMatch(/addEventListener/);
    // modül yüklendi ama hiçbir talep yok
    expect(getCompassDemandCount()).toBe(0);
  });

  it('23c. MiniMapWidget talebi KENDİ isDriving histerezisine bağlı (yeni eşik yok)', () => {
    expect(MINI_SRC).toMatch(/_setCompassDemand\(isDriving\)/);
    expect(MINI_SRC).toMatch(/releaseCompassDemand\(MINI_MAP_COMPASS_OWNER\)/);
    // yeni hız eşiği eklenmedi — mevcut 5/3 km/h histerezisi kullanılıyor
    expect(MINI_SRC).toMatch(/_effKmh > 5[\s\S]{0,80}_effKmh < 3/);
  });
});
