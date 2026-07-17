package com.cockpitos.pro.obd;

import java.io.IOException;
import java.util.Locale;

/**
 * ElmInitSequencer — SAE J1979 / ISO 15031-5 uyumlu, DOĞRULAMALI ELM327 init dizisi (Patch 3).
 *
 * KÖK NEDEN: eski init dizisi (bkz. {@link ElmProtocol} önceki hali) doğrulamasızdı — ATZ /
 * ATE0 / ATL0 / ATH0 yanıtları HİÇ kontrol edilmiyordu, ATS0/ATAT yoktu ve ilk PID sorgusundan
 * ÖNCE bir 0100 "ısınma" turu yapılmıyordu. Sonuç: ATSP0 (otomatik protokol arama) araç CAN
 * DEĞİLSE (KWP2000/ISO 9141) ilk gerçek PID sorgusunda (010D/010C, 1500ms timeout) devreye
 * giriyor, adaptör "SEARCHING..." yanıtı verirken PID okuyucunun kısa timeout'u yetmiyor →
 * NO-DATA → data gate 10s → reconnect → ATZ aramayı sıfırlıyor → kısır döngü (BC8 kararsız
 * döngü ile aynı imza).
 *
 * Bu sınıf:
 *  1) Temel AT komutlarını "UYAR-VE-DEVAM" modunda doğrular — bozuk/klon adaptörler yanıt
 *     formatını tam tutturamayabilir (ör. echo kalıntısı, '?' desteklenmeyen komut yanıtı);
 *     bu KRİTİK değildir, akışı durdurmaz.
 *  2) 0100 ile ISINMA yaparak protokol aramasını PID okuyucudan ÖNCE, kendi (uzatılabilir)
 *     timeout penceresinde bitirir — "SEARCHING..." görülürse pencere bir kez uzatılır.
 *  3) Yalnız "UNABLE TO CONNECT" (araçtan/protokolden gerçekten yanıt alınamadı) durumunda
 *     {@link UnableToConnectException} fırlatır — bu SERT hata, geri kalan her şey yumuşak.
 *  4) ATDPN ile aktif protokol numarasını okur (varsa) — obdService.ts bunu persist edip
 *     sonraki bağlantıda ATSP&lt;n&gt; ile ARAMASIZ bağlanmak için kullanır.
 *
 * DAVRANIŞ KORUMASI: AT komut SIRASI ve temel timeout değerleri ElmProtocol'ün önceki init
 * dizisiyle birebir uyumludur (ATZ 2500 / ATE0 1000 / ATL0 500 / ATH0 500 / ATSP 1000); PID
 * parse FORMÜLLERİ bu sınıfa hiç dokunulmadı (ElmProtocol'de aynen kalır).
 */
public final class ElmInitSequencer {

    private static final String TAG = "OBD";

    /**
     * Yapılandırılmış "UNABLE TO CONNECT" hatası — obdService.ts native reject CODE'una
     * bakarak (mesaj string parse'ı YAPMADAN) PROTOCOL_CYCLE'ı yalnız bu sınıfta ilerletir.
     */
    public static final class UnableToConnectException extends IOException {
        public UnableToConnectException(String message) { super(message); }
    }

    private final ElmCommandChannel channel;

    public ElmInitSequencer(ElmCommandChannel channel) {
        this.channel = channel;
    }

