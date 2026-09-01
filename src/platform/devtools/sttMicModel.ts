/**
 * sttMicModel.ts — MAVI-STT-LAB-1: Mavi STT / Mikrofon ekranının SAF modeli.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok.
 * Servis importu YOK — girdi YAPISALDIR (mock'suz test edilir).
 *
 * ── BU MODEL NE YAPMAZ ──────────────────────────────────────────────────────
 * STT davranışını DEĞİŞTİRMEZ. Eşik/kazanç/AudioSource/efekt kararı ÜRETMEZ.
 * "Hız gürültüyü artırdı" gibi NEDENSELLİK ÇIKARIMI YAPMAZ — yalnız aynı okuma
 * turunda alınmış iki ölçümü YAN YANA gösterir ve aralarındaki zaman farkını
 * (örnekleme sapması) dürüstçe bildirir.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Girdi tipinde transcript · n-best · wake sözcüğü · grammar KELİMESİ · ham ses
 * örneği · kişi adı · konum · VIN · cihaz kimliği TAŞIYAN ALAN YOKTUR. Sızıntı
 * tip olarak imkânsızdır. RMS örnekleri normalize skalerdir (0..1), ses DEĞİLDİR.
 *
 * ── SENTINEL SÖZLEŞMESİ ─────────────────────────────────────────────────────
 * `-1` = ölçüm/uygulanabilirlik YOK · `null` = kaynak değer vermedi. `0` GERÇEK
 * bir değerdir (sessiz kabinde RMS 0 olabilir) ve ikisiyle ASLA karıştırılmaz.
 */

