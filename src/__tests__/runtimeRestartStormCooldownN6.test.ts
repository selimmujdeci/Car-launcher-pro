/**
 * runtimeRestartStormCooldownN6.test.ts — N-6 · RESTART STORM / KALICI COOLDOWN.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN YÜZEY
 *
 * Kurtarma otoritesi `runtimeRecoverySupervisor`dır. Üretim zinciri:
 *
 *   SystemBoot.start()
 *     → runtimeRecoverySupervisor.configure(SYSTEM_BOOT_SERVICE_DESCRIPTORS, …)
 *   SystemBoot._handleWorkerCrash()            (worker çökmesi)
 *   SystemHealthMonitor                        (sağlık ihlali)
 *     → runtimeRecoverySupervisor.request(…)
 *       → decideRecovery(...)                  (sınırlı bütçe + backoff + circuit)
 *       → execution.executeRestart(serviceId)  (SystemBoot.restartService)
 *
 * Politika KAĞIT ÜZERİNDE sınırlıdır: `maxAttempts: 2`, `windowMs: 300_000`,
 * üstel backoff ve bir circuit breaker. N-6 bu politikanın GERÇEKTEN sınır
 * koyup koymadığını sorar.
 *
 * ── İKİ AYRI BOŞLUK ───────────────────────────────────────────────────────
 *
 * G1 · BAŞARI TANIMI  (süreç İÇİ)
 *   `executeRestart` SystemBoot içinde `this._started && !this._aborted`
 *   döner — yani "yeniden başlatma çalıştı ve SystemBoot hâlâ ayakta".
 *   Bu, yeniden başlatılan servisin SAĞLIKLI olduğunun kanıtı DEĞİLDİR.
 *   Başarı sayıldığı an defterde `attempts` SIFIRLANIR. Hemen tekrar çöken
 *   bir servis bu yüzden hiçbir zaman `maxAttempts`a ULAŞAMAZ: sınırlı
 *   bütçe o hata kaynağı için fiilen ETKİSİZDİR.
 *
 * G2 · KALICILIK  (süreç ARASI)
 *   `_ledgers` yalnız bellekte bir `Map`tir. Uygulama/süreç yeniden
 *   başlayınca singleton sıfırdan kurulur ve arıza geçmişi KAYBOLUR.
 *
 * G2 tek başına anlamsızdır: G1 yüzünden defterde biriken bir şey yoktur.
 *
 * ── INVARIANT ─────────────────────────────────────────────────────────────
 *   UYGULAMA YENİDEN BAŞLATMA  !=  ARIZA GEÇMİŞİNİN SIFIRLANMASI
 *   ÇÖKME → SINIRLI KURTARMA · TEKRARLAYAN ÇÖKME → COOLDOWN
 *   SÜREÇ YENİDEN BAŞLASA DA COOLDOWN GEÇERLİDİR
 * Ama: BİR BOZUK ALT SİSTEM  !=  TÜM CAROS DEVRE DIŞI.
 *
 * ── KANIT SEVİYESİ ────────────────────────────────────────────────────────
 * DAVRANIŞSAL. Gerçek `runtimeRecoverySupervisor`, gerçek `decideRecovery`
 * ve gerçek `SYSTEM_BOOT_SERVICE_DESCRIPTORS` kullanılır. Yalnız iki sınır
 * enjekte edilir: yeniden başlatmayı YÜRÜTEN taraf (`executeRestart`) ve
 * SAAT (`requestedAt` — politika `now`u buradan okur, bu yüzden gerçek
 * bekleme GEREKMEZ). Süreç yeniden başlatması `vi.resetModules()` ile
 * taklit edilir: yeni modül grafiği = yeni singleton, depo ise kalıcıdır.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_RECOVERY_POLICY } from '../platform/runtime/runtimeRecoveryPolicy';
import { SYSTEM_BOOT_SERVICE_DESCRIPTORS } from '../platform/runtime/runtimeServiceRegistry';
import type { RecoveryDecision } from '../platform/runtime/runtimeRecoveryPolicy';

type Supervisor = typeof import('../platform/runtime/runtimeRecoverySupervisor').runtimeRecoverySupervisor;

const SERVICE = 'VehicleDataLayer';
const EPOCH   = 7;

/** Enjekte saat — politika `now`u `requestedAt` üzerinden okur. */
let clock = 1_700_000_000_000;

