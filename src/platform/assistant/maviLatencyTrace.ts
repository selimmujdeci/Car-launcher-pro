/**
 * maviLatencyTrace — MAVİ F0 · CANLI HAT uçtan uca gecikme kaydedicisi.
 *
 * ── NEDEN AYRI MODÜL (mevcut telemetri neden yeniden kullanılamadı) ─────────
 * Repoda iki ölçüm katmanı ZATEN var ve ikisi de KORUNUR:
 *   1. `maviCore/latencyTelemetry` — SHADOW orkestratörün turunu ölçer. Marker
 *      sözlüğü altı öğedir (wake·listening·speechEnd·planStart·firstAction·complete)
 *      ve `beginSession(sessionId)` ile SHADOW lifecycle'a bağlıdır. STT · beyin ·
 *      TTS · ses başlangıcı · filler · route · outcome KAVRAMLARI YOKTUR ve
 *      `SessionLatency` bunları taşıyacak alana sahip değildir. Genişletmek
 *      `maviCore`ün dondurulmuş sözleşmesini ve testlerini kırardı.
 *   2. `sttLatencyTelemetry` — native Vosk FAZLARINI ölçer ve CANLIDIR.
 *      **Bu modül onu YENİDEN ÖLÇMEZ**: ürettiği `speechEndDetectedAtMs` /
 *      `firstSpeechDetectedAtMs` deltalarını TÜRETİLMİŞ marker olarak İÇERİ ALIR.
 *
 * Yani bu modül üçüncü bir ölçüm sistemi DEĞİL, canlı hattın uçtan uca
 * KORELASYON katmanıdır (F13'te tek çekirdekle birleşecek).
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · YALNIZ ÖLÇÜM. Hiçbir karar, akış, TTS, UI veya native davranış etkilenmez.
 *  · BAĞIMSIZ: bu dosya HİÇBİR modülü import etmez → hangi yaprağa (voiceClips,
 *    edgeTtsService…) eklenirse eklensin Mavi'nin bağımlılık grafiğini büyütmez.
 *  · MONOTONİK: tüm damgalar `performance.now()`; duvar saati (Date.now) süre
 *    hesabında ASLA kullanılmaz (CLAUDE.md §4 clock-jump koruması).
 *  · İLK GERÇEKLEŞME KAZANIR: aynı marker tekrar gelirse ilk damga korunur
 *    (tekrar sayaçla görünür — sessizce yutulmaz).
 *  · TUR İZOLASYONU: aynı anda EN FAZLA bir açık iz vardır. Yeni iz açılırken
 *    açık olan `superseded` ile kapanır → iki turun markerları KARIŞAMAZ.
 *  · BOUNDED: sabit tavanlı halka (20 iz). Kalıcı depo YOK, disk I/O YOK.
 *  · GİZLİLİK: transcript · n-best · prompt · cevap metni · kişi · konum · VIN
 *    BU MODÜLE GİRMEZ. Yalnız süre, sabit marker adı, sanitize edilmiş route/
 *    provider kodu, bounded enum ve sayaç taşınır.
 *  · FAIL-SOFT: hiçbir public fonksiyon throw ETMEZ.
 *  · BAYRAK: varsayılan KAPALI. Kapalıyken `openMaviLatencyTrace()` iz AÇMAZ ve
 *    tüm `mark*` çağrıları tek `if` ile döner (üretim davranışı birebir aynı).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Marker sözlüğü (kanonik)
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviLatencyMarker =
  /** Mikrofon/dinleme oturumu açıldı (iz burada doğar). */
  | 'listen_start'
  /** Native STT isteği köprüden geçti — native `listenRequestedAt` ankoruyla hizalı. */
  | 'stt_request_start'
  /** Konuşma algılandı (native VAD deltasından TÜRETİLİR). */
  | 'speech_start'
  /** Konuşma bitti / endpoint (native VAD deltasından TÜRETİLİR). */
  | 'speech_end'
  /** STT sonucu JS'e ulaştı (Vosk veya Google — köprü çözümü). */
  | 'stt_result'
  /**
   * MAVI-F3 · İLK KISMİ TRANSKRİPT JS'e ulaştı — "Mavi kullanıcıyı DİNLERKEN
   * anlamaya başladı" anı. Sağlayıcı kısmi sonuç vermiyorsa (FINAL_ONLY) HİÇ
   * damgalanmaz (sahte taban üretilmez).
   */
  | 'first_partial'
  /**
   * MAVI-F3 · Kısmi metin ARTIK BÜYÜMÜYOR (ASR kararlılığı) — semantik endpoint
   * kanıtının çekirdeği. Yalnız kararlılık eşiği ilk kez aşıldığında damgalanır.
   */
  | 'stable_partial'
  /**
   * MAVI-F3 · Kısmi metin anlamca TAMAMLANMIŞ göründü (aday). **Karar DEĞİLDİR**
   * ve eylem yetkisi TAŞIMAZ — yalnız endpoint kararına giren bir kanıttır.
   */
  | 'semantic_complete_candidate'
  /**
   * MAVI-F3 · Konuşmanın bittiğine KARAR VERİLDİ. Sebep ayrı alanda tutulur
   * (`endpointReason`) — bu damga yalnız ANI taşır.
   */
  | 'endpoint_decision'
  /**
   * MAVI-F3 · Nihai transkript kullanılabilir hâle geldi (karar → metin gecikmesi
   * bu damga ile `endpoint_decision` arasında ölçülür).
   */
  | 'final_transcript_ready'
  /** Bulut STT (Groq Whisper / Gemini) isteği başladı. */
  | 'cloud_stt_start'
  /** Bulut STT sonucu döndü (başarılı ya da boş — süre yine ödendi). */
  | 'cloud_stt_end'
  /** Niyet/router karar üretimi başladı (`processTextCommand` planlama noktası). */
  | 'route_start'
  /** Sağlayıcı (beyin) isteği başladı. */
  | 'brain_request_start'
  /**
   * İlk LLM token'ı. **MAVI-F4'te CANLANDI:** token akışı destekleyen yolda
   * (`TOKEN_STREAM`) ilk token geldiğinde damgalanır. Akış desteklemeyen yolda
   * (`FINAL_ONLY`) HİÇ damgalanmaz — sahte taban üretilmez.
   */
  | 'brain_first_token'
  /** MAVI-F4 · İlk GÜVENLİ konuşma parçası hazır (chunker sınır buldu). */
  | 'first_speech_chunk_ready'
  /** MAVI-F4 · İlk parça için TTS sentezi İSTENDİ. */
  | 'first_tts_chunk_request'
  /** MAVI-F4 · İlk parçanın sesi hazır/çalmaya verildi. */
  | 'first_tts_chunk_ready'
  /** MAVI-F4 · LLM token akışı normal biçimde tamamlandı. */
  | 'llm_stream_complete'
  /** MAVI-F4 · Tüm parçalar seslendirildi — konuşma oturumu kapandı. */
  | 'tts_stream_complete'
  /** MAVI-F4 · Akış iptal edildi (barge-in · yeni tur · sağlayıcı öldü). */
  | 'stream_cancelled'
  /** Sağlayıcı cevabı tamamlandı (veya timeout/hata ile döndü). */
  | 'brain_complete'
  /**
   * Yapay ara söz ("Bir saniye…") YAKALANDI.
   *
   * MAVI-F2 SONRASI ANLAMI DEĞİŞTİ (metrik KALDIRILMADI): filler artık üretim
   * yollarından silinmiştir ve `maviSpeech` I11 kapısı içeriksiz bir ara sözü
   * KONUŞMADAN düşürür. Bu damga o kapıda basılır → **üretimde beklenen değer 0**;
   * sıfırdan büyük her değer bir REGRESYON kanıtıdır (bir çağrı yeri ya da model
   * `feedback`'i filler'ı geri getirmiş). Seslendirme OLMADIĞI için
   * `fillerEmissionCount` hedefi (0) ile çelişmez.
   */
  | 'filler_trigger'
  /**
   * MAVI-F2 · **Semantik ACK seslendirildi** ("Araç sistemleri taranıyor").
   * Filler DEĞİLDİR: gerçek ve süren bir işin başladığını bildirir, bittiğini
   * İDDİA ETMEZ. Ayrı damga tutulur ki ACK yanlışlıkla filler sayılmasın.
   */
  | 'ack_emitted'
  /** Nihai cevap seslendirme otoritesine (`speakMaviAnswer` tier=answer) verildi. */
  | 'tts_request'
  /** Sentezlenmiş ses verisi hazır (Edge/online blob) — native/web yolunda YOKTUR. */
  | 'tts_audio_ready'
  /** Oynatma İSTENDİ: `play()` çağrıldı / native `speak()` kuyruklandı. KANIT DEĞİL. */
  | 'first_audio_requested'
  /** Oynatmanın GERÇEKTEN başladığı platform geri bildirimi (`playing` / `onstart`). */
  | 'first_audio_confirmed'
  /** Seslendirme bitti (ttsService tek çıkış noktası `_notifyTtsEnd`). */
  | 'response_complete'
  /** Kullanıcı Mavi'nin sözünü kesti / yeni dinlemeye geçti. */
  | 'barge_in';