import {
  observed, derived, unavailable, applyStaleness,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/** Bu eşikten eski native gözlem STALE sayılır (mikrofon durumu hızlı değişir). */
export const STT_MIC_STALE_MS = 30_000;
export const MAX_FIELDS_PER_STT_SECTION = 24;
/** Ekranda gösterilecek azami kaynak denemesi (native zaten 8 ile sınırlar). */
export const MAX_SOURCE_ATTEMPTS = 8;
/** Native halka tavanı — ekranda da aşılmaz. */
export const MAX_RMS_SAMPLES = 64;

export type SttProbeStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';

export const STT_PROBE_STATUS_LABEL: Readonly<Record<SttProbeStatus, string>> = {
  AVAILABLE:   'KANIT MEVCUT',
  UNAVAILABLE: 'KANIT YOK',
  STALE:       'BAYAT KANIT',
} as const;

export type SttCapturePath = 'NONE' | 'ACTIVE_LISTEN' | 'WAKE_WORD';

export const STT_PATH_LABEL: Readonly<Record<SttCapturePath, string>> = {
  NONE:          'HİÇ YAKALAMA YAPILMADI',
  ACTIVE_LISTEN: 'AKTİF DİNLEME (startSpeechRecognition)',
  WAKE_WORD:     'WAKE WORD (pasif grammar thread)',
} as const;

/** Native sözleşmesiyle AYNI grammar sınıfları. */
export type SttGrammarType = 'static_command' | 'wake_word' | 'confirmation' | 'free';

export const STT_GRAMMAR_LABEL: Readonly<Record<SttGrammarType, string>> = {
  static_command: 'static_command (offline komut sözlüğü)',
  wake_word:      'wake_word (wake sözleri + [unk])',
  confirmation:   'confirmation (onay sözlüğü)',
  free:           'free (full-vocab — grammar yok)',
} as const;

export type SttResultCategory = 'success' | 'no_match' | 'timeout' | 'error';

export const STT_RESULT_LABEL: Readonly<Record<SttResultCategory, string>> = {
  success:  'success (metin üretildi)',
  no_match: 'no_match (sessizlik endpoint\'i — metin yok)',
  timeout:  'timeout (dinleme penceresi doldu)',
  error:    'error (model / ses / decode hatası)',
} as const;

export type SttAttemptOutcome = 'SIGNAL' | 'NO_SIGNAL' | 'INIT_FAILED' | 'EXCEPTION';

export const STT_ATTEMPT_LABEL: Readonly<Record<SttAttemptOutcome, string>> = {
  SIGNAL:      'SİNYAL VAR (seçilebilir)',
  NO_SIGNAL:   'SİNYAL YOK (init oldu, ölü/sıfır okudu)',
  INIT_FAILED: 'INIT BAŞARISIZ',
  EXCEPTION:   'İSTİSNA (bounded)',
} as const;

/** Hareket durumu — `maviVehicleContext.MaviMotionState` ile AYNI sözleşme. */
export type SttMotionState = 'moving' | 'stopped' | 'unknown';

export const STT_MOTION_LABEL: Readonly<Record<SttMotionState, string>> = {
  moving:  'HAREKETTE',
  stopped: 'DURUYOR',
  unknown: 'BİLİNMİYOR',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham girdi — YAPISAL tip (metin taşıyan kullanıcı-içeriği alanı YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export interface SttSourceAttemptRaw {
  readonly source: number;
  readonly sourceName: string;
  readonly outcome: string;
}

export interface SttSourceRaw {
  /** -1 = seçilmedi. */
  readonly selectedSource: number;
  readonly selectedSourceName: string;
  /** 0 = bilinmiyor. */
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly bufferBytes: number;
  readonly frameSamples: number;
  readonly attempts: readonly SttSourceAttemptRaw[];
}

export interface SttEffectsRaw {
  readonly probed: boolean;
  readonly aecAvailable: boolean; readonly aecCreated: boolean; readonly aecEnabled: boolean;
  readonly nsAvailable: boolean;  readonly nsCreated: boolean;  readonly nsEnabled: boolean;
  readonly agcAvailable: boolean; readonly agcCreated: boolean; readonly agcEnabled: boolean;
  /** Bounded KOD listesi — ham exception metni YOK. */
  readonly errors: readonly string[];
}

export interface SttVadRaw {
  readonly present: boolean;
  /** -1 = ölçüm yok. */
  readonly lastRms: number;
  /** -1 = taban ÖĞRENİLMEDİ. */
  readonly noiseFloor: number;
  readonly effectiveThreshold: number;
  /** -1 = bu yolda uygulanmaz. */
  readonly staticMinThreshold: number;
  readonly floorFactor: number;
  readonly speechDetected: boolean;
  /** Monotonic ms. 0 = hiç ses paketi yok. */
  readonly lastAudioAtMs: number;
  readonly monotonicNowMs: number;
  readonly sampleCount: number;
  /** Normalize RMS skalerleri (0..1) — HAM SES DEĞİL. */
  readonly samples: readonly number[];
}

/**
 * Native WAKE KARAR sayaçları (şema 2). `null` = eski APK / ölçüm YOK —
 * sahte `0` ÜRETİLMEZ (şema 1 APK'sında bu blok hiç gelmez).
 */
export interface SttWakeNativeRaw {
  readonly yieldCount: number;
  readonly vadSkipFrames: number;
  readonly decodeFrames: number;
  readonly noMatchCount: number;
  readonly triggerCount: number;
  /** -1 = ölçüm yok. */
  readonly lastTriggerLatencyMs: number;
  /** Vosk `setPartialWords` kurulabildi mi — güven ölçümünün ön koşulu. */
  readonly partialWordsEnabled?: boolean;
  /** Son eşleşmedeki en düşük kelime güveni ×1000. -1 = güven YOK. */
  readonly lastMatchConfMilli?: number;
}

export interface SttEngineRaw {
  readonly wakeEngineActive: boolean;
  readonly activeRecognizerActive: boolean;
  readonly grammarType: string;
  /** -1 = grammar yok. */
  readonly grammarWordCount: number;
  readonly lastResultCategory: string | null;
  readonly lastResultAt: number;
}

/**
 * Araç bağlamı — native mikrofon gözlemiyle AYNI okuma turunda örneklenir.
 * `speedKmh: null` = kanıt yok (SIFIR YAZILMAZ). `hvacFanLevel` repoda hiçbir
 * kaynağa bağlı DEĞİLDİR → daima null (bkz. `_vehicleSection` notu).
 */
export interface SttVehicleRaw {
  readonly speedKmh: number | null;
  readonly motionState: string;
  readonly hvacFanLevel: number | null;
  /** Bu örneklemenin duvar-saati damgası (ms). */
  readonly sampledAt: number;
}

/**
 * MAVI-STT-CONTEXT-GRAMMAR gözlemi — YALNIZ sınıf, ADET, bounded gerekçe ve
 * doyan sayaçlar. Grammar SÖZCÜKLERİ bu tipte YOKTUR (gizlilik yapısal).
 */
export interface SttGrammarRaw {
  readonly grammarClass: string;
  readonly grammarEntryCount: number;
  readonly lastReason: string;
  readonly transitionCount: number;
  readonly fallbackGeneralCount: number;
  readonly grammarApplyFailureCount: number;
  /** `null` = onay kaynağı okunamadı ("bekleyen yok" DEĞİL). */
  readonly pendingConfirmation: boolean | null;
  readonly countersSaturated: boolean;
  /**
   * Bağlam sağlayıcıları (nav/medya/araç) boot'ta GERÇEKTEN bağlandı mı.
   * `false` iken sınıf her zaman `general_command`tır — bu, "bağlam yok"
   * DEĞİL "bağlam okunamıyor" demektir ve gizlenmemelidir.
   */
  readonly providersWired: boolean;
}

/** JS tarafındaki wake/ses servis bayrakları — yalnız bayrak ve ADET. */
export interface SttJsRaw {
  readonly wakeEnabled: boolean;
  readonly wakeStatus: string;
  /** Wake sözcüklerinin ADEDİ — sözcüklerin KENDİSİ taşınmaz. */
  readonly wakePhraseCount: number;
  readonly voiceStatus: string;
  readonly micAvailable: boolean;
  /** Offline komut grammar'ının kelime ADEDİ. -1 = okunamadı. */
  readonly commandGrammarWordCount: number;
  /* ── Wake watchdog ölçümü (kütük #460) ────────────────────────────────
     Saha "wake thread 32 dk'da 4 kez ÖLDÜ" diye kaydetmişti; gerçekte
     canlılık HİÇ ölçülmüyor — periyodik KOŞULSUZ yeniden kurulum var.
     Bu alanlar hüküm vermez, kararı ölçülebilir kılar. */
  /** Bu oturumdaki periyodik yeniden kurulum sayısı. */
  readonly wakeRearmCount: number;
  /** Bir ÖNCEKİ pencerede kabul edilen wake sayısı — re-arm gerekli miydi? */
  readonly wakeWakesInPrevWindow: number;
  /** Yeniden kurulum periyodu (ms). */
  readonly wakeRearmIntervalMs: number;
  /**
   * Canlılık GERÇEKTEN ölçülüyor mu — `getWakeWatchdogStats().livenessMeasured`.
   * Bugün `false`: native yalnız TETİK ANINI yayınlar, "ayakta ama duymadı" ile
   * "öldü" JS'ten ayırt edilemez. Periyodik re-arm'ı "self-heal" diye sunmamak
   * için AÇIKÇA taşınır (kütük #460).
   */
  readonly wakeLivenessMeasured?: boolean;
  /** Native owner'ın son recorder lifecycle durumu; `UNAVAILABLE` = eski APK. */
  readonly wakeRecorderState?: string;
  /** Bounded native-failure recovery isteği adedi. */
  readonly wakeRecoveryCount?: number;

  /* ── WAKE KARAR DEFTERİ ───────────────────────────────────────────────
     "Hiç duyulmadı" ile "duyuldu ama bastırıldı" ayrımı. Yalnız gerekçe
     ADETLERİ ve türetilmiş sayılar — transcript TAŞINMAZ. */
  /** Gerekçe → adet (bounded taksonomi). */
  readonly wakeDecisionCounts?: Readonly<Record<string, number>>;
  /** Deftere düşen toplam karar (halkadan taşanlar DAHİL). */
  readonly wakeDecisionTotal?: number;
  /** Halkadan FIFO ile düşen kayıt sayısı — kayıp görünür olsun. */
  readonly wakeDecisionEvicted?: number;
  /** Kabul edilip GERÇEKTEN komuta dönüşen tetik sayısı. */
  readonly wakeIntentReached?: number;
  /** Kabul edildi ama komuta dönüşmedi (zaman aşımına uğrayan bekleyiş DAHİL). */
  readonly wakeAcceptedNoIntent?: number;
  /** Bekleyen kabulün yaşı (ms); `null` = bekleyen yok. */
  readonly wakePendingAcceptAgeMs?: number | null;
  /** Son kararlar — en yeni önce. Transcript YOK, yalnız gerekçe + yol + sayılar. */
  readonly wakeRecentDecisions?: readonly SttWakeDecisionRaw[];
}

/** Tek karar satırı — ham metin ALANI YOKTUR (yapısal gizlilik). */
export interface SttWakeDecisionRaw {
  readonly atMs: number;
  readonly reason: string;
  /** `GRAMMAR` · `JS_POLLING` · `UNKNOWN` — hangi yolun koştuğu. */
  readonly path: string;
  readonly tokenCount: number | null;
  readonly matchedAtIndex: number | null;
  readonly bareNameCandidate: boolean | null;
  readonly viaNbestAlternative: boolean | null;
}

/** Gerekçe dağılımını tek satıra çevirir — SIFIR olanlar gösterilmez (gürültü). */
function _countsLine(counts: Readonly<Record<string, number>>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(counts ?? {})) {
    if (typeof v === 'number' && v > 0) parts.push(`${k}=${v}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'karar yok';
}

/**
 * Tek karar satırı — ham metin İÇERMEZ.
 * Biçim: `GEREKÇE@YOL k3 i0 ÇIPLAK ALT`
 */
function _decisionLine(d: SttWakeDecisionRaw): string {
  const bits: string[] = [`${d.reason}@${d.path}`];
  if (typeof d.tokenCount === 'number') bits.push(`k${d.tokenCount}`);
  if (typeof d.matchedAtIndex === 'number') bits.push(`i${d.matchedAtIndex}`);
  if (d.bareNameCandidate === true) bits.push('ÇIPLAK');
  if (d.viaNbestAlternative === true) bits.push('ALT');
  return bits.join(' ');
}

export interface SttMicRaw {
  readonly readAt: number;
  /** Native gözlem var mı (metot yok / hiç ölçüm yok → false). */
  readonly present: boolean;
  readonly schemaVersion: number | null;
  /** Native duvar-saati damgası. 0/geçersiz → null ("şimdi" UYDURULMAZ). */
  readonly capturedAt: number | null;
  readonly path: string;
  readonly sessionActive: boolean;
  readonly sessionStartedAt: number | null;
  readonly source: SttSourceRaw | null;
  readonly effects: SttEffectsRaw | null;
  readonly vad: SttVadRaw | null;
  readonly stt: SttEngineRaw | null;
  /** Native wake karar sayaçları; `null` = eski APK (şema 1) veya ölçüm yok. */
  readonly wakeNative?: SttWakeNativeRaw | null;
  readonly vehicle: SttVehicleRaw | null;
  readonly js: SttJsRaw | null;
  readonly grammar: SttGrammarRaw | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * RMS istatistiği (saf)
 * ════════════════════════════════════════════════════════════════════════ */

export interface RmsStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
}

/**
 * Bounded örnek dizisinden özet istatistik. Geçersiz/boş girdi → `null`
 * (SIFIR İSTATİSTİĞİ UYDURULMAZ). En fazla {@link MAX_RMS_SAMPLES} örnek okunur.
 *
 * Yüzdelik: en yakın-sıra (nearest-rank) yöntemi — enterpolasyon YOK, böylece
 * dönen değer HER ZAMAN gerçekten ölçülmüş bir örnektir.
 */
export function computeRmsStats(samples: readonly number[] | null | undefined): RmsStats | null {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const vals: number[] = [];
  for (const v of samples) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) vals.push(v);
    if (vals.length >= MAX_RMS_SAMPLES) break;
  }
  if (vals.length === 0) return null;

  const sorted = vals.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;

  return {
    count: vals.length,
    min:   sorted[0]!,
    max:   sorted[sorted.length - 1]!,
    avg:   sum / vals.length,
    p50:   percentileNearestRank(sorted, 0.50),
    p95:   percentileNearestRank(sorted, 0.95),
  };
}

/**
 * En-yakın-sıra (nearest-rank) yüzdelik — DETERMİNİSTİK ve enterpolasyonsuz.
 * Dönen değer HER ZAMAN girdide GERÇEKTEN bulunan bir örnektir (uydurma ara
 * değer üretilmez). Girdi ARTAN SIRADA olmalıdır.
 *
 * MAVI-STT-LAB-2 de bu tek gerçeği kullanır — ikinci bir yüzdelik uygulaması
 * KURULMAZ (iki ekranın aynı veriye farklı p95 demesi tanı hattını çürütürdü).
 */
export function percentileNearestRank(sorted: readonly number[], q: number): number {
  const rank = Math.ceil(q * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}

/** RMS/eşik gösterimi — 4 ondalık (0..1 normalize skaler). */
export function fmtRms(v: number): string {
  return v.toFixed(4);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

export type SttSectionId =
  | 'status' | 'source' | 'effects' | 'vad' | 'vehicle' | 'engine' | 'wake' | 'restrictions';

export interface SttSection {
  readonly id: SttSectionId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export const STT_SECTION_TITLE: Readonly<Record<SttSectionId, string>> = {
  status:       '0 · Gözlem Durumu',
  source:       '1 · Ses Kaynağı (AudioSource)',
  effects:      '2 · Android Ses Efektleri',
  vad:          '3 · VAD / Gürültü',
  vehicle:      '4 · Araç Bağlamı',
  engine:       '5 · STT Durumu',
  wake:         '6 · Wake Kararı (JS defteri + native sayaçlar)',
  restrictions: '7 · Kısıtlamalar',
} as const;

const SRC = {
  native:  'CarLauncher.getVoiceMicDiagnostics() (salt-okunur)',
  vehicle: 'maviVehicleContext.currentMaviVehicleContext() (mevcut getter)',
  js:      'wakeWordService + voiceService + commandParser (mevcut getter\'lar)',
  grammar: 'voice/contextGrammarApplier.getGrammarDiagnostics() (salt-okunur)',
  none:    'YOK',
} as const;

function _bound(f: readonly InspectorField[]): readonly InspectorField[] {
  return f.length <= MAX_FIELDS_PER_STT_SECTION ? f : f.slice(0, MAX_FIELDS_PER_STT_SECTION);
}

/* ── Gözlem durumu ────────────────────────────────────────────────────────── */

/**
 * KURAL: native kanıt yoksa UNAVAILABLE · damga varsa ve eşikten eskiyse STALE ·
 * aksi hâlde AVAILABLE. Damga yoksa AVAILABLE denmez (yaş doğrulanamaz) → STALE.
 */
export function deriveSttProbeStatus(s: SttMicRaw): SttProbeStatus {
  if (!s || !s.present) return 'UNAVAILABLE';
  if (s.capturedAt === null) return 'STALE';
  const age = s.readAt - s.capturedAt;
  return age > STT_MIC_STALE_MS ? 'STALE' : 'AVAILABLE';
}

export function normalizePath(v: string): SttCapturePath {
  return v === 'ACTIVE_LISTEN' || v === 'WAKE_WORD' ? v : 'NONE';
}

export function normalizeGrammar(v: string): SttGrammarType {
  return v === 'static_command' || v === 'wake_word' || v === 'confirmation' ? v : 'free';
}

export function normalizeResult(v: string | null): SttResultCategory | null {
  if (v === 'success' || v === 'no_match' || v === 'timeout' || v === 'error') return v;
  return null;
}

export function normalizeAttempt(v: string): SttAttemptOutcome {
  return v === 'SIGNAL' || v === 'NO_SIGNAL' || v === 'INIT_FAILED' ? v : 'EXCEPTION';
}

export function normalizeMotion(v: string): SttMotionState {
  return v === 'moving' || v === 'stopped' ? v : 'unknown';
}

function _statusSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const status = deriveSttProbeStatus(s);

  f.push(derived(
    { id: 'sttStatus', label: 'gözlem durumu', source: SRC.native,
      note: `KURAL: kanıt yok → KANIT YOK · damga yok veya ${Math.round(STT_MIC_STALE_MS / 1000)}sn'den eski → BAYAT.` },
    STT_PROBE_STATUS_LABEL[status],
  ));

  f.push(s.capturedAt !== null
    ? applyStaleness(observed(
        { id: 'sttCapturedAt', label: 'gözlem damgası', source: SRC.native,
          note: 'Native duvar-saati damgası (snapshot anı).', updatedAt: s.capturedAt },
        new Date(s.capturedAt).toISOString(),
      ), s.readAt, STT_MIC_STALE_MS)
    : unavailable({ id: 'sttCapturedAt', label: 'gözlem damgası', source: SRC.native, note: '' },
        'Damga yok — "şimdi" UYDURULMAZ.'));

  f.push(s.schemaVersion !== null
    ? observed({ id: 'sttSchema', label: 'şema sürümü', source: SRC.native,
        note: 'Snapshot sözleşme sürümü — alan kayması görünür olsun diye.' }, s.schemaVersion)
    : unavailable({ id: 'sttSchema', label: 'şema sürümü', source: SRC.native, note: '' },
        'Okunamadı (eski APK veya metot yok).'));

  f.push(observed(
    { id: 'sttPath', label: 'ölçülen yakalama yolu', source: SRC.native,
      note: 'İki yol AYRIDIR: aktif dinleme öğrenilen taban kullanır, wake yolu SABİT eşik kullanır. Karıştırılmaz.' },
    STT_PATH_LABEL[normalizePath(s.path)],
  ));

  f.push(observed({ id: 'sttSessionActive', label: 'yakalama oturumu açık', source: SRC.native,
    note: 'Kapalıysa gösterilen değerler SON oturumun ölçümleridir (silinmez — yoksa hiçbir şey gözlemlenemez).' },
    s.sessionActive));

  f.push(s.sessionStartedAt !== null
    ? observed({ id: 'sttSessionStart', label: 'oturum başlangıcı', source: SRC.native,
        note: 'Duvar-saati damgası.', updatedAt: s.sessionStartedAt },
        new Date(s.sessionStartedAt).toISOString())
    : unavailable({ id: 'sttSessionStart', label: 'oturum başlangıcı', source: SRC.native, note: '' },
        'Hiç yakalama oturumu ölçülmedi.'));

  return { id: 'status', title: STT_SECTION_TITLE.status, fields: _bound(f) };
}

/* ── Ses kaynağı ──────────────────────────────────────────────────────────── */

function _sourceSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const src = s.source;

  if (!src) {
    f.push(unavailable({ id: 'sttSource', label: 'ses kaynağı', source: SRC.native, note: '' },
      'Native gözlem yok — "kaynak yok" VARSAYILMAZ.'));
    return { id: 'source', title: STT_SECTION_TITLE.source, fields: _bound(f) };
  }

  f.push(src.selectedSource >= 0
    ? observed({ id: 'sttSelectedSource', label: 'seçilen AudioSource', source: SRC.native,
        note: 'openBestMicRecorder\'ın GERÇEKTEN kayda başlattığı kaynak. Bu ekran seçimi DEĞİŞTİREMEZ.' },
        `${src.selectedSourceName} (${src.selectedSource})`)
    : unavailable({ id: 'sttSelectedSource', label: 'seçilen AudioSource', source: SRC.native, note: '' },
        'Hiç kaynak seçilmedi — varsayılan UYDURULMAZ.'));

  const attempts = src.attempts.slice(0, MAX_SOURCE_ATTEMPTS);
  f.push(attempts.length > 0
    ? observed({ id: 'sttAttemptCount', label: 'denenen kaynak adedi', source: SRC.native,
        note: `Bounded (azami ${MAX_SOURCE_ATTEMPTS}). Deneme sırası kodda sabittir; bu ekran prob TETİKLEMEZ.` },
        attempts.length)
    : unavailable({ id: 'sttAttemptCount', label: 'denenen kaynak adedi', source: SRC.native, note: '' },
        'Deneme kaydı yok.'));

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    f.push(observed(
      { id: `sttAttempt${i}`, label: `deneme ${i + 1}`, source: SRC.native,
        note: 'SİNYAL YOK = kaynak init oldu ama sıfır/ölü ses okudu (Duster sahası). Bu bir DONANIM gerçeğidir.' },
      `${a.sourceName} (${a.source}) → ${STT_ATTEMPT_LABEL[normalizeAttempt(a.outcome)]}`,
    ));
  }

  f.push(src.sampleRate > 0
    ? observed({ id: 'sttSampleRate', label: 'örnekleme hızı (Hz)', source: SRC.native, note: 'Gerçek AudioRecord parametresi.' },
        src.sampleRate)
    : unavailable({ id: 'sttSampleRate', label: 'örnekleme hızı (Hz)', source: SRC.native, note: '' }, 'Okunamadı.'));

  f.push(src.channelCount > 0
    ? observed({ id: 'sttChannels', label: 'kanal sayısı', source: SRC.native, note: 'CHANNEL_IN_MONO = 1.' },
        src.channelCount)
    : unavailable({ id: 'sttChannels', label: 'kanal sayısı', source: SRC.native, note: '' }, 'Okunamadı.'));

  f.push(src.bufferBytes > 0
    ? observed({ id: 'sttBufferBytes', label: 'AudioRecord buffer (bayt)', source: SRC.native,
        note: 'getMinBufferSize\'dan türeyen gerçek ayırma.' }, src.bufferBytes)
    : unavailable({ id: 'sttBufferBytes', label: 'AudioRecord buffer (bayt)', source: SRC.native, note: '' }, 'Okunamadı.'));

  f.push(src.frameSamples > 0
    ? observed({ id: 'sttFrameSamples', label: 'okuma penceresi (örnek)', source: SRC.native,
        note: 'Bir read() çağrısında istenen 16-bit örnek adedi.' }, src.frameSamples)
    : unavailable({ id: 'sttFrameSamples', label: 'okuma penceresi (örnek)', source: SRC.native, note: '' }, 'Okunamadı.'));

  return { id: 'source', title: STT_SECTION_TITLE.source, fields: _bound(f) };
}

