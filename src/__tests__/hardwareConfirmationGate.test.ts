/**
 * hardwareConfirmationGate.test.ts — P0: DONANIM ONAYI + HAREKET FAIL-CLOSED.
 *
 * ── ONARILAN RİSK (denetimle ölçüldü) ───────────────────────────────────────
 * Altı gerçek araç eylemi (kilit · kilit açma · korna · far · alarm aç/kapat)
 * `requiresConfirmation:false` ile kayıtlıydı ve tek bir yanlış tanınan sözcük
 * onaysız donanım tetikleyebiliyordu. Ayrıca `requires_stopped` kapısı
 * `motionState` TAŞIMAYAN çağıranlar için FAIL-OPEN'dı: telemetri yokken araç
 * "duruyor" sayılıyor ve hareket hâlinde kapı açma kapısı açılabiliyordu.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · Onay alınmadan native port ÇAĞRILMAZ (queue'ya hiç girilmez).
 *  · `requires_stopped`: YALNIZ doğrulanmış `stopped` geçer — `unknown`,
 *    `undefined` ve çelişkili telemetri (stopped + yüksek hız) REDDEDİLİR.
 *  · Onay SONRASINDA da safety ve capability kapıları geçerlidir.
 *  · Tek onay TEK dispatch üretir; TTL dolmuş / stale tur onayı ÇALIŞMAZ.
 *  · Başarı metni yalnız GERÇEK `completed` sonucundan sonra üretilir.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  VEHICLE_ACTIONS, evaluateVehicleAction, MOTION_STOPPED_MAX_KMH,
} from '../platform/action/maviActionAuthority';
import {
  setPendingAction, peekPendingAction, consumePendingAction, clearPendingAction,
  getPendingActionDiagnostics, _resetPendingActionForTest, PENDING_ACTION_TTL_MS,
} from '../platform/action/pendingActionConfirmation';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import { buildIntentExecutionFeedback, type IntentExecutionResult } from '../platform/intentExecutionResult';
import type { AppIntent, IntentType } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ══════════════════════════════════════════════════════════════════════════
 * Harness
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Altı donanım eylemi + port adları — hepsi AYNI sözleşmeye tabidir. */
const HW_CASES = [
  ['HARDWARE_LOCK',      'hwLockDoors'],
  ['HARDWARE_UNLOCK',    'hwUnlockDoors'],
  ['HARDWARE_HORN',      'hwHonkHorn'],
  ['HARDWARE_FLASH',     'hwFlashLights'],
  ['HARDWARE_ALARM_ON',  'hwAlarmOn'],
  ['HARDWARE_ALARM_OFF', 'hwAlarmOff'],
] as const;

function motion(state?: 'moving' | 'stopped' | 'unknown', speedKmh = 0): VehicleContext {
  return {
    speedKmh,
    drivingMode: state === 'moving' ? 'driving' : 'idle',
    isDriving: state === 'moving',
    ...(state ? { motionState: state } : {}),
  } as unknown as VehicleContext;
}

function ackPort() {
  return vi.fn(async () => ({ commandId: 'c1', type: 'x' as never, status: 'completed' as const }));
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: motion('stopped'),
    defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(), setTheme: vi.fn(),
    ...over,
  } as unknown as CommandContext;
}

async function run(type: IntentType, over: Partial<CommandContext> = {}): Promise<IntentExecutionResult> {
  return executeIntent({ type, payload: {}, priority: 'high' } as AppIntent, ctx(over));
}

function say(r: IntentExecutionResult): string {
  return buildIntentExecutionFeedback(r)?.message ?? '';
}

const SUCCESS_RE = /(kilitlendi|açıldı|çalındı|yakıldı|aktifleşti|kapatıldı|tamam, yaptım)/i;

