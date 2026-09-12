package com.cockpitos.phonehub.protocol;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * LinkKeyValue — el sıkışma yükleri için küçük, SINIRLI ve DETERMİNİSTİK codec.
 *
 * ── NEDEN JSON DEĞİL ────────────────────────────────────────────────────────
 * Bu modül saf Java'dır (Android'in `org.json`'ı YOK) ve el sıkışma baytları
 * İMZALANIR — yani iki uçta BİT BİT aynı üretilmek zorundadır. JSON'da anahtar
 * sırası, boşluk ve sayı biçimlendirmesi kütüphaneye göre değişebilir; imza
 * doğrulaması bu yüzden sessizce patlar. Sabit sıralı, tek biçimli bu codec
 * o riski ortadan kaldırır.
 *
 * Uygulama mesajları (el sıkışma SONRASI) bu codec'i KULLANMAZ — onlar
 * TypeScript tarafının JSON zarfıdır ve bu modül için opak bayttır.
 *
 * ── BİÇİM ───────────────────────────────────────────────────────────────────
 * {@code anahtar=değer} satırları, '\n' ile ayrık. Anahtar: [a-zA-Z0-9_.]
 * Değer: satırsonu içermeyen ASCII (ikili veri Base64). Ekleme SIRASI korunur.
 *
 * ── SINIRLAR (bounded) ──────────────────────────────────────────────────────
 * En çok {@link #MAX_ENTRIES} girdi, anahtar {@link #MAX_KEY_CHARS}, değer
 * {@link #MAX_VALUE_CHARS}. Aşan girdi ayrıştırmayı BAŞARISIZ kılar (sessizce
 * kırpılmaz — kırpılmış bir el sıkışma sahte güven üretir).
 */
public final class LinkKeyValue {

    public static final int MAX_ENTRIES = 32;
    public static final int MAX_KEY_CHARS = 32;
    public static final int MAX_VALUE_CHARS = 2048;

    private final Map<String, String> values = new LinkedHashMap<>();

    public LinkKeyValue() { }

    /* ══════════════════════════════════════════════════════════════════════
     * Yazma
     * ════════════════════════════════════════════════════════════════════ */

    public LinkKeyValue put(String key, String value) {
        if (key != null && value != null) values.put(key, value);
        return this;
    }

    public LinkKeyValue putInt(String key, int value) {
        return put(key, Integer.toString(value));
    }

    public LinkKeyValue putLong(String key, long value) {
        return put(key, Long.toString(value));
    }

    /** İkili veri Base64 (dolgusuz değil — standart, iki uçta aynı). */
    public LinkKeyValue putBytes(String key, byte[] value) {
        if (value == null) return this;
        return put(key, Base64.getEncoder().encodeToString(value));
    }

    /** Liste: virgülle ayrık. Boş liste boş dize olarak yazılır. */
    public LinkKeyValue putList(String key, List<String> items) {
        if (items == null) return put(key, "");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < items.size(); i++) {
            String it = items.get(i);
            if (it == null || it.isEmpty()) continue;
            if (it.indexOf(',') >= 0 || it.indexOf('\n') >= 0 || it.indexOf('=') >= 0) continue;
            if (sb.length() > 0) sb.append(',');
            sb.append(it);
        }
        return put(key, sb.toString());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Okuma
     * ════════════════════════════════════════════════════════════════════ */

    public boolean has(String key) { return values.containsKey(key); }

    public String get(String key, String fallback) {
        String v = values.get(key);
        return v == null ? fallback : v;
    }

    /** Bozuk sayı sessizce 0 OLMAZ — çağıranın verdiği fallback döner. */
    public int getInt(String key, int fallback) {
        String v = values.get(key);
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    public long getLong(String key, long fallback) {
        String v = values.get(key);
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Long.parseLong(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** Base64 çözülemezse null — sahte boş dizi ÜRETİLMEZ. */
    public byte[] getBytes(String key) {
        String v = values.get(key);
        if (v == null || v.isEmpty()) return null;
        try {
            return Base64.getDecoder().decode(v);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public List<String> getList(String key) {
        List<String> out = new ArrayList<>();
        String v = values.get(key);
        if (v == null || v.isEmpty()) return out;
        for (String part : v.split(",")) {
            String t = part.trim();
            if (!t.isEmpty() && out.size() < MAX_ENTRIES) out.add(t);
        }
        return out;
    }

    public int size() { return values.size(); }

    /* ══════════════════════════════════════════════════════════════════════
     * Serileştirme
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Tel üzerindeki baytlar. Ekleme sırası korunur → İMZA iki uçta tutar.
     * Sınır aşımında null döner (fail-closed).
     */
    public byte[] encode() {
        if (values.size() > MAX_ENTRIES) return null;
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : values.entrySet()) {
            String k = e.getKey();
            String v = e.getValue();
            if (k.length() > MAX_KEY_CHARS || v.length() > MAX_VALUE_CHARS) return null;
            if (!isValidKey(k) || v.indexOf('\n') >= 0) return null;
            if (sb.length() > 0) sb.append('\n');
            sb.append(k).append('=').append(v);
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    /** Ayrıştırma. Bozuk/sınır aşan girdi → null (kısmi sonuç DÖNMEZ). */
    public static LinkKeyValue decode(byte[] data) {
        if (data == null) return null;
        String text = new String(data, StandardCharsets.UTF_8);
        LinkKeyValue kv = new LinkKeyValue();
        if (text.isEmpty()) return kv;

        String[] lines = text.split("\n", -1);
        if (lines.length > MAX_ENTRIES) return null;
        for (String line : lines) {
            if (line.isEmpty()) continue;
            int eq = line.indexOf('=');
            if (eq <= 0) return null;
            String k = line.substring(0, eq);
            String v = line.substring(eq + 1);
            if (k.length() > MAX_KEY_CHARS || v.length() > MAX_VALUE_CHARS) return null;
            if (!isValidKey(k)) return null;
            kv.values.put(k, v);
        }
        return kv;
    }

    private static boolean isValidKey(String k) {
        if (k == null || k.isEmpty()) return false;
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9') || c == '_' || c == '.';
            if (!ok) return false;
        }
        return true;
    }

    /**
     * ANAHTAR ADLARI döner, DEĞERLER DÖNMEZ. El sıkışma yükünde açık anahtar
     * ve sürüm gibi alanlar vardır; bunların loglara akmasını istemiyoruz.
     */
    @Override
    public String toString() {
        return "LinkKeyValue{keys=" + values.keySet() + "}";
    }
}
