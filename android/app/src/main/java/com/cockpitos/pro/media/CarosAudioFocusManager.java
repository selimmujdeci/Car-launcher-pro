package com.cockpitos.pro.media;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * MÜZİK HUB PAKET A — Tek Audio Focus + Ducking otoritesi.
 *
 * NEDEN AYRI SINIF: ExoPlayer'ın dahili focus yönetimi (setAudioAttributes(attrs, true))
 * yalnız "duraklat/devam et" yapar; şu ayrımları YAPAMAZ:
 *   - kullanıcı mı duraklattı, focus mu duraklattı (focus geri gelince otomatik
 *     çalmaya başlamak KULLANICI kararını ezerdi),
 *   - kalıcı kayıp / geçici kayıp / duck ayrımı ayrı reason kodlarıyla,
 *   - uygulama-içi iç içe (nested) duck sebepleri (navigasyon + Mavi aynı anda).
 * Bu yüzden ExoPlayer'da focus KAPALI kurulur, otorite burasıdır.
 *
 * ÖNCELİK POLİTİKASI (yukarıdan aşağı):
 *   EMERGENCY > SAFETY > NAVIGATION > PHONE > MAVI > MEDIA
 * Media en alttadır: yukarıdaki her sebep medyayı kısar veya duraklatır.
 *
 * NESTED DUCK: her duck çağrısı bir TOKEN döndürür. Restore yalnız o token ile
 * yapılır; bayat (stale) token sesi YÜKSELTEMEZ. Navigasyon duck'ı açıkken Mavi
 * başlayıp biterse ses tam seviyeye DEĞİL, hâlâ aktif olan navigasyon seviyesine
 * döner (en agresif = en düşük çarpan kazanır).
 *
 * Zero-Leak: release() focus'u bırakır, tüm duck kayıtlarını temizler.
 */
public final class CarosAudioFocusManager {

    /* ── Duck sebepleri (uygulama-içi) ────────────────────────────────────── */
    public static final String REASON_EMERGENCY         = "EMERGENCY";
    public static final String REASON_SAFETY            = "SAFETY";
    public static final String REASON_REVERSE_ATTENTION = "REVERSE_ATTENTION";
    public static final String REASON_PARKING_SENSOR    = "PARKING_SENSOR";
    public static final String REASON_PHONE             = "PHONE";
    public static final String REASON_NAVIGATION        = "NAVIGATION";
    public static final String REASON_MAVI              = "MAVI";
    /** Sistemin AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK isteği (harici uygulama). */
    public static final String REASON_SYSTEM_DUCK       = "SYSTEM_DUCK";

    /* ── Focus durumları ──────────────────────────────────────────────────── */
    public static final String FOCUS_NONE      = "NONE";
    public static final String FOCUS_GRANTED   = "GRANTED";
    public static final String FOCUS_DELAYED   = "DELAYED";
    public static final String FOCUS_FAILED    = "FAILED";
    public static final String FOCUS_LOST      = "LOST";
    public static final String FOCUS_LOST_TRANSIENT = "LOST_TRANSIENT";
    public static final String FOCUS_DUCKED    = "DUCKED";

    /** Bilinmeyen sebep için varsayılan kısma çarpanı. */
    private static final float DEFAULT_DUCK_VOLUME = 0.30f;

    /**
     * Sebep → ses çarpanı. Değer ne kadar küçükse o kadar agresif kısma.
     * PHONE ve EMERGENCY 0.0f: konuşma/acil uyarı sırasında müzik SUSAR
     * (kısılmaz) — ISO 22262 dikkat dağıtma azaltma gerekçesi.
     */
    private static final Map<String, Float> DUCK_VOLUMES = new LinkedHashMap<>();
    /** Sebep → öncelik (büyük = öncelikli). Yalnız raporlama/teşhis için. */
    private static final Map<String, Integer> DUCK_PRIORITY = new LinkedHashMap<>();
    static {
        DUCK_VOLUMES.put(REASON_EMERGENCY,         0.00f);
        DUCK_VOLUMES.put(REASON_SAFETY,            0.15f);
        DUCK_VOLUMES.put(REASON_REVERSE_ATTENTION, 0.20f);
        DUCK_VOLUMES.put(REASON_PARKING_SENSOR,    0.25f);
        DUCK_VOLUMES.put(REASON_PHONE,             0.00f);
        DUCK_VOLUMES.put(REASON_NAVIGATION,        0.30f);
        DUCK_VOLUMES.put(REASON_MAVI,              0.30f);
        DUCK_VOLUMES.put(REASON_SYSTEM_DUCK,       0.20f);

        DUCK_PRIORITY.put(REASON_EMERGENCY,         60);
        DUCK_PRIORITY.put(REASON_SAFETY,            50);
        DUCK_PRIORITY.put(REASON_REVERSE_ATTENTION, 45);
        DUCK_PRIORITY.put(REASON_PARKING_SENSOR,    40);
        DUCK_PRIORITY.put(REASON_NAVIGATION,        30);
        DUCK_PRIORITY.put(REASON_PHONE,             35);
        DUCK_PRIORITY.put(REASON_MAVI,              20);
        DUCK_PRIORITY.put(REASON_SYSTEM_DUCK,       25);
    }

