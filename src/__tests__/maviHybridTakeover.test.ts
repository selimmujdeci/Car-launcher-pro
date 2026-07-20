/**
 * maviHybridTakeover.test.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4b.
 *
 * KİLİTLENEN DAVRANIŞLAR:
 *  - TAKEOVER GLOBAL DEĞİL: takeover modunda bile YALNIZ media.next gerçek handler'a bağlanır;
 *    diğer tüm pilot eylemler SHADOW kalır (eski hat onları yapmaya devam eder).
 *  - Araç/ECU eylemleri hiçbir config ile gerçek handler'a bağlanamaz.
 *  - Değer-temelli dedup: aynı dörtlü anahtar ikinci turu AÇMAZ (ikinci execute + ikinci feedback yok).
 *  - Farklı kuşakta aynı doğal dil komutu normal şekilde yeniden çalışır.
 *  - Bayat kuşak execute EDİLMEZ; uçuşta kuşak ilerlerse sonuç typed şekilde reddedilir.
 *  - Sahiplik HER terminal yolda bırakılır — doğruluk dispose'a BAĞLI DEĞİL.
 *  - Geç gelen eski release yeni turun sahipliğini SİLMEZ.
 *  - Hakem throw etse bile gerçek yürütme olmaz (legacy fallback engellenmez).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMaviWiring, buildHybridHandlers, handlerKindFor } from '../platform/maviCore/wiring/maviWiring';
import { createTakeoverPolicy } from '../platform/maviCore/wiring/takeoverPolicy';
import {
  createTakeoverArbiter, _resetTakeoverArbiterForTest,
  type TakeoverArbiter, type TakeoverOwnershipKey,
} from '../platform/maviCore/wiring/takeoverArbiter';
import { commandIdentityOf } from '../platform/maviCore/wiring/maviVoiceBridge';
import type { PilotHandlerDeps } from '../platform/maviCore/wiring/maviPilotHandlers';
import type { MaviFeedback } from '../platform/maviCore/wiring/maviFeedback';
import type { ParsedCommandLike, VoiceLifecycleEventLike } from '../platform/maviCore/wiring/maviVoiceBridge';

/* ── Harness ─────────────────────────────────────────────── */

interface Spies {
  mediaNext: ReturnType<typeof vi.fn>;
  mediaPlay: ReturnType<typeof vi.fn>;
  mediaPause: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  navigateTo: ReturnType<typeof vi.fn>;
  cancelNavigation: ReturnType<typeof vi.fn>;
  readHealth: ReturnType<typeof vi.fn>;
  ttsCancel: ReturnType<typeof vi.fn>;
}

function makeSpies(): Spies {
  return {
    mediaNext: vi.fn(), mediaPlay: vi.fn(), mediaPause: vi.fn(),
    setTheme: vi.fn(), navigateTo: vi.fn(), cancelNavigation: vi.fn(),
    readHealth: vi.fn(async () => ({ dtcCount: 0, criticalCount: 0, summary: 'temiz' })),
    ttsCancel: vi.fn(),
  };
}

function makePilotDeps(s: Spies): PilotHandlerDeps {
  return {
    setTheme: s.setTheme,
    openScreen: () => true,
    mediaPlay: s.mediaPlay,
    mediaPause: s.mediaPause,
    mediaNext: s.mediaNext,
    setVolume: vi.fn(),
    navigateTo: s.navigateTo,
    openNavScreen: () => true,
    cancelNavigation: s.cancelNavigation,
    readHealth: s.readHealth,
  };
}

interface Harness {
  dispatch: (cmd: ParsedCommandLike) => void;
  emitVoiceState: (e: VoiceLifecycleEventLike) => void;
  feedbacks: MaviFeedback[];
  spies: Spies;
  arbiter: TakeoverArbiter;
  handle: ReturnType<typeof createMaviWiring>;
  handlerRegistrations: number;
  voiceStateSubs: number;
  /** Sanal saati ilerlet (executionEngine'in 1500ms dedupe penceresini aşmak için). */
  advance: (ms: number) => void;
}

