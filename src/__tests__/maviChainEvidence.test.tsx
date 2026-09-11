/**
 * maviChainEvidence.test.tsx — MAVI-M4-LAB-2 · EYLEM ZİNCİRİ KORELASYONU (kilit).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M4-LAB kapı kararlarını görünür kıldı ama zincirin geri kalanı görünmezdi:
 * "kapı ne dedi" biliniyor, "yürütücü ne döndürdü" ve "kullanıcı ne duydu"
 * bilinmiyordu. Bu dosya tek komutun hikâyesinin TEK grupta ve DÜRÜSTÇE
 * (eksik aşama tahmin edilmeden) birleştiğini kilitler.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Aynı tura ait karar · sonuç · TTS TEK grupta görünür.
 *  2. Stale turda action/TTS oluşmaz.
 *  3. Safety reddinde executor sonucu görünmez.
 *  4. Onay bekleyen action doğru statüde görünür.
 *  5. `unsupported` ve `failed` AYRIŞIR.
 *  6. PII ne snapshot'a ne render'a sızar.
 *  7. Kayıt kapasitesi bounded kalır.
 *  8. Ekran hiçbir executor/bridge çağırmaz.
 *  9. Proaktif güvenlik uyarısı kullanıcı turu GİBİ GÖSTERİLMEZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const H = vi.hoisted(() => ({
  callNumber: vi.fn(),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
  dtcState: {
    codes: [{ severity: 'warning', description: 'Lambda sensörü' }],
    isReading: false, isClearing: false, lastReadAt: 1, error: null as string | null, isStale: false,
  },
  spoken: [] as string[],
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
  speakFeedback:  (t: string) => { H.spoken.push(t); },
  speakAssistant: (t: string) => { H.spoken.push(t); },
  speakAlert: vi.fn(), speakSafetyAlert: vi.fn(),
  ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/dtcService', () => ({
  // P0-OBD-10: silme envanteri (stored + pending). Testte kod VAR sayılır.
  getClearableDtcSnapshot: () => ({ codes: [], count: H.dtcState.codes.length, scanRan: true }),
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: (...a: unknown[]) => H.clearDTCCodes(...(a as [])),
  onDTCState: (cb: (s: unknown) => void) => { cb(H.dtcState); return () => {}; },
}));
vi.mock('../platform/contactsService', () => ({
  searchContacts: () => [{ id: 'k1', name: 'Ayşe Yıldırım', phones: [{ label: 'mobile', number: '+905551112233' }] }],
  recordCall: vi.fn(),
}));

import {
  recordMaviActionStage, getMaviActionTrace, getMaviActionTraceCounters,
  MAX_ACTION_TRACE, _resetMaviActionTraceForTest,
} from '../platform/action/maviActionTrace';
import {
  buildChainView, deriveChainVerdict, countByChainVerdict,
  CHAIN_STEP_ORDER, MAX_CHAIN_GROUPS,
} from '../platform/devtools/maviChainModel';
import { buildEvidenceRows, EVIDENCE_CHANNELS } from '../platform/devtools/evidenceViewerModel';
import { executeIntent, executeAIResult, type CommandContext } from '../platform/commandExecutor';
import { speakMaviAnswer, _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import {
  beginMaviTurn, getActiveMaviTurn, continueIfTurnCurrent, getMaviTurnDiagnostics,
  _resetMaviTurnsForTest,
} from '../platform/assistant/maviTurn';
import { EvidenceViewerScreen } from '../components/devtools/screens/EvidenceViewerScreen';
import type { AppIntent, IntentType } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ── Harness ──────────────────────────────────────────────────────────────── */

const SECRET_CONTACT = 'Ayşe Yıldırım';
const SECRET_PHONE   = '+905551112233';

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
    /* P0-GÖREV-3: donanım eylemleri açık onay ister; bu dosya onay kapısını
       ÖLÇMEZ → onay verilmiş kabul edilir. */
    actionConfirmed: true,
    defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(),
    ...over,
  } as unknown as CommandContext;
}

function intent(type: IntentType, payload: Record<string, unknown> = {}): AppIntent {
  return { type, payload, priority: 'high' } as AppIntent;
}

