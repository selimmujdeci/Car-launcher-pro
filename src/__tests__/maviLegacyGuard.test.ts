/**
 * maviLegacyGuard.test.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4c.
 *
 * KİLİTLENEN DAVRANIŞLAR:
 *  - Bayrak KAPALI (varsayılan) → media.next YALNIZ eski hatta, tam 1 kez.
 *  - Bayrak AÇIK → media.next YALNIZ Mavi hattında, tam 1 kez; eski hat 0.
 *  - Guard SIRA-BAĞIMSIZ: eski hat Mavi köprüsünden önce de sonra da kaydolsa sonuç aynı.
 *  - Guard yalnız media.next'te etkili; diğer komutlar dokunulmadan eski hatta akar.
 *  - Hakem/eşleyici throw · geçersiz anahtar · wiring yok → eski hat TAM 1 (fail-open).
 *  - media.next port paritesi: cancelAssistantDuck + hasQueue||hasSession ön-koşulu + dürüst ok:false.
 *  - dispose sonrası eski hat davranışı OTOMATİK geri gelir; restart tek guard bağlar.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMaviWiring } from '../platform/maviCore/wiring/maviWiring';
import { createTakeoverPolicy } from '../platform/maviCore/wiring/takeoverPolicy';
import { createTakeoverArbiter, type TakeoverArbiter } from '../platform/maviCore/wiring/takeoverArbiter';
import {
  isCommandOwnedByMavi, resolveOwnershipKey, hasMaviOwnershipResolver,
  setMaviOwnershipResolver, _resetMaviOwnershipForTest,
} from '../platform/maviCore/wiring/maviOwnership';
import { createMediaNextPort, MediaUnavailableError } from '../platform/maviCore/wiring/maviMediaPort';
import { commandIdentityOf, defaultPilotCommandMap, type ParsedCommandLike, type VoiceLifecycleEventLike } from '../platform/maviCore/wiring/maviVoiceBridge';
import type { PilotHandlerDeps } from '../platform/maviCore/wiring/maviPilotHandlers';

/* ── Harness: voiceService dispatch'ini taklit eder ──────────
 * Gerçek voiceService `_commandHandlers` bir Set'tir ve HER handler'a aynı cmd nesnesini yollar.
 * Burada eski hat + Mavi köprüsü aynı sahte dispatcher'a kaydolur; kayıt SIRASI parametreliktir. */

interface Harness {
  dispatch: (cmd: ParsedCommandLike) => void;
  emitVoiceState: (e: VoiceLifecycleEventLike) => void;
  advance: (ms: number) => void;
  legacyNext: ReturnType<typeof vi.fn>;
  legacyOther: ReturnType<typeof vi.fn>;
  maviNext: ReturnType<typeof vi.fn>;
  maviTheme: ReturnType<typeof vi.fn>;
  arbiter: TakeoverArbiter;
  handle: ReturnType<typeof createMaviWiring>;
  legacyRegistrations: number;
}

