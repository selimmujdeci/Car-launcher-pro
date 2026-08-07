/**
 * carosLabFleetIdentity.test.ts — LAB FLEET IDENTITY + TEK OTORİTE KİLİTLERİ.
 *
 * İki şey kilitlenir:
 *   (A) Zorunlu Gözlemlenebilirlik: salt-okunur ekran · gerçek kaynak ·
 *       aktif komut YOK · kanıtsız bilgi YOK · HAM VERİ YOK.
 *   (B) §3 yapısal sözleşme: kimliği sunucuya YALNIZ koordinatör yayınlar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Yorumları sıyırır — gerekçe metnindeki teknik adlar KOD SAYILMAZ. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCREEN      = 'src/components/devtools/screens/FleetIdentityScreen.tsx';
const COORDINATOR = 'src/platform/telemetry/vehicleIdentityCoordinator.ts';
const OBSERVATION = 'src/platform/telemetry/vehicleIdentityObservation.ts';
const RUNTIME     = 'src/platform/telemetry/vehicleIdentityRuntime.ts';
const PRODUCER    = 'src/platform/vehicleFingerprintBuilder.ts';
const TELEMETRY   = 'src/platform/telemetryService.ts';

describe('LAB · katalog ve yönlendirme', () => {
  it('1. 🔒 araç kategorisinde AVAILABLE bir Fleet Identity aracı var', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'fleet-identity');
    expect(tool, 'katalogda fleet-identity yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    expect(tool!.note).toMatch(/BAŞLATMAZ/);
    expect(tool!.note).toMatch(/HAM VERİ GÖSTERİLMEZ/);
    expect(tool!.note).toMatch(/sahiplik otoritesi DEĞİLDİR/);
  });

  it('2. 🔒 ekran haritası bu aracı lazy bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'fleet-identity':/);
    expect(map).toMatch(/import\('\.\/screens\/FleetIdentityScreen'\)/);
    expect(existsSync(join(ROOT, SCREEN))).toBe(true);
  });
});

describe('LAB · aktif komut YOK', () => {
  it('3. 🔒 ekran hiçbir yazma/komut/ağ yolu çağırmıyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /fetch\(/, /\.rpc\(/, /publishIdentityObservation/, /observeVehicleIdentity/,
      /performHandshake/, /setInterval/, /setTimeout/,
      /localStorage\.setItem/, /\.observe\(/, /\.stop\(/,
    ]) {
      expect(c, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('4. 🔒 ekran timer kurmuyor, mountedRef ile temizleniyor', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('5. 🔒 ekran YALNIZ salt-okunur anlık görüntü okur', () => {
    expect(code(SCREEN)).toMatch(/readIdentityCoordinatorSnapshot/);
  });
});

describe('LAB · HAM VERİ gösterilmez', () => {
  it('6. 🔒 ekran TAM VIN basmıyor — yalnız maskeli', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/maskVin\(obs\.vin\)/);
    // Ham `obs.vin` doğrudan render edilmemeli (yalnız null kontrolü + maskVin).
    expect(c).not.toMatch(/\{obs\.vin\}/);
    expect(c).not.toMatch(/\{identity\.vin\}/);
  });

  it('7. 🔒 ekran ham parmak izini basmıyor — yalnız ilk 12 karakter', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/fingerprintHash\.slice\(0, 12\)/);
    expect(c).not.toMatch(/\{obs\.fingerprintHash\}/);
  });

  it('8. 🔒 ekran api_key / ham Mode 09 / ECU / bitmap / MAC göstermiyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /api_?[kK]ey/, /raw09/, /ecuAddress/, /supportedPidBitmap/,
      /adapterMac/, /accessToken/, /bearer/i,
    ]) {
      expect(c, `ekran yasak alan gösteriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('9. 🔒 ekran konum/GPS göstermiyor', () => {
    const c = code(SCREEN);
    expect(c).not.toMatch(/latitude|longitude|\blat\b|\blng\b/);
  });

  it('10. 🔒 mutlak zaman damgası basılmıyor — yalnız zaman FARKI', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/function ago\(/);
    expect(src).toMatch(/nowMs - atMs/);
    expect(code(SCREEN)).not.toMatch(/toISOString|toLocaleString|new Date\(/);
  });
});

describe('LAB · kanıtsız bilgi üretilmez', () => {
  it('11. 🔒 bilinmeyen alan UNAVAILABLE gösterilir', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/const UNAVAILABLE = 'UNAVAILABLE'/);
    expect(src).toMatch(/if \(atMs === null\) return UNAVAILABLE;/);
  });

  it('12. 🔒 okuma düşerse ekran çökmez (fail-soft)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/try \{ co = readIdentityCoordinatorSnapshot\(\); \} catch/);
  });

  it('13. 🔒 PENDING açıkça "sunucu onayı yok" der (sahte doğrulandı YOK)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/PENDING — sunucu onayı yok/);
    expect(src).toMatch(/VERIFIED — sunucu kabul etti/);
  });
});

describe('§3 · TEK YAYIN OTORİTESİ (yapısal kilit)', () => {
  it('14. 🔒 ağ ucunu YALNIZ koordinatör runtime\'ı çağırır', () => {
    // Tüm kaynakta `publishIdentityObservation` çağrısını ara.
    const files = [
      COORDINATOR, OBSERVATION, RUNTIME, PRODUCER, TELEMETRY, SCREEN,
      'src/platform/telemetry/vehicleIdentityReport.ts',
    ];
    const callers: string[] = [];
    for (const f of files) {
      const c = code(f);
      // Tanımın kendisi (telemetryService) hariç, ÇAĞRI arıyoruz.
      if (/\.publishIdentityObservation\(/.test(c)) callers.push(f);
    }
    expect(callers, `beklenmeyen yayın çağıranı: ${callers.join(', ')}`)
      .toEqual([RUNTIME]);
  });

  it('15. 🔒 üretici (fingerprint builder) doğrudan YAYIN YAPMAZ', () => {
    const c = code(PRODUCER);
    expect(c).not.toMatch(/publishIdentityObservation/);
    expect(c).not.toMatch(/callVehicleRpc/);
    expect(c).not.toMatch(/record_vehicle_identity/);
    // Yalnız koordinatöre BİLDİRİR.
    expect(c).toMatch(/_publishIdentity\(/);
    expect(c).toMatch(/observeVehicleIdentity/);
  });

  it('16. 🔒 üretici kimlik bildirimini kendi try/catch\'ine sarar', () => {
    const src = read(PRODUCER);
    // Kimlik yayını parmak izi öğrenmeyi bozmamalı.
    expect(src).toMatch(/catch \{ \/\* FAIL-SOFT — kimlik yayını parmak izini bozmaz \*\/ \}/);
  });

  it('17. 🔒 saf katmanlar I/O İÇERMEZ', () => {
    for (const f of [OBSERVATION, COORDINATOR]) {
      const c = code(f);
      expect(c, `${f} fetch içeriyor`).not.toMatch(/fetch\(/);
      expect(c, `${f} localStorage içeriyor`).not.toMatch(/localStorage/);
      expect(c, `${f} Date.now içeriyor`).not.toMatch(/Date\.now\(\)/);
    }
  });

  it('18. 🔒 koordinatör zamanlayıcıyı DI ile alır (gerçek timer gömülü DEĞİL)', () => {
    const c = code(COORDINATOR);
    expect(c).not.toMatch(/\bsetTimeout\(/);
    expect(c).not.toMatch(/\bsetInterval\(/);
    expect(c).toMatch(/setTimer/);
    expect(c).toMatch(/clearTimer/);
  });

  it('19. 🔒 SystemBoot koordinatörü KAPATMA zincirine kaydeder (zero-leak)', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toMatch(/stopVehicleIdentityCoordinator/);
    expect(boot).toMatch(/this\._reg\(\(\) => stopVehicleIdentityCoordinator\(\)\)/);
  });

  it('20. 🔒 async yayın yolu üst düzey muhafazalı (yakalanmayan red YOK)', () => {
    const c = code(COORDINATOR);
    expect(c).toMatch(/_guardedPublish/);
    // Mikrotask ve retry YALNIZ muhafazalı yolu çağırmalı.
    expect(c).not.toMatch(/queueMicrotask\(\(\) => \{ void this\._doPublish/);
  });
});
