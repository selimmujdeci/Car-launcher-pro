package com.cockpitos.pro.media;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.List;

/**
 * MÜZİK HUB PAKET A — WebView ↔ native playback authority köprüsü.
 *
 * TEK GİRİŞ NOKTASI: JS katmanı (MediaCommandGateway) yalnız buradan geçer.
 * Köprü hiçbir zaman "komut gönderildi = çalıyor" demez; her yanıt GÖZLENEN
 * durumu taşır ({@code renderingVerified}) — doğrulama yapılamıyorsa bunu
 * açıkça bildirir.
 *
 * BAĞLANTI: MediaController ile {@link CarosPlaybackService}'e bind edilir
 * (servisi başlatır ve canlı tutar). Komutlar aynı process içindeki servis
 * örneğine uygulanır; state değişimleri controller listener'ı üzerinden
 * event olarak JS'e itilir → 5 saniyelik yoklama (polling) gerekmez.
 *
 * GÜVENLİK: payload doğrulaması burada BİTER — sınırlı string uzunluğu,
 * sınırlı kuyruk boyu, şema allowlist'i (CarosPlaybackService.buildItem),
 * bilinmeyen enum reddi. Doğrulanmamış hiçbir değer player'a ulaşmaz.
 */
@OptIn(markerClass = UnstableApi.class)
public final class CarosPlaybackBridge {

    /** JS'e state itmek için köprü sahibi (plugin) uygular. */
    public interface EventSink {
        void emit(String eventName, JSObject payload);
    }

    /** Tek komut sonucu — çağıran bunu doğrudan JS'e döndürür. */
    public static final class CommandResult {
        public final boolean accepted;
        public final String  failureCode;   // "" = hata yok
        public CommandResult(boolean accepted, String failureCode) {
            this.accepted = accepted;
            this.failureCode = failureCode == null ? "" : failureCode;
        }
    }

    private static final int  MAX_STRING     = 240;
    private static final int  MAX_QUEUE      = CarosPlaybackService.MAX_QUEUE_ITEMS;
    /** Aynı commandId'nin tekrar yürütülmesini engelleyen pencere. */
    private static final int  RECENT_COMMAND_MEMORY = 64;
    /** F6 · kabul edilen en fazla EQ bandı (cihaz daha azını bildirebilir). */
    private static final int  MAX_DSP_BANDS  = 32;
    /** F6 · tek bant için kabul edilen mutlak sınır (mB = dB×100). */
    private static final int  MAX_BAND_MILLIBEL = 2000;

    private static volatile CarosPlaybackBridge instance;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private @Nullable EventSink sink;

    private @Nullable MediaController controller;
    private boolean connecting = false;

    /** Replay koruması: son görülen commandId'ler (FIFO, bounded). */
    private final ArrayList<String> recentCommandIds = new ArrayList<>();

    private CarosPlaybackBridge(Context ctx) {
        this.context = ctx.getApplicationContext();
    }

    public static synchronized CarosPlaybackBridge getInstance(Context ctx) {
        if (instance == null) instance = new CarosPlaybackBridge(ctx);
        return instance;
    }

    public void setEventSink(@Nullable EventSink sink) { this.sink = sink; }

    /* ── Bağlantı ─────────────────────────────────────────────────────────── */

    /** Servisi başlatır/bağlar. Zaten bağlıysa hiçbir şey yapmaz (idempotent). */
    public void connect() {
        if (controller != null || connecting) return;
        connecting = true;
        main.post(() -> {
            try {
                SessionToken token = new SessionToken(context, CarosPlaybackService.componentName(context));
                com.google.common.util.concurrent.ListenableFuture<MediaController> future =
                    new MediaController.Builder(context, token).buildAsync();
                future.addListener(() -> {
                    connecting = false;
                    try {
                        MediaController c = future.get();
                        controller = c;
                        c.addListener(new ControllerListener());
                        emitState();
                    } catch (Exception ignored) { /* fail-soft: bağlanamadı */ }
                }, main::post);
            } catch (Exception e) {
                connecting = false;
            }
        });
    }

