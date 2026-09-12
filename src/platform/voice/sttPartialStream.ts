/**
 * sttPartialStream.ts — **MAVİ F3 · KISMİ TRANSKRİPT AKIŞI (OTURUM RUNTIME'I).**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Native STT'nin ürettiği KISMİ (partial) transkripti bir **dinleme oturumu**
 * kimliği altında toplar, `semanticEndpointer`'a kanıt olarak verir ve kararı
 * çağırana bildirir. Karar "cümle bitmiş olabilir" derse — ve YALNIZ komut kipi
 * açıksa — sağlayıcıya "şimdi bitir" komutunu iletir.
 *
 * ── EN KRİTİK SINIR: KISMİ SONUÇ EYLEM YETKİSİ TAŞIMAZ ─────────────────────
 * Bu modül `processTextCommand` · `dispatchIntent` · `commandExecutor` ·
 * `companionChatProvider` · herhangi bir CarOS yeteneğini **İMPORT ETMEZ ve
 * ÇAĞIRMAZ**. Yapabildiği tek "yan etki" `ports.finalize()`tir; o da yalnız
 * mikrofon oturumunu erken kapatır — navigasyon açmaz, telefon aramaz, ayar
 * değiştirmez, medya oynatmaz, araca hiçbir şey yazmaz. Eylem yolu YALNIZ
 * `voiceService`in nihai (final) transkript dalıdır. Bu sınır kilit testiyle
 * korunur (`maviStreamingAsr.test.ts` · `regression.guards`).
 *
 * ── TUR SAHİPLİĞİ (STALE KORUMASI) ──────────────────────────────────────────
 * Her oturum artan bir `sessionId` alır. `notePartial`/`noteProviderFinal`
 * çağrıları bu kimliği TAŞIMAK ZORUNDADIR; eskimiş kimlik SESSİZCE düşer ve
 * **yeni oturumun durumunu değiştiremez**. Bu, native geri çağrılarının
 * (barge-in · yeni komut · iptal sonrası uçuşta kalan olaylar) yeni turu
 * kirletmesini yapısal olarak imkânsız kılar.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Kısmi metin **YALNIZ bellekte** ve **yalnız bu oturum boyunca** tutulur:
 *  · telemetriye YAZILMAZ (F0 izine yalnız sayaç/süre/enum gider),
 *  · uzak log'a GİTMEZ, diske YAZILMAZ, `console`'a BASILMAZ,
 *  · tanı yüzeyi (`getSttPartialDiagnostics`) metni DEĞİL yalnız uzunluğunu verir.
 *
 * ── SAFLIK / TEST EDİLEBİLİRLİK ─────────────────────────────────────────────
 * Zaman ve tüm yan etkiler DI ile verilir (`SttPartialPorts`). Modül kendi
 * timer'ını KURMAZ — tik'i çağıran (native olay ya da voiceService) sürer.
 * Bu bilinçlidir: kendi `setInterval`ı olan bir modül dinleme oturumu kapansa
 * bile arkada dönebilirdi (CLAUDE.md sıfır-sızıntı).
 */

import {
  decideEndpoint,
  classifyCompleteness,
  DEFAULT_ENDPOINT_THRESHOLDS,
  type EndpointDecision,
  type EndpointEvidence,
  type EndpointReason,
  type EndpointThresholds,
  type SemanticCompleteness,
} from './semanticEndpointer';

/* ══════════════════════════════════════════════════════════════════════════
 * Sağlayıcı yetenek matrisi — SAHTE STREAMING ÜRETİLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir STT yolunun gerçekte NE sağladığı. Yetenek **bildirilir**, varsayılmaz:
 * final-only bir sağlayıcı için sahte kısmi sonuç ÜRETİLMEZ.
 */
export type SttStreamCapability =
  /** Kısmi metin + akustik sessizlik kanıtı (native Vosk) → semantik endpoint MÜMKÜN. */
  | 'STREAMING_WITH_VAD'
  /** Kısmi metin var, sessizlik kanıtı YOK (Android SpeechRecognizer · Web) →
   *  artımlı anlama çalışır, semantik endpoint çalışmaz (sahte sessizlik uydurulmaz). */
  | 'STREAMING_TEXT_ONLY'
  /** Yalnız nihai sonuç (bulut STT · eski native sürüm) → bugünkü davranış aynen sürer. */
  | 'FINAL_ONLY'
  /** Dinleme yolu bilinmiyor/açılmadı. */
  | 'UNAVAILABLE';

