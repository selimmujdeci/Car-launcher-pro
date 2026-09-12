/**
 * listeningSessionRuntime.ts — F3 · Dinleme bağlamının TEK yürütme dikişi.
 *
 * Kanonik zincir (değişmedi, yalnız başı eklendi):
 *   `Library selection → ListeningIntent + MediaRefs → PlayQueue (desired)
 *      → MediaCommandGateway → F0 playback authority → observed evidence
 *      → queue reconciliation`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Bu modül de ses ÜRETMEZ; komutu YALNIZ `mediaCommandGateway` verir.
 *   · Kurtarma ASLA çalmaz (`autoPlay: false`) — "geri yüklendi" ile "çalıyor"
 *     birbirine karıştırılmaz.
 *   · Kaynak kaybında rastgele sağlayıcıda otomatik çalma YOKTUR; süreklilik
 *     kararı `sessionContinuity`den gelir ve WEAK/UNKNOWN taşımaz.
 */

import { logError } from '../../crashLogger';
import type { SourceClass } from '../authority/sourceCapabilities';
import { getSource } from '../authority/sourceCapabilities';
import type { CommandTruth } from '../authority/playbackTruth';
import {
  addToQueue, advance, createQueue, getCurrentEntry, getDesiredQueue, removeAt, reorder,
  restoreQueue, revalidateQueue, setCurrentIndex,
  type QueueEntry, type QueueOperationResult,
} from './playQueue';
import type { ProviderQueueContext } from './providerQueueContext';
import {
  getListeningSession, noteContinuity, noteCurrentItem, noteQueueRevision,
  noteSourceChange, startListeningSession, type ListeningIntent,
} from './listeningSession';
import { buildLibraryQueueContext, type LibrarySelection } from './libraryQueueContext';
import { evaluateContinuity, mayAutoResume, type ContinuityDecision } from './sessionContinuity';
import {
  clearPersistedListeningSession, parsePersistedListeningSession, persistListeningSession,
  readPersistedListeningSessionRaw, type RestoreResult,
} from './sessionPersistence';
import type { IdentityMatchGrade } from './mediaIdentityMatching';
import {
  noteCommitDropped, noteContinuityState, noteFulfillment, noteHandover,
  noteIdentityFidelity, noteQueueCommand, noteSessionCommitted,
} from './sessionTelemetry';
/* MUSIC F21 · Geri yükleme TAZELİK sınıflandırması (SAF politika).
   Yeni bir kurtarma otoritesi DEĞİLDİR: karar SAF modelde, yürütme BURADA. */
import { classifyEntryFreshness, shouldDropOnRestore } from '../recovery/recoveryModel';
import {
  noteBootRestoreRun, noteBootRestoreSkippedNativeLive,
  noteEntryFreshness, noteRestoreAttempt,
} from '../recovery/recoveryTelemetry';

/** Native kuyruğa yazılan pencere — F0/F2'deki 120'lik pencere sözleşmesiyle aynı. */
export const DISPATCH_WINDOW = 120;

export interface StartListeningResult {
  readonly started: boolean;
  readonly reason: string;
  readonly queueResult: QueueOperationResult | null;
  /** Gateway'in döndürdüğü komut gerçeği — `null` ise komut HİÇ gönderilmedi. */
  readonly truth: CommandTruth | null;
}

const failed = (reason: string, queueResult: QueueOperationResult | null = null): StartListeningResult =>
  Object.freeze({ started: false, reason, queueResult, truth: null });

/** Kalıcılık kancası — üretimde `sessionPersistence`, testte enjekte edilir. */
let persistFn = persistListeningSession;

export interface DispatchArgs {
  readonly source: SourceClass;
  readonly items: readonly QueueEntry['item'][];
  readonly startIndex: number;
  readonly autoPlay: boolean;
}

/**
 * Komut sonucunun YANINDA taşınan bayatlık kanıtı.
 *
 * `gatewaySessionId`, komut DÖNDÜĞÜ ANDA kapının kanonik oturum kimliğidir.
 * `truth.sessionId` ile eşleşmiyorsa araya BAŞKA bir komut girmiştir ve bu sonuç
 * artık güncel dünyayı anlatmaz (Cross-Domain §17).
 */
export interface DispatchOutcome {
  readonly truth: CommandTruth;
  readonly gatewaySessionId: string | null;
  readonly generation: number | null;
}

/** Gateway kancası — üretimde dinamik import, testte enjekte edilir. */
let dispatchFn: ((args: DispatchArgs) => Promise<DispatchOutcome>) | null = null;

/**
 * Gateway'i DİNAMİK yükler: oturum katmanı ana pakete komut/backend zincirini
 * çekmesin (düşük-uç bütçesi — F0'daki desenle aynı).
 */
async function dispatch(args: DispatchArgs): Promise<DispatchOutcome> {
  if (dispatchFn) return dispatchFn(args);
  const [gateway, { noteQueue }] = await Promise.all([
    import('../authority/mediaCommandGateway'),
    import('../authority/mediaAuthorityRuntime'),
  ]);
  noteQueue(args.source, args.items, args.startIndex);
  const truth = await gateway.playSource({
    source: args.source,
    items: [...args.items],
    startIndex: args.startIndex,
    autoPlay: args.autoPlay,
  });
  return Object.freeze({
    truth,
    gatewaySessionId: gateway.getMediaSessionId(),
    generation: gateway.getAuthorityGeneration(),
  });
}

