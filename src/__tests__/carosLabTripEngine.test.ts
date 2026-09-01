/**
 * carosLabTripEngine.test.ts — LAB TRIP ENGINE + "MEVCUT SİSTEME DOKUNMAMA" KİLİTLERİ.
 *
 * (A) Zorunlu Gözlemlenebilirlik: salt-okunur · aktif komut YOK ·
 *     kanıtsız bilgi YOK · rota/koordinat YOK · tahmin ETİKETLİ.
 * (B) "Yeni trip sistemi yazma": runtime `tripLogService`'i YALNIZ GÖZLER.
 * (C) §5: canlı ölçüm GÖNDERİLMEZ — yalnız kapanan trip yüklenir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCREEN   = 'src/components/devtools/screens/TripEngineScreen.tsx';
const MODEL    = 'src/platform/trip/tripCanonicalModel.ts';
const LIFECYCLE= 'src/platform/trip/tripLifecycle.ts';
const COORD    = 'src/platform/trip/tripUploadCoordinator.ts';
const RUNTIME  = 'src/platform/trip/tripUploadRuntime.ts';
const LEGACY   = 'src/platform/tripLogService.ts';

describe('LAB · katalog ve yönlendirme', () => {
  it('1. 🔒 araç kategorisinde AVAILABLE bir Trip Engine aracı var', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'trip-engine');
    expect(tool, 'katalogda trip-engine yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    expect(tool!.note).toMatch(/BASLATMAZ/);
    expect(tool!.note).toMatch(/koordinat GOSTERILMEZ/i);
    expect(tool!.note).toMatch(/TAHMIN/);
  });

  it('2. 🔒 araç kimliği TİP UNION\'ında kayıtlı (route sözleşmesi gerçek)', () => {
    const cat = read('src/platform/devtools/carosLabCatalog.ts');
    const unionBlock = cat.slice(
      cat.indexOf('export type CarosLabToolId'),
      cat.indexOf('export interface CarosLabTool'),
    );
    expect(unionBlock).toContain("'trip-engine'");
  });

  it('3. 🔒 ekran haritası lazy bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'trip-engine':/);
    expect(map).toMatch(/import\('\.\/screens\/TripEngineScreen'\)/);
    expect(existsSync(join(ROOT, SCREEN))).toBe(true);
  });
});

describe('LAB · aktif komut YOK', () => {
  it('4. 🔒 ekran trip veya yükleme TETİKLEMİYOR', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /startTripLog/, /stopTripLog/, /deleteTrip/, /clearAllTrips/,
      /startTripUpload/, /stopTripUpload/, /callVehicleRpc/, /upload_vehicle_trip/,
      /fetch\(/, /setInterval/, /setTimeout/, /\.decide\(/, /markQueued/,
    ]) {
      expect(c, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('5. 🔒 ekran timer kurmuyor, mountedRef ile temizleniyor', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('6. 🔒 ekran YALNIZ salt-okunur anlık görüntü okur', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/readTripUploadSnapshot/);
    expect(c).toMatch(/getTripSnapshot/);
  });

  it('7. 🔒 ekran rota/koordinat GÖSTERMİYOR', () => {
    const c = code(SCREEN);
    /* NOT: lucide `Route` İKONU bir konum alanı DEĞİLDİR; kilit gerçek
       konum/rota VERİSİ erişimini hedefler. */
    for (const forbidden of [
      /latitude/, /longitude/, /\blat\b/, /\blng\b/, /polyline/,
      /\.route\b/, /routePoints/, /waypoints/, /geometry/,
    ]) {
      expect(c, `ekran konum gösteriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('8. 🔒 ekran mutlak zaman damgası basmıyor (yalnız yaş)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/function ago\(/);
    expect(code(SCREEN)).not.toMatch(/toISOString|toLocaleString|new Date\(/);
  });

  it('9. 🔒 bilinmeyen alan UNAVAILABLE / "Veri yok"', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/const UNAVAILABLE = 'UNAVAILABLE'/);
    expect(src).toMatch(/if \(atMs === null\) return UNAVAILABLE;/);
  });

  it('10. 🔒 okuma düşerse ekran çökmez (fail-soft)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/try \{ upload = readTripUploadSnapshot\(\); \} catch/);
    expect(src).toMatch(/catch \{ stats = null; \}/);
  });

  it('11. 🔒 ekran TAHMİN/ÖLÇÜM ayrımını GÖSTERİYOR', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/metricSourceLabel/);
    expect(read(SCREEN)).toMatch(/tahmini/);
  });
});

describe('"Yeni trip sistemi yazma" — yapısal kilit', () => {
  it('12. 🔒 runtime tripLogService\'i BAŞLATMIYOR / DURDURMUYOR / SİLMİYOR', () => {
    const c = code(RUNTIME);
    expect(c).not.toMatch(/startTripLog/);
    expect(c).not.toMatch(/stopTripLog/);
    expect(c).not.toMatch(/deleteTrip/);
    expect(c).not.toMatch(/clearAllTrips/);
    /* YALNIZ gözlem API'leri. */
    expect(c).toMatch(/onTripState/);
    expect(c).toMatch(/getTripSnapshot/);
  });

  it('13. 🔒 mevcut tripLogService DEĞİŞTİRİLMEDİ (sözleşmesi duruyor)', () => {
    const c = read(LEGACY);
    /* Kanonik model/koordinatör bu dosyaya SIZMAMALI — tek yönlü bağımlılık. */
    expect(c).not.toMatch(/tripCanonicalModel/);
    expect(c).not.toMatch(/tripUploadCoordinator/);
    expect(c).not.toMatch(/tripUploadRuntime/);
    /* Kamu API'si ve kayıt biçimi yerinde. */
    expect(c).toMatch(/export interface TripRecord/);
    expect(c).toMatch(/export function startTripLog/);
    expect(c).toMatch(/export function onTripState/);
  });

  it('14. 🔒 saf katmanlar I/O ve zaman İÇERMEZ', () => {
    for (const f of [MODEL, LIFECYCLE, COORD]) {
      const c = code(f);
      expect(c, `${f} fetch içeriyor`).not.toMatch(/fetch\(/);
      expect(c, `${f} localStorage içeriyor`).not.toMatch(/localStorage/);
      expect(c, `${f} Date.now içeriyor`).not.toMatch(/Date\.now\(\)/);
      expect(c, `${f} timer içeriyor`).not.toMatch(/setInterval|setTimeout/);
    }
  });

  it('15. 🔒 kanonik model KOORDİNAT ALANI tanımlamıyor', () => {
    const c = code(MODEL);
    expect(c).not.toMatch(/latitude|longitude/);
    /* Olay yalnız tür/offset/şiddet taşır. */
    expect(c).toMatch(/readonly atOffsetMs: number;/);
  });

  it('16. 🔒 SystemBoot yükleme kablolamasını cleanup zincirine kaydeder', () => {
    /* ARCH-06/F2 KİLİT GÜNCELLEMESİ (zayıflatma DEĞİL — kapsam GENİŞLEDİ).
       Yükleme artık IDLE tetikleyicisine ertelendi (ağ işi; ilk ekrana
       katkısı yok). Korunan invaryant aynı: servis BAŞLAR ve cleanup'ı
       SystemBoot'un LIFO zincirine kaydolur — sahiplik taşınmadı. */
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toMatch(/startTripUpload/);
    expect(boot).toMatch(
      /jobId: 'TripUpload'[\s\S]{0,160}run: \(\) => startTripUpload\(\)/);
    expect(boot).toMatch(
      /bootDeferral\.begin\([\s\S]{0,160}this\._regNamed\(jobId, cleanup\)/);
  });
});

describe('§5 · canlı ölçüm GÖNDERİLMEZ', () => {
  it('17. 🔒 runtime YALNIZ geçmiş büyüdüğünde yükleme yapar', () => {
    const src = read(RUNTIME);
    /* Canlı bildirim (5 s'de bir) elenmeli. */
    expect(src).toMatch(/if \(history\.length <= this\._lastHistoryLength\)/);
    expect(src).toMatch(/_lastHistoryLength/);
  });

  it('18. 🔒 aktif trip (RUNNING) yüklenemez — koordinatör reddeder', () => {
    const c = code(COORD);
    expect(c).toMatch(/'NOT_COMPLETED'/);
    expect(c).toMatch(/summary\.state !== 'COMPLETED'/);
  });

  it('19. 🔒 açılışta ESKİ geçmiş yüklenmiyor (çapa kurulur)', () => {
    const src = read(RUNTIME);
    expect(src).toMatch(/Açılıştaki mevcut geçmiş uzunluğunu çapa al/);
    expect(src).toMatch(/if \(this\._lastHistoryLength < 0\)/);
  });

  it('20. 🔒 bilinmeyen metrik yüke KONMAZ (null gönderilmez)', () => {
    const c = code(RUNTIME);
    expect(c).toMatch(/if \(v !== null\) out\[key\] = v;/);
  });

  it('21. 🔒 runtime yakıt/maliyeti TAHMİN olarak işaretliyor', () => {
    const src = read(RUNTIME);
    expect(src).toMatch(/fuelMeasured: false/);
    expect(src).toMatch(/fuelPriceKnown: false/);
    /* Mesafe kaynağı MEASURED İDDİA EDİLMEZ. */
    expect(src).toMatch(/distanceSource: 'DERIVED'/);
  });
});