const VALID_MARKERS: ReadonlySet<string> = new Set<MaviLatencyMarker>([
  'listen_start', 'stt_request_start', 'speech_start', 'speech_end', 'stt_result',
  'cloud_stt_start', 'cloud_stt_end', 'route_start', 'brain_request_start',
  'first_partial', 'stable_partial', 'semantic_complete_candidate',
  'endpoint_decision', 'final_transcript_ready',
  'first_speech_chunk_ready', 'first_tts_chunk_request', 'first_tts_chunk_ready',
  'llm_stream_complete', 'tts_stream_complete', 'stream_cancelled',
  'brain_first_token', 'brain_complete', 'filler_trigger', 'ack_emitted', 'tts_request',
  'tts_audio_ready', 'first_audio_requested', 'first_audio_confirmed',
  'response_complete', 'barge_in',
]);

/**
 * SES damgaları — YALNIZ `tts_request` (Mavi'nin NİHAİ cevabı) damgalandıktan
 * sonra kabul edilir.
 *
 * NEDEN (ölçülen kusur): `ttsService` tek seslendirme otoritesidir ve Mavi'nin
 * cevabı DIŞINDA da konuşur — navigasyon talimatı (`speakNavigation`), güvenlik
 * uyarısı (`speakSafetyAlert`), tehlike uyarısı, bildirim okuma. Bir Mavi izi
 * AÇIKKEN bunlardan biri çalarsa (uzun yolda navigasyon talimatı sıradan bir
 * durumdur) ses damgası o ize düşer ve "ilk gerçekleşme kazanır" kuralı yüzünden
 * ANA METRİĞİ KALICI OLARAK BOZARDI: Mavi henüz cevabı üretmeden "ilk ses geldi"
 * ölçülürdü. Kapı bunu yapısal olarak imkânsız kılar.
 *
 * Yan etkisi de doğrudur: ARA SÖZ (`progress`/filler) `tts_request` DAMGALAMAZ →
 * filler'ın sesi "cevabın ilk sesi" sayılmaz.
 */
const AUDIO_MARKERS: ReadonlySet<string> = new Set<MaviLatencyMarker>([
  'tts_audio_ready', 'first_audio_requested', 'first_audio_confirmed',
]);

/**
 * MAVI-F3 · Bounded allowlist'ler. Serbest metin bu katmana GİREMEZ; bilinmeyen
 * değer sessizce yutulmaz, `invalidMarks` sayacında GÖRÜNÜR.
 */
const VALID_ENDPOINT_REASONS: ReadonlySet<string> = new Set([
  'FINAL_PROVIDER', 'SEMANTIC_CONFIDENT', 'ACOUSTIC_TIMEOUT',
  'MAX_DURATION_FAILSAFE', 'CANCELLED',
]);
const VALID_COMPLETENESS: ReadonlySet<string> = new Set([
  'EMPTY', 'DANGLING', 'UNKNOWN', 'COMPLETE',
]);
const VALID_STT_CAPABILITIES: ReadonlySet<string> = new Set([
  'STREAMING_WITH_VAD', 'STREAMING_TEXT_ONLY', 'FINAL_ONLY', 'UNAVAILABLE',
]);

