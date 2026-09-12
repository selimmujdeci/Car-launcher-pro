/**
 * bootDeferF2.test.ts — ARCH-06/F2 · BOOT ERTELEME KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR: Erteleme, en kolay şekilde SESSİZ BİR İPTALE dönüşür. Bir iş
 * tetikleyicisi düşmediği için hiç koşmazsa, hiçbir hata görülmez — servis
 * yalnızca YOKTUR. Bu dosya o arıza sınıfını yapısal olarak imkânsız kılar:
 * ertelenen iş ya koşar, ya AÇIKÇA iptal kaydı bırakır.
 *
 * İkinci koruduğu şey GÜVENLİK: hız için ertelenmemesi gereken servisler
 * (`hydrateExpertTrustStore`) burada kilitlidir.
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  bootDeferral, getBootDeferralEvidence, _resetBootDeferralForTest,
} from '../platform/boot/bootDeferral';
import {
  markBootMilestone, _resetBootMilestonesForTest,
} from '../platform/bootTimingRecorder';

const BOOT = readFileSync('src/platform/system/SystemBoot.ts', 'utf8');
const MAIN = readFileSync('src/main.tsx', 'utf8');

/** Cleanup teslimlerini yakalayan sahte LIFO yığını (SystemBoot'un yerine). */
let sink: { id: string; fn: () => void }[] = [];
const collect = (id: string, fn: () => void): void => { sink.push({ id, fn }); };

