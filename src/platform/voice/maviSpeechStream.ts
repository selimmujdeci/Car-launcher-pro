/**
 * maviSpeechStream.ts — **MAVİ F4 · CHUNK SIRALAYICI (tek konuşma oturumu).**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * `speechChunker`'ın ürettiği parçaları **sırayla, üst üste bindirmeden** TTS'e
 * verir ve bütün akışı **TEK bir konuşma oturumu** gibi yönetir.
 *
 * ── NEDEN "TEK OTURUM" KRİTİK ───────────────────────────────────────────────
 * `ttsService` bir söz bitince `_notifyTtsEnd()` yayınlar; `voiceService` bunu
 * "cevap bitti" sayıp **takip dinlemesini açar / idle'a düşer / duck'ı kaldırır**.
 * Parçalar ayrı ayrı bitiş yayınlasaydı Mavi **ilk parçadan sonra mikrofonu
 * açar** ve kendi cevabının kalanını keserdi. Bu yüzden:
 *   · bitiş bildirimi YALNIZ SON parçadan sonra bir kez yapılır,
 *   · audio focus/duck akış boyunca TEK sefer alınır (parça başına açma-kapama YOK),
 *   · `maviSpeech` tek-`answer` sözleşmesi korunur: **akış tek answer'dır**.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Aynı anda **EN FAZLA BİR** açık akış. Yeni akış açılırsa eskisi iptal edilir.
 *  · Her `push/finish/cancel` çağrısı **akış kimliği** taşır; eskimiş kimlik
 *    SESSİZCE düşer ve yeni akışı DEĞİŞTİREMEZ (F3 stale sözleşmesiyle aynı).
 *  · **Sıra korunur** (FIFO) · **ardışık aynı metin** yayınlanmaz (duplicate).
 *  · İptal zinciri: kuyruk temizlenir → TTS iptal edilir → sağlayıcı akışı
 *    `onCancel` ile durdurulur (abort) → bitiş bildirimi YAPILMAZ.
 *  · **AÇLIK KORUMASI:** sağlayıcı ilk parçadan sonra ölürse akış sonsuza kadar
 *    açık kalmaz; çağıran `tick(now)` ile bunu bildirir ve akış DÜRÜSTÇE kapanır
 *    (yarım cevap sessizce "tamam" sayılmaz).
 *  · **SAFLIK:** modül kendi timer'ını KURMAZ (sıfır sızıntı) — zaman ve tüm yan
 *    etkiler DI portlarıyla verilir.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Portlar (DI)
 * ════════════════════════════════════════════════════════════════════════ */

export interface SpeechStreamPorts {
  /** Monotonik saat (ms). Üretimde `performance.now()`. */
  readonly now: () => number;
  /**
   * TEK parçayı seslendirir. `done` çağrılınca sıradaki parçaya geçilir.
   * Uygulama bitiş bildirimi (`_notifyTtsEnd`) YAYINLAMAMALIDIR — onu bu modül
   * yalnız SON parçadan sonra `onSessionEnd` ile ister.
   */
  readonly speakChunk: (text: string, done: () => void) => void;
  /** Uçuştaki sesi anında keser (barge-in / iptal). */
  readonly cancelSpeech: () => void;
  /** Akışın tamamı seslendirildi — bitiş bildirimi BURADA bir kez yapılır. */
  readonly onSessionEnd?: (reason: StreamEndReason) => void;
  /** Sağlayıcı akışını durdur (LLM abort). İptal zincirinin son halkası. */
  readonly onCancelUpstream?: () => void;
  /** Bounded gözlem olayı — METİN TAŞIMAZ. */
  readonly onEvent?: (ev: SpeechStreamEvent) => void;
}

/** Akışın nasıl bittiği — bounded (serbest metin YOK). */
export type StreamEndReason =
  /** Tüm parçalar seslendirildi ve akış normal kapandı. */
  | 'COMPLETED'
  /** Kullanıcı araya girdi / yeni tur devraldı → iptal. */
  | 'CANCELLED'
  /** Sağlayıcı akışı yarıda öldü; söylenen kadarı korunup dürüstçe kapatıldı. */
  | 'UPSTREAM_STALLED'
  /**
   * Seslendirme motoru parçayı aldı ama **bitiş bildirimi HİÇ gelmedi**
   * (native TTS düştü · audio focus kaybı · kuyruk yutuldu). Akış sonsuza
   * kadar açık kalamaz: söylenen kadarı korunur, oturum dürüstçe kapanır.
   */
  | 'SPEECH_STALLED'
  /** Hiç parça üretilmeden kapandı (konuşulacak bir şey yoktu). */
  | 'EMPTY';