/** MAVI-F4 · Akış yeteneği/bitiş allowlist'leri — sahte iddia yapısal olarak imkânsız. */
const VALID_LLM_CAPABILITIES: ReadonlySet<string> = new Set([
  'TOKEN_STREAM', 'CHUNK_STREAM', 'FINAL_ONLY',
]);
const VALID_TTS_CAPABILITIES: ReadonlySet<string> = new Set([
  'TRUE_STREAMING', 'CHUNKED_SYNTHESIS', 'FULL_SENTENCE_ONLY', 'NATIVE_FINAL_ONLY',
]);
const VALID_STREAM_END_REASONS: ReadonlySet<string> = new Set([
  'COMPLETED', 'CANCELLED', 'UPSTREAM_STALLED', 'SPEECH_STALLED', 'EMPTY',
]);

/** Damganın kökeni — TÜRETİLMİŞ değer ÖLÇÜLMÜŞ gibi sunulmaz. */
export type MaviMarkerOrigin = 'observed' | 'derived';

export interface MaviLatencyMark {
  readonly at: number;
  readonly origin: MaviMarkerOrigin;
}

/* ══════════════════════════════════════════════════════════════════════════
 * İz kaydı
 * ════════════════════════════════════════════════════════════════════════ */

/** Turun nasıl bittiği — bounded (serbest metin YOK). */
export type MaviTraceOutcome =
  | 'completed'
  | 'cancelled'
  | 'timeout'
  | 'error'
  | 'no_speech'
  | 'superseded'
  | 'open';

const VALID_OUTCOMES: ReadonlySet<string> = new Set<MaviTraceOutcome>([
  'completed', 'cancelled', 'timeout', 'error', 'no_speech', 'superseded', 'open',
]);

/**
 * "İlk duyulabilir ses" kanıt düzeyi — **proxy'yi doğrulanmış gibi etiketleme
 * yasağının** kod karşılığı.
 *
 *  NONE      — oynatma hiç istenmedi.
 *  REQUESTED — `play()` çağrıldı / native `speak()` kuyruklandı. Sesin gerçekten
 *              çıktığı KANITLANMADI (dosya hazır ≠ ses duyuldu).
 *  CONFIRMED — platform gerçek başlangıç geri bildirimi verdi
 *              (`HTMLAudioElement.playing` · `SpeechSynthesisUtterance.onstart`).
 *
 * Android native `TextToSpeech` bu derlemede başlangıç geri bildirimi VERMEZ —
 * native köprünün seslendirme çağrısı ancak konuşma BİTİNCE çözülür
 * (`UtteranceProgressListener.onDone`) → native yolda düzey REQUESTED'te kalır
 * ve ekran bunu açıkça söyler.
 *
 * NOT (kasıtlı yazım): bu dosya native seslendirme API'sinin adını çağrı biçiminde
 * YAZMAZ. `maviAuthorityGuard` "TTS tek otorite" kilidi kaynak metninde o deseni
 * arar; ölçüm modülünün bir yorum yüzünden "bypass borcu" listesine girmesi kilidi
 * anlamsızlaştırırdı. Kilit haklıdır ve zayıflatılmaz — metin ona uyar.
 */
export type FirstAudioEvidence = 'NONE' | 'REQUESTED' | 'CONFIRMED';

