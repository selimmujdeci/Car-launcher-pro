package com.cockpitos.pro.media;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.media.AudioManager;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * MÜZİK HUB PAKET A — Audio Focus + Ducking otoritesinin DAVRANIŞ KİLİTLERİ (JVM).
 *
 * Görev §18'in native çerçeveye bağlı senaryolarını kilitler:
 *   6  focus gain · 7 kalıcı kayıp · 8 geçici kayıp · 9 duck/nested duck
 *   10 kullanıcı duraklatması sonrası GAIN autoplay YAPMAZ
 *   13 telefon kesmesi · 14 navigasyon duck · 15 Mavi duck · 16 güvenlik önceliği
 *
 * NOT: `handleFocusChange` bilerek public'tir — sistem olayı test tarafından
 * taklit edilir; gerçek AudioManager geri çağrısı Robolectric'te tetiklenemez.
 */
@RunWith(RobolectricTestRunner.class)
/*
 * SDK SABİTLENMİŞTİR: proje targetSdk 36 ile derlenir, Robolectric 4.13 ise en
 * fazla SDK 34 çalıştırabilir (aksi halde DefaultSdkPicker patlar). Test edilen
 * mantık SDK'ya duyarlı DEĞİLDİR: focus isteği API 26+ dalını kullanır ve 34 bu
 * dala girer; duck politikası tamamen saf Java'dır. Robolectric yükseltilirse
 * bu değer güncellenmelidir.
 */
@Config(sdk = 34)
public class CarosAudioFocusManagerTest {

    /** Otoritenin ürettiği kararları kaydeden sahte host. */
    private static final class RecordingHost implements CarosAudioFocusManager.FocusHost {
        final List<String> pauses  = new ArrayList<>();
        final List<String> states  = new ArrayList<>();
        int    resumeCount         = 0;
        float  lastDuckVolume      = 1.0f;
        String lastDominantReason  = null;
        int    duckChangeCount     = 0;

        @Override public void onFocusPause(String reasonCode, boolean transientLoss) {
            pauses.add(reasonCode + ":" + transientLoss);
        }
        @Override public void onFocusResume() { resumeCount++; }
        @Override public void onDuckVolumeChanged(float volume, String dominantReason) {
            lastDuckVolume     = volume;
            lastDominantReason = dominantReason;
            duckChangeCount++;
        }
        @Override public void onFocusStateChanged(String focusState) { states.add(focusState); }
    }

    private RecordingHost host;
    private CarosAudioFocusManager focus;

    @Before
    public void setUp() {
        host  = new RecordingHost();
        focus = new CarosAudioFocusManager(ApplicationProvider.getApplicationContext(), host);
    }

    /* ── KİLİT 7 — kalıcı focus kaybı ────────────────────────────────────── */