/** Aktif parça çevresinde SINIRLI pencere — binlerce parça native'e yazılmaz. */
export function windowAround(
  entries: readonly QueueEntry[], index: number, size = DISPATCH_WINDOW,
): { readonly items: readonly QueueEntry['item'][]; readonly startIndex: number } {
  if (entries.length <= size) {
    return { items: entries.map((e) => e.item), startIndex: Math.max(0, index) };
  }
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, index - half), entries.length - size);
  return { items: entries.slice(start, start + size).map((e) => e.item), startIndex: index - start };
}

function persistNow(nowMs: number): void {
  const session = getListeningSession();
  const queue = getDesiredQueue();
  if (!session || queue.entries.length === 0 || queue.source === null) return;
  persistFn({
    sessionId: session.sessionId,
    intent: session.intent,
    intentRef: session.intentRef,
    originSource: session.originSource,
    currentSource: queue.source,
    queueId: queue.queueId,
    queueRevision: queue.revision,
    entries: queue.entries,
    currentIndex: queue.currentIndex,
    startedAt: session.startedAt,
    ignitionRef: session.ignitionRef,
    nowMs,
  });
}

/**
 * Kütüphane seçiminden dinleme başlatır. Niyet ÇAĞIRANDAN gelir; bu fonksiyon
 * metadata'ya bakıp niyet TAHMİN ETMEZ.
 */
export async function startLibraryListening(
  selection: LibrarySelection,
  options: { source?: SourceClass; nowMs?: number; ignitionRef?: string | null } = {},
): Promise<StartListeningResult> {
  const source = options.source ?? 'LOCAL';
  const nowMs = options.nowMs ?? Date.now();

  const context = buildLibraryQueueContext(selection);
  if (!context) return failed('Seçim kütüphanede yok veya erişilebilir parça kalmadı.');

  const queueResult = createQueue(source, context.entries, context.startIndex);
  if (queueResult.status !== 'APPLIED') {
    return failed(`Kuyruk kurulamadı: ${queueResult.reason}`, queueResult);
  }

  // Yeni dinleme bağlamı: önceki devrin bileti artık hiçbir şeyi commit EDEMEZ.
  _activeTicket = null;

  const queue = getDesiredQueue();
  const current = getCurrentEntry();
  startListeningSession({
    intent: context.intent,
    intentRef: context.intentRef,
    source,
    queueId: queue.queueId,
    queueRevision: queue.revision,
    currentItem: current ? current.identity : null,
    ignitionRef: options.ignitionRef ?? null,
    nowMs,
  });

  const { items, startIndex } = windowAround(queue.entries, queue.currentIndex);
  let truth: CommandTruth | null = null;
  try {
    truth = (await dispatch({ source, items, startIndex, autoPlay: true })).truth;
  } catch (e) {
    logError('ListeningSession:Dispatch', e);
    return Object.freeze({
      started: false, reason: 'Çalma komutu gönderilemedi (otorite kullanılamıyor).', queueResult, truth: null,
    });
  }

  persistNow(nowMs);

  /* "Komut kabul edildi" ile "ses çıkıyor" AYNI ŞEY DEĞİLDİR: burada yalnız
     bağlamın kurulduğu ve komutun gönderildiği bildirilir. Duyulabilirlik
     iddiası F0 `playbackTruth`/`honestClaim` katmanına aittir. */
  return Object.freeze({
    started: true,
    reason: `Dinleme bağlamı kuruldu (${context.intent}); komut gönderildi.`,
    queueResult,
    truth,
  });
}

/**
 * MUSIC F7.6 · Sağlayıcı seçiminden dinleme başlatır.
 *
 * `startLibraryListening` ile AYNI kanonik zinciri kullanır — ikinci bir
 * oturum/kuyruk yolu KURULMAZ. Tek fark girdinin nereden geldiğidir:
 * kütüphane tarafında `buildLibraryQueueContext`, sağlayıcı tarafında
 * `buildProviderQueueContext` (same-provider kuralı orada uygulanır).
 *
 * Sahte başarı yok: kuyruk kurulamazsa oturum BAŞLATILMAZ ve komut
 * GÖNDERİLMEZ; kapı reddi olduğu gibi geri verilir.
 */
export async function startProviderListening(
  context: ProviderQueueContext,
  options: { nowMs?: number; ignitionRef?: string | null; autoPlay?: boolean } = {},
): Promise<StartListeningResult> {
  const nowMs = options.nowMs ?? Date.now();
  if (context.entries.length === 0) {
    return failed('Sağlayıcı sonucundan çalınabilir girdi çıkmadı.');
  }

  const queueResult = createQueue(context.source, context.entries, context.startIndex);
  if (queueResult.status !== 'APPLIED') {
    return failed(`Kuyruk kurulamadı: ${queueResult.reason}`, queueResult);
  }

  // Yeni dinleme bağlamı: önceki devrin bileti artık hiçbir şeyi commit EDEMEZ.
  _activeTicket = null;

  const queue = getDesiredQueue();
  const current = getCurrentEntry();
  startListeningSession({
    intent: context.intent,
    intentRef: context.intentRef,
    source: context.source,
    queueId: queue.queueId,
    queueRevision: queue.revision,
    currentItem: current ? current.identity : null,
    ignitionRef: options.ignitionRef ?? null,
    nowMs,
  });

  const { items, startIndex } = windowAround(queue.entries, queue.currentIndex);
  let truth: CommandTruth | null = null;
  try {
    truth = (await dispatch({
      source: context.source, items, startIndex, autoPlay: options.autoPlay !== false,
    })).truth;
  } catch (e) {
    logError('ListeningSession:ProviderDispatch', e);
    return Object.freeze({
      started: false,
      reason: 'Çalma komutu gönderilemedi (otorite kullanılamıyor).',
      queueResult,
      truth: null,
    });
  }

  persistNow(nowMs);

  /* "Komut gönderildi" ile "ses çıkıyor" AYNI ŞEY DEĞİLDİR — duyulabilirlik
     iddiası F0 `playbackTruth`/`honestClaim` katmanına aittir. */
  return Object.freeze({
    started: true,
    reason: `Sağlayıcı dinleme bağlamı kuruldu (${context.source}); komut gönderildi.`,
    queueResult,
    truth,
  });
}

