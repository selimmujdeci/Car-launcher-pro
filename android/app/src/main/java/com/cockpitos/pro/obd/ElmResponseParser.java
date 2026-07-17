package com.cockpitos.pro.obd;

import java.util.Locale;

/**
 * ElmResponseParser — ELM327 / SAE J1979 ham yanıt SINIFLANDIRMASI (Patch 4).
 *
 * KÖK NEDEN: eski PID okuyucular ({@code ElmProtocol.readPID_*}) yalnızca
 * {@code indexOf("41XX")} arıyordu — 7F (negatif ECU yanıtı), STOPPED, BUS INIT,
 * BUFFER FULL, CAN ERROR gibi ELM327/ECU hata sınıfları hiç ayrışmıyor, hepsiyle
 * "41XX bulunamadı" aynı şekilde -1 (sessizce "desteklenmiyor") sayılıyordu.
 * RfcommChannel/GattChannel.send() de timeout'ta ne oldu bilgisini kaybederek
 * kısmi/boş yanıtı sessizce döndürüyordu.
 *
 * Bu sınıf METİN İÇERİĞİNDEN sınıflandırma yapar (channel sözleşmesi DEĞİŞMEDİ —
 * {@link ElmCommandChannel#send} imzası ve davranışı aynı): boş/tanınmayan/eksik
 * bir yanıt TIMEOUT_PARTIAL sayılır (muhtemelen deadline dolarken yarım kalmış
 * bayt akışı); "NO DATA" metni NO_DATA; "SEARCHING.../BUS INIT" BUSY; 7F<mode>
 * NEG_7F; STOPPED/BUFFER FULL/CAN ERROR/BUS ERROR ERROR sayılır.
 *
 * DAVRANIŞ KORUMASI (Zero-Change): OK durumunda döndürülen {@code dataHex},
 * eski {@code indexOf("41XX")} + {@code substring(idx+4, ...)} ile TAM AYNI baytları
 * verir (İLK eşleşen blok — çok-ECU'da "en iyi" ECU seçimi YAPILMAZ, bu bilinçli
 * bir kapsam dışı bırakmadır: PID parse formülleri birebir korunmalı). PID
 * FORMÜLLERİ bu sınıfa hiç taşınmadı — ElmProtocol'de aynen kalır.
 */
public final class ElmResponseParser {

    /** Sınıflandırılmış sonuç türü. */
    public enum Kind {
        /** Beklenen mode+pid veri bloğu bulundu — {@link Result#dataHex} geçerli. */
        OK,
        /** ELM327 "NO DATA" — ECU bu PID'i desteklemiyor / yanıt vermedi (ARIZA DEĞİL). */
        NO_DATA,
        /** "SEARCHING..." / "BUS INIT..." — protokol/ECU araması sürüyor. */
        BUSY,
        /** "7F <mode> <NRC>" — ECU'nun ayrık NEGATİF yanıtı (Mode desteklenmiyor / koşul sağlanmadı). */
        NEG_7F,
        /** "STOPPED" / "BUFFER FULL" / "CAN ERROR" / "BUS ERROR" / "UNABLE TO CONNECT" / "?" — donanım/protokol hatası. */
        ERROR,
        /** Boş veya tanınmayan/eksik yanıt — muhtemelen iletişim timeout'u (yarım kalmış bayt akışı). */
        TIMEOUT_PARTIAL,
    }

    /** Sınıflandırma sonucu — değişmez (immutable). */
    public static final class Result {
        public final Kind kind;
        /** Kind.OK ise mode+pid'den SONRAKİ ham hex baytlar (boşluksuz, büyük harf); değilse null. */
        public final String dataHex;
        /** Ham (trim edilmiş) yanıt — teşhis/loglama için. */
        public final String raw;
        /**
         * PR-CAP-2: {@link Kind#NEG_7F} ise ECU'nun NRC baytı (ISO 14229-1 Tablo A.1,
         * ör. 0x31 requestOutOfRange / 0x33 securityAccessDenied / 0x22 conditionsNotCorrect);
         * diğer kind'lerde VEYA NRC okunamadıysa null.
         *
         * NEDEN: NRC olmadan "araç bu kimliği HİÇ tanımıyor" (0x31 → kalıcı) ile "motor
         * çalışınca okunur" (0x22 → geçici) ve "güvenlik gerekli" (0x33) AYIRT EDİLEMEZ.
         * Eskiden bu bayt ATILIYORDU → JS tarafı `supported:false` gelen her kimliği KALICI
         * kara listeye alıyordu → koşula bağlı bir DID sonsuza dek yasaklanıyordu.
         */
        public final Integer nrc;

        Result(Kind kind, String dataHex, String raw) {
            this(kind, dataHex, raw, null);
        }

        Result(Kind kind, String dataHex, String raw, Integer nrc) {
            this.kind = kind;
            this.dataHex = dataHex;
            this.raw = raw;
            this.nrc = nrc;
        }
    }

    private ElmResponseParser() { /* yalnız statik metodlar */ }

