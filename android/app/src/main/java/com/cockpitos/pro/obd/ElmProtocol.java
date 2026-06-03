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
}
