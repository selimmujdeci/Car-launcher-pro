/**
 * wakeDecisionModel — WAKE KARAR DEFTERİ (saf).
 *
 * SAF: I/O YOK · network YOK · timer YOK · `Date.now` YOK · React YOK ·
 * import YOK. Tüm girdiler dışarıdan → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN BOŞLUK ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Hey Mavi" bazen uyandırmıyor, bazen normal konuşmada kendiliğinden
 * uyanıyor. Bugün KABUL EDİLEN wake'ler sayılıyor (`getWakeWatchdogStats`,
 * kütük #460) ama **REDDEDİLEN ve BASTIRILAN wake'ler hiç sayılmıyor**:
 * `wakeWordService.onWakeWordDetected` içindeki dört kapı da sessiz
 * `return` ediyor. Bu yüzden "hiç duyulmadı" ile "duyuldu ama bastırıldı"
 * AYIRT EDİLEMİYOR.
 *
 * Bu model o ayrımı ölçülebilir kılar. **Kararı DEĞİŞTİRMEZ** — yalnız
 * kaydeder.
 *
 * ── GİZLİLİK (pazarlıksız) ────────────────────────────────────────────────
 * Bu modelde **transcript alanı YOKTUR**. Ham metin, n-best adayları, ses,
 * konum, kullanıcı kimliği ve wake sözcüğünün KENDİSİ buraya GİRMEZ. Yalnız
 * türetilmiş sayılar taşınır (`tokenCount`, `matchedAtIndex`, iki bayrak).
 * Bu, `VoiceMicDiagnostics`'in "yalnız SINIF ve ADET" sözleşmesiyle aynıdır.
 *
 * ── TAKSONOMİ DİSİPLİNİ ───────────────────────────────────────────────────
 * Bir gerekçe ancak ÜRÜN KODUNDA gerçek bir karar noktası varsa tanımlanır.
 * Analiz raporlarında geçtiği için eklenen gerekçe YOKTUR. Kasten DIŞARIDA
 * bırakılanlar ve nedenleri:
 *
 *  · `SUPPRESSED_INTERACTION` — `pauseWakeWordForInteraction()` motoru
 *    TAMAMEN durdurur (`stopGrammarMode()` + `_stopWatchdog()`), dolayısıyla
 *    bastırılacak bir wake olayı JS'e HİÇ ULAŞMAZ. Bu bir DURUM'dur, karar
 *    değil → gerekçe değil, anlık görüntüde bayrak olarak taşınır.
 *  · `NOT_EVALUATED_TTS_HALF_DUPLEX` · `NOT_EVALUATED_VAD` ·
 *    `REJECTED_NATIVE_NO_MATCH` — üçü de yalnız Java tarafında olur
 *    (`wakeMicMustYield`, VAD `continue`, `matchesWakePhrase`). JS bu
 *    kararları GÖREMEZ; JS'te gerekçe üretmek uydurma olurdu. Bunlar native
 *    sayaç dilimine (ayrı tur) aittir.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Taksonomi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Wake kararının TERMİNAL gerekçesi.
 *
 * Her değerin ürün kodunda birebir karşılığı vardır (dosya:satır yorumda).
 */
export type WakeDecisionReason =
  /** Tetik kabul edildi, oturum açıldı. `onWakeWordDetected` kabul dalı. */
  | 'ACCEPTED'
  /** Kabul edildi AMA komuta dönüşmedi — yaşam döngüsü zinciri kapanmadı. */
  | 'ACCEPTED_NO_INTENT'
  /** Metin wake sözüyle eşleşmedi. Grammar listener `!_matches` / polling `some()` false. */
  | 'REJECTED_TOKEN'
  /** Korunan eylem/bilişsel duraklama. `isVoicePaused()`. */
  | 'SUPPRESSED_PAUSED'
  /** Asistan zaten aktif (dinliyor/işliyor/cevap veriyor). `vs.status !== 'idle'`. */
  | 'SUPPRESSED_VOICE_ACTIVE'
  /** Takip döngüsü açık. `vs.followUp`. */
  | 'SUPPRESSED_FOLLOWUP'
  /** Selamlama/echo penceresi (4 sn). `now - _lastWakeAcceptedAt`. */
  | 'SUPPRESSED_DEBOUNCE'
  /** Vosk modeli hazır değil → native wake HİÇ kurulmadı. `enableWakeWord` else dalı. */
  | 'NOT_EVALUATED_MODEL_NOT_READY';