export interface MaviLatencyTrace {
  /** Süreç-içi monotonik iz kimliği (tur kimliğinden AYRI — iz turdan ÖNCE doğar). */
  readonly traceId: number;
  /** `beginMaviTurn()` kimliği; iz henüz bir tura bağlanmadıysa null. */
  readonly turnId: number | null;
  readonly marks: Readonly<Partial<Record<MaviLatencyMarker, MaviLatencyMark>>>;
  /** Sanitize edilmiş yönlendirme kodu (kod sabiti — kullanıcı metni DEĞİL). */
  readonly route: string | null;
  /** Sanitize edilmiş sağlayıcı kodu. */
  readonly provider: string | null;
  /**
   * MAVI-F1 · Turun PRESENCE kipi — `companion` (Yol Arkadaşı açık) ·
   * `assistant` (kapalı). Bounded enum; kullanıcı metni DEĞİLDİR.
   * Yetenek farkını GÖSTERMEZ (yetenekler her iki kipte aynıdır) — yalnız
   * gecikme/route dağılımının hangi tonda ölçüldüğünü ayırt eder.
   */
  readonly presence: 'companion' | 'assistant' | null;
  readonly outcome: MaviTraceOutcome;
  /** Bounded terminal sebep kodu (timeout/hata sınıfı) — serbest metin DEĞİL. */
  readonly failureCode: string | null;
  /** MAVI-F2: KONUŞULMADAN düşürülen yapay ara söz adedi (hedef: 0). */
  readonly fillerCount: number;
  /** MAVI-F2: seslendirilen semantik ACK adedi — filler SAYILMAZ. */
  readonly ackCount: number;
  /** MAVI-F3: bu turda işlenen kısmi transkript adedi (METİN TAŞINMAZ). */
  readonly partialCount: number;
  /** MAVI-F3: konuşmanın neden bittiği — bounded enum, serbest metin DEĞİL. */
  readonly endpointReason: string | null;
  /** MAVI-F3: kısmi metnin anlam sınıfı (karar anında) — bounded enum. */
  readonly endpointCompleteness: string | null;
  /** MAVI-F3: sağlayıcıya "şimdi bitir" komutu GERÇEKTEN gönderildi mi. */
  readonly endpointCommanded: boolean;
  /** MAVI-F3: dinleme yolunun bildirdiği akış yeteneği — bounded enum. */
  readonly sttCapability: string | null;
  /** MAVI-F4: bu turda seslendirilen konuşma parçası adedi (METİN TAŞINMAZ). */
  readonly speechChunkCount: number;
  /** MAVI-F4: LLM'in bildirdiği akış yeteneği — bounded enum. */
  readonly llmCapability: string | null;
  /** MAVI-F4: TTS katmanının bildirdiği akış yeteneği — bounded enum. */
  readonly ttsCapability: string | null;
  /** MAVI-F4: akışın nasıl bittiği — bounded enum (serbest metin DEĞİL). */
  readonly streamEndReason: string | null;
  /** MAVI-F5: eylemin hangi yoldan geçtiği — `CAPABILITY` | `LEGACY_FALLBACK`. */
  readonly capabilityRoute: string | null;
  /** MAVI-F5: çözülen capability kimliği (KATALOG değeri — kullanıcı verisi DEĞİL). */
  readonly capabilityId: string | null;
  /** MAVI-F5: çözülen işlem adı (katalog değeri). */
  readonly capabilityOperation: string | null;
  /** MAVI-F5: registry availability kanıtı — bounded enum. */
  readonly capabilityAvailability: string | null;
  /** MAVI-F5: tipli doğrulama sonucu — `OK` ya da bounded hata sınıfı. */
  readonly capabilityValidation: string | null;
  /** MAVI-F5: gözlem seviyesi — bounded enum ("yaptım" iddiası buradan gelir). */
  readonly capabilityObservation: string | null;
  /** MAVI-F5: kapı ZORLAYICI mıydı (false = gölge ölçüm). */
  readonly capabilityEnforced: boolean;
  /** MAVI-F6: bileşik plandaki YAŞAYAN adım adedi (0 = plan kurulmadı). */
  readonly planItemCount: number;
  /** MAVI-F6: adımlar arası bağımlılık adedi. */
  readonly planDependencyCount: number;
  /** MAVI-F6: açık onay bekleyen adım adedi. */
  readonly planConfirmationCount: number;
  /** MAVI-F6: KANITLI başarıya ulaşan adım adedi (EXECUTED + OBSERVED). */
  readonly planExecutedCount: number;
  /** MAVI-F6: başarısız adım adedi. */
  readonly planFailedCount: number;
  /** MAVI-F6: iptal edilen adım adedi. */
  readonly planCancelledCount: number;
  /** MAVI-F6: planın bütünsel sonucu — bounded enum. */
  readonly planResultClass: string | null;
  /** MAVI-F8: turun sürüş iş yükü seviyesi — bounded enum. */
  readonly workloadLevel: string | null;
  /** MAVI-F8: hükmü doğuran kanıt ADEDİ (kanıt KODU/ölçümü taşınmaz). */
  readonly workloadEvidenceCount: number;
  /** MAVI-F8: türetilen konuşma bütçesi sınıfı — bounded enum. */
  readonly responseBudgetClass: string | null;
  /** MAVI-F8: cevap bütçe yüzünden KISALDI mı. */
  readonly responseShortened: boolean;
  /** MAVI-F8: serbest sohbet cevabı ERTELENDİ mi (DEFERRED ≠ COMPLETED). */
  readonly responseDeferred: boolean;
  readonly bargeIn: boolean;
  /** Aynı marker'ın kaç kez tekrar geldiği (ilk damga korunur). */
  readonly duplicateMarks: number;
  /** İzin kapandığı an (monotonik); açıksa null. */
  readonly closedAt: number | null;
}

export interface MaviLatencyEvidence {
  readonly enabled: boolean;
  readonly traces: readonly MaviLatencyTrace[];
  readonly capacity: number;
  readonly openTraceId: number | null;
  readonly tracesOpened: number;
  readonly tracesClosed: number;
  /** Açık iz yokken gelen marker sayısı (enstrümantasyon boşluğu göstergesi). */
  readonly orphanMarks: number;
  readonly invalidMarks: number;
  readonly duplicateMarks: number;
  /**
   * Mavi'nin cevabı seslendirmeye verilmeden gelen ses damgası sayısı —
   * navigasyon/güvenlik/bildirim kanalının konuştuğu anlar. DÜŞÜLDÜ, sayıldı.
   */
  readonly foreignAudioMarks: number;
  readonly countersSaturated: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlar
 * ════════════════════════════════════════════════════════════════════════ */

export const MAVI_LATENCY_RING_MAX = 20;
export const MAVI_LATENCY_CODE_MAX_CHARS = 24;
const MAX_COUNTER = 1_000_000;

/** Yerel geliştirme/LAB kaldıracı — YALNIZ tam `"true"` açar (fail-closed). */
export const MAVI_LATENCY_LOCAL_FLAG = 'mavi.latencyTrace.enabled';
/** Uzak yapılandırma bayrağı adı (değeri composition root enjekte eder). */
export const MAVI_LATENCY_REMOTE_FLAG = 'mavi_latency_trace';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum (süreç ömürlü · kalıcı depo YOK)
 * ════════════════════════════════════════════════════════════════════════ */

interface OpenTrace {
  traceId: number;
  turnId: number | null;
  marks: Map<MaviLatencyMarker, MaviLatencyMark>;
  route: string | null;
  provider: string | null;
  presence: 'companion' | 'assistant' | null;
  failureCode: string | null;
  fillerCount: number;
  ackCount: number;
  partialCount: number;
  endpointReason: string | null;
  endpointCompleteness: string | null;
  endpointCommanded: boolean;
  sttCapability: string | null;
  speechChunkCount: number;
  llmCapability: string | null;
  ttsCapability: string | null;
  streamEndReason: string | null;
  capabilityRoute: string | null;
  capabilityId: string | null;
  capabilityOperation: string | null;
  capabilityAvailability: string | null;
  capabilityValidation: string | null;
  capabilityObservation: string | null;
  capabilityEnforced: boolean;
  workloadLevel: string | null;
  workloadEvidenceCount: number;
  responseBudgetClass: string | null;
  responseShortened: boolean;
  responseDeferred: boolean;
  planItemCount: number;
  planDependencyCount: number;
  planConfirmationCount: number;
  planExecutedCount: number;
  planFailedCount: number;
  planCancelledCount: number;
  planResultClass: string | null;
  bargeIn: boolean;
  duplicateMarks: number;
}

let _remoteFlag = false;
let _traceSeq = 0;
let _open: OpenTrace | null = null;
const _ring: MaviLatencyTrace[] = [];

let _tracesOpened = 0;
let _tracesClosed = 0;
let _orphanMarks = 0;
let _invalidMarks = 0;
let _duplicateMarks = 0;
let _foreignAudioMarks = 0;

function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }

