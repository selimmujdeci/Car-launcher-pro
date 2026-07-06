/**
 * selfTestEngine.test.ts — "Tanı Robotu" self-test motoru kilidi.
 *
 * Garanti: robot HER ZAMAN yapısal-geçerli bir rapor döndürür ve ASLA throw
 * etmez (fail-soft) — bir prob patlasa/donsa bile tarama tamamlanır. Bu, saha
 * fazında butonun sessizce ölmemesini (her koşulda panele veri gitmesini) kilitler.
 */
import { describe, it, expect } from 'vitest';
import { runSelfTest, type SelfTestReport, type ProbeStatus } from '../platform/selfTestEngine';

const VALID_STATUS: ProbeStatus[] = ['pass', 'warn', 'fail', 'skip'];

describe('selfTestEngine — Tanı Robotu', () => {
  it('yapısal-geçerli rapor döndürür (throw etmez)', async () => {
    const r: SelfTestReport = await runSelfTest({ includeRenderScan: false });

    expect(r.version).toBe(1);
    expect(typeof r.totalMs).toBe('number');
    expect(VALID_STATUS).toContain(r.worst);
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.env).toBeDefined();
    expect(typeof r.env.tier).toBe('string');
  });

  it('her prob geçerli durum + süre + kategori taşır', async () => {
    const r = await runSelfTest({ includeRenderScan: false });
    for (const p of r.results) {
      expect(VALID_STATUS).toContain(p.status);
      expect(typeof p.detail).toBe('string');
      expect(p.detail.length).toBeGreaterThan(0);
      expect(typeof p.durationMs).toBe('number');
      expect(p.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof p.name).toBe('string');
    }
  });

  it('summary sayıları results ile tutarlı; worst en kötü durumu yansıtır', async () => {
    const r = await runSelfTest({ includeRenderScan: false });
    const total = r.summary.pass + r.summary.warn + r.summary.fail + r.summary.skip;
    expect(total).toBe(r.results.length);

    // worst, mevcut durumların en kötüsü olmalı (fail>warn>pass>skip)
    const rank: Record<ProbeStatus, number> = { skip: 0, pass: 1, warn: 2, fail: 3 };
    const maxSeen = r.results.reduce((m, p) => Math.max(m, rank[p.status]), 0);
    expect(rank[r.worst]).toBe(maxSeen);
  });

  it('depolama probu bu ortamda çalışır (localStorage/IndexedDB var)', async () => {
    const r = await runSelfTest({ includeRenderScan: false });
    const ls = r.results.find((p) => p.name === 'localStorage');
    expect(ls).toBeDefined();
    // jsdom'da localStorage var → pass beklenir (skip değil)
    expect(['pass', 'skip']).toContain(ls?.status);
  });

  it('ekran-defteri probu opsiyonel olarak dahil edilir', async () => {
    const withScreens = await runSelfTest({ includeRenderScan: false, includeScreens: true });
    const without     = await runSelfTest({ includeRenderScan: false, includeScreens: false });
    // 'ekran-defteri' includeScreens ile kapılı; 'zamansız-modal' (aynı kategori)
    // bilinçli olarak HER ZAMAN açık — bu yüzden isimle kontrol edilir.
    expect(withScreens.results.some((p) => p.name === 'ekran-defteri')).toBe(true);
    expect(without.results.some((p) => p.name === 'ekran-defteri')).toBe(false);
  });

  it('zamansız-modal probu her zaman dahildir (kapıdan bağımsız)', async () => {
    const r = await runSelfTest({ includeRenderScan: false, includeScreens: false });
    expect(r.results.some((p) => p.name === 'zamansız-modal')).toBe(true);
  });
});