/* ── Efektler ─────────────────────────────────────────────────────────────── */

function _effectTriplet(
  f: InspectorField[], prefix: string, label: string,
  available: boolean, created: boolean, enabled: boolean,
): void {
  f.push(observed({ id: `${prefix}Available`, label: `${label} mevcut`, source: SRC.native,
    note: 'isAvailable(). MEVCUT olması OLUŞTURULDU demek DEĞİLDİR.' }, available));
  f.push(observed({ id: `${prefix}Created`, label: `${label} oluşturuldu`, source: SRC.native,
    note: 'create(sessionId) null dönmedi mi. OLUŞTURULDU olması ETKİN demek DEĞİLDİR.' }, created));
  f.push(observed({ id: `${prefix}Enabled`, label: `${label} etkin`, source: SRC.native,
    note: 'getEnabled() — GERÇEK durum; okunamazsa false (uydurma yok). Bu ekran efekt AÇIP KAPATAMAZ.' }, enabled));
}

function _effectsSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const fx = s.effects;

  if (!fx) {
    f.push(unavailable({ id: 'sttEffects', label: 'ses efektleri', source: SRC.native, note: '' },
      'Native gözlem yok — "efekt yok" VARSAYILMAZ.'));
    return { id: 'effects', title: STT_SECTION_TITLE.effects, fields: _bound(f) };
  }

  f.push(observed({ id: 'sttEffectsProbed', label: 'efekt kurulumu çalıştı', source: SRC.native,
    note: 'Wake yolu efekt KURMAZ (bilinçli) — o yolda bu alan false kalır ve üç efekt de false görünür. Bu bir HATA DEĞİLDİR.' },
    fx.probed));

  _effectTriplet(f, 'sttAec', 'AcousticEchoCanceler', fx.aecAvailable, fx.aecCreated, fx.aecEnabled);
  _effectTriplet(f, 'sttNs',  'NoiseSuppressor',      fx.nsAvailable,  fx.nsCreated,  fx.nsEnabled);
  _effectTriplet(f, 'sttAgc', 'AutomaticGainControl', fx.agcAvailable, fx.agcCreated, fx.agcEnabled);

  f.push(fx.errors.length > 0
    ? observed({ id: 'sttEffectErrors', label: 'efekt hata kodları', source: SRC.native,
        note: 'GİZLİLİK: yalnız bounded KOD. Ham exception metni, mesajı ve yığın izi TAŞINMAZ.' },
        fx.errors.join(' · '))
    : observed({ id: 'sttEffectErrors', label: 'efekt hata kodları', source: SRC.native,
        note: 'Kayıtlı bounded hata kodu yok.' }, 'YOK'));

  return { id: 'effects', title: STT_SECTION_TITLE.effects, fields: _bound(f) };
}