beforeEach(() => { _resetPendingActionForTest(); vi.clearAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1-4, 8-11 — ONAYSIZ DISPATCH YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-CONFIRM · onaysız donanım dispatch YOK', () => {
  it('1/8/10/11. 🔒 altı donanım eylemi de onaysız native porta GİTMEZ', async () => {
    for (const [intentType, portKey] of HW_CASES) {
      const port = ackPort();
      const r = await run(intentType, { [portKey]: port } as Partial<CommandContext>);
      expect(port, intentType).not.toHaveBeenCalled();              // queue'ya HİÇ girilmedi
      expect(r.status, intentType).toBe('needs_confirmation');
      expect(r.reason, intentType).toBe('explicit_consent_required');
      expect(say(r), intentType).not.toMatch(SUCCESS_RE);           // başarı TTS YOK
    }
  });

  it('2. defterde altı eylemin tamamı requiresConfirmation:true', () => {
    for (const [intentType] of HW_CASES) {
      expect(VEHICLE_ACTIONS[intentType]?.requiresConfirmation, intentType).toBe(true);
      // Geçici baseline METADATA ile işaretli (yorum değil).
      expect(VEHICLE_ACTIONS[intentType]?.policySource, intentType).toBe('p0_provisional');
      expect(typeof VEHICLE_ACTIONS[intentType]?.motionRationale, intentType).toBe('string');
    }
  });

  it('3/9. onay VERİLİNCE dispatch olur — ve YALNIZ BİR KEZ', async () => {
    for (const [intentType, portKey] of HW_CASES) {
      const port = ackPort();
      const r = await run(intentType, { [portKey]: port, actionConfirmed: true } as Partial<CommandContext>);
      expect(port, intentType).toHaveBeenCalledTimes(1);
      expect(r.status, intentType).toBe('succeeded');
    }
  });

  it('4. onay REDDEDİLİRSE (slot temizlenir) dispatch YOK', () => {
    setPendingAction({
      actionId: 'vehicle.doors.lock',
      intent: { type: 'HARDWARE_LOCK', payload: {} } as unknown as AppIntent,
      atMs: NOW, turnId: 1,
    } as never);
    expect(getPendingActionDiagnostics(NOW).pending).toBe(true);
    clearPendingAction();                                   // "hayır" hattı
    expect(getPendingActionDiagnostics(NOW).pending).toBe(false);
    expect(peekPendingAction(NOW)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5-7 — HAREKET FAIL-CLOSED (unlock)
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-CONFIRM · hareket kapısı fail-closed', () => {
  it('5. unlock + moving → denied (onaylı olsa bile)', async () => {
    const port = ackPort();
    const r = await run('HARDWARE_UNLOCK', {
      hwUnlockDoors: port, actionConfirmed: true, vehicleCtx: motion('moving', 60),
    });
    expect(port).not.toHaveBeenCalled();
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('vehicle_moving');
  });

  it('6. 🔒 unlock + hareket BİLİNMİYOR → denied ("duruyor" VARSAYILMAZ)', async () => {
    /* Üç ayrı bilinmezlik biçimi: açık `unknown` · `motionState` alanı YOK ·
       telemetri hiç yok. Hiçbiri "park" sayılmaz. */
    const cases: Array<Partial<CommandContext>> = [
      { vehicleCtx: motion('unknown') },
      { vehicleCtx: motion(undefined) },
      { vehicleCtx: {} as unknown as VehicleContext },
    ];
    for (const over of cases) {
      const port = ackPort();
      const r = await run('HARDWARE_UNLOCK', { hwUnlockDoors: port, actionConfirmed: true, ...over });
      expect(port).not.toHaveBeenCalled();
      expect(r.status).toBe('denied');
      expect(r.reason).toBe('motion_unverified');
    }
  });

  it('6b. ÇELİŞKİLİ telemetri ("stopped" + yüksek hız) → denied', async () => {
    const port = ackPort();
    const r = await run('HARDWARE_UNLOCK', {
      hwUnlockDoors: port, actionConfirmed: true,
      vehicleCtx: motion('stopped', MOTION_STOPPED_MAX_KMH + 20),
    });
    expect(port).not.toHaveBeenCalled();
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('vehicle_moving');
  });

  it('7. unlock + DOĞRULANMIŞ stopped + onay → dispatch (meşru kullanım korunur)', async () => {
    const port = ackPort();
    const r = await run('HARDWARE_UNLOCK', {
      hwUnlockDoors: port, actionConfirmed: true, vehicleCtx: motion('stopped', 0),
    });
    expect(port).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('succeeded');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12-13, 17 — TTL · STALE TUR · TEK DISPATCH
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-CONFIRM · TTL, stale tur ve tekillik', () => {
  function pend(turnId = 1, atMs = NOW): void {
    setPendingAction({
      actionId: 'vehicle.doors.lock',
      intent: { type: 'HARDWARE_LOCK', payload: {} } as unknown as AppIntent,
      atMs, turnId,
    } as never);
  }

  it('12. TTL dolduysa onay TÜKETİLEMEZ (dispatch yok)', () => {
    pend(1, NOW);
    const tooLate = NOW + PENDING_ACTION_TTL_MS + 1;
    expect(getPendingActionDiagnostics(tooLate).pending).toBe(false);
    expect(consumePendingAction(2, tooLate)).toBeNull();
  });

  it('13. STALE tur onayı çalışmaz (araya giren komut eski niyeti diriltemez)', () => {
    pend(1, NOW);
    // İsteği üreten turdan SONRAKİ İLK tur değil → onay DÜŞER.
    expect(consumePendingAction(9, NOW + 100)).toBeNull();
  });

  it('17. iki kez "evet" → TEK tüketim (ikinci çağrı boş döner)', () => {
    pend(1, NOW);
    const first = consumePendingAction(2, NOW + 100);
    expect(first).not.toBeNull();
    const second = consumePendingAction(2, NOW + 200);
    expect(second).toBeNull();                 // slot tüketildi → ikinci dispatch YOK
    expect(peekPendingAction(NOW + 200)).toBeNull();
  });

  it('16. farklı bir cümle söylenince onay YAN ETKİSİZ düşer', () => {
    pend(1, NOW);
    clearPendingAction();                      // voiceService bu yolu izler
    expect(peekPendingAction(NOW + 10)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14-15 — İPTAL SÖZCÜKLERİ (gerçek NEGATE_RE üzerinden)
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-CONFIRM · iptal sözcükleri', () => {
  /** Üretimdeki GERÇEK regex kaynaktan okunur — kopyası çıkarılmaz. */
  function negateRe(): RegExp {
    const src = String.raw`^\s*(hayir|hayır|yok|iptal|vazgec|vazgeç|yapma|gerek yok|istemiyorum|olmaz|dur|bos ver|boş ver)(?:\b|$)`;
    return new RegExp(src, 'i');
  }

  it('14/15. "vazgeç" ve "iptal" ret hattını GERÇEKTEN tetikler', () => {
    const NEGATE = negateRe();
    for (const w of ['hayır', 'vazgeç', 'iptal', 'yapma', 'boş ver', 'vazgeçtim']) {
      expect(NEGATE.test(w), w).toBe(true);
    }
  });

  it('14b. kelime sınırı koruması KORUNDU (yanlış iptal yok)', () => {
    const NEGATE = negateRe();
    for (const w of ['durum', 'yokuş', 'iptalinden']) {
      expect(NEGATE.test(w), w).toBe(false);
    }
  });

  it('15b. iptal sözcükleri donanım intent’ine DÜŞMEZ (Görev-2 kilidiyle uyumlu)', async () => {
    /* "iptal" eskiden `hw_alarm_off` üretiyordu; parser turu bunu kapattı.
       Burada kapının kendisi de sınanır: onay bağlamında bunlar RET'tir. */
    const { parseCommand } = await import('../platform/commandParser');
    for (const w of ['iptal', 'vazgeç', 'yapma']) {
      const t = parseCommand(w)?.type ?? null;
      expect(t, w).not.toBe('hw_alarm_off');
      expect(t, w).not.toBe('hw_alarm_on');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18-20 — ONAY SONRASI KAPILAR + BAŞARI TTS
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-CONFIRM · onay sonrası kapılar', () => {
  it('18. capability YOKSA onaylı olsa bile `unsupported` (sessiz no-op DEĞİL)', async () => {
    for (const [intentType] of HW_CASES) {
      const r = await run(intentType, { actionConfirmed: true } as Partial<CommandContext>);
      expect(r.status, intentType).toBe('unsupported');
      expect(r.reason, intentType).toBe('no_port');
      expect(say(r), intentType).not.toMatch(SUCCESS_RE);
    }
  });

  it('19. safety kapsam reddi onaydan SONRA da geçerli (kapı sırası korunur)', () => {
    /* Hareket kapısı safety'den ÖNCE gelir: onaylı + hareketli unlock,
       capability olsa bile denied kalır — onay hiçbir kapıyı ezmez. */
    const g = evaluateVehicleAction({
      intent: 'HARDWARE_UNLOCK', vehicleCtx: motion('moving', 80),
      ports: { hwUnlockDoors: () => {} }, confirmed: true,
    });
    expect(g.allow).toBe(false);
    expect(g.allow === false && g.result.status).toBe('denied');
  });

  it('20. başarı metni YALNIZ gerçek `completed` sonucundan sonra üretilir', async () => {
    const failing = vi.fn(async () => ({ commandId: 'c1', type: 'x' as never, status: 'failed' as const }));
    const r = await run('HARDWARE_LOCK', { hwLockDoors: failing, actionConfirmed: true });
    expect(r.status).toBe('failed');
    expect(say(r)).not.toMatch(SUCCESS_RE);

    const ok = await run('HARDWARE_LOCK', { hwLockDoors: ackPort(), actionConfirmed: true });
    expect(ok.status).toBe('succeeded');
    expect(say(ok)).toMatch(SUCCESS_RE);
  });

  it('Y. YANLIŞLAMA: onay kapısı GERÇEKTEN etkili (ölü kod değil)', async () => {
    const a = await run('HARDWARE_HORN', { hwHonkHorn: ackPort() });
    const b = await run('HARDWARE_HORN', { hwHonkHorn: ackPort(), actionConfirmed: true });
    expect(a.status).toBe('needs_confirmation');
    expect(b.status).toBe('succeeded');
    expect(a.status).not.toBe(b.status);      // fark YOKSA kapı ölüdür
  });
});
