package com.cockpitos.pro.phonelink;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * PhoneLinkPortalGuardTest — PHONE LINK F3 · native portal kilitleri.
 *
 * Bu kilitler {@code PhoneLinkPortalServer}'ın GÜVENLİK ve YAŞAM DÖNGÜSÜ
 * sözleşmesini native katmanın KENDİ suite'inde tutar. Amaç bir davranışı
 * simüle etmek değil (soket açmak JVM unit testinde anlamlı bir kanıt
 * üretmez); F3'ün pazarlıksız YAPISAL kurallarının koda geri sızmasını
 * engellemektir.
 */
public class PhoneLinkPortalGuardTest {

    private static final String PORTAL_DIR =
        "src/main/java/com/cockpitos/pro/phonelink/";

    private static String read(String fileName) throws IOException {
        File f = new File(PORTAL_DIR + fileName);
        assertTrue("portal kaynağı bulunamadı: " + f.getPath(), f.isFile());
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    /** F3.4 — bind DAİMA seçilen arayüzedir; wildcard/public ifşa YOK. */
    @Test
    public void serverNeverBindsWildcardInterface() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertTrue("ServerSocket seçilen adrese bağlanmalı",
            src.contains("new ServerSocket(0, 16, bindAddr)"));
        assertFalse("wildcard adres KULLANILMAMALI", src.contains("\"0.0.0.0\""));
        assertFalse("sabit/taranabilir port İLAN EDİLMEMELİ",
            src.matches("(?s).*new ServerSocket\\(\\s*8\\d{3}.*"));
        assertTrue("loopback ve any-local adresler DIŞLANMALI",
            src.contains("addr.isLoopbackAddress() || addr.isAnyLocalAddress()"));
    }

    /** F3.11 — güvenlik başlıkları her yanıtta; CORS wildcard ASLA. */
    @Test
    public void securityHeadersPresentAndNoCors() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertTrue(src.contains("X-Content-Type-Options: nosniff"));
        assertTrue(src.contains("Referrer-Policy: no-referrer"));
        assertTrue(src.contains("X-Frame-Options: DENY"));
        assertTrue(src.contains("Cache-Control: no-store"));
        assertTrue(src.contains("Content-Security-Policy: default-src 'none'"));
        assertFalse("CORS başlığı ÜRETİLMEMELİ", src.contains("Access-Control-Allow"));
    }

    /** F3.11 — keyfi dosya erişimi YOK: sunucu hiçbir dosya/asset okumaz. */
    @Test
    public void serverServesNoFilesAtAll() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertFalse(src.contains("FileInputStream"));
        assertFalse(src.contains("getAssets()"));
        assertFalse(src.contains("new File("));
    }

    /** F3.11 — token/parmak izi/gövde LOGLANMAZ. */
    @Test
    public void portalNeverLogs() throws IOException {
        for (String file : new String[] { "PhoneLinkPortalServer.java", "PhoneLinkPortalPlugin.java" }) {
            String src = read(file);
            assertFalse(file + " log çağırmamalı", src.contains("Log.d("));
            assertFalse(file + " log çağırmamalı", src.contains("Log.i("));
            assertFalse(file + " log çağırmamalı", src.contains("Log.w("));
            assertFalse(file + " log çağırmamalı", src.contains("Log.e("));
            assertFalse(file + " log çağırmamalı", src.contains("Log.v("));
            assertFalse(file + " System.out kullanmamalı", src.contains("System.out"));
        }
    }

    /** F3.6 — native hiçbir yetki/oturum/müzik kararı VERMEZ (opak taşıma). */
    @Test
    public void nativeMakesNoAuthorizationOrMusicDecision() throws IOException {
        for (String file : new String[] { "PhoneLinkPortalServer.java", "PhoneLinkPortalPlugin.java" }) {
            String src = read(file);
            assertFalse(file + " token doğrulamamalı", src.contains("validateToken"));
            assertFalse(file + " oturum tutmamalı", src.contains("sessionEpoch"));
            assertFalse(file + " medya kontrol etmemeli", src.contains("MediaSession"));
            assertFalse(file + " medya kontrol etmemeli", src.contains("AudioManager"));
            assertFalse(file + " OBD/araç yüzeyine dokunmamalı", src.contains("OBDManager"));
            assertFalse(file + " Bluetooth yüzeyine dokunmamalı", src.contains("Bluetooth"));
        }
    }

    /** F3.8 — timer/alarm/wake lock/foreground service YOK. */
    @Test
    public void noTimersAlarmsOrWakeLocks() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertFalse(src.contains("ScheduledExecutorService"));
        assertFalse(src.contains("new Timer("));
        assertFalse(src.contains("postDelayed"));
        assertFalse(src.contains("WakeLock"));
        assertFalse(src.contains("startForeground"));
        assertFalse(src.contains("AlarmManager"));
    }

    /** F3.8/F3.9 — stop() dinleyici, akış ve kuyrukları BIRAKMADAN kapatır. */
    @Test
    public void stopReleasesEverything() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertTrue(src.contains("public synchronized void stop()"));
        assertTrue("stop() akışları kapatmalı", src.contains("closeAllStreams()"));
        assertTrue("stop() bekleyen kuyrukları temizlemeli", src.contains("pending.clear()"));
        assertTrue("yazma hatasında istemci kaydı düşmeli", src.contains("streamClients.remove"));
        assertTrue("tüm threadler daemon olmalı", src.contains("setDaemon(true)"));
        assertTrue("plugin yıkımda sunucuyu durdurmalı",
            read("PhoneLinkPortalPlugin.java").contains("server.stop()"));
    }

    /** F3.11 — sınırsız okuma YOK: satır, başlık ve gövde tavanı vardır. */
    @Test
    public void readsAreBounded() throws IOException {
        String src = read("PhoneLinkPortalServer.java");
        assertTrue(src.contains("MAX_BODY_BYTES"));
        assertTrue(src.contains("MAX_HEADER_LINES"));
        assertTrue(src.contains("MAX_LINE_CHARS"));
        assertTrue(src.contains("MAX_STREAM_CLIENTS"));
        assertTrue(src.contains("MAX_INFLIGHT_REQUESTS"));
        assertTrue("soket okuma zaman aşımı olmalı", src.contains("setSoTimeout"));
    }
}
