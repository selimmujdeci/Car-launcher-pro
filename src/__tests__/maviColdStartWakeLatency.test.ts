/**
 * maviColdStartWakeLatency.test.ts — **İLK AÇILIŞTA WAKE GECİKMESİ.**
 *
 * ── SAHA BELİRTİSİ ──────────────────────────────────────────────────────────
 * *"Uygulama ilk açıldığında Mavi hemen dinlemeye başlamıyor; UI açık olsa bile
 * 'Hey Mavi' bir süre çalışmıyor, bir müddet sonra devreye giriyor."*
 *
 * ── ÖLÇÜLEN KÖK NEDEN ───────────────────────────────────────────────────────
 * Native'de pasif dinleme `wakeWordService._voskReady` kapısının arkasındadır ve
 * o kapıyı YALNIZ `notifyVoskModelReady()` açar. `SystemBoot` bu ısıtmayı DÜZ BİR
 * DUVAR SAATİNE bağlamıştı: `setTimeout(..., 30_000)`. Yani sistem çoktan boşta
 * olsa bile kapı 30 sn'den önce AÇILAMIYORDU; üstüne modelin kendi unpack+load
 * süresi biniyordu.
 *
 * 30 sn'nin gerekçesi SÜRE değil SİSTEMİN OTURMASIYDI (PERF 2026-06-11: erken
 * unpack, boot I/O + ilk render + OBD/CAN ile yarışıp Capacitor Bridge'i
 * tıkıyordu). Aynı niyet artık mevcut sahibine sorulur: `bootDeferral` `IDLE`
 * tetiği — `requestIdleCallback` ile GERÇEK boşluk, kendi üst sınırıyla.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Kilitleri ZAYIFLATMA/SİLME. Burada kilitlenen şey "şu kadar hızlı olsun"
 * DEĞİL, **kapının duvar saatine değil boşluk sinyaline bağlı olduğudur**.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...seg: string[]): string =>
  readFileSync(join(process.cwd(), 'src', ...seg), 'utf8');
/** Yorumlar SÖKÜLÜR — kilitler koda bakar, prozaya değil. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const BOOT_SRC = codeOnly(read('platform', 'system', 'SystemBoot.ts'));
const DEFER_SRC = read('platform', 'boot', 'bootDeferral.ts');

/** Eski davranışın sabiti — kilit bunun GERİ GELMEDİĞİNİ sınar. */
const OLD_WALL_CLOCK_MS = 30_000;

/* ══════════════════════════════════════════════════════════════════════════
 * A · BOOT TARAFI — kapı duvar saatine BAĞLI DEĞİL
 * ════════════════════════════════════════════════════════════════════════ */

