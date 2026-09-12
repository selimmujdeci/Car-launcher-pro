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

    // ── PR-OBD-KWP-RECOVER: KWP/ISO9141 ölü-oturum kendini-iyileştirme ────────────
    // KANIT (2026-07-16, Renault Trafic, BLE + KWP/5, ham trafik paneli): handshake OK
    // (0100→983B8011) SONRASI tüm Mode-01 istekleri kalıcı NO DATA; ATRV/ATH1 OK
    // (adaptör canlı). K-line oturumu düşünce ELM327 "bus init edilmiş" saymaya devam
    // eder, istekleri init'siz gönderir → ECU asla yanıtlamaz → SONSUZ NO DATA
    // (kendine gelmez; JS data-gate'i BT'yi koparıp 30-60s'lik reconnect churn'üne girer).
    // KURTARMA: ardışık N ÇEKİRDEK Mode-01 NO_DATA → ATPC (Protocol Close) → ELM327
    // bir SONRAKİ istekte otomatik taze fast-init yapar → oturum yeniden kurulur,
    // veri BT koparmadan ~1-2s'de geri akar. CAN/J1850'de tamamen pasif.

    /** initELM327'nin döndürdüğü aktif protokol (ATDPN) — kurtarma kapısı bunu okur. */
    private volatile String activeProtocol = null;

    /** Ardışık çekirdek Mode-01 NO_DATA sayacı — tüm komutlar tek executor'dan geçer (cmdQueue). */
    private int coreNoDataStreak = 0;

    /* ── LIVE_STREAM_STOP_REASON izlenebilirliği (P0 saha 2026-07-23) ──────────
     * Akış durduğunda "neden durdu" sorusu KANITLA yanıtlanmalı. Aşağıdaki alanlar
     * yalnız çekirdek Mode-01 yolunda güncellenir (ek maliyet ihmal edilebilir). */

    /** Her çekirdek istek için artan kimlik — bir durma olayını isteğe bağlar. */
    private long coreRequestSeq = 0;
    /** En son GEÇERLİ yanıt veren çekirdek PID (ör. "010C"); null = henüz yok. */
    private String lastSuccessfulPid = null;
    /** O PID'in ham ELM yanıtı — kırpılmış (log güvenliği). */
    private String lastSuccessfulResponse = null;
    /** Son geçerli paketin zamanı (epoch ms); 0 = hiç veri gelmedi. */
    private long lastGoodPacketAtMs = 0;

    /** Bu kadar ardışık çekirdek NO_DATA = oturum ölü kabul (≈2 poll turu / ~6s). */
    static final int KWP_DEAD_SESSION_THRESHOLD = 4;

    /**
     * Sayaç YALNIZ çekirdek poll PID'lerinde ilerler. EXTENDED keşif PID'leri BİLEREK
     * dışarıda: Trafic'te 39 extended'ın NO_DATA olması NORMALDİR (araç o PID'leri
     * vermiyor) — onları saymak SAĞLIKLI oturumu yanlış-pozitif ATPC ile öldürürdü.
     * Ölü oturumda çekirdek de NO_DATA döner (saha kanıtı) → doğru sinyal çekirdektir.
     */
    private static final java.util.Set<String> CORE_MODE01 = java.util.Set.of(
        "010D", "010C", "0105", "012F", "0111", "010F", "010B");

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
        coreNoDataStreak = 0; // taze oturum — kurtarma sayacı sıfırdan
        activeProtocol = new ElmInitSequencer(channel).init(protocol);
        return activeProtocol;
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
     * H-A DENEYİ (kütük #516) — {@code ATST<hex>} yanıt bekleme süresini ayarlar.
     *
     * ── NEDEN BEYAZ LİSTE, NEDEN GENEL "ham komut" DEĞİL ────────────────────
     * Projede ham komut konsolu bilinçli olarak DISABLED'dır (ticari/güvenlik).
     * Bu metot o kararı DELMEZ: yalnız {@code ATST} üretir ve parametreyi 2 haneli
     * hex'e zorlar. Çağıran keyfi AT dizesi GÖNDEREMEZ — komutun kendisi burada
     * kurulur, dışarıdan gelen tek şey iki hane sayıdır.
     *
     * ELM327: ATST değeri × 4 ms = yanıt bekleme süresi. Varsayılan 0x32 ≈ 200 ms.
     * {@code ATAT1} adaptif zamanlaması bu değeri TAVAN olarak kullanır — yani ST
     * kısaysa adaptif mod da uzun bekleyemez.
     *
     * @param stHex iki haneli hex (ör. "FF" ≈ 1020 ms, "32" ≈ 200 ms varsayılan).
     * @return ham ELM yanıtı; geçersiz parametre veya hata → null.
     */
    public String setResponseTimeout(String stHex) {
        if (stHex == null) return null;
        String v = stHex.trim().toUpperCase(java.util.Locale.ROOT);
        if (!v.matches("[0-9A-F]{2}")) return null;   // yalnız 2 hane hex — keyfi komut YOK
        try {
            return channel.send("ATST" + v, 700);
        } catch (Exception e) {
            return null;
        }
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
        return readPidClassified(pid, 1500);
    }

    /**
     * B2 (#518 denetimi) — AÇIK deadline'lı okuma.
     *
     * KÖK: sabit 1500 ms, `ATST FF` (~1020 ms) altında yalnız ~480 ms marj bırakır;
     * ECU tam da uzatmanın kazandırdığı pencerede cevap verirse BİZ kesiyoruz ve
     * deney "uzatma işe yaramadı" diye YANLIŞ ölçüyor. Çağıran deadline'ı ATST'ye
     * göre ölçekler: {@code max(1500, stMs + 600)}.
     */
    public ElmResponseParser.Result readPidClassified(String pid, int timeoutMs) {
        String p = pid.toUpperCase(java.util.Locale.ROOT);
        int t = Math.max(500, timeoutMs);
        return sendAndClassify("01" + p, t, "41", p);
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

        /**
         * P0-OBD-CORE-01B — her blok icin YAPILAN DENEME sayisi (blok sirasiyla:
         * 00,20,40,60,80,A0). 0 = blok HIC sorgulanmadi. Bu alan olmadan "bos yanit"
         * ile "hic sorulmadi" AYIRT EDILEMEZ.
         */
        public final int[] attempts;

        /**
         * Zincirin KESIN OLMAYAN bir yanit yuzunden durdugu blok indeksi
         * (0..5), yoksa -1. -1 iken zincir ya continuation=0 ile NORMAL bitti
         * ya da son bloga kadar gitti.
         */
        public final int failedBlockIndex;

        HandshakeRaw(String raw09, String raw0100, String raw0120, String raw0140,
                     String raw0160, String raw0180, String raw01A0) {
            this(raw09, raw0100, raw0120, raw0140, raw0160, raw0180, raw01A0,
                 new int[HANDSHAKE_BLOCKS.length], -1);
        }

        HandshakeRaw(String raw09, String raw0100, String raw0120, String raw0140,
                     String raw0160, String raw0180, String raw01A0,
                     int[] attempts, int failedBlockIndex) {
            this.raw09   = raw09;
            this.raw0100 = raw0100;
            this.raw0120 = raw0120;
            this.raw0140 = raw0140;
            this.raw0160 = raw0160;
            this.raw0180 = raw0180;
            this.raw01A0 = raw01A0;
            this.attempts = attempts;
            this.failedBlockIndex = failedBlockIndex;
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

        /* ═══════════════════════════════════════════════════════════════════
           P0-OBD-CORE-01B — OLCULEN KUSUR (2026-08-23):

           Eski dongu TEK satirdi:
               raws[i] = runner.run(() -> handshakeBitmapRaw(block));
               if (!handshakeHasContinuation(raws[i], block)) break;

           `handshakeBitmapRaw` -> `safeSend` ISTISNAYI YUTAR ve "" doner.
           `hasContinuationBit("")` FAIL-CLOSED olarak **false** doner.
           Sonuc: `0120` bloguna gelen TEK bir timeout / NO DATA / yarim yanit,
           `0100`in continuation biti 1 OLSA BILE zinciri sessizce BITIRIYORDU.

           Yani sahada gordugumuz `supportedCount ~= 15` iki TAMAMEN FARKLI
           gercegin ayni gorunumuydu:
             (a) ECU gercekten yalniz ilk blogu destekliyor  (continuation = 0)
             (b) CarOS ilk blokta KIRILDI                    (timeout/NO DATA)
           Urun bu ikisini AYIRT EDEMIYORDU ve (b) durumunda da "arac 15 PID
           destekliyor" diyordu - kanitsiz bir iddia.

           YENI KURAL:
             1. Yanit "KESIN" mi diye sorulur (handshakeBlockConclusive):
                  KESIN  = pozitif yanit + 4 bitmap bayti  VEYA acik negatif (7F01) VEYA "?"
                  KESIN DEGIL = bos / NO DATA / hat hatasi / yarim yanit
             2. KESIN DEGILSE blok SINIRLI SAYIDA yeniden denenir.
             3. Hala KESIN degilse zincir durur AMA `failedBlockIndex` ile
                ISARETLENIR -> ust katman "keşif EKSIK" der, "desteklenmiyor" DEMEZ.
             4. Continuation biti 0 ise zincir NORMAL biter (failedBlockIndex = -1).
             5. ONCEKI BLOKLARIN DESTEGI KORUNUR - yarida kalan zincir, o ana
                kadar okunan bloklarin PID'lerini KAYBETMEZ.

           Not: SAE J1979 sureklilik disiplini DEGISMEDI - desteklenmeyen blok
           yine HIC sorgulanmaz; yalnizca "cevap alamadim" artik "destek yok"
           SAYILMAZ.
           ═══════════════════════════════════════════════════════════════════ */
        final String[] raws = { "", "", "", "", "", "" };
        final int[] attempts = new int[HANDSHAKE_BLOCKS.length];
        int failedBlockIndex = -1;

        for (int i = 0; i < HANDSHAKE_BLOCKS.length; i++) {
            final String block = HANDSHAKE_BLOCKS[i];
            String r = "";
            for (int a = 0; a < HANDSHAKE_BLOCK_MAX_ATTEMPTS; a++) {
                r = runner.run(() -> handshakeBitmapRaw(block));
                attempts[i]++;
                if (handshakeBlockConclusive(r, block)) break;   // kesin yanit -> tekrar etme
            }
            raws[i] = r;

            if (!handshakeBlockConclusive(r, block)) {
                /* Denemeler bitti, yanit hala kesin degil. Zincir DURUR ama bu bir
                   "destek yok" KARARI DEGILDIR - kanit eksikligidir ve oyle bildirilir. */
                failedBlockIndex = i;
                break;
            }
            if (!handshakeHasContinuation(r, block)) break;      // continuation = 0 -> NORMAL bitis
        }
        return new HandshakeRaw(raw09, raws[0], raws[1], raws[2], raws[3], raws[4], raws[5],
                                attempts, failedBlockIndex);
    }

    /**
     * Bir bitmap blogu yaniti icin toplam deneme tavani (1 asil + 1 yeniden deneme).
     *
     * NEDEN 2 VE DAHA FAZLA DEGIL: her deneme {@link #HANDSHAKE_BITMAP_TIMEOUT_MS}
     * (1200 ms) kadar surebilir ve el sikismasi POLL_FAST'in (hiz/RPM 3 Hz) onune
     * GECMEZ ama hatti mesgul eder. 6 blok x 2 deneme = en kotu ~14 s; 3 deneme
     * bunu ~21 s'ye cikarir ve data-gate aclik riskini buyutur. Tavan TEK yerdedir.
     */
    public static final int HANDSHAKE_BLOCK_MAX_ATTEMPTS = 2;

    /**
     * Bu blok yaniti KESIN mi — yani "sonraki blok sorulmali mi?" sorusuna
     * KANITLA cevap verebiliyor muyuz?
     *
     * KESIN (tekrar etme):
     *  - pozitif yanit `41 &lt;blok&gt;` + EN AZ 4 bitmap bayti  -> continuation okunabilir
     *  - acik negatif yanit `7F 01 ...`                        -> arac bu blogu bilmiyor
     *  - `?`                                                    -> adaptor komutu anlamadi
     *
     * KESIN DEGIL (tekrar etmeye deger):
     *  - bos yanit / zaman asimi  -> {@code safeSend} istisnayi yutup "" dondurmus olabilir
     *  - `NO DATA`                -> ECU sustu (gecici olabilir)
     *  - hat hatasi (STOPPED / CAN ERROR / BUS ERROR ...)
     *  - yarim yanit (baslik var ama 4 bayt yok)
     *
     * SAF ve STATIC — birim testi tasima katmani olmadan cagirir.
     */
    static boolean handshakeBlockConclusive(String raw, String block) {
        if (raw == null) return false;
        final String compact = raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return false;                 // timeout / yutulmus istisna
        if (compact.equals("?")) return true;                // adaptor anlamadi - KESIN
        if (compact.contains("7F01")) return true;           // acik negatif - KESIN
        /* NO DATA ve hat hatalari BILEREK burada elenmez: asagidaki classify
           zaten OK dondurmez -> false -> yeniden denenir. */
        ElmResponseParser.Result r = ElmResponseParser.classify(raw, "41", block);
        return r.kind == ElmResponseParser.Kind.OK && r.dataHex != null && r.dataHex.length() >= 8;
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

    /**
     * P0-OBD-FINAL-01 — ECU-BAŞINA DTC, HAM YANIT VE ÖLÇÜLEN SONUÇLA.
     *
     * {@link #readDtcsFromEcu} yalnız kod listesi döndürür; "43 00 00" (POZİTİF,
     * 0 kod) ile "NO DATA" (ECU SUSTU) ve "7F 03 11" (servis yok) o sözleşmede
     * AYNI görünür. Çoklu-ECU taraması tam olarak bu üç durumu ayırmak zorundadır:
     * ayıramazsa hem "araç temiz" yalanı söyler hem de bir ECU'ya fiziksel istek
     * GİDİP GİTMEDİĞİNİ (adreslenebilirlik) ölçemez.
     *
     * KOPYA YOK: {@link #readDtcClass(String)} AYNEN kullanılır, yalnız
     * {@link #withEcuHeader} ile sarılır (header set → oku → restore ATOMİK).
     * Çağıran TEK kuyruk görevi içinde olmalıdır (mevcut sözleşme).
     */
    public DtcClassResult readDtcClassFromEcu(String tx, String rx, String mode) throws Exception {
        return withEcuHeader(tx, rx, () -> readDtcClass(mode));
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

    /** P1-OBD-02: KWP 0x18'in NRC/NO_DATA ayrımını kaybetmeyen salt-okunur biçimi. */
    public UdsEvidence readKwpDtcsDetailed() throws IOException {
        try {
            return udsRequestDetailed("1800FF00", "18", "58",
                UDS_PENDING_TOTAL_TIMEOUT_MS, "KWP DTC");
        } catch (UdsNegativeResponseException e) {
            return new UdsEvidence(null, "NEG_7F", e.nrc);
        }
    }

    /**
     * P0-OBD-DIAG-02 — ISO 14230-3 SERVIS 0x13 (readDiagnosticTroubleCodes).
     *
     * NEDEN VAR: 0x18 (ReadDTCByStatus) KWP2000'in GEC nesil servisidir. Cok
     * sayida 2000-2008 KWP ECU'su onu BILMEZ ve {@code 7F 18 11} doner; o
     * araclarda uretici arizasi YALNIZ 0x13'te okunur. Urun bugune kadar 0x13'u
     * HIC sormadi — yani o araclarda uretici DTC'si yapisal olarak GORUNMEZDI.
     *
     * ISTEK: tek bayt {@code 13} (alt fonksiyon YOK; 0x18'in status/group
     * parametreleri bu serviste BULUNMAZ — parametre eklemek NRC 0x12/0x13
     * uretirdi). POZITIF YANIT: {@code 53 <count> (<DTC hi><DTC lo><status>)*}
     * — govde bicimi 0x18 ile AYNIDIR, bu yuzden TS'te AYNI cozucu kullanilir.
     *
     * AYRISTIRMA YAPILMAZ: "53" soyulmus ham hex TS'e doner.
     * {@code withEcuHeader} blogu ICINDE cagrilmalidir (header yonetmez).
     */
    public UdsEvidence readKwpDtcs13Detailed() throws IOException {
        try {
            return udsRequestDetailed("13", "13", "53",
                UDS_PENDING_TOTAL_TIMEOUT_MS, "KWP DTC 0x13");
        } catch (UdsNegativeResponseException e) {
            return new UdsEvidence(null, "NEG_7F", e.nrc);
        }
    }

    /* ── P0-OBD-FINAL-02: KWP tanı oturumu (servis 0x10) KANIT PROBU ────────── */

    /**
     * P0-OBD-FINAL-02 — bir KWP oturum denemesinin HAM kanıtı.
     * Native KARAR VERMEZ; sınıflandırma TS'tedir ({@code kwpSessionProbe.ts}).
     */
    public static final class SessionEvidence {
        /** GERÇEKTEN gönderilen istek ("1081"/"10C0"); gönderilmediyse null. */
        public final String request;
        /** Ham yanıt (kırpılmış); yanıt alınamadıysa null — bos string YAZILMAZ. */
        public final String raw;
        /** "ok" | "negative_nrc" | "no_response" | "malformed" | "transport_error" | "not_attempted" */
        public final String outcome;
        /** Ayrik negatif yanitin NRC bayti; yoksa null. */
        public final Integer nrc;

        SessionEvidence(String request, String raw, String outcome, Integer nrc) {
            this.request = request;
            this.raw = raw;
            this.outcome = outcome;
            this.nrc = nrc;
        }
    }

    /**
     * P0-OBD-FINAL-02 — KWP2000 TANI OTURUMU PROBU (ISO 14230-4, servis 0x10).
     *
     * ── NEDEN ─────────────────────────────────────────────────────────────────
     * Sahada (Protocol 5 / KWP, ECU 7A · rx 86F17A · tx 817AF1) fonksiyonel
     * sorgular CEVAP VERİRKEN fiziksel istekler SUSUYORDU. Sessizliğin iki ayrı
     * nedeni olabilir: (a) o adreste ECU yok, (b) ECU tanı oturumu açılmadan
     * fiziksel isteğe cevap vermiyor. Bu ikisini ayırmanın TEK yolu oturum
     * komutunu KANIT olarak göndermektir.
     *
     * {@link #openExtendedSession()} bu komutları ZATEN biliyordu ama sonucunu
     * bir {@code boolean}'a düşürüp ATIYORDU ve yalnız bir NRC sonrası YAN ETKİ
     * olarak koşuyordu — hiçbir yerde kanıt olarak durmuyordu.
     *
     * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
     *  · Önce {@code 10 81} (standart tanı oturumu), pozitif kabul {@code 50 81}.
     *  · Pozitif gelmezse {@code 10 C0} (Renault/PSA genişletilmiş oturum),
     *    pozitif kabul {@code 50 C0}.
     *  · İkisi de SALT OTURUM komutudur: ECU'ya YAZMAZ, security access DEĞİLDİR.
     *  · AYRIŞTIRMA YAPILMAZ, ham hex TS'e döner (bu dosyanın felsefesi).
     *  · Retry/oturum makinesi KULLANILMAZ: prob KONTROLLÜdür, en fazla 2 komut.
     *
     * {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır (header yönetmez).
     */
    public SessionEvidence probeKwpSessionRaw() {
        SessionEvidence best = new SessionEvidence(null, null, "not_attempted", null);
        String[][] commands = { { "1081", "5081" }, { "10C0", "50C0" } };
        for (String[] c : commands) {
            SessionEvidence ev = trySessionEvidence(c[0], c[1]);
            if ("ok".equals(ev.outcome)) return ev;      // POZİTİF — daha fazla trafik üretme
            /* EN GÜÇLÜ ÖLÇÜM KAZANIR — "sonuncu" DEĞİL. Bu satır bir kanıt
               kaybını kapatır: `10 81` ayrık NEGATİF yanıt verip (adres CANLI,
               oturum RED) ardından `10 C0` sustuğunda, "sonuncu"yu döndürmek
               kanıtı `no_response`a düşürüyordu — yani "ECU cevap verdi" ölçümü
               "ECU yok" gibi rapor ediliyordu ve saha teşhisi TERSİNE dönüyordu.
               Sıralama TS ile AYNIDIR (`kwpSessionProbe._RESULT_RANK`); native
               ikinci bir semantik KURMAZ, yalnız o sözleşmeyi korur. */
            if (sessionOutcomeRank(ev.outcome) > sessionOutcomeRank(best.outcome)) best = ev;
        }
        return best;
    }

    /**
     * Oturum kanıtının GÜCÜ — {@code kwpSessionProbe.ts} içindeki
     * {@code _RESULT_RANK} ile BİREBİR aynı sıra. Yüksek olan daha güçlü kanıttır.
     *
     * Gerekçe sırası: pozitif yanıt kesin kanıttır; ayrık negatif yanıt adresin
     * CANLI olduğunu kanıtlar; çözümlenemeyen yanıt en azından bir ÖLÇÜMDÜR;
     * sessizlik ölçüm YOKLUĞUDUR; hat hatası ECU hakkında hiçbir şey söylemez;
     * hiç denenmemiş olmak en zayıfıdır.
     */
    private static int sessionOutcomeRank(String outcome) {
        if (outcome == null) return 0;
        switch (outcome) {
            case "ok":              return 5;
            case "negative_nrc":    return 4;
            case "malformed":       return 3;
            case "no_response":     return 2;
            case "transport_error": return 1;
            default:                return 0;   // not_attempted / bilinmeyen
        }
    }

    /**
     * Tek oturum komutunun HAM kanıtını üretir. ASLA throw etmez: hat hatası da
     * bir ölçümdür ({@code transport_error}) ve "ECU yok" ANLAMINA GELMEZ.
     */
    private SessionEvidence trySessionEvidence(String cmd, String positiveNeedle) {
        String raw;
        try {
            raw = sendChecked(cmd, 2000);
        } catch (Exception e) {
            return new SessionEvidence(cmd, null, "transport_error", null);
        }
        String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return new SessionEvidence(cmd, null, "no_response", null);
        if (compact.contains(positiveNeedle)) return new SessionEvidence(cmd, raw, "ok", null);
        if (compact.contains("NODATA")) return new SessionEvidence(cmd, raw, "no_response", null);
        if (compact.contains("UNABLETOCONNECT") || compact.contains("BUSERROR")
            || compact.contains("CANERROR") || compact.contains("STOPPED")
            || compact.contains("BUFFERFULL")) {
            return new SessionEvidence(cmd, raw, "transport_error", null);
        }
        int negIdx = compact.indexOf("7F10");
        if (negIdx >= 0 && compact.length() >= negIdx + 6) {
            Integer nrc = parseHexByte(compact.substring(negIdx + 4, negIdx + 6));
            return new SessionEvidence(cmd, raw, "negative_nrc", nrc);
        }
        // "?" (klon adaptör komutu anlamadı) ve tanınmayan her yanıt: ÖLÇÜLDÜ ama
        // ÇÖZÜMLENEMEDİ. "Desteklenmiyor" DİYE OKUNMAMALIDIR.
        return new SessionEvidence(cmd, raw, "malformed", null);
    }

    /**
     * P0-OBD-FINAL-02 — oturum probunu HEDEF ECU header'ı ile sarar (ATOMİK
     * set → gönder → restore). Kopya mantık YOK: {@link #withEcuHeader} aynen
     * kullanılır, böylece yanlış ECU'ya sızıntı imkânsız kalır.
     */
    public SessionEvidence probeKwpSessionFromEcu(String tx, String rx) throws Exception {
        return withEcuHeader(tx, rx, () -> probeKwpSessionRaw());
    }

    /* ── P0-OBD-DIAG-01: KWP FIZIKSEL ADRESLEME KANIT MATRISI ──────────────── */

    /** P0-OBD-DIAG-01 — tek matris satirinin HAM kaniti. Native KARAR VERMEZ. */
    public static final class AddressingEvidence {
        /** GERCEKTEN gonderilen istek; gonderilmediyse null. */
        public final String request;
        /** Ham yanit; yanit alinamadiysa null — bos string YAZILMAZ. */
        public final String raw;
        /** "ok" | "no_response" | "malformed" | "transport_error" | "init_failed" | "not_attempted" */
        public final String outcome;
        /**
         * P0-OBD-DIAG-03 — BASLATMA komutunun (ATFI/ATSI) HAM yaniti.
         *
         * Sahada iki baslatma satiri da dustu ve GEREKCE GORUNMUYORDU: adaptor
         * komutu bilmiyor mu, arac uyanmadi mi, yoksa zaman mi asildi — uc
         * TAMAMEN FARKLI teshis ve kanitsiz ayrilamaz. Bu alan olmadan
         * transport_error bir HUKUM degil, bir SIR olur.
         */
        public final String initRaw;

        AddressingEvidence(String request, String raw, String outcome) {
            this(request, raw, outcome, null);
        }

        AddressingEvidence(String request, String raw, String outcome, String initRaw) {
            this.request = request;
            this.raw = raw;
            this.outcome = outcome;
            this.initRaw = initRaw;
        }
    }

    /**
     * P0-OBD-DIAG-01 — MATRISTE HATTA CIKABILECEK SERVISLERIN KAPALI LISTESI.
     *
     * NEDEN KODDA: matrisin kendisi TS'tedir ({@code kwpAddressingProbe.ts}) ve
     * dogru yer orasidir — ama tek politika katmani, o katman bozulursa aracin
     * hafizasina destructive komut gonderilebilecegi ANLAMINA GELIR. Bu liste
     * ikinci ve SON kapidir: yalnizca OKUMA ve OTURUM servisleri gecer.
     *
     * BILINCLI OLARAK DISARIDA: 0x04 (clearDTC) · 0x11 (ECUReset) ·
     * 0x14 (clearDiagnosticInformation) · 0x27 (SecurityAccess) ·
     * 0x2E/0x3B (write) · 0x31 (routineControl) · 0x34-0x37 (transferData) ·
     * 0x2F (IOControl) · 0x85 (controlDTCSetting). Bunlar bir TANI MATRISININ
     * isi DEGILDIR ve buraya EKLENMEZ.
     */
    /* P0-VDK-F4A: paket-ozel gorunurluk — DiagnosticServiceGateTest bu kumeyi
       genel kopru beyaz listesiyle KARSILASTIRIR (iki kapi ayrisamaz). Davranis
       DEGISMEDI; yalnizca test ayni paketten okuyabilsin diye private kalkti. */
    static final java.util.Set<String> KWP_PROBE_ALLOWED_SIDS =
        java.util.Collections.unmodifiableSet(new java.util.HashSet<>(java.util.Arrays.asList(
            "01",  // currentData (destek bitmap'i)
            "03",  // storedDTC
            "07",  // pendingDTC
            "09",  // vehicleInfo
            "0A",  // permanentDTC
            "10",  // startDiagnosticSession (SALT OTURUM — yazma degil)
            "13",  // KWP readDiagnosticTroubleCodes (eski nesil)
            "17",  // KWP readStatusOfDTC
            "18",  // KWP readDTCByStatus
            "19",  // UDS readDTCInformation
            "1A",  // KWP readEcuIdentification
            "21",  // KWP readDataByLocalIdentifier
            "22"   // readDataByIdentifier
        )));

    /**
     * P0-OBD-DIAG-01 — MATRISIN TEK SATIRINI KOSAR (SALT-OKUMA).
     *
     * ── NEDEN VAR ─────────────────────────────────────────────────────────────
     * Sahada (Protocol 5 / KWP · ECU 7A · rx 86F17A) fonksiyonel sorgular cevap
     * verirken fiziksel {@code 817AF1} istekleri — DTC'ler DE, oturum probu DA —
     * susuyordu. Urun fiziksel hedefi HER ZAMAN {@code 81<src>F1} diye kuruyor;
     * ISO 14230-2'de o baytin alt alti biti VERI UZUNLUGUDUR, yani {@code 81} =
     * "fiziksel, 1 bayt". Iki baytlik {@code 10 81} ve dort baytlik
     * {@code 18 00 FF 00} icin bu uzunluk YANLISTIR. Kodun tek gerekcesi bir
     * YORUM SATIRIYDI ("ELM327 uzunlugu kendisi doldurur") ve bu iddia HIC
     * OLCULMEDI. Bu metot tahmini olcume cevirir: header ve istek CAGIRANDAN
     * gelir, native yalnizca gonderir ve HAM yaniti dondurur.
     *
     * ── SOZLESME ──────────────────────────────────────────────────────────────
     *  · Servis bayti {@link #KWP_PROBE_ALLOWED_SIDS} disindaysa istek HATTA
     *    CIKMAZ ve {@code not_attempted} doner (fail-closed ikinci kapi).
     *  · {@code ATSH<header>} → istek → varsayilan header'a RESTORE; restore
     *    {@code finally} esdegeriyle GARANTILIDIR (yanlis ECU'ya sizinti yok).
     *  · AYRISTIRMA YAPILMAZ: ham hex TS'e doner (bu dosyanin felsefesi).
     *  · Retry YOKTUR: matris KONTROLLUdur, satir basina TEK istek.
     *
     * Cagiran TEK kuyruk gorevi icinde olmalidir (mevcut sozlesme).
     */
    public AddressingEvidence probeKwpAddressingRow(String header, String request) {
        return probeKwpAddressingRow(header, request, null);
    }

    /**
     * P0-OBD-DIAG-01/2 — ayni satir, istekten ONCE K-line BASLATMA ile.
     *
     * ── NEDEN ─────────────────────────────────────────────────────────────────
     * SAHA TURU 2 (2026-08-25) olctu: kontrol satiri (fonksiyonel {@code C133F1})
     * CEVAP VERDI, bes baslatmasiz fiziksel satirin HEPSI SUSTU. Yani hat canli,
     * ATSH etkili (farkli header farkli sonuc uretti), uzunluk hipotezi ELENDI ve
     * eski servis (0x13) hipotezi ELENDI. Geriye tek aday kaldi: hat FONKSIYONEL
     * adrese (0x33) baslatildi ve bu ECU fiziksel adres icin KENDI
     * StartCommunication adimini bekliyor. ISO 14230-2 hizli baslatma ADRESE
     * OZELDIR; ELM327 {@code ATFI} onu o anki header ile yapar.
     *
     * ── RISK VE SINIR ─────────────────────────────────────────────────────────
     * Baslatma K-line'i GERCEKTEN yeniden kurar → calisan fonksiyonel oturumu
     * ANLIK boler. Bu yuzden: cagiran bunu yalniz hat canliligi OLCULDUKTEN
     * sonra ister, satir basina TEK deneme yapilir ve header HER DURUMDA restore
     * edilir. Baslatma komutu basarisiz olursa istek HIC gonderilmez
     * ({@code transport_error}) — yarim kurulmus hatta veri istemek olcum degil
     * gurultu uretir.
     *
     * @param init "FAST" → ATFI · "SLOW" → ATSI · null → baslatma YOK
     */
    public AddressingEvidence probeKwpAddressingRow(String header, String request, String init) {
        String req = request == null ? "" : request.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        String sid = req.length() >= 2 ? req.substring(0, 2) : "";
        if (req.isEmpty() || !KWP_PROBE_ALLOWED_SIDS.contains(sid)) {
            // Beyaz liste disi: hatta TEK BAYT cikmaz.
            return new AddressingEvidence(null, null, "not_attempted");
        }
        String hdr = header == null ? "" : header.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.ROOT);
        if (hdr.length() != 6) {
            return new AddressingEvidence(null, null, "not_attempted");
        }

        final String protocolDigit = queryActiveProtocolDigit();
        AddressingEvidence ev;
        try {
            String sh = channel.send("ATSH" + hdr, 500);
            if (!okish(sh)) {
                ev = new AddressingEvidence(req, null, "transport_error");
            } else if (init != null) {
                // Baslatma dustuyse istek GONDERILMEZ (yarim hatta veri istemek
                // olcum degil gurultu uretir), ama HAM YANIT MUTLAKA TASINIR:
                // gerekcesiz bir transport_error teshis edilemez.
                InitResult ir = initKLineForRow(init);
                ev = ir.ok ? sendAddressingRow(req, ir.raw)
                           : new AddressingEvidence(req, null, "init_failed", ir.raw);
            } else {
                ev = sendAddressingRow(req);
            }
        } catch (Exception e) {
            ev = new AddressingEvidence(req, null, "transport_error");
        }
        // Restore HER DURUMDA — satir dustu diye header ECU'da asili kalamaz.
        restoreKwpDefaultHeader(protocolDigit);
        return ev;
    }

    /**
     * K-line'i o anki header ile baslatir (ISO 14230-4 {@code ATFI} / ISO 9141-2
     * {@code ATSI}). ASLA throw etmez. ELM327 basarida "OK"/"BUS INIT: OK" doner;
     * "BUS INIT: ERROR" · "UNABLE TO CONNECT" · "?" BASARISIZLIKTIR ve satiri durdurur.
     */
    /** Baslatma olcumunun sonucu — karar VE ham yanit BIRLIKTE tasinir. */
    private static final class InitResult {
        final boolean ok; final String raw;
        InitResult(boolean ok, String raw) { this.ok = ok; this.raw = raw; }
    }

    private InitResult initKLineForRow(String init) {
        String cmd = "SLOW".equals(init) ? "ATSI" : "ATFI";
        String r;
        try {
            // Baslatma yavas seri hatta saniyeler surebilir (5 baud wakeup dahil).
            r = channel.send(cmd, 5000);
        } catch (Exception e) {
            String m = e.getMessage();
            return new InitResult(false, cmd + " istisna: " + (m == null ? e.getClass().getSimpleName() : m));
        }
        if (r == null) return new InitResult(false, cmd + " -> yanit YOK");
        String c = r.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        String shown = cmd + " -> " + r.trim();
        if (c.contains("ERROR") || c.contains("UNABLETOCONNECT") || c.contains("?")) {
            return new InitResult(false, shown);
        }
        boolean ok = c.contains("OK") || c.contains("BUSINIT");
        return new InitResult(ok, shown);
    }

    private AddressingEvidence sendAddressingRow(String req) {
        return sendAddressingRow(req, null);
    }

    /** Tek istegin ham kanitini uretir. ASLA throw etmez: hat hatasi da bir olcumdur. */
    private AddressingEvidence sendAddressingRow(String req, String initRaw) {
        String raw;
        try {
            raw = sendChecked(req, 2000);
        } catch (Exception e) {
            return new AddressingEvidence(req, null, "transport_error", initRaw);
        }
        String compact = raw == null ? "" : raw.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return new AddressingEvidence(req, null, "no_response", initRaw);
        if (compact.contains("NODATA")) return new AddressingEvidence(req, raw, "no_response", initRaw);
        if (compact.contains("UNABLETOCONNECT") || compact.contains("BUSERROR")
            || compact.contains("CANERROR") || compact.contains("STOPPED")
            || compact.contains("BUFFERFULL")) {
            return new AddressingEvidence(req, raw, "transport_error", initRaw);
        }
        // Pozitif mi negatif mi KARARI TS'te verilir; native yalniz "olculdu" der.
        return new AddressingEvidence(req, raw, "ok", initRaw);
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
        boolean core = cmd != null && CORE_MODE01.contains(cmd);
        if (core) coreRequestSeq++;
        try {
            String raw = sendObserved(cmd, timeoutMs);
            ElmResponseParser.Result r = ElmResponseParser.classify(raw, mode, pid);
            // Son BAŞARILI paketin künyesi — durma kaydı "en son ne çalışmıştı"yı söylesin.
            if (core) {
                if (r.kind == ElmResponseParser.Kind.OK) {
                    lastSuccessfulPid      = cmd;
                    lastSuccessfulResponse = raw == null ? null
                            : (raw.length() > 40 ? raw.substring(0, 40) : raw);
                    lastGoodPacketAtMs     = System.currentTimeMillis();
                    // Akış CANLI → sonraki durma yeniden loglanabilsin.
                    LiveStreamStopEvidence.INSTANCE.noteFlowing();
                } else {
                    // Akış DURDU — SESSİZ KALMA (protokolden bağımsız: CAN'de de yazılır).
                    // Bus-init hatası ("BUS INIT: ERROR") ayrı sebep kodu alır (saha 2026-07-23).
                    LiveStreamStopEvidence.Reason reason = isKwpBusFailure(raw)
                            ? LiveStreamStopEvidence.Reason.BUS_INIT_ERROR
                            : stopReasonOf(r.kind);
                    LiveStreamStopEvidence.INSTANCE.noteStop(
                            reason, System.currentTimeMillis(), activeProtocol,
                            coreRequestSeq, lastSuccessfulPid, lastSuccessfulResponse,
                            lastGoodPacketAtMs > 0 ? System.currentTimeMillis() - lastGoodPacketAtMs : -1,
                            coreNoDataStreak);
                }
            }
            noteKwpSessionHealth(cmd, r.kind, raw);
            return r;
        } catch (Exception e) {
            // SESSİZ EXCEPTION YASAK (P0 saha 2026-07-23): kanal hatası eskiden hiçbir
            // yere yazılmıyordu — "veri neden durdu" sorusu cevapsız kalıyordu.
            if (core) {
                LiveStreamStopEvidence.INSTANCE.noteStop(
                        e instanceof ElmPromptTimeoutException
                            ? LiveStreamStopEvidence.Reason.READ_TIMEOUT
                            : LiveStreamStopEvidence.Reason.SOCKET_ERROR, System.currentTimeMillis(),
                        activeProtocol, coreRequestSeq, lastSuccessfulPid, lastSuccessfulResponse,
                        lastGoodPacketAtMs > 0 ? System.currentTimeMillis() - lastGoodPacketAtMs : -1,
                        coreNoDataStreak);
            }
            return new ElmResponseParser.Result(
                    e instanceof ElmPromptTimeoutException
                        ? ElmResponseParser.Kind.TIMEOUT_PARTIAL
                        : ElmResponseParser.Kind.ERROR,
                    null, null);
        }
    }

    /**
     * Terminal KWP/K-line BUS-ÖLÜM sinyali mi (ATPC/reinit recovery tetiklenmeli)?
     *
     * "BUS INIT: ERROR" = ELM327 K-line/KWP bus'ını init edemedi (saha 2026-07-23, Trafic:
     * her core PID bunu döndürüyordu, adaptör AT'lere OK). Parser "BUSINIT" içerdiği için
     * Kind.BUSY sınıflar → recovery bu moda kördü. YALIN "BUS INIT" (init SÜRÜYOR, ERROR yok)
     * DÂHİL EDİLMEZ — ELM zaten deniyor; yalnız BAŞARISIZLIK formları recovery tetikler.
     */
    private static boolean isKwpBusFailure(String raw) {
        if (raw == null) return false;
        String c = raw.replaceAll("\\s+", "").toUpperCase(java.util.Locale.ROOT);
        if (c.contains("BUSINIT")) return c.contains("ERROR"); // "BUS INIT: ERROR" ✓ · yalın "BUS INIT" ✗
        return c.contains("BUSERROR") || c.contains("UNABLETOCONNECT") || c.contains("STOPPED");
    }

    /** Yanıt sınıfı → canlı akış durma sebebi. Tek eşleme noktası (tahmin YOK). */
    private static LiveStreamStopEvidence.Reason stopReasonOf(ElmResponseParser.Kind kind) {
        switch (kind) {
            case NO_DATA:         return LiveStreamStopEvidence.Reason.ECU_NO_RESPONSE;
            case TIMEOUT_PARTIAL: return LiveStreamStopEvidence.Reason.READ_TIMEOUT;
            case ERROR:           return LiveStreamStopEvidence.Reason.ELM_NO_RESPONSE;
            case BUSY:            return LiveStreamStopEvidence.Reason.SESSION_TIMEOUT;
            default:              return LiveStreamStopEvidence.Reason.UNKNOWN;
        }
    }

    /**
     * PR-OBD-KWP-RECOVER — ölü K-line oturumunu tespit edip ATPC ile kurtarır (sınıf başındaki
     * blok yoruma bakınız). YALNIZ yavaş seri protokolde (3/4/5) + YALNIZ çekirdek Mode-01
     * PID'lerinde çalışır; OK sayacı sıfırlar, NO_DATA dışındaki sınıflar (ERROR/BUSY/7F)
     * oturum kanıtı sayılmaz. Fail-soft: ATPC yanıtı önemsiz, hata yutulur (sonraki eşikte
     * yeniden denenir). Log çağrısı JVM unit testte mock'suz diye ayrıca korunur.
     */
    private void noteKwpSessionHealth(String cmd, ElmResponseParser.Kind kind, String raw) {
        if (cmd == null || !CORE_MODE01.contains(cmd) || !isSlowSerialActive()) return;
        // PR-KWP-EVID: kanıt YALNIZ bu kapının içinde toplanır → CAN/J1850'de (isSlowSerialActive
        // false) HİÇBİR alan dolmaz ve status NOT_ATTEMPTED kalır. CAN kurtarma davranışı ile
        // sıfır temas (o TS'te, ayrı motor).
        if (kind == ElmResponseParser.Kind.OK) {
            coreNoDataStreak = 0;
            // Kurtarma IN_PROGRESS idiyse burada RECOVERED'a döner + ATPC→ilk-PID süresi ölçülür.
            KwpRecoveryEvidence.INSTANCE.noteCoreOk(System.currentTimeMillis());
            return;
        }
        // ÖLÜ-OTURUM SİNYALLERİ (üçü de ATPC/reinit merdivenini tetikler):
        //  1) NO_DATA           — ECU "NO DATA" METNİ döndü.
        //  2) TIMEOUT_PARTIAL   — ECU sustu, '>' gelmedi (sessiz timeout; saha 2026-07-23).
        //  3) BUS-INIT HATASI   — "BUS INIT: ERROR" (K-line/KWP bus init BAŞARISIZ).
        // (3) KRİTİK KÖK (SAHA 2026-07-23, HAM TRAFİK): Trafic/KWP oturumu ölünce ELM327
        // NO_DATA değil "BUS INIT: ERROR" döndürüyor (~1480ms) — parser bunu Kind.BUSY
        // sınıflar. Adaptör AT'lere OK, HER core PID + 22F190 = BUS INIT: ERROR, recovery=0
        // idi: recovery bu moda TAMAMEN KÖRDÜ (yalnız transport reconnect ~2dk sonra
        // kurtarıyordu). Bus-ölüm formu (BUS INIT: ERROR / UNABLE TO CONNECT / BUS ERROR /
        // STOPPED) TAM ATPC/reinit'in düzelttiği durumdur. Yalın "BUS INIT" (init sürüyor,
        // ERROR yok) TETİKLEMEZ — ELM zaten deniyor.
        boolean deadBus = isKwpBusFailure(raw);
        if (kind != ElmResponseParser.Kind.NO_DATA
            && kind != ElmResponseParser.Kind.TIMEOUT_PARTIAL
            && !deadBus) return;
        if (kind == ElmResponseParser.Kind.NO_DATA) KwpRecoveryEvidence.INSTANCE.noteNoData();
        KwpRecoveryEvidence.INSTANCE.noteCoreNoData();
        advanceKwpFailure();
    }

    /** Tek KWP recovery otoritesindeki sessizlik eşiğini ilerletir. */
    private void advanceKwpFailure() {
        if (++coreNoDataStreak < KWP_DEAD_SESSION_THRESHOLD) return;
        coreNoDataStreak = 0;
        KwpRecoveryEvidence.INSTANCE.noteEcuSilent();
        // MERDİVEN (P0 saha 2026-07-23): ATPC tek başına Trafic/KWP oturumunu her zaman
        // diriltmiyordu → veri ~1 dk sonra tekrar bayat. Karar TEK yerde
        // (evidence.nextRecoveryAction): ilk denemelerde ATPC (hafif), ATPC tekrar tekrar
        // başarısızsa ATWS+reinit (güçlü), tavan dolunca dur. Sayaç/durum ile tutarlı.
        KwpRecoveryEvidence.RecoveryAction action =
            KwpRecoveryEvidence.INSTANCE.nextRecoveryAction(System.currentTimeMillis(), activeProtocol);
        if (action == KwpRecoveryEvidence.RecoveryAction.NONE) {
            return; // tavan doldu → kurtarma GÖNDERİLMEZ (status FAILED'a düşer)
        }
        if (action == KwpRecoveryEvidence.RecoveryAction.REINIT) {
            // GÜÇLÜ kurtarma: ATWS (warm start) + tam init (ÖĞRENİLMİŞ protokol korunur,
            // ATSP0 arama turu YOK). Soket'e dokunmaz. reinitSession kendi hatasını yutar
            // ve coreNoDataStreak'i sıfırlar; false = init tutmadı → send hatası say.
            try {
                android.util.Log.w("OBD", "[KwpRecover] ATPC yetmedi (protokol=" + activeProtocol
                    + ") → ATWS+reinit (güçlü kurtarma)");
            } catch (Throwable ignored) { /* JVM unit test: Log mock yok */ }
            if (!reinitSession()) {
                KwpRecoveryEvidence.INSTANCE.noteRecoveryFailed(KwpRecoveryEvidence.RecoveryAction.REINIT);
            }
            return;
        }
        // HAFİF kurtarma: ATPC (Protocol Close) — bir sonraki istekte taze fast-init.
        try {
            android.util.Log.w("OBD", "[KwpRecover] " + KWP_DEAD_SESSION_THRESHOLD
                + " ardışık çekirdek NO DATA (protokol=" + activeProtocol
                + ") → ATPC — oturum bir sonraki istekte yeniden kurulacak");
        } catch (Throwable ignored) { /* JVM unit test: android.util.Log mock yok */ }
        try {
            channel.send("ATPC", 500);
        } catch (Exception ignored) {
            // fail-soft — sonraki eşikte tekrar denenir. Ama SESSİZ DEĞİL: kanıta işlenir,
            // yoksa "kurtarma denendi (recoveryCount++) ama ATPC hiç gitmedi" hali raporda
            // BAŞARILI bir deneme gibi görünürdü.
            KwpRecoveryEvidence.INSTANCE.noteAtpcSendFailed();
        }
    }

    /**
     * Tüm ürün komutlarını (PID, DTC, DID) KWP timeout gözlemine bağlar. Açık NO DATA
     * yalnız çekirdek PID yolunda sayılır; desteklenmeyen DID böylece oturumu öldürmez.
     * Prompt'suz timeout ise komut türünden bağımsız gerçek session sinyalidir.
     */
    private String sendObserved(String cmd, int timeoutMs) throws Exception {
        final boolean slow = isSlowSerialActive();
        if (slow) KwpRecoveryEvidence.INSTANCE.noteCommandStarted(System.currentTimeMillis());
        try {
            return channel.send(cmd, timeoutMs);
        } catch (ElmPromptTimeoutException timeout) {
            if (slow) {
                KwpRecoveryEvidence.INSTANCE.notePromptTimeout(timeout.partial);
                KwpRecoveryEvidence.INSTANCE.noteCoreNoData();
                advanceKwpFailure();
            }
            throw timeout;
        } finally {
            if (slow) KwpRecoveryEvidence.INSTANCE.noteCommandFinished(System.currentTimeMillis());
        }
    }

    /* ══ PR-CAN-RECOVER: TS-tetiklemeli kurtarma primitifleri ═════════════════
     *
     * NEDEN TS TETİKLER: KWP/ISO9141'de kurtarma NATIVE'de otomatiktir
     * ({@link #noteKwpSessionHealth} — ardışık çekirdek NO_DATA → ATPC) ama o kapı
     * {@link #isSlowSerialActive()} ile CAN'i BİLİNÇLİ dışarıda bırakır. CAN'de ECU
     * susunca kurtarma YOKTU → manuel reset'e dek donuk (saha Doblo).
     *
     * CAN'de eşik kararını NATIVE'e koymuyoruz: "ECU sessiz" kanıtı TS'te toplanıyor
     * (transportConnected + dataFresh + ardışık doğrulama + cooldown + backoff + tavan).
     * Native yalnız KOMUTU uygular. Böylece İKİ kurtarma motoru asla aynı protokolde
     * çalışmaz (KWP → native · CAN → TS) ve çift-ATPC riski olmaz.
     *
     * İkisi de SALT OTURUM komutudur — ECU'ya YAZMAZ (write/coding/security DEĞİL).
     */

    /**
     * Basamak 1 — ATPC (Protocol Close). ELM327 bir SONRAKİ istekte protokolü TAZE kurar.
     * Transport'a dokunmaz, poll döngüsü sürer. KWP'nin native kurtarmasıyla AYNI komut,
     * yalnız tetikleyeni farklı (TS).
     *
     * @return true = komut gönderildi (ELM yanıtı önemsiz — ATPC "OK" dönmeyebilir).
     */
    public boolean protocolClose() {
        try {
            channel.send("ATPC", 500);
            // Oturum kapandı → ölü-oturum sayacı da sıfırlanmalı; aksi halde KWP tarafı
            // bayat streak ile hemen ikinci bir ATPC gönderebilirdi.
            coreNoDataStreak = 0;
            return true;
        } catch (Exception e) {
            return false; // fail-soft — TS bir sonraki basamağa geçer
        }
    }

    /**
     * Basamak 2 — kontrollü ELM yeniden init: ATWS (warm start) + tam init dizisi
     * (ATSP&lt;n&gt; dahil, ÖĞRENİLMİŞ protokol korunur → ATSP0 arama turu YOK).
     * Transport'a dokunmaz. ATPC yetmediyse ELM327 durum makinesi karışmış demektir.
     *
     * @return true = init başarılı (ATDPN protokol okundu).
     */
    public boolean reinitSession() {
        try {
            channel.send("ATWS", 1000);           // warm start — soket KAPANMAZ
            String p = initELM327(activeProtocol); // öğrenilmiş protokolle taze init
            coreNoDataStreak = 0;
            return p != null;
        } catch (Exception e) {
            return false; // fail-soft — TS son çareye (transport reconnect) geçer
        }
    }

    /** Aktif protokol yavaş seri mi (ISO 9141-2 '3' / KWP2000 '4'-'5')? CAN/J1850 → false. */
    private boolean isSlowSerialActive() {
        String p = activeProtocol;
        if (p == null || p.isEmpty()) return false;
        char c = p.charAt(0);
        return c == '3' || c == '4' || c == '5';
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
            return sendObserved(cmd, timeoutMs);
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

    /* ══ PR-CAP-2: ham yetenek kanıtı — karar TS'te ═══════════════════════════ */

    /**
     * Bir UDS/KWP veri isteğinin HAM sonucu. Native KARAR VERMEZ, yalnız kanıt taşır
     * (bu dosyanın felsefesi: "ayrıştırma yapılmaz, ham hex TS'e döner").
     * Kararı {@code capabilityOutcome.classifyElmResponse} verir.
     */
    public static final class UdsEvidence {
        /** {@code kind == "OK"} ise pozitif önek soyulmuş gövde; aksi halde null. */
        public final String data;
        /** "OK" | "NO_DATA" | "NEG_7F" — {@code ElmResponseParser.Kind} ile aynı ad uzayı. */
        public final String kind;
        /** {@code kind == "NEG_7F"} ise ECU'nun NRC baytı (0x00-0xFF); aksi halde null. */
        public final Integer nrc;
        /**
         * P0-VDK-F1B — BU İSTEK SIRASINDA VARSAYILAN DIŞI OTURUM AÇILDI MI.
         *
         * NEDEN: {@link #openExtendedSession()} NRC SESSION_REQUIRED geldiğinde
         * ZATEN çağrılıyordu ama sonucu bir boolean'a düşüp ATILIYORDU. TS
         * katmanı "bu ECU'da oturum açıldı mı" sorusunu HİÇ yanıtlayamıyordu →
         * oturum ömrü ve keepalive ihtiyacı üründe GÖRÜNMEZDİ. Keepalive'ın
         * YALNIZ kanıtlanmış oturumda çalışması için bu kanıt ŞARTTIR.
         */
        public final boolean sessionOpened;
        /** Oturumu açan komut ("1003"/"1081"/"10C0"); açılmadıysa null. */
        public final String sessionCommand;

        UdsEvidence(String data, String kind, Integer nrc) {
            this(data, kind, nrc, false, null);
        }

        UdsEvidence(String data, String kind, Integer nrc,
                    boolean sessionOpened, String sessionCommand) {
            this.data = data;
            this.kind = kind;
            this.nrc = nrc;
            this.sessionOpened = sessionOpened;
            this.sessionCommand = sessionCommand;
        }

        /** Aynı kanıtı oturum bilgisiyle zenginleştirir (diğer alanlar değişmez). */
        UdsEvidence withSession(boolean opened, String cmd) {
            return new UdsEvidence(this.data, this.kind, this.nrc, opened, cmd);
        }
    }

    /**
     * NRC TAŞIYAN negatif yanıt hatası. Bir {@link IOException}'dır → mevcut çağıranlar
     * (readUdsDtcsRaw, KWP DTC) davranış farkı GÖRMEZ; yalnız DID yolu {@link #nrc}'yi okur.
     */
    public static final class UdsNegativeResponseException extends IOException {
        /** ECU'nun NRC baytı; okunamadıysa null. */
        public final Integer nrc;

        UdsNegativeResponseException(Integer nrc, String message) {
            super(message);
            this.nrc = nrc;
        }
    }

    /**
     * PR-CAP-2 — {@link #readDataById}'nin HAM KANIT döndüren biçimi (servis "22" UDS DID /
     * "21" KWP LID). Hat/adaptör hatası (IOException) YUKARI FIRLAR: bu, araç yeteneği
     * hakkında KANIT DEĞİLDİR (TS onu 'timeout' sayar ve HİÇBİR ŞEY öğrenmez) — sessizce
     * "desteklenmiyor" öğrenmek, kopan bir kabloyu araç sınırı sanmak olurdu.
     *
     * {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır (header yönetmez).
     */
    public UdsEvidence readDataByIdDetailed(String service, String id) throws IOException {
        String s = service == null ? "22" : service;
        String d = id.toUpperCase(Locale.ROOT);
        try {
            if ("21".equals(s)) {
                return udsRequestDetailed("21" + d, "21", "61" + d, UDS_PENDING_TOTAL_TIMEOUT_MS, "LID " + d);
            }
            return udsRequestDetailed("22" + d, "22", "62" + d, UDS_PENDING_TOTAL_TIMEOUT_MS, "DID " + d);
        } catch (UdsNegativeResponseException e) {
            // FATAL NRC (ör. 0x83 engineIsNotRunning) — ECU ayrık yanıt VERDİ, kimlik muhtemelen
            // VAR. Hata olarak yutmak yerine kanıt olarak taşı → TS condition_required öğrenir.
            return new UdsEvidence(null, "NEG_7F", e.nrc);
        }
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
    /**
     * P0-VDK-F1B — SON BAŞARILI oturum komutu ("1003"/"1081"/"10C0"); yoksa null.
     * Yalnız {@link #openExtendedSession()} yazar. İkinci oturum otoritesi
     * DEĞİLDİR: karar hâlâ o metottadır, bu yalnız KANITTIR.
     */
    private volatile String lastOpenedSessionCommand = null;

    /** P0-VDK-F1B — son açılan oturum komutunun kanıtı (salt-okunur). */
    public String getLastOpenedSessionCommand() { return lastOpenedSessionCommand; }

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
            boolean ok = compact.contains(positiveNeedle);
            if (ok) lastOpenedSessionCommand = cmd;   // P0-VDK-F1B: kanıt saklanır
            return ok;
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
        // PR-CAP-2: mevcut String sözleşmesi (ve FATAL'de IOException fırlatma davranışı)
        // BİREBİR korunur — yalnız ham kanıt taşıyan dal ayrıldı. UdsNegativeResponseException
        // bir IOException'dır → eski çağıranlar (readUdsDtcsRaw, KWP DTC) fark ETMEZ.
        return udsRequestDetailed(cmd, service, positiveNeedle, totalTimeoutMs, label).data;
    }

    /**
     * PR-CAP-2 — {@link #udsRequest}'in HAM KANIT döndüren biçimi.
     *
     * KÖK PROBLEM: eski udsRequest BEŞ ayrı durumu tek {@code null}'a düşürüyordu → çağıran
     * (plugin) {@code supported:false} yapıyordu → JS tarafı hepsini KALICI "desteklenmiyor"
     * sayıyordu. Oysa:
     *   - NO DATA                  → ECU sustu (sınırlı tekrar)
     *   - NRC 0x31 requestOutOfRange → kimlik YOK (kalıcı)
     *   - NRC 0x33 securityAccessDenied → kimlik VAR, güvenlik istiyor (kapsam dışı)
     *   - NRC 0x22 conditionsNotCorrect → kimlik VAR, motor durgun (SONRA tekrar)
     * Bu ayrımlar {@link UdsEvidence#nrc} ile TS'e taşınır; KARARI TS verir
     * ({@code capabilityOutcome.classifyElmResponse}) — bu dosyanın felsefesiyle aynı:
     * "ayrıştırma yapılmaz, ham hex TS'e döner; tek doğruluk kaynağı TS".
     */
    private UdsEvidence udsRequestDetailed(String cmd, String service, String positiveNeedle,
                                           int totalTimeoutMs, String label) throws IOException {
        final long deadline = System.currentTimeMillis() + totalTimeoutMs;
        // F3-4: extended session YALNIZ BİR KEZ denenir — açıldıktan sonra hâlâ reddediliyorsa
        // servis gerçekten yok demektir (sonsuz session→retry→session döngüsü YASAK).
        boolean sessionTried = false;
        /* P0-VDK-F1B — BU İSTEK sırasında oturum açıldı mı. Kanıt TÜM dönüş
           yollarına iliştirilir; TS "oturum açıldı" bilgisini ancak böyle
           görebilir ve keepalive'ı YALNIZ o zaman başlatabilir. */
        boolean openedHere = false;
        String openedCmd = null;
        String raw = sendChecked(cmd, 2000);

        while (true) {
            String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
            if (compact.isEmpty()) throw new IOException("ELM327 yanıt vermedi (" + label + ")");
            // ECU sustu — "kimlik yok" DEĞİL (eski yorum yanıltıcıydı): bitmap destekli bir
            // PID de NO DATA verebilir (Trafic/KWP sahası). TS bunu 'no_data' olarak öğrenir.
            if (compact.contains("NODATA")) {
                return new UdsEvidence(null, "NO_DATA", null).withSession(openedHere, openedCmd);
            }

            if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
                || compact.contains("BUSERROR") || compact.contains("STOPPED")
                || compact.contains("BUFFERFULL")) {
                throw new IOException("ELM327 hata yanıtı (" + label + "): " + summarize(raw));
            }

            int negIdx = compact.indexOf("7F" + service);
            if (negIdx >= 0 && compact.length() >= negIdx + 6) {
                String nrc = compact.substring(negIdx + 4, negIdx + 6);
                Integer nrcVal = parseHexByte(nrc);
                switch (classifyNrc(nrc)) {
                    case UNSUPPORTED:
                        // PR-CAP-2: NRC KORUNUR. Eskiden 0x11/0x12/0x31 (kimlik yok → kalıcı) ile
                        // 0x33 (güvenlik → kapsam dışı) aynı null'a düşüyordu; TS ikisini artık
                        // ayırır (unsupported vs security_required).
                        return new UdsEvidence(null, "NEG_7F", nrcVal).withSession(openedHere, openedCmd);
                    case RETRY:
                        if (System.currentTimeMillis() >= deadline) {
                            throw new IOException("UDS " + describeNrc(nrc) + " zaman aşımı (" + label + ")");
                        }
                        raw = sendChecked("", 2000); // ELM327: boş komut → devam eden yanıtı bekle
                        continue;
                    case SESSION_REQUIRED:
                        // F3-4: servis var ama bu oturumda kapalı → extended session aç, TEK KEZ tekrar dene.
                        if (sessionTried || System.currentTimeMillis() >= deadline) {
                            // PR-CAP-2: oturum açıldı ama ECU yine reddetti. Bu "kimlik YOK" DEMEK
                            // DEĞİLDİR — NRC 0x22/0x24/0x7E/0x7F "koşul/oturum" ailesidir → TS bunu
                            // condition_required olarak öğrenir ve SONRA tekrar dener (eskiden
                            // kalıcı "desteklenmiyor" sayılıp sonsuza dek yasaklanıyordu).
                            return new UdsEvidence(null, "NEG_7F", nrcVal).withSession(openedHere, openedCmd);
                        }
                        sessionTried = true;
                        if (!openExtendedSession()) {
                            return new UdsEvidence(null, "NEG_7F", nrcVal); // oturum açılamadı — yine koşul ailesi
                        }
                        openedHere = true;
                        openedCmd = lastOpenedSessionCommand;
                        raw = sendChecked(cmd, 2000);   // aynı isteği yeni oturumda tekrarla
                        continue;
                    default:
                        // FATAL: NRC'yi TAŞIYAN IOException (ör. 0x83 engineIsNotRunning). Eski
                        // çağıranlar IOException yakalar → davranış AYNI; DID yolu nrc'yi okur.
                        throw new UdsNegativeResponseException(
                            nrcVal, "UDS negatif yanıt: " + describeNrc(nrc) + " (" + label + ")");
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
                if (idx >= 0) {
                    return new UdsEvidence(body.substring(idx + positiveNeedle.length()), "OK", null)
                        .withSession(openedHere, openedCmd);
                }
            }
            throw new IOException("Beklenmeyen UDS yanıtı (" + label + "): " + summarize(raw));
        }
    }

    /**
     * P0-VDK-F1C — GÖVDEDEKİ ISO-TP ÇERÇEVE SAYISI (ölçüm, tahmin değil).
     *
     * ISO 15765-2: ilk çerçeve 6 veri baytı taşır (2 bayt PCI), ardışık
     * çerçeveler 7 (1 bayt PCI). 7 bayta kadar tek çerçeve (SF) yeter.
     * Bu sayı "tuning öncesi/sonrası kaç çerçeve geldi" karşılaştırmasının
     * PAYDASIDIR; onsuz truncation ölçülemez.
     */
    public static int countIsoTpFrames(String bodyHex) {
        String h = bodyHex == null ? "" : bodyHex.replaceAll("[^0-9A-Fa-f]", "");
        int bytes = h.length() / 2;
        if (bytes <= 7) return bytes == 0 ? 0 : 1;
        return 1 + (int) Math.ceil((bytes - 6) / 7.0);
    }

    /** P0-VDK-F1C — okuma kanıtı + tuning kanıtı; ikisi AYRI taşınır. */
    public static final class TunedUdsResult {
        public final UdsEvidence uds;
        public final IsoTpTuningEvidence tuning;
        public TunedUdsResult(UdsEvidence uds, IsoTpTuningEvidence tuning) {
            this.uds = uds; this.tuning = tuning;
        }
    }

    /* ── P0-VDK-F1C: ISO-TP TRANSPORT TUNING (flow control) ─────────────────── */

    /**
     * P0-VDK-F1C — BİR ISO-TP TUNING DENEMESİNİN HAM KANITI.
     *
     * Native KARAR VERMEZ; sınıflandırma TS'tedir. Her AT komutunun yanıtı
     * AYNEN taşınır — "?" (klon desteklemiyor) ile "OK" arasındaki fark
     * ürünün görmesi gereken tek gerçektir.
     */
    public static final class IsoTpTuningEvidence {
        /** Tuning GERÇEKTEN uygulandı mı (üç komut da kabul edildi). */
        public final boolean applied;
        /** Denenen komutlar ve ham yanıtları: "ATFCSH7E0=OK|ATFCSD300000=OK|ATFCSM1=OK". */
        public final String commands;
        /** Uygulama öncesi mod (ATFCSM okunamaz — bu yüzden ÖNCEKİ mod BİLİNMEZ: "auto"). */
        public final String previousMode;
        public final String newMode;
        /** Restore GERÇEKTEN çalıştı mı — false ise adaptör kirli kalmış olabilir. */
        public final boolean restored;
        /** Restore ham yanıtı ("ATFCSM0=OK"); çalışmadıysa hata metni. */
        public final String restoreDetail;

        IsoTpTuningEvidence(boolean applied, String commands, String previousMode,
                            String newMode, boolean restored, String restoreDetail) {
            this.applied = applied;
            this.commands = commands;
            this.previousMode = previousMode;
            this.newMode = newMode;
            this.restored = restored;
            this.restoreDetail = restoreDetail;
        }
    }

    /**
     * P0-VDK-F1C — ISO-TP FLOW CONTROL AYARI.
     *
     * ══════════════════════════════════════════════════════════════════════
     * ── NE YAPILIR / NE YAPILMAZ (kod kanıtına dayalı) ───────────────────
     * ══════════════════════════════════════════════════════════════════════
     * YAPILIR: {@code ATFCSH<tx>} + {@code ATFCSD 30 00 00} + {@code ATFCSM 1}
     *   → ELM327'nin ECU'ya gönderdiği FLOW CONTROL çerçevesi kullanıcı
     *     tanımlı olur: FS=0x30 (ContinueToSend) · BS=0x00 (blok sınırı YOK)
     *     · STmin=0x00 (çerçeveler arası bekleme YOK). Uzun bir 0x19 yanıtı
     *     (20 DTC ≈ 83 bayt ≈ 13 çerçeve) böylece tek blokta ve beklemesiz akar.
     *
     * YAPILMAZ — {@code ATCAF0} (auto formatting kapatma):
     *   {@link #splitResponseBodies(String)} ELM327'nin ISO-TP BİRLEŞTİRMESİNE
     *   dayanır ("1:" / "2:" satır önekli segmentleri birleştirir). {@code ATCAF0}
     *   ISO-TP'yi tamamen bize devreder ve ham CAN çerçeveleri gelir → mevcut
     *   çözücülerin TAMAMI bozulur. Kazanç yok, risk büyük.
     *
     * YAPILMAZ — {@code ATCRA}:
     *   ZATEN {@link #setEcuHeader} tarafından ayarlanıyor ve
     *   {@link #restoreDefaultHeader()} tarafından geri alınıyor. İkinci bir
     *   otorite kurmak, o atomikliği bozardı.
     *
     * ══════════════════════════════════════════════════════════════════════
     * ── FAIL-SOFT ────────────────────────────────────────────────────────
     * ══════════════════════════════════════════════════════════════════════
     * Klon adaptörler bu komutları BİLMEZ ve "?" döner. Herhangi biri kabul
     * edilmezse tuning UYGULANMAMIŞ sayılır ({@code applied=false}) ve okuma
     * ESKİSİ GİBİ sürer — hiçbir davranış bozulmaz. Zorlama YOKTUR.
     *
     * {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır.
     */
    public IsoTpTuningEvidence applyIsoTpFlowControl(String tx) {
        StringBuilder log = new StringBuilder();
        boolean ok = true;
        try {
            ok &= _tuneCmd(log, "ATFCSH" + tx);
            /* 30 = ContinueToSend · 00 = blok boyutu sınırsız · 00 = STmin 0 ms. */
            ok &= _tuneCmd(log, "ATFCSD300000");
            /* Mod 1 = flow control mesajı ATFCSH+ATFCSD'den kurulur. */
            ok &= _tuneCmd(log, "ATFCSM1");
        } catch (Exception e) {
            log.append("|HATA=").append(e.getMessage());
            ok = false;
        }
        /* ÖNCEKİ MOD OKUNAMAZ: ELM327 ATFCSM'i geri okuma komutu SUNMAZ.
           Uydurma bir "önceki değer" yazmak yerine ÖLÇÜLEMEDİĞİ söylenir. */
        return new IsoTpTuningEvidence(ok, log.toString(), "auto (ölçülemez)",
            ok ? "user (ATFCSM1)" : "auto (uygulanamadı)", false, "henüz restore edilmedi");
    }

    /** Tek AT komutu dener; "OK" dönerse true. "?" / boş → false (fail-soft). */
    private boolean _tuneCmd(StringBuilder log, String cmd) {
        String raw;
        try {
            raw = channel.send(cmd, 500);
        } catch (Exception e) {
            if (log.length() > 0) log.append('|');
            log.append(cmd).append("=HATA");
            return false;
        }
        String c = raw == null ? "" : raw.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        boolean ok = c.contains("OK");
        if (log.length() > 0) log.append('|');
        log.append(cmd).append('=').append(ok ? "OK" : (c.isEmpty() ? "BOŞ" : summarize(raw)));
        return ok;
    }

    /**
     * P0-VDK-F1C — TUNING'İ GERİ ALIR ({@code ATFCSM 0} = otomatik mod).
     *
     * ATFCSH/ATFCSD değerleri mod 0'da KULLANILMAZ, bu yüzden onları ayrıca
     * geri almak gerekmez — modu kapatmak yeterlidir ve tek komutla en az
     * hat trafiği üretir.
     *
     * HER DURUMDA çağrılmalıdır (başarı · istisna · iptal). Restore
     * BAŞARISIZ olursa bu SESSİZ GEÇİLMEZ: sonuç kanıta yazılır.
     */
    public IsoTpTuningEvidence restoreIsoTpFlowControl(IsoTpTuningEvidence applied) {
        StringBuilder log = new StringBuilder();
        boolean ok = _tuneCmd(log, "ATFCSM0");
        return new IsoTpTuningEvidence(
            applied != null && applied.applied,
            applied == null ? "" : applied.commands,
            applied == null ? "auto (ölçülemez)" : applied.previousMode,
            ok ? "auto (restore edildi)" : "BİLİNMİYOR (restore düştü)",
            ok, log.toString());
    }

    /* ── P0-VDK-F1B: TESTER PRESENT (ISO 14229-1 servis 0x3E) ──────────────── */

    /**
     * P0-VDK-F1B — TesterPresent: AÇIK BİR TANI OTURUMUNU CANLI TUTAR.
     *
     * ══════════════════════════════════════════════════════════════════════
     * ── NEDEN `3E 00`, `3E 80` DEĞİL (ölçülebilir gerekçe) ────────────────
     * ══════════════════════════════════════════════════════════════════════
     * ISO 14229-1'de alt fonksiyon biti 0x80 (suppressPosRspMsgIndication)
     * ECU'nun POZİTİF YANIT GÖNDERMEMESİNİ ister. Bir CAN tezgâhında bu
     * doğru tercihtir (hat trafiği yarıya iner).
     *
     * ELM327 üzerinde ise TERSİNE ÇALIŞIR: adaptör her komuttan sonra yanıt
     * bekler ve yanıt gelmezse `ATST` süresi dolana kadar BEKLER. Bu üründe
     * yavaş seri hatta `ATST FF` (~1020 ms) set edilir
     * ({@code ElmInitSequencer}) — yani `3E 80` her keepalive'da hattı ~1 sn
     * BLOKLAR ve sonuç "NO DATA" olarak döner; bu da gerçek bir sessizlikten
     * AYIRT EDİLEMEZ. `3E 00` ise `7E 00` pozitif yanıtını hemen getirir:
     * hızlıdır VE keepalive'ın gerçekten ulaştığının KANITIDIR.
     *
     * Bu yüzden suppress biçimi BİLİNÇLİ OLARAK kullanılmaz.
     *
     * ══════════════════════════════════════════════════════════════════════
     * ── GÜVENLİK ─────────────────────────────────────────────────────────
     * ══════════════════════════════════════════════════════════════════════
     * `3E` ECU'ya HİÇBİR ŞEY YAZMAZ, hiçbir rutin çalıştırmaz, security
     * access DEĞİLDİR ve hiçbir yetki AÇMAZ. Tek işlevi oturum zamanlayıcısını
     * sıfırlamaktır. Bu metot destructive bir yol AÇMAZ.
     *
     * {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır (header yönetmez).
     *
     * @return kind: "OK" (7E 00 geldi) · "NEG_7F" (+nrc) · "NO_DATA" (ECU sustu)
     */
    public UdsEvidence sendTesterPresent() throws IOException {
        String raw = sendChecked("3E00", 2000);
        String compact = raw == null ? "" : raw.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty() || compact.contains("NODATA")) {
            return new UdsEvidence(null, "NO_DATA", null);
        }
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR") || compact.contains("STOPPED")) {
            throw new IOException("ELM327 hata yanıtı (TesterPresent): " + summarize(raw));
        }
        int negIdx = compact.indexOf("7F3E");
        if (negIdx >= 0 && compact.length() >= negIdx + 6) {
            return new UdsEvidence(null, "NEG_7F", parseHexByte(compact.substring(negIdx + 4, negIdx + 6)));
        }
        /* Pozitif yanıt: 0x3E + 0x40 = 0x7E. */
        if (compact.contains("7E00") || compact.contains("7E")) {
            return new UdsEvidence("7E00", "OK", null);
        }
        return new UdsEvidence(null, "NO_DATA", null);   // tanınmayan → sessizlik sayılır
    }

    /** PR-CAP-2: iki hex haneyi bayta çevirir; okunamazsa null (fail-soft). */
    private static Integer parseHexByte(String hex) {
        try {
            return Integer.parseInt(hex, 16);
        } catch (Exception e) {
            return null;
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

    /**
     * P1-OBD-02 — UDS ReadDTCInformation salt-okunur alt-fonksiyon köprüsü.
     * Yalnız kanıtlanan güvenli sorgular whitelist'tedir; clear/write/routine/security YOK.
     * 01=status availability/count, 02=status mask, 03=snapshot identification,
     * 06=DTC extended data by DTC, 0A=supported DTC.
     */
    public UdsEvidence readUdsDtcInformationDetailed(String subFunction, String payload) throws IOException {
        String sub = subFunction == null ? "" : subFunction.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.ROOT);
        String data = payload == null ? "" : payload.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.ROOT);
        if (!("01".equals(sub) || "02".equals(sub) || "03".equals(sub)
                || "06".equals(sub) || "0A".equals(sub))) {
            throw new IOException("UDS 0x19 alt-fonksiyonu salt-okunur whitelist dışında: " + sub);
        }
        if ((data.length() & 1) != 0) throw new IOException("UDS 0x19 payload bozuk hex");
        try {
            return udsRequestDetailed("19" + sub + data, "19", "59" + sub,
                UDS_PENDING_TOTAL_TIMEOUT_MS, "UDS 0x19-" + sub);
        } catch (UdsNegativeResponseException e) {
            return new UdsEvidence(null, "NEG_7F", e.nrc);
        }
    }

    /* ── P0-VDK-F4A: GENEL SALT-OKUNUR PDU YOLU ──────────────────────────────
     *
     * KOK PROBLEM: {@link #udsRequestDetailed} ZATEN genel bir istek motorudur
     * (NRC disiplini + ISO-TP birlestirme + pending/busy retry + oturum kaniti
     * TEK yerde). Ama {@code private}dir ve her genel giris servise OZEL bir
     * metottur ({@code readUdsDtcInformationDetailed} · {@code readKwpDtcsDetailed}
     * · {@code readKwpDtcs13Detailed}). Sonuc: yeni bir salt-okunur servis
     * eklemek Java'da UC yerde degisiklik ve YENI APK demekti.
     *
     * Bu metot o motoru servise ozel dal KURMADAN acar. Servis kimligine gore
     * hicbir sey secilmez; yankilanan bayt sayisi CAGIRANDAN VERI olarak gelir
     * ve olumlu yanit oneki {@code SID+0x40} evrensel kuralindan uretilir.
     *
     * GUVENLIK: {@link DiagnosticServiceGate} IKINCI ve SON kapidir. TS/CDDL
     * bozulsa bile destructive servis buradan GECEMEZ ve tek bayt HATTA CIKMAZ.
     *
     * {@code withEcuHeader} blogu ICINDE cagrilmalidir (header yonetmez). */

    /** P0-VDK-F4A — genel PDU olcumu: yanit kaniti + gecikme + gonderilen istek. */
    public static final class GenericPduEvidence {
        /** ECU yaniti; istek hic gonderilmediyse {@code kind == "NOT_SENT"}. */
        public final UdsEvidence uds;
        /** Istegin HAM hex hali (gonderilmediyse yine tasinir — kanit kaybolmaz). */
        public final String request;
        /** Beklenen olumlu yanit oneki (soyulan onek) — parity icin tasinir. */
        public final String positiveNeedle;
        /** Gonderim gecikmesi (ms); istek gitmediyse null. */
        public final Long latencyMs;
        /** Kapi gerekcesi: {@link DiagnosticServiceGate#OK} ya da DENY_* kodu. */
        public final String gate;

        GenericPduEvidence(UdsEvidence uds, String request, String positiveNeedle,
                           Long latencyMs, String gate) {
            this.uds = uds;
            this.request = request;
            this.positiveNeedle = positiveNeedle;
            this.latencyMs = latencyMs;
            this.gate = gate;
        }
    }

    /**
     * Salt-okunur bir tani PDU'sunu gonderir ve OLCULEN kaniti doner.
     *
     * @param service     servis bayti (2 hex hane)
     * @param subFunction alt fonksiyon (2 hex hane) veya null
     * @param payload     govde (cift hex hane) veya null
     * @param echoBytes   yanitta yankilanan istek bayti sayisi (0..8) — VERI
     * @return kanit; kapi reddettiyse {@code kind == "NOT_SENT"} ve gate kodu
     */
    public GenericPduEvidence sendReadOnlyPdu(String service, String subFunction,
                                              String payload, int echoBytes) throws IOException {
        final String sid = DiagnosticServiceGate.normalizeHex(service);
        final String sub = DiagnosticServiceGate.normalizeHex(subFunction);
        final String data = DiagnosticServiceGate.normalizeHex(payload);
        final String cmd = sid + sub + data;

        final String gate = DiagnosticServiceGate.judge(sid, sub, data);
        if (!DiagnosticServiceGate.OK.equals(gate)) {
            /* HATTA TEK BAYT CIKMAZ. "Desteklenmiyor" DENMEZ — arac hakkinda
               hicbir sey olculmedi; bu bir KOPRU karari, arac karari degil. */
            return new GenericPduEvidence(
                new UdsEvidence(null, "NOT_SENT", null), cmd, "", null, gate);
        }

        final String needle = DiagnosticServiceGate.positiveNeedle(sid, sub, data, echoBytes);
        final long t0 = System.currentTimeMillis();
        try {
            UdsEvidence ev = udsRequestDetailed(cmd, sid, needle,
                UDS_PENDING_TOTAL_TIMEOUT_MS, "PDU " + cmd);
            return new GenericPduEvidence(ev, cmd, needle,
                System.currentTimeMillis() - t0, DiagnosticServiceGate.OK);
        } catch (UdsNegativeResponseException e) {
            /* Mevcut salt-okunur yollarla AYNI davranis: FATAL NRC bir SONUCTUR,
               istisna degil — yoksa NRC kaniti yok olur. */
            return new GenericPduEvidence(
                new UdsEvidence(null, "NEG_7F", e.nrc), cmd, needle,
                System.currentTimeMillis() - t0, DiagnosticServiceGate.OK);
        }
    }

    /** P0-VDK-F4A — genel PDU + ISO-TP ayar kaniti (ikisi AYRI tasinir). */
    public static final class TunedGenericResult {
        public final GenericPduEvidence pdu;
        public final IsoTpTuningEvidence tuning;
        public TunedGenericResult(GenericPduEvidence pdu, IsoTpTuningEvidence tuning) {
            this.pdu = pdu; this.tuning = tuning;
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
            return parseDtcResponse(sendChecked("03", 4000), "43");
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
            return parseDtcResponse(sendChecked("07", 4000), "47");
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
            raw = sendChecked("0A", 4000);
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
     * P0-OBD-09 - TEK DTC SINIFININ ham + cozumlenmis sonucu.
     *
     * NEDEN HAM DA TASINIYOR: CAROS LAB "servis bazinda kanit" gosterir; kanit
     * yalnizca cozumlenmis kod listesi olursa, cozumleyicinin kendisi hatali
     * oldugunda (P0-OBD-09 kok nedeni tam olarak buydu) ekran o hatayi GORMEZ.
     * Ham yanit ile parse sonucu YAN YANA durmalidir.
     *
     * {@code supported == false} YALNIZ acik negatif yanit (7F) veya ELM327
     * "anlasilmadi" ("?") icin kullanilir - "NO DATA" desteklenmiyor DEMEK DEGILDIR.
     */
    public static final class DtcClassResult {
        /** ELM327 in dondurdugu HAM metin (kirpilmis). */
        public final String raw;
        /** Cozumlenmis kodlar; {@code outcome != "OK"} ise bos. */
        public final java.util.List<String> codes;
        /** ESKI sozlesme (geri-uyumluluk): acik negatif yanit / "?" degilse true. */
        public final boolean supported;
        /**
         * P0-OBD-11 - OKUMANIN OLCULEN SONUCU. {@code supported} bunu TASIYAMAZ:
         * "NO DATA" da "43 00" da eskiden {@code supported=true, codes=[]} idi.
         *
         *  - {@code OK}          : POZITIF yanit SID i (43/47/4A) geldi. Kod 0 olabilir -
         *                          bu GERCEK "kod yok"tur (ECU cevap verdi ve sayac 0).
         *  - {@code NO_RESPONSE} : "NO DATA" / bos yanit / zaman asimi -> **ECU SUSTU**.
         *                          Bu "kod yok" DEGILDIR ve asla temiz sayilamaz.
         *  - {@code UNSUPPORTED} : acik negatif yanit (7F &lt;mode&gt;) veya "?".
         *  - {@code BUS_ERROR}   : ELM/hat hatasi (STOPPED, CAN ERROR, UNABLE TO CONNECT...).
         *  - {@code NO_SID}      : yanit geldi ama icinde POZITIF SID YOK -> cozumlenemedi.
         */
        public final String outcome;
        /** Komutun uctan uca suresi (ms). */
        public final long elapsedMs;
        /** Okuma anindaki aktif ATDPN protokolu; bilinmiyorsa null. */
        public final String protocol;
        /** Okuma anindaki KWP kurtarma sayaci - tarama sirasinda recovery olduysa artar. */
        public final int recoveryCount;

        DtcClassResult(String raw, java.util.List<String> codes, boolean supported,
                       String outcome, long elapsedMs, String protocol, int recoveryCount) {
            this.raw = raw; this.codes = codes; this.supported = supported;
            this.outcome = outcome; this.elapsedMs = elapsedMs;
            this.protocol = protocol; this.recoveryCount = recoveryCount;
        }
    }

    /**
     * P0-OBD-11 - Ham yanitta POZITIF yanit SID i (43/47/4A) CIFT HIZADA var mi.
     *
     * NEDEN GEREKLI: {@link #parseDtcResponse} "kod bulamadim" ile "yanitta SID bile
     * yok" arasindaki farki DISARIYA TASIMIYOR - ikisi de bos liste doner. Bu yuzden
     * bozuk/ilgisiz bir yanit sessizce "0 kod = temiz" olarak okunuyordu.
     *
     * `contains` KULLANILMAZ: hizasiz eslesme (onceki baytin alt yarisi + sonrakinin
     * ust yarisi) sahte pozitif uretir - ayni hata sinifi #794 te olculdu.
     */
    static boolean hasPositiveDtcSid(String raw, String reply) {
        for (String body : splitResponseBodies(raw)) {
            final String h = alignBody(body);
            for (int i = 0; i + reply.length() <= h.length(); i += 2) {
                if (h.startsWith(reply, i)) return true;
            }
        }
        return false;
    }

    /** LAB kanitinda tasinan ham yanit ust siniri - bellek/log sismesin. */
    private static final int DTC_RAW_MAX = 240;

    /**
     * P0-OBD-09 - Bir DTC SINIFINI okur ve HAM yaniti da tasir.
     *
     * Mevcut {@link #readDTCs()} / {@link #readPendingDTCs()} /
     * {@link #readPermanentDTCs()} sozlesmeleri DEGISMEDI; bu metot onlarin
     * yerine GECMEZ, yanlarina EK bir kanit yolu acar. Cozumleme AYNI
     * {@link #parseDtcResponse} ile yapilir - ikinci bir cozumleyici YOK.
     *
     * @param mode "03" (onayli) | "07" (bekleyen) | "0A" (kalici)
     */
    public DtcClassResult readDtcClass(String mode) throws IOException {
        final String m = mode == null ? "03" : mode.trim().toUpperCase(Locale.ROOT);
        final String reply;
        switch (m) {
            case "07": reply = "47"; break;
            case "0A": reply = "4A"; break;
            default:   reply = "43"; break;
        }
        final long t0 = System.currentTimeMillis();
        String raw;
        try {
            raw = sendChecked(m, 4000);
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
        final long elapsed = System.currentTimeMillis() - t0;
        final int rec = KwpRecoveryEvidence.INSTANCE.snapshot().recoveryCount;
        final String trimmed = raw == null ? ""
            : (raw.length() > DTC_RAW_MAX ? raw.substring(0, DTC_RAW_MAX) : raw);
        final String compact = raw == null ? "" : raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        final java.util.List<String> none = new java.util.ArrayList<>();

        /* ═══════════════════════════════════════════════════════════════════
           P0-OBD-11 - OLCULEN KOK NEDEN (2026-08-23, saha):
           Ayni ARACTA onceki taramada P0089/BEKLEYEN gorulmustu; yeni taramada
           HIC gorunmedi ve ekran "TARAMA KAPSAMI %100 / Onayli ✓ / Bekleyen ✓"
           dedi. Sebep: **"NO DATA" BASARI SAYILIYORDU.**

             parseDtcResponse: if (compact.contains("NODATA")) return [];   // "kod yok"

           ELM327 "NO DATA" derken ECU CEVAP VERMEDI demektir (ELM kendi zaman
           asimina ugradi). GERCEKTEN temiz bir ECU "43 00" / "47 00" / "4A 00"
           yani POZITIF yanit + sayac 0 doner. Ikisi ayni sey DEGILDIR; birinde
           olcum vardir, digerinde HIC OLCUM YOKTUR.

           Eski kod ikisini de {supported=true, codes=[]} yapiyordu -> ust katman
           'ok' yaziyordu -> kapsam 3/3 = %100 -> "SISTEM TEMIZ". Yani ECU sustugu
           anda urun aracin saglikli oldugunu ILAN EDIYORDU. P0089 in kaybolmasi
           bunun dogrudan sonucudur.

           parseDtcResponse DEGISTIRILMEDI (P0-OBD-09 kilitleri aynen gecerli);
           sinif ayrimi BURADA, kanit yolunda yapilir.
           ═══════════════════════════════════════════════════════════════════ */

        /* (1) Hic yanit yok / bos -> ECU SUSTU. Istisna FIRLATILMAZ: susmak da bir
               OLCUMDUR ve kanit olarak yukari tasinmalidir (eskiden IOException
               atiliyordu ve ust katman bunu 'failed' e cevirip ayrimi kaybediyordu). */
        if (compact.isEmpty()) {
            return new DtcClassResult(trimmed, none, true, "NO_RESPONSE", elapsed, activeProtocol, rec);
        }

        /* (2) ELM komutu anlamadi. */
        if (compact.equals("?")) {
            return new DtcClassResult(trimmed, none, false, "UNSUPPORTED", elapsed, activeProtocol, rec);
        }

        /* (3) Acik negatif yanit -> mod DESTEKLENMIYOR ("NO DATA" ile AYRI). */
        if (compact.contains("7F" + m)) {
            return new DtcClassResult(trimmed, none, false, "UNSUPPORTED", elapsed, activeProtocol, rec);
        }

        /* (4) ECU SUSTU. "Kod yok" DEGILDIR - bu turun kok nedeni tam olarak budur. */
        if (compact.contains("NODATA")) {
            return new DtcClassResult(trimmed, none, true, "NO_RESPONSE", elapsed, activeProtocol, rec);
        }

        /* (5) Hat/protokol hatasi -> tarama KISMI. */
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR")     || compact.contains("BUSINIT:ERROR")
            || compact.contains("STOPPED")      || compact.contains("BUFFERFULL")
            || compact.contains("DATAERROR")    || compact.contains("RXERROR")
            || compact.contains("ERROR")) {
            return new DtcClassResult(trimmed, none, true, "BUS_ERROR", elapsed, activeProtocol, rec);
        }

        /* (6) Yanit geldi ama POZITIF SID YOK -> cozumlenemedi. Eskiden bu da
               sessizce "0 kod = temiz" oluyordu. */
        if (!hasPositiveDtcSid(raw, reply)) {
            return new DtcClassResult(trimmed, none, true, "NO_SID", elapsed, activeProtocol, rec);
        }

        /* (7) POZITIF yanit. Kod 0 olabilir - bu GERCEK "kod yok"tur. */
        try {
            return new DtcClassResult(trimmed, parseDtcResponse(raw, reply), true,
                                      "OK", elapsed, activeProtocol, rec);
        } catch (IOException e) {
            /* Kismi/bozuk yanit (ornek: sayac 3 kod diyor, govdede 1 var). Bu bir
               KAPSAM KAYBIDIR, "temiz" DEGILDIR. */
            return new DtcClassResult(trimmed, none, true, "BUS_ERROR", elapsed, activeProtocol, rec);
        }
    }

    /* == P0-OBD-10: Mode 04 (DTC HAFIZASINI SIL) - KANITLI YAZMA ==============
     *
     * -- OLCULEN KOK NEDEN (2026-08-23) --------------------------------------
     * Eski {@code clearDTCs()} TEK bir {@code raw.contains("44")} ile "silindi mi"
     * sorusunu yanitliyordu ve HAM YANITI ATIYORDU. Bunun uc olculebilir sonucu:
     *
     *  (1) "44" HIZASIZ da eslesebiliyordu. {@code contains} bir onceki baytin alt
     *      yarisi + sonrakinin ust yarisindan olusan sahte bir "44" i yakalar -
     *      ayni hata sinifi Mode 03/07 parser inde OLCULDU (bkz. dtcPayloadAfterSid).
     *      Ornek: ECU yaniti "7E8 03 7F 04 44" (NRC 0x44) -> ESKI KOD "silindi" der.
     *  (2) NO DATA / timeout / negatif yanit (7F 04 xx) / bus hatasi HEPSI ayni
     *      {@code false} a duserdi -> urun "neden silinmedi" sorusunu YANITLAYAMAZ.
     *  (3) TX/RX hicbir yerde saklanmadigi icin saha teshisi IMKANSIZDI.
     *
     * -- YENI SOZLESME -------------------------------------------------------
     * Native KARAR VERMEZ, KANIT tasir: ham yanit + sinif + NRC + protokol + sure.
     * Pozitif yanit ALGILAMASI {@link #splitResponseBodies} + CIFT HIZALI SID
     * aramasiyla yapilir (Mode 03/07/0A ile AYNI disiplin - ikinci cozumleyici YOK).
     * ======================================================================== */

    /** Mode 04 yanit bekleme suresi. ECU hafiza silme + readiness sifirlama yapar. */
    private static final int MODE04_TIMEOUT_MS = 4000;

    /** Mode 04 pozitif yanit SID i (0x04 + 0x40). */
    private static final String MODE04_POSITIVE_SID = "44";

    /**
     * Bir Mode 04 denemesinin OLCULEN sonucu. Yorum YOK - yalnizca kanit.
     *
     * {@code outcome} degerleri (TS {@code dtcClearModel} ile BIREBIR ayni sozluk):
     *  - {@code POSITIVE}    : en az bir ECU "44" pozitif yaniti verdi.
     *  - {@code NEGATIVE}    : ECU acik negatif yanit verdi (7F 04 NRC).
     *  - {@code NO_DATA}     : ELM327 "NO DATA" dondu (ECU sustu).
     *  - {@code NO_RESPONSE} : prompt gelmeden zaman asimi / bos yanit.
     *  - {@code BUS_ERROR}   : ELM327 hat/protokol hatasi (STOPPED, CAN ERROR, ...).
     *  - {@code UNSUPPORTED} : ELM327 komutu anlamadi ("?").
     *  - {@code UNKNOWN}     : yanit geldi ama hicbir sinifa girmedi (hukum YOK).
     */
    public static final class ClearResult {
        /** Hatta GERCEKTEN gonderilen komut (her zaman "04"). */
        public final String tx;
        /** ELM327 in dondurdugu HAM metin (kirpilmis). */
        public final String raw;
        /** Sonuc sinifi - yukaridaki sozluk. */
        public final String outcome;
        /** Negatif yanit kodu (2 hane hex) - yalnizca {@code NEGATIVE} iken dolu. */
        public final String nrc;
        /** Komut aninda aktif olan ATDPN protokolu; bilinmiyorsa null. */
        public final String protocol;
        /** Komutun uctan uca suresi (ms) - ECU nun ne kadar dusundugunu gosterir. */
        public final long elapsedMs;

        ClearResult(String tx, String raw, String outcome, String nrc, String protocol, long elapsedMs) {
            this.tx = tx; this.raw = raw; this.outcome = outcome;
            this.nrc = nrc; this.protocol = protocol; this.elapsedMs = elapsedMs;
        }

        /** ECU pozitif onay verdi mi. Bu TEK BASINA "kod silindi" DEMEK DEGILDIR. */
        public boolean isPositive() { return "POSITIVE".equals(outcome); }
    }

    /**
     * Mode 04 yanitini SINIFLANDIRIR. SAF ve STATIC - birim testi bunu dogrudan
     * cagirir, tasima katmani gerekmez.
     *
     * SIRA ONEMLIDIR: metin hatalari (NO DATA / ERROR / "?") hex yorumundan ONCE
     * elenir; aksi halde "NO DATA" nin icindeki D ve A harfleri hex sanilirdi.
     *
     * @return 2 elemanli dizi: {@code [outcome, nrc]} - nrc yoksa {@code null}.
     */
    static String[] classifyClearResponse(String raw) {
        if (raw == null) return new String[] { "NO_RESPONSE", null };
        final String compact = raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return new String[] { "NO_RESPONSE", null };

        /* (1) ELM327 in komutu hic anlamadigi durum. */
        if (compact.equals("?")) return new String[] { "UNSUPPORTED", null };

        /* (2) ECU sustu. "Kod silinmedi" demektir; hat hatasiyla KARISTIRILMAZ. */
        if (compact.contains("NODATA")) return new String[] { "NO_DATA", null };

        /* (3) Hat/protokol hatalari. Bunlar "ECU reddetti" DEGILDIR - hic ulasilamadi. */
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR")     || compact.contains("BUSINIT:ERROR")
            || compact.contains("STOPPED")      || compact.contains("BUFFERFULL")
            || compact.contains("DATAERROR")    || compact.contains("RXERROR")
            || compact.contains("ERROR")) {
            return new String[] { "BUS_ERROR", null };
        }

        /* (4) ACIK NEGATIF YANIT - 7F 04 <NRC>. Cift hizali aranir. */
        for (String body : splitResponseBodies(raw)) {
            final String h = alignBody(body);
            for (int i = 0; i + 6 <= h.length(); i += 2) {
                if (h.startsWith("7F04", i)) {
                    return new String[] { "NEGATIVE", h.substring(i + 4, i + 6) };
                }
            }
        }

        /* (5) POZITIF YANIT - SID 0x44, CIFT HIZADA. `contains` KULLANILMAZ:
               hizasiz eslesme sahte basari uretir (bu turun kok nedeni). */
        for (String body : splitResponseBodies(raw)) {
            final String h = alignBody(body);
            for (int i = 0; i + 2 <= h.length(); i += 2) {
                if (h.startsWith(MODE04_POSITIVE_SID, i)) {
                    return new String[] { "POSITIVE", null };
                }
            }
        }

        /* (6) Yanit geldi ama taninmadi -> HUKUM VERILMEZ. */
        return new String[] { "UNKNOWN", null };
    }

    /**
     * ATH1 acikken 11-bit CAN kimligi ("7E8") 3 HANEDIR ve govdeyi tek hane
     * kaydirir. {@link #dtcPayloadAfterSid} ile AYNI hiza duzeltmesi.
     */
    private static String alignBody(String hex) {
        if (hex == null) return "";
        return (hex.length() % 2 == 1 && hex.length() >= 3) ? hex.substring(3) : hex;
    }

    /**
     * Ariza kodlarini ve freeze-frame verisini siler (Mode 04) - KANITLI yol.
     *
     * Bu metot "silindi" DEMEZ; yalnizca ECU nun ne cevapladigini olcer.
     * "Silindi" hukmu YALNIZ silme sonrasi 03/07/0A yeniden okumasiyla,
     * TS katmaninda ({@code dtcClearModel.evaluateClearVerdict}) verilir.
     *
     * @throws IOException yalnizca TASIMA hatasi (baglanti koptu, stream kapandi).
     *                     ECU nun olumsuz cevabi ISTISNA DEGILDIR - kanit olarak doner.
     */
    public ClearResult clearDtcCodesDetailed() throws IOException {
        final long t0 = System.currentTimeMillis();
        final String raw;
        try {
            raw = sendChecked("04", MODE04_TIMEOUT_MS);
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
        final long elapsed = System.currentTimeMillis() - t0;
        final String[] cls = classifyClearResponse(raw);
        final String trimmed = raw == null ? ""
            : (raw.length() > DTC_RAW_MAX ? raw.substring(0, DTC_RAW_MAX) : raw);
        return new ClearResult("04", trimmed, cls[0], cls[1], activeProtocol, elapsed);
    }

    /**
     * Ariza kodlarini ve freeze-frame verisini siler (Mode 04) - ESKI sozlesme.
     *
     * IKINCI OTORITE KURULMADI: karar {@link #clearDtcCodesDetailed()} e delege
     * edilir; bu metot yalnizca onun pozitif/degil ozetidir.
     *
     * @return true - ECU "44" onayi dondu; false - onay yok (silinmemis sayilir).
     */
    public boolean clearDTCs() throws IOException {
        return clearDtcCodesDetailed().isPositive();
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
            String payload = dtcPayloadAfterSid(hex, mode);
            if (payload == null) continue;

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
     * P0-OBD-09 - DTC govdesinden SID ve (varsa) SAYAC baytini soyar.
     *
     * =====================================================================
     * -- OLCULEN KOK NEDEN (2026-08-23, gercek parser ciktisi) ------------
     * =====================================================================
     * Eski kod "sayac bayti var mi?" sorusunu **BAYT SAYISI PARITESIYLE
     * TAHMIN EDIYORDU** ({@code (bayt/2)%2==1 -> sayac}). Bu bir COZUMLEME
     * degil bir CIKARIMDIR ve dolgulu/cok-cerceveli her yanitta ters doner.
     * Olculdu - bekleyen P0089 (bayt {@code 00 89}) icin:
     *
     *   "47 01 00 89"          -> [P0089]             OK  (dolgusuz)
     *   "47 01 00 89 00 00 00" -> [P0100, B0900]      HATA (DOLGULU)
     *   cok-cerceveli (ISO-TP) -> [P0200, B0901, ...] HATA
     *
     * Yani urun gercek kodu KAYBETMEKLE kalmiyor, **OLMAYAN KOD URETIYORDU**
     * (P0100 "Hava Debimetre Devresi" gibi). Bu, "kanitsiz bilgi uretilmez"
     * kuralinin en derin ihlaliydi ve kullanicinin sahada gordugu kusurun
     * (baska uygulama P0089-bekliyor goruyor, CarOS gormuyor) sinifidir.
     *
     * -- YENI KURAL: TAHMIN DEGIL, DOGRULANMIS COZUMLEME -------------------
     * SAE J1979: CAN uzerinde (ISO 15765-4) SID i bir SAYAC bayti izler
     * ({@code 43 <n> <n*2 bayt>}); K-line uzerinde (ISO 9141/14230) sayac
     * YOKTUR ve cerceve basina 3 sabit DTC yuvasi sifir dolgusuyla gelir.
     *
     * Sayac yorumu KABUL EDILIR ancak DOGRULANIRSA:
     *   - n >= 1 ve govdede n*2 bayt VAR,
     *   - o n ciftin hicbiri "0000" DEGIL (gercek DTC asla 0000 olmaz),
     *   - n ciftten SONRAKI tum baytlar 0x00 (yani gercekten DOLGU),
     *   - ve govde ya DOLGULU TEK CERCEVE boyunda (SID dahil 7-8 bayt) ya da
     *     tek bir K-line cercevesine sigmayacak kadar uzun (>6 bayt -> cok
     *     cerceveli / ISO-TP birlestirilmis govde).
     * Aksi halde K-line yorumu kullanilir (tum ciftler, "0000" atlanir).
     * Tek bayt sayisi zaten yapisal olarak sayac demektir (1 + 2n her zaman tek).
     *
     * -- FAIL-CLOSED -------------------------------------------------------
     * Sayac n diyor ama govdede n kod YOKSA yanit KISMIDIR (kesilmis ISO-TP).
     * Eksik listeyi sessizce dondurmek "daha az ariza var" demektir -> istisna
     * firlatilir; ust katman bunu 'failed' kapsam olarak gosterir, "temiz"
     * SAYMAZ.
     *
     * @return SID/sayac soyulmus hex govde; SID bulunamazsa {@code null}.
     */
    static String dtcPayloadAfterSid(String hex, String mode) throws IOException {
        if (hex == null || hex.isEmpty()) return null;

        /* ATH1 acikken 11-bit CAN kimligi ("7E8") 3 HANEDIR -> govdeyi tek
           haneye kaydirir ve bayt hizasi bozulur. Tek uzunluklu govdede bastaki
           3 hane atilarak hiza geri kazanilir (29-bit kimlik 8 hanedir, zaten
           cifttir). Bu yapilmazsa asagidaki cift-hizali arama SID i bulamaz. */
        String h = (hex.length() % 2 == 1 && hex.length() >= 3) ? hex.substring(3) : hex;

        /* SID YALNIZ CIFT hizada aranir. `indexOf` hizasiz bir "47" i (onceki
           baytin alt yarisi + sonrakinin ust yarisi) yakalayip govdeyi yarim
           bayt kaydirabilirdi - bu, TUM kodlari sessizce bozardi. */
        int idx = -1;
        for (int i = 0; i + mode.length() <= h.length(); i += 2) {
            if (h.startsWith(mode, i)) { idx = i; break; }
        }
        if (idx < 0) return null;

        String body = h.substring(idx + mode.length());
        if (body.length() % 2 == 1) body = body.substring(0, body.length() - 1);
        final int bytes = body.length() / 2;
        if (bytes == 0) return "";

        final boolean oddBody = (bytes % 2) == 1;   // 1 + 2n -> yapisal olarak sayacli
        final int n = Integer.parseInt(body.substring(0, 2), 16);

        if (oddBody) {
            /* Sayac yorumu ZORUNLU. n kod sigmiyorsa yanit KISMIDIR. */
            if (n > 0 && 1 + 2 * n > bytes) {
                throw new IOException("Kismi DTC yaniti: sayac " + n
                    + " kod diyor, govdede " + ((bytes - 1) / 2) + " kod var");
            }
            return n > 0 ? body.substring(2, 2 + 4 * n) : body.substring(2);
        }

        /* Cift govde: DOLGULU CAN mi, K-line mi? Sayac yorumu DOGRULANIR. */
        if (n >= 1 && 1 + 2 * n <= bytes) {
            final String candidate = body.substring(2, 2 + 4 * n);
            final String leftover  = body.substring(2 + 4 * n);
            boolean pairsOk = true;
            for (int i = 0; i + 4 <= candidate.length(); i += 4) {
                if (candidate.startsWith("0000", i)) { pairsOk = false; break; }
            }
            boolean leftoverIsPadding = leftover.chars().allMatch(c -> c == '0');
            /* Dolgulu TEK cerceve (SID dahil 7-8 bayt) ya da tek K-line
               cercevesine (3 yuva = 6 bayt) sigmayan BIRLESTIRILMIS govde. */
            boolean shapeOk = (bytes + 1 == 7 || bytes + 1 == 8) || bytes > 6;
            if (pairsOk && leftoverIsPadding && shapeOk) return candidate;
        }

        /* K-line: sayac yok, tum ciftler kod yuvasidir ("0000" dolgu atlanir). */
        return body;
    }

    /* ══ P0-OBD-05: SAE J1979 Servis 06 — On-Board Monitoring Test Results ══ */

    /** Mode 06 yanıt bekleme süresi. Çok-çerçeveli ISO-TP alışverişi tek çerçeveden yavaştır. */
    private static final int MODE06_TIMEOUT_MS = 2500;

    /**
     * Bir Mode 06 okumasının HAM sonucu. Native KARAR VERMEZ — yalnız kanıt taşır
     * (bu dosyanın felsefesi). Sınıflandırma ve çözümleme TS'te ({@code mode06.ts}).
     */
    public static final class Mode06Evidence {
        /** {@code kind == "OK"} ise "46"+MID öneki SOYULMUŞ gövde; aksi halde null. */
        public final String data;
        /** "OK" | "NO_DATA" | "ERROR". */
        public final String kind;
        Mode06Evidence(String data, String kind) { this.data = data; this.kind = kind; }
    }

    /**
     * {@code 06 <MID>} okur. {@code withEcuHeader} bloğu İÇİNDE çağrılmalıdır
     * (header YÖNETMEZ — çağıran atomik set/restore'u sağlar).
     *
     * ── NEDEN AYRI BİR ÇÖZÜMLEYİCİ YOK ────────────────────────────────────
     * Mode 06 yanıtı CAN'de HER ZAMAN çok-çerçevelidir (tek test kaydı 9 bayt +
     * servis baytı = 10 bayt > 7). Birleştirme için MEVCUT {@link #splitResponseBodies}
     * kullanılır — ISO-TP segment önekli satırları ("0:", "1:"…) tek gövdede
     * birleştirir ve çoklu-ECU gövdelerini KARIŞTIRMAZ. İkinci birleştirici yazmak,
     * aynı hatayı iki yerde düzeltmek demek olurdu.
     *
     * NO DATA "test geçti" DEĞİLDİR — ayrı {@code kind} ile taşınır ve kararı TS verir.
     */
    public Mode06Evidence readMode06(String mid) throws IOException {
        if (mid == null) return new Mode06Evidence(null, "ERROR");
        final String m = mid.trim().toUpperCase(Locale.ROOT);
        if (!m.matches("[0-9A-F]{2}")) return new Mode06Evidence(null, "ERROR");

        final String raw = sendChecked("06" + m, MODE06_TIMEOUT_MS);
        final String compact = raw == null ? "" : raw.replaceAll("\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return new Mode06Evidence(null, "ERROR");
        if (compact.contains("NODATA")) return new Mode06Evidence(null, "NO_DATA");
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR") || compact.contains("STOPPED")
            || compact.contains("BUFFERFULL") || compact.contains("ERROR")) {
            return new Mode06Evidence(null, "ERROR");
        }
        /* Olumsuz yanıt (7F 06 NRC) — "desteklenmiyor" kanıtı; karar TS'te. */
        if (compact.contains("7F06")) return new Mode06Evidence(null, "NO_DATA");

        final String needle = "46" + m;
        for (String body : splitResponseBodies(raw)) {
            final int idx = body.indexOf(needle);
            if (idx < 0) continue;
            final String payload = body.substring(idx + needle.length());
            if (payload.isEmpty()) return new Mode06Evidence(null, "ERROR");
            return new Mode06Evidence(payload, "OK");
        }
        /* Yanıt geldi ama beklenen 46+MID başlığı YOK → bozuk/ilgisiz. "Boş sonuç"
           diye OK dönmek, sessizce "test yok" anlamına gelirdi. */
        return new Mode06Evidence(null, "ERROR");
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
