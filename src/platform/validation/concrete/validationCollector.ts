/**
 * validationCollector — Saha Doğrulama Modu'nun composition root'u.
 *
 * ⚠️ YENİ ÖLÇÜM MOTORU DEĞİLDİR. MEVCUT tanı erişimcilerini SALT-OKUNUR
 * örnekler ve `validationRecorder`'a yazar. Tek bir OBD komutu göndermez,
 * tek bir servis davranışını değiştirmez:
 *
 *   getHandshakeDiagnostics()  → protokol · VIN varlığı · PID sayısı · süre
 *   getTransportStats()        → transport · yeniden bağlanma denemesi
 *   getObdConnLifecycle()      → kopma sayısı · kurtarma · son paket yaşı
 *   getDTCStateSnapshot()      → arıza kodu sayısı
 *   obdDiagnosticRecorder      → adaptör adı/maskeli adres (mevcut oturum)
 *   onOBDData()                → canlı paket varışı (polling aralığı)
 *   performance.memory / rAF   → bellek · FPS (altyapı varsa)
 *
 * ── YAŞAM DÖNGÜSÜ (SAHA SÖZLEŞMESİ) ─────────────────────────────────────────
 * `startValidationCollector()` YALNIZ şalter açıkken çalışır (fail-closed).
 *
 * ⚠️ Oturum, panel KAPANINCA DURMAZ. Bir yol testi boyunca teknisyenin debug
 * panelini açık tutması imkânsızdır (harita, sürüş, telefon uykusu); panelin
 * kapanması kaydı bitirseydi saha testi hiç yapılamazdı. Bu yüzden kayıt
 * AÇIKÇA başlatılır ve AÇIKÇA durdurulur.
 *
 * Bunun bedeli sınırlıdır ve bilinçlidir: yalnız 1 sn'lik örnekleyici + 1 rAF
 * sayacı + mevcut `onOBDData` aboneliği. Unutulmuş oturum için `MAX_SESSION_MS`
 * mutlak tavanı vardır (aşılırsa kendiliğinden durur). Kayıt başlatılmadıysa
 * hiçbir kaynak tüketilmez — "kapalıyken sıfır ek yük" sözü korunur.
 *
 * Durdurulduğunda kaydedilen tüm disposer'lar çalışır: abonelik, zamanlayıcı
 * ve rAF döngüsü kapanır (zero-leak); toplanan veri rapor için OKUNABİLİR kalır.
 */

import {
  getHandshakeDiagnostics,
  getOBDDataSnapshot,
  getObdConnLifecycle,
  getTransportStats,
  onOBDData,
} from '../../obdService';
import { loadObdAddress } from '../../obdStorage';
import { getDTCStateSnapshot } from '../../dtcService';
import { getSession as getObdDiagSession, maskMac } from '../../obdDiagnosticRecorder';
import { getHandshakeVin } from '../../safety/vinContext';
import { maskVin } from '../validationExport';
import { isValidationModeEnabled } from '../validationFlag';
import {
  isSessionExpired,
  isValidationActive,
  recordDataAge,
  recordFpsSample,
  recordLivePacket,
  recordLog,
  recordMemorySample,
  recordObdDisconnect,
  recordObdMetrics,
  recordPerfCounters,
  registerValidationDisposer,
  startValidationSession,
  stopValidationSession,
} from '../validationRecorder';

/** Örnekleme periyodu — 1 sn (mevcut debugStore Hz örneklemesiyle aynı kadans). */
const SAMPLE_INTERVAL_MS = 1_000;

let _lastConnState = '';
/** Bu örnekleme turuna kadar gözlenen canlı paket sayısı (gecikme kapısı için). */
let _pktSeen = 0;
let _pktSeenAtLastSample = -1;

/** Bağlı sayılan durumlar — bunların DIŞINA çıkış bir kopmadır. */
const CONNECTED_STATES: ReadonlySet<string> = new Set(['connected']);

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

/** JS heap kullanımı (MB) — WebView sağlamıyorsa `null` (uydurma yok). */
function readMemoryMb(): number | null {
  try {
    const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
    const used = perf.memory?.usedJSHeapSize;
    if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return null;
    return Math.round((used / (1024 * 1024)) * 10) / 10;
  } catch {
    return null;
  }
}