/* ══════════════════════════════════════════════════════════════════════════
 * Portlar (DI) — modül hiçbir global'e dokunmaz
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttPartialPorts {
  /** Monotonik saat (ms). Üretimde `performance.now()`; duvar saati KULLANILMAZ. */
  readonly now: () => number;
  /**
   * Sağlayıcıya "şimdi bitir" komutu. YALNIZ mikrofon oturumunu kapatır —
   * hiçbir CarOS eylemi tetiklemez. Sağlayıcı desteklemiyorsa no-op olabilir.
   */
  readonly finalize?: () => void;
  /**
   * Karar bildirimi (telemetri/gözlem). **Metin GEÇMEZ** — yalnız bounded enum,
   * sayaç ve süre. `voiceService` bunu F0 izine yazar.
   */
  readonly onDecision?: (event: SttEndpointEvent) => void;
}

/** Bounded karar olayı — transcript/PII TAŞIMAZ. */
export interface SttEndpointEvent {
  readonly sessionId: number;
  readonly reason: EndpointReason;
  readonly completeness: SemanticCompleteness;
  readonly partialCount: number;
  /** Oturum açılışından karara kadar geçen süre (ms, monotonik). */
  readonly elapsedMs: number;
  /** Komut GERÇEKTEN gönderildi mi (kip kapalıysa `false` — gölge karar). */
  readonly commanded: boolean;
}

