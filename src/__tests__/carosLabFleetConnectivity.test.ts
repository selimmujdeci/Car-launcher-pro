/**
 * carosLabFleetConnectivity.test.ts — LAB FLEET CONNECTIVITY KİLİTLERİ.
 *
 * Zorunlu Gözlemlenebilirlik Kuralı'nın 7 şartını kilitler:
 *   (2) LAB'da salt-okunur ekran VAR · (3) gerçek kaynaktan okur ·
 *   (4) aktif komut GÖNDERMEZ · (5) kanıtsız bilgi ÜRETMEZ (UNAVAILABLE) ·
 *   (6) gizli veri TAŞIMAZ · (7) unit test + kütük maddesi.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import {
  shortId,
  readDeprecatedPairingPaths,
  readContractGate,
  readTelemetryPushObservation,
  readPairingAuthority,
  readIdentityObservation,
} from '../platform/devtools/fleetConnectivitySources';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SCREEN  = 'src/components/devtools/screens/FleetConnectivityScreen.tsx';
const SOURCES = 'src/platform/devtools/fleetConnectivitySources.ts';
/** Yorumlar sıyrılır — gerekçe metnindeki teknik adlar KOD SAYILMAZ. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('LAB · katalog ve yönlendirme', () => {
  it('1. 🔒 araç kategorisinde AVAILABLE bir Fleet Connectivity aracı var', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'fleet-connectivity');
    expect(tool, 'katalogda fleet-connectivity yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    // Not alanı ne YAPMADIĞINI açıkça beyan eder.
    expect(tool!.note).toMatch(/BAŞLATMAZ/);
    expect(tool!.note).toMatch(/GÖSTERİLMEZ/);
  });

  it('2. 🔒 ekran haritası bu aracı lazy olarak bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'fleet-connectivity':/);
    expect(map).toMatch(/lazyWithRetry\(\(\) =>\s*\n?\s*import\('\.\/screens\/FleetConnectivityScreen'\)/);
  });
});

describe('LAB · aktif komut YOK (şart 4)', () => {
  it('3. 🔒 ekran hiçbir yazma/komut yolu çağırmıyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /fetch\(/, /\.rpc\(/, /pushVehicleEvent/, /reportVehicleIdentity/,
      /setInterval/, /setTimeout/, /requestAnimationFrame/,
      /localStorage\.setItem/, /sendCommand/, /startScan/, /connect\(/,
    ]) {
      expect(c, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('4. 🔒 okuma katmanı ağ çağrısı YAPMIYOR ve yazma YAPMIYOR', () => {
    const c = code(SOURCES);
    expect(c).not.toMatch(/fetch\(/);
    expect(c).not.toMatch(/\.rpc\(/);
    expect(c).not.toMatch(/localStorage\.setItem/);
    expect(c).not.toMatch(/localStorage\.removeItem/);
    expect(c).not.toMatch(/setInterval|setTimeout/);
  });

  it('5. 🔒 ekran timer kurmuyor, mountedRef ile temizleniyor', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });
});

describe('LAB · gizli veri taşımaz (şart 6)', () => {
  it('6. 🔒 ekran ham api_key / kod / JWT / tam VIN GÖSTERMİYOR', () => {
    const c = code(SCREEN);
    /* Ekran YALNIZ `apiKeyPresent` boolean'ını okuyabilir; anahtar
       DEĞERİNİ taşıyan bir alan okumamalı. `apiKey` adının tek geçişi
       `apiKeyPresent` olmalı. */
    const apiKeyRefs = c.match(/apiKey\w*/g) ?? [];
    expect(apiKeyRefs.length, 'ekran api_key alanı okuyor').toBeGreaterThan(0);
    expect(new Set(apiKeyRefs), 'ekran ham api_key alanı okuyor').toEqual(new Set(['apiKeyPresent']));
    expect(c).not.toMatch(/linkingCode|pairingCode|rawCode/);
    expect(c).not.toMatch(/accessToken|jwt|bearer/i);
    // Kimlik gösterimi YALNIZ maskeli alandan okunur.
    expect(c).toMatch(/maskedVin/);
    expect(c).not.toMatch(/\bidentity\.vin\b/);
  });

  it('7. 🔒 okuma katmanı api_key DEĞERİNİ döndürmüyor (yalnız VAR/YOK)', () => {
    const c = code(SOURCES);
    // `apiKeyPresent` boolean'dır; ham anahtar alanı YOK.
    expect(c).toMatch(/apiKeyPresent/);
    expect(c).not.toMatch(/apiKey:\s*[^!]/);       // ham değer alanı yok
    expect(c).not.toMatch(/return .*getItem\('caros\.fleet\.apiKey'\)/);
  });

  it('8. 🔒 UUID kısaltılır — TAM kimlik sızmaz', () => {
    const full = '3f9a1c2e-7b44-4d51-9e10-c8ab7d6f2a55';
    const short = shortId(full);
    expect(short).toBe('3f9a1c2e…');
    expect(short).not.toContain('c8ab7d6f2a55');
    expect(shortId(null)).toBeNull();
    expect(shortId('')).toBeNull();
  });
});