/** Bir örnekleme turu — MEVCUT erişimcilerden okur, ASLA throw etmez. */
function sampleOnce(): void {
  try {
    const hs   = getHandshakeDiagnostics();
    const tr   = getTransportStats();
    const life = getObdConnLifecycle();
    const dtc  = getDTCStateSnapshot();
    const diag = getObdDiagSession();

    /* DTC: hiç okuma yapılmadıysa sayı UYDURULMAZ → null. */
    const dtcCount = dtc.lastReadAt === null ? null : dtc.codes.length;

    /* Timeout: reconnect geçmişindeki `timeout` nedenli kayıtlar. */
    const timeoutCount = hs.reconnectHistory.reduce((n, r) => n + (r.reason === 'timeout' ? 1 : 0), 0);

    /* ADAPTÖR — MEVCUT gerçek kaynaklar; yeni keşif YAZILMAZ.
       Öncelik: obdDiagnosticRecorder oturumu (yalnız OBDConnectModal ile bağlanınca
       dolar) → yoksa obdService'in canlı `deviceName`'i + kalıcı adres (maskeli).
       Hiçbiri yoksa `null` — boş string ile "bilinmiyor"u karıştırma. */
    const liveName = (getOBDDataSnapshot().deviceName ?? '').trim();
    const storedAddr = (() => { try { return loadObdAddress(); } catch { return null; } })();
    const adapterName = diag.device?.name?.trim() || liveName || null;
    const adapterAddrMasked =
      diag.device?.addrMasked || (storedAddr ? maskMac(storedAddr) : null);

    recordObdMetrics({
      connectStartedWallMs: hs.ranAt,
      connectDurationMs:    hs.durationMs,
      adapterName,
      adapterAddrMasked,
      transport:            tr.transport,
      protocolTried:        hs.protocolTried,
      protocolActive:       hs.protocolActive,
      vinPresent:           hs.vinPresent,
      vinMasked:            maskVin(getHandshakeVin()),
      pidCount:             hs.supportedCount,
      dtcCount,
      reconnectAttempts:    tr.reconnectAttempts,
    });

    recordPerfCounters(timeoutCount, life.resetCompletedCount);

    /* GECİKME ÖRNEĞİ — İKİ KAPI (ikisi de gerekli):
         1) bağlantı AKTİF (kopuk/reconnecting dönemleri ortalamaya GİRMEZ),
         2) bu tur içinde GERÇEKTEN yeni paket geldi (aksi halde ölçülen şey
            gecikme değil, sessizliğin süresidir).
       Geçerli örnek yoksa hiçbir şey kaydedilmez → metrik `null` kalır. */
    const connected = CONNECTED_STATES.has(life.connectionState);
    const yeniPaketVar = _pktSeen > _pktSeenAtLastSample;
    if (connected && yeniPaketVar && life.lastPacketAgeMs >= 0) {
      recordDataAge(life.lastPacketAgeMs);
    }
    _pktSeenAtLastSample = _pktSeen;

    const mem = readMemoryMb();
    if (mem !== null) recordMemorySample(mem);

    /* KOPMA — KENAR tetiklemeli: yalnız 'connected' durumundan ÇIKIŞ bir kopmadır.
       Aynı kopmanın sonraki turlarında durum zaten 'connected' değildir → tekrar
       sayılmaz. Böylece tek fiziksel olay tek kez sayılır. */
    if (life.connectionState !== _lastConnState) {
      const oncekiBagli = CONNECTED_STATES.has(_lastConnState);
      const simdiBagli  = CONNECTED_STATES.has(life.connectionState);
      if (oncekiBagli && !simdiBagli) recordObdDisconnect();
      recordLog('obd', 'info', `Bağlantı durumu: ${life.connectionState}.`);
      _lastConnState = life.connectionState;
    }

    /* Unutulmuş oturum koruması — mutlak tavan aşıldıysa kendiliğinden durur. */
    if (isSessionExpired()) {
      recordLog('system', 'warn', 'Azami oturum süresi doldu — kayıt otomatik durduruldu.');
      stopValidationSession();
    }
  } catch {
    /* Örnekleme hatası oturumu DÜŞÜRMEZ — bir tur atlanır (fail-soft). */
  }
}

/* ── Yaşam döngüsü ─────────────────────────────────────────────────────────── */

/**
 * Doğrulama oturumunu başlatır. Şalter kapalıysa HİÇBİR ŞEY yapmaz ve `false`
 * döner (fail-closed). Zaten çalışıyorsa yeniden başlatmaz.
 *
 * @returns oturum başlatıldı mı
 */
export function startValidationCollector(): boolean {
  if (isValidationActive()) return true;
  if (!isValidationModeEnabled()) return false;

  _lastConnState = '';
  _pktSeen = 0;
  _pktSeenAtLastSample = -1;
  startValidationSession();

  /* 1) Canlı OBD paketleri — MEVCUT yayın; ek sorgu YOK. */
  try {
    const off = onOBDData(() => { _pktSeen++; recordLivePacket(); });
    registerValidationDisposer(off);
  } catch { /* abonelik kurulamadı — diğer ölçümler devam eder */ }

  /* 2) Periyodik örnekleme. */
  const timer = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
  registerValidationDisposer(() => clearInterval(timer));

  /* 3) FPS — yalnız oturum boyunca çalışan rAF sayacı. */
  if (typeof requestAnimationFrame === 'function') {
    let raf = 0;
    let frames = 0;
    let last = typeof performance !== 'undefined' ? performance.now() : 0;
    let stopped = false;

    const tick = (now: number): void => {
      if (stopped) return;
      frames++;
      const dt = now - last;
      if (dt >= 1_000) {
        recordFpsSample((frames * 1_000) / dt);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    registerValidationDisposer(() => { stopped = true; cancelAnimationFrame(raf); });
  }

  sampleOnce();                 // ilk tur — panel açılır açılmaz dolu görünsün
  return true;
}

/** Oturumu durdurur ve tüm kaynakları serbest bırakır (zero-leak). */
export function stopValidationCollector(): void {
  stopValidationSession();
}
