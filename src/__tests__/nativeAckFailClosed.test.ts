/**
 * nativeAckFailClosed.test.ts — P0: NATIVE DONANIM KOMUTLARINDA SAHTE ACK KİLİDİ.
 *
 * ── ONARILAN KUSUR (denetimle kanıtlandı) ───────────────────────────────────
 * Zincir: `CarLauncherPlugin.java` → `nativePlugin.ts` → `bridge.ts` →
 * `vehicleCommandQueue` → `commandExecutor._runVehiclePort` → TTS.
 *
 * Java `sendMcuCommand` başarısız olduğunda bile `call.resolve({sent:false})`
 * yapıyordu; `nativePlugin` dönüşü `Promise<void>` ilan ettiği için `sent`
 * TİP SEVİYESİNDE görünmezdi; `bridge` promise çözülür çözülmez
 * `status:'completed'` üretiyordu. Sonuç: **MCU bağlı değilken kullanıcıya
 * "Kapılar kilitlendi" / "Korna çalındı" deniyordu.**
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · `sent === true` DIŞINDAKİ HER ŞEY başarısızdır (fail-closed).
 *  · Eksik/bozuk native yükünde başarı VARSAYILMAZ.
 *  · Başarısız komutta BAŞARI METNİ üretilmez.
 *  · Timeout ve native exception fail-closed KALIR (davranış değişmedi).
 *  · Demo/simülasyon sonucu gerçek donanım ACK'inden AYIRT EDİLEBİLİR.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Yürütücünün DIŞ dünyası izole (maviFakeAck deseni birebir) ──────────── */
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), speakAlert: vi.fn(),
  ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/dtcService', () => ({
  // P0-OBD-10: silme envanteri (stored + pending). Testte kod VAR sayılır.
  getClearableDtcSnapshot: () => ({ codes: [], count: 1, scanRan: true }),
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
  onDTCState: (cb: (s: unknown) => void) => {
    cb({ codes: [], isReading: false, isClearing: false, lastReadAt: 1, error: null, isStale: false });
    return () => {};
  },
}));

import { mapNativeVehicleResult, type CommandResult, type VehicleCommandType } from '../platform/bridge';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import { buildIntentExecutionFeedback, type IntentExecutionResult } from '../platform/intentExecutionResult';
import type { AppIntent, IntentType } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';
import type { NativeVehicleCommandResult } from '../platform/nativePlugin';

/* ══════════════════════════════════════════════════════════════════════════
 * Harness
 * ════════════════════════════════════════════════════════════════════════ */

const CMD_ID = 'c-1';
const TYPE: VehicleCommandType = 'LOCK_DOORS';

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    // Duruyor: HARDWARE_UNLOCK'ın hareket kapısı bu testin konusu DEĞİL.
    vehicleCtx: { speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped' } as unknown as VehicleContext,
    /* P0-GÖREV-3: donanım eylemleri artık AÇIK ONAY ister. Bu dosya ONAY kapısını
       değil NATIVE ACK katmanını ölçer → onay VERİLMİŞ kabul edilir. Onay kapısının
       kendi kilitleri `hardwareConfirmationGate.test.ts` içindedir. */
    actionConfirmed: true,
    defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(), setTheme: vi.fn(),
    ...over,
  } as unknown as CommandContext;
}

async function run(type: IntentType, over: Partial<CommandContext> = {}): Promise<IntentExecutionResult> {
  return executeIntent({ type, payload: {}, priority: 'high' } as AppIntent, ctx(over));
}

/** GERÇEK köprü eşlemesinden geçmiş port — katmanlar arası bağı korur. */
function portFromNative(native: NativeVehicleCommandResult | null | undefined) {
  return vi.fn(async (): Promise<CommandResult> => mapNativeVehicleResult(CMD_ID, TYPE, native));
}

function say(result: IntentExecutionResult): string {
  return buildIntentExecutionFeedback(result)?.message ?? '';
}

/** "Oldu/oluyor" iddiası taşıyan her kalıp — başarısızlıkta HİÇBİRİ çıkmamalı. */
const SUCCESS_RE =
  /(kilitleniyor|kilitlendi|açılıyor|açıldı|çalındı|çalınıyor|yakıldı|yanıp sönüyor|aktifleşti|aktifleştirildi|kapatıldı|tamam, yaptım)/i;