/* ── VAD / gürültü ────────────────────────────────────────────────────────── */

function _vadSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const v = s.vad;

  if (!v || !v.present) {
    f.push(unavailable({ id: 'sttVad', label: 'VAD ölçümü', source: SRC.native, note: '' },
      'Hiç ses penceresi ölçülmedi — 0 RMS / 0 eşik GÖSTERİLMEZ.'));
    return { id: 'vad', title: STT_SECTION_TITLE.vad, fields: _bound(f) };
  }

  f.push(v.lastRms >= 0
    ? observed({ id: 'sttLastRms', label: 'anlık RMS (normalize)', source: SRC.native,
        note: 'Yazılım kazancı UYGULANDIKTAN sonraki 0..1 skaler. Ham ses SAKLANMAZ.' }, fmtRms(v.lastRms))
    : unavailable({ id: 'sttLastRms', label: 'anlık RMS (normalize)', source: SRC.native, note: '' },
        'Ölçüm yok.'));

  f.push(v.noiseFloor >= 0
    ? observed({ id: 'sttNoiseFloor', label: 'öğrenilmiş gürültü tabanı', source: SRC.native,
        note: 'Aktif dinlemede ilk 4 pencereden (~1sn) öğrenilir. Wake yolunda taban ÖĞRENİLMEZ.' },
        fmtRms(v.noiseFloor))
    : unavailable({ id: 'sttNoiseFloor', label: 'öğrenilmiş gürültü tabanı', source: SRC.native, note: '' },
        'ÖĞRENİLMEDİ — 0 taban UYDURULMAZ (wake yolu veya taban penceresi dolmadı).'));

  f.push(v.effectiveThreshold >= 0
    ? observed({ id: 'sttThreshold', label: 'kullanılan gerçek VAD eşiği', source: SRC.native,
        note: 'Son karede FİİLEN kıyaslanan eşik. Aktif dinleme: max(taban×çarpan, alt eşik). Wake: sabit.' },
        fmtRms(v.effectiveThreshold))
    : unavailable({ id: 'sttThreshold', label: 'kullanılan gerçek VAD eşiği', source: SRC.native, note: '' },
        'Henüz eşik uygulanmadı (taban öğrenme penceresi).'));

  f.push(v.staticMinThreshold >= 0
    ? observed({ id: 'sttStaticThreshold', label: 'statik alt eşik', source: SRC.native,
        note: 'Kod sabiti. Bu ekran eşiği DEĞİŞTİREMEZ.' }, fmtRms(v.staticMinThreshold))
    : unavailable({ id: 'sttStaticThreshold', label: 'statik alt eşik', source: SRC.native, note: '' },
        'Bu yolda uygulanmaz.'));

  f.push(v.floorFactor >= 0
    ? observed({ id: 'sttFloorFactor', label: 'taban çarpanı', source: SRC.native,
        note: 'Kod sabiti (taban × çarpan). Yalnız aktif dinleme yolunda uygulanır.' }, v.floorFactor)
    : unavailable({ id: 'sttFloorFactor', label: 'taban çarpanı', source: SRC.native, note: '' },
        'Bu yolda uygulanmaz (wake eşiği sabittir).'));

  f.push(observed({ id: 'sttSpeechDetected', label: 'konuşma algılandı', source: SRC.native,
    note: 'Son karede RMS ≥ eşik miydi. Tanıma BAŞARISI demek DEĞİLDİR.' },
    v.speechDetected ? 'VAR' : 'YOK'));

  /* Yaş: monotonic eksende türetilir (duvar saati atlamaları etkilemez). */
  const age = v.lastAudioAtMs > 0 && v.monotonicNowMs > 0
    ? Math.max(0, v.monotonicNowMs - v.lastAudioAtMs)
    : null;
  f.push(age !== null
    ? derived({ id: 'sttAudioAge', label: 'son ses paketi yaşı (ms)', source: SRC.native,
        note: 'KURAL: monotonic (elapsedRealtime) fark — saat atlaması bozamaz. Yakalama kapalıyken büyür.' }, age)
    : unavailable({ id: 'sttAudioAge', label: 'son ses paketi yaşı (ms)', source: SRC.native, note: '' },
        'Hiç ses paketi okunmadı — 0 ms GÖSTERİLMEZ.'));

  const stats = computeRmsStats(v.samples);
  f.push(stats
    ? observed({ id: 'sttRmsStats', label: `RMS özeti (son ${stats.count} örnek)`, source: SRC.native,
        note: `min / p50 / ort / p95 / max. Yüzdelik en-yakın-sıra ile — dönen değer GERÇEKTEN ölçülmüş bir örnektir. Halka bounded (azami ${MAX_RMS_SAMPLES}).` },
        `${fmtRms(stats.min)} / ${fmtRms(stats.p50)} / ${fmtRms(stats.avg)} / ${fmtRms(stats.p95)} / ${fmtRms(stats.max)}`)
    : unavailable({ id: 'sttRmsStats', label: 'RMS özeti', source: SRC.native, note: '' },
        'Örnek yok — sahte istatistik ÜRETİLMEZ.'));

  f.push(observed({ id: 'sttRmsTotal', label: 'toplam ölçülen pencere', source: SRC.native,
    note: 'Oturum boyunca halkaya düşen toplam kare (saturating). Halka yalnız son ' + MAX_RMS_SAMPLES + ' örneği tutar.' },
    v.sampleCount));

  return { id: 'vad', title: STT_SECTION_TITLE.vad, fields: _bound(f) };
}

