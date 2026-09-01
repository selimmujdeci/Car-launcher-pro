/**
 * kwpMonitorSources.ts — KWP İzleyici'nin TEK okuma noktası (Faz A4).
 *
 * ── PAZARLIKSIZ SINIRLAR (Session Inspector ile AYNI sözleşme) ──────────────
 *  · YALNIZ SENKRON getter çağrılır. Async native pull BURADA yapılmaz.
 *  · Hiçbir servis BAŞLATILMAZ/DURDURULMAZ, hiçbir abonelik açılmaz.
 *  · Hiçbir bağlantı/reconnect/reset/recovery/AT komutu yolu tetiklenmez.
 *    (KWP kurtarması NATIVE'dedir; bu modül onu ne tetikler ne de değiştirir.)
 *  · Her okuma try/catch içindedir; kaynak patlarsa `null` → alan UNAVAILABLE.
 *  · Yeni global store / singleton / KWP oturum motoru KURULMAZ.
 *
 * `classifyProtocol` / `isSlowSerialProtocol` SAF fonksiyonlardır (protocolProfile);
 * çağrılmaları hiçbir yan etki üretmez.
 */

import {
  getOBDDataSnapshot, getObdSessionHealth, getHandshakeDiagnostics, getObdFreshWindowMs,
} from '../obdService';
import { getKwpRecoveryEvidence } from '../obd/kwpRecoveryEvidence';
import { classifyProtocol, isSlowSerialProtocol } from '../obd/protocolProfile';
import { getKwpDtcEvidence } from '../obd/multiEcuScan';
import { getKwpSessionProbes } from '../obd/kwpSessionProbe';
import { getKwpAddressingProbes } from '../obd/kwpAddressingProbe';
import type { KwpRawSnapshot } from './kwpMonitorModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Sayı okuma — **sahte 0 ÜRETMEZ**.
 *
 * `Number(undefined) || 0` deseni "alan yok"u "ölçüm 0" yapar ve modelin
 * `null → UNAVAILABLE` kapısını TETİKLENEMEZ hâle getirir. Burada yalnız
 * gerçekten sonlu bir sayı geçer; aksi hâlde `null`.
 */
function _num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması. Bounded: yalnız sabit sayıda skaler
 * alan kopyalanır (ham telemetri/geçmiş dizileri taşınmaz).
 */
