/**
 * carosLabTripCost.test.ts — LAB TRIP COST gözlem kilitleri (TRIP-COST-B3).
 *
 * Üç şey kilitlenir:
 *   (A) Zorunlu Gözlemlenebilirlik: salt-okunur ekran · gerçek kaynak ·
 *       aktif komut YOK · kanıtsız bilgi YOK.
 *   (B) GİZLİLİK: hedef/başlangıç ADI, adres ve rota GEOMETRİSİ LAB'a GEÇMEZ.
 *   (C) DÜRÜSTLÜK: fiyat kaynağı yokken "0" değil "BİLİNMİYOR"; iki farklı
 *       "yok" (kategori açılmadı vs değer bilinmiyor) AYRI gösterilir.
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

const SCREEN      = 'src/components/devtools/screens/TripCostScreen.tsx';
const SOURCES     = 'src/platform/devtools/tripCostSources.ts';
const COMPOSITION = 'src/platform/trip/cost/tripCostComposition.ts';

describe('LAB · katalog ve yönlendirme', () => {
  it('1. 🔒 araç kategorisinde AVAILABLE bir Trip Cost aracı var', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'trip-cost');
    expect(tool, 'katalogda trip-cost yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
    expect(tool!.note).toMatch(/BAŞLATMAZ/);
    expect(tool!.note, 'not fiyat kaynağının bağlı olmadığını söylemiyor')
      .toMatch(/FİYAT KAYNAKLARI HENÜZ BAĞLI DEĞİL/);
    expect(tool!.note, 'iki farklı "yok" ayrımı notta yok')
      .toMatch(/İKİ FARKLI "YOK"/);
  });

  it('2. 🔒 ekran haritası bu aracı lazy bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'trip-cost':/);
    expect(map).toMatch(/import\('\.\/screens\/TripCostScreen'\)/);
    expect(existsSync(join(ROOT, SCREEN))).toBe(true);
  });
});

describe('LAB · aktif komut YOK', () => {
  it('3. 🔒 ekran hiçbir yazma/komut/ağ yolu çağırmıyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /fetch\(/, /\.rpc\(/, /fetchRoute/, /clearRoute/, /setDestination/,
      /writeActiveRoute/, /setInterval/, /setTimeout/,
      /localStorage\.setItem/, /safeSetRaw/,
    ]) {
      expect(c, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('4. 🔒 ekran timer kurmuyor, mountedRef ile temizleniyor', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
    expect(code(SCREEN), 'ekran abonelik açıyor').not.toMatch(/\.subscribe\(/);
  });

  it('5. 🔒 okuma katmanı da yazma/komut yolu çağırmıyor', () => {
    const c = code(SOURCES);
    for (const forbidden of [
      /fetch\(/, /fetchRoute/, /setDestination/, /writeActiveRoute/,
      /setInterval/, /setTimeout/, /safeSetRaw/, /\.setState\(/,
    ]) {
      expect(c, `kaynak katmanı yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

describe('LAB · GİZLİLİK — ad/adres/geometri taşınmaz', () => {
  it('6. 🔒 gözlem satırı hedef/başlangıç ADINI taşımıyor (yalnız VAR/YOK)', () => {
    const c = code(SOURCES);
    /* Satır tipi yalnız `...Declared: boolean` taşımalı; ham ad alanı OLMAMALI. */
    expect(c).toMatch(/destinationDeclared:\s*boolean/);
    expect(c).toMatch(/originDeclared:\s*boolean/);
    expect(c, 'gözlem satırına hedef adı eklenmiş')
      .not.toMatch(/readonly\s+destinationName/);
    expect(c, 'gözlem satırına rota geometrisi eklenmiş')
      .not.toMatch(/readonly\s+geometry/);
  });

  it('7. 🔒 ekran hedef/başlangıç adını veya koordinatı RENDER etmiyor', () => {
    const c = code(SCREEN);
    for (const forbidden of [
      /destination\.name/, /\.origin\b(?!Declared)/, /latitude/, /longitude/,
      /geometry/, /plan\.destination/, /plan\.origin/,
    ]) {
      expect(c, `ekran gizli alan render ediyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

describe('LAB · DÜRÜSTLÜK', () => {
  it('8. 🔒 bilinmeyen tutar "0" DEĞİL "BİLİNMİYOR" gösterilir', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/BİLİNMİYOR/);
    expect(src, 'üst sınır uydurulmadığı söylenmiyor').toMatch(/UYDURULMAZ/);
    expect(src, 'bilinmeyen alan işareti yok').toMatch(/UNAVAILABLE/);
  });

  it('9. 🔒 kategori kapıları ve eksik beyanlar AYRI bölümlerde gösterilir', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/Kategori kapıları/);
    expect(src).toMatch(/Eksik beyanlar/);
    expect(src).toMatch(/Planı engelleyen/);
  });

  it('10. 🔒 composition SAF kalır — store/servis/ağ/zaman importu YOK', () => {
    const c = code(COMPOSITION);
    for (const forbidden of [
      /from '.*routingService'/, /from '.*navigationService'/,
      /from '.*store\//, /fetch\(/, /Date\.now\(/, /setInterval/, /setTimeout/,
      /from 'react'/,
    ]) {
      expect(c, `composition saflığı bozulmuş: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('11. 🔒 wiring km/leg hesabını TEKRARLAMAZ — tek dönüşüm otoritesi B2', () => {
    const c = code(COMPOSITION);
    expect(c, 'composition B2 adaptörünü kullanmıyor')
      .toMatch(/buildTripPlanFromActiveRoute/);
    expect(c, 'composition metersToKm otoritesini kullanmıyor').toMatch(/metersToKm\(/);
    /* Herhangi bir yerde ELLE 1000'e bölme = ikinci dönüşüm gerçeği. */
    expect(c, 'composition kendi metre→km dönüşümünü kurmuş (ikinci gerçek)')
      .not.toMatch(/\/\s*1000/);
  });
});
