/**
 * CAROS LAB — "TÜMÜNÜ YENİLE" kilitleri.
 *
 * NE KORUR:
 *  1. Tek tuş EN AZ 5 bölümü tazeler (kabul ölçütü) ve sırası native-önce'dir.
 *  2. Başarısız bölüm SESSİZCE ATLANMAZ — hüküm KISMİ olur ve bölüm ADIYLA çıkar.
 *  3. "KAYNAK YOK" ile "OKUNAMADI" AYRI kalır (boş ≠ veri yoktu).
 *  4. Tur SALT-OKUNURDUR: bağlantı kurma / yeniden bağlanma / araca komut YOK.
 *  5. Yeniden giriş yok (oto tetik + elle tetik üst üste binmez).
 *  6. Asılı bir çağrı turu kilitlemez (süre aşımı) ve tur DEVAM eder.
 *  7. Saf model saflığını korur (Date.now · timer · React YOK).
 *  8. Otomatik tur LAB'a bağlıdır ve unmount/arka planda DURUR (yapısal kilit).
 *
 * ⚠️ DÜRÜST SINIR: bu repoda `@testing-library/react` YOK ve jsdom'da
 * `react-dom/client` createRoot çalışmıyor → `renderToStaticMarkup` EFFECT
 * ÇALIŞTIRMAZ. "Interval gerçekten kuruldu/temizlendi mi" burada RUNTIME'da
 * ölçülemez; o kilitler YAPISALDIR ve cihaz gerçeği saha kütüğünde 🔴 maddedir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CAROS_LAB_REFRESH_SECTIONS, CAROS_LAB_REFRESH_STATUS_LABEL,
  CAROS_LAB_REFRESH_VERDICT_LABEL, formatRefreshAge, initialRefreshRun,
  pickAutoRefreshIntervalMs, refreshStatusTone, summarizeRefreshRun,
  type CarosLabRefreshProbe, type CarosLabRefreshSectionId, type CarosLabRefreshStatus,
} from '../platform/devtools/carosLabRefreshModel';

/* Kaynak katmanı MOCK'lanır: bu dosya orkestrasyonu ölçer, gerçek OBD/GPS
   yığınını değil (gerçek okuma yolları kendi ekran testlerinde kilitlidir). */
const h = vi.hoisted(() => ({
  probe: vi.fn<(id: string) => Promise<{ status: string; detail: string }>>(),
}));
vi.mock('../platform/devtools/carosLabRefreshSources', () => ({
  probeRefreshSection: h.probe,
}));

import {
  CAROS_LAB_REFRESH_TIMEOUT_MS, getCarosLabAutoRefreshMs, getCarosLabRefreshRun,
  runCarosLabRefreshAll, subscribeCarosLabRefresh, _resetCarosLabRefreshForTest,
} from '../platform/devtools/carosLabRefreshRuntime';

import { CarosLabRefreshBar } from '../components/devtools/CarosLabRefreshBar';

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODEL_PATH   = 'src/platform/devtools/carosLabRefreshModel.ts';
const SOURCES_PATH = 'src/platform/devtools/carosLabRefreshSources.ts';
const RUNTIME_PATH = 'src/platform/devtools/carosLabRefreshRuntime.ts';
const BAR_PATH     = 'src/components/devtools/CarosLabRefreshBar.tsx';
const SHELL_PATH   = 'src/components/devtools/CarosLabShell.tsx';

const okProbe = (id: string): CarosLabRefreshProbe => ({ status: 'REFRESHED', detail: `ok:${id}` });

beforeEach(() => {
  _resetCarosLabRefreshForTest();
  h.probe.mockReset();
  h.probe.mockImplementation(async (id: string) => okProbe(id));
});

