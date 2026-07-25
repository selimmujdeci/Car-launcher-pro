/**
 * systemBootRestartLifecycle.test.ts — 🔒 REGRESYON KİLİDİ (CLAUDE.md §Regresyon Kasası)
 *
 * KİLİTLENEN DAVRANIŞ: Worker crash sonrası planlanan gecikmeli restart, SystemBoot
 * durdurulduğunda (stop()/abort) İPTAL EDİLİR. Aksi halde `startVehicleDataLayer`
 * yaşam döngüsü kapandıktan SONRA yeni bir worker + adapter + abonelik zinciri doğurur
 * ve cleanup'ı boşaltılmış `_cleanups` listesine yazılır → ASLA çağrılmaz (zombi servis:
 * bellek sızıntısı + kapalı sanılan uygulamada CPU/GPS/batarya tüketimi).
 *
 * KAPSAM: gerçek `SystemBoot` modülü, gerçek `restartService()`, gerçek `stop()` ve
 * gerçek backoff/cool-off zamanlaması koşulur. Crash yalnızca ÜRETİM YOLUNDAN —
 * `startVehicleDataLayer({ onWorkerCrash })` ile SystemBoot'un verdiği geri çağrıdan —
 * tetiklenir.
 *
 * NEDEN `start()` ÇAĞRILMIYOR: gerçek 4 dalgalı boot onlarca modül-düzeyi tekil durumu
 * (bayrak önbellekleri, kayıt defterleri, uzak yapılandırma, Supabase realtime kanalı)
 * doldurur ve aynı süreçte SONRA koşan test dosyalarını bozar — ölçüldü: tam suite'te
 * her koşuda RASTGELE 3 dosya düşüyordu (maviPlanner/maviToolRouter/companionWake…).
 * Bu invaryant boot dalgalarına BAĞIMLI DEĞİLDİR: yaşam döngüsü bayrağı doğrudan
 * kurulur, geri kalan her şey gerçek üretim koduyla yürür.
 *
 * ⚠️ Bu dosyayı ZAYIFLATMA/SİLME. Davranış bilinçli değişirse kilidi GÜNCELLE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── vehicleDataLayer sahtesi: çağrı sayımı + crash geri çağrısını yakala ──── */

const vdl = vi.hoisted(() => ({
  startCalls:   0,
  cleanupCalls: 0,
  /** SystemBoot'un son start çağrısında verdiği GERÇEK crash geri çağrısı. */
  onWorkerCrash: null as (() => void) | null,
  /** Her start için üretilen cleanup thunk'ları (kimlik karşılaştırması için). */
  cleanups: [] as Array<() => void>,
}));

// KISMİ mock: yalnız `startVehicleDataLayer` sahtelenir; modülün diğer export'ları
// (onVehicleEvent, restoreOdometer…) GERÇEK kalır.
vi.mock('../platform/vehicleDataLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleDataLayer')>();
  return {
    ...actual,
    startVehicleDataLayer: (opts?: { onWorkerCrash?: () => void }) => {
      vdl.startCalls++;
      vdl.onWorkerCrash = opts?.onWorkerCrash ?? null;
      const cleanup = (): void => { vdl.cleanupCalls++; };
      vdl.cleanups.push(cleanup);
      return cleanup;
    },
  };
});

import { systemBoot } from '../platform/system/SystemBoot';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** Test-içi görünürlük için SystemBoot'un yaşam döngüsü alanları. */
interface BootInternals {
  _cleanups:      Array<() => void>;
  _namedCleanups: Map<string, () => void>;
  _backoffState:  Map<string, unknown>;
  _started:       boolean;
}
const internals = (): BootInternals => systemBoot as unknown as BootInternals;

/** VehicleDataLayer cleanup'ının `_cleanups` içinde kaç kez kayıtlı olduğu. */
function cleanupRegistrations(fn: (() => void) | undefined): number {
  if (!fn) return 0;
  return internals()._cleanups.filter((c) => c === fn).length;
}

/**
 * Yaşam döngüsünü "aktif" duruma getirir ve VehicleDataLayer'ı GERÇEK üretim yolundan
 * (`restartService`) başlatır → SystemBoot'un ürettiği gerçek `onWorkerCrash` elimize geçer.
 */
async function activateWithVehicleDataLayer(): Promise<void> {
  vi.useRealTimers();
  const b = internals();
  b._started = true;
  b._cleanups.length = 0;
  b._namedCleanups.clear();
  b._backoffState.clear();

  await systemBoot.restartService('VehicleDataLayer');

  expect(vdl.startCalls).toBe(1);
  expect(vdl.onWorkerCrash).toBeTypeOf('function');
  expect(b._namedCleanups.has('VehicleDataLayer')).toBe(true);
}

beforeEach(() => {
  vdl.startCalls      = 0;
  vdl.cleanupCalls    = 0;
  vdl.onWorkerCrash   = null;
  vdl.cleanups.length = 0;
});

