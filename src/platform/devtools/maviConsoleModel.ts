/**
 * maviConsoleModel.ts — Mavi Konsolu'nun SAF modeli (Faz A7).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok.
 * Zaman gereken her yerde `readAt` (kaynak katmanının ölçtüğü tek damga) kullanılır.
 *
 * ── GİZLİLİK SÖZLEŞMESİ (YAPISAL) ──────────────────────────────────────────
 * Bu modelin GİRDİ tipinde (`MaviRawSnapshot`) transcript metni, `lastCommand`
 * nesnesi/metni, konuşma geçmişi (history) veya öneri METNİ TAŞIYAN HİÇBİR ALAN
 * YOKTUR. Taşınan tek şey VAR/YOK bayrakları ve ADET'lerdir. Yani "sızdırmamaya
 * dikkat etmek" gerekmez — sızdırmak TİP OLARAK mümkün değildir.
 * `transcriptLength` bir SAYIDIR (uzunluk), metin değildir; repo'nun kendi uzak
 * tanı sözleşmesi de tam olarak bunu taşır.
 *
 * ── SINIFLAR ────────────────────────────────────────────────────────────────
 * A3 (`sessionInspectorModel`) sözleşmesi AYNEN kullanılır — A4/A5/A6 ile aynı
 * gözlemlenebilirlik dili: OBSERVED · DERIVED · UNAVAILABLE · STALE.
 * Paralel bir sınıflandırma sistemi KURULMAZ.
 */

import {
  observed, derived, unavailable,
  type InspectorField, type Observability,
} from './sessionInspectorModel';
import { detectMaviAnomalies, type MaviAnomalyRecord } from './maviForensicModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Repo GERÇEĞİ — durum değerleri tahmin EDİLMEZ
 *
 * `voiceService.VoiceStatus` birliği REPODA şudur:
 *   'idle' | 'listening' | 'processing' | 'success' | 'error' | 'throttled'
 * Aşağıdaki kümeler bu birlikten TÜRETİLİR; uydurma durum eklenmez.
 * ════════════════════════════════════════════════════════════════════════ */

/** Mavi'nin GERÇEKTEN bir iş yürüttüğü durumlar. */
export const MAVI_ACTIVE_VOICE_STATUS: readonly string[] = ['listening', 'processing'];

/** Kaynaklar hazır ama iş yürümüyor — "bekleme" durumları. */
export const MAVI_WAITING_VOICE_STATUS: readonly string[] = ['idle', 'success'];

/**
 * Repoda TANIMLI tüm durumlar. `throttled` bilinçli olarak NE aktif NE bekleme
 * sayılır: kısıtlama altındaki bir asistanı "HAZIR" ilan etmek yanlış olurdu,
 * "ÇALIŞIYOR" ilan etmek de. Hüküm BİLİNMİYOR'a düşer ve gerekçesi yazılır.
 */
export const MAVI_KNOWN_VOICE_STATUS: readonly string[] = [
  'idle', 'listening', 'processing', 'success', 'error', 'throttled',
];