/**
 * MUSIC F7.6 · Kanonik kuyrukta bir sonraki/önceki öğeye geç.
 *
 * `jumpToQueueIndex` ile AYNI yolu kullanır (mutasyon → pencere yeniden yazımı
 * → kapı). İkinci bir sonraki/önceki mekanizması KURULMAZ. Kuyruğun sonunda
 * SARMA YOKTUR: `playQueue.advance` dürüstçe reddeder.
 */
export function advanceQueue(
  direction: 1 | -1, nowMs = Date.now(),
): Promise<QueueCommandResult> {
  return runQueueCommand(() => advance(direction), true, nowMs);
}

/**
 * Gözlenen native durumu bağlama yansıtır. Bu bir playback truth yayını DEĞİLDİR:
 * yalnız oturumun "son gözlenen etkinlik" ve "geçerli öğe" alanları güncellenir.
 */
export function noteObservedItem(itemId: string | null, nowMs = Date.now()): void {
  const session = getListeningSession();
  if (!session) return;
  const queue = getDesiredQueue();
  const entry = itemId ? queue.entries.find((e) => e.item.id === itemId) : null;
  noteCurrentItem(entry ? entry.identity : session.currentItem, nowMs);
  noteQueueRevision(queue.queueId, queue.revision, nowMs);
}

/**
 * Kaynak değişti (USB çıktı / ağ gitti / kullanıcı sağlayıcı değiştirdi).
 * Oturum ÖLMEZ; süreklilik kanıtla kararlaştırılır ve otomatik devam YALNIZ
 * EXACT/STRONG eşleşmeyle mümkündür.
 */
export function carryToSource(
  target: SourceClass, candidates: readonly QueueEntry[], _nowMs = Date.now(),
): ContinuityDecision {
  const session = getListeningSession();
  const queue = getDesiredQueue();
  if (!session) {
    return evaluateContinuity({ previous: [], candidates: [], currentIndex: -1, sourceChanged: true });
  }
  const decision = evaluateContinuity({
    previous: queue.entries.map((e) => e.identity),
    candidates: candidates.map((e) => e.identity),
    currentIndex: queue.currentIndex,
    sourceChanged: session.currentSource !== target,
  });

  // Karar handover değildir. Yeni provider ancak sourceCoordinator/handoverMachine
  // tarafından üretilen doğrulanmış playback kanıtı sonrasında aşağıdaki commit
  // kapısından yazılabilir; burada currentProvider DEĞİŞTİRİLMEZ.
  return decision;
}

/* ══════════════════════════════════════════════════════════════════════════
 * F3.2 · DOĞRULANMIŞ DEVİR → OTURUM COMMIT'İ
 *
 * Üretim zinciri (tek yol, kestirme YOK):
 *   `carryToSource → ContinuityDecision → dispatch → mediaCommandGateway
 *      .playSource → sourceCoordinator.switchTo → handoverMachine (COMMITTED)
 *      → CommandTruth(VERIFIED) → commitCarriedSourceAfterHandover
 *      → ListeningSession.currentSource`
 *
 * Bilet (ticket) NEDEN VAR: bir devir sonucu, kendisini DOĞURAN devir hâlâ
 * güncel değilse oturuma yazılamaz. Yeni bir devir isteği eskisini SUPERSEDE
 * eder; süreç yeniden başladığında bilet YOKTUR — bu yüzden restart öncesine
 * ait bir tamamlanma oturumu DEĞİŞTİREMEZ (Cross-Domain §17).
 * ════════════════════════════════════════════════════════════════════════ */

interface HandoverTicket {
  readonly token: string;
  readonly sessionId: string;
  readonly target: SourceClass;
  readonly decision: ContinuityDecision;
  /** Devrin hedef kaynakta karşılık bulan girdileri (ADAYLARDAN, eskilerden DEĞİL). */
  readonly carriedEntries: readonly QueueEntry[];
  /** `carriedEntries` içinde kaldığı yerden devam noktası; yoksa -1. */
  readonly resumeIndex: number;
  readonly startedAtMs: number;
}

/** Yalnız EN SON istenen devir commit yapabilir. */
let _activeTicket: HandoverTicket | null = null;
let _handoverSeq = 0;
/** Bounded idempotency kaydı — aynı bilet iki kez oturuma YAZILMAZ. */
const _committedTokens: string[] = [];
const COMMITTED_TOKEN_LIMIT = 32;

function rememberCommitted(token: string): void {
  _committedTokens.push(token);
  while (_committedTokens.length > COMMITTED_TOKEN_LIMIT) _committedTokens.shift();
}

/** Taşınan öğelerin EN ZAYIF kanıt derecesi — teşhis için (karar DEĞİL). */
function weakestGrade(decision: ContinuityDecision): IdentityMatchGrade | null {
  if (decision.carried.length === 0) return null;
  const order: readonly IdentityMatchGrade[] = ['EXACT', 'STRONG', 'WEAK', 'NO_MATCH', 'UNKNOWN'];
  let worst = 0;
  decision.carried.forEach((c) => {
    const rank = order.indexOf(c.match.grade);
    if (rank > worst) worst = rank;
  });
  return order[worst] ?? null;
}