    /** Zero-Leak: controller'ı bırakır (WebView teardown / plugin destroy). */
    public void release() {
        main.post(() -> {
            MediaController c = controller;
            controller = null;
            if (c != null) { try { c.release(); } catch (Exception ignored) { } }
            recentCommandIds.clear();
        });
    }

    /* ── Komutlar ─────────────────────────────────────────────────────────── */

    /**
     * Tek komut kapısı. Bilinmeyen komut / geçersiz payload REDDEDİLİR.
     * Çağrı main thread'de yürütülür (Player thread-affinity zorunluluğu).
     */
    public CommandResult execute(String commandId, String command, JSObject payload) {
        if (command == null || command.isEmpty()) return new CommandResult(false, "invalid_command");
        if (isReplay(commandId))                  return new CommandResult(false, "duplicate_command");

        connect();   // servis yoksa başlat

        final CommandResult[] out = new CommandResult[1];
        runOnMainSync(() -> out[0] = executeOnMain(command, payload == null ? new JSObject() : payload));
        return out[0] != null ? out[0] : new CommandResult(false, "command_timeout");
    }

    private CommandResult executeOnMain(String command, JSObject p) {
        CarosPlaybackService svc = CarosPlaybackService.peek();
        if (svc == null) return new CommandResult(false, "authority_unavailable");

        String err;
        switch (command) {
            case "setQueue": {
                List<MediaItem> items = parseQueue(p);
                if (items.isEmpty()) return new CommandResult(false, "empty_queue");
                int  index      = clampInt(p.optInt("startIndex", 0), 0, items.size() - 1);
                long positionMs = clampLong(optLong(p, "positionMs"), 0L, Long.MAX_VALUE / 4);
                String source   = safeEnum(p.getString("source", ""),
                    CarosPlaybackService.SOURCE_LOCAL,
                    CarosPlaybackService.SOURCE_STREAM,
                    CarosPlaybackService.SOURCE_RADIO);
                if (source == null) return new CommandResult(false, "invalid_source");
                boolean autoPlay = p.optBoolean("play", true);
                err = svc.setQueueAndPlay(items, index, positionMs, source, autoPlay);
                break;
            }
            case "play":     err = svc.play();     break;
            case "pause":    err = svc.pause();    break;
            case "stop":     err = svc.stop();     break;
            case "next":     err = svc.next();     break;
            case "previous": err = svc.previous(); break;
            case "seek": {
                long pos = optLong(p, "positionMs");
                if (pos < 0) return new CommandResult(false, "invalid_position");
                err = svc.seekTo(pos);
                break;
            }
            case "setShuffle": err = svc.setShuffle(p.optBoolean("enabled", false)); break;
            case "setRepeat": {
                String mode = safeEnum(p.getString("mode", ""), "off", "one", "all");
                if (mode == null) return new CommandResult(false, "invalid_repeat_mode");
                err = svc.setRepeat(mode);
                break;
            }
            case "setVolume": {
                double v = p.optDouble("volume", -1);
                if (v < 0 || v > 1) return new CommandResult(false, "invalid_volume");
                err = svc.setUserVolume((float) v);
                break;
            }
            case "duck": {
                String reason = p.getString("reason", "");
                if (!CarosAudioFocusManager.isKnownDuckReason(reason)) {
                    return new CommandResult(false, "invalid_duck_reason");
                }
                long token = svc.duck(reason);
                if (token == 0L) return new CommandResult(false, "duck_rejected");
                emitState();
                return new CommandResult(true, "");
            }
            case "unduck": {
                long token = optLong(p, "token");
                if (token <= 0) return new CommandResult(false, "invalid_duck_token");
                boolean ok = svc.unduck(token);
                emitState();
                // Bayat token sesi yükseltemez; bu bir HATA değil, "etkisiz" durumudur.
                return new CommandResult(ok, ok ? "" : "stale_duck_token");
            }
            case "setTransitionPolicy": {
                /* MUSIC F20 — politika JS tarafındadır; burası yalnız uygular.
                   Süreler native tarafta da SINIRLANIR (savunmalı kapı). */
                boolean enabled = p.optBoolean("fadeEnabled", false);
                int outMs = p.optInt("fadeOutMs", 0);
                int inMs  = p.optInt("fadeInMs", 0);
                if (outMs < 0 || inMs < 0) return new CommandResult(false, "invalid_transition");
                err = svc.setTransitionPolicy(enabled, outMs, inMs);
                break;
            }
            default:
                return new CommandResult(false, "unknown_command");
        }

        emitState();
        return new CommandResult(err.isEmpty(), err);
    }