function setup(opts: { takeover?: boolean; arbiter?: TakeoverArbiter; allowlist?: string[] } = {}): Harness {
  const spies = makeSpies();
  const feedbacks: MaviFeedback[] = [];
  let cmdListener: ((c: ParsedCommandLike) => void) | null = null;
  const stateSubs = new Set<(e: VoiceLifecycleEventLike) => void>(); // gerçek voiceService = Set multiplexer
  const counts = { handlerRegistrations: 0, voiceStateSubs: 0 };
  let clock = 1_000;

  const arbiter = opts.arbiter ?? createTakeoverArbiter();
  const policy = createTakeoverPolicy({
    mode: opts.takeover ? 'takeover' : 'shadow',
    ...(opts.allowlist ? { allowlist: opts.allowlist } : {}),
  });

  const handle = createMaviWiring({
    pilotDeps: makePilotDeps(spies),
    registerCommandHandler: (fn) => {
      counts.handlerRegistrations++;
      cmdListener = fn;
      return () => { cmdListener = null; };
    },
    subscribeVoiceState: (fn) => {
      counts.voiceStateSubs++;
      stateSubs.add(fn);
      return () => { stateSubs.delete(fn); };
    },
    ttsCancel: spies.ttsCancel,
    mode: opts.takeover ? 'takeover' : 'shadow',
    policy,
    arbiter,
    now: () => clock,
    onFeedback: (fb) => { feedbacks.push(fb); },
  });
  handle.start();

  return {
    dispatch: (cmd) => { cmdListener?.(cmd); },
    emitVoiceState: (e) => { for (const fn of [...stateSubs]) fn(e); },
    advance: (ms) => { clock += ms; },
    feedbacks, spies, arbiter, handle,
    get handlerRegistrations() { return counts.handlerRegistrations; },
    get voiceStateSubs() { return counts.voiceStateSubs; },
  };
}

/** Async tur zincirini boşalt (makro görev + mikro görevler — orchestrator await'li). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const NEXT_CMD: ParsedCommandLike = { type: 'music_next', raw: 'sonraki şarkı' };

beforeEach(() => { _resetTakeoverArbiterForTest(); });

/* ── 1. Hibrit handler seçimi ────────────────────────────── */

