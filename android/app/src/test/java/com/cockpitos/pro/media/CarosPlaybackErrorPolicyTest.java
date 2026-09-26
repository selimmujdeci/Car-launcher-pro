package com.cockpitos.pro.media;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.PlaybackException;

import org.junit.Test;

/**
 * Çalma hatası kurtarma POLİTİKASI — hangi hata parçayı atlatır.
 *
 * Kilitlenen iddia: yalnız ÇALAN PARÇAYA özgü hatalar (dosya · biçim · çözücü)
 * sıradakine geçirir. Ağ ve ses çıkışı hataları ATLANMAZ: atlamak onları çözmez,
 * radyo/akış listesini ya da tüm kuyruğu boşuna tüketir.
 */
public class CarosPlaybackErrorPolicyTest {

    @Test
    public void corruptOrUnsupportedFilesAreSkippable() {
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED, false));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, false));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_DECODING_FAILED, false));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, false));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND, false));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NO_PERMISSION, false));
    }

    @Test
    public void unspecifiedReadErrorSkipsOnlyForLocalFiles() {
        /* Saha 2026-09-23: bozuk yerel MP3 → IO_UNSPECIFIED; kuyruk o parçada durmuştu. */
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, true));
        /* Ağ akışında aynı kod geçici olabilir — atlamak listeyi boşuna tüketir. */
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, false));
    }

    @Test
    public void networkAndOutputErrorsAreNotSkipped() {
        /* Yerel parçada bile: ağ/ses çıkışı/bilinmeyen hata parçanın suçu değildir. */
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, true));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, true));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED, true));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED, true));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_UNSPECIFIED, true));
    }

    @Test
    public void consecutiveSkipsAreBounded() {
        assertTrue("sonsuz atlama döngüsü olmamalı", CarosPlaybackService.MAX_CONSECUTIVE_ERROR_SKIPS > 0
            && CarosPlaybackService.MAX_CONSECUTIVE_ERROR_SKIPS <= 10);
    }
}
