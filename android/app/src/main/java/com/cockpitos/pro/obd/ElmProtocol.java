package com.cockpitos.pro.obd;

import java.io.IOException;
import java.util.Locale;

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
     * ELM327 adaptörünü başlatır — Patch 3: {@link ElmInitSequencer}'a delege eder
     * (DOĞRULAMALI init dizisi: ATS0 + ATAT1 + 0100 warm-up + ATDPN protokol okuma).
     *
     * @param protocol JS'ten gelen / öğrenilmiş ATSP protokol numarası (örn. "6"); null/boş → otomatik (ATSP0).
     * @return ATDPN ile okunan aktif protokol numarası (tek karakter); okunamazsa null.
     * @throws ElmInitSequencer.UnableToConnectException araç/protokolden gerçekten yanıt alınamadı.
     */
    public String initELM327(String protocol) throws IOException {
        return new ElmInitSequencer(channel).init(protocol);
    }

    // ── PID readers (Patch 4: ElmResponseParser ile SINIFLANDIRILMIŞ) ────────
    // Parse FORMÜLLERİ (bayt→değer dönüşümü) eski OBDManager orijinaliyle birebir
    // aynı — yalnızca 7F/BUSY/ERROR/TIMEOUT_PARTIAL sınıfları artık ayrışıyor
    // (son sonuç yine -1, ama diag katmanı ileride bu ayrımı loglayabilir).

    public int readPID_speed() {
        ElmResponseParser.Result r = sendAndClassify("010D", 1500, "41", "0D");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return Integer.parseInt(r.dataHex.substring(0, 2), 16); } catch (Exception ignored) {}
        }
        return -1;
    }

    public int readPID_rpm() {
        ElmResponseParser.Result r = sendAndClassify("010C", 1500, "41", "0C");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 4) {
            try {
                int a = Integer.parseInt(r.dataHex.substring(0, 2), 16);
                int b = Integer.parseInt(r.dataHex.substring(2, 4), 16);
                return ((a * 256) + b) / 4;
            } catch (Exception ignored) {}
        }
        return -1;
    }

    public int readPID_temp() {
        ElmResponseParser.Result r = sendAndClassify("0105", 1500, "41", "05");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return Integer.parseInt(r.dataHex.substring(0, 2), 16) - 40; } catch (Exception ignored) {}
        }
        return -1;
    }

    public int readPID_fuel() {
        ElmResponseParser.Result r = sendAndClassify("012F", 1500, "41", "2F");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return (int) (Integer.parseInt(r.dataHex.substring(0, 2), 16) * 100.0 / 255.0); } catch (Exception ignored) {}
        }
        return -1;
    }

    // ── Patch 6: obdPidConfig.ts ICE/DIESEL setine dahil ama eskiden HİÇ sorgulanmayan
    // PID'ler — SAE J1979 Mode 01 standart formülleri (ISO 15031-5 Tablo B.1).

    /** PID 0x11 — Gaz kelebeği konumu (Throttle Position), 0-100%. */
    public int readPID_throttle() {
        ElmResponseParser.Result r = sendAndClassify("0111", 1500, "41", "11");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return (int) (Integer.parseInt(r.dataHex.substring(0, 2), 16) * 100.0 / 255.0); } catch (Exception ignored) {}
        }
        return -1;
    }

    /** PID 0x0F — Emme havası sıcaklığı (Intake Air Temperature), °C. */
    public int readPID_intakeTemp() {
        ElmResponseParser.Result r = sendAndClassify("010F", 1500, "41", "0F");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return Integer.parseInt(r.dataHex.substring(0, 2), 16) - 40; } catch (Exception ignored) {}
        }
        return -1;
    }

    /** PID 0x0B — Emme manifoldu mutlak basıncı (MAP / turbo boost), kPa (0-255, 1 bayt = 1 kPa). */
    public int readPID_map() {
        ElmResponseParser.Result r = sendAndClassify("010B", 1500, "41", "0B");
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            try { return Integer.parseInt(r.dataHex.substring(0, 2), 16); } catch (Exception ignored) {}
        }
        return -1;
    }

    /**
     * ATRV — ELM327'nin OBD-II 16 pin konektöründen ölçtüğü 12V akü/besleme voltajı.
     * SAE J1979 PID DEĞİL; ELM327'ye özgü AT komutu — yanıt ASCII metindir (ör. "12.4V"),
     * hex PID formatında DEĞİLDİR. -1.0 = okunamadı/desteklenmiyor.
     */
    public double readVoltage() {
        try {
            String r = channel.send("ATRV", 500);
            if (r == null) return -1.0;
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)").matcher(r);
            if (m.find()) return Double.parseDouble(m.group(1));
        } catch (Exception ignored) {}
        return -1.0;
    }

    /**
     * Patch 8: JENERİK Mode 01 PID okuma — TS tarafındaki StandardPidRegistry çözümlemesi
     * için HAM data hex'i döner (mode/pid başlığı SOYULMUŞ, ör. 010C → "1AF8").
     * Formül BURADA YOK — tek doğruluk kaynağı TS tablosudur (test edilebilirlik + tek yer).
     * Desteklenen-PID bitmask'leri (00/20/40/60) de bu yoldan okunur.
     *
     * Patch 11C: bit/enum PID'ler (01, 03, 1C — StandardPidEnums.ts) de AYNI jenerik
     * yoldan tek-seferlik okunur — sayısal registry'ye girmezler ama formül BURADA
     * yazılmaz, ham baytı TS çözer (tek doğruluk kaynağı kuralı burada da geçerli).
     *
     * @return ham data hex; NO_DATA/hata/desteklenmiyor → null (çağıran atlar).
     */
    public String readPidRaw(String pid) {
        String p = pid.toUpperCase(java.util.Locale.ROOT);
        ElmResponseParser.Result r = sendAndClassify("01" + p, 1500, "41", p);
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && !r.dataHex.isEmpty()) {
            return r.dataHex;
        }
        return null;
    }

    /**
     * Patch 11B: Mode 02 freeze frame — jenerik ham PID okuma (frame index 0 sabit).
     * Mode 01 ile AYNI PID formülleri geçerlidir (SAE J1979) → TS'te StandardPidRegistry.decode
     * AYNEN kullanılır, formül BURADA TEKRAR YAZILMAZ. Yanıt "42 <PID> <frame#=00> <data>"
     * biçiminde; frame# baytı (her zaman 00) burada soyulur, TS yalnız data'yı görür.
     *
     * @return ham data hex (frame# soyulmuş); NO_DATA/hata/desteklenmiyor/FF yok → null.
     */
    public String readFreezeFramePidRaw(String pid) {
        String p = pid.toUpperCase(java.util.Locale.ROOT);
        ElmResponseParser.Result r = sendAndClassify("02" + p + "00", 1500, "42", p);
        if (r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 2) {
            return r.dataHex.substring(2); // frame# (ilk bayt) soyulur
        }
        return null;
    }

    /**
     * Patch 11B: Freeze frame'i tetikleyen DTC'yi okur (Mode 02, PID 02). Yanıt
     * "42 02 <frame#=00> <DTC 2 bayt>" — DTC kodlaması Mode 03 ile AYNI (decodeDtcPair).
     * "00 00" DTC baytı → freeze frame kayıtlı DEĞİL (arıza yok/temizlenmiş).
     *
     * @return DTC kodu ('P0301'…); null = freeze frame yok/desteklenmiyor.
     */
    public String readFreezeFrameDtcRaw() {
        ElmResponseParser.Result r = sendAndClassify("020200", 1500, "42", "02");
        if (r.kind != ElmResponseParser.Kind.OK || r.dataHex == null || r.dataHex.length() < 6) return null;
        String dtcHex = r.dataHex.substring(2, 6); // frame# soyulmuş, 2 bayt DTC kalır
        if (dtcHex.equals("0000")) return null; // freeze frame yok
        try {
            return decodeDtcPair(dtcHex);
        } catch (Exception e) {
            return null;
        }
    }

    /** channel.send() + ElmResponseParser.classify() — iletişim hatasını ERROR sınıfına çevirir. */
    private ElmResponseParser.Result sendAndClassify(String cmd, int timeoutMs, String mode, String pid) {
        try {
            return ElmResponseParser.classify(channel.send(cmd, timeoutMs), mode, pid);
        } catch (Exception e) {
            return new ElmResponseParser.Result(ElmResponseParser.Kind.ERROR, null, null);
        }
    }

    // ── Patch 12A: UDS Mode 22 (ReadDataByIdentifier) + ECU adresleme ───────────

    /**
     * Header-restore başarısız olduğunda fırlatılır (Patch 12A) — SESSİZCE YUTULMAZ:
     * yanlış ATSH/ATCRA durumuyla bir sonraki standart Mode 01 poll turunun sessizce
     * YANLIŞ ECU'dan veri okuması, açık bir hatadan daha kötüdür (dürüstlük ilkesi).
     */
    public static final class HeaderRestoreException extends IOException {
        public HeaderRestoreException(String message) { super(message); }
    }

    private static final int UDS_PENDING_TOTAL_TIMEOUT_MS = 10_000;

    /**
     * ECU adresleme atomik bloğu: {@code ATSH<tx>} + {@code ATCRA<rx>} ayarlanır, {@code action}
     * çalıştırılır, action exception fırlatsa BİLE finally'de MUTLAKA varsayılana (7DF fonksiyonel
     * header + otomatik CAN alım filtresi) restore edilir. Bu metod {@link ElmCommandQueue}'nun
     * TEK worker thread'i üzerinden çağrılmalıdır (ör. {@code cmdQueue.submit(USER, ...)}) — böylece
     * header ayarlama → okuma → restore ATOMİK olur, araya başka bir komut giremez.
     *
     * Restore başarısızlığı SESSİZCE YUTULMAZ: action başarılıysa {@link HeaderRestoreException}
     * fırlatılır (yanlış header'la sessiz yanlış veriden iyidir). action zaten bir exception
     * fırlattıysa restore hatası {@code addSuppressed} ile ORİJİNAL exception'a eklenir — orijinal
     * öncelikli fırlatılır (iki hata da kaybolmaz, ama tek exception zinciriyle raporlanır).
     *
     * @throws IOException  ATSH/ATCRA "OK" dönmedi (header hiç kurulamadı — action ÇALIŞTIRILMAZ,
     *                       ama restore YİNE DE denenir çünkü adaptör durumu değişmiş olabilir).
     */
    public <T> T withEcuHeader(String tx, String rx, java.util.concurrent.Callable<T> action) throws Exception {
        T result = null;
        Exception primary = null;
        try {
            setEcuHeader(tx, rx);
            result = action.call();
        } catch (Exception e) {
            primary = e;
        }
        Exception restoreFailure = restoreDefaultHeader();
        if (primary != null) {
            if (restoreFailure != null) primary.addSuppressed(restoreFailure);
            throw primary;
        }
        if (restoreFailure != null) throw restoreFailure;
        return result;
    }

    /** {@code ATSH<tx>} + {@code ATCRA<rx>} — ikisi de "OK" dönmezse header kurulamadı sayılır. */
    private void setEcuHeader(String tx, String rx) throws IOException {
        String sh, cra;
        try {
            sh = channel.send("ATSH" + tx, 500);
            cra = channel.send("ATCRA" + rx, 500);
        } catch (Exception e) {
            throw new IOException("ECU header ayarlanamadı (tx=" + tx + " rx=" + rx + "): " + e.getMessage(), e);
        }
        if (!okish(sh) || !okish(cra)) {
            throw new IOException("ECU header ayarlanamadı (tx=" + tx + " rx=" + rx + "): ATSH/ATCRA 'OK' dönmedi ("
                + summarize(sh) + " / " + summarize(cra) + ")");
        }
    }

    /**
     * Varsayılana restore: {@code ATSH7DF} (fonksiyonel/broadcast header) + {@code ATAR}
     * (Automatically Receive — ATCRA filtresini iptal edip protokolün otomatik alım moduna
     * döner). {@code ATAR} desteklemeyen/eski ELM klonlarında {@code ATCRA} (parametresiz —
     * filtreyi kapat) fallback denenir. İkisi de başarısızsa restore başarısız sayılır.
     *
     * @return null = restore başarılı; değilse fırlatılacak {@link HeaderRestoreException}.
     */
    private Exception restoreDefaultHeader() {
        try {
            String sh = channel.send("ATSH7DF", 500);
            if (!okish(sh)) return new HeaderRestoreException("ATSH7DF restore başarısız: " + summarize(sh));
        } catch (Exception e) {
            return new HeaderRestoreException("ATSH7DF restore istisna: " + e.getMessage());
        }
        try {
            String ar = channel.send("ATAR", 500);
            if (okish(ar)) return null;
        } catch (Exception ignored) {
            // ATAR bazı klonlarda desteklenmiyor olabilir — ATCRA (parametresiz) fallback denenir.
        }
        try {
            String cra = channel.send("ATCRA", 500);
            if (okish(cra)) return null;
            return new HeaderRestoreException("ATAR ve ATCRA (parametresiz) restore başarısız — CAN alım filtresi durumu belirsiz");
        } catch (Exception e) {
            return new HeaderRestoreException("ATCRA (parametresiz) restore istisna: " + e.getMessage());
        }
    }

    private static boolean okish(String resp) {
        return resp != null && resp.toUpperCase(Locale.ROOT).contains("OK");
    }

    private static String summarize(String s) {
        if (s == null) return "(null)";
        String t = s.trim();
        return t.isEmpty() ? "(boş)" : t;
    }

    /** channel.send()'in checked Exception'ını IOException'a çevirir (ElmInitSequencer'daki desenle aynı). */
    private String sendChecked(String cmd, int timeoutMs) throws IOException {
        try {
            return channel.send(cmd, timeoutMs);
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /**
     * UDS Mode 22 (ReadDataByIdentifier) — tek DID okur. {@code withEcuHeader} bloğu İÇİNDE
     * çağrılmalıdır (ECU header zaten ayarlanmış olmalı — bu metod header YÖNETMEZ).
     *
     * Negatif yanıt (7F 22 &lt;NRC&gt;) disiplini:
     *  - NRC 31 (requestOutOfRange) → DID desteklenmiyor → null (çağıran KALICI işaretler).
     *  - NRC 33 (securityAccessDenied) → security access kapsam dışı → desteklenmiyor say → null.
     *  - NRC 78 (responsePending) → ECU yanıtı hazırlıyor, BEKLE-devam et (boş komutla devam
     *    yanıtı istenir — {@link ElmInitSequencer}'daki "SEARCHING" retry deseniyle aynı); toplam
     *    üst sınır {@value #UDS_PENDING_TOTAL_TIMEOUT_MS}ms — sonsuz bekleme YOK.
     *  - Diğer NRC → IOException.
     * "NO DATA" → ECU bu DID'i hiç tanımıyor → desteklenmiyor say → null (7F yanıtı vermeyen
     * ama DID'i de tanımayan ECU'lar için — ARIZA DEĞİL, bkz. ElmResponseParser NO_DATA felsefesi).
     *
     * ISO-TP çok-çerçeveli yanıt ("0:"/"1:" segment önekli satırlar) TEK hex gövdede birleştirilir
     * — {@link #splitResponseBodies(String)} Mode 03/07/0A DTC parser'ıyla PAYLAŞILAN mantıktır
     * (kopyalama YOK, tek doğruluk kaynağı).
     *
     * @return ham data hex ({@code 62<DID>} başlığı SOYULMUŞ); DID desteklenmiyor → null.
     * @throws IOException iletişim hatası / diğer negatif yanıt / pending zaman aşımı / anlaşılmayan yanıt.
     */
    public String readDid(String did) throws IOException {
        return readDid(did, UDS_PENDING_TOTAL_TIMEOUT_MS);
    }

    /**
     * Paket-özel aşırı yükleme — {@code totalTimeoutMs} test edilebilirlik için parametrik
     * (0x78 pending zaman aşımı testleri gerçek 10sn beklemesin). Üretim yolu ({@link #readDid(String)})
     * her zaman {@value #UDS_PENDING_TOTAL_TIMEOUT_MS}ms sabit kullanır — davranış DEĞİŞMEZ.
     */
    String readDid(String did, int totalTimeoutMs) throws IOException {
        String d = did.toUpperCase(Locale.ROOT);
        String cmd = "22" + d;
        long deadline = System.currentTimeMillis() + totalTimeoutMs;
        String raw = sendChecked(cmd, 2000);

        while (true) {
            String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
            if (compact.isEmpty()) throw new IOException("ELM327 yanıt vermedi (DID " + d + ")");
            if (compact.contains("NODATA")) return null; // ECU DID'i tanımıyor — desteklenmiyor say

            if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
                || compact.contains("BUSERROR") || compact.contains("STOPPED")
                || compact.contains("BUFFERFULL")) {
                throw new IOException("ELM327 hata yanıtı (DID " + d + "): " + summarize(raw));
            }

            int negIdx = compact.indexOf("7F22");
            if (negIdx >= 0 && compact.length() >= negIdx + 6) {
                String nrc = compact.substring(negIdx + 4, negIdx + 6);
                if (nrc.equals("31") || nrc.equals("33")) return null; // requestOutOfRange / securityAccessDenied
                if (nrc.equals("78")) {
                    if (System.currentTimeMillis() >= deadline) {
                        throw new IOException("UDS responsePending (0x78) zaman aşımı (DID " + d + ")");
                    }
                    raw = sendChecked("", 2000); // ELM327: boş komut → devam eden yanıtı bekle
                    continue;
                }
                throw new IOException("UDS negatif yanıt NRC=" + nrc + " (DID " + d + ")");
            }

            if (compact.contains("SEARCHING") || compact.contains("BUSINIT")) {
                if (System.currentTimeMillis() >= deadline) {
                    throw new IOException("ELM327 arama zaman aşımı (DID " + d + ")");
                }
                raw = sendChecked("", 2000);
                continue;
            }
            if (compact.equals("?")) throw new IOException("ELM327 komutu anlaşılmadı (DID " + d + ")");

            String needle = "62" + d;
            for (String body : splitResponseBodies(raw)) {
                int idx = body.indexOf(needle);
                if (idx >= 0) return body.substring(idx + needle.length());
            }
            throw new IOException("Beklenmeyen UDS yanıtı (DID " + d + "): " + summarize(raw));
        }
    }

    // ── DTC (SAE J1979 Mode 03 / 04 / 07 / 0A) ───────────────────────────────

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
            return parseDtcResponse(channel.send("03", 4000), "43");
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /**
     * Patch 11A: BEKLEYEN (henüz onaylanmamış/pending) arıza kodlarını okur (Mode 07).
     * Mode 03 ile AYNI parser (yanıt öneki "47") — Mode 07 SAE J1979'da ZORUNLU
     * moddur (her OBD-II uyumlu araç destekler), bu yüzden Mode 0A'nın aksine
     * "desteklenmiyor" ayrımına gerek yoktur — NO DATA her zaman "bekleyen kod yok" demektir.
     *
     * @return kod listesi; kod yoksa BOŞ liste.
     * @throws IOException adaptör/iletişim hatası.
     */
    public java.util.List<String> readPendingDTCs() throws IOException {
        try {
            return parseDtcResponse(channel.send("07", 4000), "47");
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /**
     * Patch 11A: KALICI (permanent/emissions-related) arıza kodlarını okur (Mode 0A).
     * Mode 0A, SAE J1979'a 2010 civarı eklendi — ESKİ (2010 öncesi) araçlarda hiç
     * DESTEKLENMEZ. Bu durum "kalıcı kod yok" ile KARIŞTIRILMAMALI (dürüstlük ilkesi):
     * ECU'nun açık negatif yanıtı ("7F 0A <NRC>") veya ELM327'nin anlaşılmadı yanıtı ("?")
     * → mod desteklenmiyor → null. "NO DATA" → mod destekleniyor ama kalıcı kod yok → boş liste.
     *
     * NOT (dürüst sınır): bazı ELM327 klonları desteklenmeyen modda da sessizce "NO DATA"
     * döner (açık 7F yerine) — bu durumda ayrım YAPILAMAZ, "kalıcı kod yok" varsayılır.
     * Bu, donanım/protokol katmanının doğal belirsizliği; TS tarafı `supported` alanını
     * yalnızca AÇIK negatif/anlaşılmadı yanıtları için false işaretler.
     *
     * @return kod listesi (boş = destekleniyor, kod yok); null = mod desteklenmiyor (açık NRC/"?").
     * @throws IOException adaptör/iletişim hatası (STOPPED/CAN ERROR/bağlantı kopması).
     */
    public java.util.List<String> readPermanentDTCs() throws IOException {
        String raw;
        try {
            raw = channel.send("0A", 4000);
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
        if (raw == null) throw new IOException("ELM327 yanıt vermedi");
        String compact = raw.replaceAll("\\s+", "").toUpperCase();
        if (compact.isEmpty()) throw new IOException("ELM327 yanıt vermedi");
        // Açık negatif yanıt (7F 0A <NRC>) veya ELM327 "anlaşılmadı" → mod desteklenmiyor.
        if (compact.contains("7F0A") || compact.equals("?")) return null;
        return parseDtcResponse(raw, "4A");
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
     * Ham Mode 03/07/0A yanıtını DTC listesine çevirir (Patch 11A: yanıt öneki
     * parametreli — 43/47/4A TEK parser paylaşır, kopyalama YOK).
     *
     * Desteklenen biçimler (ATE0 + ATH0 varsayımı):
     *  - CAN (ISO 15765-4): "43 02 01 71 04 20" — 43'ten sonra 1 SAYAÇ baytı +
     *    kod çiftleri → 43 sonrası bayt sayısı TEK olur, ilk bayt atılır.
     *  - K-line (ISO 9141/14230): "43 01 71 00 00 00 00" — sayaç yok, çerçeve
     *    başına 3 çift (sıfır dolgulu) → bayt sayısı ÇİFT olur.
     *  - Çok-ECU: her ECU yanıtı ayrı satırda ayrı "43"/"47"/"4A" bloğu.
     *  - ISO-TP uzun yanıt: "0:", "1:" segment önekli satırlar → birleştirilir.
     *
     * "NO DATA" → boş liste (kod yok). "ERROR"/"UNABLE TO CONNECT"/"STOPPED"
     * → IOException (adaptör/araç iletişim sorunu — boş listeyle KARIŞTIRILMAZ).
     *
     * @param mode pozitif yanıt öneki: "43" (Mode 03/kayıtlı), "47" (Mode 07/bekleyen),
     *             "4A" (Mode 0A/kalıcı — bu metoda gelmeden önce "desteklenmiyor" ayrımı
     *             {@link #readPermanentDTCs()} tarafında yapılmış olmalı).
     */
    static java.util.List<String> parseDtcResponse(String raw, String mode) throws IOException {
        java.util.LinkedHashSet<String> codes = new java.util.LinkedHashSet<>();
        if (raw == null) throw new IOException("ELM327 yanıt vermedi");

        String compact = raw.replaceAll("\\s+", "").toUpperCase();
        if (compact.isEmpty())               throw new IOException("ELM327 yanıt vermedi");
        if (compact.contains("NODATA"))      return new java.util.ArrayList<>(codes); // kod yok
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR")  || compact.contains("STOPPED")
            || compact.contains("ERROR")     || compact.equals("?"))
            throw new IOException("ELM327 hata yanıtı: " + raw.trim());

        for (String hex : splitResponseBodies(raw)) {
            int idx = hex.startsWith(mode) ? 0 : hex.indexOf(mode);
            if (idx < 0) continue;
            String payload = hex.substring(idx + mode.length());
            if (payload.length() % 2 == 1) payload = payload.substring(0, payload.length() - 1);
            // CAN sayaç baytı: mode sonrası bayt sayısı tekse ilk bayt sayaçtır → at.
            if ((payload.length() / 2) % 2 == 1) payload = payload.substring(2);

            for (int i = 0; i + 4 <= payload.length(); i += 4) {
                String pair = payload.substring(i, i + 4);
                if (pair.equals("0000")) continue; // K-line sıfır dolgusu
                codes.add(decodeDtcPair(pair));
            }
        }
        return new java.util.ArrayList<>(codes);
    }

    /**
     * Ham çok-satırlı ELM327 yanıtını bağımsız hex "gövde"lere ayrıştırır (Patch 4 DTC parser'ından
     * Patch 12A UDS readDid ile PAYLAŞILAN mantık — kopyalama YOK, tek doğruluk kaynağı):
     *  - ISO-TP segment önekli satırlar ("0:", "1:"...) TEK gövdede BİRLEŞTİRİLİR (bir PDU'nun
     *    parçalarıdır) — birleşik gövde listenin SONUNA eklenir.
     *  - Önek YOK satırlar (çok-ECU: her ECU kendi tek çerçevesiyle yanıt verir) BAĞIMSIZ
     *    gövdeler olarak sırayla eklenir — birbirine KARIŞTIRILMAZ.
     *
     * @return hex gövde listesi (boşluksuz, büyük harf); raw null/boş ise boş liste.
     */
    static java.util.List<String> splitResponseBodies(String raw) {
        java.util.List<String> bodies = new java.util.ArrayList<>();
        if (raw == null) return bodies;
        StringBuilder segmented = new StringBuilder();
        for (String line : raw.toUpperCase(Locale.ROOT).split("\n")) {
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
        return bodies;
    }

    /**
     * 2 baytlık (4 hex hane) DTC çiftini P/B/C/U kod string'ine çevirir — Mode 03/07/0A
     * kod listesi VE Mode 02 freeze-frame tetikleyici DTC'si tarafından paylaşılır
     * (kopyalama YOK, tek yer).
     */
    private static String decodeDtcPair(String pairHex) {
        int b1 = Integer.parseInt(pairHex.substring(0, 2), 16);
        char letter = "PCBU".charAt((b1 >> 6) & 0x03);
        return String.format("%c%d%X%s", letter, (b1 >> 4) & 0x03, b1 & 0x0F, pairHex.substring(2));
    }
}