function ackPort(status: 'completed' | 'rejected' = 'completed') {
  return vi.fn(async () => ({ commandId: 'c', type: 'x' as never, status }));
}

/** Turdaki belirli aşamayı bulur. */
function step(turnId: number, stage: string) {
  const g = buildChainView(getMaviActionTrace()).groups.find((x) => x.turnId === turnId);
  return g?.steps.find((s) => s.stage === stage);
}

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  _resetMaviActionTraceForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  H.callNumber.mockReset();
  H.spoken = [];
});

afterEach(() => {
  _resetMaviActionTraceForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Aynı turn'e ait karar, sonuç ve TTS tek grupta
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 1. tek turda tek grup', () => {
  it('kapı · yürütücü · TTS aynı turId altında BİRLEŞİR', async () => {
    const turn = beginMaviTurn();
    recordMaviActionStage({ stage: 'turn_started', status: 'accepted', reason: 'len:12', turnId: turn.id });
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }));
    speakMaviAnswer('Korna çalındı');

    const view = buildChainView(getMaviActionTrace());
    expect(view.groups).toHaveLength(1);
    const g = view.groups[0];
    expect(g.turnId).toBe(turn.id);
    expect(g.actionId).toBe('vehicle.horn.sound');
    expect(g.observedCount).toBe(4);                 // 4 aşamanın hepsi gözlendi
    expect(g.steps.map((s) => s.stage)).toEqual([...CHAIN_STEP_ORDER]);
    expect(g.verdict).toBe('SUCCEEDED');
  });

  it('iki ayrı tur iki AYRI grup üretir (karışmaz)', async () => {
    const t1 = beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }));
    const t2 = beginMaviTurn();
    await executeIntent(intent('HARDWARE_FLASH'), ctx({ hwFlashLights: ackPort() }));

    const view = buildChainView(getMaviActionTrace());
    expect(view.groups).toHaveLength(2);
    // EN YENİ tur önce.
    expect(view.groups[0].turnId).toBe(t2.id);
    expect(view.groups[1].turnId).toBe(t1.id);
    expect(view.groups[0].actionId).toBe('vehicle.lights.flash');
    expect(view.groups[1].actionId).toBe('vehicle.horn.sound');
  });

  it('aşama gözlenmediyse "gözlemlenmedi" kalır — TAHMİN EDİLMEZ', async () => {
    const turn = beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }));
    // TTS hiç çağrılmadı → speech aşaması gözlenmemiş OLMALI.
    const s = step(turn.id, 'speech');
    expect(s?.observed).toBe(false);
    expect(s?.status).toBeNull();
    expect(s?.atMs).toBeNull();
  });

  it('kapı geçti ama yürütücü sonucu yoksa hüküm "başarılı" DEĞİL', () => {
    const steps = CHAIN_STEP_ORDER.map((stage) => ({
      stage, label: '', observed: stage === 'gate',
      status: stage === 'gate' ? 'allowed' : null,
      reason: null, atMs: stage === 'gate' ? 1 : null,
    }));
    expect(deriveChainVerdict(steps)).toBe('INCOMPLETE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 — Stale turn'de action/TTS oluşmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 2. stale tur', () => {
  /**
   * Stale koruması `maviSpeech`te DEĞİL, ÇAĞRI YERİNDEDİR: `useVoiceCommandHandler`
   * komut anında turu YAKALAR (`getActiveMaviTurn()` → `_turn`) ve sonucu söylemeden
   * önce `continueIfTurnCurrent(_turn, 'feedback')` sorar.
   *
   * (`maviSpeech` içinde global turu okuyan ULAŞILAMAZ bir stale dalı vardı;
   * MAVI-M6-DEAD-STALE-BRANCH ile kaldırıldı — davranış değişmedi, çünkü dal
   * hiç çalışmıyordu. Ayrıntılı kök neden ve kilitler: `maviStaleAuthority.test.ts`.)
   */
  it('devralınmış turda ÇAĞRI YERİ kapısı geç cevabı düşürür (gerçek koruma)', () => {
    const t1 = beginMaviTurn();     // komut anında yakalanan token
    beginMaviTurn();                // kullanıcı yeni komut verdi → t1 artık eski

    // Üretimdeki hook'un yaptığı kapı:
    const allowed = continueIfTurnCurrent(t1, 'feedback');
    expect(allowed).toBe(false);    // geç cevap SESSİZCE düşer
    if (allowed) speakMaviAnswer('geç cevap');
    expect(H.spoken).toHaveLength(0);
  });

  it('KİLİT: `useVoiceCommandHandler` sonucu söylemeden ÖNCE tur kapısını sorar', () => {
    const hook = stripComments(readFileSync(
      join(process.cwd(), 'src', 'hooks', 'useVoiceCommandHandler.ts'), 'utf8'));
    // Kapı çağrısı, seslendirmeden ÖNCE gelmelidir.
    const gateAt = hook.indexOf('continueIfTurnCurrent');
    expect(gateAt).toBeGreaterThan(-1);
    expect(hook.slice(gateAt)).toMatch(/speakMaviAnswer/);
  });

  it('stale turda action BAŞLAMAZ → zincirde `result` aşaması OLUŞMAZ', () => {
    const t1 = beginMaviTurn();
    beginMaviTurn();
    if (continueIfTurnCurrent(t1, 'action')) {
      throw new Error('stale tur eylem başlatamamalı');
    }
    expect(getMaviActionTrace().some((r) => r.stage === 'result')).toBe(false);
  });

  it('devralma sayacı M5 tanılarında görünür (gözlem kaybolmaz)', () => {
    const t1 = beginMaviTurn();
    beginMaviTurn();
    continueIfTurnCurrent(t1, 'feedback');
    expect(getMaviTurnDiagnostics().staleFeedbackSuppressed).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 — Safety reddinde executor sonucu görünmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 3. safety reddi', () => {
  it('hareket reddinde kapı `denied`, yürütücü ÇAĞRILMAZ, hüküm KAPI ENGELLEDİ', async () => {
    const turn = beginMaviTurn();
    const port = ackPort();
    await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ hwUnlockDoors: port, vehicleCtx: motion('moving') }));

    expect(port).not.toHaveBeenCalled();
    expect(step(turn.id, 'gate')?.status).toBe('denied');
    expect(step(turn.id, 'gate')?.reason).toBe('vehicle_moving');
    // `result` aşaması kapı sonucunu TAŞIR ama başarı DEĞİLDİR.
    expect(step(turn.id, 'result')?.status).toBe('denied');

    const g = buildChainView(getMaviActionTrace()).groups[0];
    expect(g.verdict).toBe('BLOCKED_BY_GATE');
  });

  it('reddedilen turda hiçbir aşama `succeeded` göstermez', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_UNLOCK'), ctx({ hwUnlockDoors: ackPort(), vehicleCtx: motion('unknown') }));
    for (const rec of getMaviActionTrace()) {
      expect(rec.status).not.toBe('succeeded');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4/5 — Onay bekleyen · unsupported · failed ayrışması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 4/5. statü ayrışması', () => {
  it('4. onay bekleyen action ONAY BEKLENDİ statüsünde görünür', async () => {
    const turn = beginMaviTurn();
    await executeIntent(intent('CLEAR_DTC_CODES'), ctx({ actionConfirmed: false }));
    expect(step(turn.id, 'gate')?.status).toBe('needs_confirmation');
    expect(buildChainView(getMaviActionTrace()).groups[0].verdict).toBe('AWAITING_CONFIRMATION');
  });

  it('5a. port YOK → UNSUPPORTED (FAILED ile karışmaz)', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx());
    const g = buildChainView(getMaviActionTrace()).groups[0];
    expect(g.verdict).toBe('UNSUPPORTED');
    expect(g.verdict).not.toBe('FAILED');
  });

  it('5b. port REDDETTİ → FAILED (UNSUPPORTED ile karışmaz)', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort('rejected') }));
    const g = buildChainView(getMaviActionTrace()).groups[0];
    expect(g.verdict).toBe('FAILED');
    expect(g.verdict).not.toBe('UNSUPPORTED');
  });

  it('5c. ACK\'siz çağrı → DOĞRULANAMADI (başarı DEĞİL)', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: vi.fn() }));
    const g = buildChainView(getMaviActionTrace()).groups[0];
    expect(g.verdict).toBe('UNVERIFIED');
    expect(g.verdict).not.toBe('SUCCEEDED');
  });

  it('hüküm sayaçları gerçek dağılımı yansıtır', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx());                                  // unsupported
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_FLASH'), ctx({ hwFlashLights: ackPort() }));     // succeeded
    const counts = countByChainVerdict(buildChainView(getMaviActionTrace()).groups);
    expect(counts.UNSUPPORTED).toBe(1);
    expect(counts.SUCCEEDED).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 — PII sızmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 6. PII yapısal olarak sızmaz', () => {
  it('onaylı telefon aramasında KİŞİ ADI ve NUMARA halkaya girmez', async () => {
    beginMaviTurn();
    const r = await executeIntent(
      intent('OPEN_PHONE', { contactName: SECRET_CONTACT, sourceText: `${SECRET_CONTACT} ara` }),
      ctx({ actionConfirmed: true }),
    );
    // Üretim gerçekten aramayı başlattı ve `detail` kişi adını TAŞIYOR…
    expect(H.callNumber).toHaveBeenCalledTimes(1);
    expect(r.detail ?? '').toContain(SECRET_CONTACT);
    // …ama gözlem halkasına GİRMEDİ.
    const raw = JSON.stringify(getMaviActionTrace());
    expect(raw).not.toContain(SECRET_CONTACT);
    expect(raw).not.toContain(SECRET_PHONE);
  });

  it('seslendirilen METİN halkaya girmez (yalnız katman + statü)', () => {
    beginMaviTurn();
    speakMaviAnswer(`${SECRET_CONTACT} aranıyor`);
    const raw = JSON.stringify(getMaviActionTrace());
    expect(raw).not.toContain(SECRET_CONTACT);
    const rec = getMaviActionTrace().find((r) => r.stage === 'speech');
    expect(rec?.status).toBe('spoken');
    expect(rec?.reason).toBe('answer');
  });

  it('kayıt tipi YALNIZ enum/kimlik/kod/damga taşır', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }));
    for (const rec of getMaviActionTrace()) {
      expect(Object.keys(rec).sort()).toEqual(['actionId', 'atMs', 'intent', 'reason', 'stage', 'status', 'turnId']);
    }
  });

  it('kanıt çizelgesi satırları ve render çıktısı PII İÇERMEZ', async () => {
    beginMaviTurn();
    await executeIntent(
      intent('OPEN_PHONE', { contactName: SECRET_CONTACT }), ctx({ actionConfirmed: true }));
    speakMaviAnswer(`${SECRET_CONTACT} aranıyor`);

    const rows = buildEvidenceRows({ maviChain: getMaviActionTrace() });
    expect(JSON.stringify(rows)).not.toContain(SECRET_CONTACT);
    expect(JSON.stringify(rows)).not.toContain(SECRET_PHONE);

    const html = renderToStaticMarkup(<EvidenceViewerScreen />);
    expect(html).not.toContain(SECRET_CONTACT);
    expect(html).not.toContain(SECRET_PHONE);
  });

  it('`turn_started` transcript METNİ değil yalnız UZUNLUĞU taşır', () => {
    recordMaviActionStage({ stage: 'turn_started', status: 'accepted', reason: 'len:29', turnId: 1 });
    const rec = getMaviActionTrace()[0];
    expect(rec.reason).toBe('len:29');
    expect(rec.reason).not.toMatch(/[a-zçğıöşü]{4,}/i);   // kelime yok, yalnız sayı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 — Bounded kapasite
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 7. bounded halka', () => {
  it('kapasite aşılsa bile kayıt sayısı SABİT kalır', () => {
    for (let i = 0; i < MAX_ACTION_TRACE * 2; i++) {
      recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x', turnId: i });
    }
    expect(getMaviActionTrace().length).toBe(MAX_ACTION_TRACE);
    const c = getMaviActionTraceCounters();
    expect(c.recorded).toBe(MAX_ACTION_TRACE * 2);
    expect(c.dropped).toBeGreaterThan(0);        // düşen kayıt DÜRÜSTÇE sayılır
    expect(c.capacity).toBe(MAX_ACTION_TRACE);
  });

  it('grup sayısı da bounded (render bütçesi)', () => {
    for (let i = 0; i < MAX_CHAIN_GROUPS + 30; i++) {
      recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x', turnId: i });
    }
    expect(buildChainView(getMaviActionTrace()).groups.length).toBeLessThanOrEqual(MAX_CHAIN_GROUPS);
  });

  it('bozuk/null girdi → boş görünüm (fail-soft, throw YOK)', () => {
    expect(buildChainView(null).groups).toEqual([]);
    expect(buildChainView(undefined).proactive).toEqual([]);
    expect(() => buildChainView([{ stage: 'gate' } as never])).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 — Ekran executor/bridge çağıramaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 8. salt-okunur ekran', () => {
  const SCREEN = stripComments(readFileSync(
    join(process.cwd(), 'src', 'components', 'devtools', 'screens', 'EvidenceViewerScreen.tsx'), 'utf8'));
  const MODEL = stripComments(readFileSync(
    join(process.cwd(), 'src', 'platform', 'devtools', 'maviChainModel.ts'), 'utf8'));

  it('ekran yürütücü/köprü/OBD modüllerini import ETMEZ', () => {
    for (const forbidden of [
      'commandExecutor', 'intentEngine', 'bridge', 'nativePlugin', 'obdService', 'dtcService',
    ]) {
      expect(SCREEN, `ekran ${forbidden} import edemez`).not.toMatch(new RegExp(`from '[^']*${forbidden}'`));
    }
  });

  it('ekran hiçbir eylem/onay fonksiyonu ÇAĞIRMAZ', () => {
    for (const forbidden of [
      'executeIntent', 'dispatchIntent', 'routeIntent', 'evaluateVehicleAction',
      'consumePendingAction', 'recordMaviActionStage', 'callNumber', 'clearDTCCodes',
    ]) {
      expect(SCREEN, `${forbidden} çağrısı YASAK`).not.toMatch(new RegExp(`${forbidden}\\s*\\(`));
    }
  });

  it('zincir modeli SAFTIR: I/O · timer · Date.now · React importu YOK', () => {
    expect(MODEL).not.toMatch(/Date\.now\(/);
    expect(MODEL).not.toMatch(/setTimeout\(|setInterval\(/);
    expect(MODEL).not.toMatch(/from 'react'/);
    expect(MODEL).not.toMatch(/localStorage/);
  });

  it('ekran çökmeden render olur ve zincir bölümünü basar', async () => {
    beginMaviTurn();
    await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }));
    let html = '';
    expect(() => { html = renderToStaticMarkup(<EvidenceViewerScreen />); }).not.toThrow();
    expect(html).toContain('MAVİ EYLEM ZİNCİRİ');
    expect(html).toContain('vehicle.horn.sound');
  });

  it('yeni kanal mevcut çizelgeye EKLENİR (ayrı zaman çizelgesi kurulmaz)', () => {
    expect(EVIDENCE_CHANNELS).toContain('mavi-chain');
    const rows = buildEvidenceRows({
      maviChain: [{
        stage: 'gate', turnId: 4, actionId: 'vehicle.horn.sound',
        intent: 'HARDWARE_HORN', status: 'allowed', reason: 'gate_passed', atMs: 1_700_000_000_000,
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('mavi-chain');
    expect(rows[0].kind).toBe('mavi:gate');
    expect(rows[0].context).toContain('turn:4');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 — Proaktif güvenlik uyarısı AYRI tür
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 9. proaktif hat kullanıcı turu DEĞİLDİR', () => {
  it('`proactive_speech` hiçbir tur grubuna GİRMEZ', () => {
    const turn = beginMaviTurn();
    recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x', actionId: 'a.b', turnId: turn.id });
    recordMaviActionStage({ stage: 'proactive_speech', status: 'spoken', reason: 'ok', turnId: null });

    const view = buildChainView(getMaviActionTrace());
    expect(view.proactive).toHaveLength(1);
    for (const g of view.groups) {
      for (const s of g.steps) expect(s.stage).not.toBe('proactive_speech');
    }
  });

  it('proaktif kayıt AKTİF tur olsa BİLE turId TAŞIMAZ', () => {
    beginMaviTurn();
    recordMaviActionStage({ stage: 'proactive_speech', status: 'spoken', reason: 'ok', turnId: null });
    const rec = getMaviActionTrace().find((r) => r.stage === 'proactive_speech');
    expect(rec?.turnId).toBeNull();
  });

  /* Savunma derinliği: kaydeden taraf bir gün YANLIŞLIKLA turId geçirse bile
     gruplama katmanı proaktif hattı bir kullanıcı turunun içine KOYMAMALIDIR.
     (Bu kilit olmadan `companionProactiveWiring`de `turnId: null` unutulduğunda
     proaktif uyarı sessizce "kullanıcı komutunun cevabı" gibi görünürdü.) */
  it('turId TAŞIYAN proaktif kayıt bile hiçbir gruba GİRMEZ (savunma derinliği)', () => {
    const turn = beginMaviTurn();
    recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x', actionId: 'a.b', turnId: turn.id });
    recordMaviActionStage({ stage: 'proactive_speech', status: 'spoken', reason: 'ok', turnId: turn.id });

    const view = buildChainView(getMaviActionTrace());
    expect(view.proactive).toHaveLength(1);
    expect(view.uncorrelated).toHaveLength(0);
    const g = view.groups.find((x) => x.turnId === turn.id);
    expect(g).toBeDefined();
    for (const s of g!.steps) expect(s.stage).not.toBe('proactive_speech');
    // Turun aşama sayısı proaktif kayıtla ŞİŞMEZ.
    expect(g!.observedCount).toBe(1);
  });

  it('kanıt çizelgesinde proaktif satır "tur dışı" olarak işaretlenir', () => {
    const rows = buildEvidenceRows({
      maviChain: [{
        stage: 'proactive_speech', turnId: null, actionId: 'overheat',
        intent: null, status: 'spoken', reason: 'ok', atMs: 1_700_000_000_000,
      }],
    });
    expect(rows[0].kind).toBe('mavi:proactive_speech');
    expect(rows[0].context).toContain('tur dışı');
    expect(rows[0].context).not.toContain('turn:');
  });

  it('korelasyonsuz aşama uydurma bir gruba İTİLMEZ', () => {
    recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x', turnId: null });
    const view = buildChainView(getMaviActionTrace());
    expect(view.groups).toHaveLength(0);
    expect(view.uncorrelated).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 — Gözlem üretimi DEĞİŞTİRMEZ (M3/M4/M5/M6 korunur)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 10. gözlem üretimi değiştirmez', () => {
  it('M3 sonuç sözleşmesi AYNEN korunur', async () => {
    beginMaviTurn();
    expect((await executeIntent(intent('HARDWARE_HORN'), ctx())).status).toBe('unsupported');
    expect((await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort() }))).status).toBe('succeeded');
    expect((await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: ackPort('rejected') }))).status).toBe('failed');
    expect((await executeIntent(intent('HARDWARE_HORN'), ctx({ hwHonkHorn: vi.fn() }))).status).toBe('unknown');
  });

  it('M6 tur başına tek `answer` sözleşmesi korunur', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('birinci')).toBe(true);
    expect(speakMaviAnswer('ikinci')).toBe(false);     // tur başına tek cevap
    expect(H.spoken).toEqual(['birinci']);
  });

  it('kayıt fail-soft: bozuk girdi throw ETMEZ ve akışı bozmaz', () => {
    expect(() => recordMaviActionStage(null as never)).not.toThrow();
    expect(() => recordMaviActionStage({ stage: 'gate' } as never)).not.toThrow();
  });

  it('aktif tur yoksa korelasyon UYDURULMAZ (null kalır)', () => {
    _resetMaviTurnsForTest();
    expect(getActiveMaviTurn()).toBeNull();
    recordMaviActionStage({ stage: 'gate', status: 'allowed', reason: 'x' });
    expect(getMaviActionTrace()[0].turnId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 — AI-yönlendirmeli yol (`executeAIResult`) da `result` aşaması YAZAR
 *
 * SAHA 2026-09-11 (CAROS LAB · gerçek cihaz): `executeAIResult` `dispatchIntent`i
 * DOĞRUDAN çağırıp sonucu yukarı taşıyordu — `executeIntent`in yaptığı
 * `stage:'result'` yazımını YAPMIYORDU. AI-yönlendirmeli turlarda (beyin/
 * companion rotası) `gate:allowed` kaydı hiçbir zaman eşleşen bir sonuca
 * kavuşmuyordu → forensic anomali `ACTION_DISPATCH_NO_RESULT` (cihazda
 * `dispatchWithoutResult=2`, ikisi de `phone.call.start`). Kilit bunun BİR
 * DAHA geri gelmemesini korur — iki dispatch yolu ARTIK AYNI otoriteyi
 * (`_recordVehicleActionResult`) paylaşıyor.
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4-LAB-2 · 11. AI yolu da result aşaması yazar (SAHA 2026-09-11)', () => {
  it('executeAIResult (OPEN_PHONE) sonrası gate VE result AYNI actionId altında birleşir', async () => {
    H.callNumber.mockResolvedValue({ placed: true });
    const turn = beginMaviTurn();
    recordMaviActionStage({ stage: 'turn_started', status: 'accepted', reason: 'len:9', turnId: turn.id });

    // `fromAIResponse` yalnız İZİN VERİLEN intentleri kabul eder (VALID_INTENTS) —
    // cihazda ölçülen GERÇEK vakayla AYNI intent: OPEN_PHONE → phone.call.start.
    const outcome = await executeAIResult(
      { intent: 'OPEN_PHONE', payload: { contactName: SECRET_CONTACT }, confidence: 0.9, feedback: '' },
      ctx({ actionConfirmed: true }),
    );
    expect(outcome?.result.status).toBe('succeeded');

    const view = buildChainView(getMaviActionTrace());
    const g = view.groups.find((x) => x.turnId === turn.id);
    expect(g?.actionId).toBe('phone.call.start');
    const gateStep   = g?.steps.find((s) => s.stage === 'gate');
    const resultStep = g?.steps.find((s) => s.stage === 'result');
    expect(gateStep?.observed).toBe(true);
    /* ASIL KİLİT: eskiden burada `observed:false` dönerdi — cihazda ölçülen
       forensic anomali `ACTION_DISPATCH_NO_RESULT` (dispatchWithoutResult=2)
       TAM OLARAK bu boşluktu. */
    expect(resultStep?.observed).toBe(true);
    expect(resultStep?.status).toBe('succeeded');
    expect(g?.verdict).toBe('SUCCEEDED');
  });

  it('düşük güvende (<0.45) hiçbir dispatch/kayıt OLUŞMAZ — mevcut eşik korunur', async () => {
    beginMaviTurn();
    const before = getMaviActionTrace().length;
    const outcome = await executeAIResult(
      { intent: 'OPEN_PHONE', payload: { contactName: SECRET_CONTACT }, confidence: 0.2, feedback: '' },
      ctx({ actionConfirmed: true }),
    );
    expect(outcome).toBeNull();
    expect(getMaviActionTrace().length).toBe(before);
  });

  it('araç-etkisiz intentler için result YAZILMAZ (eski davranış korunur)', async () => {
    beginMaviTurn();
    const before = getMaviActionTrace().filter((r) => r.stage === 'result').length;
    await executeAIResult(
      { intent: 'OPEN_SETTINGS', payload: {}, confidence: 0.9, feedback: '' },
      ctx(),
    );
    const after = getMaviActionTrace().filter((r) => r.stage === 'result').length;
    expect(after).toBe(before);
  });
});
