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
     * OBD-OS-F0-3: el sıkışmasının TEK bir adımını (tek ELM komutu) çalıştıran strateji.
     * Manager'lar bunu {@code step -> cmdQueue.submit(DISCOVERY, null, step).get()} olarak
     * verir → her adım AYRI kuyruk görevi olur, adımlar ARASINA POLL_FAST girebilir.
     */
    public interface HandshakeStepRunner {
        String run(java.util.concurrent.Callable<String> step) throws Exception;
    }

    /**
     * OBD el sıkışması — VIN + desteklenen-PID bitmap keşfi. HAM ELM327 yanıtlarını
     * döndürür (formül/parse YOK; TS ayrıştırır).
     *
     * OBD-OS-F0-3: zincir artık TEK atomik görev DEĞİL — her ELM komutu {@code runner}
     * üzerinden ayrı kuyruk görevi olarak çalışır. Böylece en kötü ~10 sn süren keşif,
     * hız/RPM hot-path'ini (3 Hz) aç bırakmaz; data-gate açlıktan kopmaz. Zincir MANTIĞI
     * burada TEK yerde durur (iki manager'da kopyalanmaz).
     *
     * Süreklilik-bit disiplini (SAE J1979) AYNEN korunur: bir bitmap bloğunun SON PID'i
     * (0x20/0x40/0x60/0x80/0xA0) set DEĞİLSE sonraki blok HİÇ sorgulanmaz →
     * desteklenmeyen blok poll edilmez, NO-DATA fırtınası oluşmaz.
     *
     * FAIL-SOFT: her sorgu {@link #safeSend} ile sarılır — komut düzeyinde exception
     * sızmaz. Tamamen başarısız olsa bile tüm alanları "" olan bir sonuç döner.
     *
     * @throws Exception yalnız {@code runner} kuyruk hatası (bağlantı koptu / görev iptal).
     */
    public HandshakeRaw performHandshakeRaw(HandshakeStepRunner runner) throws Exception {
        final String raw09 = runner.run(this::handshakeVinRaw);

        final String[] raws = { "", "", "", "", "", "" };
        for (int i = 0; i < HANDSHAKE_BLOCKS.length; i++) {
            final String block = HANDSHAKE_BLOCKS[i];
            raws[i] = runner.run(() -> handshakeBitmapRaw(block));
            if (!handshakeHasContinuation(raws[i], block)) break;  // süreklilik yok → zincir biter
        }
        return new HandshakeRaw(raw09, raws[0], raws[1], raws[2], raws[3], raws[4], raws[5]);
    }

    /**
     * OBD-OS-F0-3 — el sıkışması ADIM yüzeyi: her metot TEK ELM komutu çalıştırır.
     *
     * NEDEN: {@link #performHandshakeRaw} tüm zinciri (VIN + 6 bitmap bloğu, en kötü
     * ~10 sn) TEK atomik kuyruk görevinde koşuyordu. Kuyrukta ÇALIŞAN görev kesilemez
     * (ELM327 senkron protokol) → bu süre boyunca POLL_FAST (hız/RPM) tamamen aç kalıyor,
     * data-gate "veri gelmiyor" deyip bağlantıyı koparıyordu. Adımlara bölününce her
     * komut ayrı görev olur → bloklar ARASINA hot-path poll'u girebilir.
     *
     * Süreklilik-bit disiplini (SAE J1979) DEĞİŞMEZ; kararı çağıran verir
     * ({@link #handshakeHasContinuation}) — desteklenmeyen blok yine HİÇ sorgulanmaz.
     */
    public String handshakeVinRaw() {
        return safeSend("0902", HANDSHAKE_VIN_TIMEOUT_MS);
    }

    /** Tek bitmap bloğu okur. {@code block} = "00" | "20" | "40" | "60" | "80" | "A0". */
    public String handshakeBitmapRaw(String block) {
        return safeSend("01" + block, HANDSHAKE_BITMAP_TIMEOUT_MS);
    }

    /** Bu bloğun süreklilik biti set mi (→ bir sonraki blok sorgulanmalı mı)? */
    public static boolean handshakeHasContinuation(String raw, String block) {
        return hasContinuationBit(raw, "41", block);
    }

    /** Bitmap blok sırası — süreklilik zinciri bu sırayla yürür. */
    public static final String[] HANDSHAKE_BLOCKS = { "00", "20", "40", "60", "80", "A0" };

    /* ── OBD-OS-F2-3: ECU-başına DTC okuma ──────────────────────────────────── */

    /**
     * OBD-OS-F2-3 — Belirli bir ECU'dan DTC okur (Mode 03 stored / 07 pending / 0A permanent).
     *
     * Bugüne kadar DTC yalnız FONKSİYONEL adrese (7DF) soruluyordu; pratikte buna genelde
     * tek ECU (motor) cevap veriyordu → ABS/airbag/şanzıman arızaları GÖRÜNMÜYORDU.
     * Burada istek FİZİKSEL adrese ({@code tx}) gönderilir, yanıt {@code rx}'ten alınır.
     *
     * PARSE KOPYALANMAZ: mevcut {@link #readDTCs()}/{@link #readPendingDTCs()}/
     * {@link #readPermanentDTCs()} AYNEN yeniden kullanılır — yalnız ECU header'ı ile
     * SARILIR. {@link #withEcuHeader} header set → oku → restore'u ATOMİK yapar (finally ile
     * restore garantili); bu yüzden çağıran TEK kuyruk görevi içinde olmalıdır.
     *
     * @param mode "03" (onaylı) | "07" (bekleyen) | "0A" (kalıcı)
     * @return kod listesi; 0A desteklenmiyorsa null (mevcut sözleşme korunur).
     */
    public java.util.List<String> readDtcsFromEcu(String tx, String rx, String mode) throws Exception {
        return withEcuHeader(tx, rx, () -> {
            switch (mode) {
                case "07": return readPendingDTCs();
                case "0A": return readPermanentDTCs();
                default:   return readDTCs();
            }
        });
    }

    /* ── OBD-OS-F3-3: KWP2000 ReadDTCByStatus (servis 0x18) ─────────────────── */

    /**
     * OBD-OS-F3-3 — KWP2000 (ISO 14230) ReadDTCByStatus, servis 0x18.
     *
     * UDS 0x19'un KWP KARŞILIĞIDIR: KWP araçlarda (Renault Trafic, eski Fiat/Doblo, çoğu
     * 2000-2008 Avrupa aracı) üretici DTC'leri BURADA yaşar — 0x19 o araçlarda YOKTUR.
     * F1-2'nin "MIL yanıyor ama standart kod yok" uyarısının KWP tarafındaki cevabı budur.
     *
     * ISO 14230-3: istek {@code 18 <statusOfDTC> <groupHi> <groupLo>}
     *   - statusOfDTC 0x00 → filtre yok (tüm durumlar)
     *   - group 0xFF00     → tüm DTC grupları
     * Olumlu yanıt: {@code 58 <count> (<DTC hi><DTC lo><status>)*}
     *
     * KWP DTC 2 BAYTTIR (UDS'te 3) → ayrıştırma FARKLI; TS'te ayrı çözücü
     * ({@code kwpDtc.ts}). Ham hex döner ("58" SOYULMUŞ), ayrıştırma YAPILMAZ.
     *
     * @return "58" soyulmuş ham hex (count + kayıtlar); ECU 0x18'i desteklemiyorsa null.
     */
    public String readKwpDtcsRaw() throws IOException {
        return udsRequest("1800FF00", "18", "58", UDS_PENDING_TOTAL_TIMEOUT_MS, "KWP DTC");
    }

    /* ── OBD-OS-F3-5: Adaptör kimliği & yetenek probu ───────────────────────── */

    /**
     * OBD-OS-F3-5 — Adaptör kimliğini ham okur: {@code ATI} (sürüm) + {@code AT@1} (cihaz
     * tanımı) + {@code STDI} (STN-özel; gerçek ELM327'de "?" döner).
     *
     * NEDEN: "ELM327 v1.5" yazan adaptörlerin ÇOĞU klondur ve gerçek v1.5 özelliklerini
     * (ATCP 29-bit, ATCFC flow-control, yüksek throughput) TAŞIMAZ. Klonu gerçek sanmak,
     * desteklemediği komutu göndermeye ve sessiz başarısızlığa yol açar. Kimlik KANITTIR:
     * ne desteklediğini VARSAYMAK yerine SORARIZ (zero-trust).
     *
     * AYRIŞTIRMA YAPILMAZ — ham yanıtlar TS'e döner ({@code adapterCapability.ts} tek kaynak).
     * Her komut fail-soft: desteklenmeyen komut "" olur, prob asla patlamaz.
     *
     * @return "ATI|AT@1|STDI" — üç ham yanıt, '|' ile ayrılmış (boş olabilir).
     */
    public String probeAdapterIdentityRaw() {
        String ati  = safeSend("ATI",  1000);   // ör. "ELM327 v1.5"
        String at1  = safeSend("AT@1", 1000);   // cihaz tanımlayıcı (klonlarda genelde boş/'?')
        String stdi = safeSend("STDI", 1000);   // STN-özel: gerçek STN'de sürüm, ELM/klonda '?'
        return (ati == null ? "" : ati.trim()) + "|"
             + (at1 == null ? "" : at1.trim()) + "|"
             + (stdi == null ? "" : stdi.trim());
    }

    /* ── OBD-OS-F2-1: ECU keşfi (fonksiyonel prob) ──────────────────────────── */

    /** ECU probu yanıt penceresi — çok ECU'lu araçta tüm ECU'lar sırayla yanıtlar. */
    private static final int ECU_PROBE_TIMEOUT_MS = 4000;

    /**
     * OBD-OS-F2-1 — Fonksiyonel ECU probu: araçta HANGİ ECU'ların yaşadığını KANITLA bulur.
     *
     * YÖNTEM: {@code ATH1} ile yanıt başlıklarını AÇ, ardından {@code 0100}'ü FONKSİYONEL
     * adrese (7DF broadcast) gönder. ISO 15765-4'te bu isteği araçtaki HER OBD-uyumlu ECU
     * yanıtlar ve her yanıt KENDİ header'ını taşır (7E8 = motor, 7E9/7EA… = diğerleri).
     * Yani tek komutla ECU envanteri çıkar — kör adres taramasına (7E0-7EF tek tek) gerek yok.
     *
     * ZERO-TRUST: burada AYRIŞTIRMA YAPILMAZ — ham yanıt TS'e döner ({@code ecuDiscovery.ts}
     * tek doğruluk kaynağı). Yanıt vermeyen ECU envantere GİRMEZ (uydurma topoloji yok).
     *
     * HEADER RESTORE ZORUNLU: ATH1 açık kalırsa mevcut poll parser'ı her yanıtta beklenmedik
     * header görür → TÜM standart PID akışı sessizce bozulur. Bu yüzden ATH0 doğrulanır,
     * bir kez daha denenir, yine olmazsa {@link HeaderRestoreException} fırlatılır (sessiz
     * yanlış veri, açık hatadan kötüdür — bu sınıfın mevcut dürüstlük ilkesi).
     *
     * @return ham çok-satırlı ELM327 yanıtı (her satır bir ECU'nun header'lı cevabı).
     */
    public String probeEcusRaw() throws IOException {
        safeSend("ATH1", 500);
        final String raw = safeSend("0100", ECU_PROBE_TIMEOUT_MS);

        String off = safeSend("ATH0", 500);
        if (!containsOk(off)) off = safeSend("ATH0", 500);   // tek retry
        if (!containsOk(off)) {
            throw new HeaderRestoreException("ATH0 geri alınamadı — yanıt başlıkları açık kalmış olabilir (poll parse riski)");
        }
        return raw;
    }

    private static boolean containsOk(String s) {
        return s != null && s.toUpperCase(java.util.Locale.ROOT).contains("OK");
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
     * ECU adresleme atomik bloğu — tx'in uzunluğuna göre dallanır (Patch 13 + PR-OBD-KWP-1):
     *  - boş/null (VARSAYILAN oturum) → header'a HİÇ DOKUNULMAZ, action doğrudan çalışır.
     *    KWP (ISO 14230) araçta en olası başarı yolu budur: K-line'da init'li oturum zaten
     *    fonksiyonel adresle kurulu; header değiştirmek yeniden bus-init riski taşır.
     *  - 3 hex hane (standart 11-bit ISO 15765-4) → {@link #withEcuHeader11Bit} (Patch 12A,
     *    DEĞİŞMEDİ — davranış BİREBİR aynı).
     *  - 6 hex hane (KWP/ISO 3-bayt header, ör. "8110F1") → {@link #withEcuHeaderKwp}
     *    (ATSH yalnız; ATCRA CAN-only olduğu için GÖNDERİLMEZ).
     *  - 8 hex hane (29-bit genişletilmiş adresleme, ör. "18DADAF1") → {@link #withEcuHeader29Bit}
     *    (ATCP öncelik baytı + ATSP7 protokol geçişi, ROADMAP boşluk (3)).
     *
     * Bu metod {@link ElmCommandQueue}'nun TEK worker thread'i üzerinden çağrılmalıdır (ör.
     * {@code cmdQueue.submit(USER, ...)}) — böylece header ayarlama → okuma → restore ATOMİK
     * olur, araya başka bir komut giremez (tüm dallar için geçerli).
     */
    public <T> T withEcuHeader(String tx, String rx, java.util.concurrent.Callable<T> action) throws Exception {
        if (tx == null || tx.isEmpty()) {
            // Varsayılan adresleme: header set/restore YOK → restore riski de yok.
            return action.call();
        }
        if (tx.length() == 8) {
            return withEcuHeader29Bit(tx, rx, action);
        }
        if (tx.length() == 6) {
            return withEcuHeaderKwp(tx, action);
        }
        return withEcuHeader11Bit(tx, rx, action);
    }

    /**
     * PR-OBD-KWP-1 — KWP2000/ISO 9141 3-bayt header adresleme (ör. tx="8110F1": format 0x80
     * + hedef 0x10 + kaynak 0xF1; ELM327 format baytının uzunluk bitlerini KENDİSİ doldurur).
     *
     * CAN'den farkları:
     *  - {@code ATCRA} GÖNDERİLMEZ (CAN alım filtresi — K-line'da anlamsız, klonlarda "?" üretir).
     *    K-line tek kablodur; yanıt zaten istek yapılan ECU'dan gelir, rx filtresi gerekmez.
     *  - Restore hedefi 7DF DEĞİL: aktif protokole göre ISO 9141-2 → "686AF1",
     *    KWP ('4'/'5') → "C133F1" (ISO 14230-4 fonksiyonel OBD header'ı). Protokol
     *    öğrenilemezse KWP varsayılır (bu dala yalnız 6 haneli tx ile girilir → yavaş seri hat).
     *
     * Patch 12A restore yasası AYNEN geçerli: action ne olursa olsun finally-eşdeğeri restore,
     * başarısızlık {@link HeaderRestoreException} ile raporlanır (sessiz yanlış veri yasak).
     */
    private <T> T withEcuHeaderKwp(String tx, java.util.concurrent.Callable<T> action) throws Exception {
        T result = null;
        Exception primary = null;
        final String protocolDigit = queryActiveProtocolDigit();
        try {
            String sh = channel.send("ATSH" + tx, 500);
            if (!okish(sh)) {
                throw new IOException("KWP header ayarlanamadı (tx=" + tx + "): ATSH 'OK' dönmedi (" + summarize(sh) + ")");
            }
            result = action.call();
        } catch (Exception e) {
            primary = e;
        }
        Exception restoreFailure = restoreKwpDefaultHeader(protocolDigit);
        if (primary != null) {
            if (restoreFailure != null) primary.addSuppressed(restoreFailure);
            throw primary;
        }
        if (restoreFailure != null) throw restoreFailure;
        return result;
    }

    /** KWP/ISO varsayılan fonksiyonel header'a restore — protokole göre hedef seçilir. */
    private Exception restoreKwpDefaultHeader(String protocolDigit) {
        // ISO 9141-2 ('3') → 68 6A F1; KWP2000 ('4'/'5') ve bilinmeyen → C1 33 F1 (ISO 14230-4).
        String target = "3".equals(protocolDigit) ? "686AF1" : "C133F1";
        try {
            String sh = channel.send("ATSH" + target, 500);
            if (!okish(sh)) return new HeaderRestoreException("ATSH" + target + " (KWP) restore başarısız: " + summarize(sh));
            return null;
        } catch (Exception e) {
            return new HeaderRestoreException("ATSH" + target + " (KWP) restore istisna: " + e.getMessage());
        }
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
        // OBD-OS-F3-1/F3-6: ortak UDS istek motoru (aşağıda). Davranış BİREBİR korunur —
        // yalnız NRC sınıflandırması genişledi (0x21 artık retry, eskiden IOException'dı).
        return udsRequest("22" + d, "22", "62" + d, totalTimeoutMs, "DID " + d);
    }

    /**
     * PR-OBD-KWP-1 — Servis-parametrik veri tanımlayıcı okuma. {@code withEcuHeader} bloğu
     * İÇİNDE çağrılmalıdır (header yönetmez).
     *
     * KWP2000 (ISO 14230) araçlarda üretici verisi Servis 0x22'de DEĞİL, Servis 0x21'de
     * (ReadDataByLocalIdentifier, 1-bayt LID) yaşar — Renault Trafic gibi KWP araçların
     * "Mode 22 yolu başarısız" görünmesinin kök nedeni budur. Bu metot iki servisi de
     * AYNI udsRequest motorundan (NRC disiplini + pending retry + session-required + çok-satır
     * birleştirme TEK yerde) geçirir:
     *  - service "22": istek {@code 22<DID 4 hane>}, olumlu yanıt {@code 62<DID>}.
     *  - service "21": istek {@code 21<LID 2 hane>}, olumlu yanıt {@code 61<LID>}.
     *
     * @return olumlu yanıt öneki SOYULMUŞ ham data hex; desteklenmiyorsa null.
     */
    public String readDataById(String service, String id) throws IOException {
        String s = service == null ? "22" : service;
        String d = id.toUpperCase(Locale.ROOT);
        if ("21".equals(s)) {
            return udsRequest("21" + d, "21", "61" + d, UDS_PENDING_TOTAL_TIMEOUT_MS, "LID " + d);
        }
        return readDid(d);
    }

    /**
     * OBD-OS-F3-6 — UDS negatif yanıt kodu (NRC) sınıflandırması (ISO 14229-1 Tablo A.1).
     *
     * KÖK: eskiden 0x31/0x33/0x78 DIŞINDAKİ her NRC generic IOException'a düşüyordu —
     * "ECU meşgul, tekrar dene" (0x21) ile "ECU bu servisi hiç bilmiyor" (0x11) aynı
     * kefeye giriyordu. Bunlar FARKLI kararlar gerektirir: biri RETRY, diğeri KALICI
     * "desteklenmiyor". Yanlış sınıflandırma ya boşuna vazgeçmeye ya boşuna beklemeye yol açar.
     */
    enum NrcAction {
        /** Desteklenmiyor (kalıcı) → null döndür; çağıran bir daha SORMAZ. */
        UNSUPPORTED,
        /** ECU yanıtı hazırlıyor / meşgul → BEKLE ve tekrar dene (deadline'a kadar). */
        RETRY,
        /**
         * OBD-OS-F3-4: servis VAR ama AKTİF OTURUMDA yok → extended diagnostic session
         * (0x10 0x03) açıp BİR KEZ tekrar dene. Bunu "desteklenmiyor" saymak, üretici
         * DTC'lerini (0x19) okunamaz kılardı — Car Scanner'ın açtığı oturumu biz açmazsak
         * aynı araçta o "görmüyor" olurduk.
         */
        SESSION_REQUIRED,
        /** Gerçek hata → anlamlı mesajla IOException. */
        FATAL,
    }

    /** NRC → alınacak aksiyon + TR açıklama (teşhis mesajı uydurulmaz, standarttan gelir). */
    static NrcAction classifyNrc(String nrc) {
        switch (nrc) {
            // Servis/alt-fonksiyon/DID bu ECU'da YOK → bir daha sorma (kalıcı).
            case "11":  // serviceNotSupported
            case "12":  // subFunctionNotSupported
            case "31":  // requestOutOfRange
            case "33":  // securityAccessDenied (security kapsam dışı — desteklenmiyor say)
                return NrcAction.UNSUPPORTED;
            // F3-4: servis var ama bu OTURUMDA kapalı → extended session aç, tekrar dene.
            case "7E":  // subFunctionNotSupportedInActiveSession
            case "7F":  // serviceNotSupportedInActiveSession
            case "22":  // conditionsNotCorrect (bazı ECU'lar extended session'da açar)
            case "24":  // requestSequenceError (önce oturum bekleniyor)
                return NrcAction.SESSION_REQUIRED;
            // ECU meşgul / yanıt hazırlanıyor → BEKLE, tekrar dene.
            case "21":  // busyRepeatRequest
            case "78":  // responsePending
                return NrcAction.RETRY;
            default:
                return NrcAction.FATAL;
        }
    }

    /**
     * OBD-OS-F3-4 — UDS DiagnosticSessionControl (0x10 0x03): EXTENDED oturum açar.
     * Bazı ECU'lar 0x19 (üretici DTC) gibi servisleri yalnız bu oturumda verir.
     *
     * {@code withEcuHeader} bloğu İÇİNDE, hedef ECU header'ı ayarlıyken çağrılmalıdır.
     * TesterPresent (0x3E) GEREKMEZ: oturum + istek AYNI atomik kuyruk görevinde ardışık
     * çalışır → ECU'nun S3 oturum zaman aşımı (tipik 5 sn) penceresine girilmez.
     *
     * @return true = oturum açıldı (olumlu yanıt 50 xx); false = ECU açamadı/desteklemiyor.
     */
    public boolean openExtendedSession() {
        // PR-OBD-KWP-1: protokol-farkındalı oturum seçimi. CAN/UDS → 10 03 (extended).
        // KWP/ISO9141 → önce 10 81 (ISO 14230-4 standart tanı oturumu), olmazsa 10 C0
        // (birçok Renault/PSA KWP ECU'sunun genişletilmiş oturumu). Hepsi SALT oturum
        // komutudur (ECU'ya yazmaz, security access değildir) — güvenli.
        String digit = queryActiveProtocolDigit();
        boolean slowSerial = "3".equals(digit) || "4".equals(digit) || "5".equals(digit);
        if (!slowSerial) return trySessionCommand("1003", "5003");
        return trySessionCommand("1081", "5081") || trySessionCommand("10C0", "50C0");
    }

    /** Tek oturum komutu dener — olumlu yanıt öneki görülürse true (fail-soft). */
    private boolean trySessionCommand(String cmd, String positiveNeedle) {
        try {
            String raw = sendChecked(cmd, 2000);
            String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
            return compact.contains(positiveNeedle);
        } catch (Exception e) {
            return false;   // fail-soft: oturum açılamadı → çağıran mevcut sonuca döner
        }
    }

    /** NRC'nin insan-okunur karşılığı (log/teşhis; uydurma yok — ISO 14229-1). */
    static String describeNrc(String nrc) {
        switch (nrc) {
            case "11": return "serviceNotSupported (ECU bu servisi bilmiyor)";
            case "12": return "subFunctionNotSupported";
            case "13": return "incorrectMessageLengthOrInvalidFormat";
            case "21": return "busyRepeatRequest (ECU meşgul)";
            case "22": return "conditionsNotCorrect (ön koşul sağlanmadı — ör. motor durumu)";
            case "24": return "requestSequenceError (önce oturum/ön adım gerekiyor)";
            case "31": return "requestOutOfRange (bu DID/DTC aralığı yok)";
            case "33": return "securityAccessDenied (güvenlik erişimi gerekiyor)";
            case "35": return "invalidKey";
            case "36": return "exceedNumberOfAttempts";
            case "37": return "requiredTimeDelayNotExpired (bekleme süresi dolmadı)";
            case "78": return "responsePending (ECU yanıtı hazırlıyor)";
            default:   return "NRC 0x" + nrc;
        }
    }

    /**
     * OBD-OS-F3-1/F3-6 — Ortak UDS istek motoru. {@link #readDid} ve {@link #readUdsDtcsRaw}
     * bunun üstünde çalışır (NRC disiplini + ISO-TP birleştirme + pending/busy retry TEK yerde;
     * kopya mantık YOK). {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır (header yönetmez).
     *
     * @param cmd            ham istek ("22F190" / "1902FF")
     * @param service        servis baytı ("22" / "19") — negatif yanıt eşleşmesi (7F&lt;service&gt;) için
     * @param positiveNeedle olumlu yanıt öneki ("62F190" / "5902") — gövde bunun ARDINDAN başlar
     * @param label          hata mesajlarında geçecek bağlam ("DID F190" / "UDS DTC")
     * @return {@code positiveNeedle} SOYULMUŞ ham hex gövde; desteklenmiyorsa null.
     */
    private String udsRequest(String cmd, String service, String positiveNeedle,
                              int totalTimeoutMs, String label) throws IOException {
        final long deadline = System.currentTimeMillis() + totalTimeoutMs;
        // F3-4: extended session YALNIZ BİR KEZ denenir — açıldıktan sonra hâlâ reddediliyorsa
        // servis gerçekten yok demektir (sonsuz session→retry→session döngüsü YASAK).
        boolean sessionTried = false;
        String raw = sendChecked(cmd, 2000);

        while (true) {
            String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
            if (compact.isEmpty()) throw new IOException("ELM327 yanıt vermedi (" + label + ")");
            if (compact.contains("NODATA")) return null; // ECU isteği hiç tanımıyor → desteklenmiyor

            if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
                || compact.contains("BUSERROR") || compact.contains("STOPPED")
                || compact.contains("BUFFERFULL")) {
                throw new IOException("ELM327 hata yanıtı (" + label + "): " + summarize(raw));
            }

            int negIdx = compact.indexOf("7F" + service);
            if (negIdx >= 0 && compact.length() >= negIdx + 6) {
                String nrc = compact.substring(negIdx + 4, negIdx + 6);
                switch (classifyNrc(nrc)) {
                    case UNSUPPORTED:
                        return null;
                    case RETRY:
                        if (System.currentTimeMillis() >= deadline) {
                            throw new IOException("UDS " + describeNrc(nrc) + " zaman aşımı (" + label + ")");
                        }
                        raw = sendChecked("", 2000); // ELM327: boş komut → devam eden yanıtı bekle
                        continue;
                    case SESSION_REQUIRED:
                        // F3-4: servis var ama bu oturumda kapalı → extended session aç, TEK KEZ tekrar dene.
                        if (sessionTried || System.currentTimeMillis() >= deadline) {
                            return null;   // oturum açıldı ama yine reddetti → gerçekten desteklenmiyor
                        }
                        sessionTried = true;
                        if (!openExtendedSession()) {
                            return null;   // ECU extended session'ı da açamadı → desteklenmiyor say
                        }
                        raw = sendChecked(cmd, 2000);   // aynı isteği yeni oturumda tekrarla
                        continue;
                    default:
                        throw new IOException("UDS negatif yanıt: " + describeNrc(nrc) + " (" + label + ")");
                }
            }

            if (compact.contains("SEARCHING") || compact.contains("BUSINIT")) {
                if (System.currentTimeMillis() >= deadline) {
                    throw new IOException("ELM327 arama zaman aşımı (" + label + ")");
                }
                raw = sendChecked("", 2000);
                continue;
            }
            if (compact.equals("?")) throw new IOException("ELM327 komutu anlaşılmadı (" + label + ")");

            for (String body : splitResponseBodies(raw)) {
                int idx = body.indexOf(positiveNeedle);
                if (idx >= 0) return body.substring(idx + positiveNeedle.length());
            }
            throw new IOException("Beklenmeyen UDS yanıtı (" + label + "): " + summarize(raw));
        }
    }

    /* ── OBD-OS-F3-1: UDS Service 0x19 (ReadDTCInformation) ─────────────────── */

    /** UDS 0x19-02 varsayılan status maskesi: "onaylı VEYA test başarısız" (0xFF = tümü). */
    public static final String UDS_DTC_MASK_ALL = "FF";

    /**
     * OBD-OS-F3-1 — UDS Service 0x19-02 (reportDTCByStatusMask): ÜRETİCİ-ÖZEL DTC'leri okur.
     *
     * NEDEN KRİTİK: standart Mode 03/07/0A yalnız emisyonla ilgili (P0…) kodları döner.
     * Renault DF…, VAG, BMW vb. üretici kodları BURADA yaşar — F1-2'nin "MIL yanıyor ama
     * standart kod yok" uyarısının cevabı tam olarak bu servistir. Car Scanner'ın gördüğü,
     * bizim göremediğimiz kodlar.
     *
     * ISO 14229-1: istek {@code 19 02 <statusMask>}, olumlu yanıt {@code 59 02 <availabilityMask>
     * (<DTC 3 bayt> <status 1 bayt>)*}. AYRIŞTIRMA YAPILMAZ — ham hex TS'e döner
     * ({@code udsDtc.ts} tek doğruluk kaynağı; handshake/probe ile aynı felsefe).
     *
     * {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır (hangi ECU'ya sorulduğu çağıranın kararı).
     *
     * @return "5902" SOYULMUŞ ham hex (availabilityMask + DTC kayıtları); ECU 0x19'u
     *         desteklemiyorsa null (NRC 0x11/0x12/0x31 → UNSUPPORTED).
     */
    public String readUdsDtcsRaw(String statusMask) throws IOException {
        String mask = (statusMask == null || statusMask.isEmpty())
            ? UDS_DTC_MASK_ALL
            : statusMask.toUpperCase(Locale.ROOT);
        return udsRequest("1902" + mask, "19", "5902", UDS_PENDING_TOTAL_TIMEOUT_MS, "UDS DTC");
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