describe('Cold start · Vosk ısıtması boşluk sinyaline bağlı', () => {
  it('çapa: SystemBoot gerçekten Vosk ısıtmasını ve wake kapısını yönetiyor', () => {
    expect(BOOT_SRC).toContain('preloadVoskModel');
    expect(BOOT_SRC).toContain('notifyVoskModelReady');
  });

  it('ısıtma `bootDeferral` IDLE tetiğiyle kurulur (yeni scheduler YOK)', () => {
    const job = /bootDeferral\.schedule\(\{[^}]*?jobId:\s*'VoskPreload'[\s\S]*?\}\)/.exec(BOOT_SRC);
    expect(job, 'VoskPreload artık bootDeferral ile kurulmuyor').not.toBeNull();
    expect(job![0]).toMatch(/trigger:\s*'IDLE'/);
    expect(job![0]).toMatch(/bootClass:\s*'IDLE_ONLY'/);
  });

  it('30 sn duvar saati GERİ GELMEDİ', () => {
    /* Preload'ı geciktiren düz `setTimeout(..., 30_000)` kalıbı yasak. */
    const wall = new RegExp('setTimeout\\([\\s\\S]{0,400}?preloadVoskModel[\\s\\S]{0,400}?'
      + OLD_WALL_CLOCK_MS.toString().replace('000', '_000'));
    expect(wall.test(BOOT_SRC), 'preload yine duvar saatine bağlanmış').toBe(false);
    expect(BOOT_SRC).not.toMatch(/preloadVoskModel[\s\S]{0,300}?\}, 30_000\)/);
  });

  it('fail-soft KORUNDU: preload patlasa da kapı açılır (sağır kalmaz)', () => {
    const job = /jobId:\s*'VoskPreload'[\s\S]*?\n {8}\}\);/.exec(BOOT_SRC);
    expect(job).not.toBeNull();
    expect(job![0], 'hata dalı yok').toMatch(/catch/);
    /* `notifyVoskModelReady()` try/catch'in DIŞINDA, yani her iki dalda da çalışır. */
    expect(job![0]).toMatch(/catch[\s\S]*?\}\s*notifyVoskModelReady\(\)/);
  });

  it('ÖLÇÜM · yeni üst sınır eski duvar saatinden BELİRGİN küçük', () => {
    const ric = Number(/timeout:\s*([\d_]+)/.exec(DEFER_SRC)?.[1].replace(/_/g, ''));
    const fallback = Number(/setTimeout\(fn,\s*([\d_]+)\)/.exec(DEFER_SRC)?.[1].replace(/_/g, ''));
    expect(ric, 'requestIdleCallback üst sınırı okunamadı').toBeGreaterThan(0);
    expect(fallback, 'idle yedeği okunamadı').toBeGreaterThan(0);
    expect(ric).toBeLessThan(OLD_WALL_CLOCK_MS);       // 10_000 < 30_000
    expect(fallback).toBeLessThan(ric);                //  1_000 < 10_000
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · DAVRANIŞ — IDLE işi gerçekten koşar, TEK KEZ koşar
 * ════════════════════════════════════════════════════════════════════════ */

describe('bootDeferral · IDLE işi', () => {
  let defer: typeof import('../platform/boot/bootDeferral');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    defer = await import('../platform/boot/bootDeferral');
    defer._resetBootDeferralForTest();
  });
  afterEach(() => {
    defer._resetBootDeferralForTest();
    vi.useRealTimers();
  });

  it('A · cold start: iş üst sınır içinde koşar (duvar saati beklenmez)', async () => {
    let ran = 0;
    defer.bootDeferral.begin(1, () => {});
    defer.bootDeferral.schedule({
      jobId: 'VoskPreload', wave: 4, bootClass: 'IDLE_ONLY', trigger: 'IDLE',
      run: () => { ran++; },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ran, 'IDLE işi üst sınır içinde koşmadı').toBe(1);
  });

  it('B/E · aynı iş iki kez kurulamaz — tek instance (restart/resume)', async () => {
    let ran = 0;
    defer.bootDeferral.begin(1, () => {});
    const job = {
      jobId: 'VoskPreload', wave: 4 as const, bootClass: 'IDLE_ONLY' as const,
      trigger: 'IDLE' as const, run: () => { ran++; },
    };
    defer.bootDeferral.schedule(job);
    defer.bootDeferral.schedule(job);          // resume/yeniden kayıt
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ran, 'ikinci kayıt mükerrer çalıştı').toBe(1);
    expect(defer.getBootDeferralEvidence().some((e) => e.outcome === 'DUPLICATE_SUPPRESSED')).toBe(true);
  });

  it('C · boot iptal edildiyse iş HİÇ başlamaz (sahte hazır üretmez)', async () => {
    let ran = 0;
    defer.bootDeferral.begin(1, () => {});
    defer.bootDeferral.abort('test');
    defer.bootDeferral.schedule({
      jobId: 'VoskPreload', wave: 4, bootClass: 'IDLE_ONLY', trigger: 'IDLE',
      run: () => { ran++; },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ran).toBe(0);
  });

  it('D · iş uzun sürse de kurulum çağrısı boot zincirini BLOKLAMAZ', () => {
    defer.bootDeferral.begin(1, () => {});
    const t0 = Date.now();
    defer.bootDeferral.schedule({
      jobId: 'VoskPreload', wave: 4, bootClass: 'IDLE_ONLY', trigger: 'IDLE',
      run: () => new Promise<void>(() => { /* asla çözülmez */ }),
    });
    expect(Date.now() - t0, 'schedule() senkron bekledi').toBeLessThan(50);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · WAKE TARAFI — kapı açılınca ertelenen dinleme kurulur, idempotent
 * ════════════════════════════════════════════════════════════════════════ */

describe('wakeWordService · hazırlık kapısı', () => {
  let wake: typeof import('../platform/wakeWordService');

  beforeEach(async () => {
    vi.resetModules();
    wake = await import('../platform/wakeWordService');
    wake._resetWakeWordForTest();
  });
  afterEach(() => { wake._resetWakeWordForTest(); });

  it('C · kapı kapalıyken "hazır" İDDİA EDİLMEZ (fail-closed)', () => {
    wake._setVoskReadyForTest(false);
    expect(wake.isVoskModelReady()).toBe(false);
  });

  it('A/E · kapıyı açmak idempotenttir (tekrar çağrı zarar vermez)', () => {
    wake._setVoskReadyForTest(false);
    wake.notifyVoskModelReady();
    expect(wake.isVoskModelReady()).toBe(true);
    wake.notifyVoskModelReady();
    expect(wake.isVoskModelReady()).toBe(true);
  });
});