    /** Aynı anda kabul edilen en fazla duck kaydı — DoS/sızıntı sınırı. */
    private static final int MAX_DUCK_ENTRIES = 16;

    /** Otoriteye geri bildirim — servis bunu uygular. */
    public interface FocusHost {
        /** Focus kaybı nedeniyle duraklat (kullanıcı duraklatması DEĞİL). */
        void onFocusPause(String reasonCode, boolean transientLoss);
        /** Focus geri geldi ve politika izin veriyor → devam et. */
        void onFocusResume();
        /** Etkin duck çarpanı değişti (1.0 = kısma yok). */
        void onDuckVolumeChanged(float volume, String dominantReason);
        /** Focus durumu değişti — gözlemlenebilirlik için. */
        void onFocusStateChanged(String focusState);
    }

    private static final class DuckEntry {
        final long   token;
        final String reason;
        DuckEntry(long token, String reason) { this.token = token; this.reason = reason; }
    }

    private final AudioManager audioManager;
    private final Handler      handler = new Handler(Looper.getMainLooper());
    private final FocusHost    host;

    private final List<DuckEntry> ducks = new ArrayList<>();
    private long duckTokenSeq = 1L;

    private AudioFocusRequest focusRequest = null;   // API 26+
    private volatile String   focusState   = FOCUS_NONE;
    private volatile boolean  hasFocus     = false;
    /** Focus kaybı yüzünden duraklatıldı mı — GAIN'de yalnız bu true ise devam edilir. */
    private volatile boolean  pausedByFocus = false;
    /** Kullanıcı bilerek duraklattı mı — true ise focus GAIN ASLA otomatik başlatmaz. */
    private volatile boolean  userPaused    = false;
    /**
     * MÜZİK HUB PAKET B — GECİKMELİ ODAK ONARIMI.
     *
     * KUSUR (Paket A'da ölçüldü): `setAcceptsDelayedFocusGain(true)` ile sistem
     * AUDIOFOCUS_REQUEST_DELAYED dönebilir (ör. telefon görüşmesi sürüyor).
     * O anda oynatma BAŞLAMAZ — doğrudur. Ama GAIN sonradan geldiğinde
     * `pausedByFocus` false olduğu için devam koşulu SAĞLANMIYOR ve müzik
     * HİÇ BAŞLAMIYORDU: kullanıcı çal'a basmıştı, görüşme bitiyordu, sessizlik.
     *
     * Bu bayrak "kullanıcı çalmak istedi ama odak gecikti" niyetini taşır ve
     * YALNIZ GAIN'de tüketilir. Kullanıcı bu arada duraklatırsa temizlenir —
     * yani niyet, kullanıcı kararını EZEMEZ.
     */
    private volatile boolean  pendingPlayIntent = false;

    private final AudioManager.OnAudioFocusChangeListener focusListener = this::handleFocusChange;

    public CarosAudioFocusManager(Context context, FocusHost host) {
        this.audioManager = (AudioManager) context.getApplicationContext()
            .getSystemService(Context.AUDIO_SERVICE);
        this.host = host;
    }

    /* ── Focus yaşam döngüsü ──────────────────────────────────────────────── */

