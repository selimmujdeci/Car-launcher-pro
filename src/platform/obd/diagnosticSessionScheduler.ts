/**
 * diagnosticSessionScheduler — P0-VDK-F1B · KEEPALIVE ZAMANLAYICI (TEK SAHİP).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `diagnosticSessionLease` SAFTIR (zaman dışarıdan verilir, timer yok). Bu
 * dosya onun tek yan-etkili kabuğudur: zamanlayıcıyı KURAR, native `3E`yi
 * GÖNDERİR, kanıtı YAZAR. Saf çekirdeği kirletmemek bilinçlidir — yaşam
 * döngüsü kuralları gerçek saat olmadan, deterministik test edilebilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ZAMANLAYICI SAHİPLİĞİ (pazarlıksız) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * · **TEK `setInterval`** — kira başına timer YOKTUR. "Interval çiftliği"
 *   kurmak, sızıntının ve birbirini ezen zamanlayıcıların klasik yoludur.
 * · Timer YALNIZ canlı kira varken çalışır; son kira düşünce **durdurulur**.
 * · Her tur `_stopIfIdle()` çağrılır → sızıntı yapısal olarak imkânsız.
 * · Saat ENJEKTE EDİLEBİLİR (`_setSchedulerClockForTest`) → testler gerçek
 *   uyku BEKLEMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) İkinci oturum otoritesi değil — oturumu native açar, bu yalnız canlı tutar.
 * (2) İkinci recovery otoritesi değil — hiçbir reconnect/recovery BAŞLATMAZ.
 * (3) Yazma kapısı değil — `3E` hiçbir yetki açmaz.
 * (4) Canlı PID polling'e dokunmaz — keepalive `DISCOVERY` önceliğiyle gider
 *     (native), yani kullanıcı okumalarını GECİKTİRMEZ.
 */

import { vdkTesterPresentFn } from './vdkTransport';
import { logError } from '../crashLogger';
import { getObdSessionEpoch } from '../obdService';
import {
  applyKeepAliveOutcome, applySessionEvidence, closeSessionLease, createSessionLease,
  isKeepAliveDue, isLeaseEpochValid, isSessionTerminal, markKeepAliveSent,
  type DiagnosticSessionLease, type KeepAliveOutcome,
} from './diagnosticSessionLease';
import { recordSessionEvidence } from './diagnosticSessionEvidence';
import { traceFromTransaction } from './traceRecorder';
import {
  isTerminalState, type DiagnosticTransaction,
} from './diagnosticTransaction';

/** Zamanlayıcı turu — keepalive aralığının BÖLENİ olmalı (aşırı erken/geç yok). */
const TICK_MS = 1_000;

let _leases: DiagnosticSessionLease[] = [];
let _timer: ReturnType<typeof setInterval> | null = null;
let _now: () => number = Date.now;
let _seq = 0;
/** Uçuştaki keepalive'lar — aynı kiraya ikinci istek gönderilmez. */
const _inFlight = new Set<string>();

/* ── Test kancaları — üretim yolunda ÇAĞRILMAZ ─────────────────────────── */
export function _setSchedulerClockForTest(fn: () => number): void { _now = fn; }
export function _resetSchedulerForTest(): void {
  stopSchedulerTimer();
  _leases = []; _seq = 0; _now = Date.now; _inFlight.clear();
}
/** Testte turu ELLE ilerletir — gerçek uyku BEKLENMEZ. */
export async function _tickSchedulerForTest(): Promise<void> { await _tick(); }
export function _isSchedulerTimerRunning(): boolean { return _timer !== null; }

export function getSessionLeases(): readonly DiagnosticSessionLease[] { return [..._leases]; }