/** Ekranda gösterilecek azami tanı satırı (bounded — ham telemetri dökülmez). */
export const MAX_MAVI_DIAG_ROWS = 20;
/** Bölüm başına azami alan. */
export const MAX_FIELDS_PER_MAVI_SECTION = 24;
/** Hüküm gerekçesi tavanı. */
export const MAX_MAVI_REASONS = 8;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü — YAPISAL tip (servis importu YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Mavi yaşam döngüsü — YALNIZ bayrak ve adet.
 * `null` = kaynak okunamadı (sıfır DEĞİL).
 */
export interface MaviVoiceRaw {
  /** Ham durum dizesi. Bilinmeyen değer TAHMİN EDİLMEZ, olduğu gibi taşınır. */
  readonly status:          string;
  readonly micAvailable:    boolean;
  /** 0.0–1.0 arası anlık mikrofon seviyesi. */
  readonly volumeLevel:     number;
  readonly followUp:        boolean;
  readonly suggestionCount: number;
  readonly historyCount:    number;
  /** Komutun KENDİSİ değil — yalnız varlığı. */
  readonly hasLastCommand:  boolean;
  /** Transcript'in KENDİSİ değil — yalnız varlığı. */
  readonly hasTranscript:   boolean;
  /** Hata METNİ değil — yalnız varlığı (mesaj serbest metindir, taşınmaz). */
  readonly hasError:        boolean;
}

/** Tanı halkası satırı — repo alan adları (`at`, `atMs` DEĞİL). */
export interface MaviDiagRaw {
  /** Duvar-saati damgası (ms). Geçersiz/0 → null; "şimdi" UYDURULMAZ. */
  readonly at:               number | null;
  readonly stage:            string;
  /** Transcript UZUNLUĞU (sayı). Metin değildir. */
  readonly transcriptLength: number | null;
  readonly errorCode:        string | null;
  readonly route:            string | null;
  readonly intent:           string | null;
}

export interface MaviAiHealthRaw {
  readonly healthy:        boolean;
  readonly consecFails:    number;
  readonly consecTimeouts: number;
  /** Devrenin daha ne kadar açık kalacağı (ms). 0 = bloke değil. */
  readonly blockedForMs:   number;
}

/** Sağlayıcı soğumaları — AYRI TUTULUR, tek toplamda BİRLEŞTİRİLMEZ. */
export interface MaviQuotaRaw {
  readonly geminiCooldownMs: number;
  readonly groqCooldownMs:   number;
  readonly haikuCooldownMs:  number;
}

/**
 * Proaktif kritik arıza uyarısı motoru — YALNIZ adet + dedup ANAHTARI + süre.
 * Uyarı METNİ, arıza açıklaması ve verdict içeriği bu katmana HİÇ GELMEZ.
 */
export interface MaviProactiveRaw {
  readonly spokenCount:         number;
  readonly suppressedCount:     number;
  /** Son uyarının makine-okur kök-neden KODU (serbest metin DEĞİL). Yoksa null. */
  readonly lastAlertKey:        string | null;
  /** Aynı arıza için kalan susma penceresi (ms). 0 = pencere kapalı. */
  readonly debounceRemainingMs: number;
  /** Son susturmanın makine-okur gerekçesi ('debounce' · 'reverse_attention' …). */
  readonly lastSuppressReason:  string | null;
  /* ── Açıklanabilir karar (bounded · kaynağı yoksa null) ─────────────────── */
  readonly lastReasonCode:      string | null;
  /** Güven DEĞERİ — kaynağı yoksa null (sahte 0 DEĞİL). */
  readonly lastConfidence:      number | null;
  /** Değerin ÖLÇEĞİ. Repoda iki ölçek var (0-100 / 0-1) ve BİRLEŞTİRİLMEZ. */
  readonly lastConfidenceScale: string | null;
  /** Kısa sanitize açıklama. Model düşüncesi/ham prompt DEĞİL. */
  readonly lastReasonSummary:   string | null;
  /** Kararın üreticisi (rule | parser | llm | fallback). */
  readonly lastDecisionSource:  string | null;
  /** Olay izinde bu karara ait satır sayısı (gerçek trail kaynağından). */
  readonly trailRowCount:       number | null;
}

/**
 * MAVI-M6-LAB-SPEECH-COUNTERS — M6 seslendirme otoritesinin tur-içi defteri ve
 * bounded sayaçları. Hepsi PII'sizdir: seslendirilen METİN taşınmaz, yalnız
 * bayrak + adet + tur kimliği (süreç-içi sayaç) gelir.
 */
export interface MaviSpeechRaw {
  /** Konuşma defterinin izlediği tur (M5 `activeTurnId` ile karşılaştırılır). */
  readonly turnId:                    number;
  readonly answeredThisTurn:          boolean;
  readonly progressedThisTurn:        boolean;
  readonly spoken:                    number;
  readonly suppressedDuplicate:       number;
  /** MAVI-M6-LATE-SPEECH-GATE: eskimiş turlu geç konuşma reddi (GERÇEKTEN ölçülür). */
  readonly staleLateSpeechSuppressed: number;
}

/**
 * SAHA #1256-a · TTS MOTOR SONUÇ DEFTERİ — **"çağrı yapıldı" ≠ "ses duyuldu".**
 *
 * `spoken` sayacı yalnız "TTS'e çağrı gitti" der. 2026-09-04'te ölçülen arıza
 * (varsayılan TTS motoru HİÇ seçili değildi) tam olarak bu boşlukta saklandı.
 * Buradaki alanlar sesin duyulduğunu İDDİA ETMEZ — yalnız seslendirmenin hangi
 * yolla sonlandığını ve GERÇEK süresini taşır. Metin TAŞINMAZ (yalnız uzunluk).
 */
export interface MaviTtsEngineRaw {
  readonly requested:          number;
  readonly engineDone:         number;
  readonly engineError:        number;
  readonly noEngineReport:     number;
  readonly suspectInstantDone: number;
  readonly saturated:          boolean;
  /** Son seslendirmenin sonucu — `null` = henüz hiç seslendirme kapanmadı. */
  readonly lastCause:          string | null;
  readonly lastEvidence:       string | null;
  readonly lastTransport:      string | null;
  readonly lastDurationMs:     number | null;
  readonly lastMinPlausibleMs: number | null;
  readonly lastCharCount:      number | null;
}

/** M5 tur kapılarının bounded sayaçları (PII YOK — yalnız adet ve durum). */
export interface MaviTurnRaw {
  readonly activeTurnId:                number;
  readonly activeState:                 string;
  readonly turnsStarted:                number;
  readonly turnsCompleted:              number;
  readonly turnsSuperseded:             number;
  readonly staleProviderResultsDropped: number;
  readonly staleActionsPrevented:       number;
  readonly staleFeedbackSuppressed:     number;
  /** Tavan doldu → sayılar ARTIK GERÇEK ADET DEĞİLDİR (dürüstçe belirtilir). */
  readonly countersSaturated:           boolean;
}

/**
 * P0-MAVI-FORENSIC · gecikme özet kanıtı — `maviLatencyTrace`/`maviLatencyModel`in
 * ZATEN ürettiği istatistiği taşır (yeni ölçüm YOK, ikinci hesap YOK).
 */
export interface MaviLatencySlaClassRaw {
  readonly slaClass: string;
  readonly targetP95Ms: number | null;
  readonly p95Ms: number | null;
  readonly meetsTarget: boolean | null;
  readonly evidence: string;
}

export interface MaviLatencyRaw {
  readonly enabled: boolean;
  readonly traceCount: number;
  readonly completed: number;
  readonly verdict: string;
  readonly slaClasses: readonly MaviLatencySlaClassRaw[];
  readonly byOutcome: Readonly<Record<string, number>>;
  readonly byFirstAudio: Readonly<Record<string, number>>;
  readonly orphanMarks: number;
  readonly duplicateMarks: number;
  readonly invalidMarks: number;
}

/**
 * P0-MAVI-FORENSIC · eylem zinciri özeti — `maviActionTrace`in ZATEN tuttuğu
 * bounded halkanın sayaçları + halka TARANARAK türetilen tek anomali sayacı
 * (`dispatchWithoutResult`). İkinci bir depo KURULMAZ, var olan halka okunur.
 */
export interface MaviActionTraceRaw {
  readonly recorded: number;
  readonly dropped: number;
  readonly capacity: number;
  readonly saturated: boolean;
  /** `gate:allowed` yazıldı ama halkada eşlik eden `result` YOK — sessiz kayıp. */
  readonly dispatchWithoutResult: number;
  readonly byStage: Readonly<Record<string, number>>;
}

export interface MaviRawSnapshot {
  readonly readAt: number;
  readonly voice:    MaviVoiceRaw | null;
  /** `null` = halka OKUNAMADI · `[]` = halka GERÇEKTEN BOŞ (ikisi AYRI şeydir). */
  readonly diag:     readonly MaviDiagRaw[] | null;
  readonly aiHealth: MaviAiHealthRaw | null;
  readonly quota:    MaviQuotaRaw | null;
  readonly proactive: MaviProactiveRaw | null;
  readonly speech:   MaviSpeechRaw | null;
  /** SAHA #1256-a · TTS motor sonuç defteri. `null` = okunamadı. */
  readonly ttsEngine: MaviTtsEngineRaw | null;
  readonly turn:     MaviTurnRaw | null;
  /** MAVI-F8 · sürüş iş yükü tanısı. `null` = okunamadı. */
  readonly workload: MaviWorkloadRaw | null;
  /** MAVI-F9 · proaktif politika motoru tanısı. `null` = okunamadı. */
  readonly proactivePolicy: MaviProactivePolicyRaw | null;
  /** MAVI-F11 · kullanıcıya görünen yüzey durumu tanısı. `null` = okunamadı. */
  readonly surface: MaviSurfaceRaw | null;
  /** MAVI-F12 · barge-in / konuşma kontrolü tanısı. `null` = okunamadı. */
  readonly bargeIn: MaviBargeInRaw | null;
  /** MAVI-F13 · kanonik runtime konsolidasyon tanısı. `null` = okunamadı. */
  readonly runtime: MaviRuntimeRaw | null;
  /** Wake karar defteri (`recordWake` projeksiyonu). `null` = okunamadı. */
  readonly wakeForensics: MaviWakeForensicsRaw | null;
  /** P0-MAVI-FORENSIC · gecikme özeti (`maviLatencyTrace`). `null` = okunamadı. */
  readonly latency: MaviLatencyRaw | null;
  /** P0-MAVI-FORENSIC · eylem zinciri özeti (`maviActionTrace`). `null` = okunamadı. */
  readonly actionTrace: MaviActionTraceRaw | null;
}

/**
 * Wake tetiğinin AKIBETİ — bounded, PII'siz.
 *
 * NEDEN VAR: sahada (2026-09-03/04) native wake tetiği doğuyor ama Mavi
 * uyanmıyordu; `onWakeWordDetected` kararı kaydediyordu ama okunur yüzeyi
 * olmadığı için hangi kapının yuttuğu cihazda GÖRÜLEMİYORDU. Bu satırlar o
 * boşluğu kapatır — yeni ölçüm ÜRETMEZ, var olan defteri okur.
 *
 * GİZLİLİK: transkript METNİ taşınmaz (defter zaten tutmaz).
 */
export interface MaviWakeForensicsRaw {
  /** Gerekçe → adet. ACCEPTED · REJECTED_TOKEN · SUPPRESSED_* · NOT_EVALUATED_* */
  readonly counts: Readonly<Record<string, number>>;
  /** Kayıt toplamı (tampondan düşenler DAHİL). */
  readonly total: number;
  /** Tampon tavanı yüzünden düşen kayıt adedi. */
  readonly evicted: number;
  /** Kabul edilip GERÇEKTEN komuta dönüşen tetik adedi. */
  readonly intentReached: number;
  /** Kabul edildi ama komuta DÖNMEDİ (zaman aşımı dâhil) — sessiz kayıp. */
  readonly acceptedNoIntent: number;
  /** Bekleyen kabulün yaşı (ms). `null` = bekleyen YOK (0 ms ile karıştırılamaz). */
  readonly pendingAcceptAgeMs: number | null;
  /** En son kararın gerekçesi ve koştuğu yol. `null` = hiç kayıt yok. */
  readonly lastReason: string | null;
  readonly lastPath: string | null;
}

/**
 * MAVI-F11 · bounded yüzey satırı. Etiket METNİ, transkript, cevap içeriği ve
 * kullanıcı verisi TAŞINMAZ — yalnız bounded durum/sebep KODLARI ve ADET.
 */
export interface MaviSurfaceRaw {
  readonly transitions: number;
  readonly lastState: string | null;
  readonly lastReason: string | null;
  readonly lastMode: string | null;
  readonly lastDegraded: string;
  readonly states: Readonly<Record<string, number>>;
  readonly fullScreenBlocked: number;
  /** Wake ayarı AÇIK mı (presence'tan BAĞIMSIZ — F11). */
  readonly wakeWordEnabled: boolean;
  /** Yol Arkadaşı presence'ı AÇIK mı. */
  readonly companionPresence: boolean;
}

/**
 * MAVI-F9 · bounded proaktif politika satırı. Seslendirilen METİN, transcript,
 * konum ve kullanıcı içeriği TAŞINMAZ — yalnız SABİT kaynak kimlikleri, bounded
 * sebep kodları ve ADET.
 */
export interface MaviProactivePolicyRaw {
  readonly decisions: number;
  readonly admitted: number;
  readonly externalObserved: number;
  readonly interruptions: number;
  readonly lastAdmittedSourceId: string | null;
  readonly lastDropReason: string | null;
  readonly drops: Readonly<Record<string, number>>;
  readonly admittedBySource: Readonly<Record<string, number>>;
  readonly kinds: Readonly<Record<string, number>>;
  readonly hourlyVoiceUsed: number;
  readonly hourlyVoiceCeiling: number;
  readonly userSuppressed: readonly string[];
  readonly learnedSuppressed: readonly string[];
  /** Kabul oranı ölçülebiliyor mu — üretimde bugün HAYIR (sahte oran yasak). */
  readonly acceptRateMeasurable: boolean;
}

/**
 * MAVI-F12 · bounded barge-in / konuşma kontrolü satırı.
 *
 * GİZLİLİK: transkript, ham ses, cevap metni ve konuşulan içerik TAŞINMAZ —
 * yalnız SABİT sınıf/gerekçe kodları, adet ve milisaniye.
 */
export interface MaviBargeInRaw {
  readonly duplexClass: string;
  readonly captureOpenDuringTts: boolean;
  readonly aecCountsForDuplex: boolean;
  readonly echoReferenceWired: boolean;
  readonly proposals: number;
  readonly accepted: number;
  readonly lastReason: string | null;
  readonly reasons: Readonly<Record<string, number>>;
  readonly evidenceKinds: Readonly<Record<string, number>>;
  /** `-1` = ÖLÇÜM YOK (sahte `0` üretilmez). */
  readonly lastTtsStopRequestMs: number;
  readonly maxTtsStopRequestMs: number;
  readonly ttsStopSamples: number;
  readonly lastListenOpenMs: number;
  readonly maxListenOpenMs: number;
  readonly listenSamples: number;
  readonly countersSaturated: boolean;
}

/**
 * MAVI-F13 · bounded kanonik-runtime satırı.
 *
 * Komut metni, parametre, transkript ve eylem argümanı TAŞIMAZ — yalnız
 * bounded ADET ve BAYRAK. "Aktif yol" bir ÖLÇÜM DEĞİL, koddaki tek giriş
 * zincirinin BEYANIDIR ve alanı `derived` olarak işaretlenir.
 */
export interface MaviRuntimeRaw {
  /** Gölge köprü defterinde duran karar adedi. */
  readonly shadowDecisions: number;
  /** Bu kararlardan Mavi hattının GERÇEKTEN yürüttüğü adet (hedef: 0). */
  readonly maviExecutedDecisions: number;
  /** Hiçbir hattın yürütmediği (saf gözlem) karar adedi. */
  readonly noExecutionDecisions: number;
  /** Bayrağın `takeover` okunduğu karar adedi (hedef: 0). */
  readonly takeoverFlagDecisions: number;
  readonly legacyExecutionKeys: number;
  readonly legacyExecutionTotal: number;
  /** Aynı komutu iki hat da yürüttü mü — ÇİFT YÜRÜTME kanıtı (hedef: 0). */
  readonly doubleExecutionKeys: number;
  readonly bridgeStarts: number;
  readonly bridgeDisposes: number;
  /** Defter tavana dayandı mı → "0 = hiç olmadı" çıkarımı GEÇERSİZ. */
  readonly bounded: boolean;
  /** Açık olan Mavi bayrakları (bounded ad listesi — değer/anahtar TAŞIMAZ). */
  readonly openFlags: readonly string[];
  /** Bayrak okuması yapılabildi mi (false → adet iddia edilmez). */
  readonly flagsReadable: boolean;
}

/** MAVI-F8 · bounded iş yükü satırı — hız/mesafe/konum TAŞIMAZ. */
export interface MaviWorkloadRaw {
  readonly lastLevel: string | null;
  readonly resolutions: number;
  readonly sourceBound: boolean;
  readonly levels: Readonly<Record<string, number>>;
  readonly evidence: Readonly<Record<string, number>>;
  readonly proactiveSuppressed: number;
  readonly responsesShortened: number;
  readonly streamsShortened: number;
  readonly followUpSuppressed: number;
  readonly deferrals: number;
  readonly deferralsExpired: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviSectionId =
  | 'lifecycle' | 'diag' | 'ai-health' | 'quota' | 'proactive' | 'speech' | 'workload'
  | 'proactive-policy' | 'surface' | 'barge-in' | 'canonical-runtime' | 'wake-forensics'
  | 'anomalies';

export interface MaviSection {
  readonly id:     MaviSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

export const MAVI_SECTION_TITLE: Readonly<Record<MaviSectionId, string>> = {
  'lifecycle': 'A · Mavi Yaşam Döngüsü',
  'diag':      'B · Son Teşhis Aşamaları',
  'ai-health': 'C · AI Sağlık Durumu (devre kesici)',
  'quota':     'D · Sağlayıcı Soğuma (429)',
  'proactive': 'E · Proaktif Kritik Arıza Uyarısı',
  'speech':    'F · Konuşma Otoritesi (M6) + Tur Kapıları (M5)',
  'workload':  'G · Sürüş İş Yükü ve Konuşma Bütçesi (F8)',
  'proactive-policy': 'H · Proaktif Konuşma Politikası (F9)',
  'surface': 'I · Kullanıcıya Görünen Durum (F11)',
  'barge-in': 'J · Barge-in ve Konuşma Kontrolü (F12)',
  'canonical-runtime': 'K · Kanonik Runtime / Konsolidasyon (F13)',
  'wake-forensics': 'L · Wake Tetiğinin Akıbeti (kim yuttu?)',
  'anomalies': 'M · Anomali Tespiti (çapraz-kesen, TÜRETİLMİŞ — otorite DEĞİL)',
} as const;

const SRC = {
  voice: 'voiceService.getVoiceSnapshot()',
  diag:  'voiceDiagService.getRecentVoiceDiag()',
  ai:    'aiHealth.getAiHealthSnapshot()',
  quota: 'companion/companionChatProvider.getProviderQuotaSnapshot()',
  proactive: 'companion/companionChatProvider.getProactiveAlertDiagnostics()'
           + ' + ai/aiOfflineReason.getProactiveSuppressionHistory()',
  speech: 'assistant/maviSpeech.getMaviSpeechDiagnostics()',
  ttsEngine: 'ttsService.getTtsEngineDiagnostics()',
  turn:   'assistant/maviTurn.getMaviTurnDiagnostics()',
  workload: 'assistant/maviWorkload.getMaviWorkloadDiagnostics()',
  policy: 'assistant/proactivePolicyEngine.getProactivePolicyDiagnostics()',
  surface: 'assistant/maviSurfaceState.getMaviSurfaceDiagnostics()'
         + ' + store.settings{companionWakeWordEnabled,companionEnabled}',
  bargeIn: 'assistant/maviBargeIn.getMaviBargeInDiagnostics()'
         + ' (voice/duplexCapability.classifyMaviDuplex)',
  runtime: 'maviCore/wiring/maviEvidence.getMaviRuntimeConsolidationDiagnostics()'
         + ' + ai/gateway/aiGatewayFlag + capability/fabric/capabilityFabric',
  wakeForensics: 'voice/wakeForensics.getWakeForensics()'
         + ' (voice/core/wakeDecisionModel.projectWakeForensics)',
  latency: 'assistant/maviLatencyTrace.getMaviLatencyEvidence()'
         + ' (devtools/maviLatencyModel.summarize + summarizeSlaClasses)',
  actionTrace: 'action/maviActionTrace.getMaviActionTrace() + getMaviActionTraceCounters()',
  anomalies: 'devtools/maviForensicModel.detectMaviAnomalies()'
         + ' (yukarıdaki bölümlerin SAF türetimi — yeni ölçüm yapmaz)',
} as const;

function _bound(fields: readonly InspectorField[]): readonly InspectorField[] {
  return fields.length <= MAX_FIELDS_PER_MAVI_SECTION
    ? fields
    : fields.slice(0, MAX_FIELDS_PER_MAVI_SECTION);
}

/** VAR/YOK etiketi — içerik ASLA basılmaz. */
function _presence(v: boolean): string {
  return v ? 'VAR' : 'YOK';
}

/* ── A · Yaşam döngüsü ────────────────────────────────────────────────────── */

function _lifecycleSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const v = s.voice;

  if (!v) {
    f.push(unavailable(
      { id: 'mvVoice', label: 'ses durumu', source: SRC.voice, note: '' },
      'Ses anlık görüntüsü okunamadı — "boşta" VARSAYILMAZ.',
    ));
    return { id: 'lifecycle', title: MAVI_SECTION_TITLE.lifecycle, fields: _bound(f) };
  }

  const known = MAVI_KNOWN_VOICE_STATUS.indexOf(v.status) >= 0;

  f.push(observed(
    { id: 'mvStatus', label: 'durum (status)', source: SRC.voice,
      note: 'voiceService ham durum dizesi.' },
    v.status,
  ));
  f.push(derived(
    { id: 'mvStatusKnown', label: 'durum repoda TANIMLI mı', source: `${SRC.voice} (VoiceStatus birliği)`,
      note: 'KURAL: değer repodaki VoiceStatus birliğinde ise EVET. Bilinmeyen durum TAHMİN EDİLMEZ.' },
    known ? 'EVET' : 'HAYIR',
  ));
  f.push(observed(
    { id: 'mvMic', label: 'mikrofon kullanılabilir', source: SRC.voice,
      note: 'micAvailable — izin/donanım kapısı.' },
    v.micAvailable,
  ));
  f.push(observed(
    { id: 'mvVolume', label: 'ses seviyesi (0–1)', source: SRC.voice,
      note: 'Anlık RMS/görselleştirme seviyesi; dinleme dışında 0 olması NORMALDİR.' },
    v.volumeLevel,
  ));
  f.push(observed(
    { id: 'mvFollowUp', label: 'takip dinlemesi kurulu', source: SRC.voice,
      note: 'followUp — TTS bitince mikrofon otomatik yeniden açılacak mı.' },
    v.followUp,
  ));
  f.push(observed(
    { id: 'mvSuggestions', label: 'öneri adedi', source: SRC.voice,
      note: 'YALNIZ ADET — öneri metinleri bu katmana HİÇ GELMEZ.' },
    v.suggestionCount,
  ));
  f.push(observed(
    { id: 'mvHistory', label: 'geçmiş kaydı adedi', source: SRC.voice,
      note: 'YALNIZ ADET — konuşma geçmişi içeriği bu katmana HİÇ GELMEZ.' },
    v.historyCount,
  ));
  f.push(observed(
    { id: 'mvLastCommand', label: 'son komut', source: SRC.voice,
      note: 'GİZLİLİK: komut metni/nesnesi GÖSTERİLMEZ — yalnız varlığı.' },
    _presence(v.hasLastCommand),
  ));
  f.push(observed(
    { id: 'mvTranscript', label: 'transcript', source: SRC.voice,
      note: 'GİZLİLİK: transcript metni GÖSTERİLMEZ — yalnız varlığı.' },
    _presence(v.hasTranscript),
  ));
  f.push(observed(
    { id: 'mvError', label: 'ses hatası', source: SRC.voice,
      note: 'GİZLİLİK: hata MESAJI serbest metindir, taşınmaz — yalnız varlığı.' },
    _presence(v.hasError),
  ));

  return { id: 'lifecycle', title: MAVI_SECTION_TITLE.lifecycle, fields: _bound(f) };
}

/* ── B · Tanı özeti (satırlar ayrı yapıda) ────────────────────────────────── */

function _diagSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const d = s.diag;

  if (d === null) {
    f.push(unavailable(
      { id: 'mvDiagCount', label: 'tanı kaydı adedi', source: SRC.diag, note: '' },
      'Tanı halkası okunamadı. BOŞ halka ile OKUNAMADI AYRI şeydir — 0 gösterilmez.',
    ));
    return { id: 'diag', title: MAVI_SECTION_TITLE.diag, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvDiagCount', label: 'tanı kaydı adedi', source: SRC.diag,
      note: 'Bounded halka (repo tavanı 40). 0 = halka GERÇEKTEN boş (okuma başarılı).' },
    d.length,
  ));

  const newest = d.length > 0 ? d[0] : null;   // dizi ZATEN en yeni→en eski sıralanmıştır
  f.push(newest
    ? observed(
        { id: 'mvDiagNewestStage', label: 'en yeni aşama', source: SRC.diag,
          note: 'Halkadaki EN SON kaydın aşaması.', updatedAt: newest.at },
        newest.stage,
      )
    : unavailable({ id: 'mvDiagNewestStage', label: 'en yeni aşama', source: SRC.diag, note: '' },
        'Halka boş — hiç ses tanı olayı kaydedilmedi.'));

  f.push(newest && newest.at !== null
    ? observed(
        { id: 'mvDiagNewestAt', label: 'en yeni kaydın damgası', source: SRC.diag,
          note: 'Gerçek duvar-saati damgası (kayıt anında alınır). Tanımlı bayatlık eşiği YOK → STALE hesaplanmaz.',
          updatedAt: newest.at },
        new Date(newest.at).toISOString(),
      )
    : unavailable({ id: 'mvDiagNewestAt', label: 'en yeni kaydın damgası', source: SRC.diag, note: '' },
        'Damga yok — "şimdi" UYDURULMAZ.'));

  f.push(observed(
    { id: 'mvDiagErrorRows', label: 'hata kodu taşıyan kayıt adedi', source: SRC.diag,
      note: 'errorCode alanı dolu olan satır sayısı (kod TANIMLAYICI sınıfıdır, serbest metin değildir).' },
    d.filter((e) => !!e.errorCode).length,
  ));

  return { id: 'diag', title: MAVI_SECTION_TITLE.diag, fields: _bound(f) };
}

