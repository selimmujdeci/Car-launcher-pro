package com.cockpitos.pro.obd;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * ConnectGenerationGuard — {@link OBDManager#connect} için TEK connect-attempt otoritesi.
 *
 * ── KÖK NEDEN (LAB kanıtı, saha) ─────────────────────────────────────────────
 * {@code connect()} 3 katmanlı RFCOMM dansı (secure → insecure → reflection) ve
 * ardından {@code initELM327()} boyunca {@code obdExecutor}'ın TEK thread'inde
 * BLOKE olur. Bu süre JS tarafının KENDİ {@code Promise.race} timeout'undan
 * (BLE-first 8 s + protokol sınıfına göre 15–28 s fallback) UZUN sürebilir —
 * Android'in RFCOMM stack'i (özellikle reflection ile SDP'yi atlayan 3. katman)
 * garantili bir üst sınır VERMEZ. JS zaman aşımına uğrayıp vazgeçtiğinde native'e
 * bir sonraki {@code connect()} çağrısına kadar HİÇBİR iptal sinyali gitmiyordu.
 *
 * {@link OBDManager#disconnect()} bunu KISMEN çözer (bekleyen soketi kapatır) ama
 * KENDİ yorumu bunun bir sınırı olduğunu belgeler: 3 katmanlı yolun bir sonraki
 * adımı kapanıştan HEMEN sonra kendi {@code pendingSocket}'ini kurup denemeye
 * devam edebilir — "ayrı bir connect-generation iptal mekanizması" gerekir.
 * Bu sınıf TAM OLARAK o mekanizmadır.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────────
 * Her {@code connect()} çağrısı {@link #begin()} ile BENZERSİZ bir nesil alır.
 * O nesil ile blokta geçen süre boyunca BAŞKA bir {@code connect()} çağrılmadıysa
 * (yani {@link #isCurrent} true dönüyorsa) bu deneme HÂLÂ GEÇERLİDİR — paylaşılan
 * durumu (obdSocket/elm/pollLoop) değiştirebilir, callback ateşleyebilir.
 * {@code isCurrent} FALSE dönüyorsa bu deneme STALE'dir: fail-closed davranış
 * ZORUNLUDUR — hiçbir callback ateşlenmez, hiçbir paylaşılan alan yazılmaz,
 * yalnız kendi (artık kimsenin sahiplenmediği) soketi kapatıp sessizce döner.
 *
 * SAF · thread-safe ({@link AtomicInteger}) · yan etkisiz · I/O yok.
 */
final class ConnectGenerationGuard {

    private final AtomicInteger current = new AtomicInteger(0);

    /** Yeni bir {@code connect()} denemesi başlıyor — o an AKTİF olan yeni nesli döner. */
    int begin() {
        return current.incrementAndGet();
    }

    /**
     * Uçuştaki denemeyi YENİ deneme başlatmadan GEÇERSİZ kılar.
     *
     * ── NEDEN AYRI BİR GİRİŞ NOKTASI (BLE yolu · saha kanıtı 2026-09-13) ────────
     * Classic yolda stale'liği {@link #begin()} üretir: JS vazgeçtiğinde ARDINDAN
     * hep yeni bir {@code connect()} gelir ve nesil böylece ilerler. BLE yolunda bu
     * VARSAYIM TUTMAZ: JS, BLE bacağından vazgeçip {@code classic}'e geçtiğinde
     * {@code BleObdManager.connect()} bir daha ÇAĞRILMAZ — yalnız {@code disconnect()}
     * gelir. Nesil ilerlemediği için uçuştaki BLE görevi kendini HÂLÂ GEÇERLİ sanar,
     * 600 ms sonra 2. {@code connectGatt()}'ini açar ve o kaçak LE bağlantısı, aynı
     * dual-mode dongle üzerinde SÜRMEKTE OLAN classic RFCOMM el sıkışmasını düşürür.
     * (Ölçüldü: ELM init protokol 6'yı tespit ettikten 465 ms sonra soket CLOSED.)
     *
     * Bu yüzden {@code disconnect()} yolunun, yeni bir deneme başlatmadan nesli
     * ilerletebilmesi gerekir. Sözleşme {@link #begin()} ile AYNIDIR: bu çağrıdan
     * sonra eski nesil için {@link #isCurrent} FALSE döner ve o deneme fail-closed
     * davranmak ZORUNDADIR.
     */
    void invalidate() {
        current.incrementAndGet();
    }

    /** Verilen nesil hâlâ AKTİF nesil mi (aradan başka bir {@link #begin()} geçmedi mi)? */
    boolean isCurrent(int generation) {
        return current.get() == generation;
    }
}