export interface ListeningHandoverResult {
  /** Devir komutu GERÇEKTEN gönderildi mi (kanıt yoksa gönderilmez). */
  readonly requested: boolean;
  /** Oturumun `currentSource` alanı yazıldı mı. */
  readonly committed: boolean;
  readonly decision: ContinuityDecision;
  readonly truth: CommandTruth | null;
  readonly token: string | null;
  readonly reason: string;
}

const handoverResult = (
  requested: boolean, committed: boolean, decision: ContinuityDecision,
  truth: CommandTruth | null, token: string | null, reason: string,
): ListeningHandoverResult =>
  Object.freeze({ requested, committed, decision, truth, token, reason });

/**
 * Dinleme niyetini yeni bir kaynağa devreder — ÜRETİM YOLU.
 *
 * Komut YALNIZ `sessionContinuity` otomatik devama izin verirse gönderilir;
 * WEAK/UNKNOWN eşleşmede CarOS "benzer" bir parça BAŞLATMAZ. Oturuma yazım
 * yalnız `VERIFIED` sonuçla ve yalnız bu fonksiyonun ürettiği biletle olur.
 */
export async function handoverListeningToSource(
  target: SourceClass,
  candidates: readonly QueueEntry[],
  options: { nowMs?: number } = {},
): Promise<ListeningHandoverResult> {
  const nowMs = options.nowMs ?? Date.now();
  const session = getListeningSession();
  const decision = carryToSource(target, candidates, nowMs);

  noteContinuityState(decision.state);
  noteFulfillment(candidates.length > 0);
  noteIdentityFidelity(weakestGrade(decision));

  if (!session) {
    return handoverResult(false, false, decision, null, null, 'Dinleme bağlamı yok — devir istenmedi.');
  }
  if (!mayAutoResume(decision)) {
    /* Kanıt yetersiz: komut GÖNDERİLMEZ. Oturum ölmez, sürekliliği düşer —
       "bir şeyler çalsın" diye rastgele parça başlatmak YASAKTIR. */
    noteContinuity(decision.state === 'INTACT' ? 'INTACT' : 'BROKEN', nowMs);
    return handoverResult(false, false, decision, null, null,
      `Devir istenmedi: ${decision.reason}`);
  }

  const carriedEntries = decision.carried
    .map((c) => candidates[c.candidateIndex])
    .filter((entry): entry is QueueEntry => entry !== undefined);
  if (carriedEntries.length === 0) {
    noteContinuity('BROKEN', nowMs);
    return handoverResult(false, false, decision, null, null,
      'Taşınabilir aday çözülemedi — devir istenmedi.');
  }
  /* Devam noktası CARRIED listesindeki konumdur: aday indeksini doğrudan
     kuyruk indeksi saymak yanlış parçadan başlatırdı. */
  const resumeIndex = decision.resumeCandidateIndex === null
    ? -1
    : decision.carried.findIndex((c) => c.candidateIndex === decision.resumeCandidateIndex);

  _handoverSeq += 1;
  const ticket: HandoverTicket = Object.freeze({
    token: `handover-${_handoverSeq}`,
    sessionId: session.sessionId,
    target,
    decision,
    carriedEntries: Object.freeze([...carriedEntries]),
    resumeIndex,
    startedAtMs: nowMs,
  });
  // Yeni istek eskisini geçersiz kılar: eski tamamlanma artık commit YAPAMAZ.
  _activeTicket = ticket;
  noteHandover({
    token: ticket.token, target, continuity: decision.state, outcome: 'REQUESTED',
    committed: false, failureCode: null, elapsedMs: null, atMs: nowMs,
  });

  const { items, startIndex } = windowAround(carriedEntries, Math.max(0, resumeIndex));
  let outcome: DispatchOutcome;
  try {
    outcome = await dispatch({ source: target, items, startIndex, autoPlay: true });
  } catch (e) {
    logError('ListeningSession:Handover', e);
    noteHandover({
      token: ticket.token, target, continuity: decision.state, outcome: 'FAILED',
      committed: false, failureCode: 'dispatch_threw', elapsedMs: null, atMs: Date.now(),
    });
    return handoverResult(true, false, decision, null, ticket.token,
      'Devir komutu gönderilemedi (otorite kullanılamıyor).');
  }

  const truth = outcome.truth;
  if (truth.outcome !== 'VERIFIED') {
    /* ACCEPTED_UNVERIFIED / FAILED / TIMED_OUT / SUPERSEDED / REJECTED:
       hiçbiri oturuma YAZILMAZ. "Komut kabul edildi" ile "yeni kaynak niyeti
       taşıyor" AYNI ŞEY DEĞİLDİR. */
    const failed = truth.outcome === 'FAILED' || truth.outcome === 'TIMED_OUT';
    noteHandover({
      token: ticket.token, target, continuity: decision.state,
      outcome: failed ? 'FAILED' : truth.outcome === 'SUPERSEDED' ? 'ROLLBACK' : 'UNVERIFIED',
      committed: false, failureCode: truth.failureCode, elapsedMs: truth.elapsedMs,
      atMs: truth.endedAtMs,
    });
    noteContinuity('DEGRADED', nowMs);
    return handoverResult(true, false, decision, truth, ticket.token,
      `Devir doğrulanmadı (${truth.outcome}) — oturum kaynağı DEĞİŞMEDİ.`);
  }

  const committed = commitCarriedSourceAfterHandover({
    token: ticket.token,
    sessionId: ticket.sessionId,
    target,
    decision,
    truth,
    gatewaySessionId: outcome.gatewaySessionId,
    nowMs,
  });
  noteHandover({
    token: ticket.token, target, continuity: decision.state, outcome: 'VERIFIED',
    committed, failureCode: null, elapsedMs: truth.elapsedMs, atMs: truth.endedAtMs,
  });
  return handoverResult(true, committed, decision, truth, ticket.token,
    committed
      ? `Devir doğrulandı ve oturum ${target} kaynağına taşındı.`
      : 'Devir doğrulandı ama commit kapısı sonucu BAYAT buldu — oturum değişmedi.');
}