/* ── Araç bağlamı ─────────────────────────────────────────────────────────── */

function _vehicleSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const v = s.vehicle;

  if (!v) {
    f.push(unavailable({ id: 'sttVehicle', label: 'araç bağlamı', source: SRC.vehicle, note: '' },
      'Araç bağlamı okunamadı — "park halinde" VARSAYILMAZ.'));
    return { id: 'vehicle', title: STT_SECTION_TITLE.vehicle, fields: _bound(f) };
  }

  f.push(v.speedKmh !== null
    ? observed({ id: 'sttSpeed', label: 'hız (km/s)', source: SRC.vehicle,
        note: 'OBD hızı, yoksa GPS Doppler. Kanıt yoksa BİLİNMİYOR — 0 km/s YAZILMAZ.', updatedAt: v.sampledAt },
        v.speedKmh)
    : unavailable({ id: 'sttSpeed', label: 'hız (km/s)', source: SRC.vehicle, note: '' },
        'BİLİNMİYOR — hız kanıtı yok. 0 km/s GÖSTERİLMEZ (durduğu anlamına gelmez).'));

  f.push(observed({ id: 'sttMotion', label: 'hareket durumu', source: SRC.vehicle,
    note: 'Üç durumlu: BİLİNMİYOR asla DURUYOR\'a indirgenmez.', updatedAt: v.sampledAt },
    STT_MOTION_LABEL[normalizeMotion(v.motionState)]));

  f.push(v.hvacFanLevel !== null
    ? observed({ id: 'sttFan', label: 'klima/fan seviyesi', source: SRC.vehicle, note: 'Gerçek ölçüm.' },
        v.hvacFanLevel)
    : unavailable({ id: 'sttFan', label: 'klima/fan seviyesi', source: SRC.none, note: '' },
        'KAYNAK YOK — repoda fan/HVAC seviyesi okuyan bir sağlayıcı YOKTUR. Saha ölçümünde fan durumu ELLE not edilmelidir.'));

  /* Eş-zamanlılık dürüstlüğü: hız ile gürültü tabanı AYNI okuma turunda alınır,
     ama native snapshot damgası ile JS örnekleme damgası arasında küçük bir fark
     olabilir. Bu fark GİZLENMEZ — ölçümün karşılaştırılabilirliği buna bağlıdır. */
  f.push(s.capturedAt !== null
    ? derived({ id: 'sttSampleSkew', label: 'örnekleme sapması (ms)', source: 'model kuralı',
        note: 'KURAL: |araç örnekleme damgası − native gözlem damgası|. Büyükse hız ve gürültü ölçümü AYNI ANA ait değildir → karşılaştırma yapılmaz.' },
        Math.abs(v.sampledAt - s.capturedAt))
    : unavailable({ id: 'sttSampleSkew', label: 'örnekleme sapması (ms)', source: 'model kuralı', note: '' },
        'Native damga yok — sapma hesaplanamaz.'));

  f.push(derived({ id: 'sttNoCausality', label: 'nedensellik çıkarımı', source: 'model kuralı',
    note: 'KURAL: hız ↔ gürültü arasında hiçbir neden-sonuç hükmü ÜRETİLMEZ. İki ölçüm yan yana gösterilir; ilişki ancak saha kütüğündeki tekrarlı ölçümle kurulur.' },
    'YAPILMADI (yalnız ölçüm)'));

  return { id: 'vehicle', title: STT_SECTION_TITLE.vehicle, fields: _bound(f) };
}

/* ── STT durumu ───────────────────────────────────────────────────────────── */