/** `executeRestart` sonucunu testler belirler. */
let restartRuns  = 0;
let restartResult = true;

/**
 * Süreç başlatması: YENİ modül grafiği → YENİ supervisor örneği.
 * Depo (localStorage) KASITLI olarak temizlenmez — süreç yeniden başlarken
 * kalıcı durumun hayatta kalması tam olarak ölçülmek istenen şeydir.
 */
async function bootProcess(): Promise<Supervisor> {
  vi.resetModules();
  const mod = await import('../platform/runtime/runtimeRecoverySupervisor');
  const sup = mod.runtimeRecoverySupervisor;
  sup.configure(SYSTEM_BOOT_SERVICE_DESCRIPTORS, {
    currentEpoch:   () => EPOCH,
    executeRestart: async () => { restartRuns++; return restartResult; },
  });
  return sup;
}

/** Bir arıza bildirimi — SystemBoot._handleWorkerCrash ile aynı biçim. */
function crash(sup: Supervisor, serviceId = SERVICE): RecoveryDecision {
  return sup.request({
    requestId:          `worker:VehicleCompute:${clock}`,
    serviceId,
    source:             'RESOURCE_RUNTIME',
    faultDomain:        'VEHICLE_DATA',
    observedLifecycle:  'FAILED',
    observedReadiness:  'NOT_READY',
    observedHealth:     'FAILED',
    reason:             'worker_crash',
    lifecycleEpoch:     EPOCH,
    faultEvidenceRef:   'SystemBoot.worker:VehicleCompute',
    requestedAt:        clock,
    provenance:         ['SystemBoot._handleWorkerCrash'],
  });
}

/** `_execute` void-async: defterin kesinleşmesi için mikro görevleri boşalt. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** Ardışık çökmeler — her biri `stepMs` sonra. Kaç kez restart İZNİ verildi? */
async function crashBurst(
  sup: Supervisor, times: number, stepMs = 1_000,
): Promise<{ allowed: number; kinds: string[] }> {
  const kinds: string[] = [];
  let allowed = 0;
  for (let i = 0; i < times; i++) {
    const d = crash(sup);
    kinds.push(d.kind);
    if (d.kind === 'RESTART_SERVICE') allowed++;
    await settle();
    clock += stepMs;
  }
  return { allowed, kinds };
}

beforeEach(() => {
  clock         = 1_700_000_000_000;
  restartRuns   = 0;
  restartResult = true;
  try { localStorage.clear(); } catch { /* jsdom */ }
});

// ── T1 · TEK ÇÖKME KURTARILABİLİR ───────────────────────────────────────────

describe('N-6/T1 · tek çökme kurtarılır', () => {
  it('ilk arıza yeniden başlatma iznini ALIR', async () => {
    const sup = await bootProcess();
    const d = crash(sup);
    await settle();

    expect(d.kind, 'ilk çökmede kurtarma engellendi — kapı fazla sıkı').toBe('RESTART_SERVICE');
    expect(restartRuns, 'yeniden başlatma yürütülmedi').toBe(1);
  });
});

// ── T2/T3 · HIZLI TEKRARLAYAN ÇÖKME SINIRLI ─────────────────────────────────

describe('N-6/T2-T3 · tekrarlayan hızlı çökme SINIRLIDIR', () => {
  it('pencere içinde izin verilen restart sayısı bütçeyi AŞMAZ', async () => {
    const sup = await bootProcess();
    /* Her yeniden başlatma "çalışıyor" (SystemBoot ayakta) ama servis hemen
       yeniden çöküyor — sahadaki bozuk native kaynak senaryosu. */
    const { allowed, kinds } = await crashBurst(sup, 12, 1_000);

    expect(
      allowed,
      `300 sn'lik pencerede ${allowed} yeniden başlatmaya izin verildi `
      + `(bütçe: ${DEFAULT_RECOVERY_POLICY.maxAttempts}) — sınırsız restart storm. `
      + `Kararlar: ${kinds.join(',')}`,
    ).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.maxAttempts);
  });

  /* Mutasyonla ortaya çıktı: 1 sn adımlı bir seride sınırı BACKOFF koyuyor,
     `maxAttempts` kapağı hiç sınanmıyordu. Burada adım backoff'tan UZUN ama
     pencereden KISA seçilir; böylece yalnız kapak karar verebilir. */
  it('bütçe SINIRI backoff’tan bağımsız olarak uygulanır', async () => {
    const sup = await bootProcess();
    const { allowed, kinds } = await crashBurst(sup, 3, 120_000);

    expect(
      allowed,
      `backoff penceresi geçmiş olmasına rağmen ${allowed} restart açıldı `
      + `(bütçe: ${DEFAULT_RECOVERY_POLICY.maxAttempts}) — kapak yok. Kararlar: ${kinds.join(',')}`,
    ).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.maxAttempts);
  });

  it('bütçe dolduktan sonra karar COOLDOWN olur', async () => {
    const sup = await bootProcess();
    await crashBurst(sup, 8, 1_000);

    const d = crash(sup);
    await settle();
    expect(
      ['BUDGET_EXHAUSTED', 'CIRCUIT_OPEN', 'WAIT_BACKOFF'],
      `bütçe dolduğu hâlde karar ${d.kind}`,
    ).toContain(d.kind);
  });
});