export interface CommitCarriedInput {
  /** `handoverListeningToSource` biletinin kimliği — başka yol commit YAPAMAZ. */
  readonly token: string;
  readonly sessionId: string;
  readonly target: SourceClass;
  readonly decision: ContinuityDecision;
  readonly truth: CommandTruth;
  /** Komut döndüğü andaki kapı kimliği; `truth.sessionId` ile eşleşmeli. */
  readonly gatewaySessionId?: string | null;
  readonly nowMs?: number;
}

/**
 * Handover tamamlanınca oturuma yazılan TEK commit kapısı.
 *
 * Geçiş için HEPSİ gerekir: canlı bilet · doğru oturum · doğru hedef ·
 * `VERIFIED` sonuç · bayat olmayan tamamlanma. Aynı bilet ikinci kez gelirse
 * işlem IDEMPOTENT'tir: durum yeniden yazılmaz, sonuç yine `true`'dur.
 */
export function commitCarriedSourceAfterHandover(input: CommitCarriedInput): boolean {
  const nowMs = input.nowMs ?? Date.now();

  // 1) Idempotency — aynı doğrulanmış sonuç iki kez uygulanmaz.
  if (_committedTokens.includes(input.token)) {
    noteCommitDropped('DUPLICATE', 'token_already_committed');
    return true;
  }
  // 2) Bilet canlı mı (yeni devir eskisini SUPERSEDE etmiş olabilir).
  const ticket = _activeTicket;
  if (!ticket || ticket.token !== input.token) {
    noteCommitDropped('STALE', ticket ? 'ticket_superseded' : 'no_active_ticket');
    return false;
  }
  // 3) Sonuç hâlâ güncel dünyaya mı ait (araya başka komut girdi mi).
  if (input.gatewaySessionId != null && input.truth.sessionId !== input.gatewaySessionId) {
    noteCommitDropped('STALE', 'gateway_session_advanced');
    return false;
  }

  const session = getListeningSession();
  if (!session || session.sessionId !== input.sessionId || ticket.sessionId !== input.sessionId) {
    noteCommitDropped('REJECTED', 'session_mismatch');
    return false;
  }
  if (input.truth.outcome !== 'VERIFIED') {
    noteCommitDropped('REJECTED', `outcome_${input.truth.outcome.toLowerCase()}`);
    return false;
  }
  if (ticket.target !== input.target || input.truth.sourceId !== input.target) {
    noteCommitDropped('REJECTED', 'target_mismatch');
    return false;
  }
  if (input.decision.state !== 'CARRIED' && input.decision.state !== 'DEGRADED') {
    noteCommitDropped('REJECTED', `continuity_${input.decision.state.toLowerCase()}`);
    return false;
  }
  if (ticket.carriedEntries.length === 0) {
    noteCommitDropped('REJECTED', 'no_carried_entries');
    return false;
  }

  const queue = getDesiredQueue();
  const result = restoreQueue(
    queue.queueId, input.target, ticket.carriedEntries, Math.max(0, ticket.resumeIndex),
  );
  if (result.status !== 'APPLIED') {
    noteCommitDropped('REJECTED', `queue_${result.failureCode ?? 'rejected'}`);
    return false;
  }

  noteSourceChange(input.target, input.decision.state, nowMs);
  noteContinuity(input.decision.state, nowMs);
  persistNow(nowMs);
  rememberCommitted(input.token);
  _activeTicket = null;
  noteSessionCommitted(nowMs);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4 · KUYRUK KOMUT KAPISI
 *
 * NEDEN VAR: `playQueue` mutasyonları YALNIZ istenen sırayı değiştirir; native'e
 * hiçbir şey yazmaz. UI bunları doğrudan çağırsaydı liste değişir, ses değişmezdi
 * — yani ekran ile kulak ayrışırdı. Bu kapı mutasyonu uygular ve ardından
 * pencereyi kanonik komut yolundan YENİDEN YAZAR.
 *
 * Kapının garantileri:
 *   · Yetenek yoksa mutasyon zaten `playQueue` tarafından reddedilir (sahte
 *     başarı yok); kapı reddi olduğu gibi geri verir.
 *   · Çalma durumu UYDURULMAZ: yeniden yazım `autoPlay`'ini kanonik ses
 *     kanıtından okur — duraklatılmış kuyruk düzenlemesi müziği BAŞLATMAZ.
 *   · UI iyimser kuyruk gerçeği üretmez; sonuç tiplidir.
 * ════════════════════════════════════════════════════════════════════════ */

export interface QueueCommandResult {
  readonly applied: boolean;
  /** Mutasyonun kanonik sonucu — reddedildiyse gerekçesi buradadır. */
  readonly queueResult: QueueOperationResult;
  /** Native'e yeniden yazım sonucu; `null` ise komut GÖNDERİLMEDİ. */
  readonly truth: CommandTruth | null;
  readonly reason: string;
}

const queueCommandResult = (
  queueResult: QueueOperationResult, truth: CommandTruth | null, reason: string,
): QueueCommandResult => Object.freeze({
  applied: queueResult.status === 'APPLIED', queueResult, truth, reason,
});

/** Kanonik ses kanıtı — "şu an gerçekten çalıyor mu". Varsayım ÜRETMEZ. */
async function isCurrentlyAudible(): Promise<boolean> {
  try {
    const { isRenderingVerified } = await import('../authority/nativeAuthorityBridge');
    return isRenderingVerified();
  } catch { return false; }
}

/**
 * Mutasyon sonrası pencereyi native'e yeniden yazar.
 *
 * @param forcePlay yalnız kullanıcının açık çalma niyeti taşıyan komutlarda
 *        (kuyrukta bir parçaya atlamak) `true` olur.
 */
async function rewriteWindowAfterMutation(
  nowMs: number, forcePlay: boolean,
): Promise<CommandTruth | null> {
  const queue = getDesiredQueue();
  if (queue.source === null || queue.entries.length === 0) return null;
  const autoPlay = forcePlay || await isCurrentlyAudible();
  const { items, startIndex } = windowAround(queue.entries, queue.currentIndex);
  try {
    const outcome = await dispatch({ source: queue.source, items, startIndex, autoPlay });
    persistNow(nowMs);
    return outcome.truth;
  } catch (e) {
    logError('ListeningSession:QueueRewrite', e);
    return null;
  }
}

async function runQueueCommand(
  mutate: () => QueueOperationResult, forcePlay: boolean, nowMs: number,
): Promise<QueueCommandResult> {
  const result = mutate();
  if (result.status !== 'APPLIED') {
    noteQueueCommand(false);
    // Reddedilen mutasyon native'e YAZILMAZ — sahte başarı üretilmez.
    return queueCommandResult(result, null, result.reason);
  }
  const queue = getDesiredQueue();
  noteQueueRevision(queue.queueId, queue.revision, nowMs);
  const truth = await rewriteWindowAfterMutation(nowMs, forcePlay);
  noteQueueCommand(true);
  return queueCommandResult(
    result, truth,
    truth === null
      ? `${result.reason} Native yeniden yazım YAPILAMADI — sıra ekranda değişti, kaynakta doğrulanmadı.`
      : result.reason,
  );
}

/** Kuyrukta bir parçaya atla — kullanıcının açık çalma niyeti. */
export function jumpToQueueIndex(index: number, nowMs = Date.now()): Promise<QueueCommandResult> {
  return runQueueCommand(() => setCurrentIndex(index), true, nowMs);
}

/** Kuyruktan çıkar — çalma durumunu DEĞİŞTİRMEZ. */
export function removeQueueEntryAt(index: number, nowMs = Date.now()): Promise<QueueCommandResult> {
  return runQueueCommand(() => removeAt(index), false, nowMs);
}

/** Yeniden sırala — çalan parça korunur (playQueue garantisi), ses kesilmez. */
export function reorderQueueEntry(
  from: number, to: number, nowMs = Date.now(),
): Promise<QueueCommandResult> {
  return runQueueCommand(() => reorder(from, to), false, nowMs);
}

/** Geçerli parçadan hemen sonraya al. */
export function playQueueEntryNext(index: number, nowMs = Date.now()): Promise<QueueCommandResult> {
  return runQueueCommand(() => {
    const queue = getDesiredQueue();
    if (!Number.isInteger(index) || index < 0 || index >= queue.entries.length) {
      return reorder(index, index);   // kanonik indeks doğrulaması playQueue'da
    }
    const target = Math.max(0, queue.currentIndex) + (index > queue.currentIndex ? 1 : 0);
    return reorder(index, Math.min(target, queue.entries.length - 1));
  }, false, nowMs);
}

/**
 * MUSIC F18 · MEVCUT kuyruğun SONUNA kütüphane parçaları ekler.
 *
 * Smart Radio "bunun gibi devam et" derken çalan parçayı BAŞTAN ALMAMALIDIR;
 * bu yüzden akış mevcut oturuma EKLENİR. Buna rağmen **yeni bir kuyruk
 * otoritesi kurulmaz**:
 *   · girdi inşası kanonik `buildLibraryQueueContext`tir (ikinci kurucu YOK),
 *   · mutasyon kanonik `addToQueue`dur (kaynak yeteneği ORADA denetlenir —
 *     kuyruğu desteklemeyen sağlayıcıda dürüstçe REDDEDİLİR),
 *   · native yeniden yazım `runQueueCommand` üzerindendir ve **çalma
 *     durumunu DEĞİŞTİRMEZ** (`forcePlay: false`) — duraklatılmış müzik
 *     ekleme yüzünden BAŞLAMAZ.
 */
export function appendLibraryTracksToQueue(
  trackIds: readonly string[], nowMs = Date.now(),
): Promise<QueueCommandResult> {
  return runQueueCommand(() => {
    const context = buildLibraryQueueContext({ kind: 'TRACKS', trackIds });
    /* Çözülemeyen seçim SAHTE başarı üretmez — kanonik boş-girdi reddi. */
    return addToQueue(context?.entries ?? []);
  }, false, nowMs);
}

/** Kütüphane yeniden tarandı (F2) — kuyruk bayat girdilerden arındırılır. */
export function revalidateAgainstLibrary(nowMs = Date.now()): QueueOperationResult {
  const result = revalidateQueue();
  if (result.status === 'APPLIED') {
    const queue = getDesiredQueue();
    noteQueueRevision(queue.queueId, queue.revision, nowMs);
    if (queue.entries.length === 0) noteContinuity('BROKEN', nowMs);
    else if (result.rejectedEntryIds.length > 0) noteContinuity('DEGRADED', nowMs);
    persistNow(nowMs);
  }
  return result;
}

export interface RestoreOutcome {
  readonly restored: boolean;
  readonly reason: string;
  readonly rejection: RestoreResult['rejection'];
  /** Sabit `NONE`: geri yükleme ASLA çalma iddiası üretmez. */
  readonly playbackClaim: 'NONE';
  readonly droppedEntryIds: readonly string[];
}

/**
 * Süreç yeniden başladıktan sonra bağlamı geri yükler.
 *
 * ÇALMAZ. Komut GÖNDERMEZ. Bayat kütüphane girdileri kuyruğa alınmaz. Süreklilik
 * `UNKNOWN` başlar — kayıt, canlı bir gözlem DEĞİLDİR (Cross-Domain §13).
 */
export function restoreListeningSession(nowMs = Date.now()): RestoreOutcome {
  /* Yeniden başlatma sınırı: restart ÖNCESİNE ait hiçbir devir tamamlanması
     geri yüklenen oturuma yazamaz — bilet ve idempotency kaydı sıfırlanır. */
  _activeTicket = null;
  _committedTokens.length = 0;

  const parsed = parsePersistedListeningSession(readPersistedListeningSessionRaw(), nowMs);
  if (!parsed.restored) {
    noteRestoreAttempt(false, parsed.rejection);
    if (parsed.rejection === 'corrupt' || parsed.rejection === 'schema_mismatch') {
      clearPersistedListeningSession();
    }
    return Object.freeze({
      restored: false, reason: parsed.reason, rejection: parsed.rejection,
      playbackClaim: 'NONE' as const, droppedEntryIds: Object.freeze([]),
    });
  }

  const s = parsed.restored;

  /* ── MUSIC F21 · SÜRESİ DOLMUŞ UZAK ADRES CANLI SAYILMAZ ────────────────
   * Ölçülen gerçek: YouTube (`piped://`), Internet Archive (`archive://`) ve
   * Spotify (`spotify:`) kuyrukta SENTINEL taşır ve gerçek adres çalma anında
   * çözülür → bunlar bayatlamaz. Ama doğrudan `http(s)` akış adresi taşıyan
   * sağlayıcı girdileri (Jamendo · Audius · doğrudan akış) saatler sonra
   * ölmüş olabilir. Böyle bir satırı kuyrukta tutmak, kullanıcıya
   * "çalınabilir" diye gösterilen ama basınca ölen bir satır üretirdi.
   * Bu yüzden geri yüklemede DÜŞÜRÜLÜR ve SAYILIR (sessiz düşürme yok). */
  const staleRemoteIds: string[] = [];
  const freshEntries = s.entries.filter((e) => {
    const freshness = classifyEntryFreshness(e.identity.contentUri);
    const drop = shouldDropOnRestore(freshness);
    noteEntryFreshness(freshness, drop);
    if (drop) staleRemoteIds.push(e.entryId);
    return !drop;
  });

  if (freshEntries.length === 0) {
    noteRestoreAttempt(false, 'empty_queue');
    return Object.freeze({
      restored: false,
      reason: 'Kayıttaki tüm girdiler bayat uzak adres taşıyordu — geri yüklenmedi.',
      rejection: 'empty_queue' as const,
      playbackClaim: 'NONE' as const,
      droppedEntryIds: Object.freeze([...staleRemoteIds]),
    });
  }

  const startIndex = Math.max(0, Math.min(s.currentIndex, freshEntries.length - 1));
  const queueResult = restoreQueue(s.queueId, s.currentSource, freshEntries, startIndex);
  if (queueResult.status !== 'APPLIED') {
    noteRestoreAttempt(false, 'empty_queue');
    return Object.freeze({
      restored: false,
      reason: `Kuyruk geri yüklenemedi: ${queueResult.reason}`,
      rejection: 'empty_queue' as const,
      playbackClaim: 'NONE' as const,
      droppedEntryIds: queueResult.rejectedEntryIds,
    });
  }

  const queue = getDesiredQueue();
  const current = getCurrentEntry();
  startListeningSession({
    intent: s.intent,
    intentRef: s.intentRef,
    source: s.currentSource,
    queueId: queue.queueId,
    queueRevision: queue.revision,
    currentItem: current ? current.identity : null,
    ignitionRef: s.ignitionRef,
    nowMs,
    restored: true,
  });
  // Kayıt canlı gözlem değildir: süreklilik doğrulanana kadar BİLİNMİYOR.
  noteContinuity('UNKNOWN', nowMs);
  noteRestoreAttempt(true, null);

  return Object.freeze({
    restored: true,
    reason: queueResult.rejectedEntryIds.length
      ? `Bağlam geri yüklendi; ${queueResult.rejectedEntryIds.length} bayat girdi alınmadı. ÇALMIYOR.`
      : 'Bağlam geri yüklendi. ÇALMIYOR — oynatma yine native kanıt ister.',
    rejection: null,
    playbackClaim: 'NONE' as const,
    droppedEntryIds: queueResult.rejectedEntryIds,
  });
}

/** Sağlayıcı bu kaynakta çok öğeli kuyruk semantiğini destekliyor mu (projeksiyon girdisi). */
/* ══════════════════════════════════════════════════════════════════════════
 * ÜRETİM AÇILIŞ GİRİŞİ — F3 SAHİPLİĞİNDE, EXACTLY-ONCE
 *
 * ÖLÇÜLEN KUSUR (telefon ön doğrulaması): `restoreListeningSession` yalnız
 * TANIMLIYDI — `src/` içinde hiçbir üretim çağrısı yoktu. Oturum her
 * başlatmada YAZILIYOR ama HİÇ OKUNMUYORDU (asimetrik kalıcılık). Sonuç:
 * süreç ölümünden sonra JS `ListeningSession`/`PlayQueue` boş kalıyor,
 * F21'in bayat-adres süzgeci ve geri yükleme sayaçları üretimde HİÇ
 * tetiklenemiyordu.
 *
 * BU GİRİŞ YENİ BİR OTORİTE DEĞİLDİR: karar ve yürütme zaten burada (F3);
 * eklenen tek şey, kanonik boot sahibinin (SystemBoot → media authority
 * dalgası) çağırdığı **tek** ve **bir kez** koşan bir kapıdır.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · ÇALMAZ: `restoreListeningSession` komut göndermez, `playbackClaim`
 *     sabit `NONE`dur ve süreklilik `UNKNOWN` başlar (§13).
 *   · F0 otoritesini ELE GEÇİRMEZ: native canlı truth ise geri yükleme
 *     ATLANIR — kayıttan ikinci bir kuyruk/oturum KURULMAZ (§1).
 *   · Bayat/expired uzak adres canlı SAYILMAZ (F21 süzgeci zaten devrede).
 *   · Yarım kalan devir commit EDEMEZ (`_activeTicket`/`_committedTokens`
 *     geri yüklemede sıfırlanır).
 *   · FAIL-CLOSED: native durumu okunamazsa bile karar yalnız "canlı mı"
 *     sorusuna dayanır; okunamayan durum canlı SAYILMAZ ama kayıt da
 *     doğrulanmadan LIVE truth'e YÜKSELTİLMEZ.
 * ════════════════════════════════════════════════════════════════════════ */

/** Exactly-once kapısı — süreç ömrü boyunca tek giriş. */
let _bootRestoreRan = false;

export type BootRestoreSkipReason = 'ALREADY_RUN' | 'NATIVE_SESSION_LIVE';

export interface BootRestoreOutcome {
  /** Geri yükleme gerçekten denendi mi. */
  readonly attempted: boolean;
  /** Denenmediyse nedeni; denendiyse `null`. */
  readonly skipped: BootRestoreSkipReason | null;
  /** Denendiyse F3'ün kanonik sonucu. */
  readonly outcome: RestoreOutcome | null;
  /** Sabit `NONE`: bu giriş de ASLA çalma iddiası üretmez. */
  readonly playbackClaim: 'NONE';
}

const bootResult = (
  attempted: boolean, skipped: BootRestoreSkipReason | null, outcome: RestoreOutcome | null,
): BootRestoreOutcome => Object.freeze({
  attempted, skipped, outcome, playbackClaim: 'NONE' as const,
});

/**
 * Açılışta bağlamı BİR KEZ geri yükler.
 *
 * Çağıran: `SystemBoot` (medya otoritesi dalgası, `startMediaAuthority`
 * TAMAMLANDIKTAN sonra — native anlık görüntüsü ancak o zaman doludur).
 *
 * @returns ne yapıldığının kanıtı. **Hiçbir dalda ses BAŞLAMAZ.**
 */
export async function bootRestoreListeningSession(
  nowMs = Date.now(),
): Promise<BootRestoreOutcome> {
  if (_bootRestoreRan) return bootResult(false, 'ALREADY_RUN', null);
  /* Kapı AWAIT'ten ÖNCE kapanır: eşzamanlı iki çağrı ikinci kez giremez. */
  _bootRestoreRan = true;
  noteBootRestoreRun();

  /* Native oturum HÂLÂ canlıysa kayıt bir ÖNERİDİR, truth DEĞİLDİR: ikinci
     bir kuyruk kurmak duplicate authority olurdu. Uzlaştırma zaten F3'ün
     gözlenen-kuyruk kanıtındadır. */
  let nativeLive = false;
  try {
    const bridge = await import('../authority/nativeAuthorityBridge');
    const snap = bridge.getSnapshot();
    nativeLive = snap.authorityAvailable === true && (snap.queueLength ?? 0) > 0;
  } catch {
    /* Köprü okunamadı → native canlı SAYILMAZ; kayıt yine de yalnız
       projeksiyon olarak geri yüklenir ve çalma BAŞLATMAZ. */
    nativeLive = false;
  }

  if (nativeLive) {
    noteBootRestoreSkippedNativeLive();
    return bootResult(false, 'NATIVE_SESSION_LIVE', null);
  }

  return bootResult(true, null, restoreListeningSession(nowMs));
}

/** @internal test dikişi — exactly-once kapısını sıfırlar. */
export function _resetBootRestoreForTest(): void { _bootRestoreRan = false; }

/** Kapı bu süreçte koştu mu (LAB/test kanıtı). */
export function hasBootRestoreRun(): boolean { return _bootRestoreRan; }

export function sourceSupportsQueue(source: SourceClass | null): boolean {
  if (source === null) return false;
  try { return getSource(source).capabilities.supportsQueue === true; } catch { return false; }
}

/** Dinleme niyetini dışarıdan bildirmek için (gözlenemeyen kaynaklar dâhil). */
export function declareExternalListening(
  source: SourceClass, nowMs = Date.now(),
): ListeningIntent {
  const queue = getDesiredQueue();
  startListeningSession({
    intent: 'EXTERNAL_UNKNOWN',
    intentRef: null,
    source,
    queueId: queue.queueId || 'external',
    queueRevision: queue.revision,
    currentItem: null,
    nowMs,
  });
  return 'EXTERNAL_UNKNOWN';
}

/** @internal test seam — üretimde gateway/kalıcılık daima gerçek modüllerdir. */
export function _setListeningRuntimePortsForTest(ports: {
  dispatch?: typeof dispatchFn;
  persist?: typeof persistListeningSession;
} | null): void {
  dispatchFn = ports?.dispatch ?? null;
  persistFn = ports?.persist ?? persistListeningSession;
}

/** @internal test seam — devir bileti ve idempotency kaydını sıfırlar. */
export function _resetListeningHandoverForTest(): void {
  _activeTicket = null;
  _handoverSeq = 0;
  _committedTokens.length = 0;
}