export function getLeaseForTransaction(
  transactionId: string, rxHeader: string | null,
): DiagnosticSessionLease | null {
  return _leases.find((l) =>
    l.transactionId === transactionId && l.ecuEndpoint.rxHeader === rxHeader) ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   KİRA AÇMA / KAPAMA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir ECU için kira açar. Timer HENÜZ başlamaz — oturum kanıtı gelene kadar
 * canlı tutulacak bir şey YOKTUR.
 *
 * ⚠️ Aynı (işlem × ECU) için ikinci kira AÇILMAZ; mevcut kira döner. Bu,
 * "aynı ECU için paralel timer" sınıfını yapısal olarak imkânsız kılar.
 */
export function openSessionLease(
  txn: DiagnosticTransaction,
  ecu: { txHeader: string | null; rxHeader: string | null; addressBits: number | null; label: string },
  protocol: string | null,
): DiagnosticSessionLease {
  const existing = getLeaseForTransaction(txn.transactionId, ecu.rxHeader);
  if (existing !== null && !isSessionTerminal(existing.state)) return existing;

  const lease = createSessionLease({
    leaseId: `lease-${++_seq}-${txn.transactionId}`,
    transactionId: txn.transactionId,
    ecuEndpoint: ecu,
    protocol,
    sessionEpoch: txn.sessionEpoch,
    nowMs: _now(),
  });
  _leases.push(lease);
  if (_leases.length > 32) _leases = _leases.slice(-32);
  recordSessionEvidence({
    kind: 'SESSION_OPEN_ATTEMPT', leaseId: lease.leaseId,
    transactionId: txn.transactionId, evidenceCorrelationId: txn.evidenceCorrelationId,
    rxHeader: ecu.rxHeader, txHeader: ecu.txHeader, protocol,
    sessionEpoch: txn.sessionEpoch, atMs: _now(), detail: `ECU ${ecu.label}`,
  });
  return lease;
}

/** Bu işleme ait TÜM kiraları kapatır — keepalive KESİN durur. */
export function closeLeasesForTransaction(txn: DiagnosticTransaction, reason: string): void {
  for (const l of _leases) {
    if (l.transactionId !== txn.transactionId) continue;
    if (isSessionTerminal(l.state)) continue;
    closeSessionLease(l, reason);
    recordSessionEvidence({
      kind: 'SESSION_CLOSED', leaseId: l.leaseId, transactionId: l.transactionId,
      evidenceCorrelationId: txn.evidenceCorrelationId,
      rxHeader: l.ecuEndpoint.rxHeader, txHeader: l.ecuEndpoint.txHeader,
      protocol: l.protocol, sessionEpoch: l.sessionEpoch, atMs: _now(), detail: reason,
    });
  }
  _stopIfIdle();
}

/* ══════════════════════════════════════════════════════════════════════════
   ZAMANLAYICI
   ══════════════════════════════════════════════════════════════════════════ */

/** İşlem canlı ve kira keepalive gerektiriyorsa timer'ı başlatır. */
export function ensureSchedulerRunning(): void {
  if (_timer !== null) return;
  if (!_leases.some((l) => l.keepAliveRequired && !isSessionTerminal(l.state))) return;
  _timer = setInterval(() => { void _tick(); }, TICK_MS);
}

export function stopSchedulerTimer(): void {
  if (_timer === null) return;
  clearInterval(_timer);
  _timer = null;
}

/** Canlı, keepalive gerektiren kira KALMADIYSA timer'ı durdurur (sızıntı yok). */
function _stopIfIdle(): void {
  if (!_leases.some((l) => l.keepAliveRequired && !isSessionTerminal(l.state))) {
    stopSchedulerTimer();
  }
}

/**
 * İşlem kaydı — kira sahibinin hâlâ canlı olup olmadığını bilmek için.
 * Scheduler işlem defterine ERİŞMEZ; sahibi burada kaydeder (tek yön bağımlılık).
 */
const _owners = new Map<string, DiagnosticTransaction>();
export function registerTransactionOwner(txn: DiagnosticTransaction): void {
  _owners.set(txn.transactionId, txn);
}

/**
 * Bir tur: süresi gelen keepalive'ları gönderir.
 *
 * ÜÇ ÖLDÜRÜCÜ KAPI (her turda, her kira için):
 *  1. sahip işlem TERMİNAL mi → kira kapanır, `3E` GİTMEZ
 *  2. OBD oturumu (epoch) değişti mi → kira ÖLÜR, `3E` GİTMEZ
 *  3. `isKeepAliveDue` (kanıt + aralık) → değilse `3E` GİTMEZ
 */
async function _tick(): Promise<void> {
  const now = _now();
  let currentEpoch: number | null = null;
  try { currentEpoch = getObdSessionEpoch(); } catch { currentEpoch = null; }

  for (const lease of [..._leases]) {
    if (isSessionTerminal(lease.state)) continue;

    /* ① SAHİP İŞLEM TERMİNAL → keepalive KESİN durur. Geç bir timer, kapanmış
       bir işlem adına ECU'ya komut GÖNDEREMEZ. */
    const owner = _owners.get(lease.transactionId);
    if (owner === undefined || isTerminalState(owner.state) || owner.cancelled) {
      closeSessionLease(lease, `sahip işlem ${owner?.state ?? 'BİLİNMİYOR'}`);
      recordSessionEvidence({
        kind: 'SESSION_CLOSED', leaseId: lease.leaseId, transactionId: lease.transactionId,
        evidenceCorrelationId: owner?.evidenceCorrelationId ?? lease.transactionId,
        rxHeader: lease.ecuEndpoint.rxHeader, txHeader: lease.ecuEndpoint.txHeader,
        protocol: lease.protocol, sessionEpoch: lease.sessionEpoch, atMs: now,
        detail: 'sahip işlem kapandı',
      });
      continue;
    }

    /* ② BAYAT OTURUM → kira ANINDA geçersiz. Başka bir OBD oturumuna
       keepalive göndermek, olmayan bir oturumu canlı tutmaya çalışmaktır. */
    if (!isLeaseEpochValid(lease, currentEpoch)) {
      closeSessionLease(lease, 'OBD oturumu değişti (bayat epoch)');
      recordSessionEvidence({
        kind: 'SESSION_EXPIRED', leaseId: lease.leaseId, transactionId: lease.transactionId,
        evidenceCorrelationId: owner.evidenceCorrelationId,
        rxHeader: lease.ecuEndpoint.rxHeader, txHeader: lease.ecuEndpoint.txHeader,
        protocol: lease.protocol, sessionEpoch: lease.sessionEpoch, atMs: now,
        detail: `epoch ${lease.sessionEpoch} → ${currentEpoch}`,
      });
      continue;
    }

    /* ③ ZAMANI GELDİ Mİ — kanıt kapıları burada (kör 3E imkânsız). */
    if (!isKeepAliveDue(lease, now)) continue;
    if (_inFlight.has(lease.leaseId)) continue;   // uçuşta — ikinci istek YOK

    await _sendKeepAlive(lease, owner, now);
  }

  _stopIfIdle();
}

/**
 * P0-VDK-F5C — TEK ATIŞLIK KEEPALIVE DOĞRULAMASI (Self-Healing tüketicisi).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN BU DOSYADA: keepalive gönderiminin TEK SAHİBİ bu modüldür. Self-Healing
 * kendi `3E` yolunu kursaydı ikinci bir oturum otoritesi doğardı; onun yerine
 * sahibin API'sini TÜKETİR. Gönderim yine `_sendKeepAlive`tir — kanıt kapıları,
 * uçuş kilidi, geç-yanıt koruması ve iz kaydı AYNEN uygulanır.
 *
 * KÖR `3E` YAPISAL OLARAK İMKÂNSIZ: kira `ACTIVE` değilse ya da oturumun
 * gerçekten açıldığının kanıtı (`sessionEstablishedEvidence`) YOKSA hiçbir bayt
 * çıkmaz ve `null` döner. Zamanlayıcı tabanlı periyodik keepalive DEĞİŞMEDİ.
 *
 * @returns ölçülen sonuç; gönderilmediyse `null` (gönderilmedi ≠ başarısız).
 */
export async function verifyTesterPresentOnce(
  lease: DiagnosticSessionLease,
): Promise<KeepAliveOutcome | null> {
  try {
    if (isSessionTerminal(lease.state)) return null;
    /* KANIT KAPISI — oturum gerçekten açılmadıysa `3E` anlamsız hat trafiğidir. */
    if (lease.sessionEstablishedEvidence === null) return null;
    if (lease.state !== 'ACTIVE' && lease.state !== 'KEEPALIVE_DUE') return null;

    const owner = _owners.get(lease.transactionId);
    if (owner === undefined || isTerminalState(owner.state) || owner.cancelled) return null;

    let curEpoch: number | null = null;
    try { curEpoch = getObdSessionEpoch(); } catch { curEpoch = null; }
    if (!isLeaseEpochValid(lease, curEpoch)) return null;

    if (_inFlight.has(lease.leaseId)) return null;   // uçuşta — ikinci istek YOK

    const before = lease.keepAliveSuccesses;
    const failedBefore = lease.consecutiveFailures;
    await _sendKeepAlive(lease, owner, _now());
    if (lease.keepAliveSuccesses > before) return 'POSITIVE';
    if (lease.consecutiveFailures > failedBefore) {
      /* Başarısızlığın TÜRÜ kirada saklanmaz; `_sendKeepAlive` kanıtı ize yazdı.
         Burada yalnız "olumlu değil" bilgisi döner — uydurma sınıflandırma YOK. */
      return 'NO_RESPONSE';
    }
    return null;
  } catch { return null; }   // doğrulama ASLA turu düşürmez
}

/** Native `3E 00` gönderir ve sonucu kiraya uygular. */
async function _sendKeepAlive(
  lease: DiagnosticSessionLease, owner: DiagnosticTransaction, now: number,
): Promise<void> {
  const tx = lease.ecuEndpoint.txHeader;
  const rx = lease.ecuEndpoint.rxHeader;
  /* P0-VDK-F2B — TAŞIMA KAPISI. F1-B otoritesi DEĞİŞMEDİ: kira · zamanlama ·
     kanıt kapıları burada kalır, yalnız `3E00`'ın gittiği yer (canlı hat ya
     da doğrulanmış iz) tek noktadan seçilir. İkinci oturum motoru YOK. */
  const fn = vdkTesterPresentFn();
  if (!fn || tx === null || rx === null) return;

  _inFlight.add(lease.leaseId);
  markKeepAliveSent(lease, now);
  /* Keepalive maliyeti işlem bütçesinden AYRI sayılır — tanı isteği değildir.
     Ama iptal/süre otoritesi TEK kalır: sahip işlem terminal olunca durur. */
  owner.keepAliveRequestsUsed = (owner.keepAliveRequestsUsed ?? 0) + 1;

  recordSessionEvidence({
    kind: 'KEEPALIVE_SENT', leaseId: lease.leaseId, transactionId: lease.transactionId,
    evidenceCorrelationId: owner.evidenceCorrelationId,
    rxHeader: rx, txHeader: tx, protocol: lease.protocol,
    sessionEpoch: lease.sessionEpoch, atMs: now, detail: '3E 00',
  });

  let outcome: KeepAliveOutcome = 'TRANSPORT_ERROR';
  let nrc: number | null = null;
  try {
    const res = await fn({ tx, rx });
    nrc = res.nrc ?? null;
    outcome = res.outcome === 'ok' ? 'POSITIVE'
      : res.outcome === 'negative_nrc' ? 'NEGATIVE'
        : res.outcome === 'no_response' || res.outcome === 'timeout' ? 'NO_RESPONSE'
          : 'TRANSPORT_ERROR';
  } catch (e) {
    logError('OBD:TesterPresentFailed', e);   // keepalive düştü — recovery BAŞLATILMAZ
    outcome = 'TRANSPORT_ERROR';
  } finally {
    _inFlight.delete(lease.leaseId);
  }

  /* GEÇ YANIT: istek uçuştayken işlem kapandıysa ya da oturum değiştiyse
     sonuç kiraya YAZILMAZ — kapanmış bir işlemin durumu değiştirilemez. */
  let curEpoch: number | null = null;
  try { curEpoch = getObdSessionEpoch(); } catch { curEpoch = null; }
  if (isTerminalState(owner.state) || owner.cancelled || !isLeaseEpochValid(lease, curEpoch)) {
    closeSessionLease(lease, 'geç keepalive yanıtı — işlem/oturum geçersiz');
    _stopIfIdle();
    return;
  }

  applyKeepAliveOutcome(lease, outcome, _now());
  /* P0-VDK-F2A: keepalive de kronolojiye girer — oturumun canlı tutulduğu
     (ya da tutulamadığı) an, DTC okumalarıyla AYNI zaman çizgisinde görünür. */
  traceFromTransaction(owner, {
    operation: 'tester_present',
    rawRequest: '3E00', rawResponse: outcome === 'POSITIVE' ? '7E00' : null,
    transportOutcome: outcome, nrc,
    ecuTxHeader: tx, ecuRxHeader: rx, ecuLabel: lease.ecuEndpoint.label,
    protocol: lease.protocol, sessionEpoch: lease.sessionEpoch,
    sessionLeaseRef: lease.leaseId,
  });
  recordSessionEvidence({
    kind: outcome === 'POSITIVE' ? 'KEEPALIVE_POSITIVE'
      : outcome === 'NEGATIVE' ? 'KEEPALIVE_NEGATIVE'
        : 'KEEPALIVE_NO_RESPONSE',
    leaseId: lease.leaseId, transactionId: lease.transactionId,
    evidenceCorrelationId: owner.evidenceCorrelationId,
    rxHeader: rx, txHeader: tx, protocol: lease.protocol,
    sessionEpoch: lease.sessionEpoch, atMs: _now(),
    nrc, detail: lease.timeoutEvidence ?? 'oturum canlı',
  });
  _stopIfIdle();
}

/**
 * Native oturum kanıtını kiraya uygular ve GEREKİYORSA timer'ı başlatır.
 * Keepalive'ın TEK açılış yolu budur.
 */
export function applyLeaseSessionEvidence(
  lease: DiagnosticSessionLease,
  txn: DiagnosticTransaction,
  evidence: { sessionOpened: boolean; sessionCommand: string | null },
): void {
  const now = _now();
  const before = lease.state;
  const after = applySessionEvidence(lease, evidence, now);
  recordSessionEvidence({
    kind: evidence.sessionOpened ? 'SESSION_OPEN_POSITIVE' : 'SESSION_OPEN_NOT_REQUIRED',
    leaseId: lease.leaseId, transactionId: lease.transactionId,
    evidenceCorrelationId: txn.evidenceCorrelationId,
    rxHeader: lease.ecuEndpoint.rxHeader, txHeader: lease.ecuEndpoint.txHeader,
    protocol: lease.protocol, sessionEpoch: lease.sessionEpoch, atMs: now,
    detail: `${before} → ${after} · ${lease.sessionKind}`,
  });
  traceFromTransaction(txn, {
    operation: 'session_open', direction: 'observation',
    rawRequest: evidence.sessionCommand,
    transportOutcome: evidence.sessionOpened ? 'opened' : 'not_required',
    ecuTxHeader: lease.ecuEndpoint.txHeader, ecuRxHeader: lease.ecuEndpoint.rxHeader,
    ecuLabel: lease.ecuEndpoint.label, protocol: lease.protocol,
    sessionEpoch: lease.sessionEpoch, sessionLeaseRef: lease.leaseId,
  });
  registerTransactionOwner(txn);
  ensureSchedulerRunning();
}