describe('MAVI3-4b — hibrit handler seçimi (TAKEOVER global DEĞİL)', () => {
  it('SHADOW modunda TÜM pilot eylemler shadow handler\'a bağlanır', () => {
    const h = setup({ takeover: false });
    for (const id of ['media.next', 'media.play', 'media.pause', 'ui.theme.set', 'ui.page.open',
      'media.volume.set', 'navigation.open', 'navigation.cancel', 'vehicle.health.read']) {
      expect(h.handle.handlerKindOf(id)).toBe('shadow');
    }
  });

  it('TAKEOVER modunda YALNIZ media.next gerçek handler alır', () => {
    const h = setup({ takeover: true });
    expect(h.handle.handlerKindOf('media.next')).toBe('real');
    for (const id of ['media.play', 'media.pause', 'ui.theme.set', 'ui.page.open',
      'media.volume.set', 'navigation.open', 'navigation.cancel', 'vehicle.health.read']) {
      expect(h.handle.handlerKindOf(id)).toBe('shadow');
    }
  });

  it('config allowlist\'e araç/ECU eylemi koysa bile gerçek handler\'a BAĞLANMAZ', () => {
    const abusive = createTakeoverPolicy({
      mode: 'takeover',
      allowlist: ['media.next', 'vehicle.health.read', 'ecu.write', 'coding.apply', 'actuator.test', 'dtc.clear'],
    });
    // Araç/ECU eylemleri: pilot sette olan 'vehicle.health.read' SHADOW kalır…
    expect(handlerKindFor('vehicle.health.read', abusive)).toBe('shadow');
    // …pilot sette hiç olmayan ECU kimlikleri sete GİREMEZ (fail-closed genişleme).
    for (const id of ['ecu.write', 'coding.apply', 'actuator.test', 'dtc.clear']) {
      expect(handlerKindFor(id, abusive)).toBe('unknown');
    }
    expect(handlerKindFor('media.next', abusive)).toBe('real');

    const handlers = buildHybridHandlers(makePilotDeps(makeSpies()), abusive);
    expect(handlers['ecu.write']).toBeUndefined();
    expect(handlers['coding.apply']).toBeUndefined();
    expect(Object.keys(handlers).sort()).toEqual([
      'media.next', 'media.pause', 'media.play', 'media.volume.set',
      'navigation.cancel', 'navigation.open', 'ui.page.open', 'ui.theme.set', 'vehicle.health.read',
    ]);
  });

  it('araç/ECU eylemleri gerçek servise HİÇBİR config ile ulaşamaz (uçtan uca)', async () => {
    const h = setup({
      takeover: true,
      allowlist: ['media.next', 'vehicle.health.read', 'ecu.write', 'actuator.test'],
    });
    h.dispatch({ type: 'vehicle_health_check', raw: 'araç sağlığı' });
    await flush();
    expect(h.spies.readHealth).not.toHaveBeenCalled();
  });

  it('SHADOW\'da media.next komutu gerçek servisi ÇAĞIRMAZ (eski hat çalışır)', async () => {
    const h = setup({ takeover: false });
    h.dispatch(NEXT_CMD);
    await flush();
    expect(h.spies.mediaNext).not.toHaveBeenCalled();
    expect(h.handle.bridge.lastOutcome).toBe('shadow');
  });

  it('TAKEOVER\'da media.next gerçek servisi TAM 1 kez çağırır', async () => {
    const h = setup({ takeover: true });
    h.dispatch(NEXT_CMD);
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);
    expect(h.handle.bridge.lastOutcome).toBe('executed');
  });

  it('TAKEOVER\'da media.play/pause ve tema komutları gerçek servisi ÇAĞIRMAZ', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ type: 'open_music', raw: 'müzik aç' });
    h.dispatch({ type: 'stop_music', raw: 'müziği durdur' });
    h.dispatch({ type: 'theme_night', raw: 'gece modu' });
    h.dispatch({ type: 'vehicle_health_check', raw: 'araç sağlığı' });
    await flush();
    expect(h.spies.mediaPlay).not.toHaveBeenCalled();
    expect(h.spies.mediaPause).not.toHaveBeenCalled();
    expect(h.spies.setTheme).not.toHaveBeenCalled();
    expect(h.spies.readHealth).not.toHaveBeenCalled();
  });
});

/* ── 2. Command identity + dedup ─────────────────────────── */