/* ── C · AI sağlığı ───────────────────────────────────────────────────────── */

function _aiHealthSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const a = s.aiHealth;

  if (!a) {
    f.push(unavailable(
      { id: 'mvAi', label: 'devre kesici durumu', source: SRC.ai, note: '' },
      'AI sağlık anlık görüntüsü okunamadı — "sağlıklı" VARSAYILMAZ.',
    ));
    return { id: 'ai-health', title: MAVI_SECTION_TITLE['ai-health'], fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvAiHealthy', label: 'sağlıklı (devre kapalı)', source: SRC.ai,
      note: 'healthy = blockedUntil === 0. Bu AI AĞI sağlığıdır, araç bağlantısı DEĞİL.' },
    a.healthy,
  ));
  f.push(observed(
    { id: 'mvAiFails', label: 'art arda gerçek ağ hatası', source: SRC.ai,
      note: 'consecFails — ulaşılamazlık kovası.' },
    a.consecFails,
  ));
  f.push(observed(
    { id: 'mvAiTimeouts', label: 'art arda bütçe timeout\'u', source: SRC.ai,
      note: 'consecTimeouts — AYRI kova: yavaş ≠ ölü (repo bilinçli ayrımı).' },
    a.consecTimeouts,
  ));
  f.push(observed(
    { id: 'mvAiBlockedFor', label: 'bloke kalan süre (ms)', source: SRC.ai,
      note: 'blockedForMs — MONOTONİK saatten türeyen bir SÜREdir, duvar saati damgası DEĞİLDİR.' },
    a.blockedForMs,
  ));
  f.push(derived(
    { id: 'mvAiBlocked', label: 'şu an bloke mi', source: `${SRC.ai} (blockedForMs > 0)`,
      note: 'KURAL: blockedForMs > 0 → EVET.' },
    a.blockedForMs > 0 ? 'EVET' : 'HAYIR',
  ));

  return { id: 'ai-health', title: MAVI_SECTION_TITLE['ai-health'], fields: _bound(f) };
}

/* ── D · Sağlayıcı soğumaları ─────────────────────────────────────────────── */

function _quotaSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const q = s.quota;

  if (!q) {
    f.push(unavailable(
      { id: 'mvQuota', label: 'sağlayıcı soğuma pencereleri', source: SRC.quota, note: '' },
      'Kota anlık görüntüsü okunamadı — "kotasız" VARSAYILMAZ.',
    ));
    return { id: 'quota', title: MAVI_SECTION_TITLE.quota, fields: _bound(f) };
  }

  /* SAHA DERSİ (repo yorumu, 2026-07-04): pencereler SAĞLAYICI BAZLIDIR; tek
     ortak sayaca indirgemek "çapraz kirlenme" hatasını geri getirir. Bu yüzden
     üç alan AYRI tutulur ve TOPLANMAZ. */
  f.push(observed(
    { id: 'mvQuotaGemini', label: 'Gemini soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.geminiCooldownMs,
  ));
  f.push(observed(
    { id: 'mvQuotaGroq', label: 'Groq soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.groqCooldownMs,
  ));
  f.push(observed(
    { id: 'mvQuotaHaiku', label: 'Haiku soğuma (ms)', source: SRC.quota,
      note: '0 = açık/kotasız. Diğer sağlayıcılarla BİRLEŞTİRİLMEZ.' },
    q.haikuCooldownMs,
  ));
  f.push(derived(
    { id: 'mvQuotaAnyCooling', label: 'soğumada sağlayıcı var mı', source: `${SRC.quota} (herhangi biri > 0)`,
      note: 'KURAL: üç pencereden herhangi biri > 0 → EVET. Bu bir TOPLAM DEĞİLDİR; süreler ayrı alanlardadır.' },
    (q.geminiCooldownMs > 0 || q.groqCooldownMs > 0 || q.haikuCooldownMs > 0) ? 'EVET' : 'HAYIR',
  ));

  return { id: 'quota', title: MAVI_SECTION_TITLE.quota, fields: _bound(f) };
}

/* ── E · Proaktif kritik arıza uyarısı ────────────────────────────────────── */

function _proactiveSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const p = s.proactive;

  if (!p) {
    f.push(unavailable(
      { id: 'mvProactive', label: 'proaktif uyarı motoru', source: SRC.proactive, note: '' },
      'Proaktif uyarı teşhisi okunamadı — "hiç uyarı yok" VARSAYILMAZ.',
    ));
    return { id: 'proactive', title: MAVI_SECTION_TITLE.proactive, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'mvPaSpoken', label: 'seslendirilen uyarı adedi', source: SRC.proactive,
      note: 'Oturum içi sayaç. GİZLİLİK: uyarı METNİ bu katmana HİÇ GELMEZ.' },
    p.spokenCount,
  ));
  f.push(observed(
    { id: 'mvPaSuppressed', label: 'bastırılan uyarı adedi', source: SRC.proactive,
      note: 'Susturma SESSİZ DEĞİLDİR: her biri sebep koduyla kaydedilir.' },
    p.suppressedCount,
  ));
  f.push(p.lastAlertKey !== null
    ? observed(
        { id: 'mvPaLastKey', label: 'son uyarı anahtarı', source: SRC.proactive,
          note: 'Kök-neden KODU (makine-okur dedup anahtarı) — arıza açıklaması DEĞİL.' },
        p.lastAlertKey,
      )
    : unavailable({ id: 'mvPaLastKey', label: 'son uyarı anahtarı', source: SRC.proactive, note: '' },
        'Bu oturumda hiç proaktif uyarı seslendirilmedi.'));
  f.push(observed(
    { id: 'mvPaDebounce', label: 'kalan susma penceresi (ms)', source: SRC.proactive,
      note: 'MONOTONİK saatten türeyen SÜRE (duvar saati damgası DEĞİL). 0 = pencere kapalı.' },
    p.debounceRemainingMs,
  ));
  f.push(p.lastSuppressReason !== null
    ? observed(
        { id: 'mvPaSuppressReason', label: 'son susturma gerekçesi', source: SRC.proactive,
          note: 'TANIMLAYICI sınıfı kod: debounce · reverse_attention · not_critical · safety_gate_unavailable …' },
        p.lastSuppressReason,
      )
    : unavailable({ id: 'mvPaSuppressReason', label: 'son susturma gerekçesi', source: SRC.proactive, note: '' },
        'Hiç susturma kaydedilmedi.'));
  f.push(derived(
    { id: 'mvPaMuted', label: 'şu an susma penceresinde mi', source: `${SRC.proactive} (debounceRemainingMs > 0)`,
      note: 'KURAL: debounceRemainingMs > 0 → EVET. Yalnız AYNI arıza anahtarı için geçerlidir.' },
    p.debounceRemainingMs > 0 ? 'EVET' : 'HAYIR',
  ));

  /* ── Açıklanabilir karar — "neden bu karar?" ─────────────────────────────
     Kaynağı OLMAYAN alan UNAVAILABLE olur; sahte varsayılan/0 BASILMAZ. */
  f.push(p.lastReasonCode !== null
    ? observed(
        { id: 'mvPaReasonCode', label: 'son karar sebep kodu', source: SRC.proactive,
          note: 'BOUNDED birlik (ok · not_critical · debounce · reverse_attention …) — serbest metin DEĞİL.' },
        p.lastReasonCode,
      )
    : unavailable({ id: 'mvPaReasonCode', label: 'son karar sebep kodu', source: SRC.proactive, note: '' },
        'Bu oturumda hiç proaktif karar üretilmedi.'));

  f.push(p.lastConfidence !== null && p.lastConfidenceScale !== null
    ? observed(
        { id: 'mvPaConfidence', label: 'karar güveni', source: `${SRC.proactive} → diagnosticTriage.RootCauseHypothesis.confidence`,
          note: 'ÖLÇEK BİRLİKTE TAŞINIR. Repoda İKİ ölçek var (percent_0_100 · unit_0_1) ve BİRLEŞTİRİLMEZ.' },
        `${p.lastConfidence} (${p.lastConfidenceScale})`,
      )
    : unavailable({ id: 'mvPaConfidence', label: 'karar güveni', source: SRC.proactive, note: '' },
        'Güven kaynağı YOK — sahte değer üretilmez (0 gösterilmez).'));

  f.push(p.lastDecisionSource !== null
    ? observed(
        { id: 'mvPaSource', label: 'karar üreticisi', source: SRC.proactive,
          note: 'Bugün üretimde YALNIZ deterministik kural motoru (`rule`) doğar; llm/parser/fallback üretilmez.' },
        p.lastDecisionSource,
      )
    : unavailable({ id: 'mvPaSource', label: 'karar üreticisi', source: SRC.proactive, note: '' },
        'Karar üreticisi bilinmiyor.'));

  f.push(p.lastReasonSummary !== null
    ? observed(
        { id: 'mvPaSummary', label: 'kısa açıklama', source: SRC.proactive,
          note: 'GİZLİLİK: tanı kuralının STATİK başlığı, kırpılmış. Ham prompt / model düşüncesi / seslendirilen metin DEĞİL.' },
        p.lastReasonSummary,
      )
    : unavailable({ id: 'mvPaSummary', label: 'kısa açıklama', source: SRC.proactive, note: '' },
        'Açıklama kaynağı yok.'));

  f.push(p.trailRowCount !== null
    ? observed(
        { id: 'mvPaTrailRows', label: 'olay izindeki karar satırı', source: 'diagnosticTrail.getDiagnosticTrail()',
          note: 'GERÇEK olay izi kaynağından sayım — ayrı/paralel bir kayıt deposu KURULMADI.' },
        p.trailRowCount,
      )
    : unavailable({ id: 'mvPaTrailRows', label: 'olay izindeki karar satırı', source: 'diagnosticTrail.getDiagnosticTrail()', note: '' },
        'Olay izi okunamadı — 0 VARSAYILMAZ.'));

  return { id: 'proactive', title: MAVI_SECTION_TITLE.proactive, fields: _bound(f) };
}