    /**
     * Medya focus'u ister.
     * @return FOCUS_GRANTED · FOCUS_DELAYED · FOCUS_FAILED
     *         DELAYED: sistem focus'u şimdi veremiyor (ör. telefon görüşmesi),
     *         serbest kalınca GAIN gelir. Çağıran DELAYED'i BAŞARI SAYMAMALI.
     */
    public String requestFocus() {
        if (audioManager == null) {
            // Focus servisi yoksa oynatmayı engelleme (fail-soft); ama YALAN da söyleme.
            setFocusState(FOCUS_FAILED);
            return FOCUS_FAILED;
        }
        if (hasFocus) return FOCUS_GRANTED;

        int result;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    // false: duck'ı BİZ uygularız (nested duck politikası bizde).
                    .setWillPauseWhenDucked(false)
                    // Gecikmeli focus: telefon görüşmesi biterse GAIN gelir.
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(focusListener, handler)
                    .build();
                result = audioManager.requestAudioFocus(focusRequest);
            } else {
                result = audioManager.requestAudioFocus(
                    focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
        } catch (Exception e) {
            setFocusState(FOCUS_FAILED);
            return FOCUS_FAILED;
        }

        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            hasFocus = true;
            setFocusState(FOCUS_GRANTED);
            return FOCUS_GRANTED;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) {
            hasFocus = false;
            setFocusState(FOCUS_DELAYED);
            return FOCUS_DELAYED;
        }
        hasFocus = false;
        setFocusState(FOCUS_FAILED);
        return FOCUS_FAILED;
    }

    /** Focus'u bırakır (durdurma / teardown). */
    public void abandonFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception ignored) { /* fail-soft */ }
        focusRequest      = null;
        hasFocus          = false;
        pausedByFocus     = false;
        // Odak bırakıldı → bekleyen çalma niyeti de düşer (geç GAIN sesi başlatamaz).
        pendingPlayIntent = false;
        setFocusState(FOCUS_NONE);
    }

    /* ── Kullanıcı niyeti ─────────────────────────────────────────────────── */

    /** Kullanıcı (veya UI/Mavi komutu) bilerek duraklattı. */
    public void markUserPaused() {
        userPaused        = true;
        pausedByFocus     = false;
        // Kullanıcı kararı bekleyen çalma niyetini İPTAL EDER (odak gelse bile çalmaz).
        pendingPlayIntent = false;
    }

    /** Kullanıcı bilerek çalmayı istedi. */
    public void markUserPlaying() {
        userPaused    = false;
        pausedByFocus = false;
    }

    /**
     * "Kullanıcı çalmak istedi ama odak GECİKTİ" niyetini kaydeder.
     * Yalnız {@link #requestFocus()} DELAYED döndüğünde çağrılmalıdır.
     */
    public void markPlayIntentPending() {
        pendingPlayIntent = true;
        userPaused        = false;
    }

    /** Bekleyen gecikmeli çalma niyeti var mı (gözlemlenebilirlik). */
    public boolean hasPendingPlayIntent() { return pendingPlayIntent; }

    public boolean isUserPaused()    { return userPaused; }
    public boolean isPausedByFocus() { return pausedByFocus; }
    public boolean hasAudioFocus()   { return hasFocus; }
    public String  getFocusState()   { return focusState; }

    /* ── Focus olayları ───────────────────────────────────────────────────── */

    /** Görünürlük: test bu metodu doğrudan çağırarak sistem olayını taklit eder. */
    public void handleFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                hasFocus      = false;
                pausedByFocus = true;
                setFocusState(FOCUS_LOST);
                removeDuck(REASON_SYSTEM_DUCK);
                host.onFocusPause("focus_loss", false);
                // Kalıcı kayıpta focus'u bırak — sistem başka uygulamaya verdi.
                abandonFocusQuietly();
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                hasFocus      = false;
                pausedByFocus = true;
                setFocusState(FOCUS_LOST_TRANSIENT);
                host.onFocusPause("focus_loss_transient", true);
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                setFocusState(FOCUS_DUCKED);
                addDuck(REASON_SYSTEM_DUCK);
                break;

            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                setFocusState(FOCUS_GRANTED);
                removeDuck(REASON_SYSTEM_DUCK);
                // KRİTİK: kullanıcı bilerek duraklattıysa focus dönüşü onu EZMEZ.
                // İki meşru devam nedeni vardır:
                //   (a) focus kaybı yüzünden duraklamıştık (pausedByFocus),
                //   (b) kullanıcı çalmak istedi ama odak GECİKMİŞTİ (pendingPlayIntent).
                // (b) olmadan gecikmeli odak akışı sessizce ölürdü.
                if ((pausedByFocus || pendingPlayIntent) && !userPaused) {
                    pausedByFocus     = false;
                    pendingPlayIntent = false;   // niyet TEK KEZ tüketilir
                    host.onFocusResume();
                }
                break;

            default:
                break;
        }
    }

    private void abandonFocusQuietly() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception ignored) { /* fail-soft */ }
        focusRequest = null;
    }

    /* ── Ducking (token tabanlı, nested) ──────────────────────────────────── */

    /**
     * Sebep bazlı duck başlatır.
     * @return restore token'ı; 0 = kabul edilmedi (bilinmeyen sebep / sınır aşımı).
     */
    public synchronized long duck(String reason) {
        if (reason == null || !DUCK_VOLUMES.containsKey(reason)) return 0L;
        if (ducks.size() >= MAX_DUCK_ENTRIES) return 0L;
        long token = duckTokenSeq++;
        ducks.add(new DuckEntry(token, reason));
        applyDuck();
        return token;
    }

    /**
     * Duck'ı yalnız kendi token'ıyla kaldırır. BAYAT TOKEN SESİ YÜKSELTEMEZ.
     * @return kayıt bulunup kaldırıldıysa true.
     */
    public synchronized boolean unduck(long token) {
        boolean removed = false;
        for (int i = ducks.size() - 1; i >= 0; i--) {
            if (ducks.get(i).token == token) { ducks.remove(i); removed = true; break; }
        }
        if (removed) applyDuck();
        return removed;
    }

    private synchronized void addDuck(String reason) {
        for (DuckEntry d : ducks) if (d.reason.equals(reason)) return; // idempotent
        if (ducks.size() >= MAX_DUCK_ENTRIES) return;
        ducks.add(new DuckEntry(duckTokenSeq++, reason));
        applyDuck();
    }

    private synchronized void removeDuck(String reason) {
        boolean removed = ducks.removeIf(d -> d.reason.equals(reason));
        if (removed) applyDuck();
    }

    /** Aktif duck sebepleri (gözlemlenebilirlik). */
    public synchronized String[] getActiveDuckReasons() {
        String[] out = new String[ducks.size()];
        for (int i = 0; i < ducks.size(); i++) out[i] = ducks.get(i).reason;
        return out;
    }

    /** Etkin duck çarpanı — 1.0 = kısma yok. */
    public synchronized float getDuckVolume() {
        float v = 1.0f;
        for (DuckEntry d : ducks) {
            Float dv = DUCK_VOLUMES.get(d.reason);
            if (dv != null && dv < v) v = dv;   // en agresif kazanır
        }
        return v;
    }

    /** Etkin duck'ı yaratan baskın sebep (yoksa null). */
    public synchronized String getDominantDuckReason() {
        String best = null;
        float  bestV = 1.0f;
        int    bestP = Integer.MIN_VALUE;
        for (DuckEntry d : ducks) {
            Float dv = DUCK_VOLUMES.get(d.reason);
            if (dv == null) continue;
            int p = DUCK_PRIORITY.getOrDefault(d.reason, 0);
            if (dv < bestV || (dv.floatValue() == bestV && p > bestP)) {
                bestV = dv; bestP = p; best = d.reason;
            }
        }
        return best;
    }

    private void applyDuck() {
        host.onDuckVolumeChanged(getDuckVolume(), getDominantDuckReason());
    }

    /* ── Teardown ─────────────────────────────────────────────────────────── */

    public synchronized void release() {
        ducks.clear();
        abandonFocus();
        handler.removeCallbacksAndMessages(null);
    }

    private void setFocusState(String s) {
        if (s.equals(focusState)) return;
        focusState = s;
        try { host.onFocusStateChanged(s); } catch (Exception ignored) { /* fail-soft */ }
    }

    /** Test/teşhis: bilinen bir duck sebebi mi. */
    public static boolean isKnownDuckReason(String reason) {
        return reason != null && DUCK_VOLUMES.containsKey(reason);
    }

    /** Test/teşhis: sebebin kısma çarpanı (bilinmeyen → varsayılan). */
    public static float duckVolumeFor(String reason) {
        Float v = DUCK_VOLUMES.get(reason);
        return v != null ? v : DEFAULT_DUCK_VOLUME;
    }
}
