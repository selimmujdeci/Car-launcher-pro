/**
 * realDriveFindings.test.ts — GERÇEK SÜRÜŞ P0/P1 bulguları (2026-08-03).
 *
 * Kaynak: gerçek Android cihaz + gerçek OBD + araç hareket hâlinde
 * (86 km/h, RPM 1792, motor 92°C, protokol 7, OBD kalite %100).
 * Her kilit, CAROS LAB kaydındaki DOĞRULANMIŞ bir olaya dayanır.
 */
import { describe, it, expect } from 'vitest';
import uiActivityRecorderSrc from '../platform/uiActivityRecorder.ts?raw';
import globalDiagnosticButtonSrc from '../components/common/GlobalDiagnosticButton.tsx?raw';
import systemHealthMonitorSrc from '../platform/system/SystemHealthMonitor.ts?raw';

/* ═══════════════ A. SÜRÜŞTE MODAL ═══════════════ */

describe('A. Sürüşte tam ekran modal açılmaz', () => {
  it('🔒 kapı fail-closed: hız BİLİNMİYORSA gösterilmez', async () => {
    const { canShowDistractingSurface, DISTRACTING_SURFACE_MAX_KMH } =
      await import('../components/layout/tripSummaryGate');
    // Gerçek sürüş: 86 km/h
    expect(canShowDistractingSurface(86)).toBe(false);
    expect(canShowDistractingSurface(6)).toBe(false);
    // Park
    expect(canShowDistractingSurface(0)).toBe(true);
    expect(canShowDistractingSurface(DISTRACTING_SURFACE_MAX_KMH)).toBe(true);
    // Hız bilinmiyor → KANITSIZ → gösterme
    expect(canShowDistractingSurface(null)).toBe(false);
    expect(canShowDistractingSurface(undefined)).toBe(false);
    expect(canShowDistractingSurface(NaN)).toBe(false);
  });

  it('🔒 eşik `uiActivityRecorder` sürüş eşiğiyle HİZALI', async () => {
    const { DISTRACTING_SURFACE_MAX_KMH } = await import('../components/layout/tripSummaryGate');
    // Bir katman ZAMANSIZ sayıp diğeri meşru saymasın
    expect(uiActivityRecorderSrc).toContain('const DRIVING_KMH  = 5;');
    expect(DISTRACTING_SURFACE_MAX_KMH).toBe(5);
  });

  it('🔒 tanı modalı kapıdan geçer ve olay KAYBOLMAZ (park sonrasına ertelenir)', () => {
    const src = globalDiagnosticButtonSrc;
    expect(src).toContain('canShowDistractingSurface');
    // Mount koşulunda da kapı var → sürüş başlarsa açık modal kapanır
    expect(src).toContain('open={open && canShow}');
    // Sürüşte istenirse ertelenir, sessizce (popup/TTS YOK)
    expect(src).toContain('setDeferred(true)');
    expect(src).not.toMatch(/showToast|speak/i);
    // Doğrudan setOpen(true) ile kapı atlanamaz
    expect(src).not.toContain('onClick={() => setOpen(true)}');
  });
});

/* ═══════════════ B. MODAL SINIFLANDIRMASI ═══════════════ */

describe('B. Yüzey sınıflandırması z-index ile hüküm vermez', () => {
  it('🔒 dört sınıf tanımlı ve UNKNOWN başarı sayılmaz', () => {
    for (const k of ['REAL_DISTRACTING_MODAL', 'TRANSIENT_RENDER_ARTIFACT',
                     'HIDDEN_OVERLAY', 'UNKNOWN']) {
      expect(uiActivityRecorderSrc).toContain(k);
    }
  });

  it('🔒 pointer-events:none / inert / aria-hidden modal SAYILMAZ', () => {
    expect(uiActivityRecorderSrc).toContain("cs.pointerEvents === 'none'");
    expect(uiActivityRecorderSrc).toContain("el.hasAttribute('inert')");
    expect(uiActivityRecorderSrc).toContain("el.getAttribute('aria-hidden') === 'true'");
  });

  it('🔒 gerçek modal KAÇIRILMAZ: dialog rolü veya yüksek-z + geniş alan', () => {
    expect(uiActivityRecorderSrc).toMatch(/isDialog && areaPct >= 40/);
    expect(uiActivityRecorderSrc).toMatch(/fixed && z >= 900 && areaPct >= 60/);
  });

  it('🔒 iki kareden kısa yaşayan yüzey AYRI sınıfa alınır (zararsız DEĞİL)', () => {
    expect(uiActivityRecorderSrc).toContain('TRANSIENT_SURFACE_MS');
    expect(uiActivityRecorderSrc).toMatch(/openMs < TRANSIENT_SURFACE_MS/);
  });
});

/* ═══════════════ C. GPS SAĞLIK UZLAŞTIRMASI ═══════════════ */