describe('MAVI3-4b — değer-temelli command identity ve dedup', () => {
  it('commandIdentityOf DEĞER eşitliğine dayanır (nesne referansı DEĞİL)', () => {
    expect(commandIdentityOf({ type: 'music_next', raw: 'sonraki' }))
      .toBe(commandIdentityOf({ type: 'music_next', raw: 'Sonraki' })); // normalize
    expect(commandIdentityOf({ type: 'music_next', raw: 'sonraki' }))
      .not.toBe(commandIdentityOf({ type: 'music_next', raw: 'önceki' }));
    expect(commandIdentityOf({ type: 'navigate_address', raw: 'x', extra: { destination: 'Ankara' } }))
      .not.toBe(commandIdentityOf({ type: 'navigate_address', raw: 'x', extra: { destination: 'İzmir' } }));
  });

  it('aynı anahtar iki kez gelirse execution YALNIZ 1 kez olur (farklı nesne, aynı değer)', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ type: 'music_next', raw: 'sonraki şarkı' });
    await flush();
    h.dispatch({ type: 'music_next', raw: 'sonraki şarkı' }); // AYRI nesne, AYNI değer
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);
    expect(h.handle.bridge.lastOutcome).toBe('duplicate');
  });

  it('duplicate İKİNCİ FEEDBACK üretmez', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    const afterFirst = h.feedbacks.length;
    expect(afterFirst).toBeGreaterThan(0);
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.feedbacks.length).toBe(afterFirst); // hiç yeni feedback yok
  });

  it('FARKLI kuşakta aynı doğal dil komutu yeniden çalışır', async () => {
    const h = setup({ takeover: true });
    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);

    // Gerçek bir yeni kuşak = yeni wake + STT turu (saniyeler). Sanal saati buna göre ilerlet.
    h.advance(3_000);
    h.emitVoiceState({ phase: 'listening', generationId: 2, sessionId: 2 }); // yeni tur
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(2);
    expect(h.handle.bridge.lastOutcome).toBe('executed');
  });

  /**
   * BELGELENMİŞ KISIT (Faz-1 executionEngine): motorun duplicate-suppression penceresi (1500ms)
   * ZAMAN temellidir ve KUŞAK-KÖRDÜR. Yeni kuşakta gelen aynı eylem, pencere içindeyse motor
   * tarafından 'duplicate' ile yutulur. Pratikte yeni kuşak tam bir wake+STT turu gerektirdiği
   * için (>1500ms) sahada tetiklenmez; yine de sessizce kaybolmasın diye KİLİTLENİYOR.
   */
  it('KISIT: yeni kuşak dedupe penceresi İÇİNDEYSE motor eylemi yutar (kuşak-kör pencere)', async () => {
    const h = setup({ takeover: true });
    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);

    h.advance(200); // pencere İÇİNDE (gerçekçi değil — yalnız kısıtı belgeler)
    h.emitVoiceState({ phase: 'listening', generationId: 2, sessionId: 2 });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    // Hakem sahipliği VERDİ (claimed) ama motor adımı 'duplicate' ile düşürdü → çift atlama YOK.
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);
    expect(h.arbiter.stats().claimed).toBe(2);
  });

  it('SHADOW\'da da aynı anahtar ikinci turu açmaz (gözlem turu tekil)', async () => {
    const h = setup({ takeover: false });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    const afterFirst = h.feedbacks.length;
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.feedbacks.length).toBe(afterFirst);
  });
});

/* ── 3. Stale generation ─────────────────────────────────── */

describe('MAVI3-4b — bayat kuşak reddi', () => {
  it('hakem daha yeni kuşak görmüşse bayat komut EXECUTE EDİLMEZ', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    // Köprü kuşak 1'de; hakem 5'i gördü (başka bir kaynak ilerletti) → köprünün turu bayat.
    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    arbiter.observeGeneration(5, 5);

    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.spies.mediaNext).not.toHaveBeenCalled();
    // MAVI3-4c: köprü ile eski hat AYNI metoda (isMaviOwned) sorar; o metot bayat anahtara `false`
    // döndüğü için köprü gerekçeyi ayırt etmez ve sahiplik kapısında durur → 'not-owned'.
    // Güvenlik özelliği (yürütme YOK) değişmedi; yalnız typed etiket daha genel.
    expect(h.handle.bridge.lastOutcome).toBe('not-owned');
  });

  it('bayat komut hiç feedback ÜRETMEZ (tur açılmaz)', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    arbiter.observeGeneration(9, 9);
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.feedbacks.length).toBe(0);
  });

  it('yürütme sırasında kuşak ilerlerse SONUÇ typed şekilde reddedilir (başarı iddia edilmez)', async () => {
    const arbiter = createTakeoverArbiter();
    const spies = makeSpies();
    const feedbacks: MaviFeedback[] = [];
    let cmdListener: ((c: ParsedCommandLike) => void) | null = null;
    const stateSubs2 = new Set<(e: VoiceLifecycleEventLike) => void>();

    // mediaNext uzun sürsün: tam bu sırada barge-in (yeni kuşak) gelsin.
    let resolveNext: (() => void) | null = null;
    const pilotDeps = {
      ...makePilotDeps(spies),
      mediaNext: (): Promise<void> => new Promise<void>((r) => { resolveNext = r; }),
    } as unknown as PilotHandlerDeps;

    const handle = createMaviWiring({
      pilotDeps,
      registerCommandHandler: (fn) => { cmdListener = fn; return () => { cmdListener = null; }; },
      subscribeVoiceState: (fn) => { stateSubs2.add(fn); return () => { stateSubs2.delete(fn); }; },
      ttsCancel: spies.ttsCancel,
      mode: 'takeover',
      policy: createTakeoverPolicy({ mode: 'takeover' }),
      arbiter,
      onFeedback: (fb) => { feedbacks.push(fb); },
    });
    handle.start();

    for (const fn of [...stateSubs2]) fn({ phase: 'listening', generationId: 1, sessionId: 1 });
    cmdListener?.({ ...NEXT_CMD });
    await flush();
    expect(handle.bridge.ownedKey).not.toBeNull(); // tur uçuşta, sahiplik bizde

    // Kullanıcı araya girdi → yeni kuşak: sahiplik bayatlar.
    for (const fn of [...stateSubs2]) fn({ phase: 'wake_detected', generationId: 2, sessionId: 2 });
    resolveNext?.();
    await flush();

    expect(handle.bridge.lastOutcome).toBe('stale');
    expect(handle.bridge.ownedKey).toBeNull();
    // Başarı feedback'i ÜRETİLMEDİ (yalnız planlama aşaması olabilir).
    expect(feedbacks.some((f) => f.kind === 'action')).toBe(false);
  });
});