export interface SpeechStreamEvent {
  readonly streamId: number;
  readonly kind: 'first_chunk' | 'chunk_spoken' | 'end';
  readonly index: number;
  readonly elapsedMs: number;
  readonly reason?: StreamEndReason;
}

/** Kuyruk tavanı — bozuk sağlayıcı belleği büyütemez. */
export const STREAM_QUEUE_MAX = 64;
/**
 * Sağlayıcı sessizliği tavanı (ms). Son parçadan bu kadar süre geçtiyse ve akış
 * hâlâ "bitmedi" diyorsa sağlayıcı ölmüş sayılır. Değer **çağıranın `tick`
 * çağrılarına** bağlıdır; modül kendi timer'ını kurmaz.
 */
export const STREAM_STARVE_MS = 6000;
/**
 * TEK parçanın seslendirme tavanı. Parça `speechChunker` gereği en fazla
 * `maxChars` (180) karakterdir → yavaş konuşmada bile ~12 sn. 30 sn bu sürenin
 * 2,5 katıdır: **normal uzun cümle ASLA kesilmez**, yalnız GERÇEKTEN asılmış
 * motor (bitiş bildirimi hiç gelmeyen) yakalanır.
 */
export const SPEECH_CHUNK_TIMEOUT_MS = 30_000;

interface OpenStream {
  id: number;
  queue: string[];
  /** Şu an seslendirilen parça (null = boşta). */
  speaking: string | null;
  /** Seslendirmenin başladığı an (asılmış motor kapısı). `speaking` null iken ANLAMSIZ. */
  speakingSince: number;
  finished: boolean;       // sağlayıcı "başka parça yok" dedi
  index: number;           // seslendirilen parça sayacı
  openedAt: number;
  lastActivityAt: number;
  lastSpokenText: string;  // ardışık duplicate koruması
  ended: boolean;          // bitiş bildirimi yapıldı mı (idempotent)
  droppedDuplicate: number;
  droppedOverflow: number;
}

let _seq = 0;
let _open: OpenStream | null = null;
let _ports: SpeechStreamPorts = { now: () => 0, speakChunk: (_t, d) => d(), cancelSpeech: () => {} };

/* Bounded tanı sayaçları — PII YOK. */
let _streamsOpened = 0;
let _chunksSpoken = 0;
let _staleDropped = 0;
let _duplicateDropped = 0;
let _cancelled = 0;
let _stalled = 0;

const MAX_COUNTER = 1_000_000;
const bump = (v: number): number => (v >= MAX_COUNTER ? MAX_COUNTER : v + 1);

export function configureSpeechStreamPorts(ports: SpeechStreamPorts): void {
  _ports = ports && typeof ports.now === 'function' ? ports : _ports;
}