    /* ── MUSIC F6 · Ses deneyimi (DSP) ────────────────────────────────────
     *
     * TEK tüketici JS tarafındaki `audioExperienceAuthority`'dir. Bu üç metot
     * OYNATMA KOMUTU GÖNDERMEZ, kullanıcı sesini DEĞİŞTİRMEZ ve focus'a
     * dokunmaz — yalnız ses rengini (EQ · loudness · denge · güvenlik
     * kazancı) yönetir.
     */

    /** Cihazın GERÇEK DSP yüzeyi. Servis yoksa `probed:false` döner. */
    public JSObject audioDspCapabilities() {
        final JSObject[] out = new JSObject[1];
        runOnMainSync(() -> {
            CarosPlaybackService svc = CarosPlaybackService.peek();
            out[0] = svc == null ? unavailableCapabilities()
                                 : bundleToJson(svc.getAudioEffects().capabilities());
        });
        return out[0] != null ? out[0] : unavailableCapabilities();
    }

    /** Efekt katmanının bounded gözlemi. */
    public JSObject audioDspSnapshot() {
        final JSObject[] out = new JSObject[1];
        runOnMainSync(() -> {
            CarosPlaybackService svc = CarosPlaybackService.peek();
            out[0] = svc == null ? unavailableDspSnapshot()
                                 : bundleToJson(svc.getAudioEffects().snapshot());
        });
        return out[0] != null ? out[0] : unavailableDspSnapshot();
    }

    /**
     * Ayarı uygular. Doğrulama BURADA biter: bant sayısı sınırlı, kazançlar
     * sınırlı, kuşak zorunlu. Sonuç HER ZAMAN gözlenen durumu taşır —
     * "gönderdim, oldu saydım" yoktur.
     */
    public JSObject audioDspApply(JSObject p) {
        final JSObject[] out = new JSObject[1];
        runOnMainSync(() -> out[0] = audioDspApplyOnMain(p == null ? new JSObject() : p));
        if (out[0] != null) return out[0];
        JSObject timeout = new JSObject();
        timeout.put("applied", false);
        timeout.put("failureCode", "command_timeout");
        return timeout;
    }

