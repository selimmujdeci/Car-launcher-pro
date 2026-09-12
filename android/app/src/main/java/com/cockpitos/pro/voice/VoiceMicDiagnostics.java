package com.cockpitos.pro.voice;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * VoiceMicDiagnostics — MAVI-STT-LAB-1: mikrofon + STT zincirinin OTURUMLUK, BOUNDED,
 * PII'SİZ tanı biriktiricisi. YALNIZ GÖZLEM — hiçbir kararı etkilemez.
 *
 * ── NE DEĞİŞTİRMEZ (pazarlıksız) ────────────────────────────────────────────
 * Yeni STT motoru KURMAZ · VAD eşiklerini DEĞİŞTİRMEZ · AudioSource seçimini
 * DEĞİŞTİRMEZ · AEC/NS/AGC aç-kapa davranışına DOKUNMAZ · mikrofon açmaz/kapatmaz ·
 * timer/thread kurmaz · disk veya ağ KULLANMAZ. Var olan yollardaki ölçümleri
 * kaydeder, o kadar. Aynı disiplin: {@code VoskLatencyTelemetry} (yalnız ölçüm).
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * HAM SES ÖRNEĞİ SAKLANMAZ. Transcript · n-best · wake sözcüğünün KENDİSİ ·
 * grammar kelimeleri · kişi adı · konum · VIN · cihaz kimliği · ham exception
 * metni TAŞIYAN ALAN YOKTUR. Yalnız: sabit enum, sayım, eşik/RMS sayıları
 * (0..1 normalize skaler) ve bounded gerekçe KODU.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 * RMS halkası en fazla {@link #RMS_RING_CAP} örnek (halka — en eskiyi ezer).
 * Kaynak denemesi en fazla {@link #ATTEMPT_CAP} kayıt. Sayaçlar saturating.
 *
 * ── EŞ ZAMANLILIK ───────────────────────────────────────────────────────────
 * Yazan: aktif dinleme thread'i (runVoskListening) VEYA wake grammar thread'i
 * (runVoskGrammar) — half-duplex olduğu için aynı anda yalnız biri. Okuyan:
 * Capacitor plugin thread'i ({@link #snapshot()}). Tüm erişim tek {@code lock}
 * altında serileştirilir; yazma O(1) ve en fazla ~10 Hz (wake penceresi ~100 ms),
 * dolayısıyla yakalama döngüsü pratikte hiç beklemez.
 *
 * Android bağımlılığı YOK → saf JUnit ile test edilebilir.
 */
public final class VoiceMicDiagnostics {

    /** Süreç-genişliği tekil — iki yakalama yolu da aynı örneğe yazar. */
    public static final VoiceMicDiagnostics INSTANCE = new VoiceMicDiagnostics();

    /** Sözleşme sürümü — alan kayması JS tarafında görünür olsun diye. */
    /**
     * 2 (2026-08-08): wake karar sayaçları eklendi (`wakeYieldCount`,
     * `wakeVadSkipFrames`, `wakeDecodeFrames`, `wakeNoMatchCount`,
     * `wakeTriggerCount`, `wakeLastTriggerLatencyMs`). YALNIZ EKLEME —
     * mevcut hiçbir alanın adı/anlamı değişmedi, JS tarafı eksik alanı
     * `-1`/0 olarak okur (geriye dönük uyum korunur).
     */
    public static final int SCHEMA_VERSION = 3;

    public static final int RMS_RING_CAP = 64;
    public static final int ATTEMPT_CAP  = 8;

    /** Hangi yakalama yolu ölçüldü. */
    public static final String PATH_NONE   = "NONE";
    public static final String PATH_ACTIVE = "ACTIVE_LISTEN";
    public static final String PATH_WAKE   = "WAKE_WORD";

    /** Grammar sınıfı — sözleşme sabit; repo'da karşılığı olmayan değer ÜRETİLMEZ. */
    public static final String GRAMMAR_FREE           = "free";
    public static final String GRAMMAR_STATIC_COMMAND = "static_command";
    public static final String GRAMMAR_WAKE_WORD      = "wake_word";
    public static final String GRAMMAR_CONFIRMATION   = "confirmation";

    /** Kaynak denemesi sonucu. */
    public static final String ATTEMPT_SIGNAL       = "SIGNAL";
    public static final String ATTEMPT_NO_SIGNAL    = "NO_SIGNAL";
    public static final String ATTEMPT_INIT_FAILED  = "INIT_FAILED";
    public static final String ATTEMPT_EXCEPTION    = "EXCEPTION";

    /** Son tanıma sonucu kategorisi (transcript METNİ DEĞİL). */
    public static final String RESULT_SUCCESS  = "success";
    public static final String RESULT_NO_MATCH = "no_match";
    public static final String RESULT_TIMEOUT  = "timeout";
    public static final String RESULT_ERROR    = "error";

    /* ── Bir AudioSource denemesi ──────────────────────────────────────────── */

    public static final class Attempt {
        public final int    source;
        public final String sourceName;
        public final String outcome;

        Attempt(int source, String sourceName, String outcome) {
            this.source     = source;
            this.sourceName = sourceName;
            this.outcome    = outcome;
        }
    }

    /** Değişmez anlık kopya — plugin JSObject'e serialize eder. */
    public static final class Snapshot {
        public boolean present;
        public int     schemaVersion;
        public long    capturedAt;          // duvar saati (ms) — 0 = damga yok

        public String  path;
        public boolean sessionActive;
        public long    sessionStartedAt;    // duvar saati (ms); 0 = hiç oturum yok

        /* Ses kaynağı */
        public int     selectedSource;      // -1 = seçilmedi
        public String  selectedSourceName;  // "UNKNOWN" = seçilmedi
        public List<Attempt> attempts;
        public int     sampleRate;          // 0 = bilinmiyor
        public int     channelCount;        // 0 = bilinmiyor
        public int     bufferBytes;         // 0 = bilinmiyor
        public int     frameSamples;        // 0 = bilinmiyor

        /* Android ses efektleri */
        public boolean aecAvailable, aecCreated, aecEnabled;
        public boolean nsAvailable,  nsCreated,  nsEnabled;
        public boolean agcAvailable, agcCreated, agcEnabled;
        public boolean effectsProbed;       // efekt kurulumu bu oturumda ÇALIŞTI mı
        public List<String> effectErrors;   // bounded KOD listesi (ham metin YOK)

        /* VAD / gürültü */
        public boolean vadPresent;          // bu yolda VAD ölçümü var mı
        public double  lastRms;             // -1 = ölçüm yok
        public double  noiseFloor;          // -1 = ÖĞRENİLMEDİ (0 DEĞİL)
        public double  effectiveThreshold;  // -1 = ölçüm yok
        public double  staticMinThreshold;  // -1 = uygulanmaz
        public double  floorFactor;         // -1 = uygulanmaz
        public boolean speechDetected;
        public long    lastAudioAtMs;       // monotonic (elapsedRealtime); 0 = hiç paket yok
        public long    monotonicNowMs;      // aynı eksende "şimdi" — yaş JS'te türetilir
        public double[] rmsSamples;         // bounded, en eski→en yeni
        public int     rmsSampleCount;      // halkaya toplam kaç örnek düştü (saturating)

        /* STT durumu */
        public boolean wakeEngineActive;
        public boolean activeRecognizerActive;
        public String  grammarType;
        public int     grammarWordCount;    // -1 = grammar yok (full-vocab)
        public String  lastResultCategory;  // null = hiç sonuç yok
        public long    lastResultAt;        // duvar saati (ms); 0 = yok

        /* ── WAKE KARAR SAYAÇLARI (şema 2) ────────────────────────────────
         * JS'in GÖREMEDİĞİ kararlar. `wakeWordService` yalnız TETİK ANINI alır;
         * "mikrofon hiç açılmadı", "VAD decode'u atladı" ve "çözüldü ama
         * eşleşmedi" JS'ten AYIRT EDİLEMEZ. Bu sayaçlar davranışı DEĞİŞTİRMEZ,
         * yalnız görünür kılar.
         *
         * KÜMÜLATİFtir (oturum başında SIFIRLANMAZ): wake döngüsü saniyede bir
         * oturum açıp kapatır; oturum-başı sayaç oran hesaplanamaz hâle getirir.
         * Taşmaya karşı doyurulur (saturating) — sarmalanma YOK. */
        public int  wakeYieldCount;         // mikrofon hiç açılmadı (TTS/aktif STT/bekleyen çağrı)
        public int  wakeVadSkipFrames;      // VAD eşiği altında → decode ATLANDI
        public int  wakeDecodeFrames;       // gerçekten decode edilen çerçeve
        public int  wakeNoMatchCount;       // metin çözüldü ama wake sözü EŞLEŞMEDİ
        public int  wakeTriggerCount;       // eşleşti ve JS'e olay gönderildi
        /**
         * Konuşma başlangıcı → tetik (ms). -1 = ölçüm yok.
         *
         * ⚠️ ŞEMA 3 DÜZELTMESİ: şema 2'de "konuşma başlangıcı" VAD eşiğinin ilk
         * aşıldığı andı; ortam gürültüsü hangover'ı sürekli tazelediği için
         * pencere neredeyse hiç kapanmıyor ve bu sayı wake gecikmesi DEĞİL
         * "pencere ne kadardır açık" oluyordu (sahada 2929 ms ölçüldü — anlamsız).
         * Artık onset YALNIZ gerçek sessizlikten sonra ilk konuşma çerçevesinde
         * kurulur (bkz. `noteWakeSpeechOnset`).
         */
        public int  wakeLastTriggerLatencyMs;

        /* ── Güven ölçümü (şema 3) — KARARA GİRMEZ ─────────────────────────
         * Wake kararı bugün SAF EŞLEŞMEDİR. Saha "hey mercedes"/"hey market"
         * ile uyanıldığını gösterdi. Bu iki alan, gerçek "hey mavi" ile yanlış
         * tetiği ayıracak bir SAYININ VAR OLUP OLMADIĞINI ölçer. */
        /** `setPartialWords(true)` kurulabildi mi (Vosk sürüm yeteneği). */
        public boolean wakePartialWordsEnabled;
        /** Son EŞLEŞMEDEKİ en düşük kelime güveni ×1000. -1 = güven YOK/ölçülemedi. */
        public int  wakeLastMatchConfMilli;
    }

    /* ── Durum ─────────────────────────────────────────────────────────────── */

    private final Object lock = new Object();

    private String  path             = PATH_NONE;
    private boolean sessionActive    = false;
    private long    sessionStartedAt = 0;

    private int    selectedSource = -1;
    private final List<Attempt> attempts = new ArrayList<>(ATTEMPT_CAP);
    private int    sampleRate   = 0;
    private int    channelCount = 0;
    private int    bufferBytes  = 0;
    private int    frameSamples = 0;

    private boolean aecAvailable, aecCreated, aecEnabled;
    private boolean nsAvailable,  nsCreated,  nsEnabled;
    private boolean agcAvailable, agcCreated, agcEnabled;
    private boolean effectsProbed;
    private final List<String> effectErrors = new ArrayList<>(4);

    private boolean vadPresent;
    private double  lastRms            = -1;
    private double  noiseFloor         = -1;
    private double  effectiveThreshold = -1;
    private double  staticMinThreshold = -1;
    private double  floorFactor        = -1;
    private boolean speechDetected;
    private long    lastAudioAtMs;

    private final double[] rmsRing = new double[RMS_RING_CAP];
    private int rmsHead  = 0;   // sonraki yazma konumu
    private int rmsFill  = 0;   // halkadaki geçerli örnek sayısı
    private int rmsTotal = 0;   // saturating toplam

    private boolean wakeEngineActive;
    private boolean activeRecognizerActive;
    private String  grammarType      = GRAMMAR_FREE;
    private int     grammarWordCount = -1;
    private String  lastResultCategory;
    private long    lastResultAt;

    /* ── Wake karar sayaçları (şema 2) — KÜMÜLATİF, doyurulur ────────────── */
    private static final int COUNTER_CAP = 1_000_000_000;
    private int  wakeYieldCount;
    private int  wakeVadSkipFrames;
    private int  wakeDecodeFrames;
    private int  wakeNoMatchCount;
    private int  wakeTriggerCount;
    private int  wakeLastTriggerLatencyMs = -1;
    /** Konuşma başlangıcı (monotonik ms); 0 = konuşma penceresi kapalı. */
    private long wakeSpeechOnsetMs;
    private boolean wakePartialWordsEnabled;
    private int  wakeLastMatchConfMilli = -1;

    /** Doyuran artırma — sarmalanma (negatif sayaç) OLMAZ. */
    private static int bump(int v) { return v >= COUNTER_CAP ? v : v + 1; }

    /** Hiç ölçüm yapılmadıysa `present:false` — SAHTE varsayılan üretilmez. */
    private boolean everMeasured = false;

    private VoiceMicDiagnostics() { }

    /* ── Yazma API'si (yakalama thread'lerinden çağrılır) ──────────────────── */

    /**
     * Yeni yakalama oturumu başladı. Oturuma AİT alanlar sıfırlanır; son tanıma
     * sonucu KORUNUR (LAB ekranı oturum bittikten sonra açılır — silinirse hiçbir
     * şey gözlemlenemez).
     */
    public void noteSessionStart(String capturePath, long wallClockMs) {
        synchronized (lock) {
            everMeasured     = true;
            path             = _path(capturePath);
            sessionActive    = true;
            sessionStartedAt = wallClockMs > 0 ? wallClockMs : 0;

            selectedSource = -1;
            attempts.clear();
            sampleRate = 0; channelCount = 0; bufferBytes = 0; frameSamples = 0;

            aecAvailable = aecCreated = aecEnabled = false;
            nsAvailable  = nsCreated  = nsEnabled  = false;
            agcAvailable = agcCreated = agcEnabled = false;
            effectsProbed = false;
            effectErrors.clear();

            vadPresent = false;
            lastRms = -1; noiseFloor = -1; effectiveThreshold = -1;
            staticMinThreshold = -1; floorFactor = -1;
            speechDetected = false;
            lastAudioAtMs = 0;
            rmsHead = 0; rmsFill = 0; rmsTotal = 0;
        }
    }

    public void noteSessionEnd() {
        synchronized (lock) { sessionActive = false; }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * WAKE KARAR SAYAÇLARI (şema 2) — YALNIZ SAYAR, KARAR VERMEZ
     *
     * Hiçbiri wake akışını okumaz, değiştirmez veya geciktirmez; her biri tek
     * bir `int` artırır. Metin, ses ve wake sözcüğü BU METOTLARA GEÇMEZ.
     * ════════════════════════════════════════════════════════════════════ */

    /** Mikrofon hiç açılmadı (TTS konuşuyor / aktif STT / bekleyen çağrı). */
    public void noteWakeYield() {
        synchronized (lock) { everMeasured = true; wakeYieldCount = bump(wakeYieldCount); }
    }

    /**
     * VAD kapısı bir çerçeveyi değerlendirdi.
     * @param decoded `true` = Vosk'a verildi · `false` = eşik altı, decode ATLANDI
     */
    public void noteWakeFrame(boolean decoded) {
        synchronized (lock) {
            everMeasured = true;
            if (decoded) wakeDecodeFrames = bump(wakeDecodeFrames);
            else         wakeVadSkipFrames = bump(wakeVadSkipFrames);
            /* ŞEMA 3: onset BURADA KURULMAZ — `noteWakeSpeechOnset` kurar.
               Sessizlik çerçevesi pencereyi KAPATIR (gecikme çapası temizlenir). */
            if (!decoded) wakeSpeechOnsetMs = 0;
        }
    }

    /** Metin çözüldü ama wake sözü EŞLEŞMEDİ (metnin kendisi TAŞINMAZ). */
    public void noteWakeNoMatch() {
        synchronized (lock) { everMeasured = true; wakeNoMatchCount = bump(wakeNoMatchCount); }
    }

    /**
     * KONUŞMA BAŞLANGICI — yalnız GERÇEK sessizlikten sonraki ilk konuşma
     * çerçevesinde çağrılır (şema 3).
     *
     * Şema 2'de onset VAD eşiğinin her aşılışında kuruluyordu; ortam gürültüsü
     * hangover'ı sürekli tazelediği için pencere kapanmıyor ve gecikme
     * "pencere ne kadardır açık" hâline geliyordu (sahada 2929 ms — anlamsız).
     */
    public void noteWakeSpeechOnset(long monotonicMs) {
        synchronized (lock) {
            everMeasured = true;
            wakeSpeechOnsetMs = monotonicMs > 0 ? monotonicMs : 0;
        }
    }

    /** `setPartialWords(true)` kurulabildi mi — güven ölçümünün ön koşulu. */
    public void noteWakePartialWords(boolean enabled) {
        synchronized (lock) { everMeasured = true; wakePartialWordsEnabled = enabled; }
    }

    /**
     * Eşleşmenin en düşük kelime güveni (0..1). `< 0` = güven YOK.
     * YALNIZ ÖLÇÜM — wake kararı bu sayıyı KULLANMAZ.
     */
    public void noteWakeMatchConf(double conf) {
        synchronized (lock) {
            everMeasured = true;
            wakeLastMatchConfMilli = conf < 0 ? -1 : (int) Math.round(conf * 1000.0);
        }
    }

    /**
     * Wake eşleşti ve JS'e olay gönderildi.
     * @param monotonicNowMs Tetik anı (monotonik). Konuşma başlangıcı biliniyorsa
     *        gecikme türetilir; bilinmiyorsa `-1` KALIR (0 UYDURULMAZ).
     */
    public void noteWakeTrigger(long monotonicNowMs) {
        synchronized (lock) {
            everMeasured = true;
            wakeTriggerCount = bump(wakeTriggerCount);
            long onset = wakeSpeechOnsetMs;
            if (onset > 0 && monotonicNowMs >= onset) {
                long d = monotonicNowMs - onset;
                wakeLastTriggerLatencyMs = d > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) d;
            }
            wakeSpeechOnsetMs = 0;   // pencere kapandı; sonraki tetik yeni onset ister
        }
    }

    /** Ses formatı — AudioRecord parametreleri (davranış DEĞİŞMEZ, yalnız kayıt). */
    public void noteAudioFormat(int sampleRateHz, int channels, int bufBytes, int frames) {
        synchronized (lock) {
            everMeasured = true;
            if (sampleRateHz > 0) sampleRate   = sampleRateHz;
            if (channels     > 0) channelCount = channels;
            if (bufBytes     > 0) bufferBytes  = bufBytes;
            if (frames       > 0) frameSamples = frames;
        }
    }

    /** Bir AudioSource adayının prob sonucu (bounded). */
    public void noteSourceAttempt(int source, String outcome) {
        synchronized (lock) {
            everMeasured = true;
            if (attempts.size() < ATTEMPT_CAP) {
                attempts.add(new Attempt(source, sourceName(source), _attempt(outcome)));
            }
        }
    }

    /** Seçilen (kayda başlamış) kaynak. */
    public void noteSourceSelected(int source) {
        synchronized (lock) {
            everMeasured = true;
            selectedSource = source;
        }
    }

    /** Efekt durumu — available/created/enabled AYRI AYRI taşınır (hiçbiri türetilmez). */
    public void noteEffect(String kind, boolean available, boolean created, boolean enabled) {
        synchronized (lock) {
            everMeasured  = true;
            effectsProbed = true;
            if ("AEC".equals(kind)) { aecAvailable = available; aecCreated = created; aecEnabled = enabled; }
            else if ("NS".equals(kind)) { nsAvailable = available; nsCreated = created; nsEnabled = enabled; }
            else if ("AGC".equals(kind)) { agcAvailable = available; agcCreated = created; agcEnabled = enabled; }
        }
    }

    /**
     * Efekt kurulumunda istisna — YALNIZ bounded KOD (ör. "AEC_CREATE_FAILED").
     * Ham exception metni / mesajı / yığın izi ASLA geçirilmez.
     */
    public void noteEffectError(String boundedCode) {
        if (boundedCode == null || boundedCode.isEmpty()) return;
        synchronized (lock) {
            everMeasured = true;
            if (effectErrors.size() < 4 && !effectErrors.contains(boundedCode)) {
                effectErrors.add(boundedCode);
            }
        }
    }

    /**
     * VAD parametreleri (aktif dinleme yolu). {@code floorFactorValue}/{@code minThresh}
     * uygulanmayan yolda -1 geçilir → JS "UYGULANMAZ" gösterir, 0 UYDURMAZ.
     */
    public void noteVadConfig(double minThresh, double floorFactorValue) {
        synchronized (lock) {
            everMeasured = true;
            vadPresent = true;
            staticMinThreshold = minThresh;
            floorFactor = floorFactorValue;
        }
    }

    /** Öğrenilmiş gürültü tabanı (yalnız GERÇEKTEN öğrenildiğinde çağrılır). */
    public void noteNoiseFloor(double floor) {
        synchronized (lock) {
            everMeasured = true;
            vadPresent = true;
            noiseFloor = floor;
        }
    }

    /**
     * Her ses penceresinde tek O(1) kayıt: anlık RMS + o an KULLANILAN eşik +
     * konuşma bayrağı + son paket damgası. Halka en eskiyi ezer (bounded).
     * HAM SES SAKLANMAZ — yalnız normalize skaler.
     */
    public void noteRmsFrame(double rms, double thresholdUsed, boolean speech, long monotonicMs) {
        synchronized (lock) {
            everMeasured = true;
            vadPresent = true;
            lastRms = rms;
            if (thresholdUsed >= 0) effectiveThreshold = thresholdUsed;
            speechDetected = speech;
            if (monotonicMs > 0) lastAudioAtMs = monotonicMs;

            rmsRing[rmsHead] = rms;
            rmsHead = (rmsHead + 1) % RMS_RING_CAP;
            if (rmsFill < RMS_RING_CAP) rmsFill++;
            if (rmsTotal < Integer.MAX_VALUE - 1) rmsTotal++;
        }
    }

    /** Wake motoru yaşam döngüsü (JS'ten değil, native thread'in KENDİ gerçeğinden). */
    public void noteWakeEngineActive(boolean active) {
        synchronized (lock) { everMeasured = true; wakeEngineActive = active; }
    }

    /** Ana (aktif dinleme) recognizer yaşam döngüsü. */
    public void noteActiveRecognizerActive(boolean active) {
        synchronized (lock) { everMeasured = true; activeRecognizerActive = active; }
    }

    /**
     * Kurulan grammar SINIFI + KELİME ADEDİ. Kelimelerin KENDİSİ geçirilmez.
     * {@code wordCount < 0} = grammar yok (full-vocab).
     */
    public void noteGrammar(String type, int wordCount) {
        synchronized (lock) {
            everMeasured = true;
            grammarType = _grammar(type);
            grammarWordCount = wordCount >= 0 ? wordCount : -1;
        }
    }

    /** Son tanıma sonucunun KATEGORİSİ — transcript/n-best metni ASLA geçmez. */
    public void noteResult(String category, long wallClockMs) {
        synchronized (lock) {
            everMeasured = true;
            lastResultCategory = _result(category);
            lastResultAt = wallClockMs > 0 ? wallClockMs : 0;
        }
    }

    /* ── Okuma ─────────────────────────────────────────────────────────────── */

    public Snapshot snapshot(long wallClockMs, long monotonicMs) {
        Snapshot s = new Snapshot();
        synchronized (lock) {
            s.present       = everMeasured;
            s.schemaVersion = SCHEMA_VERSION;
            s.capturedAt    = wallClockMs > 0 ? wallClockMs : 0;

            s.path             = path;
            s.sessionActive    = sessionActive;
            s.sessionStartedAt = sessionStartedAt;

            s.selectedSource     = selectedSource;
            s.selectedSourceName = selectedSource >= 0 ? sourceName(selectedSource) : "UNKNOWN";
            s.attempts           = Collections.unmodifiableList(new ArrayList<>(attempts));
            s.sampleRate   = sampleRate;
            s.channelCount = channelCount;
            s.bufferBytes  = bufferBytes;
            s.frameSamples = frameSamples;

            s.aecAvailable = aecAvailable; s.aecCreated = aecCreated; s.aecEnabled = aecEnabled;
            s.nsAvailable  = nsAvailable;  s.nsCreated  = nsCreated;  s.nsEnabled  = nsEnabled;
            s.agcAvailable = agcAvailable; s.agcCreated = agcCreated; s.agcEnabled = agcEnabled;
            s.effectsProbed = effectsProbed;
            s.effectErrors  = Collections.unmodifiableList(new ArrayList<>(effectErrors));

            s.vadPresent         = vadPresent;
            s.lastRms            = lastRms;
            s.noiseFloor         = noiseFloor;
            s.effectiveThreshold = effectiveThreshold;
            s.staticMinThreshold = staticMinThreshold;
            s.floorFactor        = floorFactor;
            s.speechDetected     = speechDetected;
            s.lastAudioAtMs      = lastAudioAtMs;
            s.monotonicNowMs     = monotonicMs > 0 ? monotonicMs : 0;
            s.rmsSampleCount     = rmsTotal;

            double[] out = new double[rmsFill];
            // En eski→en yeni sırada kopyala (halka başlangıcı rmsFill'e göre kayar).
            int start = (rmsHead - rmsFill + RMS_RING_CAP) % RMS_RING_CAP;
            for (int i = 0; i < rmsFill; i++) out[i] = rmsRing[(start + i) % RMS_RING_CAP];
            s.rmsSamples = out;

            s.wakeEngineActive       = wakeEngineActive;
            s.activeRecognizerActive = activeRecognizerActive;
            s.grammarType            = grammarType;
            s.grammarWordCount       = grammarWordCount;
            s.lastResultCategory     = lastResultCategory;
            s.lastResultAt           = lastResultAt;

            /* Wake karar sayaçları (şema 2). Eski JS bu alanları BİLMEZ ve
               okumaz; yeni JS yoksa `-1`/0 görür → geriye dönük uyum korunur. */
            s.wakeYieldCount            = wakeYieldCount;
            s.wakeVadSkipFrames         = wakeVadSkipFrames;
            s.wakeDecodeFrames          = wakeDecodeFrames;
            s.wakeNoMatchCount          = wakeNoMatchCount;
            s.wakeTriggerCount          = wakeTriggerCount;
            s.wakeLastTriggerLatencyMs  = wakeLastTriggerLatencyMs;
            s.wakePartialWordsEnabled   = wakePartialWordsEnabled;
            s.wakeLastMatchConfMilli    = wakeLastMatchConfMilli;
        }
        return s;
    }

    /* ── Yardımcılar (saf) ─────────────────────────────────────────────────── */

    /**
     * MediaRecorder.AudioSource sabitinin KARARLI adı. Android sabitine bağlı
     * kalmamak için sayısal eşleme burada sabittir (sözleşme JS ile ortak).
     */
    public static String sourceName(int source) {
        switch (source) {
            case 0: return "DEFAULT";
            case 1: return "MIC";
            case 5: return "CAMCORDER";
            case 6: return "VOICE_RECOGNITION";
            case 7: return "VOICE_COMMUNICATION";
            case 9: return "UNPROCESSED";
            default: return "UNKNOWN";
        }
    }

    private static String _path(String v) {
        if (PATH_ACTIVE.equals(v) || PATH_WAKE.equals(v)) return v;
        return PATH_NONE;
    }

    private static String _attempt(String v) {
        if (ATTEMPT_SIGNAL.equals(v) || ATTEMPT_NO_SIGNAL.equals(v)
            || ATTEMPT_INIT_FAILED.equals(v) || ATTEMPT_EXCEPTION.equals(v)) return v;
        return ATTEMPT_EXCEPTION;
    }

    private static String _grammar(String v) {
        if (GRAMMAR_STATIC_COMMAND.equals(v) || GRAMMAR_WAKE_WORD.equals(v)
            || GRAMMAR_CONFIRMATION.equals(v)) return v;
        return GRAMMAR_FREE;
    }

    private static String _result(String v) {
        if (RESULT_SUCCESS.equals(v) || RESULT_NO_MATCH.equals(v)
            || RESULT_TIMEOUT.equals(v) || RESULT_ERROR.equals(v)) return v;
        return RESULT_ERROR;
    }

    /** @noinspection unused — test izolasyonu (JUnit). */
    public void resetForTest() {
        synchronized (lock) {
            everMeasured = false;
            path = PATH_NONE; sessionActive = false; sessionStartedAt = 0;
            selectedSource = -1; attempts.clear();
            sampleRate = 0; channelCount = 0; bufferBytes = 0; frameSamples = 0;
            aecAvailable = aecCreated = aecEnabled = false;
            nsAvailable  = nsCreated  = nsEnabled  = false;
            agcAvailable = agcCreated = agcEnabled = false;
            effectsProbed = false; effectErrors.clear();
            vadPresent = false; lastRms = -1; noiseFloor = -1; effectiveThreshold = -1;
            staticMinThreshold = -1; floorFactor = -1; speechDetected = false; lastAudioAtMs = 0;
            rmsHead = 0; rmsFill = 0; rmsTotal = 0;
            wakeEngineActive = false; activeRecognizerActive = false;
            grammarType = GRAMMAR_FREE; grammarWordCount = -1;
            lastResultCategory = null; lastResultAt = 0;
        }
    }
}