/* ══════════════════════════════════════════════════════════════════════════
 * A — SAF EŞLEME (bridge.mapNativeVehicleResult)
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-ACK · A. native sonuç eşlemesi', () => {
  it('1. sent:true → completed', () => {
    const r = mapNativeVehicleResult(CMD_ID, TYPE, { sent: true });
    expect(r.status).toBe('completed');
    expect(r.error).toBeUndefined();
    expect(r.simulated).toBeUndefined();   // gerçek donanım — simülasyon DEĞİL
  });

  it('2. sent:false → failed (neden korunur)', () => {
    const r = mapNativeVehicleResult(CMD_ID, TYPE, { sent: false, reason: 'mcu_send_failed' });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('mcu_send_failed');
    // Java'nın ürettiği diğer neden de aynı şekilde başarısızdır.
    expect(mapNativeVehicleResult(CMD_ID, TYPE, { sent: false, reason: 'whitelist_rejected' }).status).toBe('failed');
  });

  it('2b. sent:false ve neden YOKSA da failed (sessiz başarı YOK)', () => {
    const r = mapNativeVehicleResult(CMD_ID, TYPE, { sent: false });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('not_sent');
  });

  it('3. `sent` alanı YOK → failed', () => {
    const r = mapNativeVehicleResult(CMD_ID, TYPE, {} as NativeVehicleCommandResult);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('malformed_native_result');
  });

  it('4. malformed/eksik yük → failed (null · undefined · yanlış tip)', () => {
    for (const bad of [null, undefined,
      'ok' as unknown as NativeVehicleCommandResult,
      { sent: 'true' } as unknown as NativeVehicleCommandResult,
      { sent: 1 } as unknown as NativeVehicleCommandResult]) {
      const r = mapNativeVehicleResult(CMD_ID, TYPE, bad);
      expect(r.status).toBe('failed');
      expect(r.error).toBe('malformed_native_result');
    }
  });

  it('4b. demo/simülasyon GERÇEK ACK ile karışmaz', () => {
    const r = mapNativeVehicleResult(CMD_ID, TYPE, { sent: true, reason: 'simulated' });
    expect(r.status).toBe('completed');
    expect(r.simulated).toBe(true);       // AÇIK metadata
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — KUYRUK: exception ve timeout fail-closed KALIR
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-ACK · B. kuyruk davranışı', () => {
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  /** Kuyruğu izole modül grafiğinde, native platform AÇIKKEN kurar. */
  async function freshQueue(carLauncher: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
      registerPlugin: () => carLauncher,
    }));
    /* GERÇEK modül korunur, yalnız `CarLauncher` değiştirilir → `isNativeCommandSent`
       (tek doğruluk yüklemi) MOCK'LANMAZ, üretimdeki hâliyle sınanır. */
    vi.doMock('../platform/nativePlugin', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../platform/nativePlugin')>()),
      CarLauncher: carLauncher,
    }));
    const mod = await import('../platform/bridge');
    return mod.vehicleCommandQueue;
  }

  it('5. native REJECT → failed (başarı DEĞİL)', async () => {
    const q = await freshQueue({ honkHorn: vi.fn(async () => { throw new Error('plugin patladı'); }) });
    const res = await q.enqueue('HONK_HORN');
    expect(res.status).toBe('failed');
    expect(res.status).not.toBe('completed');
    expect(res.error).toContain('plugin patladı');
  });

  it('5b. native sent:false → failed (kuyruk uçtan uca)', async () => {
    const q = await freshQueue({ lockDoors: vi.fn(async () => ({ sent: false, reason: 'mcu_send_failed' })) });
    const res = await q.enqueue('LOCK_DOORS');
    expect(res.status).toBe('failed');
    expect(res.error).toBe('mcu_send_failed');
  });

  it('5c. native sent:true → completed (mevcut başarılı davranış KORUNUR)', async () => {
    const q = await freshQueue({ lockDoors: vi.fn(async () => ({ sent: true })) });
    const res = await q.enqueue('LOCK_DOORS');
    expect(res.status).toBe('completed');
    expect(res.simulated).toBeUndefined();
  });

  it('6. TIMEOUT → rejected (fail-closed davranış DEĞİŞMEDİ)', async () => {
    vi.useFakeTimers();
    // Hiç çözülmeyen native çağrı → 500 ms ACK penceresi dolmalı.
    const q = await freshQueue({ honkHorn: vi.fn(() => new Promise<never>(() => {})) });
    const p = q.enqueue('HONK_HORN');
    await vi.advanceTimersByTimeAsync(600);
    const res = await p;
    expect(res.status).toBe('rejected');
    expect(res.status).not.toBe('completed');
    expect(res.error).toMatch(/timeout/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — YÜRÜTÜCÜ + KULLANICI CEVABI (sahte başarı ve sahte TTS YOK)
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-ACK · C. yürütücü sonucu ve TTS', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('7. sent:false → BAŞARI TTS\'i ÜRETİLMEZ', async () => {
    const r = await run('HARDWARE_LOCK', { hwLockDoors: portFromNative({ sent: false, reason: 'mcu_send_failed' }) });
    const msg = say(r);
    expect(msg).not.toMatch(SUCCESS_RE);
    expect(msg).toBe('Komut araca gönderilemedi.');
  });

  it('8. sent:false → commandExecutor SUCCEEDED DEĞİL', async () => {
    const port = portFromNative({ sent: false, reason: 'mcu_send_failed' });
    const r = await run('HARDWARE_LOCK', { hwLockDoors: port });
    expect(port).toHaveBeenCalledTimes(1);          // kapı geçildi, port çağrıldı
    expect(r.status).toBe('failed');
    expect(r.status).not.toBe('succeeded');
    expect(r.reason).toContain('mcu_send_failed');  // neden telemetriye taşındı
  });

  /* 9-12: DÖRT donanım sınıfının TAMAMI — biri unutulursa bu kilit düşer. */
  const CASES: ReadonlyArray<readonly [IntentType, keyof CommandContext]> = [
    ['HARDWARE_LOCK',      'hwLockDoors'],
    ['HARDWARE_HORN',      'hwHonkHorn'],
    ['HARDWARE_FLASH',     'hwFlashLights'],
    ['HARDWARE_ALARM_ON',  'hwAlarmOn'],
    ['HARDWARE_ALARM_OFF', 'hwAlarmOff'],
    ['HARDWARE_UNLOCK',    'hwUnlockDoors'],
  ];

  for (const [intentType, portKey] of CASES) {
    it(`9-12. ${intentType}: sent:false BAŞARI SAYILMAZ ve başarı metni çıkmaz`, async () => {
      const r = await run(intentType, { [portKey]: portFromNative({ sent: false, reason: 'mcu_send_failed' }) } as Partial<CommandContext>);
      expect(r.status).toBe('failed');
      expect(say(r)).not.toMatch(SUCCESS_RE);
    });

    it(`9-12b. ${intentType}: sent:true eski BAŞARILI davranışı korur`, async () => {
      const r = await run(intentType, { [portKey]: portFromNative({ sent: true }) } as Partial<CommandContext>);
      expect(r.status).toBe('succeeded');
      expect(r.reason).toBe('ack');
    });
  }

  it('C-son. simülasyon başarısı GERÇEK ACK\'ten ayrı gerekçe taşır', async () => {
    const r = await run('HARDWARE_HORN', { hwHonkHorn: portFromNative({ sent: true, reason: 'simulated' }) });
    expect(r.status).toBe('succeeded');
    expect(r.reason).toBe('ack_simulated');   // gerçek 'ack' ile KARIŞMAZ
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — İKİNCİ NATIVE YOL: nativeCommandBridge.executeMcuCommand
 * ════════════════════════════════════════════════════════════════════════
 * Bu yol uyku/WebView-kapalı sırasında biriken UZAK komutları işler ve sonucu
 * buluta `completed`/`failed` olarak raporlar. Denetimde AYNI sahte-ACK kusuru
 * burada da bulundu: çağrı yalnız `await` ediliyor, sonuç OKUNMUYORDU → MCU
 * bağlı değilken uzaktaki kullanıcı komutu "tamamlandı" görüyordu. */

describe('P0-ACK · D. nativeCommandBridge ikinci yolu', () => {
  afterEach(() => { vi.resetModules(); });

  async function freshMcu(carLauncher: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
      registerPlugin: () => carLauncher,
    }));
    vi.doMock('../platform/nativePlugin', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../platform/nativePlugin')>()),
      CarLauncher: carLauncher,
    }));
    vi.doMock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
    const mod = await import('../platform/nativeCommandBridge');
    return mod.executeMcuCommand;
  }

  it('D1. sent:false → failed (uzak kullanıcıya "tamamlandı" RAPORLANMAZ)', async () => {
    const exec = await freshMcu({ lockDoors: vi.fn(async () => ({ sent: false, reason: 'mcu_send_failed' })) });
    expect(await exec('lock')).toBe('failed');
  });

  it('D2. malformed native yük → failed', async () => {
    const exec = await freshMcu({ honkHorn: vi.fn(async () => undefined) });
    expect(await exec('horn')).toBe('failed');
  });

  it('D3. sent:true → completed (mevcut başarılı davranış KORUNUR)', async () => {
    const exec = await freshMcu({ unlockDoors: vi.fn(async () => ({ sent: true })) });
    expect(await exec('unlock')).toBe('completed');
  });

  it('D4. altı komutun TAMAMI sent:false iken failed', async () => {
    const fail = vi.fn(async () => ({ sent: false, reason: 'whitelist_rejected' }));
    const exec = await freshMcu({
      lockDoors: fail, unlockDoors: fail, honkHorn: fail,
      flashLights: fail, triggerAlarm: fail, stopAlarm: fail,
    });
    for (const t of ['lock', 'unlock', 'horn', 'lights_on', 'alarm_on', 'alarm_off'] as const) {
      expect(await exec(t)).toBe('failed');
    }
  });

  it('D5. native exception → failed', async () => {
    const exec = await freshMcu({ honkHorn: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await exec('horn')).toBe('failed');
  });
});
