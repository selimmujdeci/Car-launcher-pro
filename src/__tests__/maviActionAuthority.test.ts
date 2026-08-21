/**
 * maviActionAuthority.test.ts — MAVI-M4 · TEK EYLEM OTORİTESİ (mimari kilit).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 denetimi kanıtladı: canlı Mavi eylemleri İKİ ayrı yürütücüden geçiyordu
 * (`intentEngine.routeIntent` · `commandExecutor.dispatchIntent`) ve hiçbiri
 * `AiSafetyGate`i görmüyordu. M4 bunu teke indirdi:
 *
 *   parse → safety/onay → TEK execution authority → IntentExecutionResult → M6 tek TTS
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  1. Bir araç etkili action YALNIZ TEK yürütücüde çalışır (`dispatchIntent`).
 *  2. `routeIntent` araç etkili bir portu ÇAĞIRAMAZ (yapısal — port yüzeyi yok).
 *  3. Kapı reddinde yürütücü HİÇ çağrılmaz (port/native/OBD'ye ulaşılmaz).
 *  4. Onay gerektiren action onaysız YÜRÜMEZ.
 *  5. Telefon araması AÇIK KOMUTTA onay beklemeden başlar (2026-07-31 saha
 *     bulgusu: onay kapısı "annemi ara"yı tamamen bloke ediyordu). Koruma
 *     ÇÖZÜMDEDİR: kişi/numara çözülemezse arama BAŞLAMAZ.
 *  6. Telefon araması TAM BİR KEZ başlar ve başarı YALNIZ `placed` kanıtıyla
 *     iddia edilir (`DIAL`/boş dönüş `succeeded` DEĞİLDİR).
 *  7. `HARDWARE_UNLOCK` moving/unknown'da reddedilir (M2 fail-closed).
 *  8. Stopped + capability → unlock yürür.
 *  9. `CLEAR_DTC_CODES` onay + WriteGate olmadan çalışmaz.
 * 10. Gerçek `succeeded` YALNIZ yürütücü kanıtıyla oluşur.
 * 11. Stale tur bir action BAŞLATAMAZ.
 * 12. Her action EN FAZLA tek M6 cevap zarfı üretir.
 * 13. M3 sahte ACK yolu geri gelmez.
 * 14. M2/M5/M6 sözleşmeleri korunur.
 * 15. Action Registry DIŞINDA yeni araç etkili intent eklenemez.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const H = vi.hoisted(() => ({
  /* Köprü artık GERÇEK sonuç döndürür (`CallOutcome`): arama başladı mı, yoksa
     yalnız çevirici mi açıldı. Varsayılan mock "arama BAŞLADI" der; DIAL/boş
     dönüş vakaları aşağıda AYRI kilitlerle sınanır. */
  callNumber: vi.fn(async () => ({ mode: 'CALL' as const, placed: true })),
  dtcState: {
    codes: [{ severity: 'warning', description: 'Lambda sensörü' }],
    isReading: false, isClearing: false, lastReadAt: 1, error: null as string | null, isStale: false,
  },
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
  contacts: [] as Array<{ id: string; name: string; phones: Array<{ label: string; number: string }> }>,
}));