    @Test
    public void permanentFocusLoss_pausesWithNonTransientReason() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS);

        assertTrue(host.pauses.contains("focus_loss:false"));
        assertEquals(CarosAudioFocusManager.FOCUS_LOST, focus.getFocusState());
        assertFalse("kalıcı kayıpta odak BIRAKILIR", focus.hasAudioFocus());
        assertTrue("focus kaynaklı duraklatma işaretlenir", focus.isPausedByFocus());
    }

    /* ── KİLİT 8 — geçici focus kaybı ────────────────────────────────────── */

    @Test
    public void transientFocusLoss_pausesAsTransient() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);

        assertTrue(host.pauses.contains("focus_loss_transient:true"));
        assertEquals(CarosAudioFocusManager.FOCUS_LOST_TRANSIENT, focus.getFocusState());
        assertTrue(focus.isPausedByFocus());
    }

    /* ── KİLİT 6 — focus geri gelince devam ──────────────────────────────── */

    @Test
    public void focusGainAfterTransientLoss_resumesPlayback() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        assertEquals(0, host.resumeCount);

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);

        assertEquals(1, host.resumeCount);
        assertTrue(focus.hasAudioFocus());
        assertFalse(focus.isPausedByFocus());
        assertEquals(CarosAudioFocusManager.FOCUS_GRANTED, focus.getFocusState());
    }

    /* ── KİLİT 10 — kullanıcı duraklattıysa GAIN otomatik BAŞLATMAZ ──────── */

    @Test
    public void focusGain_doesNotOverrideUserPause() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        // Kullanıcı bu sırada bilerek duraklattı.
        focus.markUserPaused();

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);

        assertEquals("kullanıcı kararı EZİLMEZ", 0, host.resumeCount);
        assertTrue(focus.isUserPaused());
    }

    @Test
    public void userPlaying_clearsBothPauseFlags() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        focus.markUserPaused();
        focus.markUserPlaying();

        assertFalse(focus.isUserPaused());
        assertFalse(focus.isPausedByFocus());
    }

    /* ── PAKET B · GECİKMELİ ODAK ONARIMI ────────────────────────────────── */

    /**
     * KUSUR (Paket A'da ölçüldü): odak GECİKTİĞİNDE `pausedByFocus` false kalıyor,
     * GAIN geldiğinde devam koşulu sağlanmıyordu → kullanıcı çal'a basmış olsa
     * bile müzik HİÇ BAŞLAMIYORDU. Bu kilit onarımı dondurur.
     */
    @Test
    public void delayedFocusIntent_resumesOnGain() {
        focus.markPlayIntentPending();
        assertTrue(focus.hasPendingPlayIntent());
        assertEquals(0, host.resumeCount);

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);

        assertEquals("gecikmeli odak GAIN'de oynatma BAŞLAMALI", 1, host.resumeCount);
        assertFalse("niyet TEK KEZ tüketilir", focus.hasPendingPlayIntent());
    }

    @Test
    public void delayedFocusIntent_isConsumedOnlyOnce() {
        focus.markPlayIntentPending();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals("ikinci GAIN yeniden BAŞLATMAZ", 1, host.resumeCount);
    }

    @Test
    public void userPause_cancelsPendingPlayIntent() {
        focus.markPlayIntentPending();
        // Kullanıcı bu arada vazgeçip duraklattı.
        focus.markUserPaused();
        assertFalse(focus.hasPendingPlayIntent());

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals("kullanıcı kararı gecikmeli niyeti EZER", 0, host.resumeCount);
    }

    @Test
    public void abandonFocus_clearsPendingPlayIntent() {
        focus.markPlayIntentPending();
        focus.abandonFocus();
        assertFalse("odak bırakıldıysa geç GAIN ses BAŞLATAMAZ", focus.hasPendingPlayIntent());

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals(0, host.resumeCount);
    }

    /* ── KİLİT 9/14/15 — nested duck ─────────────────────────────────────── */

    @Test
    public void nestedDuck_doesNotRestoreFullVolumeWhileAnotherReasonActive() {
        long nav  = focus.duck(CarosAudioFocusManager.REASON_NAVIGATION);
        long mavi = focus.duck(CarosAudioFocusManager.REASON_MAVI);
        assertTrue(nav > 0 && mavi > 0);
        assertEquals(0.30f, focus.getDuckVolume(), 0.0001f);

        // Mavi bitti → ses TAM AÇILMAZ, navigasyon seviyesinde kalır.
        assertTrue(focus.unduck(mavi));
        assertEquals(0.30f, focus.getDuckVolume(), 0.0001f);
        assertEquals(CarosAudioFocusManager.REASON_NAVIGATION, focus.getDominantDuckReason());

        assertTrue(focus.unduck(nav));
        assertEquals(1.0f, focus.getDuckVolume(), 0.0001f);
        assertNull(focus.getDominantDuckReason());
    }

    @Test
    public void staleToken_cannotRaiseVolume() {
        long nav = focus.duck(CarosAudioFocusManager.REASON_NAVIGATION);
        assertFalse("bilinmeyen token ETKİSİZ", focus.unduck(999_999L));
        assertEquals(0.30f, focus.getDuckVolume(), 0.0001f);

        assertTrue(focus.unduck(nav));
        assertFalse("aynı token ikinci kez ETKİSİZ", focus.unduck(nav));
        assertEquals(1.0f, focus.getDuckVolume(), 0.0001f);
    }

    @Test
    public void unknownReason_isRejected_andEntriesAreBounded() {
        assertEquals(0L, focus.duck("KEYFI_SEBEP"));
        assertEquals(0L, focus.duck(null));
        assertFalse(CarosAudioFocusManager.isKnownDuckReason("KEYFI_SEBEP"));

        for (int i = 0; i < 40; i++) focus.duck(CarosAudioFocusManager.REASON_MAVI);
        assertEquals("duck kayıtları SINIRLI (DoS koruması)",
            16, focus.getActiveDuckReasons().length);
    }

    /* ── KİLİT 13/16 — telefon ve güvenlik önceliği ──────────────────────── */

    @Test
    public void phoneCall_silencesMediaCompletely() {
        focus.duck(CarosAudioFocusManager.REASON_PHONE);
        assertEquals("telefon görüşmesinde müzik SUSAR (kısılmaz)",
            0.0f, focus.getDuckVolume(), 0.0001f);
    }

    @Test
    public void safetyAndEmergency_overrideNavigation() {
        focus.duck(CarosAudioFocusManager.REASON_NAVIGATION);
        focus.duck(CarosAudioFocusManager.REASON_SAFETY);
        assertEquals(0.15f, focus.getDuckVolume(), 0.0001f);
        assertEquals(CarosAudioFocusManager.REASON_SAFETY, focus.getDominantDuckReason());

        focus.duck(CarosAudioFocusManager.REASON_EMERGENCY);
        assertEquals(0.0f, focus.getDuckVolume(), 0.0001f);
        assertEquals(CarosAudioFocusManager.REASON_EMERGENCY, focus.getDominantDuckReason());
    }

    /**
     * JS `duckPolicy.DUCK_LEVELS` ile BİREBİR aynı olmalıdır: iki otorite farklı
     * seviye uygularsa kullanıcı ses zıplaması duyar.
     */
    @Test
    public void duckLevels_matchJavaScriptPolicy() {
        assertEquals(0.00f, CarosAudioFocusManager.duckVolumeFor("EMERGENCY"), 0.0001f);
        assertEquals(0.15f, CarosAudioFocusManager.duckVolumeFor("SAFETY"), 0.0001f);
        assertEquals(0.20f, CarosAudioFocusManager.duckVolumeFor("REVERSE_ATTENTION"), 0.0001f);
        assertEquals(0.25f, CarosAudioFocusManager.duckVolumeFor("PARKING_SENSOR"), 0.0001f);
        assertEquals(0.00f, CarosAudioFocusManager.duckVolumeFor("PHONE"), 0.0001f);
        assertEquals(0.30f, CarosAudioFocusManager.duckVolumeFor("NAVIGATION"), 0.0001f);
        assertEquals(0.30f, CarosAudioFocusManager.duckVolumeFor("MAVI"), 0.0001f);
        assertEquals(0.20f, CarosAudioFocusManager.duckVolumeFor("SYSTEM_DUCK"), 0.0001f);

        for (String r : Arrays.asList("EMERGENCY", "SAFETY", "REVERSE_ATTENTION",
            "PARKING_SENSOR", "PHONE", "NAVIGATION", "MAVI", "SYSTEM_DUCK")) {
            assertTrue(r + " bilinen sebep olmalı", CarosAudioFocusManager.isKnownDuckReason(r));
        }
    }

    /* ── Sistem duck'ı (harici uygulama) ─────────────────────────────────── */

    @Test
    public void systemDuckRequest_ducksAndIsReleasedOnGain() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);

        assertEquals(0.20f, focus.getDuckVolume(), 0.0001f);
        assertEquals(CarosAudioFocusManager.FOCUS_DUCKED, focus.getFocusState());
        // Sistem duck'ı DURAKLATMA değildir — müzik çalmaya devam eder.
        assertTrue(host.pauses.isEmpty());

        focus.handleFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals(1.0f, focus.getDuckVolume(), 0.0001f);
    }

    @Test
    public void systemDuckIsIdempotent_noDuplicateEntries() {
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);
        assertEquals(1, focus.getActiveDuckReasons().length);
    }

    /* ── KİLİT 28 — teardown zero-leak ───────────────────────────────────── */

    @Test
    public void release_clearsAllDucksAndFocus() {
        focus.requestFocus();
        focus.duck(CarosAudioFocusManager.REASON_NAVIGATION);
        focus.duck(CarosAudioFocusManager.REASON_MAVI);

        focus.release();

        assertEquals(0, focus.getActiveDuckReasons().length);
        assertEquals(1.0f, focus.getDuckVolume(), 0.0001f);
        assertFalse(focus.hasAudioFocus());
        assertEquals(CarosAudioFocusManager.FOCUS_NONE, focus.getFocusState());
    }

    @Test
    public void focusStateChanges_areObservableWithoutDuplicates() {
        focus.requestFocus();
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        focus.handleFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);   // aynı durum

        long transientCount = host.states.stream()
            .filter(CarosAudioFocusManager.FOCUS_LOST_TRANSIENT::equals).count();
        assertEquals("aynı duruma tekrar geçiş bildirilmez", 1, transientCount);
    }
}