export function readKwpRawSnapshot(): KwpRawSnapshot {
  const readAt = Date.now();

  const data  = _safe(() => getOBDDataSnapshot());
  const sess  = _safe(() => getObdSessionHealth());
  const hs    = _safe(() => getHandshakeDiagnostics());
  const fresh = _safe(() => getObdFreshWindowMs());
  const kwp   = _safe(() => getKwpRecoveryEvidence());
  /* V-08: DTC kanalının son tam-tarama kanıtı (sürekli akmaz — bkz. model). */
  const dtc   = _safe(() => getKwpDtcEvidence());
  /* P0-OBD-FINAL-02: KWP tanı oturumu (0x10) probunun kanıt defteri. Bu ekran
     KOMUT GÖNDERMEZ — prob yalnız tam araç taraması sırasında koşar; burada
     yalnız SON turun kaydı OKUNUR. Boş defter "oturum yok" DEMEK DEĞİLDİR. */
  const sessionProbes = _safe(() => getKwpSessionProbes());
  /* P0-OBD-DIAG-01: fiziksel adresleme matrisinin kanıt defteri. Bu ekran
     KOMUT GÖNDERMEZ — matris yalnız tam araç taraması sırasında koşar. */
  const addressingProbes = _safe(() => getKwpAddressingProbes());

  const protocolActive = hs?.protocolActive ?? null;
  // Protokol BİLİNMİYORSA sınıf da uygulanabilirlik de null kalır — CAN VARSAYILMAZ.
  const known = typeof protocolActive === 'string' && protocolActive.trim() !== ''
    && classifyProtocol(protocolActive) !== 'unknown';

  return {
    readAt,

    protocolActive,
    protocolTried:  hs?.protocolTried ?? null,
    protocolClass:  known ? classifyProtocol(protocolActive) : null,
    slowSerial:     known ? isSlowSerialProtocol(protocolActive) : null,

    transportConnected: data ? data.transportConnected === true : null,
    connectionState:    data ? String(data.connectionState) : null,
    dataFresh:          data ? data.dataFresh === true : null,
    lastRxAt:           data && Number(data.lastRxAt) > 0 ? Number(data.lastRxAt) : null,

    freshWindowMs: typeof fresh === 'number' && Number.isFinite(fresh) && fresh > 0 ? fresh : null,
    pollingActive: sess ? sess.pollingActive === true : null,

    /* SAHTE SIFIR YASAĞI (envanter denetimi E-19): native alan YOKSA
       `Number(undefined) || 0` bu sayaçları 0 yapıyor, model de `observed(0)`
       basıyordu → LAB'da "ATPC gönderim sayısı: 0 · ÖLÇÜLDÜ". Oysa doğru cevap
       "KAYNAK YOK"tur: "hiç kurtarma olmadı" ile "kurtarma ölçülemedi" aynı
       ekranda ayırt edilemiyordu ve teşhis aracı hata avında yanlış yöne
       sürüklüyordu. Artık okunamayan alan `null` taşınır → UNAVAILABLE. */
    recovery: kwp ? {
      status:                   String(kwp.status),
      coreNoDataStreak:         _num(kwp.coreNoDataStreak),
      maxCoreNoDataStreak:      _num(kwp.maxCoreNoDataStreak),
      recoveryCount:            _num(kwp.recoveryCount),
      suppressedCount:          _num(kwp.suppressedCount),
      atpcSendFailures:         _num(kwp.atpcSendFailures),
      lastRecoveryAt:           _num(kwp.lastRecoveryAt),
      lastRecoveryToFirstPidMs: _num(kwp.lastRecoveryToFirstPidMs),
      killedByDataGate:         _num(kwp.killedByDataGate),
      protocolAtRecovery:       kwp.protocolAtRecovery ?? null,
      threshold:                _num(kwp.threshold),
      maxPerSession:            _num(kwp.maxPerSession),
      lastEvent:                kwp.lastEvent ?? null,
      noDataCount:              _num(kwp.noDataCount),
      promptTimeoutCount:       _num(kwp.promptTimeoutCount),
      partialTimeoutCount:      _num(kwp.partialTimeoutCount),
      ecuSilentCount:           _num(kwp.ecuSilentCount),
      sessionRecoveryCount:     _num(kwp.sessionRecoveryCount),
      transportReconnectCount: _num(kwp.transportReconnectCount),
      recoveredCount:           _num(kwp.recoveredCount),
      recoveryFailedCount:      _num(kwp.recoveryFailedCount),
      maxCommandDurationMs:     _num(kwp.maxCommandDurationMs),
      maxKeepAliveGapMs:        _num(kwp.maxKeepAliveGapMs),
      keepAliveGapExceededCount:_num(kwp.keepAliveGapExceededCount),
    } : null,

    dtc: dtc ? {
      lastScanAtMs:     dtc.lastScanAtMs,
      protocolAtScan:   dtc.protocolAtScan,
      attempted:        dtc.attempted === true,
      channelAvailable: dtc.channelAvailable === true,
      okCount:          _num(dtc.okCount) ?? 0,
      unsupportedCount: _num(dtc.unsupportedCount) ?? 0,
      failedCount:      _num(dtc.failedCount) ?? 0,
      codeCount:        _num(dtc.codeCount) ?? 0,
      functional03Raw: dtc.functional03Raw,
      functional07Raw: dtc.functional07Raw,
      physicalTarget: dtc.physicalTarget,
      targetProvenance: dtc.targetProvenance,
      sessionRequest: dtc.sessionRequest,
      sessionResponse: dtc.sessionResponse,
      request18Tx: dtc.request18Tx,
      response18Raw: dtc.response18Raw,
      gateOutcome: dtc.gateOutcome,
      notSentReason: dtc.notSentReason,
      foundDtcs: [...dtc.foundDtcs],
      publishedToCanonicalAuthority: dtc.publishedToCanonicalAuthority,
    } : null,

    /* P0-OBD-FINAL-02 — oturum probu kanıtı (SALT-OKUNUR, bounded).
       `null` = defter okunamadı; boş dizi = prob bu oturumda hiç koşmadı. */
    sessionProbes: sessionProbes === null ? null : sessionProbes.map((e) => ({
      tx: e.tx, rx: e.rx, request: e.request, positiveNeedle: e.positiveNeedle,
      raw: e.raw, result: e.result, nrc: e.nrc, nativeOutcome: e.nativeOutcome,
      sessionEpoch: e.sessionEpoch, protocol: e.protocol,
    })),

    /* P0-OBD-DIAG-01 — fiziksel adresleme matrisi kanıtı (SALT-OKUNUR, bounded).
       `null` = defter okunamadı; boş dizi = matris bu oturumda hiç koşmadı. */
    addressingProbes: addressingProbes === null ? null : addressingProbes.map((e) => ({
      rx: e.rx, header: e.header, variantId: e.variantId, physical: e.physical,
      initFirst: e.initFirst, initRaw: e.initRaw,
      request: e.request, raw: e.raw, result: e.result, nrc: e.nrc,
      nativeOutcome: e.nativeOutcome, sessionEpoch: e.sessionEpoch, protocol: e.protocol,
    })),
  };
}