    /**
     * ELM327 adaptörünü başlatır.
     *
     * @param protocol JS'ten gelen / önceden öğrenilmiş ATSP protokol numarası (örn. "6");
     *                 null/boş → otomatik (ATSP0).
     * @return ATDPN ile okunan aktif protokol numarası (tek karakter); okunamazsa null.
     * @throws UnableToConnectException araç/protokolden gerçekten yanıt alınamadı (SERT hata).
     * @throws IOException              iletişim katmanı hatası (soket/GATT koptu).
     */
    public String init(String protocol) throws IOException {
        // 1) ATZ — reset. Bazı klonlar ilk yanıtı yutar; boş/çöp ise 1 kez tekrar, sonra
        //    uyar-ve-devam (ATZ'nin kendisi kritik değil — asıl doğrulama 0100 warm-up'ta).
        String atz = safeSend("ATZ", 2500);
        if (!containsIgnoreCase(atz, "ELM")) {
            atz = safeSend("ATZ", 2500);
            if (!containsIgnoreCase(atz, "ELM")) {
                warn("ATZ yanıtı 'ELM' içermiyor (klon adaptör olabilir) — devam ediliyor: " + summarize(atz));
            }
        }

        // 2) ATE0 — echo kapat. "ATE0OK" gibi echo-kalıntılı yanıtlar da OK sayılır
        //    (containsIgnoreCase zaten alt-dize eşleşmesi yapıyor).
        checkOk("ATE0", safeSend("ATE0", 1000));

        // 3) ATL0 (linefeed kapat), ATS0 (YENİ — boşluk kapat, yanıt bandı ~%40 küçülür), ATH0 (header kapat)
        checkOk("ATL0", safeSend("ATL0", 500));
        checkOk("ATS0", safeSend("ATS0", 500));
        checkOk("ATH0", safeSend("ATH0", 500));

        // 4) ATAT1 — adaptif zaman aşımı modu. Desteklemeyen klonlar '?' döner → yoksay (kritik değil).
        safeSend("ATAT1", 500);

        // 5) Protokol seçimi — JS'ten geldiyse (öğrenilmiş/zorlanmış) onu kullan, yoksa ATSP0 (otomatik).
        String sp = protocol;
        if (sp != null && sp.length() == 1) {
            checkOk("ATSP" + sp, safeSend("ATSP" + sp, 1000));
            // OBD-OS-F0-4: protokol BİLİNİYOR → sınıf profilini warm-up'tan ÖNCE uygula
            // (yavaş seri hatta 0100 warm-up da geniş yanıt penceresinden faydalanır).
            applyProtocolProfile(sp);
        } else {
            checkOk("ATSP0", safeSend("ATSP0", 1000));
        }

        // 6) 0100 WARM-UP — ilk gerçek PID sorgusundan ÖNCE protokol aramasını BURADA bitir.
        //    "SEARCHING..." görülürse ELM327 hâlâ protokol arıyor demektir → pencereyi bir kez
        //    uzat (boş komut = ELM327'de "son komutu tekrarla / devam eden yanıtı bekle").
        //    Bu iki çağrı (safeSend'in aksine) GERÇEK iletişim hatalarını yutmaz — bağlantı
        //    burada koparsa çağıran (OBDManager/BleObdManager) bunu bir IOException olarak görmeli.
        String warm = sendChecked("0100", 5000);
        if (containsIgnoreCase(warm, "SEARCHING")) {
            warm = sendChecked("", 5000);
        }
        // PR-OBD-PROTO-CYCLE: yalnız "UNABLE TO CONNECT" sert hata sayılıyordu. Yanlış protokol
        // ZORLANDIĞINDA (araç değişimi: Trafic/KWP→Doblo/CAN) ELM327 "BUS INIT: ...ERROR"
        // (KWP init CAN araçta) ya da "CAN ERROR" (CAN init KWP araçta) döner — bunlar sahte
        // başarı sayılıyordu → connected-ama-ölü oturum → JS protokol döngüsü 6'ya HİÇ
        // ilerlemiyordu → sonsuz "Bağlanıyor" (saha 2026-07-16 Doblo). Hepsi dürüst
        // UNABLE_TO_CONNECT'tir: JS bu kodla bir sonraki protokol adayına geçer.
        String warmCompact = compact(warm);
        // ZORLANMIŞ PROTOKOL + NO DATA = YANLIŞ PROTOKOL (saha 2026-07-16, Renault KWP):
        // önbellek `obd:lastProtocol='7'` (CAN 29-bit) bir KWP2000 (proto 5) araca ZORLANINCA
        // ELM327 CAN çerçevesi gönderir, K-hat ECU'su hiç yanıtlamaz → 0100 dahil TÜM Mode-01
        // "NO DATA" döner. NO DATA sert-hata deseni (BUS INIT/CAN ERROR) OLMADIĞINDAN init
        // "başarılı" sayılıyordu → bağlı-ama-ölü oturum (ATRV=14.6V çalışır ama 41xx SIFIR) →
        // JS "bağlandı" sanıp protokol döngüsünü ilerletmiyordu → SONSUZ NO DATA. Artık zorlanmış
        // protokolde NO DATA da dürüst UNABLE_TO_CONNECT: JS bir sonraki adaya (7→6→5) geçer,
        // KWP 5'te ECU yanıtlar → bağlanır → ATDPN yazımı bayat '7' önbelleğini düzeltir.
        // NOT: yalnız sp!=null (zorlanmış). ATSP0-otomatik (sp==null) yolu AYNEN korunur — orada
        // ELM tüm protokolleri kendi tarar; ayrıca poll-anı NO DATA kurtarması (ATPC+ATWM, proto
        // 3/4/5) BAĞLANMIŞ oturum içindir, bu init-anı kapısıyla çakışmaz.
        if (warmCompact.contains("UNABLETOCONNECT")
            || (warmCompact.contains("BUSINIT") && warmCompact.contains("ERROR"))
            || warmCompact.contains("CANERROR")
            || warmCompact.contains("BUSERROR")
            || (sp != null && warmCompact.contains("NODATA"))) {
            throw new UnableToConnectException("ELM327: araç bu protokolde yanıt vermedi (0100 warm-up="
                + summarize(warm) + ", protokol=" + (sp != null ? sp : "auto") + ")");
        }

        // 7) ATDPN — aktif protokol numarasını oku (opsiyonel; okunamazsa null döner, akış bozulmaz).
        String active = readActiveProtocol();

        // OBD-OS-F0-4: ATSP0 (otomatik) yolunda protokol ancak BURADA öğrenilir → profili
        // şimdi uygula. Böylece ilk bağlantıda da (protokol önceden bilinmezken) KWP/ISO9141
        // aracı doğru yanıt penceresiyle poll edilir; sonraki bağlantı zaten (5)'te uygular.
        if (sp == null && active != null) {
            applyProtocolProfile(active);
        }
        return active;
    }