/** Kararın hangi çalışma yolundan geldiği. */
export type WakePath =
  /** Native grammar thread (olay-güdümlü) — `startGrammarMode`. */
  | 'GRAMMAR'
  /** JS polling döngüsü (native metot yok / özel mod) — `nativeLoop`. */
  | 'JS_POLLING'
  /** Yol bilinmiyor (ör. model hazır değil — henüz yol seçilmedi). */
  | 'UNKNOWN';

export const WAKE_DECISION_REASONS: readonly WakeDecisionReason[] = [
  'ACCEPTED', 'ACCEPTED_NO_INTENT', 'REJECTED_TOKEN',
  'SUPPRESSED_PAUSED', 'SUPPRESSED_VOICE_ACTIVE', 'SUPPRESSED_FOLLOWUP',
  'SUPPRESSED_DEBOUNCE', 'NOT_EVALUATED_MODEL_NOT_READY',
] as const;

/** Halka kapasitesi — FIFO. Bellek sözleşmesi: sınırsız büyüme YOK. */
export const WAKE_RING_CAP = 64;

/**
 * Kabul edilen bir wake'in komuta dönüşmesi için tanınan süre (ms).
 * Aşılırsa `ACCEPTED_NO_INTENT` sayılır. Selamlama TTS'i + mikrofon açılışı +
 * kullanıcının konuşması + tanıma için cömert bir üst sınırdır.
 */
export const WAKE_INTENT_TIMEOUT_MS = 20_000;

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıt
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * TEK karar kaydı.
 *
 * ⚠️ Burada transcript ALANI YOKTUR ve EKLENMEYECEKTİR (kilit testi denetler).
 */
export interface WakeDecisionRecord {
  readonly atMs: number;
  readonly reason: WakeDecisionReason;
  readonly path: WakePath;
  /** Mevcut `VoiceLifecycleEvent` oturumu — yeni kimlik sistemi KURULMADI. */
  readonly sessionId: number | null;
  readonly generationId: number | null;
  /** Duyulan metnin KELİME SAYISI (metnin kendisi değil). `null` = ölçülmedi. */
  readonly tokenCount: number | null;
  /** Eşleşmenin başladığı kelime indeksi; `-1` = eşleşme yok, `null` = ölçülmedi. */
  readonly matchedAtIndex: number | null;
  /** Aday ÇIPLAK AD mıydı (tek kelimelik wake sözü) — false wake analizi için. */
  readonly bareNameCandidate: boolean | null;
  /** Eşleşme n-best ALTERNATİFİNDEN mi geldi (yalnız JS polling yolunda olabilir). */
  readonly viaNbestAlternative: boolean | null;
}

/** Karar yazarken verilen girdi — `atMs` dışarıdan (saat DI). */
export interface WakeDecisionInput {
  readonly atMs: number;
  readonly reason: WakeDecisionReason;
  readonly path?: WakePath;
  readonly sessionId?: number | null;
  readonly generationId?: number | null;
  readonly tokenCount?: number | null;
  readonly matchedAtIndex?: number | null;
  readonly bareNameCandidate?: boolean | null;
  readonly viaNbestAlternative?: boolean | null;
}

/** Kabul edilmiş ama henüz komuta dönüşmemiş tetik. */
export interface PendingAccept {
  readonly sessionId: number | null;
  readonly atMs: number;
}