function _now(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      const t = performance.now();
      if (typeof t === 'number' && Number.isFinite(t)) return t;
    }
  } catch { /* fail-soft */ }
  return 0;
}

/**
 * Kod alanı temizliği: yalnız `[a-z0-9_]`, en fazla 24 karakter.
 * Çağıranlar KOD SABİTİ geçer (`companion_action`, `gemini`…); bu kapı yine de
 * yapısal garantidir — serbest kullanıcı metni bu alanlardan İÇERİ SIZAMAZ.
 */
function _sanitizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAVI_LATENCY_CODE_MAX_CHARS);
  return s.length > 0 ? s : null;
}

/**
 * MAVI-F5: capability kimlikleri NOKTA içerir (`navigation.route`) — genel kod
 * temizleyici noktayı silip `navigationroute` üretirdi. Bu sürüm noktaya izin
 * verir; kalan karakter kümesi AYNI derecede dardır (serbest kullanıcı metni
 * yine SIZAMAZ) ve uzunluk tavanı aynıdır.
 */
function _sanitizeCapabilityCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, MAVI_LATENCY_CODE_MAX_CHARS);
  return s.length > 0 ? s : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bayrak
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Uzak bayrağın değerini enjekte eder (composition root çağırır).
 * Bu modül `remoteConfigService`i İMPORT ETMEZ — bağımsızlık sözleşmesi (§başlık).
 */
export function setMaviLatencyTraceRemoteFlag(enabled: boolean): void {
  _remoteFlag = enabled === true;
}

function _readLocalFlag(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(MAVI_LATENCY_LOCAL_FLAG) === 'true';
  } catch {
    return false;                                   // depo kilitli/kotalı → KAPALI
  }
}

/**
 * Ölçüm açık mı. Varsayılan `false`. Değer İZ BAŞINA okunur (tur ortasında
 * değişip yarım iz üretemez); şalter çevrildikten sonra BİR SONRAKİ tur ölçülür.
 */
export function isMaviLatencyTraceEnabled(): boolean {
  return _remoteFlag || _readLocalFlag();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

function _freezeOpen(t: OpenTrace, outcome: MaviTraceOutcome, closedAt: number | null): MaviLatencyTrace {
  const marks: Partial<Record<MaviLatencyMarker, MaviLatencyMark>> = {};
  t.marks.forEach((v, k) => { marks[k] = v; });
  return Object.freeze({
    traceId: t.traceId,
    turnId: t.turnId,
    marks: Object.freeze(marks),
    route: t.route,
    provider: t.provider,
    presence: t.presence,
    outcome,
    failureCode: t.failureCode,
    fillerCount: t.fillerCount,
    ackCount: t.ackCount,
    partialCount: t.partialCount,
    endpointReason: t.endpointReason,
    endpointCompleteness: t.endpointCompleteness,
    endpointCommanded: t.endpointCommanded,
    sttCapability: t.sttCapability,
    speechChunkCount: t.speechChunkCount,
    llmCapability: t.llmCapability,
    ttsCapability: t.ttsCapability,
    streamEndReason: t.streamEndReason,
    capabilityRoute: t.capabilityRoute,
    capabilityId: t.capabilityId,
    capabilityOperation: t.capabilityOperation,
    capabilityAvailability: t.capabilityAvailability,
    capabilityValidation: t.capabilityValidation,
    capabilityObservation: t.capabilityObservation,
    capabilityEnforced: t.capabilityEnforced,
    workloadLevel: t.workloadLevel,
    workloadEvidenceCount: t.workloadEvidenceCount,
    responseBudgetClass: t.responseBudgetClass,
    responseShortened: t.responseShortened,
    responseDeferred: t.responseDeferred,
    planItemCount: t.planItemCount,
    planDependencyCount: t.planDependencyCount,
    planConfirmationCount: t.planConfirmationCount,
    planExecutedCount: t.planExecutedCount,
    planFailedCount: t.planFailedCount,
    planCancelledCount: t.planCancelledCount,
    planResultClass: t.planResultClass,
    bargeIn: t.bargeIn,
    duplicateMarks: t.duplicateMarks,
    closedAt,
  });
}

function _pushRing(entry: MaviLatencyTrace): void {
  _ring.push(entry);
  if (_ring.length > MAVI_LATENCY_RING_MAX) {
    _ring.splice(0, _ring.length - MAVI_LATENCY_RING_MAX);
  }
  _tracesClosed = _bump(_tracesClosed);
}

/**
 * Yeni bir dinleme izi açar ve `listen_start` damgasını basar.
 *
 * Açık bir iz varsa TUR İZOLASYONU için `superseded` ile kapatılır — böylece
 * kullanıcı cevabı beklemeden yeni komut verdiğinde iki turun markerları
 * karışmaz. Bayrak kapalıysa hiçbir şey yapılmaz (`null` döner).
 */
export function openMaviLatencyTrace(): number | null {
  try {
    if (!isMaviLatencyTraceEnabled()) {
      // Şalter kapatıldıysa uçuşta kalmış izi de bırak (sızıntı yok).
      _open = null;
      return null;
    }
    const now = _now();
    if (_open) _pushRing(_freezeOpen(_open, 'superseded', now));

    _traceSeq = _traceSeq >= Number.MAX_SAFE_INTEGER ? 1 : _traceSeq + 1;
    _open = {
      traceId: _traceSeq,
      turnId: null,
      marks: new Map<MaviLatencyMarker, MaviLatencyMark>([
        ['listen_start', { at: now, origin: 'observed' }],
      ]),
      route: null,
      provider: null,
      presence: null,
      failureCode: null,
      fillerCount: 0,
      ackCount: 0,
      partialCount: 0,
      endpointReason: null,
      endpointCompleteness: null,
      endpointCommanded: false,
      sttCapability: null,
      speechChunkCount: 0,
      llmCapability: null,
      ttsCapability: null,
      streamEndReason: null,
      capabilityRoute: null,
      capabilityId: null,
      capabilityOperation: null,
      capabilityAvailability: null,
      capabilityValidation: null,
      capabilityObservation: null,
      capabilityEnforced: false,
      workloadLevel: null,
      workloadEvidenceCount: 0,
      responseBudgetClass: null,
      responseShortened: false,
      responseDeferred: false,
      planItemCount: 0,
      planDependencyCount: 0,
      planConfirmationCount: 0,
      planExecutedCount: 0,
      planFailedCount: 0,
      planCancelledCount: 0,
      planResultClass: null,
      bargeIn: false,
      duplicateMarks: 0,
    };
    _tracesOpened = _bump(_tracesOpened);
    return _open.traceId;
  } catch {
    return null;                                     // ölçüm hattı akışı ASLA bozmaz
  }
}

/** Açık izi `beginMaviTurn()` kimliğine bağlar (korelasyon anahtarı). */
export function bindMaviLatencyTurn(turnId: number): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (typeof turnId !== 'number' || !Number.isFinite(turnId)) return;
    if (_open.turnId === null) _open.turnId = turnId;
  } catch { /* fail-soft */ }
}