afterEach(() => { vi.useRealTimers(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Kapsam (kabul ölçütü)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — tek tuşun kapsamı', () => {
  it('en az 5 bölüm tazelenir ve kabul ölçütündeki beşi kapsamdadır', () => {
    expect(CAROS_LAB_REFRESH_SECTIONS.length).toBeGreaterThanOrEqual(5);
    const ids = CAROS_LAB_REFRESH_SECTIONS.map((s) => s.id);
    for (const required of [
      'native-poll-evidence',   // native sayaç (#523)
      'location-engine',        // konum kanıt otoritesi (#508)
      'poll-scheduler',         // poll zamanlayıcı / eleme kanıtı
      'address-search',         // adres arama kanıtı
      'eta-jump-ledger',        // ETA sıçrama defteri
    ] as CarosLabRefreshSectionId[]) {
      expect(ids, `kabul ölçütündeki bölüm düşmüş: ${required}`).toContain(required);
    }
  });

  it('bölüm id\'leri BENZERSİZ ve her birinin Türkçe adı + ekran izi var', () => {
    const ids = CAROS_LAB_REFRESH_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of CAROS_LAB_REFRESH_SECTIONS) {
      expect(s.label.length, `${s.id} etiketsiz`).toBeGreaterThan(0);
      expect(s.screen.length, `${s.id} ekran izi yok`).toBeGreaterThan(0);
    }
  });

  it('SIRA: native sayaç okumaları, onları OKUYAN türetilmiş bölümlerden ÖNCE gelir', () => {
    const ids = CAROS_LAB_REFRESH_SECTIONS.map((s) => s.id);
    expect(ids.indexOf('native-poll-evidence')).toBeLessThan(ids.indexOf('poll-scheduler'));
    expect(ids.indexOf('native-elimination')).toBeLessThan(ids.indexOf('poll-scheduler'));
  });

  it('KAPSAM DIŞI: yeniden bağlanma / araca yazan bölüm KATALOĞA GİRMEZ', () => {
    const ids = CAROS_LAB_REFRESH_SECTIONS.map((s) => String(s.id));
    for (const banned of ['reconnect', 'connect', 'pair', 'experiment', 'ha-', 'write']) {
      expect(ids.some((i) => i.includes(banned)), `kapsam dışı bölüm eklenmiş: ${banned}`)
        .toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 — Saf model
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — saf model saflığı ve dürüstlüğü', () => {
  it('model I/O · timer · Date.now · React BARINDIRMAZ', () => {
    const src = stripComments(read(MODEL_PATH));
    for (const banned of [
      'Date.now', 'setInterval', 'setTimeout', 'requestAnimationFrame',
      'from \'react\'', 'localStorage', 'fetch(', 'Capacitor', 'await ',
    ]) {
      expect(src, `saf model ${banned} kullanıyor`).not.toContain(banned);
    }
  });

  it('her durum ve hükmün Türkçe etiketi VARDIR (yoksa ekranda undefined basar)', () => {
    const statuses: CarosLabRefreshStatus[] =
      ['PENDING', 'RUNNING', 'REFRESHED', 'UNAVAILABLE', 'FAILED', 'TIMEOUT'];
    for (const s of statuses) {
      expect(typeof CAROS_LAB_REFRESH_STATUS_LABEL[s]).toBe('string');
      expect(CAROS_LAB_REFRESH_STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(['ok', 'muted', 'warn', 'bad']).toContain(refreshStatusTone(s));
    }
    for (const v of ['NEVER_RUN', 'RUNNING', 'ALL_REFRESHED', 'PARTIAL', 'NONE_REFRESHED'] as const) {
      expect(CAROS_LAB_REFRESH_VERDICT_LABEL[v].length).toBeGreaterThan(0);
    }
  });

  it('"KAYNAK YOK" ile "OKUNAMADI" AYRI tonlardır (biri sorun, öteki hata)', () => {
    expect(refreshStatusTone('UNAVAILABLE')).toBe('muted');
    expect(refreshStatusTone('FAILED')).toBe('bad');
    expect(refreshStatusTone('TIMEOUT')).toBe('warn');
    expect(CAROS_LAB_REFRESH_STATUS_LABEL.UNAVAILABLE)
      .not.toBe(CAROS_LAB_REFRESH_STATUS_LABEL.FAILED);
  });

  it('hüküm: hiç çalışmadı / tümü / kısmi / hiçbiri doğru ayrışır', () => {
    const base = initialRefreshRun();
    expect(summarizeRefreshRun(base).verdict).toBe('NEVER_RUN');

    const all = { ...base, cycle: 1, results: base.results.map((r) => ({ ...r, status: 'REFRESHED' as const })) };
    expect(summarizeRefreshRun(all).verdict).toBe('ALL_REFRESHED');

    const none = { ...base, cycle: 1, results: base.results.map((r) => ({ ...r, status: 'UNAVAILABLE' as const })) };
    expect(summarizeRefreshRun(none).verdict).toBe('NONE_REFRESHED');

    const mixed = {
      ...base, cycle: 1,
      results: base.results.map((r, i) => ({ ...r, status: (i === 0 ? 'FAILED' : 'REFRESHED') as CarosLabRefreshStatus })),
    };
    const su = summarizeRefreshRun(mixed);
    expect(su.verdict).toBe('PARTIAL');
    expect(su.failed).toBe(1);
    expect(su.problemIds).toEqual([base.results[0].id]);

    expect(summarizeRefreshRun({ ...all, running: true }).verdict).toBe('RUNNING');
  });

  it('yaş biçimi: bilinmeyen zaman "hiç" der (sahte tarih YOK)', () => {
    expect(formatRefreshAge(null, 1_000)).toBe('hiç');
    expect(formatRefreshAge(1_000, 1_500)).toContain('ms');
    expect(formatRefreshAge(0, 5_000)).toContain('sn');
    expect(formatRefreshAge(0, 120_000)).toContain('dk');
  });

  it('oto aralık cihaz sınıfına abonedir ve sıcak yola girmez (≥30 sn)', () => {
    const low = pickAutoRefreshIntervalMs('low');
    const mid = pickAutoRefreshIntervalMs('mid');
    const high = pickAutoRefreshIntervalMs('high');
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    for (const v of [low, mid, high]) expect(v).toBeGreaterThanOrEqual(30_000);
    expect(getCarosLabAutoRefreshMs()).toBeGreaterThanOrEqual(30_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 — Koşum davranışı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — tur davranışı', () => {
  it('tek tuş TÜM bölümleri tazeler ve tur sayacı ilerler', async () => {
    const run = await runCarosLabRefreshAll('manual');
    expect(h.probe).toHaveBeenCalledTimes(CAROS_LAB_REFRESH_SECTIONS.length);
    expect(run.running).toBe(false);
    expect(run.cycle).toBe(1);
    expect(run.trigger).toBe('manual');
    expect(summarizeRefreshRun(run).verdict).toBe('ALL_REFRESHED');
    for (const r of run.results) {
      expect(r.status).toBe('REFRESHED');
      expect(r.okAtMs).not.toBeNull();
      expect(r.durationMs).not.toBeNull();
    }
  });

  it('otomatik tur da aynı yolu kullanır ve "son güncelleme" İLERLER', async () => {
    const first = await runCarosLabRefreshAll('manual');
    const t1 = first.finishedAtMs;
    await new Promise((r) => setTimeout(r, 2));
    const second = await runCarosLabRefreshAll('auto');
    expect(second.cycle).toBe(2);
    expect(second.trigger).toBe('auto');
    expect(second.finishedAtMs!).toBeGreaterThanOrEqual(t1!);
  });

  it('BAŞARISIZ bölüm sessizce ATLANMAZ: tur devam eder, hüküm KISMİ olur', async () => {
    h.probe.mockImplementation(async (id: string) =>
      (id === 'location-engine'
        ? { status: 'FAILED', detail: 'okuma patladı' }
        : okProbe(id)));

    const run = await runCarosLabRefreshAll('manual');
    // Tur DURMADI — geri kalan bölümler yine okundu.
    expect(h.probe).toHaveBeenCalledTimes(CAROS_LAB_REFRESH_SECTIONS.length);
    const bad = run.results.find((r) => r.id === 'location-engine')!;
    expect(bad.status).toBe('FAILED');
    expect(bad.detail).toContain('patladı');
    expect(bad.okAtMs).toBeNull();

    const su = summarizeRefreshRun(run);
    expect(su.verdict).toBe('PARTIAL');
    expect(su.problemIds).toContain('location-engine');
  });

  it('prob FIRLATIRSA tur çökmez — o bölüm OKUNAMADI olur', async () => {
    h.probe.mockImplementation(async (id: string) => {
      if (id === 'kwp-recovery') throw new Error('native patladı');
      return okProbe(id);
    });
    const run = await runCarosLabRefreshAll('manual');
    const bad = run.results.find((r) => r.id === 'kwp-recovery')!;
    expect(bad.status).toBe('FAILED');
    expect(bad.detail).toContain('native patladı');
    expect(summarizeRefreshRun(run).refreshed).toBe(CAROS_LAB_REFRESH_SECTIONS.length - 1);
  });

  it('"son BAŞARI" damgası yalnız gerçekten tazelenince ilerler', async () => {
    const first = await runCarosLabRefreshAll('manual');
    const okAt = first.results.find((r) => r.id === 'address-search')!.okAtMs!;
    expect(okAt).not.toBeNull();

    h.probe.mockImplementation(async (id: string) =>
      (id === 'address-search'
        ? { status: 'UNAVAILABLE', detail: 'defterde kayıt yok' }
        : okProbe(id)));
    const second = await runCarosLabRefreshAll('manual');
    const r = second.results.find((x) => x.id === 'address-search')!;
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.okAtMs, 'başarısız turda son-başarı damgası ilerlemiş').toBe(okAt);
    expect(r.attemptedAtMs!, 'deneme damgası ilerlemedi').toBeGreaterThanOrEqual(okAt);
  });

  it('YENİDEN GİRİŞ YOK: eşzamanlı iki tetik TEK tur koşar', async () => {
    const a = runCarosLabRefreshAll('auto');
    const b = runCarosLabRefreshAll('manual');
    expect(a).toBe(b);
    await a;
    expect(h.probe).toHaveBeenCalledTimes(CAROS_LAB_REFRESH_SECTIONS.length);
  });

  it('ASILI çağrı turu KİLİTLEMEZ — bölüm ZAMAN AŞIMI olur, tur sürer', async () => {
    vi.useFakeTimers();
    h.probe.mockImplementation((id: string) =>
      (id === 'native-poll-evidence'
        ? new Promise(() => { /* asla çözülmez */ })
        : Promise.resolve(okProbe(id))));

    const p = runCarosLabRefreshAll('manual');
    await vi.advanceTimersByTimeAsync(CAROS_LAB_REFRESH_TIMEOUT_MS + 50);
    const run = await p;

    const hung = run.results.find((r) => r.id === 'native-poll-evidence')!;
    expect(hung.status).toBe('TIMEOUT');
    expect(hung.detail).toContain('Süre aşımı');
    // Geri kalan bölümler YİNE okundu.
    expect(h.probe).toHaveBeenCalledTimes(CAROS_LAB_REFRESH_SECTIONS.length);
    expect(summarizeRefreshRun(run).problemIds).toContain('native-poll-evidence');
    expect(run.running).toBe(false);
  });

  it('abonelik: tur ilerledikçe bildirir ve KALDIRILABİLİR (zero-leak)', async () => {
    const seen: number[] = [];
    const off = subscribeCarosLabRefresh((r) => seen.push(r.cycle));
    await runCarosLabRefreshAll('manual');
    expect(seen.length).toBeGreaterThan(1);
    off();
    const before = seen.length;
    await runCarosLabRefreshAll('manual');
    expect(seen.length, 'abonelik kaldırılmasına rağmen bildirim geldi').toBe(before);
  });

  it('patlayan bir abone diğerlerini SESSİZLEŞTİRMEZ', async () => {
    const good = vi.fn();
    subscribeCarosLabRefresh(() => { throw new Error('abone patladı'); });
    subscribeCarosLabRefresh(good);
    await expect(runCarosLabRefreshAll('manual')).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
  });

  it('başlangıç durumu hüküm VERMEZ (her bölüm BEKLİYOR)', () => {
    const run = getCarosLabRefreshRun();
    expect(run.cycle).toBe(0);
    expect(run.results.every((r) => r.status === 'PENDING')).toBe(true);
    expect(summarizeRefreshRun(run).verdict).toBe('NEVER_RUN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 — SALT-OKUNUR sınırı (yapısal)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — tur SALT-OKUNURDUR', () => {
  it('kaynak katmanı komut / bağlantı / motor yüzeyine DOKUNMAZ', () => {
    const src = stripComments(read(SOURCES_PATH));
    for (const banned of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnect(', 'startPolling',
      'performHandshake', 'startDeepScan', 'startScan', 'clearDTC', 'clearDtc',
      'setCollecting', 'setDiagnosticBurst', 'startNavigation', 'stopNavigation',
      'fetchRoute', 'startLocationEngine', 'stopLocationEngine', 'watchPosition',
      'getLiveDiscoveryCoordinator',
    ]) {
      expect(src, `SALT-OKUNUR ihlali: ${banned}`).not.toContain(banned);
    }
  });

  it('kaynak katmanı yeni timer / abonelik KURMAZ', () => {
    const src = stripComments(read(SOURCES_PATH));
    for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', '.subscribe(', 'addListener']) {
      expect(src, `kaynak katmanında ${banned} var`).not.toContain(banned);
    }
  });

  it('koşucu YALNIZ süre aşımı zamanlayıcısı kurar ve HER YOLDA temizler', () => {
    const src = stripComments(read(RUNTIME_PATH));
    expect(src, 'koşucu periyodik timer kuruyor — sahibi ekran olmalı').not.toContain('setInterval');
    expect(src).toContain('clearTimeout(timer)');
    // Süre aşımı kesin bir üst sınırdır, sonsuz bekleme YOK.
    expect(CAROS_LAB_REFRESH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CAROS_LAB_REFRESH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it('kaynak katmanı native SAYAÇ uçlarını kullanır (kanıt gerçekten tazelenir)', () => {
    const src = stripComments(read(SOURCES_PATH));
    for (const required of [
      'refreshExtendedPollEvidence', 'refreshExtendedElimination',
      'refreshKwpRecoveryEvidence', 'readSchedRawSnapshot',
      'readLocationEngineSnapshot', 'getFixAgeLedger', 'getEtaJumpLedger',
      'readAddressSearchSnapshot', 'readNavigationCoreSnapshot',
    ]) {
      expect(src, `kanıt ucu düşmüş: ${required}`).toContain(required);
    }
  });

  it('GİZLİLİK: kaynak katmanı koordinat / adres metni / VIN TAŞIMAZ', () => {
    const src = stripComments(read(SOURCES_PATH));
    for (const banned of ['latitude', 'longitude', '.lat', '.lon', 'vin', 'destinationName', 'query']) {
      expect(src, `LAB'a gizli veri taşınıyor: ${banned}`).not.toContain(banned);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Ekran bağlantısı ve yaşam döngüsü (yapısal)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — LAB entegrasyonu ve yaşam döngüsü', () => {
  it('çubuk shell\'e BAĞLI (LAB açılınca görünür, kapanınca sökülür)', () => {
    const shell = read(SHELL_PATH);
    expect(shell, 'TÜMÜNÜ YENİLE çubuğu shell\'den kaldırılmış').toContain('<CarosLabRefreshBar />');
    expect(shell).toContain("from './CarosLabRefreshBar'");
  });

  it('periyodik turun SAHİBİ çubuktur ve cleanup MUTLAKA temizler', () => {
    const src = stripComments(read(BAR_PATH));
    expect(src).toMatch(/setInterval\(/);
    expect(src, 'interval temizlenmiyor — LAB kapanınca sızar').toMatch(/clearInterval\(timer\)/);
    expect(src, 'cleanup dönüşü yok').toMatch(/return \(\) => \{/);
    // Arka plana atılınca DURUR, öne gelince devam eder.
    expect(src).toContain('visibilitychange');
    expect(src).toContain('removeEventListener');
    expect(src).toContain("document.visibilityState === 'hidden'");
  });

  it('unmount sonrası setState YASAK — mountedRef kapısı vardır', () => {
    const src = stripComments(read(BAR_PATH));
    expect(src).toMatch(/mountedRef\.current = false/);
    expect(src).toMatch(/if \(!mountedRef\.current\) return;/);
  });

  it('çubuk araca komut GÖNDERMEZ (yalnız tur tetikler)', () => {
    const src = stripComments(read(BAR_PATH));
    for (const banned of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnect(', 'startDeepScan',
      'clearDTC', 'setCollecting', 'startNavigation',
    ]) {
      expect(src, `çubukta komut yüzeyi: ${banned}`).not.toContain(banned);
    }
  });

  it('ilk markup dürüsttür: hüküm vermez, salt-okunurluğu BEYAN eder', () => {
    const html = renderToStaticMarkup(<CarosLabRefreshBar />);
    expect(html).toContain('TÜMÜNÜ YENİLE');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('bağlantı kurmaz');
    // Hiç çalışmadan "tazelendi" DEMEZ.
    expect(html).toContain(CAROS_LAB_REFRESH_VERDICT_LABEL.NEVER_RUN);
    expect(html).toContain('data-testid="lab-refresh-all"');
  });

  it('ekran OEM token kullanır (sabit renk YOK — aydınlık temada da okunur)', () => {
    const src = stripComments(read(BAR_PATH));
    expect(src).not.toMatch(/\btext-white\b/);
    expect(src).not.toMatch(/\bbg-\[#[0-9a-fA-F]{3,8}\]/);
    expect(src).not.toContain('--oem-ink-4');
    expect(src).toContain('--oem-good');
    expect(src).toContain('--oem-danger');
  });
});
