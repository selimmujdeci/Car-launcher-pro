/**
 * REGRESYON KASASI (2026-06-13) — "Yasa".
 *
 * Bu dosya, defalarca bozulup tekrar düzelttiğimiz davranışları KİLİTLER.
 * Biri (insan veya AI) bu düzeltmeleri bozan bir değişiklik yaparsa
 * `npm run test` KIRMIZI yanar → APK çıkmadan yakalanır.
 *
 * İki tür kilit:
 *  1) Davranış testi   — saf fonksiyon / store davranışı (en sağlam).
 *  2) Yapısal değişmez — kaynak/CSS deseninin varlığı (gömülü mantık için;
 *     desen geri alınırsa test düşer). Her birinin NEDEN'i yorumda.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/* ───────────────────────────────────────────────────────────────
   1. BUKALEMUN EKRAN UYUMU — ChameleonScaler ölçek matematiği
   Regresyon: ekran adaptasyonu defalarca bozuldu (boşluk/taşma).
   ─────────────────────────────────────────────────────────────── */
describe('ChameleonScaler ölçek matematiği (ekran adaptasyonu kilidi)', () => {
  // Dinamik import: bileşen DOM'a dokunmadan saf fonksiyonu alır.
  it('head unit (~1024×600) → ölçek ≈ 1.0 (dokunma yok)', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    expect(computeChameleonScale(1024, 600)).toBeCloseTo(1.0, 2);
  });
  it('kısa/geniş telefon (986×444) → küçülür (<1) ki dikey taşma olmasın', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    const s = computeChameleonScale(986, 444);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThanOrEqual(0.55);
  });
  it('büyük tablet (1280×800) → büyür (>1) ama ≤ 1.6', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    const s = computeChameleonScale(1280, 800);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThanOrEqual(1.6);
  });
  it('uç değerler kısıtlı: çok küçük ≥0.55, çok büyük ≤1.6, geçersiz → 1', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    expect(computeChameleonScale(200, 150)).toBeGreaterThanOrEqual(0.55);
    expect(computeChameleonScale(4000, 3000)).toBeLessThanOrEqual(1.6);
    expect(computeChameleonScale(0, 0)).toBe(1);
    expect(computeChameleonScale(NaN, 600)).toBe(1);
  });
  it('YAPISAL: ChameleonScaler yalnız NewHomeLayout sarmalı (güvenlik overlay\'leri ölçek DIŞI)', () => {
    const src = read('src/components/layout/MainLayout.tsx');
    expect(src).toMatch(/<ChameleonScaler>[\s\S]*<NewHomeLayout/);
  });
  it('YAPISAL: zoom KULLANILMAZ (tutarsızdı); transform: scale kullanılır', () => {
    const src = read('src/components/layout/ChameleonScaler.tsx');
    expect(src).toMatch(/transform:\s*`scale/);
    expect(src).not.toMatch(/\.zoom\s*=/);
  });
});

/* ───────────────────────────────────────────────────────────────
   2. TEMA GEÇERLİLİĞİ — setTheme render edilemeyen temayı normalize eder
   Regresyon: sesli "tema değiştir" silinmiş/yetim temayı (sunlight/mercedes)
   açıyordu → fallback layout.
   ─────────────────────────────────────────────────────────────── */
describe('setTheme normalizasyonu (geçersiz tema açılamaz kilidi)', () => {
  beforeEach(() => {
    // her testte bilinen geçerli temaya dön
    // (store DOM'a dokunur; jsdom'da güvenli)
  });
  it('sunlight → pro (sunlight render edilemez)', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    useCarTheme.getState().setTheme('sunlight');
    expect(useCarTheme.getState().theme).toBe('pro');
  });
  it('kaldırılan temalar (mercedes/audi/cockpit) → expedition', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    for (const dead of ['mercedes', 'audi', 'cockpit']) {
      useCarTheme.getState().setTheme(dead as never);
      expect(useCarTheme.getState().theme).toBe('expedition');
    }
  });
  it('geçerli temalar KORUNUR (tesla / expedition-day / horizon)', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    for (const ok of ['tesla', 'expedition-day', 'horizon'] as const) {
      useCarTheme.getState().setTheme(ok);
      expect(useCarTheme.getState().theme).toBe(ok);
    }
  });
  it('YAPISAL: sesli tema cycle listesi sunlight İÇERMEZ', () => {
    const src = read('src/hooks/useVoiceCommandHandler.ts');
    const m = src.match(/_THEME_CYCLE[^=]*=\s*\[([^\]]*)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toMatch(/sunlight/);
  });
});

/* ───────────────────────────────────────────────────────────────
   3. SAAT GÜN/GECE — kanonik kaynak (data-day-night), ayrışma yok
   Regresyon: dock saati gündüz temada koyu kalıyordu (settings.dayNightMode
   ile data-day-night ayrışması).
   ─────────────────────────────────────────────────────────────── */
describe('Saat gün/gece kanonik kaynak kilidi', () => {
  it('YAPISAL: 3 tema da pal\'i useDayNightAttr (data-day-night) ile türetir', () => {
    for (const f of ['TeslaLayout', 'ExpeditionLayout', 'HorizonLayout']) {
      const src = read(`src/components/themes/${f}.tsx`);
      expect(src, `${f} useDayNightAttr kullanmalı`).toMatch(/useDayNightAttr\(\)/);
      // settings.dayNightMode'a geri dönülmemeli (ayrışma kaynağı)
      expect(src, `${f} pal için settings.dayNightMode kullanmamalı`)
        .not.toMatch(/dayNightMode\s*=\s*useStore\(s => s\.settings\.dayNightMode\)[\s\S]{0,80}\?\s*(SAND|DAY|DAY_H)/);
    }
  });
  it('YAPISAL: saat etrafındaki SİYAH DİKDÖRTGEN — sunlight border muafiyeti var', () => {
    const css = read('src/index.css');
    // .sunlight-mode button[aria-label="Saat — Menü"] { border: none }
    expect(css).toMatch(/aria-label="Saat — Menü"[\s\S]{0,120}border:\s*none/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4. SESLİ ROTA — kendi haritamız (harici Google Maps DEĞİL)
   Regresyon: "rota oluştur" AI yolunda harici nav app açıyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli navigasyon uygulama-içi kilidi', () => {
  it('YAPISAL: commandExecutor OPEN_NAVIGATION harici bridge.launchNavigation kullanmaz', () => {
    const src = read('src/platform/commandExecutor.ts');
    const block = src.slice(src.indexOf("case 'OPEN_NAVIGATION'"), src.indexOf("case 'OPEN_NAVIGATION'") + 220);
    expect(block).toMatch(/ctx\.launch\(/);
    expect(block).not.toMatch(/bridge\.launchNavigation/);
  });
});

/* ───────────────────────────────────────────────────────────────
   5. REROUTE — yoğun ızgarada sahte yeniden-rotalama önlemi
   Regresyon: rota sürekli sıfırlanıp "Yola çıkın"a dönüyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Reroute sahte-tetik önlemi kilidi', () => {
  it('YAPISAL: sapma eşiği GPS hata payına duyarlı + ≥3 ardışık tick', () => {
    const src = read('src/platform/routingService.ts');
    expect(src).toMatch(/REROUTE_THRESHOLD_M\s*\+\s*Math\.min\(accuracy/);
    expect(src).toMatch(/_deviationCounter\s*>=\s*3/);
  });
});