/* ── F · Konuşma otoritesi (M6) + tur kapıları (M5) ───────────────────────── */

/**
 * M6 seslendirme defteri ve M5 tur kapısı sayaçları.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `getMaviSpeechDiagnostics()` ve `getMaviTurnDiagnostics()` ÜRETİLİYOR ama
 * hiçbir LAB ekranı OKUMUYORDU → "gözlemlenemeyen özellik tamamlanmış değildir"
 * kuralına göre açık borçtu. Özellikle MAVI-M6-LATE-SPEECH-GATE'in eklediği
 * `staleLateSpeechSuppressed` sahada tek doğrulama kanıtıdır: geç konuşma
 * kapısının GERÇEKTEN tetiklendiğini yalnız bu sayaç gösterir.
 *
 * ── DÜRÜSTLÜK ──────────────────────────────────────────────────────────────
 *  · Kaynak okunamazsa `0` BASILMAZ → KAYNAK YOK.
 *  · Sayaç tavanı dolduysa ("doydu") sayılar ARTIK GERÇEK ADET DEĞİLDİR;
 *    bu durum ayrı bir alanla açıkça bildirilir.
 *  · Seslendirilen METİN, transcript ve kullanıcı içeriği BU BÖLÜME GİRMEZ.
 */
function _speechSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const sp = s.speech;
  const tn = s.turn;

  /* — M6 konuşma defteri — */
  if (!sp) {
    f.push(unavailable(
      { id: 'msSpeech', label: 'M6 konuşma defteri', source: SRC.speech, note: '' },
      'Konuşma otoritesi tanı yüzeyi okunamadı.',
    ));
  } else {
    f.push(observed(
      { id: 'msLedgerTurn', label: 'defterin izlediği tur', source: SRC.speech,
        note: 'Konuşma defterinin son tazelendiği tur kimliği (süreç-içi sayaç).' },
      sp.turnId,
    ));
    f.push(observed(
      { id: 'msAnswered', label: 'bu turda cevap verildi', source: SRC.speech,
        note: 'M6: tur başına EN FAZLA BİR `answer`.' },
      _presence(sp.answeredThisTurn),
    ));
    f.push(observed(
      { id: 'msProgressed', label: 'bu turda ara bilgi verildi', source: SRC.speech,
        note: 'M6: tur başına EN FAZLA BİR `progress`.' },
      _presence(sp.progressedThisTurn),
    ));
    f.push(observed(
      { id: 'msSpoken', label: 'toplam seslendirme', source: SRC.speech,
        note: 'Gerçekten TTS\'e giden çağrı adedi (metin TAŞINMAZ).' },
      sp.spoken,
    ));
    f.push(observed(
      { id: 'msDuplicate', label: 'mükerrer cevap reddi', source: SRC.speech,
        note: 'Aynı turda ikinci cevap/ara bilgi girişimi — üst üste konuşma önlendi.' },
      sp.suppressedDuplicate,
    ));
    f.push(observed(
      { id: 'msStaleLate', label: 'geç konuşma reddi (M6 kapısı)', source: SRC.speech,
        note: 'MAVI-M6-LATE-SPEECH-GATE: eskimiş turlu geç cevap susturuldu. '
            + 'Bu sayacın ARTMASI kapının sahada çalıştığının TEK kanıtıdır.' },
      sp.staleLateSpeechSuppressed,
    ));
  }

  /* ── SAHA #1256-a · ÇAĞRI ≠ DUYULAN SES ────────────────────────────────
   * Yukarıdaki `toplam seslendirme` yalnız "TTS'e çağrı gitti" der. 2026-09-04'te
   * o sayaç `2` derken kullanıcı HİÇBİR ŞEY duymuyordu: cihazda varsayılan TTS
   * motoru (`secure.tts_default_synth`) HİÇ SEÇİLİ DEĞİLDİ. Aşağıdaki alanlar o
   * boşluğu kapatır — ama **sesin duyulduğunu İDDİA ETMEZ**: JS'ten hoparlör
   * okunamaz. Ölçülen yalnız seslendirmenin NASIL sonlandığı ve GERÇEK süresidir.
   * Hüküm (`kanıt sınıfı`) `ttsService`in kendi defterinden gelir — LAB burada
   * kendi gerçeğini ÜRETMEZ, taşır. */
  const te = s.ttsEngine;
  if (!te) {
    f.push(unavailable(
      { id: 'msTtsEngine', label: 'TTS motor sonucu', source: SRC.ttsEngine, note: '' },
      'TTS motor sonuç defteri okunamadı.',
    ));
  } else {
    f.push(observed(
      { id: 'msTtsRequested', label: 'seslendirme denemesi', source: SRC.ttsEngine,
        note: 'Motora giden seslendirme denemesi adedi. `toplam seslendirme` ile '
            + 'aynı olgu DEĞİLDİR: bu, TTS motor yoluna FİİLEN inen çağrıdır.'
            + (te.saturated ? ' ⚠️ Tavan doldu — sayılar artık gerçek adet DEĞİL.' : '') },
      te.requested,
    ));
    f.push(observed(
      { id: 'msTtsDone', label: 'motor bitişi bildirdi', source: SRC.ttsEngine,
        note: 'Motor "seslendirme bitti" dedi. ⚠️ Bu, sesin DUYULDUĞUNUN kanıtı '
            + 'DEĞİLDİR — yalnız motorun cevap verdiğini gösterir.' },
      te.engineDone,
    ));
    f.push(observed(
      { id: 'msTtsSilent', label: 'motor HİÇ cevap vermedi', source: SRC.ttsEngine,
        note: 'Emniyet süresi doldu ama motor bitişi hiç bildirmedi. Bu sayacın '
            + 'artması, seçili/çalışan bir TTS motoru OLMADIĞININ en güçlü '
            + 'uygulama-içi işaretidir (saha #1256).' },
      te.noEngineReport,
    ));
    f.push(observed(
      { id: 'msTtsError', label: 'motor hata/yok', source: SRC.ttsEngine,
        note: 'Motor çağrısı reddedildi ya da platformda hiç TTS yok.' },
      te.engineError,
    ));
    f.push(derived(
      { id: 'msTtsInstant', label: 'şüpheli anında "bitti"', source: SRC.ttsEngine,
        note: 'Motor "bitti" dedi ama süre, o uzunluktaki cümlenin FİZİKSEL en '
            + 'kısa konuşulma süresinden bile kısaydı → cümle GERÇEKTE '
            + 'konuşulmamış olabilir. Sınır kasıtlı cömerttir (yanlış-pozitif '
            + 'yerine kaçırmayı tercih eder).' },
      te.suspectInstantDone,
    ));
    if (te.lastEvidence === null) {
      f.push(unavailable(
        { id: 'msTtsLast', label: 'son seslendirmenin kanıtı', source: SRC.ttsEngine, note: '' },
        'Henüz hiçbir seslendirme kapanmadı.',
      ));
    } else {
      f.push(derived(
        { id: 'msTtsLast', label: 'son seslendirmenin kanıtı', source: SRC.ttsEngine,
          note: 'ENGINE_CONFIRMED = motor bitişi bildirdi (SES KANITI DEĞİL) · '
              + 'ENGINE_SILENT = motor cevap vermedi/hata · '
              + 'SUSPECT_INSTANT_DONE = süre fiziksel alt sınırın altında.' },
        `${te.lastEvidence} · ${te.lastCause} · ${te.lastTransport}`,
      ));
      f.push(observed(
        { id: 'msTtsLastMs', label: 'son seslendirme süresi', source: SRC.ttsEngine,
          note: 'GERÇEK ölçülen süre (monotonik) ile bu uzunluktaki cümlenin '
              + 'fiziksel alt sınırı yan yana. Metin TAŞINMAZ — yalnız uzunluk.' },
        `${te.lastDurationMs} ms · alt sınır ${te.lastMinPlausibleMs} ms · `
        + `${te.lastCharCount} karakter`,
      ));
    }
  }

  /* — M5 tur kapıları — */
  if (!tn) {
    f.push(unavailable(
      { id: 'msTurn', label: 'M5 tur kapıları', source: SRC.turn, note: '' },
      'Tur tanı yüzeyi okunamadı.',
    ));
    return { id: 'speech', title: MAVI_SECTION_TITLE.speech, fields: _bound(f) };
  }

  f.push(observed(
    { id: 'msActiveTurn', label: 'aktif tur', source: SRC.turn, note: '' },
    tn.activeTurnId,
  ));
  f.push(observed(
    { id: 'msTurnState', label: 'tur durumu', source: SRC.turn,
      note: 'active = eylem/konuşma yetkisi var · completed = nihai zarf üretildi · '
          + 'superseded = kullanıcı yeni komut verdi.' },
    tn.activeState,
  ));

  /* Defter turu ile aktif tur AYRIŞMIŞSA: bu turda henüz konuşulmamış demektir.
     Türetilmiş ama İKİ GÖZLENEN alandan çıkar — tahmin YOK. */
  if (sp) {
    f.push(derived(
      { id: 'msTurnSync', label: 'defter aktif turla aynı mı', source: `${SRC.speech} + ${SRC.turn}`,
        note: 'HAYIR = bu turda henüz hiç konuşulmadı (defter önceki turda kalmış). '
            + 'Bu bir hata DEĞİLDİR; yalnız durum bilgisidir.' },
      sp.turnId === tn.activeTurnId ? 'EVET' : 'HAYIR',
    ));
  }

  f.push(observed({ id: 'msTurnsStarted',    label: 'başlayan tur',    source: SRC.turn, note: '' }, tn.turnsStarted));
  f.push(observed({ id: 'msTurnsCompleted',  label: 'tamamlanan tur',  source: SRC.turn, note: '' }, tn.turnsCompleted));
  f.push(observed(
    { id: 'msTurnsSuperseded', label: 'devralınan tur', source: SRC.turn,
      note: 'Kullanıcı cevabı beklemeden yeni komut verdi — geç sonuç yetkisi iptal edildi.' },
    tn.turnsSuperseded,
  ));
  f.push(observed(
    { id: 'msStaleProvider', label: 'düşürülen sağlayıcı sonucu', source: SRC.turn,
      note: 'Eskimiş turun geç AI cevabı eyleme DÖNÜŞMEDİ.' },
    tn.staleProviderResultsDropped,
  ));
  f.push(observed(
    { id: 'msStaleAction', label: 'engellenen geç eylem', source: SRC.turn,
      /* NOT: "BAŞLAT" gibi eylem fiilleri bilinçli olarak KULLANILMAZ — bu ekran
         salt-okunurdur ve müdahale butonu içermediği kaynak taramasıyla kilitlidir. */
      note: 'Eskimiş tur yan etki üretemedi.' },
    tn.staleActionsPrevented,
  ));
  f.push(observed(
    { id: 'msStaleFeedback', label: 'susturulan geç geri bildirim', source: SRC.turn,
      note: 'Çağrı-yeri tur kapısı (`continueIfTurnCurrent`) geç cevabı düşürdü.' },
    tn.staleFeedbackSuppressed,
  ));

  /* Doyma DÜRÜSTÇE bildirilir: tavana ulaşan sayaç artık ADET DEĞİLDİR. */
  f.push(tn.countersSaturated
    ? derived(
        { id: 'msSaturated', label: 'sayaçlar doydu', source: SRC.turn,
          note: 'Tavana ulaşıldı — yukarıdaki sayılar ARTIK GERÇEK ADET DEĞİLDİR (alt sınırdır).' },
        'EVET',
      )
    : observed(
        { id: 'msSaturated', label: 'sayaçlar doydu', source: SRC.turn,
          note: 'Tavana ulaşılmadı → sayılar gerçek adettir.' },
        'HAYIR',
      ));

  return { id: 'speech', title: MAVI_SECTION_TITLE.speech, fields: _bound(f) };
}