/* ── 4. Ownership release (terminal yollar) ──────────────── */

describe('MAVI3-4b — sahiplik terminal yollarda bırakılır (dispose\'a bağlı DEĞİL)', () => {
  it('BAŞARILI tur sonrası sahiplik serbest (dispose çağrılmadan)', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.handle.bridge.lastOutcome).toBe('executed');
    expect(h.handle.bridge.ownedKey).toBeNull();
    expect(arbiter.currentOwner()).toBeNull();
    expect(arbiter.stats().released).toBe(1);
  });

  it('HATALI tur sonrası sahiplik serbest (servis throw)', async () => {
    const arbiter = createTakeoverArbiter();
    const spies = makeSpies();
    spies.mediaNext.mockImplementation(() => { throw new Error('medya servisi düştü'); });
    let cmdListener: ((c: ParsedCommandLike) => void) | null = null;
    const handle = createMaviWiring({
      pilotDeps: makePilotDeps(spies),
      registerCommandHandler: (fn) => { cmdListener = fn; return () => {}; },
      ttsCancel: spies.ttsCancel,
      mode: 'takeover',
      policy: createTakeoverPolicy({ mode: 'takeover' }),
      arbiter,
    });
    handle.start();
    cmdListener?.({ ...NEXT_CMD });
    await flush();
    expect(handle.bridge.ownedKey).toBeNull();
    expect(arbiter.currentOwner()).toBeNull();
  });

  it('barge-in (cancel) sonrası sahiplik serbest', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    h.dispatch({ ...NEXT_CMD });
    h.handle.bridge.bargeIn();
    await flush();
    expect(h.handle.bridge.ownedKey).toBeNull();
    expect(arbiter.currentOwner()).toBeNull();
  });

  it('TTL dolunca sahiplik timer olmadan düşer (timeout)', async () => {
    let clock = 0;
    const arbiter = createTakeoverArbiter({ now: () => clock, turnTtlMs: 1_000 });
    const key: TakeoverOwnershipKey = { generationId: 1, sessionId: 1, commandId: 'c', actionId: 'media.next' };
    arbiter.activate(createTakeoverPolicy({ mode: 'takeover' }));
    expect(arbiter.claim(key)).toBe('claimed');
    clock = 1_001;
    expect(arbiter.currentOwner()).toBeNull();
    expect(arbiter.stats().timedOut).toBe(1);
  });

  it('GEÇ gelen eski release YENİ turun sahipliğini SİLMEZ', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });

    h.emitVoiceState({ phase: 'listening', generationId: 1, sessionId: 1 });
    const oldKey: TakeoverOwnershipKey = {
      generationId: 1, sessionId: 1,
      commandId: commandIdentityOf(NEXT_CMD), actionId: 'media.next',
    };
    h.dispatch({ ...NEXT_CMD });
    await flush();

    // Yeni kuşak + yeni tur uçuşa geçsin (motor dedupe penceresini aş).
    h.advance(3_000);
    h.emitVoiceState({ phase: 'listening', generationId: 2, sessionId: 2 });
    h.dispatch({ ...NEXT_CMD });
    await flush();

    // Eski turdan GEÇ gelen release → yeni durumu ezmemeli.
    expect(arbiter.release(oldKey, 'completed')).toBe(false);
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(2);
  });

  it('dispose sahiplik zaten bırakılmışken de temiz söker (abonelik sızıntısı yok)', async () => {
    const arbiter = createTakeoverArbiter();
    const h = setup({ takeover: true, arbiter });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    expect(h.handle.bridge.ownedKey).toBeNull(); // terminal yolda ZATEN bırakıldı

    h.handle.dispose();
    expect(arbiter.active).toBe(false);
    h.handle.dispose(); // idempotent
    h.dispatch({ ...NEXT_CMD }); // abonelik söküldü → hiçbir şey olmaz
    await flush();
    expect(h.spies.mediaNext).toHaveBeenCalledTimes(1);
  });
});