beforeEach(() => {
  _resetBootDeferralForTest();
  _resetBootMilestonesForTest();
  sink = [];
});
afterEach(() => { _resetBootDeferralForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) ERTELEME RUNTIME'I — İŞ KAYBOLMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/A · erteleme runtime', () => {
  it('A1 — tetikleyici düşünce iş KOŞAR', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'j1', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    expect(ran).toBe(0);
    markBootMilestone('FIRST_FRAME', 'test');
    expect(ran).toBe(1);
  });

  it('A2 — iş TEK KEZ koşar (taş yeniden damgalanamaz zaten)', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'j1', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    markBootMilestone('FIRST_FRAME', 'test');
    markBootMilestone('FIRST_FRAME', 'test-2');
    expect(ran).toBe(1);
  });

  it('A3 — YARIŞ: taş kayıttan ÖNCE düştüyse iş HEMEN koşar', () => {
    bootDeferral.begin(1, collect);
    markBootMilestone('FIRST_FRAME', 'erken');
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'gec-kayit', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    /* Beklemek sessiz bir İPTAL olurdu — iş sonsuza dek koşmazdı. */
    expect(ran).toBe(1);
  });

  it('A4 — aynı jobId İKİNCİ kez kaydedilemez', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    const job = { jobId: 'dup', wave: 1, bootClass: 'DEFERABLE' as const,
      trigger: 'AFTER_FIRST_FRAME' as const, run: () => { ran += 1; } };
    bootDeferral.schedule(job);
    bootDeferral.schedule(job);
    markBootMilestone('FIRST_FRAME', 'test');
    expect(ran).toBe(1);
    expect(getBootDeferralEvidence().some((e) => e.outcome === 'DUPLICATE_SUPPRESSED')).toBe(true);
  });

  it('A5 — cleanup SystemBoot LIFO yığınına ADIYLA teslim edilir', () => {
    bootDeferral.begin(1, collect);
    const stop = (): void => { /* servis kapatıcı */ };
    bootDeferral.schedule({
      jobId: 'CleanupSahibi', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => stop,
    });
    markBootMilestone('FIRST_FRAME', 'test');
    expect(sink).toHaveLength(1);
    expect(sink[0]?.id).toBe('CleanupSahibi');
    expect(sink[0]?.fn).toBe(stop);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) DURDURMA / NESİL — SIFIR YAN ETKİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/B · durdurma ve nesil', () => {
  it('B1 — stop TETİKLEYİCİDEN ÖNCE gelirse iş HİÇ BAŞLAMAZ', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'j', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    bootDeferral.abort('stop');
    markBootMilestone('FIRST_FRAME', 'stop sonrası');
    expect(ran).toBe(0);
    expect(getBootDeferralEvidence().some((e) => e.outcome === 'ABORTED_BEFORE_START')).toBe(true);
  });

  it('B2 — boot aktif değilken kayıt İPTAL olarak yazılır (sessiz yutma YOK)', () => {
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'aktif-degil', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    markBootMilestone('FIRST_FRAME', 'test');
    expect(ran).toBe(0);
    expect(getBootDeferralEvidence().some(
      (e) => e.jobId === 'aktif-degil' && e.outcome === 'ABORTED_BEFORE_START')).toBe(true);
  });

  it('B3 — YENİDEN BOOT: eski nesil kaydı yeni boot’ta koşmaz', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    bootDeferral.schedule({
      jobId: 'eski', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ran += 1; },
    });
    bootDeferral.abort('stop');
    /* İkinci boot: yeni nesil, temiz kuyruk. */
    _resetBootMilestonesForTest();
    bootDeferral.begin(2, collect);
    markBootMilestone('FIRST_FRAME', 'yeni boot');
    expect(ran).toBe(0);
  });

  it('B4 — yeniden boot sonrası AYNI jobId tekrar kaydedilebilir', () => {
    bootDeferral.begin(1, collect);
    let ran = 0;
    const mk = () => ({ jobId: 'tekrar', wave: 1, bootClass: 'DEFERABLE' as const,
      trigger: 'AFTER_FIRST_FRAME' as const, run: () => { ran += 1; } });
    bootDeferral.schedule(mk());
    bootDeferral.abort('stop');
    _resetBootMilestonesForTest();
    bootDeferral.begin(2, collect);
    bootDeferral.schedule(mk());
    markBootMilestone('FIRST_FRAME', 'ikinci boot');
    expect(ran).toBe(1);
  });

  it('B5 — boot durduysa cleanup ANINDA çalışır (zombi servis YOK)', async () => {
    bootDeferral.begin(1, collect);
    let cleaned = 0;
    let resolveStart: (() => void) | null = null;
    const gate = new Promise<void>((r) => { resolveStart = r; });
    bootDeferral.schedule({
      jobId: 'gecKuruldu', wave: 1, bootClass: 'DEFERABLE', trigger: 'AFTER_FIRST_FRAME',
      run: async () => { await gate; return () => { cleaned += 1; }; },
    });
    markBootMilestone('FIRST_FRAME', 'test');
    bootDeferral.abort('stop');           // servis kurulurken stop geldi
    resolveStart?.();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    /* Cleanup LIFO'ya KAYDEDİLMEZ (boot bitti) ama ÇALIŞTIRILIR. */
    expect(cleaned).toBe(1);
    expect(sink).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) HATA SEMANTİĞİ — FIRE-AND-FORGET YOK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/C · hata semantiği', () => {
  it('C1 — senkron başlatma hatası YAKALANIR ve kanıta yazılır', () => {
    bootDeferral.begin(1, collect);
    bootDeferral.schedule({
      jobId: 'patlar', wave: 1, bootClass: 'DEFERABLE', trigger: 'AFTER_FIRST_FRAME',
      run: () => { throw new Error('start patladı'); },
    });
    expect(() => markBootMilestone('FIRST_FRAME', 'test')).not.toThrow();
    const row = getBootDeferralEvidence().find((e) => e.jobId === 'patlar');
    expect(row?.outcome).toBe('FAILED');
    expect(row?.reason).toContain('start patladı');
  });

  it('C2 — asenkron RED yakalanır (unhandled rejection YOK)', async () => {
    bootDeferral.begin(1, collect);
    bootDeferral.schedule({
      jobId: 'rededer', wave: 1, bootClass: 'DEFERABLE', trigger: 'AFTER_FIRST_FRAME',
      run: () => Promise.reject(new Error('async red')),
    });
    markBootMilestone('FIRST_FRAME', 'test');
    await Promise.resolve(); await Promise.resolve();
    const row = getBootDeferralEvidence().find((e) => e.jobId === 'rededer');
    expect(row?.outcome).toBe('FAILED');
    expect(row?.reason).toContain('async red');
  });

  it('C3 — bir işin hatası DİĞER işleri düşürmez', () => {
    bootDeferral.begin(1, collect);
    let ok = 0;
    bootDeferral.schedule({ jobId: 'kotu', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { throw new Error('x'); } });
    bootDeferral.schedule({ jobId: 'iyi', wave: 1, bootClass: 'DEFERABLE',
      trigger: 'AFTER_FIRST_FRAME', run: () => { ok += 1; } });
    markBootMilestone('FIRST_FRAME', 'test');
    expect(ok).toBe(1);
  });

  it('C4 — kanıt satırı gerçek gecikmeyi taşır', () => {
    bootDeferral.begin(1, collect);
    bootDeferral.schedule({ jobId: 'olculur', wave: 3, bootClass: 'DEFERABLE',
      trigger: 'AFTER_VEHICLE_CORE', run: () => undefined });
    markBootMilestone('VEHICLE_CORE_INITIALIZED', 'test');
    const row = getBootDeferralEvidence().find((e) => e.jobId === 'olculur');
    expect(row?.outcome).toBe('STARTED');
    expect(row?.trigger).toBe('AFTER_VEHICLE_CORE');
    expect(row?.wave).toBe(3);
    expect(row?.delayMs).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) GÜVENLİK — ERTELENMEYECEKLER (ARCH-05 > boot hızı)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/D · ertelenmeyecek servisler', () => {
  it('D1 — 🔒 hydrateExpertTrustStore ERTELENMEZ (fail-open koruması)', () => {
    /* KANIT: `useExpertStore.assertWritesAllowed()` ilk satırında
       `if (!s.hydrated) return;` yapar — hidrasyon bitmeden yazma kapısı
       AÇIKTIR. Ertelemek o fail-open penceresini uzatırdı.
       ARCH-05 invariant’ı boot hızının ÜSTÜNDEDİR. */
    const store = readFileSync('src/store/useExpertStore.ts', 'utf8');
    expect(store).toContain('if (!s.hydrated) return;');
    expect(BOOT).toContain("await measureBootService('hydrateExpertTrustStore', 1, true");
    expect(BOOT).not.toMatch(/jobId:\s*'ExpertTrust/);
    expect(BOOT).not.toMatch(/hydrateExpertTrustStore[\s\S]{0,200}bootDeferral\.schedule/);
  });

  it('D2 — 🔒 startPerfSeries W1’de KALIR (boot’un kendisini ölçer)', () => {
    expect(BOOT).toContain('this._cleanups.push(startPerfSeries())');
    expect(BOOT).not.toMatch(/jobId:\s*'PerfSeries'/);
  });

  it('D3 — 🔒 BOOT_CRITICAL servisler hâlâ BLOKLAYICI', () => {
    expect(BOOT).toContain("await measureBootService('initSafeStorageAsync', 1, true");
    expect(BOOT).toContain('this._reg(initPanicHandler())');
    expect(BOOT).toContain('runtimeManager.start()');
    expect(BOOT).toContain('startMemoryWatchdog()');
    expect(BOOT).toContain('healthMonitor.start()');
  });

  it('D4 — 🔒 media authority hâlâ AWAIT ediliyor (Mavi/UI’dan bağımsız)', () => {
    expect(BOOT).toContain("await measureBootService('startMediaAuthority', 1, true, () => startMediaAuthority())");
    expect(BOOT).toContain("this._regNamed('media-authority', stopMediaAuthority)");
  });

  it('D5 — 🔒 VEHICLE_CORE servisleri Wave 3’te KALDI', () => {
    for (const svc of ['startBatteryEvidenceSource', 'startBatteryVerdictService',
      'startBatteryProtection', 'startVehicleIntelligenceService',
      'startGuardianRuntime', 'startSpeedAlertRuntime',
      'startLocationEngine', 'startNavigationSessionRuntime', 'startPredictionRuntime']) {
      /* Çağrı BOOT'ta duruyor. Parantez AÇIK aranır: bazıları argüman alır
         (`startSpeedAlertRuntime({ onSpeed, onDriverAlert })`). */
      expect(BOOT, svc).toContain(svc + '(');
      /* Ve bir erteleme işinin GÖVDESİ olarak sarılmamış: `bootDeferral.schedule`
         bloğunun içinde bu çağrı GEÇMEMELİ. */
      /* Ve bir erteleme işinin GÖVDESİ olarak sarılmamış. Erteleme gövdesi
         DAİMA `run:` alanıdır; bu yüzden `run:` ile aynı satırda/hemen
         ardında bu çağrının geçmemesi aranır. Geniş bir pencere taramak
         (ör. 400 karakter) komşu `schedule` bloklarına taşar ve yanlış
         alarm üretirdi. */
      const wrapped = new RegExp('run:\\s*(?:async\\s*)?\\(\\)\\s*=>[^\\n]{0,80}' + svc + '\\(');
      expect(BOOT, svc + ' ertelenmemeli').not.toMatch(wrapped);
    }
  });

  it('D6 — 🔒 BatteryEvidenceSource → BatteryVerdictService SIRASI korunuyor', () => {
    /* Kaynak kodun kendi yorumu: "kanıt kaynağı ÖNCE kurulmalı ki abonelik
       yakalansın". İkisi de Wave 3'te ve bu sırada kalmalı. */
    const a = BOOT.indexOf('startBatteryEvidenceSource()');
    const b = BOOT.indexOf('startBatteryVerdictService()');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it('D7 — 🔒 LocationEngine → NavigationSessionRuntime SIRASI korunuyor (LIFO)', () => {
    const a = BOOT.indexOf('startLocationEngine()');
    const b = BOOT.indexOf('startNavigationSessionRuntime()');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it('D8 — 🔒 VehicleKnowledgeBase → LearningEvidenceBridge SIRASI korunuyor', () => {
    const a = BOOT.indexOf('startVehicleKnowledgeBase()');
    const b = BOOT.indexOf('startVehicleLearningEvidenceBridge()');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) ERTELENENLER — GERÇEKTEN BAĞLANDI MI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/E · ertelenen servisler', () => {
  it.each([
    ['UiActivityRecorder', 'AFTER_FIRST_FRAME'],
    ['DiagnosticTrail', 'AFTER_FIRST_FRAME'],
    ['CommunityService', 'IDLE'],
    ['MaintenanceBrain', 'AFTER_VEHICLE_CORE'],
    ['FuelAdvisor', 'AFTER_VEHICLE_CORE'],
    ['VehicleClassRuntime', 'AFTER_VEHICLE_CORE'],
    ['RadarEngine', 'AFTER_SHELL_INTERACTIVE'],
    ['TripUpload', 'IDLE'],
    ['FleetReadback', 'IDLE'],
    ['OtaUpdateService', 'IDLE'],
    ['PushService', 'IDLE'],
  ])('E1 — %s → %s tetikleyicisine bağlı', (jobId, trigger) => {
    const re = new RegExp(`jobId:\\s*'${jobId}'[\\s\\S]{0,260}trigger:\\s*'${trigger}'`);
    expect(BOOT).toMatch(re);
  });

  it('E2 — ertelenen her iş bir bootClass BEYAN EDER', () => {
    const jobs = [...BOOT.matchAll(/jobId:\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(jobs.length).toBeGreaterThanOrEqual(11);
    for (const j of jobs) {
      const re = new RegExp(`jobId:\\s*'${j}'[\\s\\S]{0,160}bootClass:\\s*'(DEFERABLE|IDLE_ONLY|ON_DEMAND)'`);
      expect(BOOT, j).toMatch(re);
    }
  });

  it('E3 — ölü `obdData` dinleyicisi KALDIRILDI (davranış değişmedi)', () => {
    expect(MAIN).not.toMatch(/addListener\('obdData'/);
    /* Geri vites sinyalinin GERÇEK kaynağı aynen duruyor. */
    expect(MAIN).toContain("addListener('canData'");
    expect(MAIN).toContain('signalReverse(data.reverse)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) BOOT OTORİTESİ — DEĞİŞMEDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/F · boot otoritesi korunuyor', () => {
  it('F1 — 4 dalga SIRASI ve abort denetimi AYNEN duruyor', () => {
    for (const w of [1, 2, 3, 4]) {
      expect(BOOT).toMatch(new RegExp(`await this\\._wave${w}\\(\\); if \\(this\\._aborted\\)`));
    }
    const order = [1, 2, 3, 4].map((w) => BOOT.indexOf(`await this._wave${w}()`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('F2 — LIFO shutdown ve recovery interlock korunuyor', () => {
    expect(BOOT).toContain('runtimeRecoverySupervisor.setShutdownActive(true)');
    expect(BOOT).toContain('for (let i = this._cleanups.length - 1; i >= 0; i--)');
  });

  it('F3 — erteleme runtime’ı stop’ta LIFO’dan ÖNCE iptal edilir', () => {
    const abortIdx = BOOT.indexOf("bootDeferral.abort('SystemBoot.stop()')");
    const lifoIdx = BOOT.indexOf('for (let i = this._cleanups.length - 1');
    expect(abortIdx).toBeGreaterThan(-1);
    /* Sıra kritik: LIFO koşarken yeni servis kaydı doğmamalı. */
    expect(lifoIdx).toBeGreaterThan(abortIdx);
  });

  it('F4 — erteleme runtime’ı İKİNCİ boot otoritesi DEĞİL', () => {
    const src = readFileSync('src/platform/boot/bootDeferral.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    /* Kendi rAF döngüsü, periyodik tiki veya boot bayrağı KURMAZ. */
    expect(code).not.toMatch(/requestAnimationFrame|setInterval\(/);
    expect(code).not.toMatch(/__APP_READY__|recordBootWave|recordBootComplete/);
    /* Nesli KENDİSİ üretmez — SystemBoot verir. */
    expect(code).toMatch(/begin\(generation: number/);
  });

  it('F5 — SystemBoot erteleme turunu AÇAR ve nesli mevcut sayaçtan alır', () => {
    expect(BOOT).toContain('bootDeferral.begin(this._diagStarts');
    expect(BOOT).toContain('this._regNamed(jobId, cleanup)');
  });
});