    /**
     * OBD-OS-F0-4 — protokol-sınıfı ELM327 ayarı. YALNIZ yavaş seri protokollerde (ISO 9141-2,
     * KWP2000) devreye girer; CAN/J1850'de HİÇBİR komut gönderilmez → çalışan CAN davranışı
     * BİREBİR korunur (ATAT1 adaptif zamanlama zaten devrede).
     *
     * NEDEN: KWP/ISO9141 10.4 kbit/s SERİ hattır. ELM327'nin varsayılan yanıt bekleme süresi
     * (ATST varsayılanı ~200 ms) bu ECU'lar için kısadır → adaptör erken vazgeçip NO DATA
     * döner, biz de "PID desteklenmiyor" sanırız (yanlış-negatif keşif).
     *
     * @param p ELM327 ATSP protokol numarası ("3"=ISO9141-2, "4"/"5"=KWP2000).
     */
    private void applyProtocolProfile(String p) {
        if (p == null || p.isEmpty()) return;
        char c = Character.toUpperCase(p.charAt(0));
        boolean slowSerial = (c == '3' || c == '4' || c == '5');
        if (!slowSerial) return;   // CAN / J1850 / bilinmeyen → dokunma

        // ATST FF → yanıt bekleme 0xFF × 4 ms ≈ 1020 ms (varsayılan ~200 ms yetmiyor).
        safeSend("ATSTFF", 500);
        // PR-OBD-KWP-RECOVER: ATWM C1 33 F1 3E → periyodik wakeup MESAJININ KENDİSİ —
        // standart KWP2000 fonksiyonel TesterPresent (ISO 14230-4 header C1 33 F1 + servis 3E).
        // Orijinal ELM327'de bu zaten KWP varsayılanıdır; KLONLARDA yanlış/boş gelebiliyor →
        // ATSW aralığı doğru olsa bile ECU wakeup'ı reddedip oturumu düşürür (Trafic saha
        // kanıtı: handshake OK → sonra kalıcı NO DATA). Yalnız KWP ('4'/'5'); ISO9141 ('3')
        // varsayılanda kalır (farklı wakeup formatı kullanır). Desteklemeyen klon '?' → yoksay.
        if (c == '4' || c == '5') safeSend("ATWMC133F13E", 500);
        // ATSW 92 → ELM327'nin ISO/KWP hattında otomatik wakeup (keep-alive) aralığı:
        // 0x92 × 20 ms ≈ 2.9 sn, KWP2000 P3max (5 sn oturum zaman aşımı) ALTINDA. Böylece
        // poll seyrekleştiğinde/durduğunda bile ECU oturumu DÜŞMEZ (park sonrası ilk PID
        // yeniden init beklemez). Bu ELM327'nin YERLEŞİK wakeup'ıdır — burada AÇIKÇA set
        // ediyoruz çünkü klon adaptörlerde varsayılanın 00 (kapalı) geldiği görülüyor.
        safeSend("ATSW92", 500);
        try {
            android.util.Log.i(TAG, "[ElmInit] Yavaş seri protokol (" + p + ") → ATST FF"
                + ((c == '4' || c == '5') ? " + ATWM (TesterPresent)" : "") + " + ATSW 92 uygulandı");
        } catch (Throwable ignored) { /* JVM unit test: android.util.Log mock yok */ }
    }

