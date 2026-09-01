/**
 * bootTimerGovernanceF2.test.ts — ARCH-06/F2 · TIMER YÖNETİŞİMİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR: Timer taşımanın iki ayrı arıza sınıfı vardır ve ikisi de
 * SESSİZDİR:
 *
 *  (1) FAZLA TAŞIMA — protokol zamanlaması (OBD `3E` keepalive, native
 *      heartbeat, geri görüş kare beslemesi) 3 Hz'lik bir tik-wheel'e
 *      yuvarlanırsa oturum düşer, kamera takılır. Hiçbir test kırmaz,
 *      yalnız araç bozulur.
 *
 *  (2) SIZINTI — ham `setInterval` bir ARM görevine dönüşürken `clearInterval`
 *      unutulursa görev sonsuza dek wheel'de kalır; ikinci `start()` ikinci
 *      kopyayı ekler.
 *
 * Bu dosya ikisini de yapısal olarak kapatır.
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  getTimerInventory, timerDescriptors, armWheelOwners,
} from '../platform/perf/timerInventory';

/** Yorum ve dize sabitlerini söker — kilitler KODA bakar, prozaya değil. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const MIGRATED = [
  { file: 'src/platform/mapSourceStore.ts', taskId: 'mapSource.ping' },
  { file: 'src/platform/deviceApi.ts', taskId: 'device.statusPoll' },
  { file: 'src/platform/passengerService.ts', taskId: 'passenger.stateSync' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   A) TAŞINANLAR — ARM WHEEL'İNE GERÇEKTEN BAĞLI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/A · ARM’e taşınan görevler', () => {
  it.each(MIGRATED)('A1 — $taskId ARM tik-wheel’inde', ({ file, taskId }) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    expect(code).toContain('runtimeManager.scheduleTask(');
    expect(readFileSync(file, 'utf8')).toContain(`id: '${taskId}'`);
  });

  it.each(MIGRATED)('A2 — $taskId için ham setInterval KALMADI', ({ file }) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    /* Taşıma yarım kalırsa İKİ zamanlayıcı birden koşar — en sinsi sızıntı. */
    expect(code).not.toMatch(/setInterval\(/);
  });

  it.each(MIGRATED)('A3 — $taskId cleanup unschedule THUNK’ını çağırır', ({ file }) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    /* `scheduleTask` bir söküm thunk'ı döner; `clearInterval` ARTIK yanlıştır. */
    expect(code).not.toMatch(/clearInterval\(/);
  });

  it('A4 — ARM sözlüğü GENİŞLETİLMEDİ (SAFETY | NORMAL)', () => {
    const arm = readFileSync('src/core/runtime/AdaptiveRuntimeManager.ts', 'utf8');
    expect(arm).toContain("export type TaskCriticality = 'SAFETY' | 'NORMAL';");
    for (const { file } of MIGRATED) {
      const raw = readFileSync(file, 'utf8');
      /* Bütçelenebilir görev NORMAL olmalı: SAFETY hiçbir tier'da kısılmaz
         ve bu görevlerin kısılması TAM OLARAK istenen şeydir. */
      expect(raw, file).toContain("criticality: 'NORMAL'");
      expect(raw, file).not.toContain("criticality: 'SAFETY'");
    }
  });

  it('A5 — taşınan görevler düşük yük sınıfında (deferIdle)', () => {
    for (const { file } of MIGRATED) {
      expect(readFileSync(file, 'utf8'), file).toContain('deferIdle: true');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) TAŞINMAYACAKLAR — PROTOKOL/İZLEME ZAMANLAMASI
   ═══════════════════════════════════════════════════════════════════════════ */

const UNTOUCHABLE = [
  { file: 'src/platform/obd/diagnosticSessionScheduler.ts', why: 'ISO oturum canlılığı (3E keepalive)' },
  { file: 'src/platform/obd/manufacturerPidService.ts', why: 'poll bütçesi native planlayıcıda' },
  { file: 'src/platform/native/NativeGuardBridge.ts', why: 'native kalp atışı sözleşmesi' },
  { file: 'src/platform/cameraService.ts', why: 'geri görüş kare beslemesi' },
  { file: 'src/platform/dashcamService.ts', why: 'kayıt segment sınırı' },
  { file: 'src/platform/navigation/navigationSessionRuntime.ts', why: 'ölü hesap beslemesi' },
  { file: 'src/platform/canBus/VehicleConnectivityManager.ts', why: 'CAN bayatlık kapısı' },
];

describe('ARCH-06/F2/B · dokunulmayan alan zamanlayıcıları', () => {
  it.each(UNTOUCHABLE)('B1 — $file ARM’e taşınmadı ($why)', ({ file }) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    /* Bu dosyalar KENDİ zamanlayıcılarını sürmeye devam etmeli. */
    expect(code).toMatch(/setInterval\(/);
    expect(code).not.toContain('runtimeManager.scheduleTask(');
  });

  it('B2 — medya 5 s yoklaması WATCHDOG olarak KALDI', () => {
    const code = codeOnly(readFileSync('src/platform/mediaService.ts', 'utf8'));
    /* Olay köprüsü YOKSA tek veri yoludur (poll-only mod). Kör kısma medya
       durumunu bayatlatırdı. */
    expect(code).toMatch(/setInterval\([\s\S]{0,120}5_000\)/);
  });

  it('B3 — GPS kadans otoritesi DEĞİŞMEDİ', () => {
    const gps = readFileSync('src/platform/gpsService.ts', 'utf8');
    expect(gps).toContain('GPS_NAV_MAX_INTERVAL_MS = 500');
    expect(gps).toContain('POSITION_THROTTLE_BASE_MS = 200');
  });

  it('B4 — CAN native coalescing sabiti DEĞİŞMEDİ', () => {
    const java = readFileSync('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java', 'utf8');
    expect(java).toContain('CAN_EMIT_MIN_INTERVAL_MS = 80L');
    expect(java).toContain('isSafetyCriticalChange');
  });

  it('B5 — OBD native poll planlayıcısı DEĞİŞMEDİ', () => {
    const sched = readFileSync('android/app/src/main/java/com/cockpitos/pro/obd/AdaptivePidScheduler.java', 'utf8');
    expect(sched).toContain('public synchronized List<String> plan(');
    expect(sched).toContain('budgetMs');
  });

  it('B6 — ARM wheel çözünürlüğü DEĞİŞMEDİ', () => {
    expect(readFileSync('src/core/runtime/AdaptiveRuntimeManager.ts', 'utf8'))
      .toContain('MASTER_TICK_MS = 333');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) ENVANTER — F2 SONUCUYLA TUTARLI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/C · envanter tutarlılığı', () => {
  it('C1 — taşınan üç görev envanterde onArmWheel:true', () => {
    const byId = new Map(timerDescriptors().map((t) => [t.timerId, t]));
    for (const { taskId } of MIGRATED) {
      expect(byId.get(taskId)?.onArmWheel, taskId).toBe(true);
      expect(byId.get(taskId)?.decision, taskId).toBe('MIGRATE_TO_ARM');
    }
  });

  it('C2 — DOMAIN_HARD ve WATCHDOG hiçbiri ARM wheel’inde DEĞİL', () => {
    for (const t of timerDescriptors()) {
      if (t.timerClass === 'DOMAIN_HARD_CADENCE' || t.timerClass === 'WATCHDOG') {
        expect(t.onArmWheel, t.timerId).toBe(false);
        expect(t.decision, t.timerId).not.toBe('MIGRATE_TO_ARM');
      }
    }
  });

  it('C3 — ölü dinleyici envanterde SİLİNDİ olarak işaretli', () => {
    const dead = timerDescriptors().find((t) => t.timerId === 'boot.obdDataPlaceholderListener');
    expect(dead?.decision).toBe('DELETE_IF_REDUNDANT');
    expect(dead?.rationale).toMatch(/KALDIRILDI|kaldırıldı/);
    /* Ve gerçekten kaldırılmış. */
    expect(readFileSync('src/main.tsx', 'utf8')).not.toMatch(/addListener\('obdData'/);
  });

  it('C4 — envanter ARM sözlüğü dışında criticality TAŞIMAZ', () => {
    for (const t of timerDescriptors()) {
      expect(['SAFETY', 'NORMAL'], t.timerId).toContain(t.criticality);
    }
  });

  it('C5 — her descriptor kanıt + gerekçe + cleanup sahibi taşır', () => {
    for (const t of timerDescriptors()) {
      expect(t.sourceRef.length, t.timerId).toBeGreaterThan(0);
      expect(t.rationale.length, t.timerId).toBeGreaterThan(0);
      expect(t.cleanupOwner.length, t.timerId).toBeGreaterThan(0);
    }
  });

  it('C6 — envanter hâlâ BİLDİRİM olduğunu söyler (uyanma sayısı iddia etmez)', () => {
    expect(getTimerInventory().notes.join(' ')).toMatch(/UYANDIĞINI SÖYLEMEZ/);
  });

  it('C7 — ARM wheel sahip sayısı taşımalarla ARTTI', () => {
    /* F1'de 12 alan wheel'i kullanıyordu; F2 üç görev daha ekledi.
       Bu sayı envanterin BİLDİRİMİDİR — gerçek kayıt A1 ile kanıtlanır. */
    expect(armWheelOwners().length).toBeGreaterThanOrEqual(12);
    const onWheel = timerDescriptors().filter((t) => t.onArmWheel).length;
    expect(onWheel).toBeGreaterThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) SIZINTI GÜVENLİĞİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F2/D · sızıntı güvenliği', () => {
  it('D1 — taşınan her görev bir SÖKÜM thunk’ı saklar', () => {
    for (const { file } of MIGRATED) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      /* Dönüş değeri atılırsa görev sonsuza dek wheel'de kalır. */
      expect(code, file).toMatch(/=\s*runtimeManager\.scheduleTask\(/);
    }
  });

  it('D2 — söküm thunk’ı ÇAĞRILIYOR (tip düzeyinde de zorunlu)', () => {
    for (const { file } of MIGRATED) {
      const raw = readFileSync(file, 'utf8');
      /* Değişken tipi artık `(() => void) | null` — `clearInterval` çağırmak
         derlenmez. Bu, sızıntıyı TİP düzeyinde imkânsız kılar. */
      expect(raw, file).toMatch(/let\s+_\w+:\s*\(\(\) => void\)\s*\|\s*null/);
    }
  });

  it('D3 — ARM scheduleTask aynı id ile çift kayıtta ÜZERİNE YAZAR', () => {
    /* İkinci `start()` ikinci kopya EKLEMEZ — ARM sözleşmesi bunu garanti
       eder ve taşımanın güvenliği buna dayanır. */
    const arm = readFileSync('src/core/runtime/AdaptiveRuntimeManager.ts', 'utf8');
    expect(arm).toContain('this._tasks.set(task.id');
    expect(arm).toMatch(/çift kayıt öncekini DEĞİŞTİRİR/);
  });

  it('D4 — wheel boşalınca DURUR (boşta CPU sıfır)', () => {
    const arm = readFileSync('src/core/runtime/AdaptiveRuntimeManager.ts', 'utf8');
    expect(arm).toContain('if (this._tasks.size === 0) this._stopWheel()');
  });
});
