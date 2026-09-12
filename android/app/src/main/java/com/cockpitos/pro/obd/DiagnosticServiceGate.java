package com.cockpitos.pro.obd;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * P0-VDK-F4A — GENEL PDU KOPRUSUNUN NATIVE FAIL-CLOSED KAPISI.
 *
 * ==========================================================================
 * -- NEDEN AYRI BIR SINIF --------------------------------------------------
 * ==========================================================================
 * Genel bir "PDU gonder" yolu acmak, tanim geregi, TS/CDDL katmani bozulursa
 * araca ISTENEN HER BAYTIN gidebilecegi bir yol acmaktir. Urunun bugune kadarki
 * guvenligi TS'teki beyaz listelere dayaniyordu; genel kopru bu dayanagi tek
 * basina YETERSIZ kilar.
 *
 * Bu sinif IKINCI ve SON kapidir:
 *  - Saftir (I/O yok, durum yok, Android bagimliligi yok) -> saf JVM testiyle
 *    "tek bayt bile cikamaz" iddiasi KANITLANABILIR.
 *  - {@link ElmProtocol#KWP_PROBE_ALLOWED_SIDS} ile AYNI felsefeyi surdurur ve
 *    onu GENISLETMEZ: ayni servis kumesi, tek yerde.
 *
 * ==========================================================================
 * -- IKINCI GUVENLIK EVRENI KURULMADI --------------------------------------
 * ==========================================================================
 * Yeni bir izin modeli, yeni bir rol sistemi, yeni bir "unlock" kavrami YOK.
 * Tek soru sorulur: "bu servis bayti SALT-OKUNUR mu". Cevap hayirsa istek
 * HATTA CIKMAZ. Yazma yetkisi acmanin yolu bu dosyadan GECMEZ; ayri bir
 * Safety Kernel'in isidir ve bu turda ACILMAMISTIR.
 */
public final class DiagnosticServiceGate {

    private DiagnosticServiceGate() { }

    /**
     * HATTA CIKABILECEK SALT-OKUNUR SERVIS BAYTLARI.
     *
     * {@code ElmProtocol.KWP_PROBE_ALLOWED_SIDS} kumesini TAMAMEN KAPSAR ve
     * {@code DiagnosticServiceGateTest} bu kapsamayi KILITLER: matris kapisindan
     * gecen hicbir servis burada reddedilemez, ve buradan gecen hicbir servis
     * matris kapisinda olmayan bir DESTRUCTIVE servis olamaz.
     *
     * FARK BILINCLIDIR ve TAM OLARAK IKI GIRISTIR:
     *   06 - matris kapisi KWP adresleme matrisi icindir, Mode 06 orada
     *        anlamsizdir; ama urunun ZATEN ayri bir salt-okunur yolu vardir
     *        ({@code CarLauncherPlugin.readMode06}) ve okumadir.
     *   3E - ayni sekilde ayri yolu vardir ({@code sendTesterPresent}); SALT
     *        oturum canli tutmadir, yazmaz.
     * Bu iki giris kapiyi GENISLETMEZ: ikisi de bugun zaten hatta cikabiliyor.
     *
     * Her giris NEDEN salt-okunur oldugunun gerekcesiyle birlikte durur:
     *  01 currentData            - PID okuma, ECU hafizasina dokunmaz
     *  03 storedDTC              - okuma
     *  06 monitorResults         - okuma
     *  07 pendingDTC             - okuma
     *  09 vehicleInfo            - okuma (VIN/CVN)
     *  0A permanentDTC           - okuma
     *  10 startDiagnosticSession - SALT OTURUM; ECU'ya veri YAZMAZ, yetki ACMAZ
     *  13 KWP readDTC            - okuma (eski nesil)
     *  17 KWP readStatusOfDTC    - okuma
     *  18 KWP readDTCByStatus    - okuma
     *  19 UDS readDTCInformation - okuma (alt fonksiyon ayrica suzulur)
     *  1A KWP readEcuIdentification - okuma
     *  21 KWP readDataByLocalId  - okuma
     *  22 UDS readDataByIdentifier - okuma
     *  3E testerPresent          - SALT oturum canli tutma; yazmaz, yetki acmaz
     */
    private static final Set<String> READ_ONLY_SIDS =
        Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "01", "03", "06", "07", "09", "0A",
            "10", "13", "17", "18", "19", "1A", "21", "22", "3E"
        )));

    /**
     * ACIKCA YASAKLI (yazma / aktuator / reset / guvenlik) SERVISLER.
     *
     * Teknik olarak {@link #READ_ONLY_SIDS} disinda kalan HER SEY zaten
     * reddedilir; bu liste GEREKLI DEGIL ama BILINCLIDIR: gorevin sayadigi
     * destructive kume burada ISIMLE durur ve test onu tek tek dener. Boylece
     * "beyaz liste kazara genisletildi" hatasi sessiz kalamaz.
     *
     * 04 clearDTC . 11 ECUReset . 14 clearDiagnosticInformation .
     * 27 SecurityAccess . 28 communicationControl . 2E writeDataByIdentifier .
     * 2F inputOutputControl . 31 routineControl . 34 requestDownload .
     * 35 requestUpload . 36 transferData . 37 requestTransferExit .
     * 3B writeDataByLocalIdentifier . 85 controlDTCSetting
     */
    private static final Set<String> DESTRUCTIVE_SIDS =
        Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "04", "11", "14", "27", "28", "2E", "2F",
            "31", "34", "35", "36", "37", "3B", "85"
        )));

    /**
     * UDS 0x19 SALT-OKUNUR ALT FONKSIYONLARI.
     *
     * 0x19 servis olarak okumadir ama alt fonksiyon uzayi genistir. Mevcut
     * {@link ElmProtocol#readUdsDtcInformationDetailed} kapisiyla AYNI kume
     * tutulur - genel kopru mevcut kapidan DAHA GENIS olamaz.
     *
     * 01 reportNumberOfDTCByStatusMask . 02 reportDTCByStatusMask .
     * 03 reportDTCSnapshotIdentification . 06 reportDTCExtDataRecordByDTCNumber .
     * 0A reportSupportedDTC
     */
    private static final Set<String> UDS_19_READ_ONLY_SUBS =
        Collections.unmodifiableSet(new HashSet<>(Arrays.asList("01", "02", "03", "06", "0A")));

    /** Ret gerekcesi - sinirli kod, serbest metin YOK (TS'te sayilabilir olmali). */
    public static final String OK = "OK";
    public static final String DENY_SERVICE_NOT_READ_ONLY = "SERVICE_NOT_READ_ONLY";
    public static final String DENY_SUBFUNCTION_NOT_READ_ONLY = "SUBFUNCTION_NOT_READ_ONLY";
    public static final String DENY_MALFORMED = "MALFORMED_REQUEST";

    /** Beyaz listenin kopyasi (test ve kanit icin). */
    public static Set<String> readOnlyServices() {
        return READ_ONLY_SIDS;
    }

    /** Acikca yasakli kume (test ve kanit icin). */
    public static Set<String> destructiveServices() {
        return DESTRUCTIVE_SIDS;
    }

    /** Hex normalizasyonu - bosluk/ayirici temizler, buyuk harfe cevirir. */
    public static String normalizeHex(String v) {
        if (v == null) return "";
        return v.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.ROOT);
    }

    /**
     * ISTEK HATTA CIKABILIR MI.
     *
     * FAIL-CLOSED: tanimadigi her seyi REDDEDER. "Muhtemelen zararsizdir"
     * degerlendirmesi YOKTUR.
     *
     * @param service    servis bayti (2 hex hane)
     * @param subFunction alt fonksiyon (2 hex hane) veya null/bos
     * @param payload    govde (cift sayida hex hane) veya null/bos
     * @return {@link #OK} ya da DENY_* gerekce kodu
     */
    public static String judge(String service, String subFunction, String payload) {
        final String sid = normalizeHex(service);
        final String sub = normalizeHex(subFunction);
        final String data = normalizeHex(payload);

        /* Bicim: servis TAM 2 hane; alt fonksiyon ya yok ya 2 hane; govde cift hane.
           Bozuk bicim bir "belki"dir ve belkiler hatta cikmaz. */
        if (sid.length() != 2) return DENY_MALFORMED;
        if (!sub.isEmpty() && sub.length() != 2) return DENY_MALFORMED;
        if ((data.length() & 1) != 0) return DENY_MALFORMED;
        /* Cerceve tavani: ISO-TP tek istek icin makul ust sinir. Sinirsiz govde
           kabul etmek, beyaz listedeki bir servis uzerinden hatta kilobaytlarca
           veri surmenin yoludur. */
        if (sid.length() + sub.length() + data.length() > 2 * 64) return DENY_MALFORMED;

        if (DESTRUCTIVE_SIDS.contains(sid)) return DENY_SERVICE_NOT_READ_ONLY;
        if (!READ_ONLY_SIDS.contains(sid)) return DENY_SERVICE_NOT_READ_ONLY;

        /* 0x19 alt fonksiyon uzayi ayrica suzulur (mevcut kapiyla AYNI kume). */
        if ("19".equals(sid)) {
            if (sub.isEmpty()) return DENY_SUBFUNCTION_NOT_READ_ONLY;
            if (!UDS_19_READ_ONLY_SUBS.contains(sub)) return DENY_SUBFUNCTION_NOT_READ_ONLY;
        }
        return OK;
    }

    /** {@link #judge} sonucunun "gonderilebilir" olup olmadigi. */
    public static boolean isAllowed(String service, String subFunction, String payload) {
        return OK.equals(judge(service, subFunction, payload));
    }

    /**
     * POZITIF YANIT ONEKINI URETIR - SERVISE OZEL DAL YOK.
     *
     * ==========================================================================
     * -- NEDEN BURADA VE NEDEN GENEL --------------------------------------------
     * ==========================================================================
     * ISO 14229-1 ve ISO 14230-3'te olumlu yanit servis bayti EVRENSEL kuraldir:
     * {@code SID + 0x40}. Servise ozel olan tek sey, istegin KAC BAYTININ yanitta
     * YANKILANDIGIDIR (0x19-02 alt fonksiyonu yankilar, 0x18 yankilamaz,
     * 0x22 iki baytlik DID'i yankilar).
     *
     * Bu yuzden yankilanan bayt sayisi burada TAHMIN EDILMEZ; cagirandan VERI
     * olarak gelir ({@code echoBytes}). Boylece genel kopru servis kimligine gore
     * DAL SECMEZ - gorevin "generic bridge parser secmemeli" kurali korunur ve
     * yeni bir servis eklemek yalniz veri eklemek olur.
     *
     * @param service    servis bayti
     * @param subFunction alt fonksiyon (yankilanan ilk baytlar buradan baslar)
     * @param payload    govde
     * @param echoBytes  yanitta yankilanan istek bayti sayisi (0..8)
     * @return beklenen olumlu yanit oneki (ornegin "5902", "58", "62F190")
     */
    public static String positiveNeedle(String service, String subFunction,
                                        String payload, int echoBytes) {
        final String sid = normalizeHex(service);
        if (sid.length() != 2) return "";
        int svc;
        try {
            svc = Integer.parseInt(sid, 16);
        } catch (Exception e) {
            return "";
        }
        final String head = String.format(Locale.ROOT, "%02X", (svc + 0x40) & 0xFF);
        if (echoBytes <= 0) return head;
        final String tail = normalizeHex(subFunction) + normalizeHex(payload);
        final int want = Math.min(echoBytes, 8) * 2;
        return head + (tail.length() >= want ? tail.substring(0, want) : tail);
    }
}