function _engineSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const e = s.stt;
  const js = s.js;

  if (!e) {
    f.push(unavailable({ id: 'sttEngine', label: 'STT motor durumu', source: SRC.native, note: '' },
      'Native gözlem yok.'));
  } else {
    f.push(observed({ id: 'sttWakeActive', label: 'wake-word motoru aktif (native)', source: SRC.native,
      note: 'Native grammar thread\'inin KENDİ gerçeği — JS niyeti DEĞİL. Bu ekran motoru başlatmaz/durdurmaz.' },
      e.wakeEngineActive));

    f.push(observed({ id: 'sttRecognizerActive', label: 'ana Vosk recognizer aktif', source: SRC.native,
      note: 'Aktif dinleme yakalama döngüsü çalışıyor mu.' }, e.activeRecognizerActive));

    f.push(observed({ id: 'sttGrammarType', label: 'kullanılan grammar tipi', source: SRC.native,
      note: 'Grammar KURULAMAZSA native full-vocab\'a düşer ve burada free görünür — niyet değil GERÇEK gösterilir.' },
      STT_GRAMMAR_LABEL[normalizeGrammar(e.grammarType)]));

    f.push(e.grammarWordCount >= 0
      ? observed({ id: 'sttGrammarWords', label: 'grammar kelime adedi', source: SRC.native,
          note: 'GİZLİLİK: yalnız ADET — kelimelerin KENDİSİ (wake sözcüğü dahil) GÖSTERİLMEZ.' },
          e.grammarWordCount)
      : unavailable({ id: 'sttGrammarWords', label: 'grammar kelime adedi', source: SRC.native, note: '' },
          'Grammar yok (full-vocab) — 0 kelime GÖSTERİLMEZ.'));

    const res = normalizeResult(e.lastResultCategory);
    f.push(res !== null
      ? observed({ id: 'sttLastResult', label: 'son tanıma sonucu', source: SRC.native,
          note: 'GİZLİLİK: yalnız KATEGORİ. Transcript ve n-best metni bu ekrana HİÇ GELMEZ.',
          updatedAt: e.lastResultAt > 0 ? e.lastResultAt : null },
          STT_RESULT_LABEL[res])
      : unavailable({ id: 'sttLastResult', label: 'son tanıma sonucu', source: SRC.native, note: '' },
          'Hiç sonuç kaydı yok — "başarılı" VARSAYILMAZ.'));
  }

  if (!js) {
    f.push(unavailable({ id: 'sttJs', label: 'JS ses servisi durumu', source: SRC.js, note: '' },
      'JS getter\'ları okunamadı.'));
  } else {
    f.push(observed({ id: 'sttWakeEnabled', label: 'wake-word JS tarafında açık', source: SRC.js,
      note: 'JS NİYETİ. Native motorun gerçekten çalışıp çalışmadığı yukarıdaki native alandır — ikisi ÇELİŞEBİLİR.' },
      js.wakeEnabled));
    f.push(observed({ id: 'sttWakeStatus', label: 'wake-word JS durumu', source: SRC.js,
      note: 'disabled | idle | listening | detected | error.' }, js.wakeStatus));
    f.push(observed({ id: 'sttWakePhrases', label: 'wake sözcüğü adedi', source: SRC.js,
      note: 'GİZLİLİK: yalnız ADET — asistan adı / özel wake cümlesi GÖSTERİLMEZ.' }, js.wakePhraseCount));
    f.push(observed({ id: 'sttWakeRearmCount', label: 'wake periyodik yeniden kurulum', source: SRC.js,
      note: 'CANLILIK ÖLÇÜLMÜYOR: native yalnız tetik anını yayınlar, "ayakta ama duymadı" ile "öldü" '
          + 'ayırt edilemez. Bu yüzden kurulum koşulsuz ve periyodiktir — arıza sayacı DEĞİLDİR.' },
      js.wakeRearmCount));
    f.push(observed({ id: 'sttWakeRecorderState', label: 'wake recorder lifecycle', source: SRC.js,
      note: 'Tek native owner bildirir: STARTING | ACTIVE | PAUSED_FOR_SESSION | RECOVERING | STOPPED | FAILED. '
          + 'UNAVAILABLE eski APK/ölçüm yok demektir.' }, js.wakeRecorderState ?? 'UNAVAILABLE'));
    f.push(observed({ id: 'sttWakeRecoveryCount', label: 'wake bounded recovery', source: SRC.js,
      note: 'Native FAILED sonrası aynı owner üzerinden istenen sınırlı yeniden kurulum sayısı.' },
      js.wakeRecoveryCount ?? -1));
    f.push(observed({ id: 'sttWakePrevWindow', label: 'önceki pencerede kabul edilen wake', source: SRC.js,
      note: 'Kurulumlar arasında 0 kalıyorsa periyodik re-arm gereksiz maliyettir; >0 ise gerekli. '
          + `Pencere ${js.wakeRearmIntervalMs} ms.` }, js.wakeWakesInPrevWindow));
    /* Ham anlık görüntü SINIRIDIR: eski/kısmi bir snapshot bu alanları hiç
       taşımayabilir. Eksik alan "0" değil "ÖLÇÜM YOK"tur → savunmacı okunur. */
    const _wf = {
      liveness: js.wakeLivenessMeasured === true,
      counts:   js.wakeDecisionCounts ?? {},
      total:    typeof js.wakeDecisionTotal === 'number' ? js.wakeDecisionTotal : -1,
      evicted:  typeof js.wakeDecisionEvicted === 'number' ? js.wakeDecisionEvicted : -1,
      intent:   typeof js.wakeIntentReached === 'number' ? js.wakeIntentReached : -1,
      noIntent: typeof js.wakeAcceptedNoIntent === 'number' ? js.wakeAcceptedNoIntent : -1,
      pending:  typeof js.wakePendingAcceptAgeMs === 'number' ? js.wakePendingAcceptAgeMs : null,
      recent:   Array.isArray(js.wakeRecentDecisions) ? js.wakeRecentDecisions : [],
    };

    f.push(observed({ id: 'sttWakeLiveness', label: 'wake canlılığı ÖLÇÜLÜYOR mu', source: SRC.js,
      note: 'FALSE ise yukarıdaki yeniden kurulum sayısı bir ARIZA GÖSTERGESİ DEĞİLDİR — '
          + 'periyodik ve koşulsuzdur. "self-heal" olarak yorumlanmamalıdır.' },
      _wf.liveness));

    f.push(observed({ id: 'sttVoiceStatus', label: 'ses asistanı durumu', source: SRC.js,
      note: 'voiceService durum makinesi.' }, js.voiceStatus));
    f.push(observed({ id: 'sttMicAvailable', label: 'mikrofon kullanılabilir (JS)', source: SRC.js,
      note: 'JS tarafının bildiği kullanılabilirlik — donanım kanıtı DEĞİLDİR (bkz. kaynak denemeleri).' },
      js.micAvailable));
    f.push(js.commandGrammarWordCount >= 0
      ? observed({ id: 'sttCmdGrammarWords', label: 'offline komut sözlüğü adedi', source: SRC.js,
          note: 'buildCommandGrammar() uzunluğu — yalnız ADET, kelimeler GÖSTERİLMEZ. Yalnız internetsizken native\'e geçer.' },
          js.commandGrammarWordCount)
      : unavailable({ id: 'sttCmdGrammarWords', label: 'offline komut sözlüğü adedi', source: SRC.js, note: '' },
          'Okunamadı.'));
  }

  /* MAVI-STT-CONTEXT-GRAMMAR — bağlama göre daraltılan sözlüğün gözlemi. */
  const g = s.grammar;
  if (!g) {
    f.push(unavailable({ id: 'sttCtxGrammar', label: 'bağlam grameri', source: SRC.grammar, note: '' },
      'Gramer tanı yüzeyi okunamadı.'));
  } else {
    f.push(observed({ id: 'sttGrammarClass', label: 'aktif grammar sınıfı', source: SRC.grammar,
      note: 'Son ÇÖZÜLEN sınıf. Öncelik: confirmation > navigasyon > medya > araç > general. Kanıt yoksa TAHMİN YAPILMAZ → general.' },
      g.grammarClass));
    f.push(g.grammarEntryCount > 0
      ? observed({ id: 'sttGrammarEntries', label: 'grammar girdi adedi', source: SRC.grammar,
          note: 'GİZLİLİK: yalnız ADET — sözcüklerin KENDİSİ hiçbir koşulda gösterilmez. `[unk]` dahildir.' },
          g.grammarEntryCount)
      : unavailable({ id: 'sttGrammarEntries', label: 'grammar girdi adedi', source: SRC.grammar, note: '' },
          'Henüz gramer uygulanmadı veya çevrimiçi tam dikte yolundayız.'));
    f.push(observed({ id: 'sttGrammarReason', label: 'son geçiş nedeni', source: SRC.grammar,
      note: 'Sabit gerekçe kodu — serbest metin YOK.' }, g.lastReason));
    /* Sağlayıcılar bağlı değilse sınıf HER ZAMAN general olur; bunu "bağlam yok"
       gibi göstermek yanıltıcı olurdu → ayrı ve açık satır. */
    f.push(g.providersWired
      ? observed({ id: 'sttGrammarProviders', label: 'bağlam sağlayıcıları', source: SRC.grammar,
          note: 'Navigasyon/medya/araç getter\'ları boot (SystemBoot Wave 2) tarafından bağlandı.' },
          'BAĞLI')
      : unavailable({ id: 'sttGrammarProviders', label: 'bağlam sağlayıcıları', source: SRC.grammar, note: '' },
          'Bağlanmadı — bağlam OKUNAMIYOR (yokluk DEĞİL); gramer tam sözlükte kalır.'));
    f.push(observed({ id: 'sttGrammarTransitions', label: 'toplam grammar geçişi', source: SRC.grammar,
      note: 'AYNI gramer tekrar çözülürse geçiş SAYILMAZ (dedup). Sayaç doyar.' },
      g.transitionCount));
    f.push(observed({ id: 'sttGrammarFallback', label: 'genele düşüş adedi', source: SRC.grammar,
      note: 'Bağlam kanıtı yok / kaynak okunamadı / gramer kurulamadı → tam sözlük.' },
      g.fallbackGeneralCount));
    f.push(observed({ id: 'sttGrammarApplyFail', label: 'gramer kurulum hatası', source: SRC.grammar,
      note: 'Sözlük üretilemedi. Hata mikrofon veya wake zincirini KAPATMAZ — genele düşülür.' },
      g.grammarApplyFailureCount));
    f.push(g.pendingConfirmation === null
      ? unavailable({ id: 'sttGrammarPending', label: 'bekleyen onay', source: SRC.grammar, note: '' },
          'Onay kaynağı okunamadı — "bekleyen yok" VARSAYILMAZ.')
      : observed({ id: 'sttGrammarPending', label: 'bekleyen onay', source: SRC.grammar,
          note: 'M4 tek otoritesinden MUTASYONSUZ okunur (peek DEĞİL — o süresi dolmuş isteği siler).' },
          g.pendingConfirmation ? 'VAR' : 'YOK'));
    if (g.countersSaturated) {
      f.push(derived({ id: 'sttGrammarSat', label: 'sayaçlar doydu', source: 'model kuralı',
        note: 'KURAL: tavana ulaşan sayaç ARTIK GERÇEK ADET DEĞİLDİR.' }, 'EVET'));
    }
  }

  return { id: 'engine', title: STT_SECTION_TITLE.engine, fields: _bound(f) };
}

