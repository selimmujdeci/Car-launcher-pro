/**
 * devBootAndTripSurfaceLocks.test.tsx — 2026-09-30'da ölçülen iki kusurun kilidi.
 *
 *   1 · DEV AÇILIŞ ÇÖKMESİ — routingService → offlineRoutingService → SystemBoot →
 *       navigationSessionRuntime → navEgoHorizonBridge → routingService döngüsü.
 *       Köprü `REROUTE_THRESHOLD_M`i MODÜL DÜZEYİNDE okur; routingService'ten ona
 *       statik bir yol varsa ESM değerlendirme sırası TDZ hatası verir ve uygulama
 *       dev modunda hiç açılmaz ("Bootstrap Crash", boş kök).
 *   2 · SEYİR DEFTERİ AÇIK TEMA — `day-mode.css` gündüz/gece ayırmadan
 *       `.text-slate-400/500`ü neredeyse beyaza zorlar → light-ui'da (güneş modu
 *       kapalı) beyaz karta beyaz yazı. Ek olarak güneş modu ikon kuralı
 *       (`svg *[fill] { stroke-width: 0 }`) nitelikli eko halkasını siliyordu.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { EcoScoreCard } from '../components/trip/EcoScoreCard';
import type { TripRecord } from '../platform/tripLogService';

const SRC = resolve(process.cwd(), 'src');

/* ── Statik import grafiği (type-only import'lar hariç) ─────────────────── */

const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
const SIDE_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function resolveFile(base: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const p = resolve(dirname(base), spec);
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function staticDeps(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    if (m[2]) continue;                                            // import type
    if (/^\{\s*(type\s+\w+\s*,?\s*)+\}$/.test(m[3].trim())) continue; // { type A, type B }
    const r = resolveFile(file, m[4]);
    if (r) out.push(r);
  }
  for (const m of src.matchAll(SIDE_RE)) {
    const r = resolveFile(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

function staticPath(fromRel: string, toRel: string): string[] | null {
  const from = resolve(SRC, fromRel), to = resolve(SRC, toRel);
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const f = q.shift() as string;
    if (f === to) break;
    for (const d of staticDeps(f)) if (!prev.has(d)) { prev.set(d, f); q.push(d); }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let f: string | null = to; f; f = prev.get(f) ?? null) path.unshift(f.replace(`${SRC}/`, ''));
  return path;
}

describe('1 · dev açılış — import döngüsü', () => {
  it('🔒 routingService → navEgoHorizonBridge STATİK yolu YOK (TDZ açılış çökmesi)', () => {
    /* Köprünün modül düzeyinde okuduğu sabit hâlâ routingService'ten gelir —
       kilidin anlamı bu okumanın sürmesine bağlı. */
    const bridge = readFileSync(resolve(SRC, 'platform/navigation/navEgoHorizonBridge.ts'), 'utf8');
    expect(bridge).toMatch(/export const ROUTE_CONFLICT_THRESHOLD_M = REROUTE_THRESHOLD_M;/);
    const path = staticPath('platform/routingService.ts', 'platform/navigation/navEgoHorizonBridge.ts');
    expect(path, path ? `döngü geri geldi:\n  ${path.join('\n  → ')}` : '').toBeNull();
  });

  it('yanlışlama: grafik gerçekten yürüyor (bilinen statik yol BULUNUR)', () => {
    expect(staticPath('main.tsx', 'platform/navigation/navEgoHorizonBridge.ts')).not.toBeNull();
  });

  it('worker çökmesinde NavigationCompute yeniden başlatması KORUNUR (dinamik yükleme)', () => {
    const src = readFileSync(resolve(SRC, 'platform/offlineRoutingService.ts'), 'utf8');
    expect(src).not.toMatch(/import\s+\{[^}]*systemBoot[^}]*\}\s+from\s+['"]\.\/system\/SystemBoot['"]/);
    expect(src).toMatch(/import\('\.\/system\/SystemBoot'\)[\s\S]{0,120}restartService\('NavigationCompute'\)/);
  });
});

/* ── Seyir Defteri yüzeyi ─────────────────────────────────────────────────── */

const NOW = 100 * 24 * 3600_000;
const TRIP: TripRecord = {
  id: 'a', startTime: NOW - 7200_000, endTime: NOW - 3600_000,
  distanceKm: 20, durationMin: 20, avgSpeedKmh: 60, maxSpeedKmh: 90,
  fuelConsumptionL: null, fuelCostTL: null, drivingScore: 100, harshEvents: 0,
  timeCoverage: 0.95, metricsVersion: 2,
  ecoDynamics: {
    accelSec: 200, accelOverSec: 20, decelSec: 200, decelHardSec: 4,
    movingSec: 1200, over110Sec: 0, over130Sec: 0,
  },
};

describe('2 · Seyir Defteri açık tema + güneş modu', () => {
  it('🔒 eko halkası fill/stroke NİTELİĞİ taşımaz (güneş modu ikon kuralı onu silerdi)', () => {
    const html = renderToStaticMarkup(<EcoScoreCard history={[TRIP]} nowMs={NOW} />);
    const circles = html.match(/<circle[^>]*>/g) ?? [];
    expect(circles.length).toBe(2);                     // iz + ilerleme
    for (const c of circles) {
      expect(c).not.toMatch(/\s(fill|stroke)=/);
      expect(c).toMatch(/stroke-width:8/);
    }
  });

  /* Açık tema kontrast denetimiyle (gerçek uygulama, 17 ekran × gece/gündüz/
     güneş) okunmaz bulunup --oem-ink* token'larına taşınan yüzeyler. */
  it.each([
    'src/components/trip/TripLogView.tsx',
    'src/components/trip/EcoReportCard.tsx',
    'src/components/trip/EcoScoreCard.tsx',
    'src/components/map/MapHudControls.tsx',
    'src/components/map/MiniMapWidget.tsx',
    'src/components/climate/ClimateScreen.tsx',
    'src/components/entertainment/EntertainmentPortal.tsx',
    'src/components/apps/AppGrid.tsx',
    'src/components/obd/DTCPanel.tsx',
  ])('🔒 %s gri metinde text-slate-* KULLANMAZ (kanonik --oem-ink* token)', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(src).not.toMatch(/text-slate-\d+/);
  });

  it('🔒 Eğlence portalı kart yüzeyinde koyu tema için sabit açık yazı/zemin taşımaz', () => {
    const src = readFileSync(resolve(SRC, 'components/entertainment/EntertainmentPortal.tsx'), 'utf8');
    /* Pastel başlıklar + açık gri etiketler + sabit koyu panel zemini. Renkli
       düğme üstündeki '#fff' ve bilinçli koyu mola uyarısı bu kilidin DIŞINDA. */
    /* '#94a3b8' listede YOK: koyu zeminli BreakAlertOverlay'de meşru kullanılıyor. */
    for (const hex of ["'#d1fae5'", "'#ede9fe'", "'#fef3c7'", "'#e2e8f0'"]) {
      expect(src, hex).not.toContain(`color: ${hex}`);
    }
    expect(src).not.toMatch(/DARK_BG/);
  });
});
