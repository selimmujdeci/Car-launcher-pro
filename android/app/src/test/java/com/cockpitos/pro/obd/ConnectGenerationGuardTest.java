package com.cockpitos.pro.obd;

import static org.junit.Assert.*;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;

/**
 * P0-OBD-CONNECT-RACE — {@link OBDManager#connect} için TEK connect-attempt otoritesi.
 *
 * ── KÖK NEDEN (LAB kanıtı) ────────────────────────────────────────────────────
 * {@code OBDManager.connect()} 3 katmanlı RFCOMM dansı (secure→insecure→reflection)
 * ve {@code initELM327()} boyunca BLOKE olur; bu süre JS'in Promise.race timeout'undan
 * (8–28 s) UZUN sürebilir. JS vazgeçtiğinde native'e HİÇBİR iptal sinyali gitmiyordu
 * — orphan task bir SONRAKİ {@code connect()} çağrısına kadar çalışmaya devam edip
 * GEÇ biten sonucunu (başarı VEYA "socket might closed"/broken pipe) YENİ bir
 * denemenin durumuna karıştırabiliyordu (bkz. {@code OBDManager.disconnect()}
 * satır 1096-1102 "bilinen sınır" notu).
 *
 * Bu testler {@link ConnectGenerationGuard}'ın KENDİSİNİ (saf sayaç mantığı) kilitler
 * — Android/Bluetooth framework mock'u gerektirmez.
 */
public class ConnectGenerationGuardTest {