/* -- G . Surus is yuku (MAVI-F8) ------------------------------------------ */

function _renderCounts(m: Readonly<Record<string, number>> | undefined): string | null {
  if (!m) return null;
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return null;
  return keys.map((k) => `${k}: ${m[k]}`).join(' \u00b7 ');
}

function _workloadSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const w = s.workload;

  if (!w) {
    f.push(unavailable(
      { id: 'mwRoot', label: 'iş yükü tanısı', source: SRC.workload, note: '' },
      'Sürüş iş yükü tanı yüzeyi okunamadı.',
    ));
    return { id: 'workload', title: MAVI_SECTION_TITLE.workload, fields: _bound(f) };
  }

  /* Kaynak bağlı DEĞİLSE seviye zaten daima UNKNOWN'dır — bunu "ölçüldü" gibi
     göstermek yalan olurdu. */
  f.push(w.sourceBound
    ? observed(
      { id: 'mwSource', label: 'canlı kaynak', source: SRC.workload,
        note: 'Bağlıyken hareket, rehberlik, manevra yakınlığı, geri vites, '
            + 'kritik güvenlik ve bilişsel mod MEVCUT otoritelerden OKUNUR. '
            + 'Yeni sensör veya paralel state ÜRETİLMEZ.' },
      'BAĞLI')
    : unavailable(
      { id: 'mwSource', label: 'canlı kaynak', source: SRC.workload,
        note: 'Kaynak bağlı değil → seviye DAİMA UNKNOWN döner ve davranış '
            + 'bugünküyle birebir aynıdır (regresyon yok).' },
      'BAĞLI DEĞİL — seviye daima UNKNOWN'));

  f.push(w.resolutions === 0
    ? unavailable(
      { id: 'mwLevel', label: 'son iş yükü seviyesi', source: SRC.workload,
        note: 'Bu oturumda hiç hüküm üretilmedi. LOW yazmak bir ÖLÇÜM gibi '
            + 'görünürdü — ölçüm yokluğu ölçüm DEĞİLDİR.' },
      'Ölçüm yok.')
    : observed(
      { id: 'mwLevel', label: 'son iş yükü seviyesi', source: SRC.workload,
        note: 'BOUNDED: LOW · NORMAL · ELEVATED · HIGH · CRITICAL · UNKNOWN. '
            + 'Bu bir GÜVENLİK otoritesi DEĞİLDİR: aracı kontrol etmez, '
            + 'navigasyon kararını değiştirmez, capability KAPATMAZ — yalnız '
            + 'Mavi\'nin KENDİ konuşma bütçesine tavan koyar. UNKNOWN, NORMAL '
            + 'bütçesini alır ama LOW olduğunu İDDİA ETMEZ.' },
      `${w.lastLevel ?? 'UNKNOWN'} (${w.resolutions} hüküm)`));

  const levels = _renderCounts(w.levels);
  f.push(levels === null
    ? unavailable({ id: 'mwLevels', label: 'seviye dağılımı', source: SRC.workload, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'mwLevels', label: 'seviye dağılımı', source: SRC.workload,
        note: 'Oturum boyunca hangi seviyede kaç hüküm üretildi.' },
      levels));

  const evid = _renderCounts(w.evidence);
  f.push(evid === null
    ? unavailable({ id: 'mwEvidence', label: 'kanıt dağılımı', source: SRC.workload, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'mwEvidence', label: 'kanıt dağılımı', source: SRC.workload,
        note: 'Hükmü DOĞURAN bounded kanıt kodları. Hız, mesafe, konum ve '
            + 'manevra adı TAŞINMAZ. no_evidence = hiçbir kaynak okunamadı. '
            + 'NOT: telefon görüşmesi kanıtı YOKTUR — repoda üretimde böyle bir '
            + 'sinyal bulunmuyor ve uydurulmadı (açık borç).' },
      evid));

  f.push(observed(
    { id: 'mwShort', label: 'kısaltma / erteleme', source: SRC.workload,
      note: 'Cevap bütçe yüzünden kaç kez KISALDI, akış kaç kez erken kapandı, '
          + 'serbest sohbet kaç kez ERTELENDİ. Erteleme bir CÜMLE değil bir '
          + 'DURUMDUR (F2 koruması: "sonra söylerim" kalıbı üretilmez) ve '
          + 'süresi dolunca DÜŞER — bayat cevap kendiliğinden konuşulmaz '
          + '(DEFERRED != COMPLETED).' },
    `cevap ${w.responsesShortened} \u00b7 akış ${w.streamsShortened} \u00b7 `
    + `erteleme ${w.deferrals} (düşen ${w.deferralsExpired})`));

  f.push(observed(
    { id: 'mwSuppress', label: 'susturulan sohbet', source: SRC.workload,
      note: 'GÜVENLİK DIŞI proaktif konuşma ve takip dinlemesi kaç kez '
          + 'kurulmadı. Güvenlik uyarıları (speakSafetyAlert ve proaktif kritik '
          + 'arıza) bu kapıdan GEÇMEZ ve ASLA susturulmaz.' },
    `proaktif ${w.proactiveSuppressed} \u00b7 takip ${w.followUpSuppressed}`));

  return { id: 'workload', title: MAVI_SECTION_TITLE.workload, fields: _bound(f) };
}