describe('C. GPS fix ile heartbeat tek kanonik zincirde uzlaşır', () => {
  it('🔒 dataFresh=true + heartbeat bayat → CONFLICT (FAIL DEĞİL)', async () => {
    const { reconcileGpsHealth } = await import('../platform/gps/gpsHealthReconcile');
    /* Gerçek cihaz kaydındaki DEĞERLER: `age=20007ms threshold=20000ms`
       (heartbeat eşiği AŞILMIŞ) ve aynı snapshot'ta fix GÜNCEL. */
    const v = reconcileGpsHealth({
      connected: true, fixAgeMs: 900, heartbeatAgeMs: 20_007,
      heartbeatDeadlineMs: 20_000, fixFreshWindowMs: 10_000, backgrounded: false,
    });
    expect(v.cls).toBe('GPS_HEALTH_CONFLICT');
    expect(v.evidence).toEqual({ fixAgeMs: 900, heartbeatAgeMs: 20_007 });
  });

  it('🔒 gerçek sağlayıcı kaybı ile arka plan askısı AYRILIR', async () => {
    const { reconcileGpsHealth } = await import('../platform/gps/gpsHealthReconcile');
    const base = { heartbeatDeadlineMs: 20_000, fixFreshWindowMs: 10_000 } as const;
    expect(reconcileGpsHealth({ ...base, connected: false, fixAgeMs: 900,
      heartbeatAgeMs: 1_000, backgrounded: false }).cls).toBe('GPS_PROVIDER_DISCONNECTED');
    // 85 sn'lik kesinti arka plandaysa sinyal kaybı DEĞİLDİR
    expect(reconcileGpsHealth({ ...base, connected: true, fixAgeMs: 85_000,
      heartbeatAgeMs: 85_000, backgrounded: true }).cls).toBe('GPS_BACKGROUND_SUSPENDED');
    // Önplanda ve iki taraf da bayat → gerçek fix bayatlığı
    expect(reconcileGpsHealth({ ...base, connected: true, fixAgeMs: 85_000,
      heartbeatAgeMs: 85_000, backgrounded: false }).cls).toBe('GPS_FIX_STALE');
  });

  it('🔒 RECOVERED yalnız BAYATLIKTAN SONRA üretilir', async () => {
    const { reconcileGpsHealth } = await import('../platform/gps/gpsHealthReconcile');
    const fresh = { connected: true, fixAgeMs: 500, heartbeatAgeMs: 500,
      heartbeatDeadlineMs: 20_000, fixFreshWindowMs: 10_000, backgrounded: false } as const;
    expect(reconcileGpsHealth({ ...fresh, previous: 'GPS_FIX_STALE' }).cls).toBe('GPS_RECOVERED');
    // Geçmiş bayatlık yoksa "iyileşti" DENMEZ
    expect(reconcileGpsHealth({ ...fresh }).cls).not.toBe('GPS_RECOVERED');
  });

  it('🔒 ölçülemeyen girdi BAŞARI sayılmaz', async () => {
    const { reconcileGpsHealth } = await import('../platform/gps/gpsHealthReconcile');
    const v = reconcileGpsHealth({ connected: null, fixAgeMs: null, heartbeatAgeMs: null,
      heartbeatDeadlineMs: 20_000, fixFreshWindowMs: 10_000, backgrounded: null });
    expect(v.cls).toBe('GPS_UNKNOWN');
  });

  it('🔒 sebep bilinmiyorsa "tünel" DENMEZ', async () => {
    const mod = await import('../platform/gps/gpsHealthReconcile');
    expect(JSON.stringify(mod)).not.toMatch(/tünel|tunnel/i);
  });

  it('🔒 GPS alarmı GPS kanıtıyla anlatılır (OBD dataFresh ile DEĞİL)', () => {
    /* Gerçek kayıt: "No heartbeat for 20s ... conn=connected dataFresh=true"
       — o `dataFresh` OBD'nindi. İki alt sistemin verisi yan yana yazılınca
       ürün kendi kendisiyle çelişiyor göründü. */
    expect(systemHealthMonitorSrc).toContain("if (entry.name === 'GPS')");
    expect(systemHealthMonitorSrc).toContain('reconcileGpsHealth');
    expect(systemHealthMonitorSrc).toMatch(/cls=\$\{v\.cls\}/);
  });
});

/* ═══════════════ E. PARK HÂLİNDE KAMERA (cihaz turu 2026-08-03/2) ═══════════
 * Ölçüm zinciri (gerçek telefon, araç PARK, CDP):
 *   • GPS deposu park hâlinde 10.28 / 55 / 61.59 km/h yayınladı (acc 8–15 m)
 *   • kameraya giden hız ≈34.5 km/h → lookAhead 121.8 m (iki bağımsız
 *     tersine çevirme: mesafe ve `topPad 228/405` aynı hızı verdi)
 *   • araç ekran y = 1217 px · canvas H = 405 px → 800 px EKRAN DIŞI
 *   • harita bearing −30.84° (=329.2°) = rotanın BAŞLANGIÇ noktasının açısı;
 *     rotanın ileri yönü 148.6° → **179° ters** ("geri geri mi gideceğim")
 */
