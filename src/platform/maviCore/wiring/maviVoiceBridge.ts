/**
 * maviCore/wiring/maviVoiceBridge.ts — MAVİ ÇEKİRDEĞİ Faz-2 · voiceService ↔ Orchestrator KÖPRÜSÜ.
 *
 * AMAÇ (task 1/3/4/5): Mevcut komut akışını (voiceService.registerCommandHandler → ParsedCommand)
 * Mavi Orchestrator'a TYPED bağlar. commandParser/intentEngine hattı KALDIRILMAZ — köprü onların
 * çıktısını (ParsedCommand) TÜKETİR (tam coexistence).
 *
 * COEXISTENCE (Model A — SHADOW varsayılan):
 *  - Köprü mevcut komut akışını GÖZLEMLER. Orchestrator akışı (lifecycle/güvenlik-kapısı/telemetry/
 *    context/feedback) GERÇEK trafikte çalışır; pilot handler'lar orchestrator kurulumunda SHADOW
 *    (no-op) verildiğinden GERÇEK eylemi hâlâ eski hat (useVoiceCommandHandler) yapar → ÇİFTE
 *    YÜRÜTME YOK. Feedback event üretilir ama TTS'e bağlı DEĞİL (tüketici ayrı) → çift ses yok.
 *  - TAKEOVER moduna geçiş: orchestrator GERÇEK handler'larla kurulur + useVoiceCommandHandler'a
 *    pilot-atlama guard'ı eklenir (AYRI PR — bu fazda YOK; köprü mode bayrağını taşır).
 *
 * SINIR (voiceService'e DOKUNMA): voiceService/wakeWordService state-subscribe olayı DIŞA AÇMADIĞI
 * için köprü KOMUT-MERKEZLİDİR — her ParsedCommand bir Mavi turu (listen→capture→execute→finish).
 * wake→listening SÜRE telemetrisi bu fazda beslenmez (voiceService'e additive olay kancası ayrı PR).
 *
 * BARGE-IN (task 3): yeni komut gelince veya bargeIn() çağrılınca ttsCancel() + orchestrator.cancel
 * → çalan cevap kesilir, lifecycle sıfırlanır; yeni tur yeni kuşak üretir → eski turun planı stale
 * reddedilir (task 4).
 *
 * FAZ-3 · MAVI3-4b — HAKEM ENTEGRASYONU + DEĞER-TEMELLİ DEDUP:
 *  - Köprü artık her komut için `generationId + sessionId + commandId + actionId` dörtlü SAHİPLİK
 *    ANAHTARI üretir. commandId komut DEĞERİNDEN türetilir (FNV-1a hash) — NESNE REFERANSI dedup
 *    için yeterli DEĞİLDİR (aynı değer farklı nesne olarak gelebilir).
 *  - Kuşak/oturum kimliği voiceService lifecycle olaylarından (MAVI3-1 subscribeVoiceState, DI)
 *    gelir; her kuşak değişiminde hakem `observeGeneration` ile bilgilendirilir → bayat tur otomatik
 *    serbest kalır.
 *  - GERÇEK yürütme YALNIZ `arbiter.claim(key) === 'claimed'` ise başlar. `duplicate`/`stale` →
 *    HİÇBİR tur açılmaz (ikinci execute yok, ikinci feedback yok). `inactive`/`not-eligible` →
 *    Faz-2 SHADOW gözlem turu aynen sürer (handler seti zaten no-op → gerçek servis dokunuşu yok).
 *  - Sahiplik HER terminal yolda bırakılır (completed/error/cancelled/timeout/stale/superseded) →
 *    doğruluk dispose'a BAĞLI DEĞİL; dispose yalnız ek güvenlik ağıdır.
 *  - Hakem throw ederse köprü SHADOW yoluna düşer → eski hattı susturacak state ASLA üretilmez.
 *
 * TTS SINIRI (Faz-3 boyunca): typed feedback ÜRETİLİR ama sesli çıkışa BAĞLANMAZ. voiceService'in
 * handler'lardan ÖNCE konuşan `speakFeedback` akışına DOKUNULMAZ → çift TTS yapısal olarak yok.
 *
 * SAF/DI: voiceService/ttsService DOĞRUDAN import EDİLMEZ (yan-etkisiz maviCore) — registerCommandHandler
 * + ttsCancel + subscribeVoiceState DI ile verilir (SystemBoot wiring gerçeğini bağlar; test mock'lar).
 */