/* ── Kısıtlamalar (sabit beyan — statik testle kilitli) ───────────────────── */

/* 6 - Wake Karari (kendi bolumu).
 *
 * NEDEN AYRI: "STT Durumu" bolumu 24 alan tavanina (`_bound`) dayandigi icin
 * buraya eklenen SON satirlar SESSIZCE KIRPILIYORDU - guven satirlari sahada
 * ekranda hic gorunmedi. Tavani yukseltmek diger bolumleri korumasiz birakirdi;
 * dogru cozum ayri bolumdur. Icerik AYNEN tasindi, yeni alan EKLENMEDI. */
function _wakeSection(s: SttMicRaw): SttSection {
  const f: InspectorField[] = [];
  const js = s.js;
  if (js) {
    const _wf = {
      liveness: js.wakeLivenessMeasured === true,
      counts:   js.wakeDecisionCounts ?? {},
      total:    typeof js.wakeDecisionTotal === 'number' ? js.wakeDecisionTotal : -1,
      evicted:  typeof js.wakeDecisionEvicted === 'number' ? js.wakeDecisionEvicted : -1,
      intent:   typeof js.wakeIntentReached === 'number' ? js.wakeIntentReached : -1,
      noIntent: typeof js.wakeAcceptedNoIntent === 'number' ? js.wakeAcceptedNoIntent : -1,
      pending:  typeof js.wakePendingAcceptAgeMs === 'number' ? js.wakePendingAcceptAgeMs : null,
      recent:   Array.isArray(js.wakeRecentDecisions) ? js.wakeRecentDecisions : [],
    };
    /* ── WAKE KARAR DEFTERİ ─────────────────────────────────────────────
     * "Hey Mavi dedim uyanmadı" ile "kendiliğinden uyandı" şikâyetlerinin
     * ayrıştığı yer. Kabul edilenler zaten sayılıyordu; bu satırlar
     * REDDEDİLEN ve BASTIRILAN kararları da görünür kılar. */
    f.push(_wf.total < 0
      ? unavailable({ id: 'sttWakeDecisionTotal', label: 'wake kararı (toplam)', source: SRC.js, note: '' },
          'Karar defteri okunamadı.')
      : observed({ id: 'sttWakeDecisionTotal', label: 'wake kararı (toplam)', source: SRC.js,
          note: 'Deftere düşen tüm kararlar — halkadan taşanlar DAHİL. 0 ise wake motoru hiç karar üretmemiştir.' },
          _wf.total));
    f.push(observed({ id: 'sttWakeDecisionCounts', label: 'gerekçe dağılımı', source: SRC.js,
      note: 'ACCEPTED · REJECTED_TOKEN · SUPPRESSED_* · NOT_EVALUATED_MODEL_NOT_READY. '
          + 'SUPPRESSED_* yüksekse motor SAĞIR DEĞİL, tetik BASTIRILIYOR demektir.' },
      _countsLine(_wf.counts)));
    f.push(_wf.intent < 0
      ? unavailable({ id: 'sttWakeIntent', label: 'kabul → komut', source: SRC.js, note: '' },
          'Korelasyon okunamadı.')
      : observed({ id: 'sttWakeIntent', label: 'kabul → komut', source: SRC.js,
          note: 'Kabul edilen tetiğin gerçekten komuta dönüşüp dönüşmediği. İkinci sayı yüksekse '
              + 'wake çalışıyor ama komut alınamıyordur (ayrı kusur).' },
          `${_wf.intent} komut / ${_wf.noIntent} komutsuz`));
    f.push(_wf.pending === null
      ? observed({ id: 'sttWakePending', label: 'bekleyen kabul', source: SRC.js,
          note: 'Kabul edilmiş ama henüz komuta dönüşmemiş tetik.' }, 'yok')
      : observed({ id: 'sttWakePending', label: 'bekleyen kabul', source: SRC.js,
          note: 'Kabul edilmiş ama henüz komuta dönüşmemiş tetik.' },
          `${Math.round(_wf.pending / 1000)} sn`));
    f.push(_wf.evicted < 0
      ? unavailable({ id: 'sttWakeEvicted', label: 'halkadan düşen karar', source: SRC.js, note: '' },
          'Okunamadı.')
      : observed({ id: 'sttWakeEvicted', label: 'halkadan düşen karar', source: SRC.js,
          note: 'Defter 64 kayıtla sınırlıdır; taşan en eski kayıtlar düşer (kayıp GÖRÜNÜR olsun diye sayılır).' },
          _wf.evicted));
    f.push(_wf.recent.length === 0
      ? unavailable({ id: 'sttWakeRecent', label: 'son kararlar', source: SRC.js, note: '' },
          'Henüz karar kaydı yok.')
      : observed({ id: 'sttWakeRecent', label: 'son kararlar (yeni → eski)', source: SRC.js,
          note: 'GİZLİLİK: duyulan ham metin ve ses TAŞINMAZ — yalnız gerekçe, yol ve türetilmiş sayılar. '
              + 'k=kelime sayısı · i=eşleşme indeksi (0 = cümle başı) · ÇIPLAK=tek kelimelik ad · ALT=n-best alternatifi.' },
          _wf.recent.map(_decisionLine).join('  |  ')));

    /* ── NATIVE WAKE SAYAÇLARI (şema 2) ─────────────────────────────────
     * JS'in GÖREMEDİĞİ üç karar: mikrofon hiç açılmadı · VAD decode'u atladı ·
     * çözüldü ama eşleşmedi. Eski APK'da (şema 1) blok HİÇ GELMEZ → sahte `0`
     * yerine dürüstçe KAYNAK YOK gösterilir. */
    const wn = s.wakeNative ?? null;
    if (!wn) {
      f.push(unavailable({ id: 'sttWakeNative', label: 'native wake sayaçları', source: SRC.native,
        note: 'Bu APK şema 1\'dir; native wake kararları ölçülmüyor. Şema 2 APK\'sı gerekir.' },
        'Ölçüm yok (eski şema).'));
    } else {
      f.push(observed({ id: 'sttWakeNativeYield', label: 'mikrofon hiç açılmadı (yield)', source: SRC.native,
        note: 'TTS konuşurken / aktif STT varken / bekleyen çağrıda wake mikrofonu AÇILMAZ. '
            + 'Yüksekse motor sağır değil, KAPI kapalıdır — bu JS\'ten görülemez.' },
        wn.yieldCount));
      f.push(observed({ id: 'sttWakeNativeVad', label: 'VAD atladı / decode edildi', source: SRC.native,
        note: 'Eşik altı çerçeve decode EDİLMEZ. Atlama payı çok yüksekse uzak/alçak sesli '
            + '"Hey Mavi" burada ölüyor olabilir (eşik bu turda DEĞİŞTİRİLMEDİ).' },
        `${wn.vadSkipFrames} / ${wn.decodeFrames}`));
      f.push(observed({ id: 'sttWakeNativeNoMatch', label: 'çözüldü ama eşleşmedi', source: SRC.native,
        note: 'Grammar bir metin üretti ama wake sözü tutmadı — `[unk]` kapısının gerçekte '
            + 'ne kadar çalıştığını gösterir. Metin TAŞINMAZ, yalnız adet.' },
        wn.noMatchCount));
      f.push(observed({ id: 'sttWakeNativeTrigger', label: 'native tetik', source: SRC.native,
        note: 'Native\'in JS\'e gönderdiği tetik sayısı. JS defterindeki kabul+bastırma toplamıyla '
            + 'karşılaştırılır; ikisi ayrışırsa olay kaybı VARDIR.' },
        wn.triggerCount));
      f.push(wn.lastTriggerLatencyMs < 0
        ? unavailable({ id: 'sttWakeNativeLat', label: 'wake tetik gecikmesi', source: SRC.native, note: '' },
            'Henüz tetik ölçülmedi.')
        : observed({ id: 'sttWakeNativeLat', label: 'wake tetik gecikmesi', source: SRC.native,
            note: 'GERÇEK sessizlikten sonraki ilk konuşma çerçevesi → tetik. '
                + '⚠️ Gürültülü ortamda VAD penceresi hiç kapanmazsa bu sayı ŞİŞER; '
                + 'yorumlarken "VAD atladı" payına BAKILMALIDIR (atlama ~0 ise sayı güvenilmez).' },
            `${wn.lastTriggerLatencyMs} ms`));

      /* ── GÜVEN ÖLÇÜMÜ (şema 3) — KARARA GİRMEZ ────────────────────────
       * Wake kararı bugün SAF EŞLEŞMEDİR: "hey mavi" ile "hey market" aynı
       * metne çözülüyor ve ayıracak sayı YOK. Bu iki satır o sayının VAR
       * OLUP OLMADIĞINI ölçer — eşik EKLEMEZ, davranış DEĞİŞTİRMEZ. */
      f.push(observed({ id: 'sttWakeConfCap', label: 'güven skoru alınabiliyor mu', source: SRC.native,
        note: 'Vosk `setPartialWords`. HAYIR ise partial üzerinde güven eşiği KURULAMAZ — '
            + 'yanlış uyanmayı kesmenin tek yolu final sonuca geçmektir (gecikme bedeli).' },
        wn.partialWordsEnabled === true));
      f.push(typeof wn.lastMatchConfMilli !== 'number' || wn.lastMatchConfMilli < 0
        ? unavailable({ id: 'sttWakeConf', label: 'son eşleşmenin güveni', source: SRC.native, note: '' },
            'Güven yok / henüz eşleşme olmadı.')
        : observed({ id: 'sttWakeConf', label: 'son eşleşmenin güveni', source: SRC.native,
            note: 'DENEY: "Hey Mavi" ile "hey market" arka arkaya söylenip bu sayı KARŞILAŞTIRILIR. '
                + 'Ayrışıyorsa eşik kurulabilir; ayrışmıyorsa güven bu sorunu ÇÖZMEZ.' },
          `${(wn.lastMatchConfMilli / 1000).toFixed(3)}`));
    }
  }
  return { id: 'wake', title: STT_SECTION_TITLE.wake, fields: _bound(f) };
}