describe('E. Park hâlinde kamera ve hız', () => {
  it('🔒 gürültü tabanı İKİ fix’in kötü doğruluğunu kullanır', async () => {
    const { noiseFloorM } = await import('../platform/gps/speedCore');
    /* Sahada ölçülen çift: önceki fix ±14.9 m, güncel fix ±8.5 m.
       Yalnız güncele bakmak tabanı 17 m'ye düşürüp 24 m'lik saf gürültüyü
       "gerçek hareket" saydırıyordu. */
    expect(noiseFloorM(8.5, 14.9)).toBeCloseTo(29.8, 5);
    expect(noiseFloorM(14.9, 8.5)).toBeCloseTo(29.8, 5); // sıra önemsiz
    expect(noiseFloorM(8.5)).toBeCloseTo(17, 5);          // tek argüman korunur
  });

  it('🔒 taban tavanı gerçek kötü doğruluğun ALTINA düşmez', async () => {
    const { noiseFloorM, GPS_NOISE_FLOOR_MAX_M } = await import('../platform/gps/speedCore');
    // Cihazda ±14.9 m ölçüldü; tavan bunun 2 katını taşıyabilmeli.
    expect(GPS_NOISE_FLOOR_MAX_M).toBeGreaterThanOrEqual(30);
    expect(noiseFloorM(100, 100)).toBe(GPS_NOISE_FLOOR_MAX_M);
  });

  it('🔒 SAHA KAYDI: 55 km/h iddiası 2.4 m yer değiştirmeyle ÇÜRÜR', async () => {
    const { reconcileDopplerWithDisplacement, noiseFloorM } =
      await import('../platform/gps/speedCore');
    // Gerçek fix çifti: ts 971741→981735 (dt 9.994 s), acc 3.7→8.23, disp ≈2.4 m
    const floor = noiseFloorM(8.23, 3.7);
    expect(reconcileDopplerWithDisplacement(55 / 3.6, 2.4, 9.994, floor)).toBe(0);
  });

  it('🔒 gerçek sürüş ÇÜRÜTÜLMEZ: 60 km/h + 16.7 m/sn korunur', async () => {
    const { reconcileDopplerWithDisplacement, noiseFloorM } =
      await import('../platform/gps/speedCore');
    const floor = noiseFloorM(8, 8);
    // 60 km/h'de 1 sn'de 16.7 m yol alınır — taban 16 m olsa bile hız KORUNUR.
    expect(reconcileDopplerWithDisplacement(60 / 3.6, 16.7, 1, floor)).toBeCloseTo(60 / 3.6, 5);
  });

  it('🔒 doğrulanamayan Doppler FAIL-CLOSED (pencere dışı geçemez)', async () => {
    const { DOPPLER_CHECK_MAX_DT_SEC } = await import('../platform/gps/speedCore');
    /* Cihazın park hâlindeki fix aralığı ~10 sn ölçüldü (9.994 · 10.002 · 9.996):
       eski 10 sn'lik sınır fix'lerin yarısını kontrolün DIŞINDA bırakıyordu. */
    expect(DOPPLER_CHECK_MAX_DT_SEC).toBeGreaterThan(10);
    const src = (await import('../platform/gpsService.ts?raw')).default;
    expect(src, 'pencere dışı Doppler artık doğrulanmadan GEÇEMEZ')
      .toMatch(/_dtSec > DOPPLER_CHECK_MAX_DT_SEC[\s\S]{0,900}_gpsSpeedChecked = undefined/);
  });

  it('🔒 durakta kamera yönü BİR SONRAKİ manevradan alınır', async () => {
    const src = (await import('../components/map/FullMapView.tsx?raw')).default;
    /* `steps[currentStepIndex].coordinate` ADIM BAŞLANGICIDIR (aracın ARKASI).
       Kamera onu kullanınca harita rotanın 179° tersine bakıyordu. */
    expect(src).toMatch(/_routeBearing[\s\S]{0,600}_rs\.steps\[_ni\]/);
    expect(src, 'adım BAŞLANGICI yön kaynağı olarak geri gelmiş')
      .not.toMatch(/_routeBearing[\s\S]{0,200}steps\[_rs\.currentStepIndex\]/);
  });

  it('🔒 araç ekranda kalır: padding doyunca LOOK-AHEAD kısılır', async () => {
    const src = (await import('../platform/map/MapInteractionManager.ts?raw')).default;
    /* Ölçüm: padding 0'a kısılmışken araç hâlâ 800 px ekran dışındaydı —
       klips doyuma ulaşıp SESSİZCE başarısız oluyordu. */
    /* GÜNCELLENDİ (ısınma düzeltmesi): düzeltme artık kare-başı DÖNGÜ değil,
       öğrenilen bir TAVAN. Kilidin AMACI aynı: padding doyduğunda ileri bakış
       KISILIR ve araç ekranda kalır. */
    expect(src).toContain('isVehicleFramed(_p2.x, _p2.y, _cv.clientWidth, _h)');
    expect(src, 'taşmada ileri bakış kısılmalı').toContain('_lookCapM = _lookEff * 0.5;');
    expect(src, 'tavan merkez hesabına BAŞTAN girmeli').toContain('Math.min(_lookAhead, _lookCapM)');
  });
});