afterEach(() => {
  try { systemBoot.stop(); } catch { /* zaten durmuş */ }
  vi.clearAllTimers();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
   Test A — stop() bekleyen restart'ı iptal eder
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — A: stop() bekleyen restart\'ı iptal eder', () => {
  it('stop() sonrası backoff süresi dolsa bile VehicleDataLayer YENİDEN BAŞLAMAZ', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;                      // 1
    expect(internals()._cleanups.length).toBeGreaterThan(0);  // kayıt gerçekten yapılmıştı

    vi.useFakeTimers();

    // Üretim yolu: worker crash → SystemBoot 5 sn'lik restart planlar
    vdl.onWorkerCrash!();

    // Gecikme dolmadan uygulama kapanıyor
    systemBoot.stop();
    expect(internals()._started).toBe(false);
    expect(internals()._cleanups.length).toBe(0);             // stop() listeyi boşalttı

    // Backoff (5 sn) + restartService settle (500 ms) + geniş pay
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vdl.startCalls).toBe(startsBefore);                            // YENİ start YOK
    expect(internals()._cleanups.length).toBe(0);                         // cleanup KAYDI YOK
    expect(internals()._namedCleanups.has('VehicleDataLayer')).toBe(false);
    expect(internals()._started).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test B — restart geri çağrısı stop()/abort ile yarışırsa diriltme olmaz
   (restartService'in içindeki 500 ms settle penceresinde kapanış gelir)
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — B: abort/stop yarışı diriltmeyi engeller', () => {
  it('restartService settle penceresindeyken stop() gelirse servis DİRİLMEZ', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;

    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    // Backoff dolsun → restartService başlasın (eski cleanup çalışır, 500 ms settle'a girer)
    await vi.advanceTimersByTimeAsync(5_100);

    // Tam settle penceresinin ortasında kapanış
    systemBoot.stop();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(vdl.startCalls).toBe(startsBefore);                            // await SONRASI start YOK
    expect(internals()._namedCleanups.has('VehicleDataLayer')).toBe(false);
    expect(internals()._cleanups.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test C — çoklu bekleyen yol zombi üretemez (cool-off dahil)
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — C: çoklu bekleyen restart zombi üretmez', () => {
  it('tekrarlı crash + cool-off sonrası stop() → SIFIR post-stop restart', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;

    vi.useFakeTimers();

    // MAX_RESTARTS=2 aşılana kadar: bekleyen restart(lar) + cool-off timer'ı
    vdl.onWorkerCrash!();   // count=1 → 5 sn
    vdl.onWorkerCrash!();   // count=2 → 10 sn
    vdl.onWorkerCrash!();   // count=3 → cool-off (5 dk)

    systemBoot.stop();

    // Tüm backoff + cool-off pencerelerinin ÇOK ötesine geç
    await vi.advanceTimersByTimeAsync(600_000);

    expect(vdl.startCalls).toBe(startsBefore);
    expect(internals()._cleanups.length).toBe(0);
    expect(internals()._namedCleanups.has('VehicleDataLayer')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test D — sistem AKTİFKEN normal kurtarma AYNEN çalışır (regresyon koruması)
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — D: aktif oturumda kurtarma bozulmaz', () => {
  it('tek crash → tam olarak BİR restart, cleanup tam olarak BİR kez kayıtlı', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;             // 1
    const firstCleanup = vdl.cleanups[0];

    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    // Backoff (5 sn) + settle (500 ms)
    await vi.advanceTimersByTimeAsync(6_000);

    expect(vdl.startCalls).toBe(startsBefore + 1);   // TAM OLARAK bir yeniden başlatma
    expect(vdl.cleanupCalls).toBe(1);                // eski cleanup çalıştırıldı
    expect(internals()._started).toBe(true);         // yaşam döngüsü hâlâ aktif

    const newCleanup = vdl.cleanups[1];
    expect(newCleanup).toBeTypeOf('function');
    expect(internals()._namedCleanups.get('VehicleDataLayer')).toBe(newCleanup);
    expect(cleanupRegistrations(newCleanup)).toBe(1);   // TAM OLARAK bir kez kayıtlı
    expect(cleanupRegistrations(firstCleanup)).toBe(0); // eski kayıt listeden çıkarıldı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test E — aktif → stop → aktif döngüsü sağlam kalır
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — E: aktif → stop → aktif', () => {
  it('yeniden etkinleştirilen yaşam döngüsünde kurtarma tekrar çalışır', async () => {
    await activateWithVehicleDataLayer();
    systemBoot.stop();
    expect(internals()._started).toBe(false);

    // İkinci etkinleştirme (sayaçları sıfırla — activate 1 start bekler)
    vdl.startCalls = 0;
    vdl.cleanups.length = 0;
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;

    vi.useFakeTimers();
    vdl.onWorkerCrash!();
    await vi.advanceTimersByTimeAsync(6_000);

    // Backoff sayacı stop() ile sıfırlandı → kurtarma normal çalışmalı
    expect(vdl.startCalls).toBe(startsBefore + 1);
    expect(internals()._namedCleanups.has('VehicleDataLayer')).toBe(true);
    expect(internals()._started).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test F — bekleyen restart varken yeni crash: TEK bekleyen restart invaryantı
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — F: tek bekleyen restart invaryantı', () => {
  it('restart beklerken gelen ikinci crash İKİ değil TEK yeniden başlatma üretir', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;

    vi.useFakeTimers();

    vdl.onWorkerCrash!();                         // count=1 → 5 sn
    await vi.advanceTimersByTimeAsync(2_000);     // ilk timer HÂLÂ bekliyor
    vdl.onWorkerCrash!();                         // count=2 → 10 sn (ilki iptal edilir)

    await vi.advanceTimersByTimeAsync(30_000);    // her iki pencerenin de ötesi

    expect(vdl.startCalls).toBe(startsBefore + 1);   // çift diriltme YOK
    expect(internals()._started).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test G — stop() birden fazla kez çağrılabilir (idempotent temizlik)
══════════════════════════════════════════════════════════════════════════ */

describe('SystemBoot restart yaşam döngüsü — G: çift stop() güvenli', () => {
  it('stop() iki kez çağrılsa da hata atmaz ve restart doğmaz', async () => {
    await activateWithVehicleDataLayer();
    const startsBefore = vdl.startCalls;

    vi.useFakeTimers();
    vdl.onWorkerCrash!();

    expect(() => { systemBoot.stop(); systemBoot.stop(); }).not.toThrow();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(vdl.startCalls).toBe(startsBefore);
    expect(internals()._started).toBe(false);
  });
});
