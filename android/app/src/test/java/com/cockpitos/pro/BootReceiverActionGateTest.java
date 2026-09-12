package com.cockpitos.pro;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Intent;

import org.junit.Test;

/**
 * BootReceiverActionGateTest — dışa açık boot yüzeyinin KİLİDİ.
 *
 * KÖK (APK denetimi 2026-07-28): `BootReceiver` `exported="true"` ve permission'sız.
 * `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` AOSP'de protected broadcast olduğu için
 * sahte yollanamaz; ancak `QUICKBOOT_POWERON` korumalı listede DEĞİLDİR → üçüncü taraf
 * bir uygulama onu yollayıp GPS foreground servisini ve kalıcı bildirimi başlatabiliyordu.
 *
 * KİLİTLENEN SÖZLEŞME: korumasız action YALNIZ gerçek açılış penceresinde kabul edilir;
 * korumalı action'lar her zaman geçer; bilinmeyen action HİÇBİR ŞEY başlatmaz.
 *
 * Not: `isAcceptedBootAction` saf bir karardır (Android çağrısı yok) — bu yüzden
 * cihaz/Robolectric olmadan JVM'de koşar.
 */
public class BootReceiverActionGateTest {

    private static final long IN_WINDOW  = 30_000L;                                     // açılıştan 30 sn sonra
    private static final long AT_LIMIT   = BootReceiver.QUICKBOOT_MAX_UPTIME_MS;        // tam sınır
    private static final long OUT_WINDOW = BootReceiver.QUICKBOOT_MAX_UPTIME_MS + 1L;   // sınırın 1 ms ötesi
    private static final long LONG_UPTIME = 6L * 60L * 60L * 1000L;                     // 6 saat çalışan cihaz

    /* ── Korumalı (protected) boot action'ları: her zaman geçer ─────────────── */

    @Test
    public void bootCompletedIsAcceptedRegardlessOfUptime() {
        assertTrue(BootReceiver.isAcceptedBootAction(Intent.ACTION_BOOT_COMPLETED, 0L));
        assertTrue(BootReceiver.isAcceptedBootAction(Intent.ACTION_BOOT_COMPLETED, LONG_UPTIME));
    }

    @Test
    public void lockedBootCompletedIsAcceptedRegardlessOfUptime() {
        assertTrue(BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_LOCKED_BOOT, 0L));
        assertTrue(BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_LOCKED_BOOT, LONG_UPTIME));
    }

    /* ── Korumasız OEM action'ı: yalnız açılış penceresinde ─────────────────── */

    @Test
    public void quickbootAcceptedInsideBootWindow() {
        assertTrue(BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, 0L));
        assertTrue(BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, IN_WINDOW));
        assertTrue("sınır DAHİL olmalı (yavaş head unit)",
                BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, AT_LIMIT));
    }

    @Test
    public void quickbootRejectedOutsideBootWindow() {
        assertFalse("pencere dışı sahte broadcast REDDEDİLMELİ",
                BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, OUT_WINDOW));
        assertFalse("saatlerdir açık cihazda gelen QUICKBOOT meşru olamaz",
                BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, LONG_UPTIME));
    }

    @Test
    public void quickbootRejectedOnNegativeUptime() {
        // Bozuk/negatif saat okuması → kanıt yok → fail-closed.
        assertFalse(BootReceiver.isAcceptedBootAction(BootReceiver.ACTION_QUICKBOOT, -1L));
    }

    /* ── Bilinmeyen / kötü niyetli action'lar ───────────────────────────────── */

    @Test
    public void unknownActionStartsNothing() {
        assertFalse(BootReceiver.isAcceptedBootAction(null, 0L));
        assertFalse(BootReceiver.isAcceptedBootAction("", 0L));
        assertFalse(BootReceiver.isAcceptedBootAction("com.evil.START_EVERYTHING", 0L));
        assertFalse(BootReceiver.isAcceptedBootAction(Intent.ACTION_SCREEN_ON, 0L));
        // Benzer ama AYNI OLMAYAN action'lar (prefix/suffix oyunları) geçmemeli.
        assertFalse(BootReceiver.isAcceptedBootAction("android.intent.action.BOOT_COMPLETED2", 0L));
        assertFalse(BootReceiver.isAcceptedBootAction("com.htc.intent.action.QUICKBOOT_POWERON", 0L));
    }
}
