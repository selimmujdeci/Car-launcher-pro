package com.cockpitos.pro.media;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * MÜZİK HUB PAKET A — CAROS PRO'nun TEK app-owned Automotive Playback Authority'si.
 *
 * ÖNCESİ (kanıtlanmış sorun): yerel müzik ham MediaPlayer ile çalıyordu; audio focus
 * İSTENMİYOR, focus kaybı DİNLENMİYOR, ACTION_AUDIO_BECOMING_NOISY receiver'ı YOK,
 * uygulamaya ait MediaSession YOK, foreground service YOK, process-death kurtarma YOK.
 * Kaynak değişimleri "best-effort durdur, hemen başlat" mantığındaydı → iki backend
 * aynı anda ses verebiliyordu.
 *
 * SONRASI: bu servis tek otoritedir.
 *   - Oynatma: ExoPlayer (yerel content:// + internet akışı)
 *   - Kontrol yüzeyi: MediaSession → bildirim · kilit ekranı · AVRCP · direksiyon
 *     ve kulaklık medya tuşları AYNI kapıya düşer (çift komut üretmez).
 *   - Audio focus + nested ducking: CarosAudioFocusManager (tek politika).
 *   - Becoming-noisy: kulaklık/BT kopunca GÜVENLİ duraklatma (reason kodlu).
 *
 * DÜRÜSTLÜK: "transport ACK" başarı sayılmaz. Gerçek başarı ölçütü
 * {@link #isRenderingVerified()} — ExoPlayer gerçekten render ediyor (isPlaying) VE
 * audio focus bizde VE etkin ses > 0. Bu üçü sağlanmadan hiçbir katman "çalıyor" demez.
 *
 * GÜVENLİK: exported service olsa da {@link CarosSessionCallback#onConnect} yalnız
 * kendi paketimize ve Android sistem medya kontrolcülerine bağlantı verir.
 * Servis harici Intent extra'sı OKUMAZ; tüm komutlar MediaSession üzerinden gelir.
 */
@OptIn(markerClass = UnstableApi.class)
public class CarosPlaybackService extends MediaSessionService {

    /* ── Kaynak sınıfları (JS SourceCoordinator ile birebir) ──────────────── */
    public static final String SOURCE_LOCAL  = "LOCAL";
    public static final String SOURCE_STREAM = "STREAM";
    public static final String SOURCE_RADIO  = "INTERNET_RADIO";

    /** Bir kuyruğun kabul edilebilir en büyük boyu — bellek/DoS sınırı. */
    public static final int MAX_QUEUE_ITEMS = 500;

    /** Sistem medya kontrolcüleri — transport'a izin verilen paketler. */
    private static final Set<String> SYSTEM_CONTROLLER_PACKAGES = new HashSet<>(Arrays.asList(
        "android",
        "com.android.systemui",
        "com.android.bluetooth",
        "com.android.car.media",
        "com.google.android.projection.gearhead"
    ));

    /** Kabul edilen URI şemaları. file:// KABUL EDİLMEZ (path traversal yüzeyi). */
    private static final Set<String> ALLOWED_SCHEMES = new HashSet<>(Arrays.asList(
        "content", "http", "https"
    ));

    /** Servis örneği — aynı process içindeki otorite köprüsü okur (null olabilir). */
    private static volatile CarosPlaybackService instance;

    public static @Nullable CarosPlaybackService peek() { return instance; }

    /** Gerçek oynatıcı — servis içi çağrılar BUNU kullanır (özyineleme olmaz). */
    private ExoPlayer   player;
    /** MediaSession'ın gördüğü focus-farkında sarmalayıcı. */
    private CarosFocusAwarePlayer sessionPlayer;
    private MediaSession mediaSession;
    private CarosAudioFocusManager focusManager;
    private final Handler main = new Handler(Looper.getMainLooper());

    /* ── Gözlemlenebilirlik alanları (salt-okunur dışarıya) ───────────────── */
    private volatile String  activeSource        = "NONE";
    private volatile String  lastFailureCode     = "";
    private volatile String  audioRoute          = "UNKNOWN";
    private volatile String  lastPauseReason     = "";
    private volatile long    queueRevision       = 0L;
    private volatile int     recoveryCount       = 0;
    private volatile float   userVolume          = 1.0f;   // duck ÖNCESİ kullanıcı seviyesi
    private volatile boolean noisyReceiverActive = false;

    private BroadcastReceiver noisyReceiver;

    /* ── PAKET B · Generation + olay izi ──────────────────────────────────── */

    /**
     * Oturum generation'ı. Kuyruk yazımı ve durdurma bunu ARTIRIR.
     *
     * KUSUR (Paket A'da ölçüldü): focus geri çağrıları {@code main.post(...)}
     * ile gecikmeli koşuyordu. Post kuyruğa girdikten SONRA kullanıcı durdurup
     * yeni bir kaynak başlatırsa, ESKİ dünyaya ait callback yeni oturumu
     * duraklatabiliyor veya çaldırabiliyordu. Artık her callback generation'ı
     * yakalar; çalışma anında değişmişse İŞLEM YAPMAZ ve olay olarak kaydeder.
     */
    private volatile long sessionGeneration = 0L;

    private final CarosMediaEventLog eventLog = new CarosMediaEventLog();

    public CarosMediaEventLog getEventLog() { return eventLog; }

    public long getSessionGeneration() { return sessionGeneration; }

    private void logEvent(String type, String code) {
        eventLog.record(type, code, sessionGeneration);
    }

    /* ── Yaşam döngüsü ────────────────────────────────────────────────────── */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        focusManager = new CarosAudioFocusManager(this, new FocusHostImpl());

        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();

        player = new ExoPlayer.Builder(this)
            // handleAudioFocus=false: focus otoritesi CarosAudioFocusManager'dır.
            // ExoPlayer'ın dahili yönetimi kullanıcı-duraklatması ile focus
            // duraklatmasını AYIRMAZ; açık kalsaydı iki otorite çakışırdı.
            .setAudioAttributes(attrs, false)
            // Becoming-noisy'yi de biz ele alıyoruz (reason kodu + gözlemlenebilirlik).
            .setHandleAudioBecomingNoisy(false)
            .build();

        player.addListener(new PlayerListenerImpl());

        PendingIntent sessionActivity = buildSessionActivityIntent();
        // KRİTİK: session'a ÇIPLAK ExoPlayer verilmez. Bildirim · kilit ekranı ·
        // AVRCP · direksiyon tuşlarından gelen play/pause, focus kapısı olan
        // CarosFocusAwarePlayer üzerinden geçer (otorite bypass edilemez).
        sessionPlayer = new CarosFocusAwarePlayer(player, this);
        MediaSession.Builder b = new MediaSession.Builder(this, sessionPlayer)
            .setId("caros-playback-authority")
            .setCallback(new CarosSessionCallback());
        if (sessionActivity != null) b.setSessionActivity(sessionActivity);
        mediaSession = b.build();

        registerNoisyReceiver();
        logEvent(CarosMediaEventLog.EV_SERVICE_CREATED, "");
        logEvent(CarosMediaEventLog.EV_PLAYER_CREATED, "");
        logEvent(CarosMediaEventLog.EV_SESSION_CREATED, "");
        publishDiagnostics();
    }

    @Override
    public void onDestroy() {
        unregisterNoisyReceiver();
        // Yeni dünya: teardown sırasında kuyruğa girmiş callback'ler BAYATLAR.
        sessionGeneration++;
        if (mediaSession != null) {
            mediaSession.release(); mediaSession = null;
            logEvent(CarosMediaEventLog.EV_SESSION_RELEASED, "");
        }
        sessionPlayer = null;
        if (player != null) {
            player.release(); player = null;
            logEvent(CarosMediaEventLog.EV_PLAYER_RELEASED, "");
        }
        if (focusManager != null) { focusManager.release(); focusManager = null; }
        logEvent(CarosMediaEventLog.EV_SERVICE_DESTROYED, "");
        instance = null;
        super.onDestroy();
    }

    @Override
    public @Nullable MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return isAllowedController(controllerInfo) ? mediaSession : null;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Çalmıyorsa görev kaldırıldığında servisi de kapat (kaynak sızdırma).
        Player p = player;
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    private @Nullable PendingIntent buildSessionActivityIntent() {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return null;
            // FLAG_IMMUTABLE: PendingIntent'i alan sistem bileşeni içeriği DEĞİŞTİREMEZ.
            return PendingIntent.getActivity(
                this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isAllowedController(MediaSession.ControllerInfo info) {
        if (info == null) return false;
        String pkg = info.getPackageName();
        if (pkg == null) return false;
        return pkg.equals(getPackageName()) || SYSTEM_CONTROLLER_PACKAGES.contains(pkg);
    }

    /** Yabancı paketleri reddeden bağlantı kapısı. */
    private final class CarosSessionCallback implements MediaSession.Callback {
        @Override
        public MediaSession.ConnectionResult onConnect(
            @NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller) {
            if (!isAllowedController(controller)) {
                return MediaSession.ConnectionResult.reject();
            }
            return MediaSession.Callback.super.onConnect(session, controller);
        }
    }

    /* ── Becoming noisy + route ───────────────────────────────────────────── */

    private void registerNoisyReceiver() {
        if (noisyReceiverActive) return;
        noisyReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (intent == null || !AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) return;
                // Kulaklık/BT koptu → hoparlörden patlamasın: GÜVENLİ duraklatma.
                audioRoute      = "SPEAKER";
                lastPauseReason = "becoming_noisy";
                logEvent(CarosMediaEventLog.EV_BECOMING_NOISY, "route_lost");
                pauseInternal(false);   // kullanıcı duraklatması DEĞİL
                publishDiagnostics();
            }
        };
        try {
            registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            noisyReceiverActive = true;
        } catch (Exception ignored) { /* fail-soft */ }
    }

    private void unregisterNoisyReceiver() {
        if (!noisyReceiverActive || noisyReceiver == null) return;
        try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) { /* fail-soft */ }
        noisyReceiver = null;
        noisyReceiverActive = false;
    }

    /** Aktif ses yolunu AudioManager'dan okur — bilinmiyorsa UNKNOWN (uydurma YOK). */
    private String readAudioRoute() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "UNKNOWN";
            if (am.isBluetoothA2dpOn()) return "BLUETOOTH_A2DP";
            if (am.isWiredHeadsetOn())  return "WIRED";
            if (am.isSpeakerphoneOn())  return "SPEAKER";
            return "SPEAKER";
        } catch (Exception e) {
            return "UNKNOWN";
        }
    }

    /* ── Focus politikası uygulaması ──────────────────────────────────────── */

    private final class FocusHostImpl implements CarosAudioFocusManager.FocusHost {
        @Override public void onFocusPause(String reasonCode, boolean transientLoss) {
            // Generation callback KUYRUĞA GİRERKEN yakalanır; çalışma anında
            // değişmişse bu karar BAYATTIR ve uygulanmaz.
            final long gen = sessionGeneration;
            logEvent(CarosMediaEventLog.EV_FOCUS_LOST,
                transientLoss ? "transient" : "permanent");
            main.post(() -> {
                if (isStale(gen, "focus_pause")) return;
                lastPauseReason = reasonCode;
                pauseInternal(false);
                publishDiagnostics();
            });
        }
        @Override public void onFocusResume() {
            final long gen = sessionGeneration;
            logEvent(CarosMediaEventLog.EV_FOCUS_REGAINED, "resume");
            main.post(() -> {
                if (isStale(gen, "focus_resume")) return;
                // Politika: yalnız focus duraklatmasından (veya gecikmeli odak
                // niyetinden) dönüşte ve kullanıcı duraklatması YOKSA devam
                // edilir — iki koşul da CarosAudioFocusManager'da denetlenir.
                Player p = player;
                if (p != null && p.getMediaItemCount() > 0) {
                    p.setPlayWhenReady(true);
                    lastPauseReason = "";
                }
                publishDiagnostics();
            });
        }
        @Override public void onDuckVolumeChanged(float volume, String dominantReason) {
            final long gen = sessionGeneration;
            logEvent(CarosMediaEventLog.EV_FOCUS_DUCK,
                dominantReason != null ? dominantReason : "released");
            main.post(() -> {
                if (isStale(gen, "duck")) return;
                applyEffectiveVolume();
                publishDiagnostics();
            });
        }
        @Override public void onFocusStateChanged(String focusState) {
            logEvent(CarosMediaEventLog.EV_FOCUS_REQUESTED, focusState);
            main.post(CarosPlaybackService.this::publishDiagnostics);
        }
    }

    /**
     * Bayat geri çağrı kapısı. Generation değiştiyse callback'in ait olduğu
     * oturum ARTIK YOKTUR; işlem yapmak yeni oturumu bozar.
     */
    private boolean isStale(long capturedGeneration, String what) {
        if (capturedGeneration == sessionGeneration) return false;
        eventLog.record(CarosMediaEventLog.EV_STALE_CALLBACK, what, sessionGeneration);
        return true;
    }

    /** Etkin ses = kullanıcı seviyesi × duck çarpanı (tek hesap noktası). */
    private void applyEffectiveVolume() {
        Player p = player;
        if (p == null) return;
        float duck = focusManager != null ? focusManager.getDuckVolume() : 1.0f;
        float eff  = Math.max(0f, Math.min(1f, userVolume * duck));
        p.setVolume(eff);
    }

    /* ── Otorite komutları (yalnız köprü çağırır, main thread) ────────────── */

    /**
     * Kuyruğu değiştirip çalmayı başlatır.
     * @return "" (başarı) veya hata kodu.
     */
    public String setQueueAndPlay(List<MediaItem> items, int startIndex, long positionMs,
                                  String sourceClass, boolean playWhenReady) {
        Player p = player;
        if (p == null) return "player_unavailable";
        if (items == null || items.isEmpty()) return "empty_queue";
        if (items.size() > MAX_QUEUE_ITEMS) return "queue_too_large";

        if (playWhenReady) {
            String focus = focusManager.requestFocus();
            if (CarosAudioFocusManager.FOCUS_FAILED.equals(focus)) {
                lastFailureCode = "focus_denied";
                logEvent(CarosMediaEventLog.EV_FOCUS_DENIED, "set_queue");
                publishDiagnostics();
                return "focus_denied";
            }
            if (CarosAudioFocusManager.FOCUS_DELAYED.equals(focus)) {
                // Gecikmeli odak: ŞİMDİ çalmıyoruz. Niyet KAYDEDİLİR; GAIN gelince
                // onFocusResume başlatır. (Paket A'da bu niyet yoktu → müzik hiç
                // başlamıyordu; bkz. CarosAudioFocusManager.pendingPlayIntent.)
                lastFailureCode = "focus_delayed";
                focusManager.markPlayIntentPending();
                logEvent(CarosMediaEventLog.EV_FOCUS_DELAYED, "set_queue");
            } else {
                logEvent(CarosMediaEventLog.EV_FOCUS_GRANTED, "set_queue");
            }
        }

        activeSource  = sourceClass != null ? sourceClass : "NONE";
        queueRevision++;
        // Yeni kuyruk = yeni dünya → uçuşan focus callback'leri BAYATLAR.
        sessionGeneration++;
        logEvent(CarosMediaEventLog.EV_SOURCE_SWITCH_DONE, activeSource);
        int idx = Math.max(0, Math.min(startIndex, items.size() - 1));

        p.setMediaItems(items, idx, Math.max(0, positionMs));
        p.prepare();
        userVolume = 1.0f;
        applyEffectiveVolume();

        boolean start = playWhenReady && focusManager.hasAudioFocus();
        p.setPlayWhenReady(start);
        if (start) focusManager.markUserPlaying();
        publishDiagnostics();
        return "";
    }

    public String play() {
        Player p = player;
        if (p == null) return "player_unavailable";
        if (p.getMediaItemCount() == 0) return "no_media";
        String focus = focusManager.requestFocus();
        if (CarosAudioFocusManager.FOCUS_FAILED.equals(focus)) {
            logEvent(CarosMediaEventLog.EV_FOCUS_DENIED, "play");
            return "focus_denied";
        }
        if (CarosAudioFocusManager.FOCUS_DELAYED.equals(focus)) {
            // Kullanıcı çalmak İSTEDİ; odak gecikti. Niyeti kaydet ki GAIN
            // geldiğinde oynatma başlasın (sessiz ölüm YOK).
            focusManager.markPlayIntentPending();
            logEvent(CarosMediaEventLog.EV_FOCUS_DELAYED, "play");
            return "focus_delayed";
        }
        logEvent(CarosMediaEventLog.EV_FOCUS_GRANTED, "play");
        focusManager.markUserPlaying();
        lastPauseReason = "";
        p.setPlayWhenReady(true);
        publishDiagnostics();
        return "";
    }

    /** Kullanıcı duraklatması — focus geri gelse bile OTOMATİK BAŞLAMAZ. */
    public String pause() {
        lastPauseReason = "user";
        pauseInternal(true);
        publishDiagnostics();
        return "";
    }

    private void pauseInternal(boolean byUser) {
        Player p = player;
        if (p == null) return;
        if (byUser) focusManager.markUserPaused();
        p.setPlayWhenReady(false);
    }

    public String stop() {
        Player p = player;
        if (p == null) return "player_unavailable";
        focusManager.markUserPaused();
        p.setPlayWhenReady(false);
        p.stop();
        p.clearMediaItems();
        activeSource = "NONE";
        queueRevision++;
        // Durdurma dünyayı değiştirir → uçuşan focus callback'leri BAYATLAR.
        sessionGeneration++;
        focusManager.abandonFocus();
        lastPauseReason = "stopped";
        logEvent(CarosMediaEventLog.EV_COMMAND_ACCEPTED, "stop");
        publishDiagnostics();
        return "";
    }

    public String seekTo(long positionMs) {
        Player p = player;
        if (p == null) return "player_unavailable";
        if (p.getMediaItemCount() == 0) return "no_media";
        p.seekTo(Math.max(0, positionMs));
        publishDiagnostics();
        return "";
    }

    public String next() {
        Player p = player;
        if (p == null) return "player_unavailable";
        if (!p.hasNextMediaItem()) return "no_next_item";
        p.seekToNextMediaItem();
        publishDiagnostics();
        return "";
    }

    public String previous() {
        Player p = player;
        if (p == null) return "player_unavailable";
        // 3 sn kuralı: parça başındaysa önceki parçaya, değilse başa dön.
        if (p.getCurrentPosition() > 3000 || !p.hasPreviousMediaItem()) {
            p.seekTo(0);
        } else {
            p.seekToPreviousMediaItem();
        }
        publishDiagnostics();
        return "";
    }

    public String setShuffle(boolean on) {
        Player p = player;
        if (p == null) return "player_unavailable";
        p.setShuffleModeEnabled(on);
        publishDiagnostics();
        return "";
    }

    public String setRepeat(String mode) {
        Player p = player;
        if (p == null) return "player_unavailable";
        int m;
        if ("one".equals(mode))      m = Player.REPEAT_MODE_ONE;
        else if ("all".equals(mode)) m = Player.REPEAT_MODE_ALL;
        else if ("off".equals(mode)) m = Player.REPEAT_MODE_OFF;
        else return "invalid_repeat_mode";
        p.setRepeatMode(m);
        publishDiagnostics();
        return "";
    }

    /** Kullanıcı medya sesi (0..1). Duck çarpanı ayrı uygulanır. */
    public String setUserVolume(float v) {
        if (Float.isNaN(v) || v < 0f || v > 1f) return "invalid_volume";
        userVolume = v;
        applyEffectiveVolume();
        publishDiagnostics();
        return "";
    }

    public long duck(String reason)      { return focusManager != null ? focusManager.duck(reason) : 0L; }
    public boolean unduck(long token)    { return focusManager != null && focusManager.unduck(token); }

    /* ── Gözlemlenebilirlik ───────────────────────────────────────────────── */

    /**
     * "Gerçekten ses üretiyor" kanıtı: ExoPlayer render ediyor + audio focus bizde
     * + etkin ses > 0. Transport ACK'i başarı sayan katmanların yerine geçer.
     */
    public boolean isRenderingVerified() {
        Player p = player;
        if (p == null || focusManager == null) return false;
        return p.isPlaying()
            && focusManager.hasAudioFocus()
            && p.getVolume() > 0f;
    }

    /** Bounded teşhis anlık görüntüsü — sır/PII TAŞIMAZ (başlık/sanatçı hariç tutulur). */
    public Bundle getDiagnostics() {
        Bundle b = new Bundle();
        Player p = player;
        b.putString("activeSource",        activeSource);
        b.putString("focusState",          focusManager != null ? focusManager.getFocusState() : "NONE");
        b.putBoolean("hasAudioFocus",      focusManager != null && focusManager.hasAudioFocus());
        b.putBoolean("userPaused",         focusManager != null && focusManager.isUserPaused());
        b.putBoolean("pausedByFocus",      focusManager != null && focusManager.isPausedByFocus());
        b.putFloat("duckVolume",           focusManager != null ? focusManager.getDuckVolume() : 1.0f);
        b.putStringArray("duckReasons",    focusManager != null ? focusManager.getActiveDuckReasons() : new String[0]);
        b.putFloat("userVolume",           userVolume);
        b.putFloat("effectiveVolume",      p != null ? p.getVolume() : 0f);
        b.putString("audioRoute",          audioRoute.equals("UNKNOWN") ? readAudioRoute() : audioRoute);
        b.putBoolean("noisyReceiver",      noisyReceiverActive);
        b.putString("lastPauseReason",     lastPauseReason);
        b.putString("lastFailureCode",     lastFailureCode);
        b.putLong("queueRevision",         queueRevision);
        b.putInt("queueLength",            p != null ? p.getMediaItemCount() : 0);
        b.putInt("currentIndex",           p != null ? p.getCurrentMediaItemIndex() : -1);
        b.putLong("positionMs",            p != null ? Math.max(0, p.getCurrentPosition()) : 0L);
        b.putLong("durationMs",            p != null && p.getDuration() != C.TIME_UNSET
                                             ? Math.max(0, p.getDuration()) : 0L);
        b.putBoolean("buffering",          p != null && p.getPlaybackState() == Player.STATE_BUFFERING);
        b.putBoolean("playing",            p != null && p.isPlaying());
        b.putBoolean("playWhenReady",      p != null && p.getPlayWhenReady());
        b.putBoolean("renderingVerified",  isRenderingVerified());
        b.putInt("recoveryCount",          recoveryCount);
        b.putBoolean("shuffle",            p != null && p.getShuffleModeEnabled());
        b.putString("repeat",              repeatToString(p));
        /* ── PAKET B · generation + bounded olay izi ──────────────────────
           Olaylar kompakt satır olarak taşınır (seq|atMs|type|code|gen|repeat);
           Bundle'ı şişirmemek için en fazla 40 kayıt ve YALNIZ en yeniler. */
        b.putLong("sessionGeneration",     sessionGeneration);
        b.putBoolean("pendingPlayIntent",  focusManager != null && focusManager.hasPendingPlayIntent());
        b.putStringArray("events",         eventLog.snapshot(40));
        b.putLong("eventTotal",            eventLog.getTotal());
        b.putLong("eventDropped",          eventLog.getDropped());
        return b;
    }

    private static String repeatToString(Player p) {
        if (p == null) return "off";
        switch (p.getRepeatMode()) {
            case Player.REPEAT_MODE_ONE: return "one";
            case Player.REPEAT_MODE_ALL: return "all";
            default:                     return "off";
        }
    }

    /** Session extras üzerinden teşhis yayını — controller tarafı okur. */
    private void publishDiagnostics() {
        MediaSession s = mediaSession;
        if (s == null) return;
        try { s.setSessionExtras(getDiagnostics()); } catch (Exception ignored) { /* fail-soft */ }
    }

    /* ── Player olayları ──────────────────────────────────────────────────── */

    private final class PlayerListenerImpl implements Player.Listener {
        @Override public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying) { audioRoute = readAudioRoute(); lastFailureCode = ""; }
            publishDiagnostics();
        }
        @Override public void onPlaybackStateChanged(int state) {
            publishDiagnostics();
        }
        @Override public void onPlayerError(@NonNull PlaybackException error) {
            lastFailureCode = "player_error_" + error.errorCode;
            publishDiagnostics();
        }
        @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
            publishDiagnostics();
        }
        @Override public void onPositionDiscontinuity(
            @NonNull Player.PositionInfo old, @NonNull Player.PositionInfo now, int reason) {
            publishDiagnostics();
        }
    }

    /* ── MediaItem üretimi + URI doğrulama ────────────────────────────────── */

    /**
     * Güvenli MediaItem üretir. Kabul edilmeyen şema → null (fail-closed).
     * file:// KABUL EDİLMEZ: uygulama dışı dosya sistemine keyfi erişim yüzeyi.
     */
    public static @Nullable MediaItem buildItem(String uri, String title, String artist,
                                                String artworkUri, String mediaId) {
        if (uri == null || uri.isEmpty()) return null;
        Uri parsed;
        try { parsed = Uri.parse(uri); } catch (Exception e) { return null; }
        String scheme = parsed.getScheme();
        if (scheme == null || !ALLOWED_SCHEMES.contains(scheme.toLowerCase())) return null;

        MediaMetadata.Builder mb = new MediaMetadata.Builder()
            .setTitle(clip(title, 200))
            .setArtist(clip(artist, 200));
        if (artworkUri != null && !artworkUri.isEmpty()) {
            try {
                Uri art = Uri.parse(artworkUri);
                String as = art.getScheme();
                if (as != null && ALLOWED_SCHEMES.contains(as.toLowerCase())) mb.setArtworkUri(art);
            } catch (Exception ignored) { /* kapak yoksa oynatma yine sürer */ }
        }

        MediaItem.Builder ib = new MediaItem.Builder().setUri(parsed).setMediaMetadata(mb.build());
        if (mediaId != null && !mediaId.isEmpty()) ib.setMediaId(clip(mediaId, 128));
        return ib.build();
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    /** Boş olmayan güvenli kuyruk üretir; geçersiz öğeler ATILIR. */
    public static List<MediaItem> buildQueue(List<String[]> rows) {
        List<MediaItem> out = new ArrayList<>();
        if (rows == null) return out;
        for (String[] r : rows) {
            if (out.size() >= MAX_QUEUE_ITEMS) break;
            if (r == null || r.length < 1) continue;
            MediaItem it = buildItem(
                r[0],
                r.length > 1 ? r[1] : "",
                r.length > 2 ? r[2] : "",
                r.length > 3 ? r[3] : "",
                r.length > 4 ? r[4] : "");
            if (it != null) out.add(it);
        }
        return out;
    }

    /** Servis bileşen adı — köprü SessionToken üretiminde kullanır. */
    public static ComponentName componentName(Context ctx) {
        return new ComponentName(ctx.getApplicationContext(), CarosPlaybackService.class);
    }
}