/**
 * Yönlendirme/sağlayıcı/presence kodunu ize yazar (ilk yazan kazanır).
 *
 * `route`/`provider` serbest kod alanıdır → sanitize edilir. `presence` (MAVI-F1)
 * BOUNDED bir enum'dur → allowlist dışındaki değer sessizce yok sayılır.
 * Yeni telemetri sistemi DEĞİLDİR: mevcut F0 izinin alanı.
 */
export function setMaviLatencyRoute(
  route: string,
  provider?: string,
  presence?: 'companion' | 'assistant',
): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    const r = _sanitizeCode(route);
    if (r && _open.route === null) _open.route = r;
    const p = _sanitizeCode(provider);
    if (p && _open.provider === null) _open.provider = p;
    if ((presence === 'companion' || presence === 'assistant') && _open.presence === null) {
      _open.presence = presence;
    }
  } catch { /* fail-soft */ }
}

/**
 * MAVI-F3 · Dinleme yolunun bildirdiği AKIŞ YETENEĞİ (bounded enum).
 * İlk yazan kazanır; allowlist dışındaki değer sessizce yok sayılır.
 * Sahte streaming iddiası üretilemesin diye enum SABİTTİR.
 */
export function setMaviLatencySttCapability(capability: string): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (!VALID_STT_CAPABILITIES.has(capability)) { _invalidMarks = _bump(_invalidMarks); return; }
    if (_open.sttCapability === null) _open.sttCapability = capability;
  } catch { /* fail-soft */ }
}

/**
 * MAVI-F3 · Konuşmanın NEDEN bittiği + anlam sınıfı + komutun gerçekten
 * gönderilip gönderilmediği. **TRANSKRİPT GEÇMEZ** — yalnız bounded enum ve sayaç.
 *
 * `commanded=false` bir GÖLGE karardır: karar üretildi ve ölçüldü ama sağlayıcıya
 * dokunulmadı (cihaz davranışı değişmedi). Bu ayrım korunmalıdır: aksi halde
 * "semantik endpoint çalıştı" ile "semantik endpoint çalışsaydı" karışırdı.
 */
export function setMaviLatencyEndpoint(info: {
  reason: string;
  completeness?: string;
  partialCount?: number;
  commanded?: boolean;
}): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (!VALID_ENDPOINT_REASONS.has(info.reason)) { _invalidMarks = _bump(_invalidMarks); return; }
    if (_open.endpointReason === null) {
      _open.endpointReason = info.reason;
      if (typeof info.completeness === 'string' && VALID_COMPLETENESS.has(info.completeness)) {
        _open.endpointCompleteness = info.completeness;
      }
      _open.endpointCommanded = info.commanded === true;
    }
    if (typeof info.partialCount === 'number' && Number.isFinite(info.partialCount)
        && info.partialCount > _open.partialCount) {
      _open.partialCount = Math.min(MAX_COUNTER, Math.floor(info.partialCount));
    }
  } catch { /* fail-soft */ }
}

/**
 * MAVI-F4 · Akış (streaming cevap) metadata'sı — bounded.
 *
 * **TOKEN/METİN GEÇMEZ:** yalnız yetenek enum'ları, parça ADEDİ ve bitiş sebebi.
 * `llm`/`tts` yetenekleri allowlist dışıysa sessizce yutulmaz, `invalidMarks`
 * sayacında GÖRÜNÜR (sahte "streaming var" iddiası üretilemez).
 */
export function setMaviLatencyStream(info: {
  llm?: string;
  tts?: string;
  chunkCount?: number;
  endReason?: string;
}): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (typeof info.llm === 'string') {
      if (!VALID_LLM_CAPABILITIES.has(info.llm)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.llmCapability === null) _open.llmCapability = info.llm;
    }
    if (typeof info.tts === 'string') {
      if (!VALID_TTS_CAPABILITIES.has(info.tts)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.ttsCapability === null) _open.ttsCapability = info.tts;
    }
    if (typeof info.endReason === 'string') {
      if (!VALID_STREAM_END_REASONS.has(info.endReason)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.streamEndReason === null) _open.streamEndReason = info.endReason;
    }
    if (typeof info.chunkCount === 'number' && Number.isFinite(info.chunkCount)
        && info.chunkCount > _open.speechChunkCount) {
      _open.speechChunkCount = Math.min(MAX_COUNTER, Math.floor(info.chunkCount));
    }
  } catch { /* fail-soft */ }
}

/* MAVI-F5 · bounded enum kümeleri. Allowlist dışı değer SESSİZCE YUTULMAZ;
 * `invalidMarks` sayacında görünür (uydurma capability adı ize giremez). */
const VALID_CAPABILITY_ROUTES: ReadonlySet<string> = new Set([
  'CAPABILITY', 'LEGACY_FALLBACK',
]);
const VALID_CAPABILITY_AVAILABILITY: ReadonlySet<string> = new Set([
  'AVAILABLE', 'UNAVAILABLE', 'UNKNOWN',
]);
const VALID_CAPABILITY_VALIDATION: ReadonlySet<string> = new Set([
  'OK', 'CAPABILITY_NOT_FOUND', 'UNAVAILABLE', 'INVALID_ARGUMENT',
  'PERMISSION_DENIED', 'CONFIRMATION_REQUIRED', 'SAFETY_BLOCKED',
  'EXECUTION_FAILED', 'OBSERVATION_UNKNOWN', 'TIMEOUT', 'CANCELLED',
]);
const VALID_CAPABILITY_OBSERVATIONS: ReadonlySet<string> = new Set([
  'REQUESTED', 'ACCEPTED', 'EXECUTED', 'OBSERVED', 'FAILED', 'UNKNOWN', 'CANCELLED',
]);