    /**
     * ATDPN yanıtından tek haneli aktif protokol numarasını çıkarır (Patch 3 {@link ElmInitSequencer}
     * + Patch 13 {@link ElmProtocol#withEcuHeader} 29-bit yolu PAYLAŞIR — kopyalama yok, tek
     * doğruluk kaynağı). ELM327 ATDPN "A6" (otomatik-tespit + protokol 6) veya "6" (manuel
     * zorlanmış) döner — yalnız SON hane okunur; harf kodları (A/B/C, CAN-ötesi protokoller)
     * zararsızca yoksayılır (null döner, çağıran otomatik/varsayılan davranışa düşer).
     *
     * @param rawDpnResponse channel.send("ATDPN", ...) sonucu (null/boş olabilir).
     * @return tek karakter protokol numarası ("0"-"9"); okunamaz/boş/harf-koduysa null.
     */
    public static String parseActiveProtocolDigit(String rawDpnResponse) {
        if (rawDpnResponse == null) return null;
        String compact = rawDpnResponse.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (compact.isEmpty()) return null;
        char last = compact.charAt(compact.length() - 1);
        return Character.isDigit(last) ? String.valueOf(last) : null;
    }

    /**
     * SAE J1979 pozitif yanıt önekinden (ör. "41") ORİJİNAL istek modunu ("01") türetir
     * (kural: pozitif yanıt = istek modu + 0x40). Geçersiz/anlaşılamayan girişte null döner
     * (7F kontrolü sessizce atlanır — kritik değil, yalnız sınıflandırma hassasiyeti).
     */
    private static String requestModeHex(String positiveModeHex) {
        try {
            int v = Integer.parseInt(positiveModeHex, 16) - 0x40;
            if (v < 0) return null;
            return String.format(Locale.ROOT, "%02X", v);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * PR-CAP-2: "7F<reqMode>" eşleşmesinden SONRAKİ iki hex haneyi NRC baytı olarak okur.
     *
     * @param compact boşluksuz/büyük-harf yanıt
     * @param at      NRC'nin başlaması beklenen index ("7F"+reqMode'dan hemen sonra)
     * @return 0x00-0xFF NRC; iki hane yoksa/hex değilse null (yarım yanıt — fail-soft,
     *         çağıran NRC'siz NEG_7F'i muhafazakâr işler).
     */
    private static Integer parseNrc(String compact, int at) {
        if (at + 2 > compact.length()) return null;
        try {
            return Integer.parseInt(compact.substring(at, at + 2), 16);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Ham ELM327 yanıtını sınıflandırır ve (Kind.OK ise) {@code mode+pid} veri
     * bloğunu çıkarır.
     *
     * @param raw  channel.send() sonucu — trim edilmiş ham yanıt ('\r'/'>' zaten temiz)
     * @param mode SAE J1979 pozitif yanıt modu hex öneki (ör. Mode 01 → "41", Mode 09 → "49")
     * @param pid  PID hex (ör. "0D")
     */
    public static Result classify(String raw, String mode, String pid) {
        if (raw == null || raw.trim().isEmpty()) {
            return new Result(Kind.TIMEOUT_PARTIAL, null, raw);
        }
        String compact = raw.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);

        if (compact.contains("NODATA")) return new Result(Kind.NO_DATA, null, raw);
        if (compact.contains("SEARCHING") || compact.contains("BUSINIT")) return new Result(Kind.BUSY, null, raw);
        if (compact.contains("UNABLETOCONNECT") || compact.contains("CANERROR")
            || compact.contains("BUSERROR") || compact.contains("STOPPED")
            || compact.contains("BUFFERFULL")) {
            return new Result(Kind.ERROR, null, raw);
        }

        // Beklenen veri bloğu — İLK eşleşme (eski indexOf davranışıyla birebir aynı;
        // çok-ECU "en iyi" seçimi bilinçli olarak yapılmaz, bkz. sınıf yorumu).
        String needle = mode + pid;
        int idx = compact.indexOf(needle);
        if (idx >= 0) {
            return new Result(Kind.OK, compact.substring(idx + needle.length()), raw);
        }

        // 7F <request-mode> <NRC> — negatif yanıt REQUEST modunu taşır (pozitif yanıt
        // önekinden 0x40 az, SAE J1979 kuralı: 41→01, 49→09, vb.), "mode" (pozitif önek) DEĞİL.
        String reqMode = requestModeHex(mode);
        if (reqMode != null) {
            String neg = "7F" + reqMode;
            int negIdx = compact.indexOf(neg);
            // PR-CAP-2: NRC baytını da çıkar — "7F<reqMode><NRC>". NRC yoksa (yanıt yarım
            // kaldı) null; sınıf yine NEG_7F kalır (ECU ayrık negatif yanıt VERDİ — bu bilgi
            // korunur), JS tarafı NRC'siz durumu muhafazakâr işler (kalıcı eleme YOK).
            if (negIdx >= 0) return new Result(Kind.NEG_7F, null, raw, parseNrc(compact, negIdx + neg.length()));
        }
        if (compact.equals("?") || compact.contains("ERROR")) return new Result(Kind.ERROR, null, raw);

        // Tanınan bir kalıp yok ve beklenen blok da bulunamadı — muhtemelen kısmi/
        // gürültülü yanıt (deadline dolarken yarım kalmış bayt akışı).
        return new Result(Kind.TIMEOUT_PARTIAL, null, raw);
    }
}
