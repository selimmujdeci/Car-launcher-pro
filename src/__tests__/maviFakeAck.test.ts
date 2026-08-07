/**
 * maviFakeAck.test.ts — MAVI-M3 · SAHTE ONAY YASAĞI (sonuç-temelli geri bildirim).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 (#146, P0) kanıtladı: yerel yolda `voiceService.dispatch` parser'ın hazır
 * metnini ("Kapılar kilitleniyor" · "Arıza kayıtları siliniyor" · "Araç sistemleri
 * taranıyor") YÜRÜTMEDEN ÖNCE ve sonuçtan BAĞIMSIZ seslendiriyordu; `routeIntent`
 * ise port yokluğu / `break` nedeniyle HİÇBİR ŞEY yapmıyordu.
 *
 * ── M4 GÜNCELLEMESİ (kilit KALDIRILMADI, YENİ DOĞRU DAVRANIŞA TAŞINDI) ──────
 * MAVI-M4 iki yürütücüyü teke indirdi. Araç etkili intent'lerin yürütücüsü artık
 * `routeIntent` DEĞİL, TEK OTORİTE'dir: `commandExecutor.dispatchIntent`
 * (kapı: `action/maviActionAuthority`). Bu dosyanın harness'ı bu yüzden
 * `routeIntent` yerine `executeIntent` koşturur — KİLİTLENEN SÖZLEŞME AYNIDIR,
 * yalnız sözleşmenin uygulandığı katman değişmiştir. Portlar `RouterContext`ten
 * `CommandContext`e taşındı (bkz. §H guard'ı: routeIntent artık port ÇAĞIRAMAZ).
 *
 * KİLİTLENEN SÖZLEŞME:
 *   Intent seçildi ≠ Eylem başladı ≠ Eylem başarıyla tamamlandı
 *
 *  · Port yok → UNSUPPORTED; "…yapıldı/…yapılıyor" ASLA denmez.
 *  · Fire-and-forget çağrı → en fazla UNKNOWN, asla SUCCEEDED.
 *  · Yıkıcı işlem (DTC silme) onaysız BAŞLATILAMAZ ve `clearDTCCodes` ÇAĞRILMAZ.
 *  · M2 hareket matrisi korunur: `HARDWARE_UNLOCK` yalnız DOĞRULANMIŞ `stopped`.
 *  · Sonuç başına EN FAZLA BİR geri bildirim zarfı.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const H = vi.hoisted(() => ({
  dtcState: {
    codes: [] as Array<{ severity: string; description: string }>,
    isReading: false, isClearing: false, lastReadAt: 1, error: null as string | null, isStale: false,
  },
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
}));

/* Araç etkili yürütücülerin DIŞ dünyası izole edilir — bu dosya SONUÇ
 * SÖZLEŞMESİNİ ölçer, gerçek OBD/TTS/native yan etkisini değil. */
vi.mock('../platform/bridge', () => ({
  isNative: false,
  bridge: { callNumber: vi.fn(), launchMusicSearch: vi.fn(), launchMusicQuery: vi.fn() },
}));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), speakAlert: vi.fn(),
  ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/dtcService', () => ({
  readDTCCodes:  (...a: unknown[]) => H.readDTCCodes(...(a as [])),
  clearDTCCodes: (...a: unknown[]) => H.clearDTCCodes(...(a as [])),
  onDTCState:    (cb: (s: unknown) => void) => { cb(H.dtcState); return () => {}; },
}));

import { routeIntent, type RouterContext, type AppIntent, type IntentType } from '../platform/intentEngine';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import {
  buildIntentExecutionFeedback,
  intentResult,
  type IntentExecutionResult,
  type IntentExecutionStatus,
} from '../platform/intentExecutionResult';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ── Harness ──────────────────────────────────────────────────────────────── */

/** Hareket bağlamı — M2 sözleşmesi (`unknown` ≠ `parked`). */
function motion(state?: 'moving' | 'stopped' | 'unknown'): VehicleContext {
  return {
    speedKmh: state === 'moving' ? 90 : 0,
    drivingMode: state === 'moving' ? 'driving' : 'idle',
    isDriving: state === 'moving',
    ...(state ? { motionState: state } : {}),
  } as unknown as VehicleContext;
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: motion(),
    defaultNav: 'maps',
    defaultMusic: 'spotify',
    launch: vi.fn(),
    openDrawer: vi.fn(),
    setTheme: vi.fn(),
    ...over,
  } as unknown as CommandContext;
}