    /**
     * Patch 13: ayrıştırma {@link ElmResponseParser#parseActiveProtocolDigit} ile PAYLAŞILIR
     * (kopyalama yok — {@link ElmProtocol#withEcuHeader} 29-bit yolu AYNI ayrıştırmayı kullanır).
     */
    private String readActiveProtocol() {
        try {
            return ElmResponseParser.parseActiveProtocolDigit(channel.send("ATDPN", 1000));
        } catch (Exception e) {
            return null; // ATDPN opsiyonel — protokol bilgisi olmadan da devam edilir
        }
    }

    /** Yanıt alınamazsa (timeout/IO) boş string döner — init dizisini durdurmaz (uyar-ve-devam). */
    private String safeSend(String cmd, int timeoutMs) {
        try { return channel.send(cmd, timeoutMs); } catch (Exception e) { return ""; }
    }

    /** channel.send()'in checked Exception'ını IOException'a çevirir (ElmProtocol'deki eski desenle aynı). */
    private String sendChecked(String cmd, int timeoutMs) throws IOException {
        try {
            return channel.send(cmd, timeoutMs);
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /** "OK" içermeyen (ama boş da olmayan — tamamen sessiz adaptör farklı bir durum) yanıtları uyarı olarak loglar. */
    private void checkOk(String cmd, String resp) {
        if (!resp.trim().isEmpty() && !containsIgnoreCase(resp, "OK")) {
            warn(cmd + " 'OK' döndürmedi (desteklenmeyen komut olabilir) — devam ediliyor: " + summarize(resp));
        }
    }

    private static boolean containsIgnoreCase(String s, String needle) {
        return s != null && s.toUpperCase(Locale.ROOT).contains(needle);
    }

    private static String compact(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
    }

    private static String summarize(String s) {
        if (s == null) return "(null)";
        String t = s.trim();
        return t.isEmpty() ? "(boş)" : t;
    }

    private static void warn(String msg) {
        android.util.Log.w(TAG, "[ElmInit] " + msg);
    }
}