function setup(opts: {
  takeover?: boolean;
  legacyFirst?: boolean;
  arbiter?: TakeoverArbiter;
  mediaNextImpl?: () => void;
} = {}): Harness {
  const listeners: ((c: ParsedCommandLike) => void)[] = [];
  let stateListener: ((e: VoiceLifecycleEventLike) => void) | null = null;
  let clock = 1_000;
  const counts = { legacyRegistrations: 0 };

  const legacyNext = vi.fn();
  const legacyOther = vi.fn();
  const maviNext = vi.fn(opts.mediaNextImpl);
  const maviTheme = vi.fn();

  /** Eski hattın useVoiceCommandHandler'daki karar noktasının BİREBİR aynısı. */
  const legacyHandler = (cmd: ParsedCommandLike): void => {
    if (isCommandOwnedByMavi(cmd)) return;   // ← guard (kaynaktaki tek satır)
    if (cmd.type === 'music_next') legacyNext();
    else legacyOther();
  };

  const pilotDeps: PilotHandlerDeps = {
    setTheme: maviTheme, openScreen: () => true,
    mediaPlay: vi.fn(), mediaPause: vi.fn(), mediaNext: maviNext,
    setVolume: vi.fn(), navigateTo: vi.fn(), openNavScreen: () => true,
    cancelNavigation: vi.fn(),
    readHealth: async () => ({ dtcCount: 0, criticalCount: 0, summary: 'temiz' }),
  };

  const arbiter = opts.arbiter ?? createTakeoverArbiter();
  const mode = opts.takeover ? 'takeover' : 'shadow';

  if (opts.legacyFirst) { counts.legacyRegistrations++; listeners.push(legacyHandler); }

  const handle = createMaviWiring({
    pilotDeps,
    registerCommandHandler: (fn) => {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    subscribeVoiceState: (fn) => { stateListener = fn; return () => { stateListener = null; }; },
    ttsCancel: vi.fn(),
    mode,
    policy: createTakeoverPolicy({ mode, allowlist: ['media.next'] }),
    arbiter,
    now: () => clock,
  });
  handle.start();

  if (!opts.legacyFirst) { counts.legacyRegistrations++; listeners.push(legacyHandler); }

  return {
    dispatch: (cmd) => { for (const fn of [...listeners]) fn(cmd); },
    emitVoiceState: (e) => { stateListener?.(e); },
    advance: (ms) => { clock += ms; },
    legacyNext, legacyOther, maviNext, maviTheme, arbiter, handle,
    get legacyRegistrations() { return counts.legacyRegistrations; },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const NEXT_CMD: ParsedCommandLike = { type: 'music_next', raw: 'sonraki şarkı' };

beforeEach(() => { _resetMaviOwnershipForTest(); });

/* ── 1. Tek hat garantisi ────────────────────────────────── */

describe('MAVI3-4c — tek hat garantisi', () => {
  it('bayrak KAPALI + media.next → eski hat TAM 1, Mavi 0', async () => {
    const h = setup({ takeover: false });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).toHaveBeenCalledTimes(1);
    expect(h.maviNext).not.toHaveBeenCalled();
  });

  it('bayrak AÇIK + media.next → Mavi TAM 1, eski hat 0', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.maviNext).toHaveBeenCalledTimes(1);
    expect(h.legacyNext).not.toHaveBeenCalled();
  });

  it('SIRA-BAĞIMSIZ: eski hat ÖNCE kaydolsa da sonuç aynı', async () => {
    const h = setup({ takeover: true, legacyFirst: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.maviNext).toHaveBeenCalledTimes(1);
    expect(h.legacyNext).not.toHaveBeenCalled();
  });

  it('bayrak AÇIK + media.play → eski hat çalışır, Mavi gerçek handler 0', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ type: 'open_music', raw: 'müzik aç' });
    await flush();
    expect(h.legacyOther).toHaveBeenCalledTimes(1);
    expect(h.maviNext).not.toHaveBeenCalled();
  });

  it('bayrak AÇIK + tema komutu → eski hat çalışır, Mavi tema handler\'ı 0', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ type: 'theme_night', raw: 'gece modu' });
    await flush();
    expect(h.legacyOther).toHaveBeenCalledTimes(1);
    expect(h.maviTheme).not.toHaveBeenCalled();
  });

  it('SHADOW modunda HİÇBİR komut susturulmaz', async () => {
    const h = setup({ takeover: false });
    for (const cmd of [
      { type: 'music_next', raw: 'sonraki' }, { type: 'theme_night', raw: 'gece' },
      { type: 'open_music', raw: 'müzik' }, { type: 'open_maps', raw: 'harita' },
      { type: 'vehicle_health_check', raw: 'sağlık' },
    ]) h.dispatch(cmd);
    await flush();
    expect(h.legacyNext.mock.calls.length + h.legacyOther.mock.calls.length).toBe(5);
  });

  it('aynı anahtar tekrar gelirse GERÇEK next yalnız 1 kez çalışır', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.maviNext).toHaveBeenCalledTimes(1);
    expect(h.legacyNext).not.toHaveBeenCalled(); // guard hâlâ eski hattı da tutar
  });
});

/* ── 2. Fail-open sınırı ─────────────────────────────────── */

