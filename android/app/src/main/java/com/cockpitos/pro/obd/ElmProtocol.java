package com.cockpitos.pro.obd;

import java.io.IOException;

/**
 * ElmProtocol — ELM327 init dizisi + SAE J1979 Mode 01 PID parse mantığı.
 *
 * Bir {@link ElmCommandChannel} üzerinden çalışır; taşıma katmanından (Classic
 * RFCOMM / BLE GATT / USB serial) tamamen bağımsızdır. Böylece aynı protokol
 * mantığı tüm taşıma katmanları tarafından paylaşılır.
 *
 * DAVRANIŞ KORUMASI (Zero-Change):
 *   - Init AT komutları, Thread.sleep DEĞERLERİ ve PID parse FORMÜLLERİ
 *     {@code OBDManager}'daki orijinaliyle BİREBİR (byte-identik) aynıdır.
 *   - Bu sınıf yalnızca o mantığın taşındığı yerdir; davranış değişmez.
 */
public final class ElmProtocol {

    private final ElmCommandChannel channel;

    public ElmProtocol(ElmCommandChannel channel) {
        this.channel = channel;
    }

    /**
     * ELM327 adaptörünü başlatır.
     *
     * @param protocol JS'ten gelen ATSP protokol numarası (örn. "6"); null/boş → otomatik (ATSP0).
     *
     * Davranış {@code OBDManager.initELM327()} ile birebir aynıdır.
     */
    public void initELM327(String protocol) throws IOException {
        try {
            channel.send("ATZ",   2500);
            channel.send("ATE0",  1000);
            channel.send("ATL0",   500);
            channel.send("ATH0",   500);
            // P2: JS protokol gönderdiyse zorla (ör. '6' → ISO 15765-4 CAN); yoksa otomatik.
            String sp = protocol;
            if (sp != null && sp.length() == 1) {
                channel.send("ATSP" + sp, 1000);
            } else {
                channel.send("ATSP0", 1000);
            }
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    // ── PID readers ─────────────────────────────────────────────────────────
    // Parse formülleri OBDManager'daki orijinalleriyle birebir aynıdır.

    public int readPID_speed() {
        try {
            String r = channel.send("010D", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("410D");
            if (idx >= 0 && r.length() >= idx + 6)
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
        } catch (Exception ignored) {}
        return -1;
    }

    public int readPID_rpm() {
        try {
            String r = channel.send("010C", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("410C");
            if (idx >= 0 && r.length() >= idx + 8) {
                int a = Integer.parseInt(r.substring(idx + 4, idx + 6), 16);
                int b = Integer.parseInt(r.substring(idx + 6, idx + 8), 16);
                return ((a * 256) + b) / 4;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    public int readPID_temp() {
        try {
            String r = channel.send("0105", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("4105");
            if (idx >= 0 && r.length() >= idx + 6)
                return Integer.parseInt(r.substring(idx + 4, idx + 6), 16) - 40;
        } catch (Exception ignored) {}
        return -1;
    }

    public int readPID_fuel() {
        try {
            String r = channel.send("012F", 1500).replaceAll("\\s+", "").toUpperCase();
            int idx = r.indexOf("412F");
            if (idx >= 0 && r.length() >= idx + 6)
                return (int) (Integer.parseInt(r.substring(idx + 4, idx + 6), 16) * 100.0 / 255.0);
        } catch (Exception ignored) {}
        return -1;
    }

    // ── DTC (SAE J1979 Mode 03 / 04) ────────────────────────────────────────

    /**
     * Kayıtlı arıza kodlarını okur (Mode 03).
     *
     * @return P/B/C/U formatında kod listesi; araçta kod yoksa BOŞ liste
     *         ("NO DATA" da boş liste sayılır — bazı ECU'lar kod yokken yanıt vermez).
     * @throws IOException adaptör/iletişim hatası (ELM "ERROR", bağlantı kopması).
     */
    public java.util.List<String> readDTCs() throws IOException {
        try {
            // Mode 03 yanıtı çok-çerçeveli olabilir (3+ kod, ISO-TP) → geniş timeout.
            return parseDtcResponse(channel.send("03", 4000));
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /**
     * Arıza kodlarını ve freeze-frame verisini siler (Mode 04).
     * @return true → ECU "44" onayı döndü; false → onay yok (silinmemiş sayılır).
     */
    public boolean clearDTCs() throws IOException {
        try {
            String r = channel.send("04", 4000).replaceAll("\\s+", "").toUpperCase();
            return r.contains("44");
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /**
     * Ham Mode 03 yanıtını DTC listesine çevirir.
     *
     * Desteklenen biçimler (ATE0 + ATH0 varsayımı):
     *  - CAN (ISO 15765-4): "43 02 01 71 04 20" — 43'ten sonra 1 SAYAÇ baytı +
     *    kod çiftleri → 43 sonrası bayt sayısı TEK olur, ilk bayt atılır.
     *  - K-line (ISO 9141/14230): "43 01 71 00 00 00 00" — sayaç yok, çerçeve
     *    başına 3 çift (sıfır dolgulu) → bayt sayısı ÇİFT olur.
     *  - Çok-ECU: her ECU yanıtı ayrı satırda ayrı "43" bloğu.
     *  - ISO-TP uzun yanıt: "0:", "1:" segment önekli satırlar → birleştirilir.
     *
     * "NO DATA" → boş liste (kod yok). "ERROR"/"UNABLE TO CONNECT"/"STOPPED"
     * → IOException (adaptör/araç iletişim sorunu — boş listeyle KARIŞTIRILMAZ).
     */
    static java.util.List<String> parseDtcResponse(String raw) throws IOException {
        java.util.LinkedHashSet<String> codes = new java.util.LinkedHashSet<>();
        if (raw == null) throw new IOException("ELM327 yanıt vermedi");

        String compact = raw.replaceAll("\\s+", "").toUpperCase();
        if (compact.isEmpty())               throw new IOException("ELM327 yanıt vermedi");
        if (compact.contains("NODATA"))      return new java.util.ArrayList<>(codes); // kod yok
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR")  || compact.contains("STOPPED")
            || compact.contains("ERROR")     || compact.equals("?"))
            throw new IOException("ELM327 hata yanıtı: " + raw.trim());

        // ISO-TP segment önekli satırları ("0:", "1:"...) tek hex gövdede birleştir;
        // diğer satırlar (ECU başına tek çerçeve) bağımsız işlenir.
        StringBuilder segmented = new StringBuilder();
        java.util.List<String> bodies = new java.util.ArrayList<>();
        for (String line : raw.toUpperCase().split("\n")) {
            String t = line.trim();
            if (t.isEmpty()) continue;
            if (t.matches("^[0-9A-F]{1,2}:.*")) {
                segmented.append(t.substring(t.indexOf(':') + 1).replaceAll("[^0-9A-F]", ""));
            } else {
                String hex = t.replaceAll("[^0-9A-F]", "");
                if (!hex.isEmpty()) bodies.add(hex);
            }
        }
        if (segmented.length() > 0) bodies.add(segmented.toString());

        for (String hex : bodies) {
            int idx = hex.startsWith("43") ? 0 : hex.indexOf("43");
            if (idx < 0) continue;
            String payload = hex.substring(idx + 2);
            if (payload.length() % 2 == 1) payload = payload.substring(0, payload.length() - 1);
            // CAN sayaç baytı: 43 sonrası bayt sayısı tekse ilk bayt sayaçtır → at.
            if ((payload.length() / 2) % 2 == 1) payload = payload.substring(2);

            for (int i = 0; i + 4 <= payload.length(); i += 4) {
                String pair = payload.substring(i, i + 4);
                if (pair.equals("0000")) continue; // K-line sıfır dolgusu
                int b1 = Integer.parseInt(pair.substring(0, 2), 16);
                char letter = "PCBU".charAt((b1 >> 6) & 0x03);
                codes.add(String.format("%c%d%X%s",
                    letter, (b1 >> 4) & 0x03, b1 & 0x0F, pair.substring(2)));
            }
        }
        return new java.util.ArrayList<>(codes);
    }
}