/**
 * MAVI-F5 · Capability Fabric metadata'sı — bounded.
 *
 * **PARAMETRE DEĞERİ GEÇMEZ:** yalnız katalog kimlikleri (sabit metin) ve enum
 * sınıfları taşınır. Kişi adı · adres · sensör sorgusu · transkript bu izin
 * hiçbir alanına GİREMEZ.
 */
export function setMaviLatencyCapability(info: {
  route?: string;
  capabilityId?: string | null;
  operation?: string | null;
  availability?: string;
  validation?: string;
  observation?: string;
  enforced?: boolean;
}): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (typeof info.route === 'string') {
      if (!VALID_CAPABILITY_ROUTES.has(info.route)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.capabilityRoute === null) _open.capabilityRoute = info.route;
    }
    if (typeof info.capabilityId === 'string' && _open.capabilityId === null) {
      const c = _sanitizeCapabilityCode(info.capabilityId);
      if (c) _open.capabilityId = c;
    }
    if (typeof info.operation === 'string' && _open.capabilityOperation === null) {
      const c = _sanitizeCapabilityCode(info.operation);
      if (c) _open.capabilityOperation = c;
    }
    if (typeof info.availability === 'string') {
      if (!VALID_CAPABILITY_AVAILABILITY.has(info.availability)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.capabilityAvailability === null) _open.capabilityAvailability = info.availability;
    }
    if (typeof info.validation === 'string') {
      if (!VALID_CAPABILITY_VALIDATION.has(info.validation)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.capabilityValidation === null) _open.capabilityValidation = info.validation;
    }
    if (typeof info.observation === 'string') {
      if (!VALID_CAPABILITY_OBSERVATIONS.has(info.observation)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.capabilityObservation === null) _open.capabilityObservation = info.observation;
    }
    if (typeof info.enforced === 'boolean' && info.enforced) _open.capabilityEnforced = true;
  } catch { /* fail-soft */ }
}

/* ── MAVI-F8 · sürüş iş yükü — BOUNDED kümeler ─────────────────────────────
 * SERBEST SÜRÜŞ VERİSİ TAŞINMAZ: hız · mesafe · konum · manevra adı · transkript
 * bu ize GİREMEZ. Yalnız seviye/sınıf enum'ları, ADET ve bayrak geçer. */
const VALID_WORKLOAD_LEVELS: ReadonlySet<string> = new Set([
  'LOW', 'NORMAL', 'ELEVATED', 'HIGH', 'CRITICAL', 'UNKNOWN',
]);
const VALID_BUDGET_CLASSES: ReadonlySet<string> = new Set([
  'FULL', 'SHORT', 'MINIMAL', 'ESSENTIAL_ONLY',
]);

/**
 * MAVI-F8 · iş yükü metadata'sı — bounded.
 *
 * Yeni telemetri sistemi KURULMAZ; mevcut F0 izine yalnız gerekli alanlar
 * eklenir. Geçersiz değer `invalidMarks` sayacına düşer (uydurma seviye ize
 * giremez) ve ilk yazılan değer KORUNUR (tur içi tutarlılık).
 */
export function setMaviLatencyWorkload(info: {
  level?: string;
  evidenceCount?: number;
  budgetClass?: string;
  shortened?: boolean;
  deferred?: boolean;
}): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (typeof info.level === 'string') {
      if (!VALID_WORKLOAD_LEVELS.has(info.level)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.workloadLevel === null) _open.workloadLevel = info.level;
    }
    if (typeof info.evidenceCount === 'number' && Number.isFinite(info.evidenceCount)
        && info.evidenceCount >= 0 && _open.workloadEvidenceCount === 0) {
      _open.workloadEvidenceCount = Math.min(64, Math.floor(info.evidenceCount));
    }
    if (typeof info.budgetClass === 'string') {
      if (!VALID_BUDGET_CLASSES.has(info.budgetClass)) _invalidMarks = _bump(_invalidMarks);
      else if (_open.responseBudgetClass === null) _open.responseBudgetClass = info.budgetClass;
    }
    if (info.shortened === true) _open.responseShortened = true;
    if (info.deferred === true) _open.responseDeferred = true;
  } catch { /* fail-soft */ }
}

/* MAVI-F6 · plan sonucu bounded kümesi. */
const VALID_PLAN_RESULT_CLASSES: ReadonlySet<string> = new Set([
  'ALL_SUCCEEDED', 'PARTIAL', 'ALL_FAILED', 'AWAITING_CONFIRMATION',
  'CANCELLED', 'EMPTY', 'REFUSED',
]);

/**
 * MAVI-F6 · Bileşik plan metadata'sı — bounded.
 *
 * **PARAMETRE DEĞERİ / ADIM METNİ GEÇMEZ:** yalnız ADET ve bounded sonuç sınıfı.
 * Hedef adı · kişi adı · sensör sorgusu bu ize GİREMEZ.
 */
export function setMaviLatencyPlan(info: {
  itemCount?: number;
  dependencyCount?: number;
  confirmationCount?: number;
  executedCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  resultClass?: string;
}): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    const put = (v: number | undefined): number | null =>
      (typeof v === 'number' && Number.isFinite(v) && v >= 0
        ? Math.min(MAX_COUNTER, Math.floor(v)) : null);
    const n1 = put(info.itemCount);         if (n1 !== null) _open.planItemCount = n1;
    const n2 = put(info.dependencyCount);   if (n2 !== null) _open.planDependencyCount = n2;
    const n3 = put(info.confirmationCount); if (n3 !== null) _open.planConfirmationCount = n3;
    const n4 = put(info.executedCount);     if (n4 !== null) _open.planExecutedCount = n4;
    const n5 = put(info.failedCount);       if (n5 !== null) _open.planFailedCount = n5;
    const n6 = put(info.cancelledCount);    if (n6 !== null) _open.planCancelledCount = n6;
    if (typeof info.resultClass === 'string') {
      if (!VALID_PLAN_RESULT_CLASSES.has(info.resultClass)) _invalidMarks = _bump(_invalidMarks);
      else _open.planResultClass = info.resultClass;
    }
  } catch { /* fail-soft */ }
}