describe('MAVI3-4c — fail-open (eski hat ASLA yanlışlıkla susturulmaz)', () => {
  it('Mavi wiring HİÇ kurulmamışsa eski hat TAM 1', () => {
    expect(hasMaviOwnershipResolver()).toBe(false);
    expect(isCommandOwnedByMavi({ ...NEXT_CMD })).toBe(false);
  });

  it('hakem isMaviOwned THROW ederse eski hat TAM 1', async () => {
    const broken = { ...createTakeoverArbiter(), isMaviOwned: () => { throw new Error('patlak'); } } as TakeoverArbiter;
    const h = setup({ takeover: true, arbiter: broken });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).toHaveBeenCalledTimes(1);
    expect(h.maviNext).not.toHaveBeenCalled(); // 4b sahiplik kapısı → çifte yürütme de yok
  });

  it('eşleyici THROW ederse eski hat TAM 1', () => {
    setMaviOwnershipResolver({
      mapCommand: () => { throw new Error('eşleyici patladı'); },
      identity: () => ({ generationId: 1, sessionId: 1 }),
      arbiter: createTakeoverArbiter(),
    });
    expect(isCommandOwnedByMavi({ ...NEXT_CMD })).toBe(false);
  });

  it('identity THROW ederse eski hat TAM 1', () => {
    const arbiter = createTakeoverArbiter();
    arbiter.activate(createTakeoverPolicy({ mode: 'takeover' }));
    setMaviOwnershipResolver({
      mapCommand: defaultPilotCommandMap,
      identity: () => { throw new Error('kimlik yok'); },
      arbiter,
    });
    expect(isCommandOwnedByMavi({ ...NEXT_CMD })).toBe(false);
  });

  it('geçersiz/eşlemesiz komut → anahtar üretilmez, eski hat TAM 1', async () => {
    const h = setup({ takeover: true });
    expect(resolveOwnershipKey({ type: 'bilinmeyen_komut', raw: 'x' })).toBeNull();
    h.dispatch({ type: 'bilinmeyen_komut', raw: 'x' });
    await flush();
    expect(h.legacyOther).toHaveBeenCalledTimes(1);
  });

  it('bayat kuşak sahiplik kazanamaz → eski hat devrede kalır', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    arbiter.observeGeneration(7, 7); // köprünün kimliği bayatladı
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).toHaveBeenCalledTimes(1);
    expect(h.maviNext).not.toHaveBeenCalled();
  });
});

/* ── 3. Ortak anahtar üretimi ────────────────────────────── */

describe('MAVI3-4c — iki hat AYNI anahtarı üretir', () => {
  it('resolveOwnershipKey köprünün kimliğini + ortak commandId\'yi kullanır', () => {
    const h = setup({ takeover: true });
    h.emitVoiceState({ phase: 'listening', generationId: 4, sessionId: 4 });
    const key = resolveOwnershipKey({ ...NEXT_CMD });
    expect(key).toEqual({
      generationId: 4,
      sessionId: 4,
      commandId: commandIdentityOf(NEXT_CMD), // köprüyle AYNI builder
      actionId: 'media.next',
    });
  });

  it('kuşak ilerleyince anahtar da ilerler (paralel kimlik yok)', () => {
    const h = setup({ takeover: true });
    h.emitVoiceState({ phase: 'listening', generationId: 2, sessionId: 2 });
    expect(resolveOwnershipKey({ ...NEXT_CMD })?.generationId).toBe(2);
    h.emitVoiceState({ phase: 'wake_detected', generationId: 3, sessionId: 3 });
    expect(resolveOwnershipKey({ ...NEXT_CMD })?.generationId).toBe(3);
  });
});

/* ── 4. media.next port paritesi ─────────────────────────── */

describe('MAVI3-4c — media.next port paritesi (eski hatla eşit)', () => {
  function port(o: { queue?: boolean; session?: boolean; next?: () => void }) {
    const cancelAssistantDuck = vi.fn();
    const next = vi.fn(o.next);
    const fn = createMediaNextPort({
      cancelAssistantDuck,
      hasQueue: () => o.queue === true,
      hasSession: () => o.session === true,
      next,
    });
    return { fn, cancelAssistantDuck, next };
  }

  it('hasQueue=true → cancelAssistantDuck 1, next 1', () => {
    const p = port({ queue: true });
    p.fn();
    expect(p.cancelAssistantDuck).toHaveBeenCalledTimes(1);
    expect(p.next).toHaveBeenCalledTimes(1);
  });

  it('hasSession=true → cancelAssistantDuck 1, next 1', () => {
    const p = port({ session: true });
    p.fn();
    expect(p.cancelAssistantDuck).toHaveBeenCalledTimes(1);
    expect(p.next).toHaveBeenCalledTimes(1);
  });

  it('ikisi de false → next 0 ve typed hata (yapılmış gibi cevap YOK)', () => {
    const p = port({});
    expect(() => p.fn()).toThrow(MediaUnavailableError);
    expect(p.next).not.toHaveBeenCalled();
    expect(p.cancelAssistantDuck).toHaveBeenCalledTimes(1); // parite: eski hat da koşulsuz çağırır
  });

  it('ön-koşul okuması THROW ederse "yok" sayılır (fail-closed → uydurma başarı yok)', () => {
    const next = vi.fn();
    const fn = createMediaNextPort({
      cancelAssistantDuck: vi.fn(),
      hasQueue: () => { throw new Error('kuyruk okunamadı'); },
      hasSession: () => { throw new Error('oturum okunamadı'); },
      next,
    });
    expect(() => fn()).toThrow(MediaUnavailableError);
    expect(next).not.toHaveBeenCalled();
  });

  it('ön-koşul sağlanmıyorsa uçtan uca ok:false ve eski hat İKİNCİ KEZ çalışmaz', async () => {
    const h = setup({
      takeover: true,
      mediaNextImpl: () => { throw new MediaUnavailableError(); },
    });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).not.toHaveBeenCalled();          // ownership alınmış turda çift yürütme YOK
    expect(h.handle.bridge.lastOutcome).toBe('executed');  // tur koştu…
    expect(h.arbiter.currentOwner()).toBeNull();           // …ve sahiplik terminal error ile bırakıldı
  });

  it('gerçek servis THROW ederse çift yürütme yok, sahiplik serbest', async () => {
    const h = setup({
      takeover: true,
      mediaNextImpl: () => { throw new Error('medya servisi düştü'); },
    });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).not.toHaveBeenCalled();
    expect(h.arbiter.currentOwner()).toBeNull();
  });
});