/* ═══════════════ F. HIZ LİMİTİ KARTI ═══════════════════════════════════════
 * Ölçüm: `overpass-api.de` cihazdan **HTTP 504 + HTML gövde**, süre 10–13 sn.
 * Ürün 4 sn'de iptal ediyor, tamamlansa bile `res.json()` HTML'de SyntaxError
 * atıp boş `catch`e düşüyordu → kart YAPISAL olarak hiç çıkamıyordu.
 */
describe('F. Hız limiti kartı gerçek ağ koşullarında', () => {
  it('🔒 HTTP durumu ve içerik tipi KONTROL EDİLİR', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    /* GÜNCELLENDİ: tek-istek modelinde `continue` yerine `return` (sıradaki uç
       nokta bir SONRAKİ denemede sıralanır). Kilidin AMACI aynı: 504/HTML
       yanıtı sessizce `SyntaxError`e düşmemeli. */
    expect(src).toContain('if (!res.ok) return;');
    expect(src).toMatch(/content-type/);
    expect(src, 'JSON olmayan yanıt sessizce yutulmamalı').toContain("ct.includes('json')");
  });

  it('🔒 tek uç noktaya bağımlı DEĞİL ve iptal süresi ölçülen gecikmeyi kapsar', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    const eps = src.match(/https:\/\/[^'"]*interpreter/g) ?? [];
    expect(eps.length, 'yedek Overpass uç noktası yok').toBeGreaterThanOrEqual(2);
    const m = src.match(/_EP_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(m).toBeTruthy();
    const ms = Number(m![1].replace(/_/g, ''));
    /* GÜNCELLENDİ: ilk eşiğim (>13.4 sn) YANLIŞ GEREKÇEYE dayanıyordu — 10–13 sn
       ölçülen süre **504 başarısız** yanıtlarındı, onları beklemek boşuna telsiz
       yakıyor (kullanıcı ısınma bildirdi). ÇALIŞAN yanıt 1.9 sn'de geldi.
       Kilidin AMACI aynı: sınır, ÇALIŞAN yanıtı kesmeyecek kadar geniş olmalı
       (4 sn'lik eski değer kesiyordu) ama ölü isteği uzatmamalı. */
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it('🔒 başarısız deneme 200 m kapısına TAKILMAZ (duran araçta yeniden dener)', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    expect(src).toContain('_RETRY_BACKOFF_MS');
    /* GÜNCELLENDİ: kapı artık son SORGULANAN noktaya göre ölçülür
       (`lastQueryRef`), böylece başarısız denemeden sonra da yeniden denenir. */
    expect(src).toContain('lastQueryRef');
    expect(src, 'limit BİLİNİYORSA sorgu kilitlenmeli, bilinmiyorsa denenmeli')
      .toMatch(/else if \(hasLimitRef\.current\)[\s\S]{0,40}return;/);
  });

  it('🔒 limit bilinmiyorsa UYDURULMAZ', async () => {
    const { inferLimitFromHighwayClass } = await import('../platform/speedLimitService');
    expect(inferLimitFromHighwayClass(undefined)).toBeNull();
    expect(inferLimitFromHighwayClass('bilinmeyen_sinif')).toBeNull();
    expect(inferLimitFromHighwayClass('residential')).toBe(50);
  });
});

describe('F2. Boş Overpass yanıtı zinciri ÖLDÜRMEZ', () => {
  it('🔒 200 + 0 eleman → sıradaki uç noktaya geçilir', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    /* Ölçüm: `overpass.osm.ch` 745 ms'de 200 + 0 eleman döndürdü (bölgesel
       arşiv); aynı sorguyu `overpass-api.de` 3 yol ile yanıtladı. */
    /* GÜNCELLENDİ: zincir artık TEK istek/deneme modeline geçti (ısınma düzeltmesi)
       — uç noktalar denemeler ARASINDA dolaşılır. Kilidin AMACI aynı: boş yanıt
       bir CEVAP sayılıp kaynak sabitlenmemeli. */
    expect(src).toMatch(/els\.length === 0/);
    expect(src).toContain('attemptRef.current % _OVERPASS_ENDPOINTS.length');
    expect(src).not.toMatch(/başka uç nokta denemenin anlamı yok[\s\S]{0,80}return;/);
  });

  it('🔒 geçici 504 dalgasını yakalayacak kadar deneme hakkı var', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    const m = src.match(/_RETRY_BACKOFF_MS = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const n = m![1].split(',').length;
    // Aynı uçta 504 → dakikalar sonra 200 ölçüldü; 3 deneme yetmiyordu.
    expect(n).toBeGreaterThanOrEqual(4);
  });
});

/* ═══════════════ G. YOL SAYACI PARK HÂLİNDE TIRMANIYORDU ══════════════════
 * Kullanıcı ekran görüntüsü (2026-08-03): araç PARK, hız 0 KM/H, OBD kopuk —
 * Yol Sayacı **95 → 106,7 km**. Saatler boyunca dakikada ~50 m sahte mesafe.
 */
describe('G. Yol sayacı belirsizlik tabanı', () => {
  it('🔒 taban ÇİFT fix’in kötü doğruluğundan üretilir', async () => {
    const src = (await import('../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw')).default;
    expect(src, 'önceki fix’in doğruluğu çapa güncellenmeden ÖNCE okunmalı')
      .toMatch(/const _prevAccM = _prevOdoBuf\.acc;[\s\S]{0,200}_prevOdoBuf\.lat = loc\.lat;/);
    expect(src).toMatch(/_odoAccM\s*=\s*Math\.max\([\s\S]{0,160}_prevAccM/);
  });

  it('🔒 taban tavanı ölçülen kötü doğruluğun ALTINA düşmez', async () => {
    const src = (await import('../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw')).default;
    /* Cihazda `accuracy` 14.9 m ölçüldü; 12 m'lik tavan tabanı belirsizliğin
       altında bırakıp 24.4 m'lik gürültüyü "mesafe" saydırıyordu. */
    expect(src).toContain('Math.min(40, Math.max(2.5, _odoAccM * 2))');
    expect(src, 'eski 12 m tavanı geri gelmiş').not.toContain('Math.min(12, Math.max(2.5,');
  });

  it('🔒 taban kapısı hâlâ mesafeyi biriktirmeden ÖNCE uygulanır', async () => {
    const src = (await import('../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw')).default;
    expect(src).toContain('if (deltaKm * 1000 <= _odoFloorM) return;');
  });
});

/* ═══════════════ H. ROTA KALİTESİ VE YÖNLENDİRME (kullanıcı turu 2026-08-03) ═══
 * Kullanıcı: "rotayı iğrenç çiziyor · ters yolda · daha 50 m var sağa dön diyor
 * · hız kartı yola çıkmadan gelmedi".
 */
describe('H. Rota isteği aracın yönünü bildirir', () => {
  it('🔒 yön biliniyorsa OSRM bearings gönderilir', async () => {
    const { buildOsrmBearings, OSRM_BEARING_TOLERANCE_DEG } =
      await import('../platform/routingService');
    expect(buildOsrmBearings(90)).toBe(`90,${OSRM_BEARING_TOLERANCE_DEG};`);
    expect(buildOsrmBearings(-10)).toBe(`350,${OSRM_BEARING_TOLERANCE_DEG};`);
    expect(buildOsrmBearings(370)).toBe(`10,${OSRM_BEARING_TOLERANCE_DEG};`);
    // hedef ucu SERBEST kalmalı → dizge ';' ile biter, ikinci kısıt YOK
    expect(buildOsrmBearings(90)!.endsWith(';')).toBe(true);
  });

  it('🔒 yön BİLİNMİYORSA uydurulmaz — parametre hiç gönderilmez', async () => {
    const { buildOsrmBearings } = await import('../platform/routingService');
    expect(buildOsrmBearings(null)).toBeNull();
    expect(buildOsrmBearings(undefined)).toBeNull();
    expect(buildOsrmBearings(NaN)).toBeNull();
  });

  it('🔒 tolerans aracın ÖNÜNÜ kapsar, arkasını eler', async () => {
    const { OSRM_BEARING_TOLERANCE_DEG } = await import('../platform/routingService');
    expect(OSRM_BEARING_TOLERANCE_DEG).toBeGreaterThanOrEqual(45);
    expect(OSRM_BEARING_TOLERANCE_DEG).toBeLessThan(90); // 90+ ters şeridi de kapsar
  });

  it('🔒 istek URL’ine bearings gerçekten ekleniyor', async () => {
    const src = (await import('../platform/routingService.ts?raw')).default;
    expect(src).toMatch(/_bearings \? `&bearings=\$\{encodeURIComponent\(_bearings\)\}`/);
    expect(src, 'her iki OSRM çağrısı da yönü geçmeli')
      .not.toMatch(/_tryServer\(server, fromLon, fromLat, toLon, toLat\)/);
  });
});

describe('H2. Sapma kapısı hız birimi', () => {
  it('🔒 store hızı km/h — yeniden 3.6 ile ÇARPILMAZ', async () => {
    const src = (await import('../platform/routingService.ts?raw')).default;
    /* Hata: `(speed ?? 0) * 3.6` → hız 3.6 kat şişiyor, "dururken reroute yapma"
       kapısı 3 km/h yerine 0.83 km/h'ye düşüyordu. */
    expect(src).not.toMatch(/const speedKmh = \(speed \?\? 0\) \* 3\.6;/);
    expect(src).not.toMatch(/speedKmh.*\*\s*3\.6/);
    /* KİLİT GÜNCELLENDİ (saha 2026-08-05 · #408) — ZAYIFLATILMADI.
     * Birim kuralı aynı: store hızı km/h'tir, 3.6 ile çarpılmaz (yukarıdaki iki
     * satır bunu bağlar). Değişen: hız BİLİNMİYORSA artık 0 uydurulmuyor —
     * `speedKmhOrNull` null olarak taşınıp eşleme motoruna öyle veriliyor.
     * Sahte 0, "araç duruyor" diye okunup eldeki gerçek yönü çöpe atıyordu (#405). */
    expect(src).toContain('const speedKmh = speedKmhOrNull ?? 0;');
    expect(src).toContain('speedKmh: speedKmhOrNull');
  });

  it('🔒 store sözleşmesi km/h olarak duruyor', async () => {
    const src = (await import('../platform/vehicleDataLayer/UnifiedVehicleStore.ts?raw')).default;
    expect(src).toMatch(/speed:\s*number \| null;\s*\/\/ km\/h/);
  });
});

describe('H3. Son sesli uyarı hıza göre', () => {
  /* KİLİT TAŞINDI (NAVIGATION_DELIVERY_CORE_P0): eşik artık saf
     `voiceGuidanceModel.finalTierMetres` içinde — DEĞER DEĞİŞMEDİ, yalnız
     sahibi görünümden alındı (tam ekran kapanınca ses susuyordu). */
  it('🔒 sabit 80 m yerine zaman tabanlı eşik', async () => {
    const src = (await import('../platform/navigation/core/voiceGuidanceModel.ts?raw')).default;
    expect(src, 'sabit 80 m eşiği geri gelmiş').not.toContain('d <= 80');
    expect(src).toContain('(v / 3.6) * FINAL_TIER_SECONDS');
    const { finalTierMetres } = await import('../platform/navigation/core/voiceGuidanceModel');
    expect(finalTierMetres(50)).toBeCloseTo(55.6, 1);
    expect(finalTierMetres(30)).toBe(35);
    expect(finalTierMetres(200)).toBe(150);
    /* Eski kilit React deps dizisine bakıyordu; o efekt artık YOK. Korunan
     * davranış aynı: eşik HIZDAN türer → runtime her tick'te GÜNCEL hızı
     * karar katmanına geçirmek zorundadır. Kilit o sözleşmeyi denetler. */
    const rtSrc = (await import('../platform/navigation/navigationSessionRuntime.ts?raw')).default;
    expect(rtSrc, 'runtime güncel hızı ses kararına geçirmiyor').toContain('speedKmh,');
    expect(rtSrc).toContain('useUnifiedVehicleStore.getState().speed');
  });
});

/* ═══════════════ I. ISINMA — benim eklediklerimin maliyeti ═════════════════
 * Kullanıcı (2026-08-03): "senin işlemlerinden sonra telefon aşırı ısınmaya ve
 * kasmaya başladı." İki kaynak da bu turda EKLEDİĞİM koddu.
 */
describe('I. Isınma bütçesi', () => {
  it('🔒 çerçeve düzeltmesi kare başına DÖNGÜ kurmaz', async () => {
    const src = (await import('../platform/map/MapInteractionManager.ts?raw')).default;
    /* Eski hâl: `for (let _i = 0; _i < 3 …)` → araç çerçeve dışındayken kare
       başına 3 ek jumpTo = 5 harita yeniden çizimi (6-7 Hz'de GPU yükü). */
    expect(src, 'kare-başı düzeltme döngüsü geri gelmiş')
      .not.toMatch(/for \(let _i = 0; _i < 3[\s\S]{0,80}jumpTo/);
    expect(src, 'düzeltme SONUCU hatırlanmalı (tavan)').toContain('_lookCapM');
    expect(src, 'tavan merkez hesabına BAŞTAN girmeli')
      .toContain('Math.min(_lookAhead, _lookCapM)');
  });

  it('🔒 hız limiti: deneme başına TEK istek, üst üste binme yok', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    expect(src, 'uçuşta istek kilidi yok').toContain('inFlightRef');
    expect(src).toContain('if (timerRef.current !== null || inFlightRef.current) return;');
    expect(src, 'tek denemede tüm uçları gezen döngü geri gelmiş')
      .not.toMatch(/for \(const ep of _OVERPASS_ENDPOINTS\)/);
  });

  it('🔒 zamanlayıcı her GPS tikinde SIFIRLANMAZ', async () => {
    const src = (await import('../platform/speedLimitService.ts?raw')).default;
    /* Sıfırlansaydı gecikme hiç dolmaz, istek ATILAMAZDI (1 Hz GPS akışı). */
    expect(src).not.toMatch(/if \(timerRef\.current\) clearTimeout\(timerRef\.current\);\s*\n\s*const _delay/);
    expect(src, 'sorgu konumu closure yerine ref’ten okunmalı').toContain('posRef.current');
  });
});

/* ═══════════════ J. ISINMANIN ÖLÇÜLEN KÖKÜ ════════════════════════════════
 * CİHAZ ÖLÇÜMÜ (telefon `4L45OFZDX84X55GE`, navigasyon AKTİF, araç PARK):
 *   • uygulama CPU **%119** · harita **31.2 çizim/sn**
 *   • 20 sn'de `user-ring.circle-radius` 50 · `user-glow.circle-opacity` 50
 *     · `setData:user-location` 72
 * İki kusurun DA kökü aynı: "navigasyon aktif" durumu "araç hareket ediyor"
 * yerine kullanılmış. Park etmiş araç, navigasyon açıkken de park hâlindedir.
 */
describe('J. Durakta harita çizim yükü', () => {
  it('🔒 işaretçi nabzı YALNIZ gerçek harekette çalışır', async () => {
    const src = (await import('../platform/map/MapLayerManager.ts?raw')).default;
    expect(src, '"navigasyon açıksa nabız at" koşulu geri gelmiş')
      .not.toContain('(moving || M.markerNavActive)');
    expect(src, 'durakta statik değerler BİR KEZ yazılmalı').toContain('M.markerPulseStatic');
    expect(src).toMatch(/if \(!moving\) \{[\s\S]{0,200}markerPulseStatic/);
  });

  it('🔒 "durgun" tanımı navigasyonla EZİLMEZ', async () => {
    const src = (await import('../components/map/FullMapView.tsx?raw')).default;
    expect(src, 'nav aktifken durgunluk yok sayılıyordu')
      .not.toContain('const _stationary = !_navOrDriving && speedKmh < STANDSTILL_KMH;');
    expect(src).toContain('const _stationary = speedKmh < STANDSTILL_KMH;');
  });

  it('🔒 durakta eşikler gürültü bandının ÜSTÜNDE kalır', async () => {
    const src = (await import('../components/map/FullMapView.tsx?raw')).default;
    /* Ölçülen gürültü: konum ±1.8 m, heading fix başına ~3°. Hassas eşikler
       (0.3 m / 0.5°) durakta HER tikte tetikleniyordu. */
    expect(src).toMatch(/STANDSTILL_HOLD_M = (\d+)/);
    expect(src).toMatch(/STANDSTILL_BEAR\s+= (\d+)/);
    const hold = Number(src.match(/STANDSTILL_HOLD_M = (\d+)/)![1]);
    const bear = Number(src.match(/STANDSTILL_BEAR\s+= (\d+)/)![1]);
    expect(hold).toBeGreaterThanOrEqual(3);
    expect(bear).toBeGreaterThanOrEqual(10);
  });
});

/* ═══════════════ K. KAMERA GÖRÜNMEZKEN ÇALIŞIYORDU ════════════════════════
 * CİHAZ ÖLÇÜMÜ (2026-08-03, navigasyon aktif, AR kapalı): `<video>` opacity 0
 * iken kamera track'i `live · 1280×720 @ 30 fps`, `currentTime` ≈ **28 saat**.
 */
describe('K. AR kamerası yalnız görünürken açılır', () => {
  it('🔒 kamera navigasyon başlar başlamaz AÇILMAZ', async () => {
    const src = (await import('../components/map/VisionOverlay.tsx?raw')).default;
    expect(src, 'startVision yalnız isNavigating’e bağlı kalmış')
      .not.toMatch(/startVision\(video\)[\s\S]{0,400}\}, \[isNavigating\]\);/);
    expect(src, 'kamera görünürlüğe bağlanmalı').toContain('const wantCamera = isHybrid || transitioning;');
    expect(src).toMatch(/\}, \[isNavigating, isHybrid, transitioning\]\);/);
  });

  it('🔒 görünmezken donanım BIRAKILIR (pay sonlu)', async () => {
    const src = (await import('../components/map/VisionOverlay.tsx?raw')).default;
    expect(src).toContain('CAMERA_RELEASE_GRACE_MS');
    const m = src.match(/CAMERA_RELEASE_GRACE_MS = ([\d_]+)/);
    expect(m).toBeTruthy();
    const ms = Number(m![1].replace(/_/g, ''));
    expect(ms).toBeGreaterThan(0);
    expect(ms, 'pay sınırsız olamaz — donanım bırakılmalı').toBeLessThanOrEqual(60_000);
    expect(src).toMatch(/setTimeout\(\(\) => \{ stopVision\(\); \}, CAMERA_RELEASE_GRACE_MS\)/);
  });

  it('🔒 hizalama sensörleri navigasyon boyunca AÇIK kalır', async () => {
    const src = (await import('../components/map/VisionOverlay.tsx?raw')).default;
    /* Sensörler izin gerektirmez ve ucuzdur; AR'a geçildiğinde hazır olmalı. */
    expect(src).toMatch(/startARAlignment\(\);[\s\S]{0,120}\}, \[isNavigating\]\);/);
  });
});