    @Test public void ilkNesil_sifirDegilBastanBaslar() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen = g.begin();
        assertTrue("nesil kimliği pozitif olmalı", gen > 0);
        assertTrue("taze başlayan tek nesil AKTİF olmalı", g.isCurrent(gen));
    }

    @Test public void ardisikBegin_ARTAN_farkliNesilUretir() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen1 = g.begin();
        int gen2 = g.begin();
        assertNotEquals("iki ayrı connect() çağrısı AYNI nesli PAYLAŞAMAZ", gen1, gen2);
        assertTrue("nesil monotonik ARTAR", gen2 > gen1);
    }

    @Test public void yeniConnect_ONCEKI_nesli_STALE_yapar() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int oldGen = g.begin();
        assertTrue(g.isCurrent(oldGen));

        int newGen = g.begin();   // JS zaman aşımına uğrayıp vazgeçti → yeni deneme

        // ÖLÇÜLEN KUSURUN TERSİ: eski nesil ARTIK stale — callback/paylaşılan
        // durum güncellemesi burada FAIL-CLOSED olarak durdurulmalı.
        assertFalse("ORPHAN olan eski deneme hâlâ 'aktif' görünüyorsa " +
            "callback/soket ataması YENİ denemeyi üzerine yazabilir", g.isCurrent(oldGen));
        assertTrue("yeni deneme AKTİF olmalı", g.isCurrent(newGen));
    }

    @Test public void ucuncuNesil_ilkIkiNesli_de_staleBirakir() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen1 = g.begin();
        int gen2 = g.begin();
        int gen3 = g.begin();

        assertFalse(g.isCurrent(gen1));
        assertFalse(g.isCurrent(gen2));
        assertTrue(g.isCurrent(gen3));
    }

    @Test public void isCurrent_yanEtkisizdir_sayaciILERLETMEZ() {
        // isCurrent() salt-okunur bir SORUdur — tekrar tekrar çağrılması nesli
        // DEĞİŞTİRMEMELİ (aksi halde OBDManager'daki 3 kontrol noktası birbirini
        // yanlışlıkla "stale" görürdü).
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen = g.begin();
        for (int i = 0; i < 5; i++) assertTrue(g.isCurrent(gen));
    }

    // ── invalidate() — BLE yolu (saha kanıtı 2026-09-13) ──────────────────────────
    // BLE'de stale'liği begin() ÜRETEMEZ: JS, BLE bacağından vazgeçip classic'e
    // geçtiğinde BleObdManager.connect() BİR DAHA ÇAĞRILMAZ, yalnız disconnect()
    // gelir. Ölçülen sonuç: terk edilmiş görev kendini geçerli sanıp 600 ms sonra
    // 2. connectGatt()'ini açtı ve SÜRMEKTE OLAN classic RFCOMM el sıkışmasını
    // düşürdü (ELM init protokol 6'yı bulduktan 465 ms sonra soket CLOSED).

    @Test public void invalidate_yeniDenemeBASLATMADAN_ucustakiNesli_STALE_yapar() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int bleGen = g.begin();
        assertTrue(g.isCurrent(bleGen));

        g.invalidate();   // JS vazgeçti → disconnect() geldi, YENİ connect() YOK

        assertFalse("disconnect() sonrası uçuştaki BLE denemesi HÂLÂ aktif görünüyorsa " +
            "retry döngüsü 2. connectGatt()'i açar ve classic RFCOMM'u düşürür",
            g.isCurrent(bleGen));
    }

    @Test public void invalidate_sonrasi_begin_TAZE_denemeyi_aktifYapar() {
        // disconnect() → connect() sırası: connect() kendi neslini disconnect()'TEN
        // SONRA almalı. Bu test o sıranın çalıştığını kilitler.
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int eskiGen = g.begin();
        g.invalidate();                 // disconnect()
        int yeniGen = g.begin();        // connect() kendi neslini ŞİMDİ alır

        assertFalse("eski deneme stale kalmalı", g.isCurrent(eskiGen));
        assertTrue("taze deneme AKTİF olmalı — aksi halde her bağlanma anında ölürdü",
            g.isCurrent(yeniGen));
    }

    @Test public void begin_invalidate_SIRASI_TERSSE_denemeKENDINI_staleYapar() {
        // TUZAK KİLİDİ: connect() içinde begin() ÖNCE, disconnect() SONRA çağrılırsa
        // deneme kendi neslini düşürür ve kontrol noktası A'da anında çıkar.
        // BleObdManager.connect() bu yüzden `disconnect(); begin();` sırasını kullanır.
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen = g.begin();
        g.invalidate();
        assertFalse("begin()→invalidate() sırası denemeyi kendi kendine öldürür — " +
            "connect() içinde disconnect() MUTLAKA begin()'den ÖNCE gelmeli",
            g.isCurrent(gen));
    }

    @Test public void tekrarliInvalidate_staleDurumunuBOZMAZ() {
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        int gen = g.begin();
        g.invalidate();
        g.invalidate();
        g.invalidate();
        assertFalse("stale kalmalı", g.isCurrent(gen));
    }

    @Test public void invalidate_begin_ile_AYNI_sayaciKullanir_nesilTekrarETMEZ() {
        // invalidate() ve begin() TEK bir sayacı paylaşır; aksi halde invalidate()
        // sonrası üretilen bir nesil, daha önce stale edilmiş bir kimliği yeniden
        // kullanabilir ve stale kontrolü delinirdi.
        ConnectGenerationGuard g = new ConnectGenerationGuard();
        java.util.Set<Integer> seen = new java.util.HashSet<>();
        for (int i = 0; i < 50; i++) {
            g.invalidate();
            assertTrue("nesil kimliği TEKRAR ETMEMELİ", seen.add(g.begin()));
        }
    }

    @Test public void esZamanliBegin_hicbirCagriKaybolmaz_hicbirNesilTekrarEtmez() throws Exception {
        // AtomicInteger tabanlı sayaç thread-safe OLMALI: aynı anda birden fazla
        // connect() çağrısı (teorik olarak — pratikte tek-thread executor bunu
        // ZATEN engeller) yine de ÇAKIŞAN/kaybolan bir nesil kimliği ÜRETMEMELİ.
        final ConnectGenerationGuard g = new ConnectGenerationGuard();
        final int threads = 8;
        final int perThread = 200;
        final CountDownLatch startLine = new CountDownLatch(1);
        final CountDownLatch done = new CountDownLatch(threads);
        final java.util.Set<Integer> seen = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
        final AtomicInteger duplicates = new AtomicInteger(0);

        Runnable worker = () -> {
            try { startLine.await(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            for (int i = 0; i < perThread; i++) {
                int gen = g.begin();
                if (!seen.add(gen)) duplicates.incrementAndGet();
            }
            done.countDown();
        };
        for (int i = 0; i < threads; i++) new Thread(worker).start();
        startLine.countDown();
        assertTrue("worker thread'ler zamanında bitmeli", done.await(5, java.util.concurrent.TimeUnit.SECONDS));

        assertEquals("hiçbir nesil kimliği TEKRAR ETMEMELİ (iki farklı connect() " +
            "denemesi AYNI nesli PAYLAŞIRSA stale kontrolü delinir)", 0, duplicates.get());
        assertEquals(threads * perThread, seen.size());
    }
}