export interface WakeForensicsState {
  readonly records: readonly WakeDecisionRecord[];
  readonly counts: Readonly<Record<WakeDecisionReason, number>>;
  /** Halkadan FIFO ile düşen kayıt sayısı (kayıtların kaybı görünür olsun). */
  readonly evicted: number;
  /** Komuta dönüşmesi beklenen kabul; `null` = bekleyen yok. */
  readonly pendingAccept: PendingAccept | null;
  /** Kabulden sonra GERÇEKTEN komut üretilen tetik sayısı. */
  readonly intentReached: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function _num(n: unknown): number | null {
  return _finite(n) ? n : null;
}

function _bool(b: unknown): boolean | null {
  return typeof b === 'boolean' ? b : null;
}

function _zeroCounts(): Record<WakeDecisionReason, number> {
  const c = {} as Record<WakeDecisionReason, number>;
  for (const r of WAKE_DECISION_REASONS) c[r] = 0;
  return c;
}

/** Boş defter — TÜM anahtarlar baştan tanımlı (V8 hidden-class kararlılığı). */
export function emptyWakeForensics(): WakeForensicsState {
  return {
    records: [],
    counts: _zeroCounts(),
    evicted: 0,
    pendingAccept: null,
    intentReached: 0,
  };
}

/** Gerekçe tanınan kümede mi (bilinmeyen gerekçe kayda GİRMEZ). */
function _validReason(r: unknown): r is WakeDecisionReason {
  return typeof r === 'string' && (WAKE_DECISION_REASONS as readonly string[]).includes(r);
}

/**
 * Bekleyen kabul zaman aşımına uğradıysa `ACCEPTED_NO_INTENT` olarak kapat.
 * Saf: yeni durum döner, kayıt halkasına da bir satır ekler.
 */
function _finalizePending(
  s: WakeForensicsState, nowMs: number, timeoutMs: number,
): WakeForensicsState {
  const p = s.pendingAccept;
  if (p === null) return s;
  if (nowMs - p.atMs < timeoutMs) return s;
  return _append({ ...s, pendingAccept: null }, {
    atMs: p.atMs + timeoutMs,
    reason: 'ACCEPTED_NO_INTENT',
    path: 'UNKNOWN',
    sessionId: p.sessionId,
    generationId: null,
    tokenCount: null,
    matchedAtIndex: null,
    bareNameCandidate: null,
    viaNbestAlternative: null,
  });
}

/** Halkaya ekle — FIFO, kapasite aşımında en eski düşer. */
function _append(s: WakeForensicsState, rec: WakeDecisionRecord): WakeForensicsState {
  const over = s.records.length >= WAKE_RING_CAP;
  const records = over
    ? [...s.records.slice(s.records.length - WAKE_RING_CAP + 1), rec]
    : [...s.records, rec];
  const counts = { ...s.counts, [rec.reason]: s.counts[rec.reason] + 1 };
  return { ...s, records, counts, evicted: s.evicted + (over ? 1 : 0) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel API
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Karar kaydet.
 *
 * FAIL-SAFE: bilinmeyen gerekçe ya da ölçülemeyen zaman → durum DEĞİŞMEZ
 * (sahte kayıt üretilmez).
 */
export function recordWakeDecision(
  s: WakeForensicsState,
  input: WakeDecisionInput,
  timeoutMs: number = WAKE_INTENT_TIMEOUT_MS,
): WakeForensicsState {
  if (!input || !_finite(input.atMs) || !_validReason(input.reason)) return s;

  /* Yeni karar gelmeden önce, bekleyen kabul zaman aşımına uğradıysa kapat →
     "kabul edildi ama komut olmadı" sessizce kaybolmaz. */
  let next = _finalizePending(s, input.atMs, timeoutMs);

  const rec: WakeDecisionRecord = {
    atMs: input.atMs,
    reason: input.reason,
    path: input.path ?? 'UNKNOWN',
    sessionId: _num(input.sessionId),
    generationId: _num(input.generationId),
    tokenCount: _num(input.tokenCount),
    matchedAtIndex: _num(input.matchedAtIndex),
    bareNameCandidate: _bool(input.bareNameCandidate),
    viaNbestAlternative: _bool(input.viaNbestAlternative),
  };
  next = _append(next, rec);

  /* Kabul → komut bekleyişi başlar. Zaten bekleyen varsa ÜSTÜNE YAZILMAZ:
     önceki bekleyiş `_finalizePending` ile kapanmış olmalıydı; kapanmadıysa
     (süre dolmadıysa) yeni kabul zaten debounce'a takılırdı. */
  if (rec.reason === 'ACCEPTED') {
    next = { ...next, pendingAccept: { sessionId: rec.sessionId, atMs: rec.atMs } };
  }
  return next;
}

/**
 * Kabul edilen tetik GERÇEKTEN komuta dönüştü — bekleyişi kapat.
 *
 * `sessionId` verilirse yalnız EŞLEŞEN bekleyiş kapanır (yanlış oturumun
 * bekleyişi kapatılmaz); verilmezse mevcut bekleyiş kapanır.
 */
export function noteIntentReached(
  s: WakeForensicsState, sessionId?: number | null,
): WakeForensicsState {
  const p = s.pendingAccept;
  if (p === null) return s;
  if (_finite(sessionId) && _finite(p.sessionId) && sessionId !== p.sessionId) return s;
  return { ...s, pendingAccept: null, intentReached: s.intentReached + 1 };
}

/** Okuma görüntüsü — türetilmiş, sunuma hazır. */
export interface WakeForensicsProjection {
  readonly counts: Readonly<Record<WakeDecisionReason, number>>;
  /** En YENİ önce sıralı, en fazla `limit` kayıt. */
  readonly recent: readonly WakeDecisionRecord[];
  readonly total: number;
  readonly evicted: number;
  readonly intentReached: number;
  /** Bekleyen kabul var mı ve ne kadar süredir bekliyor (ms). */
  readonly pendingAcceptAgeMs: number | null;
  /**
   * `ACCEPTED_NO_INTENT` toplamı — kapanmış kayıtlar + bekleyişi ZAMAN AŞIMINA
   * uğramış ama henüz yeni karar gelmediği için deftere yazılmamış olan.
   */
  readonly acceptedNoIntent: number;
}

/**
 * Defteri `nowMs` anına göre yansıt.
 *
 * NEDEN AYRI ADIM: bekleyen kabulün zaman aşımı ZAMANLA olur. Bunu periyodik
 * bir tick ile yakalamak YENİ TIMER gerektirirdi; burada OKUMA ANINDA türetilir.
 */
export function projectWakeForensics(
  s: WakeForensicsState,
  nowMs: number,
  limit = 10,
  timeoutMs: number = WAKE_INTENT_TIMEOUT_MS,
): WakeForensicsProjection {
  const base = s ?? emptyWakeForensics();
  const p = base.pendingAccept;
  const age = p !== null && _finite(nowMs) ? Math.max(0, nowMs - p.atMs) : null;
  const timedOut = age !== null && age >= timeoutMs ? 1 : 0;
  const cap = _finite(limit) && limit > 0 ? Math.floor(limit) : 10;

  return {
    counts: base.counts,
    recent: [...base.records].reverse().slice(0, cap),
    total: base.records.length + base.evicted,
    evicted: base.evicted,
    intentReached: base.intentReached,
    pendingAcceptAgeMs: age,
    acceptedNoIntent: base.counts.ACCEPTED_NO_INTENT + timedOut,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Metin ŞEKLİ türetme (metnin KENDİSİ taşınmaz)
 * ════════════════════════════════════════════════════════════════════════ */

export interface TokenShape {
  readonly tokenCount: number;
  /** Eşleşmenin başladığı kelime indeksi; `-1` = eşleşme yok. */
  readonly matchedAtIndex: number;
  /** Eşleşen (ya da eşleşmeye en yakın) wake sözü TEK kelimelik miydi. */
  readonly bareNameCandidate: boolean;
}

/**
 * Tokenlerden yalnız SAYISAL şekil çıkarır.
 *
 * ⚠️ Girdi token dizisidir ve **hiçbir yerde SAKLANMAZ** — çıktı üç sayıdır.
 * Çağıran, ürünün kendi normalize edicisiyle tokenize eder (bu model saf
 * kalsın diye normalize burada YAPILMAZ).
 *
 * Eşleşme kuralı `companionIdentity.matchesWakeTranscript` ile AYNIDIR:
 * tek kelimelik çıplak ad YALNIZ cümle başında (indeks 0) sayılır; çok
 * kelimeli söz her konumda aranır. Bu bir POLİTİKA KOPYASI DEĞİL, ölçüm
 * amaçlı okumadır — ürün kararını yine `matchesWakeTranscript` verir.
 */
export function deriveTokenShape(
  tokens: readonly string[],
  wakeWordTokenLists: readonly (readonly string[])[],
): TokenShape {
  const t = Array.isArray(tokens) ? tokens : [];
  let bare = false;
  for (const p of wakeWordTokenLists) {
    if (!Array.isArray(p) || p.length === 0) continue;
    const isBare = p.length === 1;
    const maxStart = isBare ? 0 : t.length - p.length;
    for (let i = 0; i <= maxStart && i + p.length <= t.length; i++) {
      let ok = true;
      for (let j = 0; j < p.length; j++) {
        if (t[i + j] !== p[j]) { ok = false; break; }
      }
      if (ok) return { tokenCount: t.length, matchedAtIndex: i, bareNameCandidate: isBare };
    }
    if (isBare) bare = true;
  }
  return { tokenCount: t.length, matchedAtIndex: -1, bareNameCandidate: bare };
}