/* ── 5. Yaşam döngüsü ────────────────────────────────────── */

describe('MAVI3-4c — lifecycle / dispose', () => {
  it('dispose sonrası media.next tekrar ESKİ HATTA tam 1', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.maviNext).toHaveBeenCalledTimes(1);

    h.handle.dispose();
    expect(hasMaviOwnershipResolver()).toBe(false); // sorgu söküldü → eski davranış geri geldi

    h.advance(3_000);
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.legacyNext).toHaveBeenCalledTimes(1);
    expect(h.maviNext).toHaveBeenCalledTimes(1); // Mavi bir daha çalışmadı
  });

  it('dispose İDEMPOTENT + hakem pasifleşir', () => {
    const h = setup({ takeover: true });
    h.handle.dispose();
    h.handle.dispose();
    expect(h.arbiter.active).toBe(false);
    expect(hasMaviOwnershipResolver()).toBe(false);
  });

  it('start İDEMPOTENT: tekrar çağrılınca guard/listener iki kez bağlanmaz', async () => {
    const h = setup({ takeover: true });
    h.handle.start(); // ikinci kez
    h.handle.start(); // üçüncü kez
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.maviNext).toHaveBeenCalledTimes(1); // çift abonelik olsaydı 2+ olurdu
    expect(h.legacyRegistrations).toBe(1);
  });
});

/* ── 6. Araç/ECU — hiçbir bayrakla açılamaz ──────────────── */

describe('MAVI3-4c — araç/ECU eylemleri hiçbir bayrakla takeover olamaz', () => {
  it('allowlist zorlansa bile araç sağlığı eski hatta kalır ve Mavi gerçek handler çalışmaz', async () => {
    const arbiter = createTakeoverArbiter();
    const maviHealth = vi.fn(async () => ({ dtcCount: 0, criticalCount: 0, summary: 'x' }));
    const listeners: ((c: ParsedCommandLike) => void)[] = [];
    const legacyOther = vi.fn();

    const handle = createMaviWiring({
      pilotDeps: {
        setTheme: vi.fn(), openScreen: () => true, mediaPlay: vi.fn(), mediaPause: vi.fn(),
        mediaNext: vi.fn(), setVolume: vi.fn(), navigateTo: vi.fn(), openNavScreen: () => true,
        cancelNavigation: vi.fn(), readHealth: maviHealth,
      },
      registerCommandHandler: (fn) => { listeners.push(fn); return () => {}; },
      ttsCancel: vi.fn(),
      mode: 'takeover',
      policy: createTakeoverPolicy({
        mode: 'takeover',
        allowlist: ['media.next', 'vehicle.health.read', 'ecu.write', 'actuator.test'],
      }),
      arbiter,
    });
    handle.start();
    listeners.push((cmd) => { if (!isCommandOwnedByMavi(cmd)) legacyOther(); });

    const cmd = { type: 'vehicle_health_check', raw: 'araç sağlığı' };
    for (const fn of [...listeners]) fn(cmd);
    await flush();

    expect(maviHealth).not.toHaveBeenCalled();     // gerçek araç okuması YOK
    expect(legacyOther).toHaveBeenCalledTimes(1);  // eski hat susturulmadı
    expect(handle.handlerKindOf('vehicle.health.read')).toBe('shadow');
  });
});