vi.mock('../platform/bridge', () => ({
  isNative: false,
  bridge: {
    callNumber: (...a: unknown[]) => H.callNumber(...(a as [])),
    launchMusicSearch: vi.fn(), launchMusicQuery: vi.fn(),
  },
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
vi.mock('../platform/contactsService', () => ({
  searchContacts: (q: string) => H.contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())),
  recordCall: vi.fn(),
}));

import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import { routeIntent, type RouterContext, type AppIntent, type IntentType } from '../platform/intentEngine';
import {
  VEHICLE_ACTIONS, isVehicleEffectiveIntent, evaluateVehicleAction, getVehicleActionDef,
} from '../platform/action/maviActionAuthority';
import {
  setPendingAction, consumePendingAction, peekPendingAction, clearPendingAction,
  setConfirmedActionExecutor, getConfirmedActionExecutor, _resetPendingActionForTest,
  PENDING_ACTION_TTL_MS,
} from '../platform/action/pendingActionConfirmation';
import { buildIntentExecutionFeedback } from '../platform/intentExecutionResult';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ── Harness ──────────────────────────────────────────────────────────────── */

function motion(state: 'moving' | 'stopped' | 'unknown'): VehicleContext {
  return {
    speedKmh: state === 'moving' ? 90 : 0,
    drivingMode: state === 'moving' ? 'driving' : 'idle',
    isDriving: state === 'moving',
    motionState: state,
  } as unknown as VehicleContext;
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: motion('stopped'),
    /* P0-GÖREV-3: donanım eylemleri açık onay ister. Yürütücü yolunu ölçen
       testler için onay VERİLMİŞ kabul edilir; kapının kendi onay kilitleri
       aşağıda `evaluateVehicleAction` ile DOĞRUDAN sınanır (ctx'ten bağımsız). */
    actionConfirmed: true,
    defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(), setTheme: vi.fn(),
    ...over,
  } as unknown as CommandContext;
}

function intent(type: IntentType, payload: Record<string, unknown> = {}): AppIntent {
  return { type, payload, priority: 'high' } as AppIntent;
}

function ackPort(status: 'completed' | 'rejected' = 'completed') {
  return vi.fn(async () => ({ commandId: 'c', type: 'x' as never, status }));
}

