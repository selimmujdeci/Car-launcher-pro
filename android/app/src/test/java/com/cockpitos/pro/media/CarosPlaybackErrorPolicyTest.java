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
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_DECODING_FAILED));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND));
        assertTrue(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NO_PERMISSION));
    }

    @Test
    public void networkAndOutputErrorsAreNotSkipped() {
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED));
        assertFalse(CarosPlaybackService.isItemSpecificError(PlaybackException.ERROR_CODE_UNSPECIFIED));
    }

    @Test
    public void consecutiveSkipsAreBounded() {
        assertTrue("sonsuz atlama döngüsü olmamalı", CarosPlaybackService.MAX_CONSECUTIVE_ERROR_SKIPS > 0
            && CarosPlaybackService.MAX_CONSECUTIVE_ERROR_SKIPS <= 10);
    }
}
