package com.cockpitos.pro.notify;

import android.app.ActivityOptions;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.StatusBarNotification;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * NotificationMirror — telefon/araç bildirimlerinden YALNIZ arama · cevapsız
 * arama · mesaj kategorilerini JS'e aktarır ve gerçek eylemlerini tetikler
 * (cevapla · reddet · kapat · yanıtla).
 *
 * ÖLÇÜLEN KUSUR: `notificationService` bir `notification` olayı bekliyordu ama
 * native tarafta onu üreten HİÇBİR kod yoktu (`MediaListenerService` bildirimleri
 * bilerek yok sayıyordu). Telefon Merkezi'nin Aramalar/Mesajlar bölümleri ve
 * gelen arama kartı bu yüzden hiç veri almıyordu.
 *
 * GİZLİLİK: içerik LOGLANMAZ ve diske YAZILMAZ. Eylem tetikleyebilmek için yalnız
 * son {@link #MAX_TRACKED} bildirim bellekte tutulur. Diğer tüm kategoriler
 * (medya, sistem, indirme, e-posta vb.) AKTARILMAZ.
 *
 * Eylem bulunamazsa sahte başarı ÜRETİLMEZ: {@code ok:false} + gerekçe döner.
 */
public final class NotificationMirror {

    /** JS köprüsü — plugin yüklenince bağlanır. */
    public interface Sink {
        void posted(JSObject data);
        void removed(String key);
        /** Sistem dinleyiciyi kopardı — artık arama/mesaj sinyali YOK. */
        void listenerLost();
    }

    public static final String CAT_CALL = "call";
    public static final String CAT_MISSED_CALL = "missed_call";
    public static final String CAT_MESSAGE = "message";

    public static final String KIND_ANSWER = "ANSWER";
    public static final String KIND_DECLINE = "DECLINE";
    public static final String KIND_HANG_UP = "HANG_UP";
    public static final String KIND_REPLY = "REPLY";
    public static final String KIND_CALL_BACK = "CALL_BACK";
    public static final String KIND_OTHER = "OTHER";

    static final int MAX_TRACKED = 30;

    private static volatile Sink sink;
    private static final Map<String, Notification> TRACKED = new LinkedHashMap<String, Notification>(16, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Notification> eldest) {
            return size() > MAX_TRACKED;
        }
    };

    private NotificationMirror() { }

    public static void setSink(Sink s) { sink = s; }

    /* ══════════════════════════════════════════════════════════════════════
     * SAF KARARLAR (JVM testiyle kilitli — Android nesnesi almaz)
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Aktarılacak kategori; aktarılmayacaksa {@code null}.
     * Önce platformun beyan ettiği kategori, sonra MessagingStyle, sonra arama
     * uygulaması + "cevapsız" metni, en son serbest yanıt girdisi (sohbet).
     */
    static String classify(String notifCategory, boolean messagingStyle, boolean hasFreeFormReply,
                           String packageName, String text) {
        if (Notification.CATEGORY_CALL.equals(notifCategory)) return CAT_CALL;
        if ("missed_call".equals(notifCategory)) return CAT_MISSED_CALL;   // CATEGORY_MISSED_CALL (API 30)
        if (Notification.CATEGORY_MESSAGE.equals(notifCategory) || messagingStyle) return CAT_MESSAGE;
        final String pkg = packageName == null ? "" : packageName.toLowerCase(Locale.ROOT);
        final String t = text == null ? "" : text.toLowerCase(new Locale("tr", "TR"));
        final boolean callApp = pkg.contains("dialer") || pkg.contains("incallui") || pkg.contains("telecom")
            || pkg.contains("bluetooth") || pkg.contains(".bt") || pkg.contains("phone");
        if (callApp && (t.contains("cevapsız") || t.contains("missed"))) return CAT_MISSED_CALL;
        if (hasFreeFormReply) return CAT_MESSAGE;
        return null;
    }

    /** Eylem türü: serbest yanıt → REPLY; arama bildiriminde başlık sezgisi. */
    static String actionKind(String title, boolean hasFreeFormInput, boolean semanticReply, boolean isCall) {
        /* Metin YAZILABİLEN eylem yanıttır; yazılamayan "yanıtla" (uygulamayı
           açar) yanıt sayılmaz ve arama eylemiyle de KARIŞTIRILMAZ. */
        if (hasFreeFormInput) return KIND_REPLY;
        if (semanticReply || !isCall) return KIND_OTHER;
        final String t = lower(title);
        /* Hoparlör/mikrofon/sessiz ve "mesajla reddet" arama eylemi DEĞİLDİR:
           "Hoparlörü kapat"ın görüşmeyi kapatmaya eşlenmesi tehlikeli olurdu. */
        if (t.contains("hoparlör") || t.contains("speaker") || t.contains("mikrofon") || t.contains("sessiz")
            || t.contains("mute") || t.contains("mesaj") || t.contains("message") || t.contains("sms")) {
            return KIND_OTHER;
        }
        if (t.contains("cevapla") || t.contains("yanıtla") || t.contains("kabul") || t.contains("answer")
            || t.contains("accept")) return KIND_ANSWER;
        if (t.contains("reddet") || t.contains("decline") || t.contains("reject")) return KIND_DECLINE;
        /* SAHA 2026-09-23 (Xiaomi MIUI InCallUI, AOSP tabanlı): çalan aramanın
           reddetme eylemi "Yoksay" başlığını taşır (AOSP "Dismiss" →
           ACTION_DECLINE_INCOMING_CALL). Tam eşleşme — başka metin sayılmaz. */
        if (t.equals("yoksay") || t.equals("yok say") || t.equals("dismiss")) return KIND_DECLINE;
        if (t.contains("kapat") || t.contains("sonlandır") || t.contains("bitir") || t.contains("hang up")
            || t.contains("end call")) return KIND_HANG_UP;
        return KIND_OTHER;
    }

    /** Cevapsız arama bildirimi: yalnız "Geri ara" tanınır (Mesaj vb. geçmez). */
    static String missedCallActionKind(String title) {
        final String t = lower(title);
        return t.contains("geri ara") || t.contains("call back") || t.contains("callback")
            || t.equals("ara") || t.equals("call") ? KIND_CALL_BACK : KIND_OTHER;
    }

    private static String lower(String s) {
        return s == null ? "" : s.trim().toLowerCase(new Locale("tr", "TR"));
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Servis → JS
     * ════════════════════════════════════════════════════════════════════ */

    public static void onPosted(StatusBarNotification sbn, PackageManager pm, String ownPackage) {
        final Sink s = sink;
        if (s == null || sbn == null) return;
        try {
            final Notification n = sbn.getNotification();
            if (n == null || ownPackage.equals(sbn.getPackageName())) return;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

            final Bundle extras = n.extras != null ? n.extras : new Bundle();
            String sender = str(extras.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(extras.getCharSequence(Notification.EXTRA_TEXT));
            /* MessagingStyle: son mesajın metni ve göndereni daha doğrudur. */
            final Parcelable[] messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            final boolean messagingStyle = messages != null && messages.length > 0;
            boolean ownReplyLast = false;
            if (messagingStyle) {
                final Parcelable last = messages[messages.length - 1];
                if (last instanceof Bundle) {
                    final Bundle lb = (Bundle) last;
                    final String mText = str(lb.getCharSequence("text"));
                    final String mSender = str(lb.getCharSequence("sender"));
                    if (!mText.isEmpty()) text = mText;
                    if (!mSender.isEmpty() && sender.isEmpty()) sender = mSender;
                    /* MessagingStyle sözleşmesi: göndereni OLMAYAN mesaj kullanıcının
                       kendisinindir. Hazır yanıttan sonra uygulama bildirimi yanıtla
                       birlikte yeniden yayınlar — bu yeni GELEN mesaj değildir. */
                    ownReplyLast = lb.getCharSequence("sender") == null && lb.get("sender_person") == null;
                }
            }

            boolean freeFormReply = false;
            if (n.actions != null) {
                for (Notification.Action a : n.actions) if (hasFreeForm(a)) { freeFormReply = true; break; }
            }
            final String category = classify(n.category, messagingStyle, freeFormReply, sbn.getPackageName(), text);
            if (category == null) return;
            if (sender.isEmpty() && text.isEmpty()) return;

            final boolean isCall = CAT_CALL.equals(category);
            final boolean isMissed = CAT_MISSED_CALL.equals(category);
            final JSArray actions = new JSArray();
            if (isCall) {
                /* CallStyle (API 31) eylemleri başlıktan BAĞIMSIZ, kesin kanıttır. */
                if (extras.getParcelable("android.answerIntent") != null) actions.put(action(KIND_ANSWER, "Cevapla"));
                if (extras.getParcelable("android.declineIntent") != null) actions.put(action(KIND_DECLINE, "Reddet"));
                if (extras.getParcelable("android.hangUpIntent") != null) actions.put(action(KIND_HANG_UP, "Kapat"));
            }
            if (n.actions != null) {
                for (Notification.Action a : n.actions) {
                    final String kind = isMissed ? missedCallActionKind(str(a.title))
                        : actionKind(str(a.title), hasFreeForm(a), semanticReply(a), isCall);
                    if (KIND_OTHER.equals(kind) || containsKind(actions, kind)) continue;
                    actions.put(action(kind, str(a.title)));
                }
            }

            synchronized (TRACKED) { TRACKED.put(sbn.getKey(), n); }
            /* Eylemler tazelendi; kendi yanıtımız JS'e "yeni mesaj" diye gitmez. */
            if (ownReplyLast) return;

            final JSObject data = new JSObject();
            data.put("key", sbn.getKey());
            data.put("packageName", sbn.getPackageName());
            data.put("appName", appLabel(pm, sbn.getPackageName()));
            data.put("category", category);
            data.put("sender", sender);
            data.put("text", text);
            data.put("time", sbn.getPostTime());
            data.put("ongoing", sbn.isOngoing());
            data.put("actions", actions);
            s.posted(data);
        } catch (Exception ignored) {
            /* Bozuk üçüncü taraf bildirimi servisi DÜŞÜREMEZ; içerik loglanmaz. */
        }
    }

    /** Dinleyici koptu: izlenen eylemler geçersiz; JS görüşme iddiasını bırakır. */
    public static void onListenerLost() {
        synchronized (TRACKED) { TRACKED.clear(); }
        final Sink s = sink;
        if (s != null) s.listenerLost();
    }

    public static void onRemoved(StatusBarNotification sbn) {
        if (sbn == null) return;
        synchronized (TRACKED) { TRACKED.remove(sbn.getKey()); }
        /* HER kaldırma bildirilir: izlenen tablo (LRU) uzun bir görüşmede arama
           anahtarını düşürmüş olabilir — kaldırma kaçarsa "görüşme sürüyor" ve
           müziğin susması TAKILI kalırdı. JS yalnız tanıdığı arama kartını kapatır. */
        final Sink s = sink;
        if (s != null) s.removed(sbn.getKey());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * JS → eylem
     * ════════════════════════════════════════════════════════════════════ */

    /** Serbest yanıt girdisi olan eyleme metni yazıp tetikler. */
    public static JSObject reply(Context ctx, String key, String text) {
        final Notification n = tracked(key);
        if (n == null) return result(false, "notification_gone");
        if (text == null || text.trim().isEmpty()) return result(false, "empty_text");
        if (n.actions != null) {
            for (Notification.Action a : n.actions) {
                if (!hasFreeForm(a) || a.actionIntent == null) continue;
                try {
                    final RemoteInput[] inputs = a.getRemoteInputs();
                    final Intent intent = new Intent();
                    final Bundle results = new Bundle();
                    for (RemoteInput ri : inputs) results.putCharSequence(ri.getResultKey(), text);
                    RemoteInput.addResultsToIntent(inputs, intent, results);
                    sendAsForeground(ctx, a.actionIntent, intent);
                    return result(true, null);
                } catch (Exception e) {
                    return result(false, "send_failed");
                }
            }
        }
        return result(false, "no_reply_action");
    }

    /** Arama eylemi (ANSWER · DECLINE · HANG_UP · CALL_BACK) — önce CallStyle, sonra başlık. */
    public static JSObject invoke(Context ctx, String key, String kind) {
        final Notification n = tracked(key);
        if (n == null) return result(false, "notification_gone");
        final Bundle extras = n.extras != null ? n.extras : new Bundle();
        final String extraKey = KIND_ANSWER.equals(kind) ? "android.answerIntent"
            : KIND_DECLINE.equals(kind) ? "android.declineIntent"
            : KIND_HANG_UP.equals(kind) ? "android.hangUpIntent" : null;
        final boolean callBack = KIND_CALL_BACK.equals(kind);
        if (extraKey == null && !callBack) return result(false, "unknown_kind");
        try {
            final Parcelable callStyle = extraKey != null ? extras.getParcelable(extraKey) : null;
            if (callStyle instanceof PendingIntent) {
                sendAsForeground(ctx, (PendingIntent) callStyle, null);
                return result(true, null);
            }
            if (n.actions != null) {
                for (Notification.Action a : n.actions) {
                    if (a.actionIntent == null) continue;
                    final String k = callBack ? missedCallActionKind(str(a.title))
                        : actionKind(str(a.title), hasFreeForm(a), semanticReply(a), true);
                    if (kind.equals(k)) {
                        sendAsForeground(ctx, a.actionIntent, null);
                        return result(true, null);
                    }
                }
            }
        } catch (Exception e) {
            return result(false, "send_failed");
        }
        return result(false, "no_such_action");
    }

    /* ── yardımcılar ──────────────────────────────────────────────────── */

    /**
     * Kullanıcı CarOS ekranında (görünür uygulama) dokundu → gönderici
     * ayrıcalığıyla gönder. API 34+ bu ayrıcalığı AÇIK onay olmadan vermez;
     * yoksa ekran açan eylemler (ör. "Geri ara") sessizce engellenebilirdi.
     */
    @SuppressWarnings("deprecation")
    private static void sendAsForeground(Context ctx, PendingIntent pi, Intent fillIn)
            throws PendingIntent.CanceledException {
        Bundle options = null;
        if (Build.VERSION.SDK_INT >= 34) {
            final ActivityOptions o = ActivityOptions.makeBasic();
            o.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
            options = o.toBundle();
        }
        pi.send(ctx, 0, fillIn, null, null, null, options);
    }

    private static Notification tracked(String key) {
        if (key == null) return null;
        synchronized (TRACKED) { return TRACKED.get(key); }
    }

    private static boolean hasFreeForm(Notification.Action a) {
        final RemoteInput[] inputs = a.getRemoteInputs();
        if (inputs == null) return false;
        for (RemoteInput ri : inputs) if (ri.getAllowFreeFormInput()) return true;
        return false;
    }

    private static boolean semanticReply(Notification.Action a) {
        return Build.VERSION.SDK_INT >= 28 && a.getSemanticAction() == Notification.Action.SEMANTIC_ACTION_REPLY;
    }

    private static boolean containsKind(JSArray arr, String kind) {
        for (int i = 0; i < arr.length(); i++) {
            final Object o = arr.opt(i);
            if (o instanceof JSObject && kind.equals(((JSObject) o).getString("kind"))) return true;
        }
        return false;
    }

    private static JSObject action(String kind, String title) {
        final JSObject o = new JSObject();
        o.put("kind", kind);
        o.put("title", title);
        return o;
    }

    private static JSObject result(boolean ok, String reason) {
        final JSObject o = new JSObject();
        o.put("ok", ok);
        if (reason != null) o.put("reason", reason);
        return o;
    }

    private static String appLabel(PackageManager pm, String pkg) {
        try { return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0))); }
        catch (Exception e) { return pkg; }
    }

    private static String str(CharSequence cs) { return cs == null ? "" : cs.toString().trim(); }
}
