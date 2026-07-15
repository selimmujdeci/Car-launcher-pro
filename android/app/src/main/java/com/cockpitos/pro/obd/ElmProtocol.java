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
     * PR-OBD-DIAG-3: {@link #readPidRaw} ile AYNI tek ELM komutunu çalıştırır, ama ham
     * SINIFLANDIRMAYI ({@link ElmResponseParser.Kind}: OK/NO_DATA/NEG_7F/TIMEOUT/…) korur.
     *
     * KÖK NEDEN: {@code readPidRaw} sonucu {@code null}'a çökerttiğinden EXTENDED poll
     * hattında "poll denendi ama ECU değer üretmedi" (H2) ile "hiç denenmedi" (H1)
     * ayrılamıyordu ({@code extended.samples: []} her iki durumda aynı görünüyor). Bu metot
     * outcome kanıtını yukarı taşır ({@link ExtendedPollEvidence}). Davranış EŞDEĞER: çağıran
     * yalnız OK+veri durumunda {@code dataHex}'i kullanır (readPidRaw ile bit-bit aynı bayt),
     * hiç ek OBD komutu göndermez.
     */
    public ElmResponseParser.Result readPidClassified(String pid) {
        String p = pid.toUpperCase(java.util.Locale.ROOT);
        return sendAndClassify("01" + p, 1500, "41", p);
    }

    // ── W5-OBD-PR1: El sıkışması (VIN + desteklenen-PID bitmap keşfi) ──────────

    /** VIN (Mode 09 PID 02) sorgu timeout'u — multi-frame ISO-TP için biraz uzun. */
    private static final int HANDSHAKE_VIN_TIMEOUT_MS    = 2000;
    /** Bitmap bloğu (Mode 01 PID 00/20/…) sorgu timeout'u. */
    private static final int HANDSHAKE_BITMAP_TIMEOUT_MS = 1200;

    /**
     * El sıkışması HAM yanıtları — ayrıştırma YAPILMAZ (tek doğruluk kaynağı TS:
     * {@code OBDHandshake.buildHandshakeResult}). Sorgulanmayan blok = "" (boş).
     * Değişmez (immutable) — JIT hidden-class stabilitesi için tüm alanlar sabit sıralı.
     */
    public static final class HandshakeRaw {
        public final String raw09;
        public final String raw0100;
        public final String raw0120;
        public final String raw0140;
        public final String raw0160;
        public final String raw0180;
        public final String raw01A0;

        HandshakeRaw(String raw09, String raw0100, String raw0120, String raw0140,
                     String raw0160, String raw0180, String raw01A0) {
            this.raw09   = raw09;
            this.raw0100 = raw0100;
            this.raw0120 = raw0120;
            this.raw0140 = raw0140;
            this.raw0160 = raw0160;
            this.raw0180 = raw0180;
            this.raw01A0 = raw01A0;
        }
    }

    /**
     * OBD el sıkışması — VIN + desteklenen-PID bitmap keşfi. HAM ELM327 yanıtlarını
     * döndürür (formül/parse YOK; TS ayrıştırır). {@code cmdQueue}'nun TEK worker
     * thread'inde tek görev olarak çağrılmalıdır (araya poll komutu girmesin).
     *
     * Süreklilik-bit disiplini (SAE J1979): bir bitmap bloğunun SON PID'i
     * (0x20/0x40/0x60/0x80/0xA0) set DEĞİLSE sonraki blok HİÇ sorgulanmaz →
     * desteklenmeyen blok poll edilmez, NO-DATA fırtınası oluşmaz.
     *
     * FAIL-SOFT: her sorgu {@link #safeSend} ile sarılır — hiçbir exception dışarı
     * sızmaz (item 7). Tamamen başarısız olsa bile tüm alanları "" olan bir sonuç döner.
     */
    public HandshakeRaw performHandshakeRaw() {
        final String raw09   = safeSend("0902", HANDSHAKE_VIN_TIMEOUT_MS);
        final String raw0100 = safeSend("0100", HANDSHAKE_BITMAP_TIMEOUT_MS);

        String raw0120 = "", raw0140 = "", raw0160 = "", raw0180 = "", raw01A0 = "";
        if (hasContinuationBit(raw0100, "41", "00")) {
            raw0120 = safeSend("0120", HANDSHAKE_BITMAP_TIMEOUT_MS);
            if (hasContinuationBit(raw0120, "41", "20")) {
                raw0140 = safeSend("0140", HANDSHAKE_BITMAP_TIMEOUT_MS);
                if (hasContinuationBit(raw0140, "41", "40")) {
                    raw0160 = safeSend("0160", HANDSHAKE_BITMAP_TIMEOUT_MS);
                    if (hasContinuationBit(raw0160, "41", "60")) {
                        raw0180 = safeSend("0180", HANDSHAKE_BITMAP_TIMEOUT_MS);
                        if (hasContinuationBit(raw0180, "41", "80")) {
                            raw01A0 = safeSend("01A0", HANDSHAKE_BITMAP_TIMEOUT_MS);
                        }
                    }
                }
            }
        }
        return new HandshakeRaw(raw09, raw0100, raw0120, raw0140, raw0160, raw0180, raw01A0);
    }

    /** channel.send() — hata/exception'ı "" boş stringe çevirir (handshake fail-soft). */
    private String safeSend(String cmd, int timeoutMs) {
        try {
            return sendChecked(cmd, timeoutMs);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Bir bitmap bloğunun SON bit'i (blok+0x20 PID'i, örn. 0100→0x20) set mi?
     * Set ise sonraki blok ({@code 01<blok+0x20>}) sorgulanmalıdır.
     * {@link ElmResponseParser#classify} ile ayrıştırır — kopya parse YOK.
     */
    private static boolean hasContinuationBit(String raw, String posMode, String pid) {
        ElmResponseParser.Result r = ElmResponseParser.classify(raw, posMode, pid);
        if (r.kind != ElmResponseParser.Kind.OK || r.dataHex == null || r.dataHex.length() < 8) {
            return false;
        }
        try {
            // İlk 4 data byte = A B C D; byte D (son) bit0 = sonraki blok göstergesi.
            int lastByte = Integer.parseInt(r.dataHex.substring(6, 8), 16);
            return (lastByte & 0x01) != 0;
        } catch (Exception e) {
            return false;
        }
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
     * ECU adresleme atomik bloğu — tx'in uzunluğuna göre dallanır (Patch 13):
     *  - 3 hex hane (standart 11-bit ISO 15765-4) → {@link #withEcuHeader11Bit} (Patch 12A,
     *    DEĞİŞMEDİ — davranış BİREBİR aynı).
     *  - 8 hex hane (29-bit genişletilmiş adresleme, ör. "18DADAF1") → {@link #withEcuHeader29Bit}
     *    (ATCP öncelik baytı + ATSP7 protokol geçişi, ROADMAP boşluk (3)).
     *
     * Bu metod {@link ElmCommandQueue}'nun TEK worker thread'i üzerinden çağrılmalıdır (ör.
     * {@code cmdQueue.submit(USER, ...)}) — böylece header ayarlama → okuma → restore ATOMİK
     * olur, araya başka bir komut giremez (her iki dal için de geçerli).
     */
    public <T> T withEcuHeader(String tx, String rx, java.util.concurrent.Callable<T> action) throws Exception {
        if (tx != null && tx.length() == 8) {
            return withEcuHeader29Bit(tx, rx, action);
        }
        return withEcuHeader11Bit(tx, rx, action);
    }

    /**
     * Standart 11-bit ISO 15765-4 ECU adresleme (Patch 12A — DEĞİŞMEDİ): {@code ATSH<tx>} +
     * {@code ATCRA<rx>} ayarlanır, {@code action} çalıştırılır, action exception fırlatsa BİLE
     * finally'de MUTLAKA varsayılana (7DF fonksiyonel header + otomatik CAN alım filtresi)
     * restore edilir.
     *
     * Restore başarısızlığı SESSİZCE YUTULMAZ: action başarılıysa {@link HeaderRestoreException}
     * fırlatılır (yanlış header'la sessiz yanlış veriden iyidir). action zaten bir exception
     * fırlattıysa restore hatası {@code addSuppressed} ile ORİJİNAL exception'a eklenir — orijinal
     * öncelikli fırlatılır (iki hata da kaybolmaz, ama tek exception zinciriyle raporlanır).
     *
     * @throws IOException  ATSH/ATCRA "OK" dönmedi (header hiç kurulamadı — action ÇALIŞTIRILMAZ,
     *                       ama restore YİNE DE denenir çünkü adaptör durumu değişmiş olabilir).
     */
    private <T> T withEcuHeader11Bit(String tx, String rx, java.util.concurrent.Callable<T> action) throws Exception {
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

    /** ELM327 varsayılan CAN önceliği (öncelik baytı) — 29-bit restore hedefi (Patch 13). */
    private static final String DEFAULT_29BIT_CAN_PRIORITY = "18";

    /**
     * İç kısayol sinyali (Patch 13) — 29-bit AT komut zincirinde YALNIZ {@code ATSP7}/{@code ATCP}
     * için: klon adaptör "?" (desteklenmeyen komut) dönerse fırlatılır. {@link #withEcuHeader29Bit}
     * bunu YAKALAR, {@code action}'ı HİÇ ÇAĞIRMADAN {@code null} döner — {@link #readDid}'in
     * "DID desteklenmiyor" null sözleşmesiyle AYNI kanaldan akar (CarLauncherPlugin.readObdDid
     * {@code supported:false} çözer, manufacturerPidService.ts bunu 7F-31/33 ile AYNI şekilde
     * KALICI "desteklenmiyor" işaretler — standart Mode 01 poll döngüsüne SIFIR etkisi olur, bu
     * ayrı bir USER-öncelikli kuyruk görevidir).
     *
     * {@code ATSH}/{@code ATCRA} için bu tolerans YOK (gerçek {@link IOException} fırlatılır) —
     * bunlar 11-bit yolunda zaten TEMEL komutlar sayılır (her ELM327/klonun desteklediği
     * varsayılır); yalnız 29-bit'e özgü {@code ATCP} ve {@code ATSP7} bazı ucuz klonlarda hiç
     * yok olabilir.
     */
    private static final class Unsupported29BitCommandException extends RuntimeException {
        Unsupported29BitCommandException(String message) { super(message); }
    }

    /**
     * 29-bit genişletilmiş UDS adresleme (Patch 13, ROADMAP boşluk (3)) — ELM327 {@code ATCP}
     * (CAN önceliği/öncelik baytı) + {@code ATSH} (header'ın son 6 hanesi) + {@code ATCRA}
     * (29-bit alım filtresi) + gerekirse {@code ATSP7} (ISO 15765-4 29-bit/500k) protokol geçişi.
     *
     * Sıra: (1) ATDPN ile mevcut protokolü öğren — zaten 29-bit (7/9) ise ATSP DEĞİŞTİRİLMEZ;
     * (2) değilse ATSP7; (3) {@code ATCP<tx ilk 2 hane>} (öncelik baytı); (4) {@code ATSH<tx son
     * 6 hane>}; (5) {@code ATCRA<rx>}; (6) action. HER durumda (başarı/istisna/klon-desteklemiyor)
     * restore denenir — Patch 12A yasası burada da geçerli, artık protokol + CAN önceliği dahil;
     * yalnız GERÇEKTEN değiştirilmiş alanlar restore edilir (hiç set edilmemiş bir şeyi restore
     * etmeye çalışmak aynı "?" yanıtını tekrar üretir ve haksız yere hata fırlatırdı).
     *
     * 11-bit bus'ta 500k CAN hızı aynıdır — yalnız header formatı değişir (basitleştirme: bilinen
     * 250k 29-bit varyantı — protokol 9 — buraya öğrenilmiş protokolse dokunulmaz, ama otomatik
     * geçişte her zaman 500k/ATSP7 hedeflenir; ROADMAP notu).
     */
    private <T> T withEcuHeader29Bit(String tx, String rx, java.util.concurrent.Callable<T> action) throws Exception {
        T result = null;
        Exception primary = null;
        final String priorProtocol = queryActiveProtocolDigit();
        boolean protocolSwitched = false;
        boolean cpSet = false;
        try {
            if (!is29BitProtocol(priorProtocol)) {
                sendGuarded29Bit("ATSP7", 1000, "ATSP7 (29-bit protokol geçişi)");
                protocolSwitched = true;
            }
            String priorityByte = tx.substring(0, 2);
            String shSuffix = tx.substring(2);
            sendGuarded29Bit("ATCP" + priorityByte, 500, "ATCP" + priorityByte + " (CAN öncelik baytı)");
            cpSet = true;
            // ATSH<shSuffix> + ATCRA<rx> — 11-bit yolundaki setEcuHeader ile AYNI hard-fail
            // semantiği (kopyalama yok); ilk parametre burada tx'in son 6 hanesidir (shSuffix),
            // ikinci parametre rx'in TAM 8 hanesidir — setEcuHeader yalnız "ATSH<a>"+"ATCRA<b>"
            // gönderir, uzunluk varsayımı yapmaz.
            setEcuHeader(shSuffix, rx);
            result = action.call();
        } catch (Unsupported29BitCommandException clone) {
            // Klon dürüstlüğü — DID "desteklenmiyor" say (7F-31/33 ile AYNI null kanalı).
            // Burada android.util.Log KULLANILMAZ: ElmProtocol saf JVM sınıfıdır (FakeChannel
            // testleri Android runtime'sız koşar); bilgi kaybolmaz — null, plugin katmanında
            // supported:false olarak TS'e ulaşır ve manufacturerPidService diag'a kaydeder.
            result = null;
        } catch (Exception e) {
            primary = e;
        }
        Exception restoreFailure = restoreDefault29Bit(cpSet, protocolSwitched, priorProtocol);
        if (primary != null) {
            if (restoreFailure != null) primary.addSuppressed(restoreFailure);
            throw primary;
        }
        if (restoreFailure != null) throw restoreFailure;
        return result;
    }

    /**
     * ATSP7/ATCP komutları için: yanıt "OK" ise sessizce döner; "?" ise
     * {@link Unsupported29BitCommandException} (klon dürüstlüğü — bkz. sınıf yorumu); diğer
     * başarısız/timeout/istisna yanıtlar gerçek {@link IOException} (donanım/protokol hatası).
     */
    private String sendGuarded29Bit(String cmd, int timeoutMs, String stepDesc) throws IOException {
        String resp;
        try {
            resp = channel.send(cmd, timeoutMs);
        } catch (Exception e) {
            throw new IOException("29-bit UDS: " + stepDesc + " istisna: " + e.getMessage(), e);
        }
        if (resp != null && resp.trim().equals("?")) {
            throw new Unsupported29BitCommandException(stepDesc + " desteklenmiyor (klon adaptör): " + summarize(resp));
        }
        if (!okish(resp)) {
            throw new IOException("29-bit UDS: " + stepDesc + " başarısız: " + summarize(resp));
        }
        return resp;
    }

    /** ATDPN ile aktif protokolü öğrenir — {@link ElmResponseParser#parseActiveProtocolDigit}
     *  ile {@link ElmInitSequencer} PAYLAŞIR (kopyalama yok). Okunamazsa null (sessiz — protokol
     *  bilgisi olmadan devam edilir, ElmInitSequencer ile AYNI felsefe). */
    private String queryActiveProtocolDigit() {
        try {
            return ElmResponseParser.parseActiveProtocolDigit(channel.send("ATDPN", 1000));
        } catch (Exception e) {
            return null;
        }
    }

    /** ELM327 protokol numaraları 7 (29-bit/500k) ve 9 (29-bit/250k) — ISO 15765-4 29-bit ID. */
    private static boolean is29BitProtocol(String protocolDigit) {
        return "7".equals(protocolDigit) || "9".equals(protocolDigit);
    }

    /**
     * 29-bit restore: yalnız GERÇEKTEN değiştirilmiş alanlar restore edilir —
     *  (1) {@code cpSet} ise {@code ATCP18} (varsayılan CAN önceliği); (2) {@code protocolSwitched}
     *  ise {@code ATSP<önceki protokol>} (öğrenilemediyse ATSP0 otomatik-arama fallback);
     *  (3) HER ZAMAN {@link #restoreDefaultHeader()} ({@code ATSH7DF}+{@code ATAR}/{@code ATCRA}-off
     *  — 11-bit ile PAYLAŞILAN, kopyalama yok). Restore başarısızlığı SESSİZCE YUTULMAZ (Patch 12A
     *  yasası — artık protokol/CAN önceliği restore'unu da kapsar); {@link HeaderRestoreException}
     *  ile raporlanır, {@code addSuppressed} zinciri korunur.
     */
    private Exception restoreDefault29Bit(boolean cpSet, boolean protocolSwitched, String priorProtocol) {
        Exception failure = null;
        if (cpSet) {
            try {
                String cp = channel.send("ATCP" + DEFAULT_29BIT_CAN_PRIORITY, 500);
                if (!okish(cp)) {
                    failure = chain(failure, new HeaderRestoreException(
                        "CAN öncelik baytı restore (ATCP" + DEFAULT_29BIT_CAN_PRIORITY + ") başarısız: " + summarize(cp)));
                }
            } catch (Exception e) {
                failure = chain(failure, new HeaderRestoreException(
                    "CAN öncelik baytı restore (ATCP" + DEFAULT_29BIT_CAN_PRIORITY + ") istisna: " + e.getMessage()));
            }
        }
        if (protocolSwitched) {
            String target = (priorProtocol != null && !priorProtocol.isEmpty()) ? priorProtocol : "0";
            try {
                String sp = channel.send("ATSP" + target, 1000);
                if (!okish(sp)) {
                    failure = chain(failure, new HeaderRestoreException(
                        "Protokol restore (ATSP" + target + ") başarısız: " + summarize(sp)));
                }
            } catch (Exception e) {
                failure = chain(failure, new HeaderRestoreException(
                    "Protokol restore (ATSP" + target + ") istisna: " + e.getMessage()));
            }
        }
        return chain(failure, restoreDefaultHeader());
    }

    /** İki restore hatasını TEK zincire birleştirir ({@code addSuppressed}) — ilk null ise ikinciyi döner. */
    private static Exception chain(Exception first, Exception second) {
        if (first == null) return second;
        if (second != null) first.addSuppressed(second);
        return first;
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
                if (pair.equals("0000")) continue;        // K-line sıfır dolgusu
                // "Kod yok" yanıtının artığını DTC sanma: pozitif yanıt SID'i + sıfır
                // sayaç ("43 00"/"47 00"/"4A 00") hizalama kayması sonucu pair'e düşerse
                // sahte C0300/C0700/C0A00 üretiyordu (araçta kod yok — Car Scanner temiz).
                // Gerçek arıza kodları etkilenmez: yalnız tam "<mode>00" kalıbı elenir.
                if (pair.equals(mode + "00")) continue;
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