    private JSObject audioDspApplyOnMain(JSObject p) {
        JSObject res = new JSObject();
        CarosPlaybackService svc = CarosPlaybackService.peek();
        if (svc == null) {
            res.put("applied", false);
            res.put("failureCode", "authority_unavailable");
            return res;
        }

        long generation = optLong(p, "generation");
        if (generation < 0) {
            res.put("applied", false);
            res.put("failureCode", "invalid_generation");
            return res;
        }

        boolean enabled = p.optBoolean("enabled", true);

        int[] bands = new int[0];
        try {
            org.json.JSONArray arr = p.getJSONArray("bandsMilliBel");
            if (arr != null) {
                int n = Math.min(arr.length(), MAX_DSP_BANDS);
                bands = new int[n];
                for (int i = 0; i < n; i++) {
                    bands[i] = clampInt(arr.optInt(i, 0), -MAX_BAND_MILLIBEL, MAX_BAND_MILLIBEL);
                }
            }
        } catch (Exception ignored) { /* bozuk dizi → EQ yazımı yapılmaz */ }

        int loudness = clampInt((int) Math.round(p.optDouble("loudnessMilliBel", 0)),
            0, CarosAudioEffects.MAX_LOUDNESS_MILLIBEL);

        double rawPreamp = p.optDouble("preampLinear", 1.0);
        double rawBalance = p.optDouble("balance", 0.0);
        if (Double.isNaN(rawPreamp) || Double.isNaN(rawBalance)) {
            res.put("applied", false);
            res.put("failureCode", "invalid_gain");
            return res;
        }

        String err = svc.getAudioEffects().apply(
            generation, enabled, bands, loudness, (float) rawPreamp, (float) rawBalance);

        res.put("applied", err.isEmpty());
        res.put("failureCode", err);
        res.put("snapshot", bundleToJson(svc.getAudioEffects().snapshot()));
        return res;
    }

    private static JSObject unavailableCapabilities() {
        JSObject o = new JSObject();
        o.put("probed", false);
        o.put("unavailableReason", "authority_unavailable");
        o.put("generation", 0);
        return o;
    }

    private static JSObject unavailableDspSnapshot() {
        JSObject o = new JSObject();
        o.put("available", false);
        o.put("bypass", true);
        o.put("bypassReason", "authority_unavailable");
        return o;
    }

    /** Bounded Bundle → JSObject. Yalnız bilinen ilkel tipler taşınır. */
    private static JSObject bundleToJson(Bundle b) {
        JSObject o = new JSObject();
        if (b == null) return o;
        for (String key : b.keySet()) {
            Object v = b.get(key);
            if (v instanceof Boolean)      o.put(key, (Boolean) v);
            else if (v instanceof Integer) o.put(key, (Integer) v);
            else if (v instanceof Long)    o.put(key, (Long) v);
            else if (v instanceof Float)   o.put(key, ((Float) v).doubleValue());
            else if (v instanceof Double)  o.put(key, (Double) v);
            else if (v instanceof String)  o.put(key, (String) v);
            else if (v instanceof int[]) {
                JSArray arr = new JSArray();
                for (int x : (int[]) v) arr.put(x);
                o.put(key, arr);
            }
            // Bilinmeyen tip TAŞINMAZ — uydurma alan üretilmez.
        }
        return o;
    }

    /* ── Snapshot ─────────────────────────────────────────────────────────── */

    /** Anlık gözlem — hiçbir alanı uydurmaz; bilinmeyen alan UNKNOWN kalır. */
    public JSObject snapshot() {
        final JSObject[] out = new JSObject[1];
        runOnMainSync(() -> out[0] = snapshotOnMain());
        return out[0] != null ? out[0] : unavailableSnapshot();
    }