import type { MaviOrchestrator } from '../maviOrchestrator';
import type { MaviPlan, StepResult } from '../executionEngine';
import { MaviFeedbackChannel } from './maviFeedback';
import { buildActionFeedback, buildPlanFeedback, buildStageFeedback } from './maviFeedback';
import { getTakeoverArbiter, type TakeoverArbiter, type TakeoverOwnershipKey } from './takeoverArbiter';
import {
  recordLifecycleEvent, recordTakeoverDecision, recordBargeIn,
  setCurrentCorrelation, sessionCorrelationId, commandCorrelationId,
  type TakeoverDecisionRecord,
} from './maviEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * ParsedCommand → pilot eylem eşlemesi (coexistence glue)
 * ════════════════════════════════════════════════════════════════════════ */

/** Köprünün ihtiyaç duyduğu minimal ParsedCommand görünümü (voiceService tipine bağımlı değil). */
export interface ParsedCommandLike {
  readonly type: string;
  readonly raw?: string;
  readonly extra?: Record<string, unknown>;
}

export interface PilotMapping {
  readonly actionId: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * Varsayılan eşleme: NET pilot karşılığı olan komut tiplerini pilot actionId'ye çevirir. Karşılığı
 * OLMAYAN tip → null (köprü karışmaz, eski hat halleder). Pilot sette olup mevcut parser'da net
 * kaynağı olmayanlar (ui.page.open, navigation.cancel, media.volume.set) burada BİLİNÇLİ boştur —
 * programatik/gelecek kaynak için handler'lar hazır ama sesli eşleme yok (dürüstlük: uydurma yok).
 */
export function defaultPilotCommandMap(cmd: ParsedCommandLike): PilotMapping | null {
  switch (cmd.type) {
    case 'theme_night':
    case 'theme_dark':  return { actionId: 'ui.theme.set', payload: { theme: 'night' } };
    case 'theme_day':   return { actionId: 'ui.theme.set', payload: { theme: 'day' } };
    case 'theme_oled':  return { actionId: 'ui.theme.set', payload: { theme: 'oled' } };

    case 'open_music':
    case 'open_radio':  return { actionId: 'media.play' };
    case 'stop_music':  return { actionId: 'media.pause' };
    case 'music_next':  return { actionId: 'media.next' };

    case 'navigate_address':
    case 'navigate_place': {
      const dest = typeof cmd.extra?.destination === 'string'
        ? cmd.extra.destination
        : (typeof cmd.raw === 'string' ? cmd.raw : '');
      return dest ? { actionId: 'navigation.open', payload: { destination: dest } } : null;
    }
    case 'open_maps':   return { actionId: 'navigation.open' };

    case 'vehicle_health_check': return { actionId: 'vehicle.health.read' };

    default: return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Komut kimliği (DEĞER-temelli — nesne referansı YETERSİZ)
 * ════════════════════════════════════════════════════════════════════════ */

/** voiceService kuşak/oturum kimliği (MAVI3-1 lifecycle olaylarından beslenir). */
export interface VoiceIdentity {
  readonly generationId: number;
  readonly sessionId: number;
}

/** Köprünün ihtiyaç duyduğu minimal lifecycle olayı görünümü (voiceService tipine bağımlı değil). */
export interface VoiceLifecycleEventLike {
  readonly phase: string;
  readonly generationId: number;
  readonly sessionId: number;
  /** Monotonik an (voiceService sağlar). Opsiyonel — saf testler vermeyebilir. */
  readonly at?: number;
  /** MAVI-INSTRUMENTATION-1 — yalnız 'execution_result' fazı: bounded sonuç kodu. */
  readonly result?: string;
}

/** FNV-1a 32-bit — hızlı, allocation'sız, deterministik. Ham metin SAKLANMAZ (yalnız hash). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Komutun DEĞER-temelli tekil kimliği: `type` + ham metnin normalize edilmiş hash'i. Aynı DEĞERE
 * sahip iki AYRI nesne AYNI commandId'yi üretir (nesne referansı dedup için yetersizdir); farklı
 * komutlar farklı kimlik alır. Ham transkript TAŞINMAZ (PII yok — yalnız hash).
 */
export function commandIdentityOf(cmd: ParsedCommandLike): string {
  const type = typeof cmd?.type === 'string' ? cmd.type : 'unknown';
  const raw = typeof cmd?.raw === 'string' ? cmd.raw.trim().toLowerCase() : '';
  // extra alanı da kimliğe girer (ör. farklı hedefli iki navigate_address ayrı komuttur).
  let extraSig = '';
  if (cmd?.extra && typeof cmd.extra === 'object') {
    const keys = Object.keys(cmd.extra).sort();
    for (const k of keys) extraSig += `${k}=${String((cmd.extra as Record<string, unknown>)[k])};`;
  }
  return `${type}#${fnv1a(raw).toString(16)}${extraSig ? '.' + fnv1a(extraSig).toString(16) : ''}`;
}

/** Dörtlü sahiplik anahtarını kurar (hakem sözleşmesi). */
export function buildOwnershipKey(
  identity: VoiceIdentity, commandId: string, actionId: string,
): TakeoverOwnershipKey {
  return { generationId: identity.generationId, sessionId: identity.sessionId, commandId, actionId };
}

/** Değer eşitliği — nesne kimliği DEĞİL. */
function sameOwnershipKey(a: TakeoverOwnershipKey, b: TakeoverOwnershipKey): boolean {
  return a.generationId === b.generationId && a.sessionId === b.sessionId
    && a.commandId === b.commandId && a.actionId === b.actionId;
}

/** Kuşak başına görülen anahtar sayısı üst sınırı (bounded — sınırsız büyüme yok). */
const MAX_SEEN_KEYS_PER_GENERATION = 16;

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviBridgeMode = 'shadow' | 'takeover';

/** Bir turun neden yürütülmediği / nasıl bittiği (typed — serbest metin yok). */
export type MaviTurnOutcome =
  | 'shadow'        // gözlem turu koştu (gerçek servis dokunuşu yok)
  | 'executed'      // GERÇEK yürütme yapıldı (claimed)
  | 'duplicate'     // aynı anahtar zaten işlendi → tur AÇILMADI
  | 'stale'         // bayat kuşak → tur AÇILMADI
  | 'not-owned'     // eylem GERÇEK handler'a bağlı ama sahiplik ALINAMADI → tur AÇILMADI
  | 'rejected'      // lifecycle capture reddetti (yarış)
  | 'error';        // beklenmeyen hata (fail-soft)

export interface MaviVoiceBridgeDeps {
  readonly orchestrator: MaviOrchestrator;
  readonly feedback: MaviFeedbackChannel;
  /** voiceService.registerCommandHandler (DI). Cleanup döner. */
  readonly registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  /** ttsService.ttsCancel (DI) — barge-in'de çalan cevabı keser. */
  readonly ttsCancel: () => void;
  /** ParsedCommand → pilot eşleyici (varsayılan defaultPilotCommandMap). */
  readonly mapCommand?: (cmd: ParsedCommandLike) => PilotMapping | null;
  /** Coexistence modu (varsayılan 'shadow'). Bilgi amaçlı — handler seçimi orchestrator kurulumunda. */
  readonly mode?: MaviBridgeMode;
  /**
   * TAKEOVER hakemi (varsayılan: modül tekil örneği). Kuşak gözlemi + claim/release burada yapılır.
   * Hakem PASİF ise (varsayılan) davranış Faz-2 SHADOW ile BİREBİR aynıdır.
   */
  readonly arbiter?: TakeoverArbiter;
  /**
   * voiceService.subscribeVoiceState (MAVI3-1, DI). Kuşak/oturum kimliğini besler. Verilmezse
   * köprü sabit kimlikle (gen=0, session=0) çalışır — dedup yine DEĞER-temelli işler, yalnız
   * kuşak-tabanlı bayatlık reddi devre dışı kalır (saf testler için).
   */
  readonly subscribeVoiceState?: (listener: (e: VoiceLifecycleEventLike) => void) => () => void;
  /**
   * Bu eylem orchestrator'da GERÇEK handler'a mı bağlı (wiring bilir). Sahiplik alınamadığında
   * gerçek-bağlı eylemin planı HİÇ çalıştırılmaz → claim reddedilirken bile çifte yürütme olmaz.
   * Verilmezse tüm eylemler shadow varsayılır (saf testler + Faz-2 uyumu).
   */
  readonly isRealHandler?: (actionId: string) => boolean;
}

export class MaviVoiceBridge {
  private readonly _orch: MaviOrchestrator;
  private readonly _feedback: MaviFeedbackChannel;
  private readonly _registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  private readonly _ttsCancel: () => void;
  private readonly _map: (cmd: ParsedCommandLike) => PilotMapping | null;
  private readonly _mode: MaviBridgeMode;

  private readonly _arbiter: TakeoverArbiter;
  private readonly _subscribeVoiceState?: (listener: (e: VoiceLifecycleEventLike) => void) => () => void;
  private readonly _isRealHandler: (actionId: string) => boolean;

  private _started = false;
  private _unregister: (() => void) | null = null;
  private _unsubVoiceState: (() => void) | null = null;

  /** Aktif kuşak/oturum kimliği (lifecycle olaylarından; abonelik yoksa sabit 0/0). */
  private _identity: VoiceIdentity = { generationId: 0, sessionId: 0 };
  /** Bu köprünün SAHİPLENDİĞİ aktif tur anahtarı — release'in tek kaynağı. */
  private _ownedKey: TakeoverOwnershipKey | null = null;
  /** Bu kuşakta görülen komut anahtarları (bounded; kuşak değişince temizlenir). */
  private _seenKeys: string[] = [];
  private _seenGeneration = -1;
  /** Son turun typed sonucu — tanı/test gözlemi (sesli çıkışa BAĞLI DEĞİL). */
  private _lastOutcome: MaviTurnOutcome | null = null;
  /** Son lifecycle olayının monotonik anı — olaylar arası latency kanıtı (tek sayı, bounded). */
  private _lastEventMono = -1;

  constructor(deps: MaviVoiceBridgeDeps) {
    this._orch = deps.orchestrator;
    this._feedback = deps.feedback;
    this._registerCommandHandler = deps.registerCommandHandler;
    this._ttsCancel = deps.ttsCancel;
    this._map = typeof deps.mapCommand === 'function' ? deps.mapCommand : defaultPilotCommandMap;
    this._mode = deps.mode === 'takeover' ? 'takeover' : 'shadow';
    this._arbiter = deps.arbiter ?? getTakeoverArbiter();
    this._subscribeVoiceState = deps.subscribeVoiceState;
    this._isRealHandler = typeof deps.isRealHandler === 'function' ? deps.isRealHandler : () => false;
  }

  get mode(): MaviBridgeMode { return this._mode; }
  /**
   * Anlık kuşak/oturum kimliği. Eski hattın sahiplik sorgusu (maviOwnership) BU kimliği kullanır →
   * iki hat aynı komut için AYNI anahtarı üretir (paralel kimlik mantığı yok).
   */
  get identity(): VoiceIdentity { return this._identity; }
  /** Son turun typed sonucu (tanı). */
  get lastOutcome(): MaviTurnOutcome | null { return this._lastOutcome; }
  /** Şu an bu köprünün sahiplendiği anahtar (tanı) — terminal yolda null'a döner. */
  get ownedKey(): TakeoverOwnershipKey | null { return this._ownedKey; }

  /** Kur — idempotent. voiceService komut akışına + lifecycle olaylarına abone olur. */
  start(): void {
    if (this._started) return;
    this._started = true;
    this._orch.start();
    // Kuşak gözlemi komut aboneliğinden ÖNCE kurulur → ilk komut taze kimlikle işlenir.
    if (typeof this._subscribeVoiceState === 'function') {
      try {
        this._unsubVoiceState = this._subscribeVoiceState((e) => this._onVoiceState(e));
      } catch { /* fail-soft: lifecycle gözlemi olmadan da köprü çalışır */ }
    }
    this._unregister = this._registerCommandHandler((cmd) => this._onCommand(cmd));
  }

  /** Sök — idempotent. Abonelik + orchestrator + feedback + sahiplik temizlenir. */
  dispose(): void {
    // Sahiplik doğruluğu dispose'a BAĞLI DEĞİL (terminal yollarda zaten bırakılır); bu yalnız ağ.
    this._releaseOwnership('superseded');
    if (!this._started) { this._feedback.reset(); return; }
    this._started = false;
    if (this._unsubVoiceState) { try { this._unsubVoiceState(); } catch { /* fail-soft */ } this._unsubVoiceState = null; }
    if (this._unregister) { try { this._unregister(); } catch { /* fail-soft */ } this._unregister = null; }
    try { this._orch.dispose(); } catch { /* fail-soft */ }
    this._feedback.reset();
    this._seenKeys = [];
    this._seenGeneration = -1;
  }

  restart(): void { this.dispose(); this.start(); }

  /**
   * Barge-in / iptal: çalan cevabı kes (ttsCancel) + lifecycle'ı iptal edip idle'a döndür. Yeni
   * turun beginListening'i yeni kuşak üreteceğinden eski turun (varsa uçuştaki) planı stale reddedilir.
   */
  bargeIn(): void {
    try { this._ttsCancel(); } catch { /* fail-soft */ }
    // Kullanıcı araya girdi → uçuştaki turun sahipliği DERHAL bırakılır (dispose beklenmez).
    this._releaseOwnership('cancelled');
    // Aktif bir tur varsa iptal et → cancelled; sonra recover → idle (yeni tur kuşağı için hazır).
    if (this._orch.state !== 'idle') {
      this._orch.cancel();
      this._orch.recover();
    }
  }

  /* ── Sahiplik yaşam döngüsü ─────────────────────────────────── */

  /**
   * Sahipliği bırak — İDEMPOTENT. Hakem anahtar-eşleşmeli çalıştığı için GEÇ gelen bir release
   * yeni turun sahipliğini SİLEMEZ (hakem eşleşmeyen anahtarda no-op döner).
   */
  private _releaseOwnership(reason: 'completed' | 'error' | 'cancelled' | 'timeout' | 'stale' | 'superseded'): void {
    const key = this._ownedKey;
    if (!key) return;
    this._ownedKey = null;
    try { this._arbiter.release(key, reason); } catch { /* fail-soft: hakem hatası köprüyü bozmaz */ }
  }

  /** Bu köprü hâlâ verilen anahtarın sahibi mi (stale sonuç reddi için). */
  private _stillOwns(key: TakeoverOwnershipKey): boolean {
    if (!this._ownedKey || !sameOwnershipKey(this._ownedKey, key)) return false;
    try {
      const owner = this._arbiter.currentOwner();
      return owner !== null && sameOwnershipKey(owner.key, key);
    } catch {
      return false; // fail-soft → başarı iddia etme
    }
  }

  /* ── İç akış ────────────────────────────────────────────────── */

  /** Lifecycle olayı: kuşak/oturum kimliğini tazele + hakemi bilgilendir (bayat tur otomatik düşer). */
  private _onVoiceState(e: VoiceLifecycleEventLike): void {
    if (!e || !Number.isFinite(e.generationId) || !Number.isFinite(e.sessionId)) return;

    // PR-DIAG-2 · ÜRETİCİ #1: HAM lifecycle olayı kaydı. MEVCUT aboneliğin içinde — yeni abonelik
    // YOK. Aynı-kimlik erken çıkışından ÖNCE yazılır; aksi halde bir kuşak içindeki fazlar
    // (listening→transcribing→speaking) kanıta HİÇ girmezdi. Kayıt fail-soft.
    try {
      const atMono = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : -1;
      const latencyMs = this._lastEventMono >= 0 && atMono >= this._lastEventMono
        ? atMono - this._lastEventMono
        : undefined;
      if (atMono >= 0) this._lastEventMono = atMono;
      recordLifecycleEvent({
        phase: e.phase,
        atMs: Date.now(),
        atMono,
        generationId: e.generationId,
        sessionId: e.sessionId,
        correlationId: sessionCorrelationId(e.generationId, e.sessionId),
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        ...(typeof e.result === 'string' && e.result.length > 0 ? { result: e.result } : {}),
      });
    } catch { /* fail-soft: tanı yazımı köprüyü ASLA bozmaz */ }

    if (e.generationId === this._identity.generationId && e.sessionId === this._identity.sessionId) return;
    this._identity = { generationId: e.generationId, sessionId: e.sessionId };
    try { this._arbiter.observeGeneration(e.generationId, e.sessionId); } catch { /* fail-soft */ }
    // Kuşak ilerledi → bizim uçuştaki turumuz artık bayat; sahipliği bırak.
    if (this._ownedKey && this._ownedKey.generationId < e.generationId) {
      const stale = this._ownedKey;
      this._ownedKey = null; // hakem zaten 'stale' ile düşürdü — çifte release'e gerek yok
      this._lastOutcome = 'stale';
      // ÜRETİCİ #4 (barge-in): kuşak ilerlemesiyle düşen tur kanıta girer.
      try {
        recordBargeIn({
          atMs: Date.now(),
          correlationId: sessionCorrelationId(stale.generationId, stale.sessionId),
          oldGeneration: stale.generationId,
          newGeneration: e.generationId,
          staleDecision: true,
          cancelledExecution: true,
          releaseReason: 'stale',
        });
      } catch { /* fail-soft */ }
    }
  }

  /** Bu kuşakta bu anahtar daha önce görüldü mü (değer-temelli, bounded). */
  private _isDuplicateKey(key: TakeoverOwnershipKey): boolean {
    if (this._seenGeneration !== key.generationId) {
      this._seenGeneration = key.generationId;
      this._seenKeys = [];
      return false;
    }
    return this._seenKeys.includes(keySignature(key));
  }

  private _markSeen(key: TakeoverOwnershipKey): void {
    const sig = keySignature(key);
    if (this._seenKeys.includes(sig)) return;
    this._seenKeys.push(sig);
    if (this._seenKeys.length > MAX_SEEN_KEYS_PER_GENERATION) this._seenKeys.shift();
  }

  /**
   * PR-DIAG-2 · ÜRETİCİ #2: komut kararının TAM zincirini tek kayıtta yazar. Tüm alanlar zaten
   * bu akışta hesaplanmıştır — yeni ölçüm YOK. Fail-soft.
   */
  private _recordDecision(
    cmd: ParsedCommandLike, key: TakeoverOwnershipKey, fields: Partial<TakeoverDecisionRecord>,
  ): void {
    try {
      recordTakeoverDecision({
        atMs: Date.now(),
        generationId: key.generationId,
        sessionId: key.sessionId,
        commandType: cmd.type,
        commandId: key.commandId,
        correlationId: commandCorrelationId(key.generationId, key.sessionId, key.commandId),
        resolvedAction: key.actionId,
        legacyCandidate: true,   // eski hat her ParsedCommand'ı görür (guard'la elenir)
        maviCandidate: true,     // eşleme bulundu → Mavi adayı
        flagState: this._mode,
        allowlisted: false,
        ownershipDecision: false,
        claimOutcome: null,
        owner: null,
        executedBy: 'none',
        executionResult: null,
        releaseReason: null,
        errorReason: null,
        ...fields,
      });
    } catch { /* fail-soft */ }
  }

  private _onCommand(cmd: ParsedCommandLike): void {
    if (!cmd || typeof cmd.type !== 'string') return;
    const mapped = this._map(cmd);
    if (!mapped) return; // pilot değil → eski hat halleder (coexistence)

    const key = buildOwnershipKey(this._identity, commandIdentityOf(cmd), mapped.actionId);

    // 1. DEĞER-temelli dedup: aynı kuşakta aynı anahtar → İKİNCİ TUR AÇILMAZ (execute+feedback yok).
    if (this._isDuplicateKey(key)) {
      this._lastOutcome = 'duplicate';
      this._recordDecision(cmd, key, { claimOutcome: 'duplicate', releaseReason: 'duplicate' });
      return;
    }

    // 2. ORTAK KARAR: eski hattın sorduğu METODUN AYNISI (`isMaviOwned`). İki hattın farklı
    //    metotlara sorması, kısmi arızada ikisinin birden çalışmasına yol açardı; tek metot
    //    üzerinden gitmek bunu YAPISAL olarak imkânsız kılar. Throw/false → devralma YOK.
    let owned = false;
    try { owned = this._arbiter.isMaviOwned(key) === true; } catch { owned = false; }

    // 3. Sahiplenme (dedup + yaşam döngüsü). Yalnız ortak karar 'true' ise denenir.
    let outcome: string = 'inactive';
    if (owned) {
      try { outcome = this._arbiter.claim(key); } catch { outcome = 'inactive'; }
    }

    // Eligibility (allowlist ∩ eligible) — kanıt alanı; karar hakemde.
    let allowlisted = false;
    try { allowlisted = this._arbiter.active && this._isRealHandler(mapped.actionId); } catch { allowlisted = false; }

    // 4. Bayat kuşak / hakem seviyesinde duplicate → hiçbir tur açılmaz.
    if (outcome === 'stale') {
      this._lastOutcome = 'stale'; this._markSeen(key);
      this._recordDecision(cmd, key, { allowlisted, ownershipDecision: owned, claimOutcome: 'stale', releaseReason: 'stale' });
      return;
    }
    if (outcome === 'duplicate') {
      this._lastOutcome = 'duplicate'; this._markSeen(key);
      this._recordDecision(cmd, key, { allowlisted, ownershipDecision: owned, claimOutcome: 'duplicate', releaseReason: 'duplicate' });
      return;
    }

    this._markSeen(key);
    const claimed = outcome === 'claimed';

    // 5. SAHİPLİK KAPISI: eylem GERÇEK handler'a bağlıysa ama sahiplik alınamadıysa (hakem pasif/
    //    hata/eligible değil) planı HİÇ çalıştırma — aksi halde orchestrator gerçek servisi çağırır
    //    ve eski hatla birlikte ÇİFTE YÜRÜTME olurdu. Eski hat zaten fail-open olarak devrededir.
    let realWired = false;
    try { realWired = this._isRealHandler(mapped.actionId); } catch { realWired = false; }
    if (!claimed && realWired) {
      this._lastOutcome = 'not-owned';
      this._recordDecision(cmd, key, {
        allowlisted, ownershipDecision: owned, claimOutcome: outcome,
        executedBy: 'none', releaseReason: 'not_owned',
      });
      return;
    }

    // 'claimed' → GERÇEK yürütme (sahiplik bizde). Aksi halde Faz-2 SHADOW gözlem turu.
    if (claimed) this._ownedKey = key;
    void this._runTurn(mapped, key, claimed, cmd, { allowlisted, ownershipDecision: owned, claimOutcome: outcome });
  }

  private async _runTurn(
    mapped: PilotMapping, key: TakeoverOwnershipKey, claimed: boolean,
    cmd?: ParsedCommandLike, decisionFields?: Partial<TakeoverDecisionRecord>,
  ): Promise<void> {
    // PR-DIAG-2 · CORRELATION: turun tamamı (derinlerdeki media portu dahil) bu kimlikle
    // ilişkilendirilir. Terminal yolda `finally` ile TEMİZLENİR. Davranışa etkisi YOKTUR.
    const correlationId = commandCorrelationId(key.generationId, key.sessionId, key.commandId);
    if (claimed) { try { setCurrentCorrelation(correlationId); } catch { /* fail-soft */ } }
    /** Terminal kanıt kaydı — tur nasıl bittiyse öyle yazılır (yorum YOK). */
    const finalize = (fields: Partial<TakeoverDecisionRecord>): void => {
      if (cmd) this._recordDecision(cmd, key, { ...decisionFields, ...fields });
    };

    // Yeni tur: önceki tur hâlâ açıksa (idle değil) barge-in ile temizle → yeni kuşak.
    // NOT: bargeIn sahipliği bırakır; bu turun sahipliği _onCommand'da SONRA atandığından korunur.
    if (this._orch.state !== 'idle') {
      try { this._ttsCancel(); } catch { /* fail-soft */ }
      this._orch.cancel();
      this._orch.recover();
    }

    try {
      // Komut-merkezli tur: listening→understanding (wake/dinleme gerçekte voiceService'te oldu).
      this._orch.beginListening();
      const token = this._orch.capture();
      if (!token) {
        // lifecycle reddetti (yarış) → gerçek yürütme YOK; sahiplik derhal bırakılır.
        this._lastOutcome = 'rejected';
        if (claimed) this._releaseOwnership('cancelled');
        finalize({ executedBy: 'none', executionResult: 'rejected', releaseReason: 'cancelled' });
        return;
      }

      // Sessiz bırakmama: planlama başında nötr ara feedback.
      this._feedback.emit(buildStageFeedback('planning'));

      const plan: MaviPlan = {
        mode: 'sequential',
        steps: [{ actionId: mapped.actionId, payload: mapped.payload }],
      };
      const result = await this._orch.execute(plan, token);

      // STALE SONUÇ REDDİ (typed): yürütme sırasında kuşak ilerlediyse/sahiplik devrolduysa bu turun
      // sonucu artık geçerli DEĞİL → feedback ÜRETİLMEZ, başarı İDDİA EDİLMEZ.
      if (claimed && !this._stillOwns(key)) {
        this._lastOutcome = 'stale';
        this._ownedKey = null;
        try { if (this._orch.state !== 'idle') { this._orch.cancel(); this._orch.recover(); } } catch { /* noop */ }
        finalize({ executedBy: 'none', executionResult: 'stale_result', releaseReason: 'stale' });
        return;
      }

      // Sonuç doğrulama → typed feedback (dürüst). TTS'e BAĞLI DEĞİL (Faz-4).
      const step: StepResult | undefined = result.steps[0];
      if (step) {
        const successText = extractSuccessText(mapped.actionId, step.value);
        this._feedback.emit(buildActionFeedback(step, successText ? { successText } : {}));
      } else {
        this._feedback.emit(buildPlanFeedback(result));
      }

      // Turu kapat (executing → idle + telemetry oturumu).
      this._orch.finish();
      this._lastOutcome = claimed ? 'executed' : 'shadow';
      // TERMİNAL: sahiplik burada bırakılır — dispose BEKLENMEZ.
      const releaseReason = step && step.status === 'ok' ? 'completed'
        : step && step.status === 'timeout' ? 'timeout'
          : 'error';
      if (claimed) this._releaseOwnership(releaseReason);
      finalize({
        executedBy: claimed ? 'mavi' : 'none',
        owner: claimed ? 'mavi' : null,
        executionResult: step ? step.status : 'no_step',
        releaseReason: claimed ? releaseReason : null,
        errorReason: step && step.status !== 'ok' ? (step.reason ?? step.status) : null,
      });
    } catch (e) {
      // Fail-soft: köprü hiçbir koşulda uygulamayı çökertmez; turu güvenli kapat + sahipliği bırak.
      this._lastOutcome = 'error';
      try { if (this._orch.state !== 'idle') { this._orch.fail(); this._orch.recover(); } } catch { /* noop */ }
      if (claimed) this._releaseOwnership('error');
      finalize({
        executedBy: claimed ? 'mavi' : 'none',
        owner: claimed ? 'mavi' : null,
        executionResult: 'exception',
        releaseReason: claimed ? 'error' : null,
        errorReason: e instanceof Error ? e.name : 'unknown_error',
      });
    } finally {
      // Correlation bağlamı turla birlikte KAPANIR (sızmaz).
      if (claimed) { try { setCurrentCorrelation(null); } catch { /* fail-soft */ } }
    }
  }
}

/** Anahtarın değer imzası (dedup listesi için — nesne referansı DEĞİL). */
function keySignature(key: TakeoverOwnershipKey): string {
  return `${key.generationId}:${key.sessionId}:${key.commandId}:${key.actionId}`;
}

/** Araç sağlığı gibi değer taşıyan eylemlerde başarı metnini çıkar (yoksa generic "Tamam"). */
function extractSuccessText(actionId: string, value: unknown): string | undefined {
  if (actionId === 'vehicle.health.read' && value && typeof value === 'object') {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim();
  }
  return undefined;
}

export function createMaviVoiceBridge(deps: MaviVoiceBridgeDeps): MaviVoiceBridge {
  return new MaviVoiceBridge(deps);
}