function intent(type: IntentType, payload: Record<string, unknown> = {}): AppIntent {
  return { type, payload, priority: 'high' } as AppIntent;
}

/**
 * P0-GÖREV-3: altı donanım eylemi artık AÇIK ONAY ister. Bu dosya ONAY kapısını
 * değil **sonuç sözleşmesini** (unsupported/failed/unknown/succeeded) ölçer →
 * donanım intent'leri için onay VERİLMİŞ kabul edilir. `CLEAR_DTC_CODES` ve
 * `OPEN_PHONE` BİLEREK dışarıdadır: onların onay kilitleri bu dosyada yaşar.
 * Çağıran `over` ile bunu ezebilir (onaysız yolu sınamak için).
 */
const AUTO_CONFIRM: ReadonlySet<IntentType> = new Set<IntentType>([
  'HARDWARE_LOCK', 'HARDWARE_UNLOCK', 'HARDWARE_HORN',
  'HARDWARE_FLASH', 'HARDWARE_ALARM_ON', 'HARDWARE_ALARM_OFF',
]);

/** TEK OTORİTE üzerinden koşturur (M4: `routeIntent` DEĞİL). */
async function run(type: IntentType, over: Partial<CommandContext> = {}): Promise<IntentExecutionResult> {
  const auto = AUTO_CONFIRM.has(type) ? { actionConfirmed: true } : {};
  return executeIntent(intent(type), ctx({ ...auto, ...over }));
}

/** ACK döndüren sahte donanım portu. */
function ackPort(status: 'completed' | 'rejected' | 'failed' = 'completed') {
  return vi.fn(async () => ({ commandId: 'c1', type: 'x' as never, status }));
}

/** Sonucun kullanıcıya dönüşen metni (yoksa boş string). */
function say(result: IntentExecutionResult): string {
  return buildIntentExecutionFeedback(result)?.message ?? '';
}

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar (belge metni suç değildir). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Yürütme öncesi "oluyor/oldu" iddiası taşıyan kalıplar. */
const PROGRESS_OR_SUCCESS_RE =
  /(kilitleniyor|kilitlendi|açılıyor|açıldı|siliniyor|silindi|taranıyor|tarandı|kontrol ediliyor|çalınıyor|yanıp sönüyor|aktifleştiriliyor|durduruluyor|kapatılıyor)/i;