describe('LAB · kanıtsız bilgi üretmez (şart 5)', () => {
  it('9. 🔒 bilinmeyen değer UNAVAILABLE gösterilir (sahte 0 YOK)', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/const UNAVAILABLE = 'UNAVAILABLE'/);
    // `age()` bilinmiyorsa UNAVAILABLE döner, "0 ms" DEĞİL.
    expect(src).toMatch(/if \(ms === null\) return UNAVAILABLE;/);
  });

  it('10. 🔒 okuma başarısızsa null döner — sahte "sağlıklı" YOK', () => {
    // jsdom dışı ortamda localStorage/servis yoksa bile FIRLATMAZ.
    expect(() => readTelemetryPushObservation(Date.now())).not.toThrow();
    expect(() => readPairingAuthority()).not.toThrow();
    expect(() => readIdentityObservation()).not.toThrow();
    // Hiç payload kurulmadığı için gözlem null'dır (uydurma değer YOK).
    expect(readTelemetryPushObservation(Date.now())).toBeNull();
  });

  it('11. 🔒 sözleşme kapısı payload yoksa null (varsayılan GEÇTİ YOK)', () => {
    expect(readContractGate(null)).toBeNull();
  });

  it('12. 🔒 OBD atlandıysa OBD anahtarı bulunması İHLAL sayılır', () => {
    const base = {
      presentFields: ['rpm', 'lat'], rejectedFields: [],
      obdSkipped: true, obdSkipReason: 'not_connected',
      gpsSkipped: false, gpsSkipReason: null,
      source: 'HEAD_UNIT_GPS', locationSource: 'HEAD_UNIT_GPS',
      observedAgeMs: 100, obdObservedAgeMs: null, gpsObservedAgeMs: 100,
    };
    expect(readContractGate(base)!.unknownNeverZero).toBe(false);
    expect(readContractGate({ ...base, presentFields: ['lat', 'lng'] })!.unknownNeverZero).toBe(true);
  });
});

describe('LAB · kapatılan yollar gözlemlenebilir', () => {
  it('13. 🔒 üç ölü yol listelenir', () => {
    const paths = readDeprecatedPairingPaths();
    expect(paths).toContain('/api/pwa/pair');
    expect(paths).toContain('/api/vehicle/register');
    expect(paths).toContain('/api/vehicle/code');
  });

  it('14. 🔒 ekran ölü yolları 410 olarak gösterir ve ÇAĞIRMAZ', () => {
    const c = code(SCREEN);
    expect(c).toMatch(/410 GONE/);
    expect(c).not.toMatch(/fetch\(['"`]\/api/);
  });
});