function _restrictionsSection(): SttSection {
  const mk = (id: string, label: string): InspectorField =>
    observed({ id, label, source: SRC.none, note: 'Kod ve statik testle kilitlenmiştir.' }, 'EVET');
  return {
    id: 'restrictions',
    title: STT_SECTION_TITLE.restrictions,
    fields: _bound([
      mk('sttRoRead',       'Salt-okunur gözlem'),
      mk('sttRoMic',        'Mikrofon BAŞLATILMADI / DURDURULMADI'),
      mk('sttRoThreshold',  'VAD eşiği DEĞİŞTİRİLMEDİ'),
      mk('sttRoSource',     'AudioSource seçimi DEĞİŞTİRİLMEDİ'),
      mk('sttRoEffects',    'AEC/NS/AGC aç-kapa YAPILMADI'),
      mk('sttRoEngine',     'Yeni STT motoru KURULMADI'),
      mk('sttRoAudio',      'Ham ses örneği SAKLANMADI / DIŞA AKTARILMADI'),
      mk('sttRoTranscript', 'Transcript ve n-best TAŞINMADI'),
      mk('sttRoStore',      'Yeni telemetri servisi / kalıcı depo KURULMADI'),
      mk('sttRoPoll',       'Otomatik yenileme VARSAYILAN KAPALI'),
    ]),
  };
}

export function buildSttSections(s: SttMicRaw): SttSection[] {
  if (!s) return [];
  return [
    _statusSection(s), _sourceSection(s), _effectsSection(s),
    _vadSection(s), _vehicleSection(s), _engineSection(s), _wakeSection(s),
    _restrictionsSection(),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rozet sayaçları
 * ════════════════════════════════════════════════════════════════════════ */

export function countBySttClass(sections: readonly SttSection[]): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(sections)) return out;
  for (const sec of sections) {
    if (!sec || !Array.isArray(sec.fields)) continue;
    for (const f of sec.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass]++;
    }
  }
  return out;
}