function _proactivePolicySection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const p = s.proactivePolicy;
  const ID: MaviSectionId = 'proactive-policy';

  if (!p) {
    f.push(unavailable(
      { id: 'ppRoot', label: 'proaktif politika', source: SRC.policy, note: '' },
      'Proaktif politika tanı yüzeyi okunamadı.',
    ));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  f.push(p.decisions === 0
    ? unavailable(
      { id: 'ppRoot', label: 'karar sayısı', source: SRC.policy,
        note: 'Bu oturumda hiç teklif değerlendirilmedi. "0 kabul" bir ÖLÇÜM '
            + 'gibi görünürdü — ölçüm yokluğu ölçüm DEĞİLDİR.' },
      'Ölçüm yok.')
    : observed(
      { id: 'ppRoot', label: 'karar sayısı', source: SRC.policy,
        note: 'Motor SESLENDİRMEZ, yalnız izin verir; seslendirme çağıranın '
            + 'kendi kanonik hattındadır. Aynı tick içinde EN FAZLA BİR teklif '
            + 'konuşur, diğerleri DÜŞER (kuyruk YOK → bayat öneri imkânsız).' },
      `${p.decisions} karar · ${p.admitted} kabul`));

  f.push(observed(
    { id: 'ppCeiling', label: 'saatlik sesli tavan', source: SRC.policy,
      note: 'Yapısal spam freni: son 1 saatte kaç GÜVENLİK DIŞI sesli proaktif '
          + 'konuşuldu. `safety` sınıfı bu tavana DAHİL DEĞİLDİR ve tavan '
          + 'dolsa bile susturulmaz.' },
    `${p.hourlyVoiceUsed} / ${p.hourlyVoiceCeiling}`));

  const drops = _renderCounts(p.drops);
  f.push(drops === null
    ? unavailable({ id: 'ppDrops', label: 'düşme gerekçeleri', source: SRC.policy, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'ppDrops', label: 'düşme gerekçeleri', source: SRC.policy,
        note: '"Neden konuşmadı?" sorusunun KANITI. Bounded kod kümesi: '
            + 'turn_busy · user_suppressed · learned_suppressed · decayed · '
            + 'cooldown · workload · presence · media · budget · '
            + 'hourly_ceiling · no_visual_channel · no_text · not_top · invalid. '
            + 'Serbest metin YOK.' },
      drops));

  const bySrc = _renderCounts(p.admittedBySource);
  f.push(bySrc === null
    ? unavailable({ id: 'ppSources', label: 'kaynak bazlı konuşma', source: SRC.policy, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'ppSources', label: 'kaynak bazlı konuşma', source: SRC.policy,
        note: 'SABİT kaynak kimlikleri (companion.* · diagnostic.*). Bu sayı '
            + 'motorun kapısından geçenleri VE kendi kanonik kapısı olan '
            + 'hatların GÖZLENEN konuşmalarını birlikte içerir.' },
      bySrc));

  const kinds = _renderCounts(p.kinds);
  f.push(kinds === null
    ? unavailable({ id: 'ppKinds', label: 'sınıf dağılımı', source: SRC.policy, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'ppKinds', label: 'sınıf dağılımı', source: SRC.policy,
        note: 'Sınıf bir ETİKET DEĞİL YETKİ SEVİYESİDİR: safety (iş yükü tavanı '
            + 'CRITICAL, bütçesiz, presence gerektirmez, öğrenmeyle SUSTURULAMAZ) · '
            + 'operational (HIGH) · informational (ELEVATED) · social (NORMAL).' },
      kinds));

  f.push(observed(
    { id: 'ppLearn', label: 'kesinti / öğrenme', source: SRC.policy,
      note: 'Kullanıcı uçuştaki proaktif konuşmayı kaç kez KESTİ. Bu bir "ret" '
          + 'DEĞİL bir KESİNTİdir (kullanıcı ilgisiz bir sebeple de mikrofonu '
          + 'açmış olabilir): skoru kademeli düşürür ve eşikte GEÇİCİ ve süresi dolan bir '
          + 'bastırma uygular. Güvenlik kaynakları bu yoldan ASLA susturulmaz.' },
    `kesinti ${p.interruptions} · öğrenilmiş bastırma ${p.learnedSuppressed.length} · `
    + `kullanıcı bastırması ${p.userSuppressed.length}`));

  f.push(p.acceptRateMeasurable
    ? observed(
      { id: 'ppAccept', label: 'kabul oranı', source: SRC.policy, note: '' },
      'ölçülüyor')
    : unavailable(
      { id: 'ppAccept', label: 'kabul oranı (proactiveAcceptRate)', source: SRC.policy,
        note: 'ÜRETİMDE "kullanıcı bu öneriyi KABUL ETTİ" diyen bir sinyal '
            + 'YOKTUR — yalnız KESİNTİ gözlenebiliyor. Kesintisiz teslimi '
            + '"kabul" saymak ölçüm uydurmak olurdu. Açık borç: gerçek kabul '
            + 'kanalı (öneriye uyma / açık ret) tasarlanmadı.' },
      'ÖLÇÜLEMİYOR — kabul sinyali YOK'));

  f.push(p.lastAdmittedSourceId === null && p.lastDropReason === null
    ? unavailable({ id: 'ppLast', label: 'son karar', source: SRC.policy, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'ppLast', label: 'son karar', source: SRC.policy,
        note: 'Son konuşan kaynak ve son düşme gerekçesi (bağımsız iki alan; '
            + 'aynı karara ait olmak ZORUNDA DEĞİLDİR).' },
      `konuşan: ${p.lastAdmittedSourceId ?? '—'} · son düşme: ${p.lastDropReason ?? '—'}`));

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

function _surfaceSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const v = s.surface ?? null;
  const ID: MaviSectionId = 'surface';

  if (!v) {
    f.push(unavailable(
      { id: 'suRoot', label: 'yüzey durumu', source: SRC.surface, note: '' },
      'Yüzey durum tanısı okunamadı.'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  f.push(v.transitions === 0
    ? unavailable(
      { id: 'suRoot', label: 'son durum', source: SRC.surface,
        note: 'Bu oturumda hiç yüzey geçişi olmadı. "IDLE" yazmak bir ÖLÇÜM gibi '
            + 'görünürdü — ölçüm yokluğu ölçüm DEĞİLDİR.' },
      'Ölçüm yok.')
    : observed(
      { id: 'suRoot', label: 'son durum', source: SRC.surface,
        note: 'BOUNDED 11 durum: IDLE · AMBIENT · LISTENING · UNDERSTANDING · '
            + 'SPEAKING · ACTION · CONFIRMATION · PROACTIVE · DEFERRED · '
            + 'DEGRADED · ERROR. Bu bir OTORİTE DEĞİLDİR: eylem yürütmez, '
            + 'gerçek üretmez, capability açıp kapatmaz — kanonik kaynaklardan '
            + 'TÜRETİLİR. UNDERSTANDING bir "düşünüyor" göstergesi DEĞİLDİR, '
            + 'nötr bir ALINDI bildirimidir (F2/I7).' },
      `${v.lastState ?? '—'} (${v.transitions} geçiş) · sebep: ${v.lastReason ?? '—'}`));

  const dist = _renderCounts(v.states);
  f.push(dist === null
    ? unavailable({ id: 'suStates', label: 'durum dağılımı', source: SRC.surface, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'suStates', label: 'durum dağılımı', source: SRC.surface,
        note: 'Oturum boyunca hangi durumda kaç kez bulunuldu. Etiket METNİ, '
            + 'cevap içeriği ve transkript bu katmana HİÇ GİRMEZ.' },
      dist));

  f.push(observed(
    { id: 'suMode', label: 'yüzey kipi', source: SRC.surface,
      note: 'COMPACT = sürüş (iş yükü ELEVATED+ VEYA hareket VEYA hareket '
          + 'BİLİNMİYOR — kanıtsızken daha az dikkat yükü seçilir). '
          + 'EXPANDED = yalnız DOĞRULANMIŞ duruş + düşük iş yükü. '
          + 'İş yükü yüzeyi daraltır ama capability KAPATMAZ (F8).' },
    v.lastMode ?? '—'));

  f.push(observed(
    { id: 'suFull', label: 'engellenen tam ekran', source: SRC.surface,
      note: 'Sürüş kipinde tam ekran yüzey AÇILMAZ: navigasyon/müzik ekranı '
          + 'kapanmaz (spec §21.2 — pazarlıksız). Bu sayaç o korumanın kaç kez '
          + 'devreye girdiğini gösterir; 0 "hiç denenmedi" demektir.' },
    `${v.fullScreenBlocked}`));

  f.push(v.lastDegraded === 'NONE'
    ? observed(
      { id: 'suDegraded', label: 'yetenek kaybı', source: SRC.surface,
        note: 'Kayıp sınıfı bounded ve SPESİFİKtir; "AI çalışmıyor" gibi '
            + 'genelleme YASAKTIR — her sınıf AYAKTA KALANI söyler.' },
      'YOK')
    : unavailable(
      { id: 'suDegraded', label: 'yetenek kaybı', source: SRC.surface,
        note: 'OFFLINE · CLOUD_UNAVAILABLE · PROVIDER_COOLDOWN · STT_FALLBACK · '
            + 'TTS_FALLBACK. Rozet duruma DİKtir: dinleme sırasında da görünür.' },
      v.lastDegraded));

  f.push(observed(
    { id: 'suWake', label: 'sesle uyandırma / presence', source: SRC.surface,
      note: 'MAVI-F11 · F1 BORCU KAPATILDI: wake ayarı Yol Arkadaşı '
          + 'presence ayarından BAĞIMSIZDIR. Eskiden `companionEnabled && '
          + 'companionWakeWordEnabled` bağı vardı → presence kapalıyken '
          + 'kullanıcının AÇIK işaretlediği ayar sessizce ETKİSİZ kalıyor ve '
          + 'ayar ekranından da kayboluyordu (erişilemeyen gizli durum). '
          + 'Bu iki değerin BAĞIMSIZ olması beklenir; herhangi bir bağ '
          + 'REGRESYON kanıtıdır.' },
    `wake ${v.wakeWordEnabled ? 'AÇIK' : 'KAPALI'} · `
    + `Yol Arkadaşı ${v.companionPresence ? 'AÇIK' : 'KAPALI'}`));

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

/* ── L · Wake tetiğinin akıbeti ─────────────────────────────────────────────
 *
 * SAHA 2026-09-03/04 (K2401 head unit + Xiaomi 23090RA98I): native wake motoru
 * "Hey Mavi"yi YAKALIYOR (`VoiceMicDiagnostics.wake.triggerCount` artıyor,
 * güven %86) ama Mavi HİÇ uyanmıyor — ne selam, ne dinleme, ne durum değişimi.
 * `onWakeWordDetected` beş ayrı kapıda tetiği sessizce düşürebiliyor ve kararı
 * `recordWake` ile ZATEN kaydediyordu; eksik olan tek şey OKUNUR YÜZEYDİ.
 * Bu bölüm o boşluğu kapatır: yeni sayaç üretmez, yeni ölçüm başlatmaz.
 * ─────────────────────────────────────────────────────────────────────────── */

function _wakeForensicsSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const w = s.wakeForensics ?? null;
  const ID: MaviSectionId = 'wake-forensics';

  if (!w) {
    f.push(unavailable(
      { id: 'wfRoot', label: 'wake karar defteri', source: SRC.wakeForensics, note: '' },
      'Wake karar defteri okunamadı — "hiç tetik yok" DEĞİL, ÖLÇÜLEMEDİ.'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  const total = w.total;

  f.push(observed(
    { id: 'wfTotal', label: 'kaydedilen wake kararı', source: SRC.wakeForensics,
      note: 'JS katmanına ULAŞAN tetik sayısı. Native tetik sayacıyla '
          + '(CAROS LAB → STT/Mikrofon · `wake.triggerCount`) KARŞILAŞTIRIN: '
          + 'native artıp bu artmıyorsa kopukluk native↔JS köprüsündedir; '
          + 'ikisi de artıyorsa tetik JS kapılarından birinde düşmüştür.' },
    total === 0 ? '0 (hiç karar kaydedilmedi)' : String(total)));

  /* EN KRİTİK SATIR: hangi kapı yuttu. */
  f.push(observed(
    { id: 'wfLast', label: 'son kararın gerekçesi', source: SRC.wakeForensics,
      note: 'ACCEPTED = oturum açıldı · REJECTED_TOKEN = native eşleşti ama '
          + 'JS kelime-sınırı süzgeci reddetti (iki süzgeç ayrıştı) · '
          + 'SUPPRESSED_PAUSED = bilişsel mod sesi duraklatmış · '
          + 'SUPPRESSED_VOICE_ACTIVE / SUPPRESSED_FOLLOWUP = asistan zaten '
          + 'meşgul · SUPPRESSED_SELF_ECHO = TTS konuşurken kendi sesini '
          + 'duydu · SUPPRESSED_DEBOUNCE = önceki kabule çok yakın · '
          + 'NOT_EVALUATED_MODEL_NOT_READY = model henüz yüklenmemişti.' },
    w.lastReason ? `${w.lastReason} (yol: ${w.lastPath || 'BİLİNMİYOR'})` : 'KAYIT YOK'));

  /* Dağılım: tek bir gerekçe baskınsa kök neden odur. */
  const keys = Object.keys(w.counts);
  if (keys.length === 0) {
    f.push(unavailable(
      { id: 'wfDist', label: 'gerekçe dağılımı', source: SRC.wakeForensics, note: '' },
      'Henüz hiçbir karar kaydedilmedi.'));
  } else {
    f.push(observed(
      { id: 'wfDist', label: 'gerekçe dağılımı', source: SRC.wakeForensics,
        note: 'Tek bir SUPPRESSED_* gerekçesi baskınsa kök neden odur; '
            + 'ACCEPTED yüksek ama `komuta dönen` düşükse sorun wake\'te '
            + 'DEĞİL, sonraki dinleme/anlama adımındadır.' },
      keys.map((k) => `${k}: ${w.counts[k] ?? 0}`).join(' · ')));
  }

  /* Kabul edildi ama sonuçlanmadı — "uyandı ama işe yaramadı" sınıfı.
     SAHA #1258: etiket eskiden yalnız "komut" diyordu, oysa sohbet cevabı da
     geçerli bir turdur; komut yürütmesi olmayan sohbet turları haksız yere
     `SESSİZ KAYIP` sayılıyordu. Ölçülen olgu artık dürüst adlandırılır. */
  f.push(observed(
    { id: 'wfIntent', label: 'kabul → sonuç', source: SRC.wakeForensics,
      note: 'Kabul edilen tetiğin GERÇEKTEN bir sonuca (komut yürütmesi VEYA '
          + 'sohbet cevabı) dönüşüp dönüşmediği. `sonuçlanmayan` sayısı '
          + 'yüksekse kullanıcı uyandırdı ama sistem sessiz kaldı — bu '
          + 'SESSİZ KAYIPTIR ve wake başarısı gibi sayılamaz.' },
    `sonuçlanan ${w.intentReached} · SONUÇLANMAYAN ${w.acceptedNoIntent}`));

  /* Bekleyen kabul: 0 ms ile "yok" ayrımı bilinçlidir. */
  f.push(observed(
    { id: 'wfPending', label: 'bekleyen kabul yaşı', source: SRC.wakeForensics,
      note: 'Kabul edilmiş ama henüz komuta dönmemiş tetiğin yaşı. '
          + '`YOK` ile `0 ms` AYRI şeylerdir: 0 ms = az önce kabul edildi.' },
    w.pendingAcceptAgeMs === null ? 'YOK' : `${Math.round(w.pendingAcceptAgeMs)} ms`));

  if (w.evicted > 0) {
    f.push(observed(
      { id: 'wfEvicted', label: 'tampondan düşen kayıt', source: SRC.wakeForensics,
        note: 'Halka tampon tavanı. Dağılım sayaçları DOYMAZ — düşen kayıtlar '
            + 'yalnız son-N listesinden çıkar, toplamlar korunur.' },
      String(w.evicted)));
  }

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

/* ── J · Barge-in ve konuşma kontrolü (F12) ───────────────────────────────── */

/** `-1` = ölçüm yok → sahte `0` YERİNE dürüst metin. */
function _msOrUnknown(v: number): string {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? `${Math.round(v)} ms` : 'ÖLÇÜM YOK';
}

function _bargeInSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const b = s.bargeIn ?? null;
  const ID: MaviSectionId = 'barge-in';

  if (!b) {
    f.push(unavailable(
      { id: 'bgRoot', label: 'kesme kontrolü', source: SRC.bargeIn, note: '' },
      'Barge-in tanısı okunamadı.'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  /* Duplex sınıfı bir ÖLÇÜMDÜR, bir hedef DEĞİL. `HALF_DUPLEX_INTERRUPT`
     bir arıza değil, ses yolunun kanıtlanmış gerçeğidir. */
  f.push(observed(
    { id: 'bgClass', label: 'duplex sınıfı', source: SRC.bargeIn,
      note: 'BOUNDED 4 sınıf: TRUE_FULL_DUPLEX · AEC_GATED_DUPLEX · '
          + 'HALF_DUPLEX_INTERRUPT · UNSUPPORTED. Sınıf KANITTAN türetilir; '
          + 'kanıt yoksa YÜKSELMEZ (sahte full-duplex yasaktır). '
          + 'HALF_DUPLEX_INTERRUPT = kesme mekaniği TAM (ttsCancel + akış '
          + 'iptali + tur supersede) ama TTS sırasında korumalı yakalama yolu '
          + 'YOK → tetik akustik olamaz, açık kullanıcı eylemi gerekir.' },
    b.duplexClass));

  f.push(observed(
    { id: 'bgEvidence', label: 'duplex kanıtı', source: SRC.bargeIn,
      note: 'Üç kanıt da GEREKLİDİR: (1) TTS sırasında yakalama açık, '
          + '(2) AEC duplex yakalama yolunda etkin — aktif dinleme yolunda '
          + 'ölçülen AEC SAYILMAZ (o yol TTS ile hiç çakışmaz), '
          + '(3) TTS çıkışı iptal ediciye referans sinyali olarak bağlı. '
          + 'Eksik kanıt "muhtemelen vardır"a çevrilmez.' },
    `yakalama açık: ${b.captureOpenDuringTts ? 'EVET' : 'HAYIR'}`
    + ` · AEC (duplex yolu): ${b.aecCountsForDuplex ? 'EVET' : 'HAYIR'}`
    + ` · echo referansı: ${b.echoReferenceWired ? 'BAĞLI' : 'YOK'}`));

  f.push(b.proposals === 0
    ? unavailable(
      { id: 'bgProposals', label: 'kesme önerileri', source: SRC.bargeIn,
        note: 'Bu oturumda hiç kesme önerisi değerlendirilmedi. "0 kabul" '
            + 'yazmak bir ÖLÇÜM gibi görünürdü — ölçüm yokluğu ölçüm DEĞİLDİR.' },
      'Ölçüm yok.')
    : observed(
      { id: 'bgProposals', label: 'kesme önerileri', source: SRC.bargeIn,
        note: 'Öneri ≠ yetki. Hakem yalnız HÜKÜM verir; turu `maviTurn`, sesi '
            + '`ttsService`, akışı `maviResponseStream` kapatır. Kabul edilen '
            + 'kesme eski turu SUPERSEDE eder → geç gelen sağlayıcı sonucu '
            + 'eski cevabı diriltemez.' },
      `${b.proposals} öneri · ${b.accepted} kabul · son hüküm: ${b.lastReason ?? '—'}`
      + (b.countersSaturated ? ' · ⚠ SAYAÇ TAVANI DOLDU (adetler artık gerçek değil)' : '')));

  const reasons = _renderCounts(b.reasons);
  f.push(reasons === null
    ? unavailable({ id: 'bgReasons', label: 'hüküm dağılımı', source: SRC.bargeIn, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'bgReasons', label: 'hüküm dağılımı', source: SRC.bargeIn,
        note: 'REJECTED_SELF_ECHO_RISK = Mavi kendi sesiyle tetiklenmiş '
            + 'olabilir (mikrofon açık, echo koruması kanıtsız). '
            + 'REJECTED_PROTECTED_AUDIO = güvenlik/tehlike/navigasyon sözü '
            + 'kesilemez — kullanıcının Mavi’yi kesebilmesi o kanalları kesme '
            + 'yetkisi DEĞİLDİR. REJECTED_EVIDENCE_INSUFFICIENT = kanıt yok '
            + '(VAD/enerji TEK BAŞINA asla yeterli değildir).' },
      reasons));

  const kinds = _renderCounts(b.evidenceKinds);
  f.push(kinds === null
    ? unavailable({ id: 'bgKinds', label: 'kanıt türü dağılımı', source: SRC.bargeIn, note: '' },
      'Ölçüm yok.')
    : observed(
      { id: 'bgKinds', label: 'kanıt türü dağılımı', source: SRC.bargeIn,
        note: 'EXPLICIT_USER (düğme/donanım) · WAKE_TRIGGER · ASR_PARTIAL · '
            + 'VAD_ENERGY. Transkript ve ham ses BU KATMANA HİÇ GİRMEZ.' },
      kinds));

  /* Gecikme DÜRÜST isimlendirilir: bu bir İSTEK damgasıdır, akustik susma
     kanıtı DEĞİLDİR (F0'ın first_audio_requested/confirmed ayrımıyla aynı). */
  f.push(b.ttsStopSamples === 0
    ? unavailable(
      { id: 'bgTtsStop', label: 'TTS durdurma İSTEĞİ gecikmesi', source: SRC.bargeIn,
        note: 'Kabul edilen kesme → `ttsCancel()` çağrısı arası. Henüz örnek yok.' },
      'Ölçüm yok.')
    : derived(
      { id: 'bgTtsStop', label: 'TTS durdurma İSTEĞİ gecikmesi', source: SRC.bargeIn,
        note: '⚠️ Bu, hoparlörün SUSTUĞU an DEĞİLDİR: native '
            + '`TextToSpeech.stop()` bir isteği kuyruklar. Gerçek akustik '
            + 'susma gecikmesi (spec hedefi p95 ≤ 120 ms) yalnız CİHAZDA '
            + 'ölçülebilir — kütükte DEVICE VALIDATION REQUIRED.' },
      `son ${_msOrUnknown(b.lastTtsStopRequestMs)} · en kötü `
      + `${_msOrUnknown(b.maxTtsStopRequestMs)} · ${b.ttsStopSamples} örnek`));

  f.push(b.listenSamples === 0
    ? unavailable(
      { id: 'bgListen', label: 'yeni dinleme açılış gecikmesi', source: SRC.bargeIn,
        note: 'Kabul edilen kesme → mikrofonun GERÇEKTEN açıldığı an.' },
      'Ölçüm yok.')
    : derived(
      { id: 'bgListen', label: 'yeni dinleme açılış gecikmesi', source: SRC.bargeIn,
        note: 'Native yolda donanım ısınması (warmup) bu süreye DAHİLDİR; '
            + 'görsel "dinliyor" durumu daha erken basılır, ölçüm mikrofonun '
            + 'fiilen açıldığı andan alınır (erken damga KULLANILMAZ).' },
      `son ${_msOrUnknown(b.lastListenOpenMs)} · en kötü `
      + `${_msOrUnknown(b.maxListenOpenMs)} · ${b.listenSamples} örnek`));

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

/* ── K · Kanonik runtime / konsolidasyon (F13) ─────────────────────────────
 *
 * LAB İKİNCİ OTORİTE DEĞİLDİR: burada hiçbir hüküm ÜRETİLMEZ. Alanlar ya
 * mevcut kanıt defterinden sayılır (`observed`) ya da koddaki tek giriş
 * zincirinin BEYANIdır (`derived`). "Gölge yürütmesi 0" iddiası YALNIZ defter
 * tavana dayanmamışken (`bounded === false`) anlamlıdır — aksi hâlde alan
 * açıkça UYARIR.
 */
function _canonicalRuntimeSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const r = s.runtime ?? null;
  const ID: MaviSectionId = 'canonical-runtime';

  /* KAYNAK YOKSA HİÇBİR ŞEY BEYAN EDİLMEZ — mimari cümlesi bile. Kanıt defteri
     okunamıyorken "kanonik zincir şudur" yazmak, doğrulanamayan bir iddiayı
     ölçülmüş gibi gösterirdi (LAB kural 5). */
  if (!r) {
    f.push(unavailable(
      { id: 'rtRoot', label: 'kanonik runtime defteri', source: SRC.runtime, note: '' },
      'Kanıt defteri okunamadı — "gölge çalışmadı" VARSAYILMAZ.'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  /* Aktif yol bir ÖLÇÜM DEĞİL — kod sözleşmesidir; `derived` işaretlenir. */
  f.push(derived(
    { id: 'rtPath', label: 'kanonik giriş zinciri', source: SRC.runtime,
      note: 'F13 sözleşmesi: ses/metin → maviTurn (tek tur otoritesi) → '
          + 'anlama/plan → capabilityFabric → maviActionAuthority → '
          + 'commandExecutor → maviSpeech (tek konuşma otoritesi) → '
          + 'maviMemory (tek izdüşüm). Bu satır ÖLÇÜM DEĞİL, koddaki tek '
          + 'giriş yolunun beyanıdır; kilit testleri bunu kaynakta doğrular.' },
    'turn → plan → fabric → authority → executor → speech → memory'));

  f.push(derived(
    { id: 'rtCompound', label: 'bileşik yürütücü sayısı', source: SRC.runtime,
      note: 'F13 öncesi ÜÇ yol vardı: voiceService.dispatchChain (yerel '
          + 'ayrıştırıcı, gözlemsiz, YÜRÜTMEDEN ÖNCE konuşuyordu) · '
          + '_runBrainPlan (kanonik) · commandExecutor.executeSequence (ölü, '
          + 'paralel, kapısız). Artık ikisi de `capabilityPlanRunner`a bağlı, '
          + 'üçüncüsü SİLİNDİ.' },
    '1 (capabilityPlanRunner)'));

  const warn = r.bounded ? ' · ⚠ DEFTER TAVANI DOLDU (adetler toplam DEĞİL)' : '';

  f.push(r.shadowDecisions === 0
    ? unavailable(
      { id: 'rtShadow', label: 'gölge hat kararları', source: SRC.runtime,
        note: 'Bu oturumda gölge köprü hiç karar kaydetmedi. "0 gölge '
            + 'yürütmesi" YAZILMAZ: ölçüm yokluğu ölçüm değildir.' },
      'Ölçüm yok.')
    : observed(
      { id: 'rtShadow', label: 'gölge hat kararları', source: SRC.runtime,
        note: 'Gölge köprü her sesli komutu GÖZLER ama handler’ları no-op’tur. '
            + 'F13 hedefi: `Mavi yürütmesi = 0` ve `takeover bayrağı = 0`. '
            + 'Bu iki sayı 0 değilse gölge hat ARTIK gölge değildir.' },
      `${r.shadowDecisions} karar · Mavi yürüttü: ${r.maviExecutedDecisions}`
      + ` · yürütme yok: ${r.noExecutionDecisions}`
      + ` · takeover bayraklı: ${r.takeoverFlagDecisions}${warn}`));

  f.push(r.legacyExecutionKeys === 0
    ? unavailable(
      { id: 'rtLegacy', label: 'eski hat yürütmeleri', source: SRC.runtime,
        note: 'Eski hat (useVoiceCommandHandler) bu oturumda kayıt üretmedi.' },
      'Ölçüm yok.')
    : observed(
      { id: 'rtLegacy', label: 'eski hat yürütmeleri', source: SRC.runtime,
        note: 'Bugün KANONİK yürütme yolu budur (fallback DEĞİL): komutlar '
            + '`commandExecutor` üzerinden geçer. Sayı, hattın canlı olduğunun '
            + 'kanıtıdır; sıfırlanması BEKLENMEZ.' },
      `${r.legacyExecutionKeys} komut anahtarı · ${r.legacyExecutionTotal} yürütme${warn}`));

  f.push(observed(
    { id: 'rtDouble', label: 'çift yürütme', source: SRC.runtime,
      note: 'Aynı correlationId’yi HEM gölge hat HEM eski hat yürüttüyse bu '
          + 'bir ARIZADIR (maviOwnership guard’ı delinmiş demektir). Beklenen '
          + 'değer HER ZAMAN 0’dır.' },
    `${r.doubleExecutionKeys} anahtar`));

  f.push(observed(
    { id: 'rtBridge', label: 'köprü yaşam döngüsü', source: SRC.runtime,
      note: 'start − dispose farkı 1’i aşarsa abonelik SIZINTISI vardır.' },
    `${r.bridgeStarts} start · ${r.bridgeDisposes} dispose`));

  f.push(!r.flagsReadable
    ? unavailable(
      { id: 'rtFlags', label: 'açık Mavi bayrakları', source: SRC.runtime, note: '' },
      'Bayrak okuması yapılamadı — "hepsi kapalı" VARSAYILMAZ.')
    : observed(
      { id: 'rtFlags', label: 'açık Mavi bayrakları', source: SRC.runtime,
        note: 'F13 kabul ölçütü: açık bayrak ≤ 2. Liste yalnız bayrak ADIDIR; '
            + 'anahtar/değer/kullanıcı verisi TAŞIMAZ. Boş liste = tüm Mavi '
            + 'şalterleri varsayılan (kapalı) konumda.' },
      r.openFlags.length === 0 ? 'yok (hepsi varsayılan)' : r.openFlags.join(', ')));

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

/* ── M · Anomali tespiti (çapraz-kesen, TÜRETİLMİŞ) ──────────────────────────
 * Yukarıdaki bölümlerin (F/G/L + latency/action) ZATEN topladığı kanıtı okuyup
 * adı konmuş sonuçlar üretir. Bu bölüm YENİ ölçüm YAPMAZ, YENİ karar VERMEZ —
 * `detectMaviAnomalies` saf türetimidir (bkz. `maviForensicModel.ts`). */

const MAVI_ANOMALY_SEVERITY_LABEL: Readonly<Record<MaviAnomalyRecord['severity'], string>> = {
  critical: 'KRİTİK',
  warn:     'UYARI',
  info:     'BİLGİ',
};

function _anomaliesSection(s: MaviRawSnapshot): MaviSection {
  const f: InspectorField[] = [];
  const ID: MaviSectionId = 'anomalies';
  const anomalies = detectMaviAnomalies(s);
  /* En az bir kanıt yüzeyi OKUNABİLMİŞ olmalı — hepsi null iken "0 anomali"
     OBSERVED denemez: bu "kontrol ettim, temiz" DEĞİL, "hiçbir şey ÖLÇEMEDİM"dir. */
  const anyEvidence = s.ttsEngine != null || s.wakeForensics != null || s.aiHealth != null
    || s.turn != null || s.bargeIn != null || s.latency != null || s.actionTrace != null;

  if (!anyEvidence) {
    f.push(unavailable(
      { id: 'anEmpty', label: 'tespit edilen anomali', source: SRC.anomalies, note: '' },
      'Anomali tespiti hiçbir kanıt yüzeyini OKUYAMADI — "0 anomali" İDDİA EDİLEMEZ.'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  if (anomalies.length === 0) {
    f.push(observed(
      { id: 'anEmpty', label: 'tespit edilen anomali', source: SRC.anomalies,
        note: 'Bu, "Mavi sağlıklı" İDDİASI DEĞİLDİR — yalnız aşağıdaki kapsamda '
            + '(TTS motor sonucu · wake sonuçlanma · AI devre kesici · SLA hedefi · '
            + 'eylem zinciri bütünlüğü · eskimiş nesil yakalama · TTS/mikrofon '
            + 'çakışma riski) tanımlı hiçbir eşik AŞILMADI demektir. Native-only '
            + 'sınıflar (mikrofon izni, duplicate wake listener, audio focus) bu '
            + 'katmanda GÖZLEMLENEMEZ — susmaları "yok" ANLAMINA GELMEZ.' },
      '0'));
    return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
  }

  for (const a of anomalies) {
    f.push(derived(
      { id: `an_${a.id}`, label: `${MAVI_ANOMALY_SEVERITY_LABEL[a.severity]} · ${a.id}`,
        source: SRC.anomalies, note: a.evidence },
      a.evidence));
  }

  return { id: ID, title: MAVI_SECTION_TITLE[ID], fields: _bound(f) };
}

export function buildMaviSections(s: MaviRawSnapshot): MaviSection[] {
  if (!s) return [];
  return [
    _lifecycleSection(s), _diagSection(s), _aiHealthSection(s),
    _quotaSection(s), _proactiveSection(s), _speechSection(s), _workloadSection(s),
    _proactivePolicySection(s), _surfaceSection(s), _bargeInSection(s),
    _canonicalRuntimeSection(s), _wakeForensicsSection(s), _anomaliesSection(s),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı satırları — EN YENİDEN ESKİYE
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviDiagRow {
  /** 0 = en yeni. */
  readonly index:            number;
  readonly at:               number | null;
  /** Damga yoksa '—' (sahte tarih YOK). */
  readonly atLabel:          string;
  readonly stage:            string;
  /** Transcript UZUNLUĞU; yoksa null. Metin DEĞİL. */
  readonly transcriptLength: number | null;
  readonly errorCode:        string | null;
  readonly route:            string | null;
  readonly intent:           string | null;
}

/**
 * Görüntülenecek satırlar. `null` = kaynak okunamadı; `[]` = halka boş.
 * Kaynak katmanı diziyi ZATEN en yeni→en eski çevirir; burada sıra KORUNUR ve
 * bounded kırpma EN YENİLERİ tutar.
 */
export function buildMaviDiagRows(s: MaviRawSnapshot): MaviDiagRow[] | null {
  if (!s || s.diag === null) return null;
  const out: MaviDiagRow[] = [];
  const n = Math.min(s.diag.length, MAX_MAVI_DIAG_ROWS);
  for (let i = 0; i < n; i++) {
    const e = s.diag[i];
    out.push({
      index:            i,
      at:               e.at,
      atLabel:          e.at !== null ? new Date(e.at).toISOString() : '—',
      stage:            e.stage,
      transcriptLength: e.transcriptLength,
      errorCode:        e.errorCode,
      route:            e.route,
      intent:           e.intent,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * HÜKÜM — FAIL-CLOSED, ilk eşleşen kazanır
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviVerdict =
  | 'UNKNOWN' | 'AI_BLOCKED' | 'ERROR' | 'MIC_UNAVAILABLE' | 'RUNNING' | 'READY';

export const MAVI_VERDICT_LABEL: Readonly<Record<MaviVerdict, string>> = {
  UNKNOWN:         'BİLİNMİYOR',
  AI_BLOCKED:      'AI GEÇİCİ BLOKE',
  ERROR:           'HATA',
  MIC_UNAVAILABLE: 'MİKROFON KULLANILAMIYOR',
  RUNNING:         'ÇALIŞIYOR',
  READY:           'HAZIR',
} as const;

export interface MaviVerdictResult {
  readonly status:  MaviVerdict;
  readonly reasons: readonly string[];
}

/**
 * KURAL SIRASI (ilk eşleşen kazanır):
 *  1. Tüm ANA kaynaklar okunamadı                      → BİLİNMİYOR
 *  2. AI devre kesici blockedForMs > 0                 → AI GEÇİCİ BLOKE
 *  3. Ses hatası VAR *veya* EN YENİ tanı kaydı errorCode taşıyor → HATA
 *  4. micAvailable === false                           → MİKROFON KULLANILAMIYOR
 *  5. status aktif kümede ('listening' | 'processing') → ÇALIŞIYOR
 *  6. mic VAR ve status bekleme kümesinde ('idle' | 'success') → HAZIR
 *  7. Diğer her durum                                  → BİLİNMİYOR
 *
 * NOT: `throttled` ve repoda TANIMSIZ her durum (7)'ye düşer. Bilinmeyen bir
 * duruma "HAZIR" demek sahte güven üretirdi — tahmin YASAK.
 */
export function deriveMaviVerdict(s: MaviRawSnapshot): MaviVerdictResult {
  const reasons: string[] = [];
  const push = (r: string): void => { if (reasons.length < MAX_MAVI_REASONS) reasons.push(r); };

  if (!s) return { status: 'UNKNOWN', reasons: ['Anlık görüntü okunamadı.'] };

  const v = s.voice;
  const a = s.aiHealth;

  // 1 — hiçbir ana kaynak okunamadı
  if (v === null && a === null && s.quota === null && s.diag === null) {
    return {
      status: 'UNKNOWN',
      reasons: ['Hiçbir ana kaynak okunamadı (ses · tanı · AI sağlığı · kota) — hüküm verilemez.'],
    };
  }

  // 2 — AI devre kesici
  if (a && a.blockedForMs > 0) {
    push(`AI devre kesici AÇIK: ${a.blockedForMs} ms daha bloke.`);
    push('Bu bir AĞ/AI durumu; mikrofon ve STT ayrıca değerlendirilir.');
    return { status: 'AI_BLOCKED', reasons };
  }

  // 3 — hata (ses durumu veya EN YENİ tanı kaydının hata kodu)
  const newestDiag = s.diag && s.diag.length > 0 ? s.diag[0] : null;
  const newestErr  = newestDiag && newestDiag.errorCode ? newestDiag.errorCode : null;
  if ((v && (v.hasError || v.status === 'error')) || newestErr !== null) {
    if (v && v.hasError) push('Ses katmanında hata kaydı VAR (mesaj GÖSTERİLMEZ).');
    if (v && v.status === 'error') push('Ses durumu: error.');
    if (newestErr !== null) push(`En yeni tanı kaydı hata kodu taşıyor: ${newestErr}`);
    return { status: 'ERROR', reasons };
  }

  // 4 — mikrofon
  if (v && v.micAvailable === false) {
    push('micAvailable = false — mikrofon izni/donanımı kullanılamıyor.');
    return { status: 'MIC_UNAVAILABLE', reasons };
  }

  // 5 — aktif iş
  if (v && MAVI_ACTIVE_VOICE_STATUS.indexOf(v.status) >= 0) {
    push(`Ses durumu aktif işlem: ${v.status}.`);
    return { status: 'RUNNING', reasons };
  }

  // 6 — hazır (POZİTİF KANIT ŞARTI: ses kaynağı GERÇEKTEN okunmuş olmalı)
  if (v && v.micAvailable === true && MAVI_WAITING_VOICE_STATUS.indexOf(v.status) >= 0) {
    push(`Mikrofon kullanılabilir ve ses durumu beklemede: ${v.status}.`);
    return { status: 'READY', reasons };
  }

  // 7 — fail-closed
  if (v === null) {
    push('Ses anlık görüntüsü okunamadı — "hazır" VARSAYILMAZ.');
  } else if (MAVI_KNOWN_VOICE_STATUS.indexOf(v.status) < 0) {
    push(`Ses durumu repoda TANIMSIZ: "${v.status}" — tahmin edilmez.`);
  } else {
    push(`Ses durumu "${v.status}" ne aktif ne bekleme kümesinde — hüküm verilmez.`);
  }
  return { status: 'UNKNOWN', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rozet sayaçları
 * ════════════════════════════════════════════════════════════════════════ */

export function countByMaviClass(
  sections: readonly MaviSection[],
): Record<Observability, number> {
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
