package com.cockpitos.pro.obd;

import java.io.IOException;

/**
 * ELM komutu deadline'a ulaştı fakat {@code '>'} prompt'u görülmedi.
 *
 * Taşıma kopması değildir: soket hâlâ açık olabilir. Ham/kısmi yanıt ile resync
 * sonucu korunur; böylece NO DATA, boş prompt timeout ve kısmi timeout birbirine
 * çevrilmez. IOException olması eski checked sözleşmeyi korur.
 */
public final class ElmPromptTimeoutException extends IOException {
    public final String partialResponse;
    public final boolean partial;
    public final boolean resynced;

    public ElmPromptTimeoutException(String partialResponse, boolean resynced) {
        super((partialResponse == null || partialResponse.trim().isEmpty())
            ? "ELM prompt timeout" : "ELM partial response timeout");
        this.partialResponse = partialResponse == null ? "" : partialResponse.trim();
        this.partial = !this.partialResponse.isEmpty();
        this.resynced = resynced;
    }
}
