package com.cockpitos.pro.obd;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

/**
 * ElmCommandQueue — tek uçuşlu (in-flight), öncelik sıralı ELM327 komut kuyruğu (Patch 5).
 *
 * KÖK NEDEN: eski tasarımda PID polling (pollLoop) ve DTC okuma/silme (plugin thread'i)
 * aynı RFCOMM/GATT stream'ini bir {@code synchronized(elmLock)} bloğuyla paylaşıyordu.
 * Kullanıcı "arıza kodu oku" dediğinde elmLock'u almak için mevcut poll TURUNUN (4 PID ×
 * ~1500ms timeout = en kötü ~6s) TAMAMEN bitmesini bekliyordu — DTC isteği bir sonraki
 * poll turunun BAŞINA kadar (bugünkü ~6-9s) askıda kalabiliyordu.
 *
 * Bu sınıf, ELM327'ye giden HER komutu (poll PID okuması veya DTC isteği) TEK bir
 * yürütücü thread'de, öncelik sırasına (USER > POLL_FAST > POLL_SLOW) göre çalıştırır.
 * ELM327 protokolü senkron/tek-komutludur (bir komut yanıtı gelmeden yenisi gönderilemez)
 * — bu yüzden ÇALIŞMAKTA olan bir komut KESİLMEZ, ama kuyruğa YENİ giren USER isteği bir
 * SONRAKİ komuttan itibaren öne geçer → en kötü ihtimalle TEK bir komut kadar (~1.5s)
 * bekler, bir poll turu (4 komut) kadar DEĞİL.
 *
 * DAVRANIŞ KORUMASI: bu sınıf yalnızca komutların GÖNDERİLME SIRASINI önceliklendirir;
 * {@link ElmCommandChannel#send} davranışı, PID parse formülleri ve init dizisi HİÇ
 * değişmez — yürütülen action'lar mevcut ElmProtocol metodlarının aynısıdır.
 */
public final class ElmCommandQueue {

    /**
     * Öncelik sırası: USER (kullanıcı DTC isteği) > POLL_FAST (hız/RPM) > DISCOVERY
     * (handshake/keşif) > POLL_SLOW (sıcaklık/yakıt vb.).
     *
     * OBD-OS-F0-3 — DISCOVERY neden POLL_FAST'in ALTINDA: el sıkışması (VIN + 6 bitmap
     * bloğu) kullanıcı isteği DEĞİL, arka plan keşfidir; en kötü ~10 sn sürer. USER
     * önceliğiyle koşarken hız/RPM poll'unu (3 Hz hot-path) aç bırakıyor → data-gate
     * açlık çekip bağlantıyı "veri yok" sanarak koparıyordu (`data_gate_loss` reconnect).
     * Keşif hot-path'i PREEMPT ETMEZ: sürücünün gösterge akışı, arka plan keşfinden
     * her zaman önceliklidir.
     *
     * DİKKAT: öncelik tek başına yetmez — çalışmakta olan görev KESİLMEZ (ELM327 senkron).
     * Bu yüzden handshake ayrıca ADIM ADIM kuyruğa verilir (her ELM komutu ayrı görev),
     * böylece bloklar ARASINA POLL_FAST girebilir. Bkz. OBDManager.performHandshake.
     */
    public enum Priority { USER, POLL_FAST, DISCOVERY, POLL_SLOW }

    /**
     * Kuyruğa girmiş ama HENÜZ ÇALIŞMAMIŞ bir görevi iptal etmek için işaretleyici.
     * Çalışmakta olan (in-flight) bir komut KESİLMEZ — ELM327 senkron protokolü
     * yarım kalmış komutla bozulur; iptal yalnızca BEKLEYEN görevler için geçerlidir.
     */
    public static final class CancelToken {
        private volatile boolean cancelled = false;
        public void cancel() { cancelled = true; }
        public boolean isCancelled() { return cancelled; }
    }

    private static final class Task implements Comparable<Task> {
        final Priority priority;
        final long seq; // FIFO tie-break — aynı öncelikte giriş sırası korunur
        final Callable<Object> action;
        final CancelToken cancelToken;
        final CompletableFuture<Object> future;

        Task(Priority priority, long seq, Callable<Object> action, CancelToken cancelToken, CompletableFuture<Object> future) {
            this.priority = priority;
            this.seq = seq;
            this.action = action;
            this.cancelToken = cancelToken;
            this.future = future;
        }

        @Override
        public int compareTo(Task o) {
            int c = Integer.compare(priority.ordinal(), o.priority.ordinal());
            return c != 0 ? c : Long.compare(seq, o.seq);
        }
    }

    private final PriorityBlockingQueue<Task> queue = new PriorityBlockingQueue<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicLong seqGen = new AtomicLong();
    private volatile boolean running = true;

    public ElmCommandQueue() {
        worker.submit(this::runLoop);
    }

    private void runLoop() {
        while (running) {
            Task t;
            try {
                t = queue.take(); // bekleyen görev yoksa bloklar — CPU boşta
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            if (t.cancelToken != null && t.cancelToken.isCancelled()) {
                t.future.cancel(false);
                continue;
            }
            try {
                t.future.complete(t.action.call());
            } catch (Exception e) {
                t.future.completeExceptionally(e);
            }
        }
    }

    /**
     * Bir komutu kuyruğa ekler; sonucu {@link Future} ile döner.
     *
     * @param cancelToken opsiyonel — null ise görev iptal edilemez (ör. tek seferlik DTC isteği).
     */
    @SuppressWarnings("unchecked")
    public <T> Future<T> submit(Priority priority, CancelToken cancelToken, Callable<T> action) {
        CompletableFuture<Object> future = new CompletableFuture<>();
        queue.put(new Task(priority, seqGen.incrementAndGet(), (Callable<Object>) action, cancelToken, future));
        return (Future<T>) future;
    }

    /**
     * Kuyrukta BEKLEYEN (henüz çalışmaya başlamamış) tüm görevleri boşaltır — bağlantı
     * kesildiğinde/adaptör değiştiğinde "zehirli" (artık anlamsız) komutlar kuyrukta kalmaz.
     * Şu anda ÇALIŞMAKTA olan komut (varsa) etkilenmez — en fazla bir komut süresi kadar sürer.
     */
    public void clearPending() {
        List<Task> drained = new ArrayList<>();
        queue.drainTo(drained);
        for (Task t : drained) t.future.cancel(false);
    }

    /** Kuyruğu ve yürütücü thread'i tamamen kapatır (idempotent — tekrar çağrılabilir). */
    public void shutdown() {
        running = false;
        clearPending();
        worker.shutdownNow();
    }
}
