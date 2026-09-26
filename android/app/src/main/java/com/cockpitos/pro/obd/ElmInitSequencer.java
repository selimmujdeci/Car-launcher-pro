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

    /* ── 0100 warm-up pencereleri (bkz. init() içindeki P0-OBD-WARMUP-SEARCH notu) ── */
    /** ATSP0 OTOMATİK arama: ELM327 protokolleri sırayla dener, `SEARCHING...` yayar. */
    private static final int WARMUP_AUTO_MS     = 9_000;
    /** ZORLANMIŞ protokol: arama YOK → eski 5 sn AYNEN (çalışan CAN yolu değişmez). */
    private static final int WARMUP_FORCED_MS   = 5_000;
    /** `SEARCHING...` görüldükten sonra aramanın bitmesi için ek pencere. */
    private static final int WARMUP_CONTINUE_MS = 3_000;

    /**
     * #524 — CAN protokollerinde uygulanan ATST değeri (hex). `0x64 × 4 ms ≈ 400 ms`.
     *
     * ELM327 varsayılanı 0x32 (~200 ms) idi ve CAN'de HİÇ değiştirilmiyordu; sahada
     * NO_DATA süresi 151-259 ms ölçüldü, yani adaptör tavana dayanıp pes ediyordu.
     * ATAT1 açık olduğu için bu değer yalnız TAVANDIR — cevap veren PID'i yavaşlatmaz.
     * Gerekçe ve neden FF olmadığı: {@code applyProtocolProfile} yorumuna bakınız.
     * TEK YER: değer değişecekse yalnız burası değişir.
     *
     * ── 2026-09-13 · 0x64 → 0xC8 (SAHADA ÖLÇÜLDÜ, #524'ün kabul ölçütü koştu) ────────
     * #524 bu değeri "ÖLÇÜLMEDİ, SEÇİLDİ — yetmezse artırma yolu açıktır" diye
     * bırakmıştı. Gerçek araçta (Renault, protokol 7 CAN 29-bit, ELM327 v2.2) poll
     * izi alındı ve 0x64'ün YETMEDİĞİ ölçüldü:
     *   · BAŞARILI yanıtlar:  86-283 ms  (010C ort 180 · 010D ort 176 · 0100 106)
     *   · NO_DATA yanıtları:  442-480 ms — İSTİSNASIZ HEPSİ 400 ms tavanında
     *   · AYNI PID hem OK hem NO_DATA: 010C 10 OK / 16 NO_DATA · 010D 10 / 16
     * Aynı PID'in bazen cevaplaması "desteklenmiyor"u ÇÜRÜTÜR; NO_DATA'ların tavanda
     * kümelenmesi ise pes edenin ADAPTÖR olduğunu gösterir — #512/#516'daki desenin
     * aynısı, bir kademe yukarıda. Sonuç: ~%62 çekirdek PID kaybı → akış kesintisi →
     * üstel backoff'lu yeniden bağlanma (15s→73s→95s→120s ölçüldü).
     *
     * 0xC8 = 200 × 4 ms = 800 ms. Neden bu:
     *   · Ölçülen en yavaş BAŞARILI yanıt 283 ms; tavanı 400'den 800'e çıkarmak
     *     ECU'nun geciken turlarına iki kat alan açar.
     *   · ATAT1 tavanı yalnız CEVAPSIZ sorguda ödetir — cevap veren PID hızlanır/
     *     yavaşlamaz (ölçülen 86-283 ms bandı DEĞİŞMEZ).
     *   · 0xFF (1020 ms) SEÇİLMEDİ: gerçekten desteklenmeyen bir PID (ör. 0111)
     *     tur başına 1 sn'ye yakın yer yerdi ve çekirdek tazeliğini (devir/hız)
     *     riske atardı — #524'ün "çekirdek tazeliği BOZULMAYACAK" ölçütü sürüyor.
     * ── 2026-09-13 (2. tur) · 0xC8 → 0xFF · TAVAN HÂLÂ BAĞLAYICIYDI ────────────────
     * 0xC8 ile yeniden ölçüldü: 010C/010D başarısı %38 → %70, yeniden bağlanma
     * 75 sn'de 1'e düştü. Ama HAM içerik tavanın hâlâ bağladığını gösterdi:
     *   · NO_DATA raw'ı İSTİSNASIZ literal "NO DATA" (prompt görüldü, çöp/desenkron YOK)
     *   · BAŞARILI yanıtlar 847 / 857 / 876 ms'de geldi — yeni tavanın DİBİNDE
     *   · NO_DATA'lar 857-886 ms — başarılılarla ÇAKIŞIYOR
     * İki dağılımın çakışması "bir kısmı yetişiyor, bir kısmı kıl payı kaçırıyor"
     * demektir; yani sınır hâlâ ST'dir. ECU gecikmesi çift tepeli ölçüldü:
     * medyan ~105 ms, ama yavaş fazda 850 ms+. Kaskad (önceki sorgu NO_DATA iken
     * çekirdek düşme oranı %94, önceki OK iken %3) bu yavaş fazlarla açıklanır —
     * desenkronizasyonla DEĞİL (ham içerik temiz olduğu için o hipotez ÇÜRÜDÜ).
     *
     * ── 2026-09-13 (3. tur) · 0xFF DENENDİ ve GERİ ALINDI · ST EKSENİ KAPANDI ──────
     * 0xFF (≈1020 ms) aynı araçta ölçüldü ve DAHA KÖTÜ çıktı:
     *   ST=0x64  → 010C %38 · 010D %38
     *   ST=0xC8  → 010C %70 · 010D %70      ← ölçülen en iyi
     *   ST=0xFF  → 010C %47 · 010D %41
     * Ve asıl kanıt: NO_DATA süresi HANGİ tavanı koyarsak tam ORADA kümelendi
     * (455 → 870 → 1091 ms medyan). "ECU biraz geç cevaplıyor" DOĞRU OLSAYDI
     * tavanı büyütmek düşüşleri başarıya çevirirdi — ÇEVİRMEDİ. Demek ki ECU o
     * pencerelerde HİÇ yanıt vermiyor; tavanı büyütmek yalnız her ölü sorgunun
     * maliyetini artırıp turdaki sorgu sayısını düşürüyor (80 sn'de 101 → 66 satır).
     *
     * BASKIN ETKİ ST DEĞİL, KASKAD: "önceki sorgu NO_DATA ise çekirdek PID'in düşme
     * oranı %94, önceki OK ise %3" — ve bu oran 0xC8'de de 0xFF'te de AYNI çıktı.
     * Desenkronizasyon DEĞİL (ham içerik istisnasız temiz literal "NO DATA",
     * prompt görülmüş, çöp bayt yok) ve ST DEĞİL (tavandan bağımsız sabit).
     * ECU/gateway'in "ölü faz"a girip bir süre hiç yanıtlamaması gibi görünüyor;
     * KÖK NEDENİ ÖLÇÜLMEDİ — sıradaki adaylar: sorgu kadansı/aralığı · ATAT modu ·
     * gateway rate-limit · tester-present ihtiyacı. Bu dosyada çözülecek bir şey değil.
     *
     * ⚠️ DEĞER SEÇİMİ ÖLÇÜME DAYANIR AMA TEK ARAÇTIR: üç nokta tek Renault'da,
     * motor çalışır durumda ölçüldü. Farklı araçta optimum başka çıkabilir.
     */
    static final String CAN_ST_HEX = "C8";

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
        /* ── P0-OBD-WARMUP-SEARCH · SAHA KÖK NEDENİ (2026-09-13, Renault + V-LINK) ──
         * ÖLÇÜLDÜ (ham iz): ATZ…ATSP0 komutlarının HEPSİ 40-80 ms'de "OK" döndü,
         * ardından `0100` → `ELM partial response timeout` (5,3 sn), her turda.
         * `partial` bayrağı tanım gereği "KISMİ YANIT VARDI" demektir
         * (ElmPromptTimeoutException: partial = !partialResponse.isEmpty()) —
         * yani adaptör CEVAP VERİYORDU, biz prompt'u göremeyip ATIYORDUK.
         *
         * ATSP0 otomatik aramada ELM327 önce `SEARCHING...` yayar ve nihai yanıt
         * saniyeler sonra gelir (yavaş seri protokollere inerse 5-baud init tek
         * başına 2-3 sn). Aşağıdaki "SEARCHING → pencereyi uzat" çaresi ZATEN
         * yazılmıştı ama ERİŞİLEMEZDİ: `sendChecked` kısmi timeout'ta İSTİSNA
         * fırlatıyor, dolayısıyla `warm` dizisi hiç oluşmuyor ve `if` hiç çalışmıyordu.
         * Kısmi yanıt istisnanın İÇİNDE taşınıyordu ve kimse okumuyordu.
         *
         * DÜZELTME İKİ PARÇA: (1) kısmi timeout'ta yanıtı İSTİSNADAN OKU — böylece
         * mevcut uzatma yolu gerçekten çalışır; (2) otomatik aramaya gerçekçi bir
         * pencere ver. ZORLANMIŞ protokolde 5 sn AYNEN korunur (arama yok → uzun
         * beklemek yalnız hata tespitini geciktirirdi; çalışan CAN yolu DEĞİŞMEZ).
         *
         * BÜTÇE: JS tarafı bu bacağa `unknown` profilinden 15 sn veriyor
         * (protocolProfile.ts → CAN_PROFILE.connectTimeoutMs). En kötü hâl
         * ≈1,5 sn (AT dizisi) + 9 + 3 = 13,5 sn → bütçe İÇİNDE kalır.
         * ⚠️ 9000/3000 ÖLÇÜLMEDİ, SEÇİLDİ: ölçülen tek şey 5 sn'nin YETMEDİĞİdir.
         * Değerler tek yerde; saha yetmezse buradan artırılır (bütçe sınırı 15 sn). */
        final int warmupMs = (sp == null) ? WARMUP_AUTO_MS : WARMUP_FORCED_MS;
        String warm;
        try {
            warm = sendChecked("0100", warmupMs);
        } catch (ElmPromptTimeoutException te) {
            if (containsIgnoreCase(te.partialResponse, "SEARCHING")) {
                // Arama sürüyordu — boş komut = "devam eden yanıtı beklemeye devam et".
                warm = sendChecked("", WARMUP_CONTINUE_MS);
            } else {
                throw te;   // kısmi yanıt arama DEĞİL → dürüst hata, yutma yok
            }
        }
        /* FAIL-OPEN DÜZELTMESİ (bu turda ham izde görüldü): burada koşul yalnız
         * "SEARCHING içeriyor mu" idi ve TAMAMLANMIŞ yanıtı da eziyordu. Ölçülen:
         * `0100` → "SEARCHING...4100983B0011" (prompt GÖRÜLDÜ, yanıt TAM) → uzatma
         * çalışıp `warm`'ı "?" ile değiştirdi; gerçek yük KAYBOLDU. Bu turda zararsızdı
         * (aşağıdaki denetim yalnız HATA desenleri arar, "?" hiçbirine uymaz) ama
         * FAIL-OPEN'dır: "SEARCHING...UNABLE TO CONNECT" gelseydi hata "?"ye dönüşür,
         * UnableToConnectException ATILMAZ ve bağlı-ama-ölü oturum doğardı.
         * Artık yalnız yanıt SADECE arama bildirimiyse (henüz içerik yok) uzatılır. */
        if (isSearchOnly(warm)) {
            warm = sendChecked("", WARMUP_CONTINUE_MS);
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

        /* ── #524 · CAN'DE DE ATST AYARLANIR (eskiden HİÇ ayarlanmıyordu) ──────
         * KÖK NEDEN (kütük #512/#516): bu metot CAN'de erken dönüyordu, yani
         * ELM327 varsayılan yanıt penceresiyle (ATST 0x32 ≈ 200 ms) çalışıyorduk.
         * Sahada NO_DATA'da geçen süre 151-259 ms ölçüldü — yani **pes eden biz
         * değil ADAPTÖRDÜ**: tavana dayanıp NO DATA yazıyordu. Ardından 3 ardışık
         * NO_DATA eleme eşiğini tetikliyor ve PID kalıcı susturuluyordu.
         *
         * NEDEN ZARARSIZ: ATAT1 (adaptif zamanlama) init'te AÇIKTIR ve ST onun
         * TAVANIDIR. Tavanı yükseltmek cevap VEREN bir PID'in süresini UZATMAZ —
         * adaptör yanıt gelir gelmez döner. Yalnız YAVAŞ cevaba fırsat tanır.
         * Maliyet sadece gerçekten cevapsız kalan sorguda ödenir.
         *
         * NEDEN 0x64 (≈400 ms) VE FF (≈1020 ms) DEĞİL:
         *  · Ölçülen adaptör tavanı ~200 ms idi; 0x64 buna İKİ KAT alan açar.
         *  · Maliyet cevapsız sorguda ödenir ve poll turu extended grupta turda
         *    EN FAZLA BİR PID okur → tur şişmesi en kötü +0.4 sn. FF ile bu
         *    +1.0 sn olurdu ve çekirdek tazeliğini (devir/hız) riske atardı —
         *    kabul ölçütü "çekirdek tazeliği BOZULMAYACAK" der.
         *  · Yavaş seri protokoller (KWP/ISO9141) FF'te KALIR: orada hat fiziksel
         *    olarak 10.4 kbit/s'tir ve ölçülmüş bir gerekçesi vardır (F0-4).
         *
         * ⚠️ BU DEĞER ÖLÇÜLMEDİ, SEÇİLDİ: ECU'nun gerçek cevap gecikmesi bilinmiyor
         * (H-A deneyi kaybın görülmediği bir oturuma denk geldi). 0x64 mühendislik
         * seçimidir; kütük #524'ün kabul ölçütü onu sahada sınar. Yetmezse artırma
         * yolu açıktır — sabit TEK yerdedir. */
        if (!slowSerial) {
            boolean can = (c == '6' || c == '7' || c == '8' || c == '9'
                        || c == 'A' || c == 'B' || c == 'C');
            if (can) {
                safeSend("ATST" + CAN_ST_HEX, 500);
                try {
                    android.util.Log.i(TAG, "[ElmInit] CAN protokolü (" + p + ") → ATST "
                        + CAN_ST_HEX + " (~" + (Integer.parseInt(CAN_ST_HEX, 16) * 4) + " ms) uygulandı");
                } catch (Throwable ignored) { /* JVM unit test: android.util.Log mock yok */ }
            }
            return;   // J1850 / bilinmeyen → dokunma
        }

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

    /* ── TEŞHİS (GEÇİCİ · 2026-09-13) ────────────────────────────────────────────
     * Saha arızası: Car Scanner AYNI dongle + AYNI araçta classic SPP ile veri
     * alıyor, CarOS'un init'i `0100` warm-up'ta düşüyor. Hangi komuta ne döndüğü
     * ürün içinden GÖRÜNMÜYORDU (komut bazlı log yok) → teşhis çıkarımla
     * yürütülüyordu. Bu iki satır ham alışverişi logcat'e döker.
     * Kapatma ölçütü: kök neden bulunup düzeltilince KALDIRILIR.
     * Not: yük maskelenmez — init'te VIN/PII taşıyan komut YOKTUR (Mode 09 burada
     * çağrılmaz); yine de yalnız init penceresinde çalışır, poll döngüsünde değil. */
    private static void traceIo(String cmd, String resp, String how) {
        // Satış paketinde ham OBD yükü loglanmaz; R8 bu dalı release'te tamamen eler
        // (aynı desen: CarLauncherPlugin teşhis sunucusu guard'ı — app/build.gradle notu).
        if (!com.cockpitos.pro.BuildConfig.DEBUG) return;
        try {
            android.util.Log.i(TAG, "[ElmTrace] " + how + " >> " + cmd
                + "  << " + (resp == null ? "<null>" : "\"" + resp.replace("\r", "\\r").replace("\n", "\\n") + "\""));
        } catch (Throwable ignored) { /* JVM unit test: android.util.Log mock yok */ }
    }

    /** Yanıt alınamazsa (timeout/IO) boş string döner — init dizisini durdurmaz (uyar-ve-devam). */
    private String safeSend(String cmd, int timeoutMs) {
        try {
            String r = channel.send(cmd, timeoutMs);
            traceIo(cmd, r, "safe");
            return r;
        } catch (Exception e) {
            traceIo(cmd, "EXCEPTION: " + e.getClass().getSimpleName() + ": " + e.getMessage(), "safe");
            return "";
        }
    }

    /** channel.send()'in checked Exception'ını IOException'a çevirir (ElmProtocol'deki eski desenle aynı). */
    private String sendChecked(String cmd, int timeoutMs) throws IOException {
        try {
            String r = channel.send(cmd, timeoutMs);
            traceIo(cmd, r, "chk ");
            return r;
        } catch (ElmPromptTimeoutException te) {
            // TEŞHİS: kısmi yanıtın İÇERİĞİ asıl kanıttır (SEARCHING mi, başka bir şey mi).
            traceIo(cmd, "PromptTimeout(partial=" + te.partial + ", resynced=" + te.resynced
                + ") partialResponse=\"" + te.partialResponse + "\"", "chk ");
            throw te;
        } catch (IOException e) {
            traceIo(cmd, "IOException: " + e.getMessage(), "chk ");
            throw e;
        } catch (Exception e) {
            traceIo(cmd, e.getClass().getSimpleName() + ": " + e.getMessage(), "chk ");
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

    /**
     * Yanıt YALNIZCA arama bildirimi mi — yani `SEARCHING...` dışında hiç içerik yok mu?
     *
     * AYRIM NEDEN ÖNEMLİ: prompt GÖRÜLMEDEN timeout olduğunda yanıt tanım gereği
     * EKSİKTİR ve beklemeye devam etmek doğrudur (orada yalnız "SEARCHING içeriyor mu"
     * sorulur). Prompt görüldüyse yanıt TAMDIR; içinde gerçek yük ya da hata varsa
     * üzerine yazmak kanıt kaybıdır (bkz. init() içindeki FAIL-OPEN notu).
     */
    private static boolean isSearchOnly(String resp) {
        if (!containsIgnoreCase(resp, "SEARCHING")) return false;
        return compact(resp).replace("SEARCHING", "").replace(".", "").isEmpty();
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