export interface OpenSessionOpts {
  readonly capability: SttStreamCapability;
  /**
   * Erken bitirme komutu GÖNDERİLSİN Mİ (varsayılan **false** — fail-safe).
   *
   * Kapalıyken modül kararı ÜRETİR ve ÖLÇER ama sağlayıcıya dokunmaz → cihaz
   * davranışı bugünküyle **birebir aynıdır** ve `prematureEndpointRate` gerçek
   * kullanıcıyı KESMEDEN sahada ölçülebilir. Spec'in kademeli eşik azaltımı
   * (1100 → 900 → 700 → 500 → 350) ancak bu ölçüm alındıktan sonra ilerler.
   */
  readonly commandFinalize?: boolean;
  readonly thresholds?: EndpointThresholds;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlar (bounded — sonsuz büyüme YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/** Kısmi metin tavanı — ASR sürüklenmesi belleği büyütemez. */
export const PARTIAL_TEXT_MAX_CHARS = 400;
/** Oturum başına işlenecek azami kısmi sonuç (üstü sayılır, işlenmez). */
export const PARTIAL_MAX_EVENTS = 400;
const MAX_COUNTER = 1_000_000;

function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

/* ══════════════════════════════════════════════════════════════════════════
 * Oturum durumu (süreç ömürlü · AYNI ANDA EN FAZLA BİR AÇIK OTURUM)
 * ════════════════════════════════════════════════════════════════════════ */

interface OpenSession {
  id: number;
  capability: SttStreamCapability;
  commandFinalize: boolean;
  thresholds: EndpointThresholds;
  openedAt: number;
  /** Son kısmi metin — YALNIZ bellekte, oturum kapanınca silinir. */
  text: string;
  partialCount: number;
  droppedOverflow: number;
  /** Metnin son DEĞİŞTİĞİ an. */
  lastChangeAt: number;
  /** İlk konuşma kanıtının (boş olmayan kısmi) görüldüğü an; yoksa 0. */
  firstPartialAt: number;
  agreeingTicks: number;
  /** Karar verildi mi (idempotent — ikinci karar üretilmez). */
  decided: boolean;
  finalizeSent: boolean;
}

let _seq = 0;
let _open: OpenSession | null = null;
let _ports: SttPartialPorts = { now: () => 0 };

/* Bounded tanı sayaçları — PII YOK. */
let _sessionsOpened = 0;
let _sessionsClosed = 0;
let _partialsTotal = 0;
let _staleDropped = 0;
let _finalizeCommands = 0;
const _reasonCounts: Record<string, number> = Object.create(null);

/** Portları bağlar (composition root). Test izolasyonu için yeniden çağrılabilir. */
export function configureSttPartialPorts(ports: SttPartialPorts): void {
  _ports = ports && typeof ports.now === 'function' ? ports : { now: () => 0 };
}

function _now(): number {
  try {
    const t = _ports.now();
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yeni dinleme oturumu açar ve kimliğini döndürür.
 *
 * Açık bir oturum varsa **iptal edilmiş** sayılarak kapatılır (tur izolasyonu):
 * eski oturumun uçuşta kalan kısmi olayları artık eskimiştir ve düşer.
 */
export function openListenSession(opts: OpenSessionOpts): number {
  try {
    if (_open) closeListenSession(_open.id, 'CANCELLED');
    _seq = _seq >= Number.MAX_SAFE_INTEGER ? 1 : _seq + 1;
    const now = _now();
    _open = {
      id: _seq,
      capability: opts.capability,
      commandFinalize: opts.commandFinalize === true,
      thresholds: opts.thresholds ?? DEFAULT_ENDPOINT_THRESHOLDS,
      openedAt: now,
      text: '',
      partialCount: 0,
      droppedOverflow: 0,
      lastChangeAt: now,
      firstPartialAt: 0,
      agreeingTicks: 0,
      decided: false,
      finalizeSent: false,
    };
    _sessionsOpened = _bump(_sessionsOpened);
    return _open.id;
  } catch {
    return 0;                                   // fail-soft: akış ASLA kırılmaz
  }
}

/**
 * Oturumu kapatır ve **kısmi metni bellekten siler**.
 * Eskimiş kimlik sessizce yok sayılır (yeni oturumu kapatamaz).
 */
export function closeListenSession(sessionId: number, reason: EndpointReason): void {
  try {
    if (!_open || _open.id !== sessionId) { _staleDropped = _bump(_staleDropped); return; }
    if (!_open.decided) _noteReason(reason);
    _open.text = '';                            // GİZLİLİK: metin oturumla ölür
    _open = null;
    _sessionsClosed = _bump(_sessionsClosed);
  } catch { /* fail-soft */ }
}

/** Şu an açık oturumun kimliği (yoksa `null`). */
export function activeListenSessionId(): number | null {
  return _open ? _open.id : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt girişi
 * ════════════════════════════════════════════════════════════════════════ */

export interface PartialInput {
  /** Kısmi metin (ham). Bu modülün DIŞINA çıkmaz. */
  readonly text: string;
  /**
   * Native'in ÖLÇTÜĞÜ konuşma-sonrası sessizlik (ms). Sağlayıcı ölçmüyorsa
   * `null`/`undefined` geçilir — **JS burada sahte bir VAD kurmaz.** */
  readonly silenceMs?: number | null;
  /** Native'in ÖLÇTÜĞÜ konuşma süresi (ms). Yoksa oturum süresinden türetilmez. */
  readonly speechMs?: number | null;
}

/**
 * Bir kısmi sonucu işler ve endpoint kararını döndürür.
 *
 * **Hiçbir koşulda eylem üretmez.** Karar `SEMANTIC_CONFIDENT` çıksa ve komut
 * kipi açık olsa bile yapılan tek şey `ports.finalize()`tir (mikrofonu kapat).
 * Eskimiş `sessionId` → `null` (yeni oturum ETKİLENMEZ).
 */
export function notePartial(sessionId: number, input: PartialInput): EndpointDecision | null {
  try {
    if (!_open || _open.id !== sessionId) { _staleDropped = _bump(_staleDropped); return null; }
    const s = _open;
    if (s.decided) return null;                 // karar verilmiş oturuma kanıt EKLENMEZ

    if (s.partialCount >= PARTIAL_MAX_EVENTS) {
      s.droppedOverflow = _bump(s.droppedOverflow);
      return null;
    }

    const raw = typeof input.text === 'string' ? input.text : '';
    const text = raw.trim().slice(0, PARTIAL_TEXT_MAX_CHARS);
    const now = _now();

    s.partialCount = _bump(s.partialCount);
    _partialsTotal = _bump(_partialsTotal);
    if (text && s.firstPartialAt === 0) s.firstPartialAt = now;
    /* KARARLILIK: metin DEĞİŞTİYSE sayaç sıfırlanır. Aynı metnin tekrar gelmesi
     * ASR'nin "artık büyümüyorum" demesidir ve endpoint kanıtının çekirdeğidir. */
    if (text !== s.text) { s.text = text; s.lastChangeAt = now; }

    const silence = typeof input.silenceMs === 'number' && Number.isFinite(input.silenceMs)
      ? Math.max(0, input.silenceMs)
      : null;
    const speechMs = typeof input.speechMs === 'number' && Number.isFinite(input.speechMs)
      ? Math.max(0, input.speechMs)
      : (s.firstPartialAt > 0 ? now - s.firstPartialAt : 0);

    /* YETENEK KAPISI: sessizlik kanıtı OLMAYAN sağlayıcıda semantik yol
     * ÇALIŞMAZ — `silenceMs` null geçilir ve `decideEndpoint` semantik dalı
     * yapısal olarak reddeder. Sahte sessizlik ÜRETİLMEZ (yetenek bildirilir). */
    const evidence: EndpointEvidence = {
      partialText:      s.text,
      partialCount:     s.partialCount,
      stableForMs:      Math.max(0, now - s.lastChangeAt),
      silenceMs:        s.capability === 'STREAMING_WITH_VAD' ? silence : null,
      speechDurationMs: speechMs,
      sessionElapsedMs: Math.max(0, now - s.openedAt),
      providerFinal:    false,
      cancelled:        false,
    };

    const decision = decideEndpoint(evidence, s.thresholds, s.agreeingTicks);
    s.agreeingTicks = decision.agreeingTicks;

    if (decision.endpoint && decision.reason) {
      s.decided = true;
      _noteReason(decision.reason);
      /* KOMUT KİPİ KAPALIYSA (varsayılan) karar YALNIZ ÖLÇÜLÜR — sağlayıcıya
       * dokunulmaz, cihaz davranışı bugünküyle birebir aynı kalır. */
      const commanded = s.commandFinalize && typeof _ports.finalize === 'function';
      if (commanded) {
        s.finalizeSent = true;
        _finalizeCommands = _bump(_finalizeCommands);
        try { _ports.finalize!(); } catch { /* fail-soft: komut düşerse akustik yol bitirir */ }
      }
      _emitDecision(s, decision.reason, decision.completeness, now, commanded);
    }
    return decision;
  } catch {
    return null;                                 // fail-soft
  }
}

/**
 * Sağlayıcı nihai sonucu verdi — oturum `FINAL_PROVIDER` ile kapanır.
 * Eskimiş kimlik sessizce düşer.
 */
export function noteProviderFinal(sessionId: number): void {
  try {
    if (!_open || _open.id !== sessionId) { _staleDropped = _bump(_staleDropped); return; }
    const s = _open;
    if (!s.decided) {
      s.decided = true;
      _noteReason('FINAL_PROVIDER');
      _emitDecision(s, 'FINAL_PROVIDER', classifyCompleteness(s.text), _now(), false);
    }
    closeListenSession(sessionId, 'FINAL_PROVIDER');
  } catch { /* fail-soft */ }
}

function _emitDecision(
  s: OpenSession, reason: EndpointReason, completeness: SemanticCompleteness,
  now: number, commanded: boolean,
): void {
  if (typeof _ports.onDecision !== 'function') return;
  try {
    _ports.onDecision({
      sessionId:    s.id,
      reason,
      completeness,
      partialCount: s.partialCount,
      elapsedMs:    Math.max(0, now - s.openedAt),
      commanded,
    });
  } catch { /* tüketici hatası akışı bozmaz */ }
}

function _noteReason(reason: EndpointReason): void {
  _reasonCounts[reason] = (_reasonCounts[reason] ?? 0) + 1;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı yüzeyi (CAROS LAB) — **METİN TAŞIMAZ**
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttPartialDiagnostics {
  readonly activeSessionId: number | null;
  readonly capability: SttStreamCapability;
  readonly commandFinalize: boolean;
  readonly sessionsOpened: number;
  readonly sessionsClosed: number;
  readonly partialsTotal: number;
  readonly staleDropped: number;
  readonly finalizeCommands: number;
  /** Açık oturumun kısmi metin UZUNLUĞU — metnin KENDİSİ değil (gizlilik). */
  readonly openPartialChars: number;
  readonly openPartialCount: number;
  /** Açık oturumun anlam sınıfı — bounded enum, metin değil. */
  readonly openCompleteness: SemanticCompleteness;
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export function getSttPartialDiagnostics(): SttPartialDiagnostics {
  return Object.freeze({
    activeSessionId:  _open ? _open.id : null,
    capability:       _open ? _open.capability : ('UNAVAILABLE' as SttStreamCapability),
    commandFinalize:  _open ? _open.commandFinalize : false,
    sessionsOpened:   _sessionsOpened,
    sessionsClosed:   _sessionsClosed,
    partialsTotal:    _partialsTotal,
    staleDropped:     _staleDropped,
    finalizeCommands: _finalizeCommands,
    openPartialChars: _open ? _open.text.length : 0,
    openPartialCount: _open ? _open.partialCount : 0,
    openCompleteness: _open ? classifyCompleteness(_open.text) : 'EMPTY',
    reasonCounts:     Object.freeze({ ..._reasonCounts }),
  });
}

/** @internal — testler arası izolasyon. */
export function _resetSttPartialStreamForTest(): void {
  _seq = 0;
  _open = null;
  _ports = { now: () => 0 };
  _sessionsOpened = 0;
  _sessionsClosed = 0;
  _partialsTotal = 0;
  _staleDropped = 0;
  _finalizeCommands = 0;
  for (const k of Object.keys(_reasonCounts)) delete _reasonCounts[k];
}