/** Bounded terminal sebep kodu (timeout/hata sınıfı). */
export function setMaviLatencyFailure(code: string): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    const c = _sanitizeCode(code);
    if (c && _open.failureCode === null) _open.failureCode = c;
  } catch { /* fail-soft */ }
}

/**
 * Marker damgalar. İlk gerçekleşme korunur; tekrar sayaca yazılır.
 * Bilinmeyen marker ve açık iz yokluğu SESSİZCE sayılır (akış etkilenmez).
 */
export function markMaviLatency(marker: MaviLatencyMarker): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (!VALID_MARKERS.has(marker)) { _invalidMarks = _bump(_invalidMarks); return; }
    /* YABANCI SES KAPISI: Mavi'nin cevabı seslendirmeye verilmeden gelen ses
     * damgası bu ize AİT DEĞİLDİR (navigasyon/güvenlik/bildirim kanalı) → düşer
     * ve ayrı sayılır. Sessizce yutulmaz: sayaç LAB'da görünür. */
    if (AUDIO_MARKERS.has(marker) && !_open.marks.has('tts_request')) {
      _foreignAudioMarks = _bump(_foreignAudioMarks);
      return;
    }
    if (marker === 'filler_trigger') _open.fillerCount = _bump(_open.fillerCount);
    if (marker === 'ack_emitted') _open.ackCount = _bump(_open.ackCount);
    if (marker === 'barge_in') _open.bargeIn = true;
    if (_open.marks.has(marker)) {
      _open.duplicateMarks = _bump(_open.duplicateMarks);
      _duplicateMarks = _bump(_duplicateMarks);
      return;
    }
    _open.marks.set(marker, { at: _now(), origin: 'observed' });
  } catch { /* fail-soft */ }
}

/**
 * Bir marker'ı BAŞKA bir marker'a göre DELTA ile TÜRETİR (native faz verisi için).
 *
 * Kullanım: native `sttTelemetry.speechEndDetectedAtMs`, `listenRequestedAt`
 * ankoruna göre bir deltadır; JS'in `stt_request_start` damgası aynı ankorla
 * hizalıdır → `speech_end = stt_request_start + delta`. Sonuç `derived` olarak
 * işaretlenir ve ekranda ÖLÇÜLMÜŞ gibi sunulmaz.
 *
 * Negatif/geçersiz delta veya eksik taban marker → damga BASILMAZ (sahte süre yok).
 */
export function markMaviLatencyDerived(
  marker: MaviLatencyMarker,
  baseMarker: MaviLatencyMarker,
  deltaMs: number,
): void {
  try {
    if (!_open) { _orphanMarks = _bump(_orphanMarks); return; }
    if (!VALID_MARKERS.has(marker) || !VALID_MARKERS.has(baseMarker)) {
      _invalidMarks = _bump(_invalidMarks); return;
    }
    if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    const base = _open.marks.get(baseMarker);
    if (!base) return;                               // taban yok → türetme yok
    if (_open.marks.has(marker)) {
      _open.duplicateMarks = _bump(_open.duplicateMarks);
      _duplicateMarks = _bump(_duplicateMarks);
      return;
    }
    _open.marks.set(marker, { at: base.at + deltaMs, origin: 'derived' });
  } catch { /* fail-soft */ }
}

/**
 * Açık izde bu marker damgalandı mı.
 *
 * NEDEN GEREKLİ: `ttsService` bitiş bildirimi ARA SÖZ (semantik ACK) için de
 * gelir. İz ancak NİHAİ cevap seslendirmeye verildiyse (`tts_request`) kapanmalı;
 * aksi halde filler'ın bitişi turu erken kapatır ve ana metrik ÖLÇÜLEMEZ.
 */
export function hasMaviLatencyMark(marker: MaviLatencyMarker): boolean {
  try {
    return !!_open && _open.marks.has(marker);
  } catch { return false; }
}

/** Açık izi kapatır ve halkaya yazar. İz yoksa no-op (idempotent). */
export function closeMaviLatencyTrace(outcome: MaviTraceOutcome): void {
  try {
    if (!_open) return;
    const o: MaviTraceOutcome = VALID_OUTCOMES.has(outcome) && outcome !== 'open'
      ? outcome : 'error';
    _pushRing(_freezeOpen(_open, o, _now()));
    _open = null;
  } catch { _open = null; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlem yüzeyi (salt-okunur)
 * ════════════════════════════════════════════════════════════════════════ */

/** CAROS LAB kanıtı — açık iz de `outcome:'open'` ile listenin SONUNA eklenir. */
export function getMaviLatencyEvidence(): MaviLatencyEvidence {
  const traces = _ring.slice();
  if (_open) traces.push(_freezeOpen(_open, 'open', null));
  return Object.freeze({
    enabled: isMaviLatencyTraceEnabled(),
    traces,
    capacity: MAVI_LATENCY_RING_MAX,
    openTraceId: _open ? _open.traceId : null,
    tracesOpened: _tracesOpened,
    tracesClosed: _tracesClosed,
    orphanMarks: _orphanMarks,
    invalidMarks: _invalidMarks,
    duplicateMarks: _duplicateMarks,
    foreignAudioMarks: _foreignAudioMarks,
    countersSaturated:
      _tracesOpened >= MAX_COUNTER || _tracesClosed >= MAX_COUNTER ||
      _orphanMarks >= MAX_COUNTER || _invalidMarks >= MAX_COUNTER ||
      _duplicateMarks >= MAX_COUNTER || _foreignAudioMarks >= MAX_COUNTER,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetMaviLatencyTraceForTest(): void {
  _remoteFlag = false;
  _traceSeq = 0;
  _open = null;
  _ring.length = 0;
  _tracesOpened = 0;
  _tracesClosed = 0;
  _orphanMarks = 0;
  _invalidMarks = 0;
  _duplicateMarks = 0;
  _foreignAudioMarks = 0;
}