describe('H4. Durakta yön OSRM’e dayatılmaz', () => {
  it('🔒 güven eşiği var ve kamera eşiğiyle aynı mertebede', async () => {
    const { HEADING_TRUST_MIN_KMH } = await import('../platform/routingService');
    const { CAMERA_CFG } = await import('../platform/cameraEngine');
    expect(HEADING_TRUST_MIN_KMH).toBeGreaterThan(0);
    expect(HEADING_TRUST_MIN_KMH).toBeLessThanOrEqual(CAMERA_CFG.JITTER_SPEED_KMH * 2);
  });

  it('🔒 hız eşiğin altındayken yön OKUNMAZ', async () => {
    const src = (await import('../platform/routingService.ts?raw')).default;
    /* Ölçüm: park hâlinde heading 92°→106° kaydı. Duran araçta bu değeri
       ±75° toleransla dayatmak rotayı yanlış yöne kilitler. */
    expect(src).toContain('if (!(kmh >= HEADING_TRUST_MIN_KMH)) return null;');
    expect(src, 'hız kontrolü heading okumasından ÖNCE olmalı')
      .toMatch(/HEADING_TRUST_MIN_KMH\)\) return null;[\s\S]{0,80}const h = st\.heading;/);
  });
});

/* ═══════════════ L. TEK FIX'LİK HAYALET HIZ ═══════════════════════════════
 * CİHAZ ÖLÇÜMÜ (2026-08-03, araç PARK): 60 örneğin 3'ü 1.5 km/h üstü, en
 * yüksek **22.74 km/h**; o anda yer değiştirme 5.9 m, gürültü tabanı 6 m —
 * tek fix çiftinden gerçek hareketten ayırt edilemez. Sonucu: nabız + marker
 * tazelemesi açılıyor, harita 17 çizim/sn'ye çıkıyordu.
 */