const SRC = (...seg: string[]): string => readFileSync(join(process.cwd(), 'src', ...seg), 'utf8');
/** Kaynak kilitleri YALNIZ gerçek koda bakar — yorum metni suç değildir. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  _resetPendingActionForTest();
  /* Varsayılan: köprü "arama BAŞLADI" kanıtı döndürür. `mockReset` implementasyonu
     da sildiği için burada YENİDEN kurulur — aksi halde her test sessizce
     "sonuç doğrulanamadı" (unknown) yoluna düşerdi. */
  H.callNumber.mockReset().mockImplementation(async () => ({ mode: 'CALL' as const, placed: true }));
  H.readDTCCodes.mockReset().mockImplementation(async () => {});
  H.clearDTCCodes.mockReset().mockImplementation(async () => ({ allowed: true, userMessage: '' }));
  H.dtcState = {
    codes: [{ severity: 'warning', description: 'Lambda sensörü' }],
    isReading: false, isClearing: false, lastReadAt: 1, error: null, isStale: false,
  };
  H.contacts = [{ id: 'k1', name: 'Selim', phones: [{ label: 'mobile', number: '+905551112233' }] }];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Aynı action iki farklı executor tarafından çalıştırılamaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 1. tek yürütücü', () => {
  it('araç etkili HER intent `routeIntent`te YÜRÜTÜLMEZ → otoriteye devreder', async () => {
    const rctx: RouterContext = {
      launch: vi.fn(), openDrawer: vi.fn(), setTheme: vi.fn(),
      playMedia: vi.fn(), pauseMedia: vi.fn(),
    };
    for (const type of Object.keys(VEHICLE_ACTIONS) as IntentType[]) {
      // `OPEN_PHONE` düşük riskli "uygulamayı aç" dalıyla routeIntent'te kalır;
      // ARAMA başlatma dalı ise yalnız otoritededir (bkz. §5).
      if (type === 'OPEN_PHONE') continue;
      const r = await routeIntent(intent(type), rctx);
      expect(r.status, type).toBe('not_handled');
      expect(r.reason, type).toBe('delegated_to_action_authority');
    }
  });

  it('`routeIntent` araç etkili bir eylem için yan etki ÜRETMEZ (launch dahil)', async () => {
    const launch = vi.fn();
    const openDrawer = vi.fn();
    await routeIntent(intent('HARDWARE_UNLOCK'), {
      launch, openDrawer, setTheme: vi.fn(), playMedia: vi.fn(), pauseMedia: vi.fn(),
    });
    expect(launch).not.toHaveBeenCalled();
    expect(openDrawer).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 — routeIntent araç etkili portu doğrudan çağıramaz (YAPISAL)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 2. routeIntent port çağıramaz', () => {
  const CODE = stripComments(SRC('platform', 'intentEngine.ts'));

  it('`RouterContext` hiçbir araç etkili port TAŞIMAZ', () => {
    const block = CODE.slice(CODE.indexOf('export interface RouterContext'), CODE.indexOf('CMD_TO_INTENT'));
    for (const port of [
      'hwLockDoors', 'hwUnlockDoors', 'hwHonkHorn', 'hwFlashLights',
      'hwAlarmOn', 'hwAlarmOff', 'readVehicleHealth', 'vehicleMotionState',
    ]) {
      expect(block, `RouterContext.${port} geri gelmiş`).not.toMatch(new RegExp(port));
    }
  });

  it('`intentEngine` gövdesi donanım/OBD/native yürütücüsüne HİÇ dokunmaz', () => {
    for (const forbidden of [
      'hwLockDoors', 'hwUnlockDoors', 'hwHonkHorn', 'hwFlashLights', 'hwAlarmOn', 'hwAlarmOff',
      'clearDTCCodes', 'readDTCCodes', 'querySensor', 'callNumber', 'CarLauncher',
    ]) {
      expect(CODE, `intentEngine ${forbidden} çağırmamalı`).not.toMatch(new RegExp(`${forbidden}\\s*[(?.]`));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 — Safety reddinde executor çağrılmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 3. safety reddi port çağrısından ÖNCE', () => {
  it('hareket reddinde port ÇAĞRILMAZ (port/native/OBD\'ye ulaşılmaz)', async () => {
    const hwUnlockDoors = ackPort();
    const r = await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ hwUnlockDoors, vehicleCtx: motion('moving') }));
    expect(r.status).toBe('denied');
    expect(hwUnlockDoors).not.toHaveBeenCalled();
  });

  it('kapı sırası KANITLI: hareket → güvenlik → onay → capability', () => {
    // Hareket reddi, port HİÇ verilmemişken bile `unsupported` DEĞİL `denied` üretir
    // → hareket kapısı capability kapısından ÖNCE çalışıyor demektir.
    const moving = evaluateVehicleAction({
      intent: 'HARDWARE_UNLOCK', vehicleCtx: motion('moving'), ports: {},
    });
    expect(moving.allow).toBe(false);
    expect(moving.allow === false && moving.result.status).toBe('denied');

    // Onay reddi de port yokluğundan ÖNCE gelir (CLEAR_DTC capability'siz olsa da
    // önce `needs_confirmation` üretir).
    const unconfirmed = evaluateVehicleAction({
      intent: 'CLEAR_DTC_CODES', vehicleCtx: motion('stopped'), ports: {},
    });
    expect(unconfirmed.allow === false && unconfirmed.result.status).toBe('needs_confirmation');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4/5/6 — Onay sözleşmesi + telefon araması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 4. onay gereken action onaysız çalışmaz', () => {
  it('onay gerektiren HER defter girdisi onaysız `needs_confirmation` döner', () => {
    for (const [type, def] of Object.entries(VEHICLE_ACTIONS)) {
      if (!def?.requiresConfirmation) continue;
      const g = evaluateVehicleAction({
        intent: type as IntentType, vehicleCtx: motion('stopped'), ports: {}, confirmed: false,
      });
      expect(g.allow, type).toBe(false);
      expect(g.allow === false && g.result.status, type).toBe('needs_confirmation');
    }
  });
});

describe('Telefon araması — AÇIK KOMUT ONAY BEKLEMEZ (saha 2026-07-31)', () => {
  /* Bu blok eskiden "onaysız BAŞLAMAZ" diyordu. Sahada ölçüldü: kullanıcı
     "annemi ara" diyor, asistan "onayın gerekiyor" deyip susuyor, arama HİÇ
     başlamıyordu. Kişi adı kullanıcının ağzından çıktığı için komut zaten açık
     talimattır; onay kapısı modelin ÇIKARIMLA başlattığı eylemler içindir.
     ONAY MEKANİZMASI DURUYOR — bkz. aşağıdaki "onay gerektiren HER defter
     girdisi onaysız `needs_confirmation` döner" genel kilidi ve DTC kilitleri. */

  it('🔒 açık komutta arama ONAY BEKLEMEDEN başlar', async () => {
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: false }));
    expect(r.status).not.toBe('needs_confirmation');
    expect(H.callNumber).toHaveBeenCalledTimes(1);
    expect(H.callNumber).toHaveBeenCalledWith('+905551112233');
  });

  it('🔒 onay beklemediği için bekleyen eylem slotu KURULMAZ', async () => {
    await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: false }));
    expect(peekPendingAction()).toBeNull();
  });

  it('🔒 OPEN_PHONE artık onay defterinde ONAY İSTEMEZ olarak kayıtlı', () => {
    const def = getVehicleActionDef('OPEN_PHONE');
    expect(def).toBeDefined();
    expect(def?.requiresConfirmation).toBe(false);
    /* Risk sınıfı DÜŞÜRÜLMEDİ — telemetri/defter hâlâ yüksek riskli görür. */
    expect(def?.risk).toBe('high');
  });

  it('kişi ADI YOKKEN yalnız telefon UYGULAMASI açılır (onay istenmez, arama YOK)', async () => {
    const launch = vi.fn();
    const r = await executeIntent(intent('OPEN_PHONE'), ctx({ launch }));
    expect(r.status).toBe('succeeded');
    expect(r.reason).toBe('phone_app_opened');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(H.callNumber).not.toHaveBeenCalled();
  });
});

