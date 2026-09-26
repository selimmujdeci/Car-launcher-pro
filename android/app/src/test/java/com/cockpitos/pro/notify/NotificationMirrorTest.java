package com.cockpitos.pro.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Telefon Merkezi bildirim aktarımı — KATEGORİ ve EYLEM kararları.
 *
 * Kilitler: yalnız arama / cevapsız arama / mesaj aktarılır (medya, sistem vb.
 * GEÇMEZ) · head-unit Bluetooth uygulamasının "cevapsız" bildirimi tanınır ·
 * arama eylemleri Türkçe/İngilizce başlıktan doğru türe eşlenir · serbest
 * yanıt girdisi olan eylem her zaman REPLY'dır.
 */
public class NotificationMirrorTest {

    @Test
    public void platformCategoriesWin() {
        assertEquals("call", NotificationMirror.classify("call", false, false, "com.google.android.dialer", "Gelen arama"));
        assertEquals("missed_call", NotificationMirror.classify("missed_call", false, false, "x", ""));
        assertEquals("message", NotificationMirror.classify("msg", false, false, "com.whatsapp", "Selam"));
        assertEquals("message", NotificationMirror.classify(null, true, false, "org.telegram.messenger", "Selam"));
    }

    @Test
    public void headUnitBluetoothMissedCallIsRecognised() {
        assertEquals("missed_call", NotificationMirror.classify(null, false, false, "com.syu.bt", "1 cevapsız arama"));
        assertEquals("missed_call", NotificationMirror.classify(null, false, false, "com.android.bluetooth", "Missed call"));
    }

    @Test
    public void replyableConversationIsAMessage() {
        assertEquals("message", NotificationMirror.classify(null, false, true, "com.some.chat", "naber"));
    }

    @Test
    public void everythingElseIsNotMirrored() {
        assertNull(NotificationMirror.classify("transport", false, false, "com.spotify.music", "Şarkı"));
        assertNull(NotificationMirror.classify("sys", false, false, "android", "USB bağlandı"));
        assertNull(NotificationMirror.classify("email", false, false, "com.google.android.gm", "Fatura"));
        assertNull(NotificationMirror.classify(null, false, false, "com.shop", "İndirim"));
    }

    @Test
    public void callActionsMapFromTitles() {
        assertEquals("ANSWER", NotificationMirror.actionKind("Cevapla", false, false, true));
        assertEquals("ANSWER", NotificationMirror.actionKind("Answer", false, false, true));
        assertEquals("DECLINE", NotificationMirror.actionKind("Reddet", false, false, true));
        /* Saha (MIUI InCallUI): çalan aramada ["Yoksay", "Cevapla"]. */
        assertEquals("DECLINE", NotificationMirror.actionKind("Yoksay", false, false, true));
        assertEquals("DECLINE", NotificationMirror.actionKind("Dismiss", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Yoksay", false, false, false));
        assertEquals("HANG_UP", NotificationMirror.actionKind("Aramayı sonlandır", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Hoparlör", false, false, true));
    }

    @Test
    public void replyInputAlwaysMeansReply_andNonCallTitlesAreIgnored() {
        assertEquals("REPLY", NotificationMirror.actionKind("Yanıtla", true, false, false));
        assertEquals("REPLY", NotificationMirror.actionKind("Reply", true, true, false));
        /* Metin yazılamayan "yanıt" (uygulamayı açar) hazır yanıt ALAMAZ; arama
           bildiriminde de "Yanıtla"yı cevaplamaya eşlemez. */
        assertEquals("OTHER", NotificationMirror.actionKind("Reply", false, true, false));
        assertEquals("OTHER", NotificationMirror.actionKind("Yanıtla", false, true, true));
        /* Mesaj bildirimindeki "Okundu işaretle" arama eylemi SAYILMAZ. */
        assertEquals("OTHER", NotificationMirror.actionKind("Reddet", false, false, false));
    }

    @Test
    public void speakerMuteAndDeclineWithMessageAreNeverCallControls() {
        /* "Hoparlörü kapat" görüşmeyi KAPATMAZ; "Mesajla reddet" düz ret değildir. */
        assertEquals("OTHER", NotificationMirror.actionKind("Hoparlörü kapat", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Mikrofonu kapat", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Sessize al", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Mesajla reddet", false, false, true));
        assertEquals("OTHER", NotificationMirror.actionKind("Decline with message", false, false, true));
        assertEquals("HANG_UP", NotificationMirror.actionKind("Kapat", false, false, true));
    }

    @Test
    public void missedCallOnlyOffersCallBack() {
        assertEquals("CALL_BACK", NotificationMirror.missedCallActionKind("Geri ara"));
        assertEquals("CALL_BACK", NotificationMirror.missedCallActionKind("Call back"));
        assertEquals("OTHER", NotificationMirror.missedCallActionKind("Mesaj"));
        assertEquals("OTHER", NotificationMirror.missedCallActionKind(null));
    }
}
