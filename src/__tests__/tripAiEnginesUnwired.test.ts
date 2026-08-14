/**
 * tripAiEnginesUnwired.test.ts — E-02/E-03 BAĞLANDI · E-04 HÂLÂ AÇIK (sınır kilidi).
 *
 * ── ÖNCE (2026-08-13 sabah) ────────────────────────────────────────────
 * Üç TRIP AI motoru da ürün yolunda sıfır çağırana sahipti; kök kapatılamadığı
 * için bir KAPI kurulmuştu (LAB'da "BAĞLANMADI" + bu test durumu donduruyordu).
 *
 * ── SONRA (aynı gün, ikinci tur) ───────────────────────────────────────
 * Ölçüm gösterdi ki iki motor **tamamen saf**: ağ yok, rota yazma yok, global
 * durum yok — yalnız rota geometrisi + yerel kayıtlı yerler alıp aday üretir.
 * O yüzden GÜVENLE bağlandı (LAB → Trip Engine → elle hesap). Kilit bu turda
 * ZAYIFLATILMADI, **yön değiştirdi**: artık bağlı OLDUKLARINI doğrular.
 *
 * ── SINIR KİLİDİ (asıl korunan şey) ────────────────────────────────────
 * `tripApplyComposition` bağlanMADI ve bu bilinçlidir: o katman
 * `writeActiveRoute` ile **rotayı YAZAR** ve `fetchRouteLeg` ile **ağa çıkar**.
 * Bu test onun sessizce bağlanmasını engeller — bağlanacaksa bilinçli bir ürün
 * kararıyla ve bu kilidin güncellenmesiyle olur.
 *
 * Ayrıca kilitlenen: LAB gözlem katmanı rota YAZMAZ ve ağa ÇIKMAZ (gizlilik +
 * güvenlik sınırı kodda kalsın).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['__tests__', 'node_modules']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk('src');

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Sembolü ÇAĞIRAN ürün dosyaları (tanım dosyası hariç). */
function callersOf(symbol: string, definedIn: string): string[] {
  const re = new RegExp(`\\b${symbol}\\s*\\(`);
  return FILES.filter((f) => !f.endsWith(definedIn) && re.test(readFileSync(f, 'utf8')));
}

const SCREEN = readFileSync(
  'src/components/devtools/screens/TripEngineScreen.tsx', 'utf8');
const MODEL = readFileSync('src/platform/devtools/tripAiModel.ts', 'utf8');
const SOURCES = readFileSync('src/platform/devtools/tripAiSources.ts', 'utf8');

describe('E-02/E-03 — koridor ve öneri motorları ürün yoluna BAĞLANDI', () => {
  it.each([
    ['computeCorridorCandidates', 'tripCorridorEngine.ts'],
    ['generateRecommendations', 'tripRecommendationEngine.ts'],
  ])('%s artık ürün yolundan çağrılıyor', (sym, file) => {
    expect(callersOf(sym, file).length).toBeGreaterThan(0);
  });

  it('zincir doğru sırada: koridor → öneri', () => {
    const corridorAt = MODEL.indexOf('computeCorridorCandidates(');
    const recsAt = MODEL.indexOf('generateRecommendations(');
    expect(corridorAt).toBeGreaterThan(-1);
    expect(recsAt).toBeGreaterThan(corridorAt);
  });

  it('LAB ekranı hesabı ELLE tetikler (açılışta koşmaz, timer yok)', () => {
    expect(SCREEN).toContain('trip-ai-run');
    expect(SCREEN).toContain('ADAYLARI HESAPLA');
    /* Hesap yalnız düğme handler'ından çağrılır — efekt içinden DEĞİL. */
    expect(SCREEN).not.toMatch(/useEffect\([^)]*\{[^}]*runTripAi/);
    expect(SOURCES).not.toContain('setInterval');
    expect(SOURCES).not.toContain('setTimeout');
  });
});

describe('E-04 — uygulama katmanı BAĞLANMADI (güvenlik sınırı)', () => {
  it('createTripApplyRuntime ürün yolunda çağrılmıyor', () => {
    expect(callersOf('createTripApplyRuntime', 'tripApplyComposition.ts')).toEqual([]);
  });

  it('LAB gözlem katmanı rota YAZMAZ ve ağa ÇIKMAZ', () => {
    /* Yorumlar elenir: sınırın KENDİSİ yorumda anlatılıyor ("writeActiveRoute
       bu dosyadan çağrılmaz") — kod ile belge aynı kovaya atılırsa kilit
       kendi açıklamasına takılır. */
    for (const src of [MODEL, SOURCES].map(stripComments)) {
      expect(src).not.toContain('writeActiveRoute');
      expect(src).not.toContain('fetchRouteLeg');
      expect(src).not.toContain('createTripApplyRuntime');
      expect(src).not.toContain('fetch(');
    }
  });

  it('ekran bu sınırı kullanıcıya SÖYLER (sessiz eksik değil)', () => {
    expect(SCREEN).toContain('tripApplyComposition');
    expect(SCREEN).toContain('rotayı DEĞİŞTİRMEZ');
  });
});

describe('gizlilik — kullanıcı verisi LAB\'a taşınmaz', () => {
  it('POI adı · adresi · koordinatı · kimliği çıktıya girmez', () => {
    /* Maskeli satır tipi yalnız sayı/kategori/kod taşır. */
    const row = MODEL.slice(MODEL.indexOf('export interface TripAiRow'),
      MODEL.indexOf('export type TripAiState'));
    for (const forbidden of ['name', 'address', 'lat', 'lng', 'poiId', 'queryText']) {
      expect(row, `TripAiRow ${forbidden} taşıyor`).not.toContain(`${forbidden}:`);
    }
  });

  it('ekran ham konum nesnesini render etmez', () => {
    expect(SCREEN).not.toContain('StoredLocation');
    expect(SCREEN).not.toContain('.location');
  });
});