    private JSObject snapshotOnMain() {
        CarosPlaybackService svc = CarosPlaybackService.peek();
        if (svc == null) return unavailableSnapshot();

        Bundle d = svc.getDiagnostics();
        JSObject o = new JSObject();
        o.put("authorityAvailable", true);
        o.put("activeSource",       d.getString("activeSource", "NONE"));
        o.put("focusState",         d.getString("focusState", "NONE"));
        o.put("hasAudioFocus",      d.getBoolean("hasAudioFocus", false));
        o.put("userPaused",         d.getBoolean("userPaused", false));
        o.put("pausedByFocus",      d.getBoolean("pausedByFocus", false));
        o.put("duckVolume",         d.getFloat("duckVolume", 1f));
        o.put("userVolume",         d.getFloat("userVolume", 1f));
        o.put("effectiveVolume",    d.getFloat("effectiveVolume", 0f));
        o.put("audioRoute",         d.getString("audioRoute", "UNKNOWN"));
        o.put("noisyReceiver",      d.getBoolean("noisyReceiver", false));
        o.put("lastPauseReason",    d.getString("lastPauseReason", ""));
        o.put("lastFailureCode",    d.getString("lastFailureCode", ""));
        o.put("queueRevision",      d.getLong("queueRevision", 0L));
        o.put("queueLength",        d.getInt("queueLength", 0));
        o.put("currentIndex",       d.getInt("currentIndex", -1));
        /* F3.2 — timeline KANITI. Player yokken alan HİÇ konmaz: "kuyruk boş" ile
           "timeline bildirilmedi" ayrı teşhislerdir ve boş dizi ikincisini
           birincisi gibi göstererek uydurma bir gözlem üretirdi. */
        String[] entryIds = d.getStringArray("queueEntryIds");
        if (entryIds != null) {
            o.put("queueEntryIds", new org.json.JSONArray(java.util.Arrays.asList(entryIds)));
        }
        o.put("positionMs",         d.getLong("positionMs", 0L));
        o.put("durationMs",         d.getLong("durationMs", 0L));
        o.put("buffering",          d.getBoolean("buffering", false));
        o.put("playing",            d.getBoolean("playing", false));
        o.put("playWhenReady",      d.getBoolean("playWhenReady", false));
        o.put("renderingVerified",  d.getBoolean("renderingVerified", false));
        o.put("recoveryCount",      d.getInt("recoveryCount", 0));
        /* MUSIC F20 — geçiş kanıtı. Servis bu alanları ZATEN üretiyordu ama bu
           allowlist'te yoktu → JS'e HİÇ ulaşmıyordu ve LAB satırı kalıcı
           olarak KAYNAK YOK görünüyordu (telefon ön doğrulamasında ölçüldü).
           Bunlar playback TRUTH DEĞİLDİR: yalnız gözlem alanlarıdır. */
        o.put("fadeEnabled",        d.getBoolean("fadeEnabled", false));
        o.put("fadeOutMs",          d.getInt("fadeOutMs", 0));
        o.put("fadeInMs",           d.getInt("fadeInMs", 0));
        o.put("transitionGain",     d.getFloat("transitionGain", 1f));
        o.put("transitionActive",   d.getBoolean("transitionActive", false));
        o.put("gaplessSupported",   d.getBoolean("gaplessSupported", false));
        o.put("shuffle",            d.getBoolean("shuffle", false));
        o.put("repeat",             d.getString("repeat", "off"));

        JSArray reasons = new JSArray();
        String[] rr = d.getStringArray("duckReasons");
        if (rr != null) for (String r : rr) reasons.put(r);
        o.put("duckReasons", reasons);

        // Metadata: UI için gerekli; LAB'a taşınmaz (JS evidence yalnız VAR/YOK okur).
        MediaController c = controller;
        if (c != null) {
            try {
                MediaMetadata m = c.getMediaMetadata();
                o.put("title",  m.title  != null ? m.title.toString()  : "");
                o.put("artist", m.artist != null ? m.artist.toString() : "");
                o.put("artworkUri", m.artworkUri != null ? m.artworkUri.toString() : "");
                MediaItem cur = c.getCurrentMediaItem();
                o.put("currentTrackId", cur != null ? cur.mediaId : "");
            } catch (Exception ignored) { /* metadata okunamadı → boş bırak */ }
        }
        return o;
    }

    private JSObject unavailableSnapshot() {
        JSObject o = new JSObject();
        o.put("authorityAvailable", false);
        o.put("activeSource",   "NONE");
        o.put("focusState",     "NONE");
        o.put("audioRoute",     "UNKNOWN");
        o.put("playing",        false);
        o.put("renderingVerified", false);
        return o;
    }

    private void emitState() {
        EventSink s = sink;
        if (s == null) return;
        try { s.emit("mediaAuthorityEvent", snapshotOnMain()); } catch (Exception ignored) { }
    }

