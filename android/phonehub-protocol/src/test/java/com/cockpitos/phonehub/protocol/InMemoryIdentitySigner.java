package com.cockpitos.phonehub.protocol;

import java.security.KeyPair;
import java.security.Signature;

/**
 * InMemoryIdentitySigner — TEST İÇİN kimlik imzalayıcı.
 *
 * Üretimde bu arayüzü Android Keystore destekli sınıf uygular ve özel anahtar
 * hiç dışarı çıkmaz. Testte gerçek Keystore olmadığı için anahtar bellekte
 * üretilir — protokol kodu iki durumda da AYNIDIR, değişen yalnız anahtarın
 * NEREDE durduğudur. {@link #isHardwareBacked()} burada bilinçli olarak
 * {@code false} döner: test ortamı donanım koruması İDDİA ETMEZ.
 */
final class InMemoryIdentitySigner implements LinkIdentitySigner {

    private final KeyPair keyPair;
    private final boolean brokenSigner;

    InMemoryIdentitySigner() {
        this(false);
    }

    /** @param brokenSigner true ise imzalama null döner (fail-closed testi). */
    InMemoryIdentitySigner(boolean brokenSigner) {
        this.brokenSigner = brokenSigner;
        try {
            keyPair = LinkKeyExchange.generateEphemeralKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException("test anahtarı üretilemedi", e);
        }
    }

    @Override
    public byte[] identityPublicKeySpki() {
        return keyPair.getPublic().getEncoded();
    }

    @Override
    public byte[] sign(byte[] data) {
        if (brokenSigner) return null;
        try {
            Signature s = Signature.getInstance(LinkKeyExchange.SIGNATURE_ALGORITHM);
            s.initSign(keyPair.getPrivate());
            s.update(data);
            return s.sign();
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public boolean isHardwareBacked() {
        return false;
    }

    String fingerprint() {
        try {
            return LinkKeyExchange.fingerprint(identityPublicKeySpki());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
