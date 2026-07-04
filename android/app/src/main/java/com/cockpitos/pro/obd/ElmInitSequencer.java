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
        if (compact(warm).contains("UNABLETOCONNECT")) {
            throw new UnableToConnectException("ELM327: UNABLE TO CONNECT (0100 warm-up, protokol=" + (sp != null ? sp : "auto") + ")");
        }

        // 7) ATDPN — aktif protokol numarasını oku (opsiyonel; okunamazsa null döner, akış bozulmaz).
        return readActiveProtocol();
    }

    private String readActiveProtocol() {
        try {
            String dpn = compact(channel.send("ATDPN", 1000));
            if (dpn.isEmpty()) return null;
            char last = dpn.charAt(dpn.length() - 1);
            // ELM327 ATDPN: "A6" (otomatik-tespit + protokol 6) veya "6" (manuel). Tek hane
            // (0-9) ya da CAN-ötesi harf kodları (A/B/C) — obdService.ts PROTOCOL_CYCLE'ı
            // yalnız rakam kullanıyor, harf kodları zararsızca yoksayılır (null döner).
            if (Character.isDigit(last)) return String.valueOf(last);
            return null;
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