describe('MAVI-M4 · 6. onaylı telefon araması TAM BİR KEZ başlar', () => {
  it('`actionConfirmed:true` → arama bir kez başlar ve SUCCEEDED döner', async () => {
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: true }));
    expect(r.status).toBe('succeeded');
    expect(H.callNumber).toHaveBeenCalledTimes(1);
    expect(H.callNumber).toHaveBeenCalledWith('+905551112233');
  });

  /* ── SAHA BULGUSU (2026-07-31): "arıyorum" diyordu ama arama YOKTU ──────────
   * Kök neden: köprü `ACTION_DIAL` kullanıyordu (çeviriciyi AÇAR, aramaz) ve
   * `void` döndürdüğü için yürütücü koşulsuz `succeeded` + "aranıyor" diyordu.
   * Aşağıdaki üç kilit bu davranışın geri gelmesini ENGELLER.
   * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası). */

  it('🔒 çevirici açıldı ama arama BAŞLAMADIYSA `succeeded` DÖNMEZ', async () => {
    H.callNumber.mockImplementation(async () => ({ mode: 'DIAL' as const, placed: false }));
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: true }));
    expect(r.status).not.toBe('succeeded');
    expect(r.status).toBe('started');
    expect(r.reason).toBe('dialer_opened_not_placed');
    /* Kullanıcıya "aranıyor" DENMEZ — ne yapması gerektiği söylenir. */
    expect(r.detail).not.toMatch(/aranıyor/);
  });

  it('🔒 üretici BT uygulamasına devredilen arama "başladı" SAYILMAZ', async () => {
    H.callNumber.mockImplementation(async () => ({ mode: 'VENDOR' as const, placed: false }));
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: true }));
    expect(r.status).toBe('started');
    expect(r.reason).toBe('call_handed_to_vendor');
    expect(r.detail).not.toMatch(/aranıyor/);
  });

  it('🔒 köprü sonuç DÖNDÜRMEZSE başarı VARSAYILMAZ (fire-and-forget kapanı)', async () => {
    // @ts-expect-error — eski/kısmi köprü implementasyonunu taklit eder
    H.callNumber.mockImplementation(async () => undefined);
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: true }));
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('call_outcome_unverified');
  });

  it('numara bulunamazsa SAHTE ONAY YOK — arama BAŞLAMAZ', async () => {
    H.contacts = [];
    const r = await executeIntent(intent('OPEN_PHONE', { contactName: 'Selim' }), ctx({ actionConfirmed: true }));
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('contact_not_found');
    expect(H.callNumber).not.toHaveBeenCalled();
  });

  it('bekleyen onay TEK KULLANIMLIKTIR → "evet" iki kez yorumlanıp iki arama açılamaz', () => {
    setPendingAction({ intent: intent('OPEN_PHONE', { contactName: 'Selim' }), actionId: 'phone.call.start', turnId: 4, atMs: 1_000 });
    expect(consumePendingAction(5, 1_100)).not.toBeNull();
    expect(consumePendingAction(5, 1_100)).toBeNull();   // slot boşaldı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7/8 — HARDWARE_UNLOCK hareket matrisi (M2 korunur)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 7/8. unlock hareket matrisi', () => {
  it('7. moving VE unknown → REDDEDİLİR (unknown ≠ parked, fail-closed)', async () => {
    for (const state of ['moving', 'unknown'] as const) {
      const port = ackPort();
      const r = await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ hwUnlockDoors: port, vehicleCtx: motion(state) }));
      expect(r.status, state).toBe('denied');
      expect(port, state).not.toHaveBeenCalled();
    }
  });

  it('8. stopped + capability VARSA unlock YÜRÜR', async () => {
    const hwUnlockDoors = ackPort('completed');
    const r = await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ hwUnlockDoors, vehicleCtx: motion('stopped') }));
    expect(hwUnlockDoors).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('succeeded');
  });

  it('8b. stopped + capability YOKSA dürüst `unsupported` (sessiz no-op DEĞİL)', async () => {
    const r = await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ vehicleCtx: motion('stopped') }));
    expect(r.status).toBe('unsupported');
    expect(r.reason).toBe('no_port');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 — CLEAR_DTC_CODES: onay + WriteGate
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 9. CLEAR_DTC_CODES onay + WriteGate', () => {
  it('onaysız → `clearDTCCodes` HİÇ çağrılmaz', async () => {
    const r = await executeIntent(intent('CLEAR_DTC_CODES'), ctx({ actionConfirmed: false }));
    expect(r.status).toBe('needs_confirmation');
    expect(H.clearDTCCodes).not.toHaveBeenCalled();
  });

  it('onaylı ama WriteGate reddederse → DENIED ve "silindi" DENMEZ', async () => {
    H.clearDTCCodes.mockImplementation(async () => ({ allowed: false, userMessage: 'Seyir halinde ECU\'ya yazılamaz' }));
    const r = await executeIntent(intent('CLEAR_DTC_CODES'), ctx({ actionConfirmed: true }));
    expect(r.status).toBe('denied');
    expect(r.reason).toBe('write_gate_denied');
    expect(buildIntentExecutionFeedback(r)?.severity).not.toBe('success');
  });

  it('onay + WriteGate geçtiyse → SUCCEEDED (iki kapı da şart)', async () => {
    const r = await executeIntent(intent('CLEAR_DTC_CODES'), ctx({ actionConfirmed: true }));
    expect(H.clearDTCCodes).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('succeeded');
  });

  it('silinecek kod yokken ECU\'ya YAZILMAZ', async () => {
    H.dtcState = { ...H.dtcState, codes: [] };
    const r = await executeIntent(intent('CLEAR_DTC_CODES'), ctx({ actionConfirmed: true }));
    expect(r.reason).toBe('nothing_to_clear');
    expect(H.clearDTCCodes).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 — Gerçek success YALNIZ executor sonucuyla
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 10. success yalnız yürütücü kanıtıyla', () => {
  it('ACK\'siz (void) port SUCCEEDED üretmez → UNKNOWN', async () => {
    const r = await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: vi.fn() }));
    expect(r.status).toBe('unknown');
    expect(r.status).not.toBe('succeeded');
  });

  it('donanım REDDİ SUCCEEDED\'e çevrilmez', async () => {
    const r = await executeIntent(intent('HARDWARE_LOCK'), ctx({ hwLockDoors: ackPort('rejected') }));
    expect(r.status).toBe('failed');
  });

  it('OBD okuması BAŞARISIZ (stale) iken "araç temiz" DENMEZ', async () => {
    H.dtcState = { ...H.dtcState, codes: [], isStale: true, error: 'OBD yanıt vermiyor' };
    const r = await executeIntent(intent('CHECK_VEHICLE_HEALTH'), ctx());
    expect(r.status).toBe('failed');
    expect(r.message ?? '').not.toMatch(/temiz|sorun yok/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 — Stale tur action başlatmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 11. stale tur action BAŞLATAMAZ', () => {
  const req = (turnId: number) => ({
    intent: intent('OPEN_PHONE', { contactName: 'Selim' }),
    actionId: 'phone.call.start', turnId, atMs: 1_000,
  });

  it('araya BAŞKA bir kullanıcı turu girdiyse onay DÜŞER (eylem başlamaz)', () => {
    setPendingAction(req(4));
    // 5 beklenirdi; 6 = arada bir tur daha geçmiş → eski niyet canlandırılamaz.
    expect(consumePendingAction(6, 1_100)).toBeNull();
  });

  it('isteği ÜRETEN turun kendisi onayı tüketemez (kendi kendini onaylama YOK)', () => {
    setPendingAction(req(4));
    expect(consumePendingAction(4, 1_100)).toBeNull();
  });

  it('TTL dolduysa onay DÜŞER', () => {
    setPendingAction(req(4));
    expect(consumePendingAction(5, 1_000 + PENDING_ACTION_TTL_MS + 1)).toBeNull();
  });

  it('geçerli sıradaki tur onayı TÜKETİR (meşru akış boğulmaz)', () => {
    setPendingAction(req(4));
    const ok = consumePendingAction(5, 1_100);
    expect(ok?.actionId).toBe('phone.call.start');
  });
  /* `clearPendingAction` ÜRÜN YOLUNDA VAR ama bu dosyada import edilip HİÇ
     çağrılmıyordu (ESLint no-unused-vars ile yakalandı, 2026-08-21). Kullanılmayan
     import burada kozmetik değildi: iptal davranışının KİLİDİ YOKTU. Import'u
     silmek boşluğu gizlerdi — kilit yazıldı. */
  it('clearPendingAction bekleyen onayı DÜŞÜRÜR — iptal edilen istek canlandırılamaz', () => {
    setPendingAction(req(4));
    expect(peekPendingAction(1_100)).not.toBeNull();

    clearPendingAction();

    expect(peekPendingAction(1_100)).toBeNull();
    /* En kritik yarı: temizlenmiş istek MEŞRU sıradaki turda BİLE tüketilemez.
       Yalnız peek'e bakmak, consume yolunun ayrı bir kopya tutması hâlinde
       kusuru kaçırırdı. */
    expect(consumePendingAction(5, 1_100)).toBeNull();
  });

  it('yürütücü KAYITLI DEĞİLSE onay çözülemez → fail-closed', () => {
    setConfirmedActionExecutor(null);
    expect(getConfirmedActionExecutor()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12 — Her action EN FAZLA tek M6 cevap zarfı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 12. tek cevap zarfı', () => {
  it('her araç etkili sonuç TEK ve DEĞİŞMEZ bir zarf üretir', async () => {
    const results = await Promise.all(
      (Object.keys(VEHICLE_ACTIONS) as IntentType[]).map((t) => executeIntent(intent(t), ctx())),
    );
    for (const r of results) {
      const a = buildIntentExecutionFeedback(r);
      const b = buildIntentExecutionFeedback(r);
      expect(a?.message).toBe(b?.message);            // saf → yan etkisiz
      if (a) expect(Object.isFrozen(a)).toBe(true);
    }
  });

  it('yürütücü katmanı KENDİ BAŞINA konuşmaz — `speakMaviAnswer` tek otoritedir', () => {
    const code = stripComments(SRC('platform', 'commandExecutor.ts'));
    // Doğrudan TTS motoru çağrısı YOK; yalnız M6 otoritesine delege eden adaptör.
    expect(code).not.toMatch(/speechSynthesis\.speak\(/);
    expect(code).not.toMatch(/CarLauncher\.speak/);
    expect(code).toMatch(/speakMaviAnswer/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13 — M3 sahte ACK geri gelmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 13. M3 sahte ACK geri gelmez', () => {
  it('handler/parser/registry BAŞARI METNİ üretmez — sonuç sözleşmesi tek kaynaktır', () => {
    const authority = stripComments(SRC('platform', 'action', 'maviActionAuthority.ts'));
    const pending   = stripComments(SRC('platform', 'action', 'pendingActionConfirmation.ts'));
    for (const src of [authority, pending]) {
      expect(src).not.toMatch(/speak\w*\(/);      // konuşmaz
      expect(src).not.toMatch(/showToast\(/);     // UI açmaz
      expect(src).not.toMatch(/localStorage/);    // store yazmaz
    }
  });

  it('port yokken hiçbir araç etkili eylem SUCCEEDED üretemez', async () => {
    for (const [type, def] of Object.entries(VEHICLE_ACTIONS)) {
      if (!def?.capability) continue;             // gerçek servisi olanlar hariç
      const r = await executeIntent(intent(type as IntentType), ctx({ vehicleCtx: motion('stopped') }));
      expect(r.status, type).toBe('unsupported');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14 — M2/M5/M6 sözleşmeleri korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 14. M2/M5/M6 korunur', () => {
  it('M2: `motionState` taşımayan ESKİ çağıran için `isDriving` kuralı SÜRER', () => {
    const legacyDriving = { speedKmh: 80, drivingMode: 'driving', isDriving: true } as unknown as VehicleContext;
    const g = evaluateVehicleAction({ intent: 'HARDWARE_UNLOCK', vehicleCtx: legacyDriving, ports: {} });
    expect(g.allow).toBe(false);
    expect(g.allow === false && g.result.reason).toBe('vehicle_moving');
  });

  it('M2: bağlam HİÇ yoksa da fail-closed (varsayılan "park" YOK)', () => {
    const g = evaluateVehicleAction({
      intent: 'HARDWARE_UNLOCK', vehicleCtx: {} as unknown as VehicleContext, ports: {},
    });
    expect(g.allow).toBe(false);
  });

  it('M5: bekleyen onay isteği turun kimliğini TAŞIR (stale kapısı mümkün)', () => {
    setPendingAction({ intent: intent('CLEAR_DTC_CODES'), actionId: 'vehicle.dtc.clear', turnId: 9, atMs: 1_000 });
    expect(peekPendingAction(1_100)?.turnId).toBe(9);
  });

  it('M6: `voiceService` onay çözümünü TEK otoriteye delege eder (kendi yürütmez)', () => {
    const code = stripComments(SRC('platform', 'voiceService.ts'));
    expect(code).toMatch(/consumePendingAction\(/);
    expect(code).toMatch(/getConfirmedActionExecutor\(/);
    // İkinci otorite kurulmaz: voiceService commandExecutor'ı import ETMEZ.
    expect(code).not.toMatch(/from '\.\/commandExecutor'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15 — Action Registry DIŞINDA yeni araç etkili intent eklenemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · 15. defter dışı araç etkili intent eklenemez', () => {
  it('donanım/ECU sınıfı HER intent deftere kayıtlıdır', () => {
    const VEHICLE_EFFECTIVE: IntentType[] = [
      'HARDWARE_LOCK', 'HARDWARE_UNLOCK', 'HARDWARE_HORN', 'HARDWARE_FLASH',
      'HARDWARE_ALARM_ON', 'HARDWARE_ALARM_OFF', 'HARDWARE_REAR_CAMERA',
      'HARDWARE_LIGHTS_OFF', 'HARDWARE_SCREEN_OFF',
      'CLEAR_DTC_CODES', 'CHECK_VEHICLE_HEALTH', 'QUERY_SENSOR', 'OPEN_PHONE',
    ];
    for (const t of VEHICLE_EFFECTIVE) {
      expect(isVehicleEffectiveIntent(t), `${t} defterde YOK`).toBe(true);
    }
  });

  it('`intentEngine`de tanımlı HER `HARDWARE_*` intent defterde KARŞILIK bulur', () => {
    const src = SRC('platform', 'intentEngine.ts');
    const block = src.slice(src.indexOf('export type IntentType'), src.indexOf("| 'UNKNOWN';"));
    const hardware = [...block.matchAll(/'(HARDWARE_[A-Z_]+)'/g)].map((m) => m[1] as IntentType);
    expect(hardware.length).toBeGreaterThan(5);
    for (const t of hardware) {
      expect(isVehicleEffectiveIntent(t), `${t} defter DIŞINDA — Action Registry'ye eklenmeli`).toBe(true);
    }
  });

  it('defterdeki HER eylem zorunlu sözleşme alanlarını TAŞIR', () => {
    for (const [type, def] of Object.entries(VEHICLE_ACTIONS)) {
      expect(def, type).toBeDefined();
      expect(typeof def!.actionId, type).toBe('string');
      expect(def!.actionId.length, type).toBeGreaterThan(3);
      expect(['low', 'medium', 'high'], type).toContain(def!.risk);
      expect(typeof def!.requiresConfirmation, type).toBe('boolean');
      expect(['any', 'requires_stopped'], type).toContain(def!.motionPolicy);
      expect(typeof def!.title, type).toBe('string');
      // capability: ya bir port adı ya da açıkça `null` (belirsizlik yok)
      expect(def!.capability === null || typeof def!.capability === 'string', type).toBe(true);
    }
  });

  it('`actionId` kimlikleri TEKİLDİR (iki eylem aynı güvenlik kaydını paylaşamaz)', () => {
    const ids = Object.values(VEHICLE_ACTIONS).map((d) => d!.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defterde OLMAYAN intent araç etkili SAYILMAZ → kapı `not_handled` döner', () => {
    expect(isVehicleEffectiveIntent('OPEN_MUSIC')).toBe(false);
    expect(getVehicleActionDef('OPEN_MUSIC')).toBeUndefined();
    const g = evaluateVehicleAction({ intent: 'OPEN_MUSIC', vehicleCtx: motion('stopped'), ports: {} });
    expect(g.allow).toBe(false);
    expect(g.allow === false && g.result.reason).toBe('not_vehicle_effective');
  });

  it('`dispatchIntent` araç etkili intent\'i kapıya SORMADAN yürütemez', () => {
    const code = stripComments(SRC('platform', 'commandExecutor.ts'));
    const gateAt = code.indexOf('evaluateVehicleAction');
    const switchAt = code.indexOf('switch (intent.type)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(-1);
    expect(gateAt, 'kapı switch\'ten ÖNCE çalışmalı').toBeLessThan(switchAt);
  });
});