// ── T4 · SÜREÇ YENİDEN BAŞLASA DA COOLDOWN SÜRER ────────────────────────────

describe('N-6/T4 · cooldown süreç yeniden başlatmasını AŞAR', () => {
  it('yeni süreçte arıza geçmişi KORUNUR', async () => {
    const first = await bootProcess();
    await crashBurst(first, 8, 1_000);

    /* Uygulama/süreç yeniden başlar: yeni modül grafiği, yeni singleton. */
    const second = await bootProcess();
    restartRuns = 0;

    const d = crash(second);
    await settle();

    expect(
      d.kind,
      'süreç yeniden başlayınca bütçe sıfırlandı — UYGULAMA RESTART = ARIZA '
      + 'GEÇMİŞİ SIFIRLAMA oldu, storm süreç sınırını aşarak sürer',
    ).not.toBe('RESTART_SERVICE');
    expect(restartRuns, 'yeni süreçte cooldown içinde restart yürütüldü').toBe(0);
  });
});

// ── T5/T6 · COOLDOWN BİTİŞİ VE YENİDEN ARIZA ────────────────────────────────

describe('N-6/T5-T6 · cooldown bitişi kontrollü tek denemedir', () => {
  it('pencere dolunca TEK bir kontrollü deneme açılır, sonra yine sınırlanır', async () => {
    const sup = await bootProcess();
    await crashBurst(sup, 8, 1_000);

    /* Cooldown penceresini geç. */
    clock += DEFAULT_RECOVERY_POLICY.windowMs + 60_000;

    const probe = crash(sup);
    await settle();
    expect(probe.kind, 'cooldown bitti ama hiç deneme açılmadı — kalıcı kilit')
      .toBe('RESTART_SERVICE');

    /* T6: hemen yeniden çökerse yine sınırlanmalı. */
    clock += 1_000;
    const { allowed } = await crashBurst(sup, 8, 1_000);
    expect(
      allowed,
      'cooldown sonrası yeniden arızada bütçe yeniden sınırsız açıldı',
    ).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.maxAttempts);
  });
});

// ── T7 · SAĞLIKLI ÇALIŞMA SONRASI SIFIRLAMA ─────────────────────────────────

describe('N-6/T7 · bütçe yalnız KANITLI sağlıklı süre sonunda sıfırlanır', () => {
  it('arızasız tam bir pencere geçtikten sonra kurtarma yeniden mümkündür', async () => {
    const sup = await bootProcess();
    await crashBurst(sup, 8, 1_000);

    /* Araç günlerce sorunsuz çalıştı. */
    clock += DEFAULT_RECOVERY_POLICY.windowMs * 10;

    const d = crash(sup);
    await settle();
    expect(d.kind, 'uzun sağlıklı çalışmadan sonra kurtarma hâlâ kilitli')
      .toBe('RESTART_SERVICE');
  });

  it('yeniden başlatmanın YÜRÜTÜLMESİ tek başına bütçeyi sıfırlamaz', async () => {
    const sup = await bootProcess();
    restartResult = true;               // her restart "çalıştı" raporluyor

    const { allowed } = await crashBurst(sup, 6, 500);

    expect(
      allowed,
      'her başarılı yeniden başlatma bütçeyi sıfırladı — hemen tekrar çöken '
      + 'servis hiçbir zaman bütçeye ULAŞAMAZ (sınır etkisiz)',
    ).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.maxAttempts);
  });
});

