package com.cockpitos.phonehub.protocol;

/**
 * LinkIdentitySigner — cihaz kimlik anahtarının İMZALAMA yüzü (GÖREV 7).
 *
 * ── NEDEN ARAYÜZ ────────────────────────────────────────────────────────────
 * Özel kimlik anahtarı Android Keystore içindedir ve baytları HİÇBİR ZAMAN
 * dışarı çıkmaz — dolayısıyla saf Java protokol modülü onu göremez, yalnız
 * "şu baytları imzala" diyebilir. Bu arayüz o sınırı somutlaştırır:
 * uygulama tarafı Keystore'a bağlanır, protokol tarafı yalnız sözleşmeyi bilir.
 *
 * Testlerde JCA tabanlı bellek-içi bir uygulama kullanılır; üretimde Keystore
 * destekli uygulama devreye girer. İki durumda da protokol kodu AYNIDIR.
 */
public interface LinkIdentitySigner {

    /**
     * Bu cihazın kimlik AÇIK anahtarı (SPKI / X.509 kodlu).
     * Karşı taraf bununla imzayı doğrular ve parmak izini hesaplar.
     */
    byte[] identityPublicKeySpki();

    /**
     * Verilen baytları kimlik özel anahtarıyla imzalar (SHA256withECDSA).
     *
     * @return imza baytları; imzalama BAŞARISIZSA {@code null}.
     *         ASLA throw etmez ve ASLA sahte/boş imza üretmez — çağıran
     *         {@code null}'ı fail-closed olarak ele alır.
     */
    byte[] sign(byte[] data);

    /**
     * Kimlik anahtarı gerçekten donanım destekli mi (StrongBox/TEE).
     *
     * Bilinmiyorsa {@code false} döner — "muhtemelen güvenli" diye
     * YÜKSELTİLMEZ. Bu değer yalnız tanı amaçlıdır, güvenlik kararı vermez.
     */
    boolean isHardwareBacked();
}