describe('L. Hareket iddiası teyit ister', () => {
  it('🔒 tek fix’lik, doğrulanmamış iddia REDDEDİLİR', async () => {
    const { confirmMotion } = await import('../platform/gps/speedCore');
    // 22.74 km/h = 6.32 m/s · yer değiştirme tabanı AŞMADI · önceki fix düşüktü
    expect(confirmMotion(22.74 / 3.6, true, false, false)).toBe(0);
  });

  it('🔒 yer değiştirme KANITLARSA hız korunur (gecikme yok)', async () => {
    const { confirmMotion } = await import('../platform/gps/speedCore');
    expect(confirmMotion(22.74 / 3.6, true, true, false)).toBeCloseTo(22.74 / 3.6, 5);
  });

  it('🔒 SÜREKLİ hareket korunur — gerçek sürüş bastırılmaz', async () => {
    const { confirmMotion } = await import('../platform/gps/speedCore');
    expect(confirmMotion(60 / 3.6, true, false, true)).toBeCloseTo(60 / 3.6, 5);
    expect(confirmMotion(60 / 3.6, true, true, true)).toBeCloseTo(60 / 3.6, 5);
  });

  it('🔒 KANIT YOKKEN (önceki fix yok) sensöre güvenilir', async () => {
    const { confirmMotion } = await import('../platform/gps/speedCore');
    /* İlk fix'te yer değiştirme ölçülemez → iddiayı çürütecek kanıt yoktur.
       Gerçekten hareket eden aracın ilk ölçümünü sıfırlamak daha büyük kusur. */
    expect(confirmMotion(90 / 3.6, false, false, false)).toBeCloseTo(90 / 3.6, 5);
  });

  it('🔒 eşik altındaki değerlere DOKUNULMAZ', async () => {
    const { confirmMotion, MOTION_CONFIRM_KMH } = await import('../platform/gps/speedCore');
    expect(confirmMotion(0, true, false, false)).toBe(0);
    expect(confirmMotion(undefined, true, false, false)).toBeUndefined();
    expect(MOTION_CONFIRM_KMH).toBeGreaterThan(0);
    expect(confirmMotion((MOTION_CONFIRM_KMH - 0.1) / 3.6, true, false, false))
      .toBeCloseTo((MOTION_CONFIRM_KMH - 0.1) / 3.6, 5);
  });

  it('🔒 zincir gpsService’te GERÇEKTEN bağlı', async () => {
    const src = (await import('../platform/gpsService.ts?raw')).default;
    expect(src).toContain('confirmMotion(rawSpeed, _speedEvidence, _dispCorroborated, _prevSpeedAbove)');
    expect(src).toContain('_dispCorroborated = _dispM > _floor;');
    expect(src, 'süreklilik HAM iddiadan izlenmeli')
      .toContain('_prevSpeedAbove = _rawClaimKmh > MOTION_CONFIRM_KMH;');
  });
});
