package com.cockpitos.pro.obd;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * PollCostLedger — OBD hattının GERÇEK maliyetinin TEK muhasebe otoritesi (P0-VDK-B3).
 *
 * <h3>Neden (saha 2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA 1788096650111)</h3>
 * Kopyada {@code attempted:117 · success:117 · noData:0} yazıyordu — hat kusursuz
 * görünüyordu. AYNI oturumun ham trafiğinde ise onlarca {@code NO DATA}, {@code 7F1912}
 * ve her istek çevresinde dört AT komutu ({@code ATSH7DF·ATAR·ATSH7E0·ATCRA7E8}, her
 * biri ~41 ms) vardı. İkisi çelişmiyordu: {@link ExtendedPollEvidence} YALNIZ EXTENDED
 * PID denemelerini sayıyor; FAST/SLOW/VERY_SLOW grubu, {@code ATRV}, tüm AT yönetim
 * komutları ve tarama yolunun trafiği <b>hiçbir sayaçta yoktu</b>. Yani ürün kendi
 * hat maliyetinin büyük kısmını ÖLÇMÜYORDU.
 *
 * <h3>Sözleşme</h3>
 * <ul>
 *   <li><b>Yalnız muhasebe.</b> Bu sınıf scheduler DEĞİLDİR: PID seçmez, bütçe
 *       dağıtmaz, komut göndermez, timer kurmaz, hiçbir kararı geri beslemez.
 *       Poll otoritesi {@link OBDManager#pollLoop} + {@link AdaptivePidScheduler}'da
 *       KALIR; bu defter onların ürettiği trafiği SAYAR.</li>
 *   <li><b>Kullanıcı verisi ile adaptör yönetimi AYRI.</b> "8 PID + 5 AT" asla
 *       "13 istek" diye toplanmaz — iki sınıf ayrı taşınır.</li>
 *   <li><b>Sahte sıfır YASAK.</b> Ölçülemeyen alan {@link #UNKNOWN} (-1) taşır ve
 *       köprüde {@code null}'a çevrilir. "Ölçmedik" ile "sıfırdı" AYRI şeydir.</li>
 *   <li><b>Teşhis yakalamasından BAĞIMSIZ.</b> {@code emitTraffic} yalnız capture
 *       açıkken çalışır; maliyet muhasebesi HER ZAMAN çalışır — aksi hâlde ölçüm
 *       ancak birisi LAB'ı açtığında var olurdu.</li>
 * </ul>
 *
 * Thread-safety: tek {@code lock}; poll thread'i yazar, plugin thread'i okur
 * (aynı desen: {@link ExtendedPollEvidence}). Tüm sayaçlar doygun (saturating).
 */
public final class PollCostLedger {

    public static final PollCostLedger INSTANCE = new PollCostLedger();

    /** Ölçülemedi göstergesi. Köprüde {@code null} olur — 0 ile KARIŞTIRILMAZ. */
    public static final int UNKNOWN = -1;

    /** Doygunluk tavanı — sayaç taşması yerine sabitlenir (kanıt yanlış yöne kaymasın). */
    private static final int SAT = 1_000_000;
    /** Son N tur bounded halkada tutulur (LAB gösterimi). */
    private static final int CYCLE_RING_CAP = 32;

    /**
     * Komut maliyet sınıfları — TEK kaynak. Sınıflandırma başka hiçbir yerde
     * TEKRARLANMAZ (kopya sınıflandırma ikinci otorite olurdu).
     */
    public enum CostClass {
        /** Kullanıcı/teşhis VERİSİ üreten istek: Mode 01/03/07/09/19/22/2F… */
        DIAGNOSTIC_PAYLOAD,
        /** Adresleme/filtre yönetimi: ATSH · ATCRA · ATCP · ATFCSH · ATAR. */
        HEADER_SWITCH,
        /** Adaptör besleme okuması: ATRV. */
        VOLTAGE_READ,
        /** Protokol sorgusu/seçimi: ATDP · ATDPN · ATSP · ATTP. */
        PROTOCOL_CHECK,
        /** Diğer tüm adaptör yönetimi: ATE/ATL/ATS/ATH/ATST/ATZ/ATWS/ATI/ATFC*… */
        ADAPTER_CONTROL,
    }

    /** Komutu maliyet sınıfına ayırır. SAF ve deterministik — test edilebilir tek nokta. */
    public static CostClass classify(String cmd) {
        if (cmd == null) return CostClass.DIAGNOSTIC_PAYLOAD;
        String c = cmd.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (!c.startsWith("AT") && !c.startsWith("ST")) return CostClass.DIAGNOSTIC_PAYLOAD;
        if (c.startsWith("ATRV")) return CostClass.VOLTAGE_READ;
        /* ATAR burada: CRA alım filtresini kapatır → ADRESLEME durumudur, çıktı biçimi
           değil. ATH0/ATH1 ise başlık BASIMIDIR (çıktı biçimi) → ADAPTER_CONTROL. */
        if (c.startsWith("ATSH") || c.startsWith("ATCRA") || c.startsWith("ATCP")
                || c.startsWith("ATFCSH") || c.startsWith("ATAR")) return CostClass.HEADER_SWITCH;
        if (c.startsWith("ATDP") || c.startsWith("ATSP") || c.startsWith("ATTP")) return CostClass.PROTOCOL_CHECK;
        return CostClass.ADAPTER_CONTROL;
    }

    /** Yanıt "bilgi üretmedi" mi (NO DATA · boş · hata sarmalayıcısı · timeout)? */
    static boolean isNoResponse(String resp) {
        if (resp == null) return true;
        String r = resp.trim().toUpperCase(Locale.ROOT);
        if (r.isEmpty()) return true;
        return r.startsWith("NO DATA") || r.startsWith("NODATA") || r.equals("?")
            || r.startsWith("STOPPED") || r.startsWith("UNABLE") || r.startsWith("CAN ERROR")
            || r.startsWith("CANERROR") || r.startsWith("BUS") || r.startsWith("TIMEOUT")
            || r.startsWith("ERR") || r.startsWith("⚠");
    }

    /** Yanıt NEGATİF yanıt mı ({@code 7F <sid> <nrc>})? "Cevap yok" ile AYNI DEĞİLDİR. */
    static boolean isNegativeResponse(String resp) {
        if (resp == null) return false;
        String r = resp.replaceAll("[\\s>]", "").toUpperCase(Locale.ROOT);
        return r.startsWith("7F") || r.contains(":7F");
    }

    /** Tek turun maliyeti — değişmez kopya. */
    public static final class CycleCost {
        public final long cycleId;
        public final long sessionEpoch;
        public final boolean burst;
        /** Kullanıcı/teşhis verisi üreten istek adedi. */
        public final int diagnosticPayloadRequests;
        /** Adaptör yönetim komutu adedi (AT toplamı — aşağıdaki üç sınıf DAHİL). */
        public final int adapterControlCommands;
        public final int headerSwitches, voltageReads, protocolChecks;
        /** Hiç kullanılmadan bir sonraki ATSH/ATCRA ile ezilen adresleme komutu. */
        public final int redundantHeaderSwitches;
        public final int noResponses, negativeResponses;
        /** Bilgi üretmeyen yanıtlarda harcanan süre (ms) — 0 SAYILMAZ. */
        public final long noResponseMs;
        public final long payloadMs, adapterMs, elapsedMs;
        public final long bytesTx, bytesRx;
        /** Ölçülmediyse {@link #UNKNOWN}. */
        public final int retries;
        public final String provenance;

        CycleCost(long cycleId, long sessionEpoch, boolean burst,
                  int diagnosticPayloadRequests, int adapterControlCommands,
                  int headerSwitches, int voltageReads, int protocolChecks,
                  int redundantHeaderSwitches, int noResponses, int negativeResponses,
                  long noResponseMs, long payloadMs, long adapterMs, long elapsedMs,
                  long bytesTx, long bytesRx, int retries, String provenance) {
            this.cycleId = cycleId; this.sessionEpoch = sessionEpoch; this.burst = burst;
            this.diagnosticPayloadRequests = diagnosticPayloadRequests;
            this.adapterControlCommands = adapterControlCommands;
            this.headerSwitches = headerSwitches; this.voltageReads = voltageReads;
            this.protocolChecks = protocolChecks;
            this.redundantHeaderSwitches = redundantHeaderSwitches;
            this.noResponses = noResponses; this.negativeResponses = negativeResponses;
            this.noResponseMs = noResponseMs; this.payloadMs = payloadMs;
            this.adapterMs = adapterMs; this.elapsedMs = elapsedMs;
            this.bytesTx = bytesTx; this.bytesRx = bytesRx;
            this.retries = retries; this.provenance = provenance;
        }
    }

    /** Oturum toplamı + son turlar. */
    public static final class Snapshot {
        public final boolean present;
        public final long sessionEpoch;
        public final int totalPayloadRequests, totalAdapterCommands, totalHeaderSwitches,
                totalVoltageReads, totalProtocolChecks, totalRedundantHeaderSwitches,
                totalNoResponses, totalNegativeResponses;
        public final long totalNoResponseMs, totalPayloadMs, totalAdapterMs, totalBytesTx, totalBytesRx;
        public final int cyclesRecorded, burstCyclesRecorded;
        /** Kuyruk önceliği bilinmeden gelen komutlar (handshake/keşif) — dürüst boşluk. */
        public final int unattributedCommands;
        public final CycleCost lastCycle;
        public final List<CycleCost> recentCycles;

        Snapshot(boolean present, long sessionEpoch,
                 int totalPayloadRequests, int totalAdapterCommands, int totalHeaderSwitches,
                 int totalVoltageReads, int totalProtocolChecks, int totalRedundantHeaderSwitches,
                 int totalNoResponses, int totalNegativeResponses,
                 long totalNoResponseMs, long totalPayloadMs, long totalAdapterMs,
                 long totalBytesTx, long totalBytesRx,
                 int cyclesRecorded, int burstCyclesRecorded, int unattributedCommands,
                 CycleCost lastCycle, List<CycleCost> recentCycles) {
            this.present = present; this.sessionEpoch = sessionEpoch;
            this.totalPayloadRequests = totalPayloadRequests;
            this.totalAdapterCommands = totalAdapterCommands;
            this.totalHeaderSwitches = totalHeaderSwitches;
            this.totalVoltageReads = totalVoltageReads;
            this.totalProtocolChecks = totalProtocolChecks;
            this.totalRedundantHeaderSwitches = totalRedundantHeaderSwitches;
            this.totalNoResponses = totalNoResponses;
            this.totalNegativeResponses = totalNegativeResponses;
            this.totalNoResponseMs = totalNoResponseMs;
            this.totalPayloadMs = totalPayloadMs;
            this.totalAdapterMs = totalAdapterMs;
            this.totalBytesTx = totalBytesTx; this.totalBytesRx = totalBytesRx;
            this.cyclesRecorded = cyclesRecorded; this.burstCyclesRecorded = burstCyclesRecorded;
            this.unattributedCommands = unattributedCommands;
            this.lastCycle = lastCycle;
            this.recentCycles = java.util.Collections.unmodifiableList(recentCycles);
        }
    }

    private final Object lock = new Object();

    private boolean present = false;
    private long sessionEpoch = 0;
    private long currentCycleId = 0;
    private boolean currentBurst = false;
    private boolean cycleOpen = false;
    private long cycleStartedAt = 0;

    // ── Açık turun sayaçları ────────────────────────────────────────────────
    private int cPayload, cAdapter, cHeader, cVoltage, cProtocol, cRedundant, cNoResp, cNegResp;
    private long cNoRespMs, cPayloadMs, cAdapterMs, cBytesTx, cBytesRx;

    // ── Oturum toplamları ───────────────────────────────────────────────────
    private int tPayload, tAdapter, tHeader, tVoltage, tProtocol, tRedundant, tNoResp, tNegResp;
    private long tNoRespMs, tPayloadMs, tAdapterMs, tBytesTx, tBytesRx;
    private int cyclesRecorded, burstCyclesRecorded, unattributedCommands;

    /* Gereksiz adresleme tespiti: bir ATSH/ATCRA yazıldıktan sonra HİÇ payload komutu
       gitmeden yeni bir ATSH/ATCRA gelirse, önceki yazımın tek etkisi boşa gitmiştir.
       Bu SAF bir gözlemdir — hiçbir komut bu yüzden atlanmaz (kör optimizasyon yasağı). */
    private boolean headerWrittenUnused = false;

    private final ArrayDeque<CycleCost> ring = new ArrayDeque<>(CYCLE_RING_CAP);

    private PollCostLedger() { /* tekil */ }

    private static int sadd(int a) { return a >= SAT ? SAT : a + 1; }
    private static long sadd(long a, long b) { return a >= SAT ? SAT : Math.min(SAT, a + Math.max(0, b)); }

    /** Yeni bağlantı = yeni muhasebe dönemi. Niyet alanı YOKTUR; her şey oturumluktur. */
    public void reset(long epoch) {
        synchronized (lock) {
            present = true;
            sessionEpoch = epoch;
            currentCycleId = 0; currentBurst = false; cycleOpen = false; cycleStartedAt = 0;
            cPayload = cAdapter = cHeader = cVoltage = cProtocol = cRedundant = cNoResp = cNegResp = 0;
            cNoRespMs = cPayloadMs = cAdapterMs = cBytesTx = cBytesRx = 0;
            tPayload = tAdapter = tHeader = tVoltage = tProtocol = tRedundant = tNoResp = tNegResp = 0;
            tNoRespMs = tPayloadMs = tAdapterMs = tBytesTx = tBytesRx = 0;
            cyclesRecorded = burstCyclesRecorded = unattributedCommands = 0;
            headerWrittenUnused = false;
            ring.clear();
        }
    }

    /** Poll turu başladı. Açık tur varsa önce kapatılır (kayıp tur üretilmez). */
    public void beginCycle(long cycleId, boolean burst, long nowMs) {
        synchronized (lock) {
            if (cycleOpen) closeCycleLocked(nowMs);
            present = true;
            currentCycleId = cycleId; currentBurst = burst;
            cycleOpen = true; cycleStartedAt = nowMs;
            cPayload = cAdapter = cHeader = cVoltage = cProtocol = cRedundant = cNoResp = cNegResp = 0;
            cNoRespMs = cPayloadMs = cAdapterMs = cBytesTx = cBytesRx = 0;
        }
    }

    /** Poll turu bitti — açık tur halkaya ve oturum toplamına işlenir. */
    public void endCycle(long nowMs) {
        synchronized (lock) { if (cycleOpen) closeCycleLocked(nowMs); }
    }

    /**
     * TEK muhasebe girişi — her {@code ElmCommandChannel.send()} çağrısı buradan geçer.
     * Teşhis yakalamasından BAĞIMSIZ çalışır.
     *
     * @param cmd       gönderilen ham komut
     * @param resp      alınan ham yanıt (null = yanıt yok / istisna)
     * @param elapsedMs komutun gerçek süresi
     */
    public void noteCommand(String cmd, String resp, long elapsedMs) {
        final CostClass k = classify(cmd);
        final boolean noResp = isNoResponse(resp);
        final boolean negResp = !noResp && isNegativeResponse(resp);
        final long ms = Math.max(0, elapsedMs);
        final long tx = cmd == null ? 0 : cmd.length() + 1;   // + CR
        final long rx = resp == null ? 0 : resp.length();

        synchronized (lock) {
            present = true;
            cBytesTx = sadd(cBytesTx, tx); cBytesRx = sadd(cBytesRx, rx);
            tBytesTx = sadd(tBytesTx, tx); tBytesRx = sadd(tBytesRx, rx);

            if (k == CostClass.DIAGNOSTIC_PAYLOAD) {
                cPayload = sadd(cPayload); tPayload = sadd(tPayload);
                cPayloadMs = sadd(cPayloadMs, ms); tPayloadMs = sadd(tPayloadMs, ms);
                /* Payload gitti → bekleyen adresleme yazımı KULLANILDI. */
                headerWrittenUnused = false;
            } else {
                cAdapter = sadd(cAdapter); tAdapter = sadd(tAdapter);
                cAdapterMs = sadd(cAdapterMs, ms); tAdapterMs = sadd(tAdapterMs, ms);
                switch (k) {
                    case HEADER_SWITCH:
                        cHeader = sadd(cHeader); tHeader = sadd(tHeader);
                        /* Önceki adresleme yazımı hiç kullanılmadan eziliyor. */
                        if (headerWrittenUnused) { cRedundant = sadd(cRedundant); tRedundant = sadd(tRedundant); }
                        headerWrittenUnused = true;
                        break;
                    case VOLTAGE_READ:
                        cVoltage = sadd(cVoltage); tVoltage = sadd(tVoltage); break;
                    case PROTOCOL_CHECK:
                        cProtocol = sadd(cProtocol); tProtocol = sadd(tProtocol); break;
                    default: break;
                }
            }

            if (noResp) {
                cNoResp = sadd(cNoResp); tNoResp = sadd(tNoResp);
                cNoRespMs = sadd(cNoRespMs, ms); tNoRespMs = sadd(tNoRespMs, ms);
            } else if (negResp) {
                cNegResp = sadd(cNegResp); tNegResp = sadd(tNegResp);
                /* Negatif yanıt da BİLGİ ÜRETMEYEN maliyettir — süresi ayrıca sayılır. */
                cNoRespMs = sadd(cNoRespMs, ms); tNoRespMs = sadd(tNoRespMs, ms);
            }

            if (!cycleOpen) unattributedCommands = sadd(unattributedCommands);
        }
    }

    private void closeCycleLocked(long nowMs) {
        long elapsed = cycleStartedAt > 0 ? Math.max(0, nowMs - cycleStartedAt) : 0;
        CycleCost c = new CycleCost(
            currentCycleId, sessionEpoch, currentBurst,
            cPayload, cAdapter, cHeader, cVoltage, cProtocol, cRedundant,
            cNoResp, cNegResp, cNoRespMs, cPayloadMs, cAdapterMs, elapsed,
            cBytesTx, cBytesRx,
            /* Retry muhasebesi bu katmanda YOK: `send()` tek denemedir, yeniden bağlanma
               ise poll bütçesinin değil bağlantı otoritesinin işidir. Sahte 0 yerine
               açıkça ÖLÇÜLMEDİ. */
            UNKNOWN,
            "NATIVE_MEASURED");
        if (ring.size() >= CYCLE_RING_CAP) ring.pollFirst();
        ring.addLast(c);
        cyclesRecorded = sadd(cyclesRecorded);
        if (currentBurst) burstCyclesRecorded = sadd(burstCyclesRecorded);
        cycleOpen = false;
    }

    public Snapshot snapshot() {
        synchronized (lock) {
            return new Snapshot(present, sessionEpoch,
                tPayload, tAdapter, tHeader, tVoltage, tProtocol, tRedundant,
                tNoResp, tNegResp, tNoRespMs, tPayloadMs, tAdapterMs, tBytesTx, tBytesRx,
                cyclesRecorded, burstCyclesRecorded, unattributedCommands,
                ring.isEmpty() ? null : ring.peekLast(),
                new ArrayList<>(ring));
        }
    }
}
