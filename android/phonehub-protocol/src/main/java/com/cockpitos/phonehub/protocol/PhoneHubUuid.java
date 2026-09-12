package com.cockpitos.phonehub.protocol;

import java.util.UUID;

/**
 * PhoneHubUuid — Phone Hub RFCOMM servis kimliğinin TEK OTORİTESİ.
 *
 * ── NEDEN TEK YER ───────────────────────────────────────────────────────────
 * UUID iki ayrı APK'da (head unit ve telefon companion) kullanılır. İki yerde
 * ayrı sabit tutulursa biri değiştiğinde diğeri sessizce eskir ve arıza
 * "bağlanmıyor ama sebebi yok" gibi görünür. Bu yüzden sabit YALNIZ burada
 * tanımlıdır; iki uygulama da bu paylaşılan modülden okur (testle kilitli).
 *
 * ── NEDEN SPP (00001101-…) DEĞİL ────────────────────────────────────────────
 * Standart SPP UUID'sini bu projede OBD/ELM327 adaptörü kullanıyor
 * ({@code OBDBluetoothManager.SPP_UUID}). Aynı UUID'yi Phone Hub için de
 * kullanmak, telefonun yanlışlıkla OBD servisine ya da bir OBD adaptörünün
 * Phone Hub sunucusuna bağlanmasına kapı aralardı. Ad alanı ayrımı, OBD
 * izolasyonunun (GÖREV 17) ilk ve en ucuz katmanıdır.
 *
 * UUID sürüm 4 (rastgele) biçimindedir ve CarOS Phone Hub protokol 1'e aittir.
 * PROTOKOL KIRICI bir değişiklik olursa yeni bir UUID tanımlanır — eski
 * istemcilerin yeni sunucuya hiç bağlanamaması, yarı-uyumlu bağlanıp
 * anlaşılmaz biçimde kopmasından İYİDİR.
 */
public final class PhoneHubUuid {

    /** Phone Hub control-plane servis UUID'si (protokol 1). */
    public static final String SERVICE_UUID_STRING = "6f5c1a20-7d3e-4a91-b8c4-2e9f0d5a7b31";

    /** SDP kaydında görünen servis adı — PII TAŞIMAZ. */
    public static final String SERVICE_NAME = "CarOS Phone Hub";

    private static final UUID SERVICE_UUID = UUID.fromString(SERVICE_UUID_STRING);

    /** OBD/ELM327'nin kullandığı standart SPP — Phone Hub bunu KULLANMAZ. */
    public static final String RESERVED_SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB";

    private PhoneHubUuid() { }

    public static UUID serviceUuid() {
        return SERVICE_UUID;
    }

    /** Phone Hub UUID'si OBD'nin SPP'sinden farklı mı — testle kilitlenen invaryant. */
    public static boolean isDistinctFromObdSpp() {
        return !SERVICE_UUID_STRING.equalsIgnoreCase(RESERVED_SPP_UUID);
    }
}
