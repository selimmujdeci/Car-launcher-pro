package com.cockpitos.pro.media;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;

import com.cockpitos.pro.MediaListenerService;
import com.cockpitos.pro.PluginUtils;
import com.getcapacitor.JSObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Map;

/**
 * MediaManager — Centralized media session management for CockpitOS.
 * Extracted from CarLauncherPlugin.
 */
public class MediaManager {

    public interface OnMediaUpdateListener {
        void onMetadataChanged(JSObject metadata);
        void onPlaybackStateChanged(String state);
    }

    private static MediaManager instance;
    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private OnMediaUpdateListener listener;

    private volatile MediaController activeMediaController = null;
    private volatile MediaController.Callback mediaCallback = null;
    private volatile MediaSessionManager.OnActiveSessionsChangedListener activeSessionsListener = null;
    private volatile boolean mediaListenerRegistered = false;
    private volatile String preferredMediaPackage = "";

    private final ExecutorService artLoaderExecutor = Executors.newSingleThreadExecutor();
    private final LinkedHashMap<String, String> artCache =
        new LinkedHashMap<String, String>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
                return size() > 12;
            }
        };
    private final HashSet<String> artInFlight = new HashSet<>();

    private MediaManager(Context context) {
        this.context = context.getApplicationContext();
    }

    public static synchronized MediaManager getInstance(Context context) {
        if (instance == null) {
            instance = new MediaManager(context);
        }
        return instance;
    }

    public void setListener(OnMediaUpdateListener listener) {
        this.listener = listener;
    }

    public void setPreferredMediaPackage(String packageName) {
        this.preferredMediaPackage = packageName != null ? packageName : "";
    }

    public void sendMediaCommand(String action) throws Exception {
        MediaController ctrl = activeMediaController;
        if (ctrl == null) {
            MediaListenerService svc = MediaListenerService.instance;
            if (svc != null) {
                MediaSessionManager msm = (MediaSessionManager)
                    context.getSystemService(Context.MEDIA_SESSION_SERVICE);
                ComponentName cn = new ComponentName(context, MediaListenerService.class);
                List<MediaController> controllers = msm.getActiveSessions(cn);
                if (!controllers.isEmpty()) {
                    ctrl = controllers.get(0);
                    ensureMediaCallback(ctrl);
                }
            }
        }

        if (ctrl != null) {
            MediaController.TransportControls tc = ctrl.getTransportControls();
            switch (action) {
                case "play":     tc.play();     break;
                case "pause":    tc.pause();    break;
                case "next":     tc.skipToNext(); break;
                case "previous": tc.skipToPrevious(); break;
                default:
                    throw new IllegalArgumentException("Invalid action: " + action);
            }
        } else {
            throw new IllegalStateException("No active media session");
        }
    }

    public JSObject getMediaMetadata(String preferred) {
        MediaListenerService svc = MediaListenerService.instance;
        if (svc == null) return null;

        MediaSessionManager msm = (MediaSessionManager)
            context.getSystemService(Context.MEDIA_SESSION_SERVICE);
        ComponentName cn = new ComponentName(context, MediaListenerService.class);
        List<MediaController> controllers = msm.getActiveSessions(cn);

        if (controllers.isEmpty()) return null;

        MediaController ctrl = controllers.get(0);
        if (preferred != null && !preferred.isEmpty()) {
            preferredMediaPackage = preferred;
            for (MediaController c : controllers) {
                if (preferred.equals(c.getPackageName())) {
                    ctrl = c;
                    break;
                }
            }
        }
        ensureMediaCallback(ctrl);
        attachMediaSessionsListener();

        JSObject result = buildMediaInfo(ctrl);
        result.put("sessionCount", controllers.size());
        return result;
    }

    public void attachMediaSessionsListener() {
        if (mediaListenerRegistered) return;
        MediaListenerService svc = MediaListenerService.instance;
        if (svc == null) return;

        try {
            final MediaSessionManager msm = (MediaSessionManager)
                context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm == null) return;

            final ComponentName cn = new ComponentName(context, MediaListenerService.class);

            activeSessionsListener = controllers -> {
                if (controllers == null || controllers.isEmpty()) {
                    if (activeMediaController != null && mediaCallback != null) {
                        try { activeMediaController.unregisterCallback(mediaCallback); } catch (Exception ignored) {}
                        activeMediaController = null;
                        mediaCallback = null;
                    }
                    notifyChange(null);
                    return;
                }

                MediaController target = controllers.get(0);
                String pref = preferredMediaPackage;
                if (pref != null && !pref.isEmpty()) {
                    for (MediaController c : controllers) {
                        if (pref.equals(c.getPackageName())) {
                            target = c;
                            break;
                        }
                    }
                }

                ensureMediaCallback(target);
                notifyChange(target);
            };

            msm.addOnActiveSessionsChangedListener(activeSessionsListener, cn, mainHandler);
            mediaListenerRegistered = true;

            List<MediaController> initial = msm.getActiveSessions(cn);
            if (initial != null && !initial.isEmpty()) {
                MediaController target = initial.get(0);
                String pref = preferredMediaPackage;
                if (pref != null && !pref.isEmpty()) {
                    for (MediaController c : initial) {
                        if (pref.equals(c.getPackageName())) { target = c; break; }
                    }
                }
                ensureMediaCallback(target);
                notifyChange(target);
            }
        } catch (Exception ignored) {}
    }

    public void detachMediaSessionsListener() {
        if (!mediaListenerRegistered) return;
        try {
            MediaSessionManager msm = (MediaSessionManager)
                context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm != null && activeSessionsListener != null) {
                msm.removeOnActiveSessionsChangedListener(activeSessionsListener);
            }
        } catch (Exception ignored) {}
        activeSessionsListener = null;
        mediaListenerRegistered = false;
    }

    private void ensureMediaCallback(MediaController ctrl) {
        if (ctrl.equals(activeMediaController)) return;

        if (activeMediaController != null && mediaCallback != null) {
            try { activeMediaController.unregisterCallback(mediaCallback); } catch (Exception ignored) {}
        }

        activeMediaController = ctrl;

        mediaCallback = new MediaController.Callback() {
            @Override
            public void onMetadataChanged(MediaMetadata metadata) {
                notifyChange(ctrl);
            }

            @Override
            public void onPlaybackStateChanged(PlaybackState state) {
                notifyChange(ctrl);
                if (listener != null && state != null) {
                    listener.onPlaybackStateChanged(playbackStateToString(state.getState()));
                }
            }

            @Override
            public void onSessionDestroyed() {
                if (ctrl.equals(activeMediaController)) {
                    activeMediaController = null;
                    mediaCallback = null;
                }
            }
        };

        ctrl.registerCallback(mediaCallback, mainHandler);
    }

    private void notifyChange(MediaController ctrl) {
        if (listener != null) {
            JSObject info = (ctrl != null) ? buildMediaInfo(ctrl) : buildEmptyMediaInfo();
            listener.onMetadataChanged(info);
        }
    }

    private JSObject buildEmptyMediaInfo() {
        JSObject empty = new JSObject();
        empty.put("packageName", "");
        empty.put("appName",     "");
        empty.put("title",       "");
        empty.put("artist",      "");
        empty.put("playing",     false);
        empty.put("durationMs",  0L);
        empty.put("positionMs",  0L);
        return empty;
    }

    private JSObject buildMediaInfo(MediaController ctrl) {
        JSObject out = new JSObject();
        out.put("packageName", ctrl.getPackageName());

        String appName = ctrl.getPackageName();
        try {
            appName = (String) context.getPackageManager()
                .getApplicationLabel(context.getPackageManager()
                    .getApplicationInfo(ctrl.getPackageName(), 0));
        } catch (Exception ignored) {}
        out.put("appName", appName);

        MediaMetadata meta = ctrl.getMetadata();
        PlaybackState state = ctrl.getPlaybackState();

        if (meta != null) {
            out.put("title", safe(meta.getString(MediaMetadata.METADATA_KEY_TITLE)));
            out.put("artist", safe(meta.getString(MediaMetadata.METADATA_KEY_ARTIST)));
            out.put("durationMs", meta.getLong(MediaMetadata.METADATA_KEY_DURATION));

            Bitmap art = meta.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (art == null) art = meta.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (art == null) art = meta.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);

            if (art != null) {
                out.put("albumArt", PluginUtils.bitmapToDataUri(art));
            } else {
                String uri = PluginUtils.firstNonEmpty(
                    meta.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI),
                    meta.getString(MediaMetadata.METADATA_KEY_ART_URI),
                    meta.getString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI)
                );
                if (uri != null) {
                    String cached;
                    boolean scheduleLoad = false;
                    synchronized (artCache) {
                        cached = artCache.get(uri);
                        if (cached == null && !artInFlight.contains(uri)) {
                            artInFlight.add(uri);
                            scheduleLoad = true;
                        }
                    }
                    if (cached != null) {
                        out.put("albumArt", cached);
                    } else if (scheduleLoad) {
                        loadArtAsync(ctrl, uri);
                    }
                }
            }
        } else {
            out.put("title", "");
            out.put("artist", "");
            out.put("durationMs", 0L);
        }

        boolean playing = state != null && state.getState() == PlaybackState.STATE_PLAYING;
        out.put("playing", playing);
        out.put("positionMs", state != null ? state.getPosition() : 0L);

        return out;
    }

    private void loadArtAsync(final MediaController ctrl, final String uri) {
        artLoaderExecutor.submit(() -> {
            String dataUri = null;
            try {
                Bitmap b = PluginUtils.loadBitmapFromUri(context, uri);
                if (b != null) dataUri = PluginUtils.bitmapToDataUri(b);
            } catch (Throwable ignored) {}

            synchronized (artCache) {
                artInFlight.remove(uri);
                if (dataUri != null) artCache.put(uri, dataUri);
            }

            if (dataUri != null) {
                mainHandler.post(() -> {
                    MediaController active = activeMediaController;
                    if (active != null && active.equals(ctrl)) {
                        notifyChange(ctrl);
                    }
                });
            }
        });
    }

    public void getMediaArtDataUri(String uri, ArtCallback callback) {
        if (uri == null || uri.isEmpty()) {
            callback.onResult("");
            return;
        }

        synchronized (artCache) {
            String cached = artCache.get(uri);
            if (cached != null) {
                callback.onResult(cached);
                return;
            }
        }

        artLoaderExecutor.submit(() -> {
            String dataUri = "";
            try {
                Bitmap b = PluginUtils.loadBitmapFromUri(context, uri);
                if (b != null) {
                    dataUri = PluginUtils.bitmapToDataUri(b);
                    if (!dataUri.isEmpty()) {
                        synchronized (artCache) { artCache.put(uri, dataUri); }
                    }
                }
            } catch (Throwable ignored) {}
            final String finalUri = dataUri;
            mainHandler.post(() -> callback.onResult(finalUri));
        });
    }

    public interface ArtCallback {
        void onResult(String dataUri);
    }

    private String safe(String s) { return s == null ? "" : s; }

    private String playbackStateToString(int state) {
        switch (state) {
            case PlaybackState.STATE_PLAYING: return "playing";
            case PlaybackState.STATE_PAUSED:  return "paused";
            case PlaybackState.STATE_STOPPED: return "stopped";
            case PlaybackState.STATE_BUFFERING: return "buffering";
            case PlaybackState.STATE_ERROR: return "error";
            default: return "none";
        }
    }
}