// ── T8 · BOZUK KALICI DURUM ─────────────────────────────────────────────────

describe('N-6/T8 · bozuk kalıcı durum storm ÜRETMEZ', () => {
  it('okunamayan/çöp kayıt sınırlı davranışı bozmaz', async () => {
    /* Depoda ne olduğunu bilmeden her makul anahtarı bozalım. */
    const garbage = ['{{{not-json', '[]', 'null', '{"x":', '12345'];
    for (const k of ['caros_runtime_recovery_v1', 'caros_runtime_recovery']) {
      try { localStorage.setItem(k, garbage[0]!); } catch { /* jsdom */ }
    }

    const sup = await bootProcess();
    const { allowed } = await crashBurst(sup, 10, 1_000);

    expect(
      allowed,
      'bozuk kalıcı durum sınırsız restart açtı (fail-open)',
    ).toBeLessThanOrEqual(DEFAULT_RECOVERY_POLICY.maxAttempts);
  });

  /* Saat geri alındığında kalıcı damgalar "gelecekte" kalır. İki ayrı şey
     aynı anda doğru olmalıdır:
       1) saat oynatmak cooldownu ATLATAMAZ (aksi hâlde bypass olurdu),
       2) ama kilit KALICI da olamaz (bozuk saat aracı kurtarılamaz yapamaz).
     Çözüm gelecekteki damgayı ŞİMDİYE çekmektir: geçmiş korunur, bekleme
     bir pencereyle sınırlanır. */
  it('saat geri alınsa da cooldown atlanmaz ve kilit kalıcı olmaz', async () => {
    const sup = await bootProcess();
    await crashBurst(sup, 8, 1_000);

    /* Saat geriye alındı (kullanıcı/NTP) → kayıt "gelecekte" kaldı. */
    clock -= DEFAULT_RECOVERY_POLICY.windowMs * 5;
    const after = await bootProcess();

    const bypass = crash(after);
    await settle();
    expect(
      bypass.kind,
      'saati geri alarak cooldown ATLANDI — gizli bypass',
    ).not.toBe('RESTART_SERVICE');

    /* Bekleme bir pencereyle sınırlı olmalı. */
    clock += DEFAULT_RECOVERY_POLICY.windowMs + 60_000;
    const d = crash(after);
    await settle();
    expect(
      d.kind,
      'saat oynatıldığında kurtarma SONSUZA DEK kilitlendi — bozuk saat '
      + 'aracı kurtarılamaz hâle getirmemeli',
    ).toBe('RESTART_SERVICE');
  });
});

// ── T9 · ALT SİSTEM İZOLASYONU ──────────────────────────────────────────────

describe('N-6/T9 · bir alt sistemin cooldownu diğerini kilitlemez', () => {
  it('VehicleDataLayer cooldownda iken başka servisin defteri etkilenmez', async () => {
    const sup = await bootProcess();
    await crashBurst(sup, 8, 1_000);

    const snap = sup.snapshot();
    const others = Object.entries(snap.ledgers).filter(([id]) => id !== SERVICE);
    for (const [id, ledger] of others) {
      expect(ledger.attempts, `${id} defteri VehicleDataLayer yüzünden yandı`).toBe(0);
    }
    /* Global bir yasak kurulmadığının kanıtı: kayıt yalnız arızalı servise ait. */
    expect(Object.keys(snap.ledgers)).toContain(SERVICE);
  });
});

// ── T10 · ELLE DURDURMA ÇÖKME DEĞİLDİR ──────────────────────────────────────

describe('N-6/T10 · kapanış/elle durdurma arıza sayılmaz', () => {
  it('shutdown sırasında gelen istek bütçeyi HARCAMAZ', async () => {
    const sup = await bootProcess();

    sup.setShutdownActive(true);
    for (let i = 0; i < 5; i++) { crash(sup); await settle(); clock += 1_000; }
    sup.setShutdownActive(false);

    const d = crash(sup);
    await settle();
    expect(
      d.kind,
      'kapanış sırasındaki istekler bütçeyi yaktı — normal kapanış sonrası '
      + 'gerçek arıza kurtarılamaz hâle geldi',
    ).toBe('RESTART_SERVICE');
  });
});