/* ── 5. Hakem hatası → legacy fallback engellenmez ───────── */

describe('MAVI3-4b — hakem hatası legacy hattı engellemez', () => {
  it('claim throw ederse GERÇEK yürütme YAPILMAZ (eski hat devrede kalır)', async () => {
    const broken: TakeoverArbiter = {
      ...createTakeoverArbiter(),
      claim: () => { throw new Error('hakem patladı'); },
    } as TakeoverArbiter;

    const h = setup({ takeover: true, arbiter: broken });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    // 'inactive' varsayıldı + eylem gerçek-bağlı → SAHİPLİK KAPISI turu hiç açmadı.
    expect(h.spies.mediaNext).not.toHaveBeenCalled();
    expect(h.handle.bridge.lastOutcome).toBe('not-owned');
  });

  it('observeGeneration throw ederse köprü çökmez', async () => {
    const base = createTakeoverArbiter();
    const broken: TakeoverArbiter = {
      ...base,
      observeGeneration: () => { throw new Error('patlak'); },
    } as TakeoverArbiter;
    const h = setup({ takeover: true, arbiter: broken });
    expect(() => h.emitVoiceState({ phase: 'listening', generationId: 3, sessionId: 3 })).not.toThrow();
  });

  it('subscribeVoiceState throw ederse köprü yine de komut alır (fail-soft)', async () => {
    const spies = makeSpies();
    let cmdListener: ((c: ParsedCommandLike) => void) | null = null;
    const handle = createMaviWiring({
      pilotDeps: makePilotDeps(spies),
      registerCommandHandler: (fn) => { cmdListener = fn; return () => {}; },
      subscribeVoiceState: () => { throw new Error('abone olunamadı'); },
      ttsCancel: spies.ttsCancel,
      mode: 'takeover',
      policy: createTakeoverPolicy({ mode: 'takeover' }),
      arbiter: createTakeoverArbiter(),
    });
    expect(() => handle.start()).not.toThrow();
    cmdListener?.({ ...NEXT_CMD });
    await flush();
    expect(spies.mediaNext).toHaveBeenCalledTimes(1); // sabit kimlikle çalışmaya devam
  });
});

/* ── 6. TTS sınırı ───────────────────────────────────────── */

describe('MAVI3-4b — TTS sınırı (Faz-4\'e kadar sesli çıkış yok)', () => {
  it('köprü ttsCancel DIŞINDA hiçbir konuşma yolu tetiklemez', async () => {
    const h = setup({ takeover: true });
    h.dispatch({ ...NEXT_CMD });
    await flush();
    // Tur idle'da başladığı için barge-in bile gerekmedi → ttsCancel çağrılmadı.
    expect(h.spies.ttsCancel).not.toHaveBeenCalled();
    // Feedback ÜRETİLDİ ama yalnız typed kanala gitti (sesli çıkış bağlı değil).
    expect(h.feedbacks.length).toBeGreaterThan(0);
  });
});