function now(): number {
  try {
    const t = _ports.now();
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

function emit(s: OpenStream, kind: SpeechStreamEvent['kind'], reason?: StreamEndReason): void {
  if (typeof _ports.onEvent !== 'function') return;
  try {
    _ports.onEvent({
      streamId: s.id, kind, index: s.index,
      elapsedMs: Math.max(0, now() - s.openedAt),
      ...(reason ? { reason } : {}),
    });
  } catch { /* tüketici hatası akışı bozmaz */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

/** Yeni akış açar. Açık akış varsa İPTAL edilerek kapanır (tur izolasyonu). */
export function openSpeechStream(): number {
  try {
    if (_open) cancelSpeechStream(_open.id);
    _seq = _seq >= Number.MAX_SAFE_INTEGER ? 1 : _seq + 1;
    const t = now();
    _open = {
      id: _seq, queue: [], speaking: null, speakingSince: 0, finished: false, index: 0,
      openedAt: t, lastActivityAt: t, lastSpokenText: '', ended: false,
      droppedDuplicate: 0, droppedOverflow: 0,
    };
    _streamsOpened = bump(_streamsOpened);
    return _open.id;
  } catch { return 0; }
}

/** Sıradaki parçayı seslendirir (boştaysa). Yeniden girişe karşı korumalı. */
function pump(): void {
  const s = _open;
  if (!s || s.ended || s.speaking !== null) return;
  const next = s.queue.shift();
  if (next === undefined) {
    // Kuyruk boş: sağlayıcı bitirdiyse oturum burada KAPANIR, bitirmediyse BEKLER
    // (gereksiz sessizliğe düşülmez, ama erken "bitti" de denmez).
    if (s.finished) endStream(s.index > 0 ? 'COMPLETED' : 'EMPTY');
    return;
  }
  s.speaking = next;
  s.speakingSince = now();
  const myId = s.id;
  let settled = false;
  const done = (): void => {
    if (settled) return;                       // motor onDone'u iki kez atabilir
    settled = true;
    const cur = _open;
    if (!cur || cur.id !== myId) { _staleDropped = bump(_staleDropped); return; }
    cur.speaking = null;
    cur.speakingSince = 0;
    cur.index += 1;
    cur.lastActivityAt = now();
    _chunksSpoken = bump(_chunksSpoken);
    emit(cur, 'chunk_spoken');
    pump();
  };
  try {
    if (s.index === 0) emit(s, 'first_chunk');
    _ports.speakChunk(next, done);
  } catch {
    /* Bu parçanın sentezi düştü — akış ÖLMEZ, sıradakine geçilir (fail-soft).
     * Sessiz kalmaktansa kalan cümleleri konuşmak dürüsttür. */
    done();
  }
}

/**
 * Yeni parça ekler. Eskimiş kimlik SESSİZCE düşer.
 * @returns kuyruğa alındıysa `true`.
 */
export function pushSpeechChunk(streamId: number, text: string): boolean {
  try {
    const s = _open;
    if (!s || s.id !== streamId || s.ended) { _staleDropped = bump(_staleDropped); return false; }
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return false;
    if (s.queue.length >= STREAM_QUEUE_MAX) { s.droppedOverflow = bump(s.droppedOverflow); return false; }
    /* ARDIŞIK DUPLICATE: aynı cümle iki kez konuşulmaz (sağlayıcı tekrarı ya da
     * yeniden gönderim). Semantik ACK ile çakışma AYRI katmanda (`maviSpeech`
     * tek-answer defteri) çözülür. */
    const lastQueued = s.queue.length > 0 ? s.queue[s.queue.length - 1] : s.lastSpokenText;
    if (t === lastQueued) { s.droppedDuplicate = bump(s.droppedDuplicate);
      _duplicateDropped = bump(_duplicateDropped); return false; }
    s.queue.push(t);
    s.lastSpokenText = t;
    s.lastActivityAt = now();
    pump();
    return true;
  } catch { return false; }
}

/** Sağlayıcı "başka parça yok" dedi. Kuyruk boşalınca oturum kapanır. */
export function finishSpeechStream(streamId: number): void {
  try {
    const s = _open;
    if (!s || s.id !== streamId || s.ended) { _staleDropped = bump(_staleDropped); return; }
    s.finished = true;
    s.lastActivityAt = now();
    pump();
  } catch { /* fail-soft */ }
}

function endStream(reason: StreamEndReason): void {
  const s = _open;
  if (!s || s.ended) return;
  s.ended = true;
  emit(s, 'end', reason);
  _open = null;
  if (typeof _ports.onSessionEnd === 'function') {
    try { _ports.onSessionEnd(reason); } catch { /* fail-soft */ }
  }
}

/**
 * **İPTAL ZİNCİRİ** — barge-in / yeni tur / kullanıcı durdurdu.
 * Sıra: kuyruk temizle → TTS kes → sağlayıcı akışını durdur → oturumu kapat.
 * Bitiş bildirimi `CANCELLED` sebebiyle yapılır ki çağıran "cevap tamamlandı"
 * sanmasın (iptal bir tamamlanma DEĞİLDİR).
 */
export function cancelSpeechStream(streamId: number): void {
  try {
    const s = _open;
    if (!s || s.id !== streamId || s.ended) { _staleDropped = bump(_staleDropped); return; }
    s.queue.length = 0;
    s.speaking = null;
    _cancelled = bump(_cancelled);
    try { _ports.cancelSpeech(); } catch { /* fail-soft */ }
    try { _ports.onCancelUpstream?.(); } catch { /* fail-soft */ }
    endStream('CANCELLED');
  } catch { /* fail-soft */ }
}

/** Açık akışı koşulsuz iptal eder (kimlik bilinmiyorsa). */
export function cancelActiveSpeechStream(): void {
  if (_open) cancelSpeechStream(_open.id);
}

/**
 * Zaman ilerledi — **İKİ ayrı asılma kapısı**. Çağıran periyodik olarak çağırır
 * (modül kendi timer'ını KURMAZ; üretimde `voiceService` bekçisi çağırır).
 *
 *  1. **AÇLIK (upstream):** akış bitmemiş, motor boşta ve sağlayıcı `starveMs`
 *     boyunca yeni parça vermedi → `UPSTREAM_STALLED`.
 *  2. **ASILMIŞ SESLENDİRME (downstream):** motor parçayı aldı ama bitiş
 *     bildirimi `speechMs` boyunca HİÇ gelmedi → `SPEECH_STALLED`.
 *
 * İkinci kapı olmazsa native TTS düştüğünde (ya da audio focus kaybında) akış
 * SONSUZA KADAR açık kalır: konuşma oturumu kapanmaz, tek-`answer` slotu
 * bırakılmaz ve **Mavi o oturumun kalanında tümüyle susar**. Bu yüzden her iki
 * kapı da zorunludur; ikisinde de söylenen kadarı korunur, yarım cevap
 * "tamamlandı" diye raporlanmaz.
 */
export function tickSpeechStream(
  starveMs: number = STREAM_STARVE_MS,
  speechMs: number = SPEECH_CHUNK_TIMEOUT_MS,
): void {
  try {
    const s = _open;
    if (!s || s.ended) return;
    const t = now();

    /* KAPI 2 — asılmış seslendirme. `finished` olsa bile geçerlidir: sağlayıcı
     * bitmiş ama motor son parçayı hiç bitirmemiş olabilir. */
    if (s.speaking !== null) {
      /* `speakingSince` YALNIZ `speaking !== null` iken anlamlıdır; sıfır
       * DEĞERİ geçerli bir andır (monotonik saat 0'dan başlayabilir) — bu
       * yüzden "0 ise yok say" gibi bir sentinel KULLANILMAZ. */
      if (t - s.speakingSince >= speechMs) {
        _stalled = bump(_stalled);
        try { _ports.cancelSpeech(); } catch { /* fail-soft */ }
        try { _ports.onCancelUpstream?.(); } catch { /* fail-soft */ }
        endStream('SPEECH_STALLED');
      }
      return;                                           // konuşuyor → açlık yok
    }

    /* KAPI 1 — sağlayıcı açlığı. Sağlayıcı bitirdiyse açlık kavramı yoktur
     * (kuyruk `pump` ile normal boşalır ve akış COMPLETED kapanır). */
    if (s.finished) return;
    if (t - s.lastActivityAt < starveMs) return;
    _stalled = bump(_stalled);
    try { _ports.onCancelUpstream?.(); } catch { /* fail-soft */ }
    endStream(s.index > 0 ? 'UPSTREAM_STALLED' : 'EMPTY');
  } catch { /* fail-soft */ }
}

export function activeSpeechStreamId(): number | null {
  return _open ? _open.id : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı yüzeyi (CAROS LAB) — **METİN TAŞIMAZ**
 * ════════════════════════════════════════════════════════════════════════ */

export interface SpeechStreamDiagnostics {
  readonly activeStreamId: number | null;
  readonly queued: number;
  readonly speaking: boolean;
  readonly spokenThisStream: number;
  readonly streamsOpened: number;
  readonly chunksSpoken: number;
  readonly staleDropped: number;
  readonly duplicateDropped: number;
  readonly cancelled: number;
  readonly stalled: number;
}

export function getSpeechStreamDiagnostics(): SpeechStreamDiagnostics {
  return Object.freeze({
    activeStreamId:   _open ? _open.id : null,
    queued:           _open ? _open.queue.length : 0,
    speaking:         _open ? _open.speaking !== null : false,
    spokenThisStream: _open ? _open.index : 0,
    streamsOpened:    _streamsOpened,
    chunksSpoken:     _chunksSpoken,
    staleDropped:     _staleDropped,
    duplicateDropped: _duplicateDropped,
    cancelled:        _cancelled,
    stalled:          _stalled,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetSpeechStreamForTest(): void {
  _seq = 0; _open = null;
  _ports = { now: () => 0, speakChunk: (_t, d) => d(), cancelSpeech: () => {} };
  _streamsOpened = 0; _chunksSpoken = 0; _staleDropped = 0;
  _duplicateDropped = 0; _cancelled = 0; _stalled = 0;
}
