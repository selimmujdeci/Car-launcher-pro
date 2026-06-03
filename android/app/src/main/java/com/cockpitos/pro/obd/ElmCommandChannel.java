package com.cockpitos.pro.obd;

/**
 * ElmCommandChannel — ELM327 AT-komut taşıma sözleşmesi (transport-agnostik).
 *
 * Bu arayüz, bir ELM327 adaptörüne tek bir AT/OBD komutu gönderip yanıtını
 * ('>' prompt'una kadar) okumaktan sorumludur. Hangi alt taşıma katmanının
 * (Classic RFCOMM stream, BLE GATT, USB serial) kullanıldığını GİZLER.
 *
 * KÖPRÜ AYRIMI:
 *   - {@link ElmProtocol} bu arayüz üzerinden çalışır; init dizisi ve PID parse
 *     mantığı taşıma katmanından bağımsızdır.
 *   - Classic RFCOMM implementasyonu {@code OBDManager.RfcommChannel}'dır
 *     (mevcut InputStream/OutputStream + '>' prompt mantığını birebir korur).
 *
 * DAVRANIŞ SÖZLEŞMESİ ({@code send}):
 *   - Komut "\r" ile sonlandırılarak yazılır.
 *   - Yanıt '>' prompt karakteri görülene kadar veya {@code timeoutMs} dolana
 *     kadar okunur; '\r' karakterleri atlanır, '>' tüketilir (yanıta dahil değil).
 *   - Dönüş: trim edilmiş ham yanıt String'i (boş olabilir).
 */
public interface ElmCommandChannel {

    /**
     * Tek bir komut gönderir ve ELM327 yanıtını ('>' prompt'una kadar) döner.
     *
     * @param cmd       ELM327 AT veya OBD komutu (örn. "ATZ", "010D") — "\r" eklenmez, channel ekler.
     * @param timeoutMs '>' prompt'u veya zaman aşımı için maksimum bekleme (ms).
     * @return          trim edilmiş ham yanıt (prompt ve '\r' hariç).
     * @throws Exception taşıma katmanı hatası (bağlantı kopması, stream kapanması vb.).
     */
    String send(String cmd, int timeoutMs) throws Exception;

    /** Taşıma kaynaklarını serbest bırakır (idempotent olmalı). */
    void close();
}
