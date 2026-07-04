package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * ElmCommandQueueTest — Patch 5 birim testleri (yerel JVM, cihaz/emülatör gerekmez).
 *
 * Kapsam: USER önceliği POLL_FAST'in önüne geçer (en geç ÇALIŞMAKTA olan tek bir komut
 * kadar bekler — bir poll turunun TAMAMI kadar DEĞİL), clearPending() bekleyen görevleri
 * iptal eder ama çalışmakta olanı etkilemez, CancelToken ile işaretli görev hiç çalışmaz.
 */
public class ElmCommandQueueTest {

    @Test
    public void oncelikSirasi_userGorevi_calismaktaOlanKomutBitinceHemenOncelenir() throws Exception {
        ElmCommandQueue q = new ElmCommandQueue();
        try {
            List<String> order = Collections.synchronizedList(new ArrayList<>());
            CountDownLatch firstStarted = new CountDownLatch(1);
            CountDownLatch releaseFirst = new CountDownLatch(1);

            // 1. görev (POLL_FAST) ÇALIŞMAYA başlar başlamaz worker'ı meşgul tutar — bu
            // sırada iki POLL_FAST daha + bir USER görevi kuyruğa girer (poll turu simülasyonu).
            q.submit(ElmCommandQueue.Priority.POLL_FAST, null, () -> {
                order.add("poll-inflight");
                firstStarted.countDown();
                releaseFirst.await(2, TimeUnit.SECONDS);
                return null;
            });
            assertTrue("ilk görev başlamadı", firstStarted.await(2, TimeUnit.SECONDS));

            q.submit(ElmCommandQueue.Priority.POLL_FAST, null, () -> { order.add("poll-2"); return null; });
            q.submit(ElmCommandQueue.Priority.POLL_FAST, null, () -> { order.add("poll-3"); return null; });
            Future<String> userFuture = q.submit(ElmCommandQueue.Priority.USER, null, () -> { order.add("user"); return "ok"; });

            releaseFirst.countDown(); // in-flight komut biter — kuyruk işlenmeye devam eder
            assertEquals("ok", userFuture.get(2, TimeUnit.SECONDS));

            // DTC (USER) isteği, ÇALIŞMAKTA olan komutun (poll-inflight) bitmesini bekler
            // (ELM327 senkron protokolü — yarım kalamaz) ama ondan SONRA kuyrukta bekleyen
            // poll-2/poll-3'ten ÖNCE işlenir — "en geç bir komut" garantisi budur.
            Thread.sleep(50); // poll-2/poll-3'ün de işlenmesini bekle (assert tam liste görsün)
            assertEquals("poll-inflight", order.get(0));
            assertEquals("user", order.get(1));
        } finally {
            q.shutdown();
        }
    }

    @Test
    public void clearPending_bekleyenGorevleriIptalEder_calismaktaOlaniEtkilemez() throws Exception {
        ElmCommandQueue q = new ElmCommandQueue();
        try {
            CountDownLatch started = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);

            Future<String> inFlight = q.submit(ElmCommandQueue.Priority.POLL_FAST, null, () -> {
                started.countDown();
                release.await(2, TimeUnit.SECONDS);
                return "calisti";
            });
            assertTrue(started.await(2, TimeUnit.SECONDS));

            Future<String> pending = q.submit(ElmCommandQueue.Priority.POLL_FAST, null, () -> "hicbir-zaman-calismamali");
            q.clearPending();
            release.countDown();

            assertEquals("calisti", inFlight.get(2, TimeUnit.SECONDS));
            assertTrue("bekleyen görev iptal edilmemiş", pending.isCancelled());
        } finally {
            q.shutdown();
        }
    }

    @Test
    public void cancelToken_isaretliGorevHicCalismadanAtlanir() throws Exception {
        ElmCommandQueue q = new ElmCommandQueue();
        try {
            ElmCommandQueue.CancelToken token = new ElmCommandQueue.CancelToken();
            token.cancel();

            Future<String> f = q.submit(ElmCommandQueue.Priority.POLL_SLOW, token, () -> "calismamali");
            try {
                f.get(1, TimeUnit.SECONDS);
                fail("CancellationException beklenirdi");
            } catch (CancellationException expected) {
                // beklenen davranış
            }
        } finally {
            q.shutdown();
        }
    }
}