beforeEach(() => {
  H.dtcState = { codes: [], isReading: false, isClearing: false, lastReadAt: 1, error: null, isStale: false };
  H.readDTCCodes.mockReset().mockImplementation(async () => {});
  H.clearDTCCodes.mockReset().mockImplementation(async () => ({ allowed: true, userMessage: '' }));
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — HARDWARE_LOCK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · HARDWARE_LOCK', () => {
  it('1. port YOK → UNSUPPORTED', async () => {
    const r = await run('HARDWARE_LOCK');
    expect(r.status).toBe('unsupported');
    expect(r.reason).toBe('no_port');
  });

  it('2. port yokken "kilitleniyor/kilitlendi" metni ÜRETİLMEZ', async () => {
    const msg = say(await run('HARDWARE_LOCK'));
    expect(msg).not.toMatch(PROGRESS_OR_SUCCESS_RE);
    expect(msg).toBe('Bu araçta kapı kilitleme bağlantısı henüz hazır değil.');
  });

  it('3. port `completed` dönerse → SUCCEEDED (yalnız o zaman)', async () => {
    const hwLockDoors = ackPort('completed');
    const r = await run('HARDWARE_LOCK', { hwLockDoors });
    expect(hwLockDoors).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('succeeded');
  });

  it('4. port reject/throw → FAILED (başarı iddiası YOK)', async () => {
    const hwLockDoors = vi.fn(async () => { throw new Error('bridge down'); });
    const r = await run('HARDWARE_LOCK', { hwLockDoors: hwLockDoors as never });
    expect(r.status).toBe('failed');
    expect(say(r)).not.toMatch(PROGRESS_OR_SUCCESS_RE);
  });

  it('4b. port `rejected`/`failed` statüsü → FAILED', async () => {
    for (const status of ['rejected', 'failed'] as const) {
      expect((await run('HARDWARE_LOCK', { hwLockDoors: ackPort(status) })).status).toBe('failed');
    }
  });

  it('5. fire-and-forget / sonuçsuz dönüş → UNKNOWN, ASLA SUCCEEDED', async () => {
    const hwLockDoors = vi.fn(async () => undefined as never);
    const r = await run('HARDWARE_LOCK', { hwLockDoors });
    expect(r.status).toBe('unknown');
    expect(r.status).not.toBe('succeeded');
    expect(say(r)).toBe('İşlemin sonucunu doğrulayamadım.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — HARDWARE_UNLOCK (M2 matrisi korunur)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · HARDWARE_UNLOCK — M2 hareket matrisi', () => {
  it('6. moving → DENIED; port ÇAĞRILMAZ', async () => {
    const hwUnlockDoors = ackPort();
    const r = await run('HARDWARE_UNLOCK', { hwUnlockDoors, vehicleCtx: motion('moving') });
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('vehicle_moving');
    expect(hwUnlockDoors).not.toHaveBeenCalled();
    expect(say(r)).toBe('Araç hareketliyken kapıları açamam.');
  });

  it('7. unknown → DENIED; port ÇAĞRILMAZ (fail-closed)', async () => {
    const hwUnlockDoors = ackPort();
    const r = await run('HARDWARE_UNLOCK', { hwUnlockDoors, vehicleCtx: motion('unknown') });
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('motion_unverified');
    expect(hwUnlockDoors).not.toHaveBeenCalled();
    expect(say(r)).toBe('Araç durumunu doğrulayamadığım için kapıları açamıyorum.');
  });

  it('7b. bağlam HİÇ taşınmadıysa da DENIED (fail-closed — varsayılan "park" YOK)', async () => {
    const hwUnlockDoors = ackPort();
    const r = await run('HARDWARE_UNLOCK', { hwUnlockDoors, vehicleCtx: motion('unknown') });
    expect(r.status).toBe('denied');
    expect(hwUnlockDoors).not.toHaveBeenCalled();
  });

  it('8. stopped + port YOK → UNSUPPORTED (güvenlik geçti, yürütücü yok)', async () => {
    const r = await run('HARDWARE_UNLOCK', { vehicleCtx: motion('stopped') });
    expect(r.status).toBe('unsupported');
    expect(say(r)).toBe('Bu araçta kapı açma bağlantısı henüz hazır değil.');
  });

  it('9. stopped + başarı → SUCCEEDED', async () => {
    const hwUnlockDoors = ackPort('completed');
    const r = await run('HARDWARE_UNLOCK', { hwUnlockDoors, vehicleCtx: motion('stopped') });
    expect(hwUnlockDoors).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('succeeded');
  });

  it('10. stopped + ret/throw → FAILED', async () => {
    expect((await run('HARDWARE_UNLOCK', {
      hwUnlockDoors: ackPort('rejected'), vehicleCtx: motion('stopped'),
    })).status).toBe('failed');
    const thrower = vi.fn(async () => { throw new Error('x'); });
    expect((await run('HARDWARE_UNLOCK', {
      hwUnlockDoors: thrower as never, vehicleCtx: motion('stopped'),
    })).status).toBe('failed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — CLEAR_DTC_CODES (yıkıcı — onay şart)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · CLEAR_DTC_CODES', () => {
  it('11. açık onay yok → CONFIRMATION_REQUIRED', async () => {
    const r = await run('CLEAR_DTC_CODES');
    expect(r.status).toBe('needs_confirmation');
    expect(say(r)).toBe('Arıza kayıtlarını silmek için açık onayın gerekiyor.');
  });

  it('12/16. onaysız yolda "siliniyor/silindi" ASLA denmez ve başarı ACK üretilmez', async () => {
    const msg = say(await run('CLEAR_DTC_CODES'));
    expect(msg).not.toMatch(PROGRESS_OR_SUCCESS_RE);
    expect(buildIntentExecutionFeedback(await run('CLEAR_DTC_CODES'))?.severity).not.toBe('success');
  });

  it('12b. onaysız çağrıda gerçek yürütücü (clearDTCCodes/WriteGate) ÇAĞRILMAZ', async () => {
    await run('CLEAR_DTC_CODES');
    expect(H.clearDTCCodes).not.toHaveBeenCalled();
  });

  it('13. `intentEngine` DTC yürütücüsünü hiç görmez (ikinci otorite yolu kapalı)', () => {
    // Sözleşme kaynak düzeyinde de kilitli: intentEngine WriteGate'i bypass edemez.
    // Yorumlar hariç tutulur — kilit YALNIZ gerçek koda bakar.
    const code = stripComments(readFileSync(join(process.cwd(), 'src', 'platform', 'intentEngine.ts'), 'utf8'));
    expect(code).not.toMatch(/clearDTCCodes/);
    expect(code).not.toMatch(/from '\.\/dtcService'/);
  });

  it('14/15. sözleşme SUCCEEDED ve FAILED metinlerini yalnız kanıtla üretir', () => {
    expect(buildIntentExecutionFeedback(
      intentResult('CLEAR_DTC_CODES', 'succeeded', 'ack', 'Arıza kayıtları silindi'),
    )?.message).toBe('Arıza kayıtları silindi');
    expect(buildIntentExecutionFeedback(
      intentResult('CLEAR_DTC_CODES', 'failed', 'write_gate_denied'),
    )?.message).toBe('Bunu yapamadım.');
    expect(buildIntentExecutionFeedback(
      intentResult('CLEAR_DTC_CODES', 'denied', 'vehicle_moving'),
    )?.severity).toBe('error');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — CHECK_VEHICLE_HEALTH
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · CHECK_VEHICLE_HEALTH', () => {
  it('17. okuma BAŞARISIZ (stale) → FAILED; "temiz/taranıyor" DENMEZ', async () => {
    H.dtcState = { ...H.dtcState, isStale: true, error: 'OBD okuyucu yanıt vermiyor' };
    const r = await run('CHECK_VEHICLE_HEALTH');
    expect(r.status).toBe('failed');
    expect(r.status).not.toBe('succeeded');
    expect(say(r)).not.toMatch(PROGRESS_OR_SUCCESS_RE);
  });

  it('19/20. tarama tamamlandı ve kanıt geldi → SUCCEEDED + YÜRÜTÜCÜNÜN gerçek özeti', async () => {
    H.dtcState = {
      ...H.dtcState, isStale: false,
      codes: [{ severity: 'critical', description: 'Motor arızası' }],
    };
    const r = await run('CHECK_VEHICLE_HEALTH');
    expect(r.status).toBe('succeeded');
    expect(say(r)).toContain('Motor arızası');   // uydurulmuş "araç sağlıklı" YOK
  });

  it('21. tarama hata verdi (throw) → FAILED', async () => {
    H.readDTCCodes.mockImplementation(async () => { throw new Error('obd down'); });
    const r = await run('CHECK_VEHICLE_HEALTH');
    expect(r.status).toBe('failed');
  });

  it('18. STARTED metni "…yapılıyor" tonundadır ve YALNIZ started için üretilir', () => {
    expect(buildIntentExecutionFeedback(
      intentResult('CHECK_VEHICLE_HEALTH', 'started', 'scan_started', 'Araç sağlık ekranını açıyorum.'),
    )?.message).toBe('Araç sağlık ekranını açıyorum.');
    // "yapıldı" tonu started'da ÜRETİLMEZ
    expect(buildIntentExecutionFeedback(intentResult('CHECK_VEHICLE_HEALTH', 'started'))?.message)
      .toBe('Başlatıyorum.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Kalan donanım sınıfı (aynı kök neden)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · kalan donanım komutları — sahte ACK bırakılmadı', () => {
  const NO_PORT: IntentType[] = [
    'HARDWARE_HORN', 'HARDWARE_FLASH', 'HARDWARE_ALARM_ON', 'HARDWARE_ALARM_OFF',
    'HARDWARE_REAR_CAMERA', 'HARDWARE_LIGHTS_OFF', 'HARDWARE_SCREEN_OFF',
  ];

  it('port yokken hepsi UNSUPPORTED ve hiçbiri ilerleme/başarı sesi üretmez', async () => {
    for (const t of NO_PORT) {
      const r = await run(t);
      expect(r.status, t).toBe('unsupported');
      expect(r.reason, t).toBe('no_port');
      expect(say(r), t).not.toMatch(PROGRESS_OR_SUCCESS_RE);
    }
  });

  it('native karşılığı OLMAYAN üçlü port BAĞLANSA BİLE deftere göre desteklenmez', async () => {
    // `hwRearCamera`/`hwLightsOff`/`hwScreenOff` `CommandContext`te TANIMLI DEĞİL →
    // "yanlışlıkla bağladım" durumu tip düzeyinde de imkânsızdır.
    for (const t of ['HARDWARE_REAR_CAMERA', 'HARDWARE_LIGHTS_OFF', 'HARDWARE_SCREEN_OFF'] as IntentType[]) {
      expect((await run(t, { hwHonkHorn: ackPort() })).status, t).toBe('unsupported');
    }
  });

  it('port varsa bile ACK dönmeyen (void) çağrı SUCCEEDED üretmez → UNKNOWN', async () => {
    const hwHonkHorn = vi.fn();
    const r = await run('HARDWARE_HORN', { hwHonkHorn });
    expect(hwHonkHorn).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('unknown');
    expect(r.status).not.toBe('succeeded');
  });

  it('port throw ederse FAILED (exception başarıya çevrilmez)', async () => {
    const hwAlarmOn = vi.fn(() => { throw new Error('can bus'); });
    expect((await run('HARDWARE_ALARM_ON', { hwAlarmOn })).status).toBe('failed');
  });

  it('port `completed` dönerse SUCCEEDED (korna/far/alarm gerçekten yürür)', async () => {
    expect((await run('HARDWARE_HORN',      { hwHonkHorn:    ackPort() })).status).toBe('succeeded');
    expect((await run('HARDWARE_FLASH',     { hwFlashLights: ackPort() })).status).toBe('succeeded');
    expect((await run('HARDWARE_ALARM_ON',  { hwAlarmOn:     ackPort() })).status).toBe('succeeded');
    expect((await run('HARDWARE_ALARM_OFF', { hwAlarmOff:    ackPort() })).status).toBe('succeeded');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — Genel sözleşme + geriye uyumluluk
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · genel sözleşme', () => {
  it('22. `not_handled` (handled=true) tek başına başarı SAYILMAZ → feedback YOK', async () => {
    const r = await routeIntent(intent('OPEN_SETTINGS'), routerCtx());
    expect(r.status).toBe('not_handled');
    expect(buildIntentExecutionFeedback(r)).toBeNull();
  });

  it('25. sonuç başına EN FAZLA BİR zarf üretilir', async () => {
    const r = await run('HARDWARE_LOCK');
    const a = buildIntentExecutionFeedback(r);
    const b = buildIntentExecutionFeedback(r);
    expect(a).not.toBeNull();
    expect(a?.message).toBe(b?.message);          // saf → tekrar üretim aynı, yan etki yok
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('26. bilinmeyen/UNKNOWN intent mevcut fallback\'i BOZMAZ', async () => {
    const r = await routeIntent(intent('UNKNOWN'), routerCtx());
    expect(r.status).toBe('not_handled');
    expect(buildIntentExecutionFeedback(r)).toBeNull();
  });

  it('28. düşük riskli yerel intent\'ler geriye uyumlu (eski davranış + ek ses YOK)', async () => {
    const openDrawer = vi.fn();
    const playMedia = vi.fn();
    const setTheme = vi.fn();
    const r1 = await routeIntent(intent('OPEN_FAVORITES'), routerCtx({ openDrawer }));
    const r2 = await routeIntent(intent('PLAY_MEDIA'), routerCtx({ playMedia }));
    const r3 = await routeIntent(intent('SET_THEME'), routerCtx({ setTheme }));
    expect(openDrawer).toHaveBeenCalledWith('apps');
    expect(playMedia).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledTimes(1);
    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe('not_handled');
      expect(buildIntentExecutionFeedback(r)).toBeNull();
    }
  });

  it('bozuk/eksik sonuç → null (throw YOK)', () => {
    expect(buildIntentExecutionFeedback(null)).toBeNull();
    expect(buildIntentExecutionFeedback(undefined)).toBeNull();
    expect(buildIntentExecutionFeedback({ intent: 'HARDWARE_LOCK' } as never)).toBeNull();
  });

  it('her statü için ton kuralı: "yapılıyor" yalnız started, "yaptım" yalnız succeeded', () => {
    const statuses: IntentExecutionStatus[] = [
      'needs_confirmation', 'denied', 'unsupported', 'started', 'succeeded', 'failed', 'unknown',
    ];
    for (const st of statuses) {
      const fb = buildIntentExecutionFeedback(intentResult('HARDWARE_LOCK', st));
      expect(fb, st).not.toBeNull();
      if (st === 'succeeded') expect(fb?.severity).toBe('success');
      else expect(fb?.severity, st).not.toBe('success');
    }
  });
});

/** Düşük riskli (araç etkili OLMAYAN) intent'ler için eski router bağlamı. */
function routerCtx(over: Partial<RouterContext> = {}): RouterContext {
  return {
    launch: vi.fn(), openDrawer: vi.fn(), setTheme: vi.fn(),
    playMedia: vi.fn(), pauseMedia: vi.fn(),
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * G — GUARD: sahte ACK yolu geri gelemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M3 · guard — sahte ACK yolu kapalı', () => {
  const VOICE_SRC = readFileSync(join(process.cwd(), 'src', 'platform', 'voiceService.ts'), 'utf8');

  it('davranışsal/yıkıcı intent\'ler TEK OTORİTEDE sonuç sözleşmesi ÜRETİR', async () => {
    const BEHAVIORAL: IntentType[] = [
      'HARDWARE_LOCK', 'HARDWARE_UNLOCK', 'HARDWARE_HORN', 'HARDWARE_FLASH',
      'HARDWARE_ALARM_ON', 'HARDWARE_ALARM_OFF', 'HARDWARE_REAR_CAMERA',
      'HARDWARE_LIGHTS_OFF', 'HARDWARE_SCREEN_OFF',
      'CLEAR_DTC_CODES', 'CHECK_VEHICLE_HEALTH',
    ];
    for (const t of BEHAVIORAL) {
      const r = await run(t);
      // `not_handled` = sözleşme dışı = eski sahte-ACK davranışına dönüş demektir.
      expect(r.status, `${t} sonuç sözleşmesi ÜRETMELİ`).not.toBe('not_handled');
    }
  });

  it('voiceService sonuç-ACK komutlarında parser metnini SESLENDİRMEZ', () => {
    expect(VOICE_SRC).toMatch(/isResultAckCommand/);
    // dispatch + dispatchDriving + dispatchChain → üç seslendirme dalı da korumalı.
    const guarded = VOICE_SRC.match(/isResultAckCommand\(/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(4);   // tanım + 3 dal
  });

  it('sonuç-ACK komut listesi davranışsal araç eylemlerini KAPSAR', () => {
    for (const t of [
      'hw_lock_doors', 'hw_unlock_doors', 'hw_honk_horn', 'hw_flash_lights',
      'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
      'vehicle_clear_dtc', 'vehicle_health_check',
      'call_contact',   // MAVI-M4: onay bekleyen arama "başlatılıyor" DİYEMEZ
    ]) {
      expect(VOICE_SRC, t).toMatch(new RegExp(`'${t}'`));
    }
  });

  it('yürütme sonucu sözleşmesi TTS/UI/store yan etkisi TAŞIMAZ (saf veri)', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'platform', 'intentExecutionResult.ts'), 'utf8');
    for (const forbidden of ['ttsService', 'speakFeedback', 'showToast', 'useStore', 'localStorage']) {
      expect(src, forbidden).not.toMatch(new RegExp(`from '[^']*${forbidden}'`));
    }
    expect(src).not.toMatch(/speak\w*\(/);
  });
});