    private final class ControllerListener implements Player.Listener {
        @Override public void onIsPlayingChanged(boolean isPlaying)       { emitState(); }
        @Override public void onPlaybackStateChanged(int state)           { emitState(); }
        @Override public void onMediaMetadataChanged(@NonNull MediaMetadata m) { emitState(); }
        @Override public void onMediaItemTransition(@Nullable MediaItem i, int r) { emitState(); }
        @Override public void onPlayerError(@NonNull androidx.media3.common.PlaybackException e) { emitState(); }
        @Override public void onShuffleModeEnabledChanged(boolean enabled) { emitState(); }
        @Override public void onRepeatModeChanged(int repeatMode)          { emitState(); }
    }

    /* ── Payload doğrulama ────────────────────────────────────────────────── */

    private List<MediaItem> parseQueue(JSObject p) {
        List<MediaItem> out = new ArrayList<>();
        try {
            /* `JSObject.getJSONArray()` zaten org.json.JSONArray döndürür.
             * Bunu `JSArray.from()` ile tekrar sarmak, Capacitor 7'de bir
             * JSONArray'i Java array/Collection sanıp null üretir; sonuçta
             * geçerli LOCAL payload'ı bile `empty_queue` olur. */
            org.json.JSONArray arr = p.getJSONArray("items");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                if (out.size() >= MAX_QUEUE) break;
                org.json.JSONObject j = arr.optJSONObject(i);
                if (j == null) continue;
                MediaItem item = CarosPlaybackService.buildItem(
                    clip(j.optString("uri", "")),
                    clip(j.optString("title", "")),
                    clip(j.optString("artist", "")),
                    clip(j.optString("artworkUri", "")),
                    clip(j.optString("id", "")));
                if (item != null) out.add(item);   // geçersiz şema → sessizce atılır
            }
        } catch (Exception ignored) { /* bozuk payload → boş kuyruk (fail-closed) */ }
        return out;
    }

    private static String clip(String s) {
        if (s == null) return "";
        return s.length() <= MAX_STRING ? s : s.substring(0, MAX_STRING);
    }

    /** Bilinmeyen enum → null (fail-closed; sessizce varsayılana DÜŞMEZ). */
    private static @Nullable String safeEnum(String value, String... allowed) {
        if (value == null) return null;
        for (String a : allowed) if (a.equals(value)) return a;
        return null;
    }

    private static int clampInt(int v, int lo, int hi)    { return Math.max(lo, Math.min(hi, v)); }
    private static long clampLong(long v, long lo, long hi) { return Math.max(lo, Math.min(hi, v)); }

    private static long optLong(JSObject p, String key) {
        try {
            Object v = p.opt(key);
            if (v instanceof Number) return ((Number) v).longValue();
            if (v instanceof String) return Long.parseLong((String) v);
        } catch (Exception ignored) { }
        return -1L;
    }

    /** Aynı commandId ikinci kez yürütülmez (replay/çift dokunuş koruması). */
    private synchronized boolean isReplay(String commandId) {
        if (commandId == null || commandId.isEmpty()) return false; // id yoksa dedupe yapılamaz
        if (recentCommandIds.contains(commandId)) return true;
        recentCommandIds.add(commandId);
        while (recentCommandIds.size() > RECENT_COMMAND_MEMORY) recentCommandIds.remove(0);
        return false;
    }

    /** Player çağrıları main thread'de olmalı; çağıran thread bloklanır (bounded). */
    private void runOnMainSync(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) { r.run(); return; }
        final Object lock = new Object();
        final boolean[] done = { false };
        main.post(() -> {
            try { r.run(); } finally {
                synchronized (lock) { done[0] = true; lock.notifyAll(); }
            }
        });
        synchronized (lock) {
            long deadline = System.currentTimeMillis() + 2000;
            while (!done[0]) {
                long wait = deadline - System.currentTimeMillis();
                if (wait <= 0) break;   // bounded: main thread tıkalıysa sonsuz bekleme YOK
                try { lock.wait(wait); } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }
}
