/**
 * diagnosticAdmission — TANI ADMİSYON KAPISI (P0-OBD-CORE-05).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SAHA KANITI (kök neden) ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * KWP kurtarma/reconnect sürerken AYNI OTURUMDA ardışık şu hatalar görüldü:
 *   FreezeFrameFailed · ReadPid01Failed · ReadAll_03_Failed · ReadAll_07_Failed ·
 *   ReadAll_0A_Failed · EcuProbeFailed · ManufacturerDidRead
 * Oturum toparlandıktan SONRA AYNI sorgular normal cevapladı (43/47/4A pozitif,
 * 0101/010C/010D vb. akıyor). Yani DTC/freeze-frame/ECU probe/üretici DID
 * katmanı KALICI BOZUK DEĞİLDİ — diagnostik sorgular session/recovery hazır
 * olmadan hatta çıkıyordu. Transport "connected" olması TEK BAŞINA yeterli
 * değildi; KWP recovery aktifken veya reconnect sürerken tek-seferlik tanı
 * sorguları (DTC/freeze-frame/ECU keşfi/üretici DID) yine de gönderiliyordu.
 *
 * ── BU MODÜLÜN İŞİ ────────────────────────────────────────────────────────
 * Mevcut queue/state machine'in (ElmCommandQueue · KWP recovery state machine ·
 * obdService reconnect zinciri) ÜZERİNE ince bir ADMİSYON katmanıdır — ikinci
 * bir reconnect/recovery otoritesi KURMAZ, hiçbir sayaç eklemez, hiçbir kararı
 * değiştirmez. Yalnız var olan sinyalleri (obdService.getObdSessionHealth,
 * obdService.getEcuRecoveryLadder, kwpRecoveryEvidence) OKUR ve "şu an
 * tek-seferlik bir tanı sorgusu göndermek güvenli mi?" sorusuna FAIL-CLOSED
 * bir cevap üretir. Çalışan bir queue komutunu PREEMPT ETMEZ — yalnız YENİ bir
 * tanı turunun BAŞLAMASINI erteler.
 *
 * SAF ÇEKİRDEK: `evaluateDiagnosticAdmission` I/O yapmaz, saf senkron karardır
 * (test edilebilir). İnce impure kabuk (`getDiagnosticAdmission` /
 * `getDiagnosticAdmissionSync`) canlı sinyalleri toplar ve çekirdeğe geçirir.
 */

import { Capacitor } from '@capacitor/core';
import {
  getOBDDataSnapshot, getObdSessionHealth, getEcuRecoveryLadder,
} from '../obdService';
import type { OBDConnectionState } from '../obdTypes';
import { getKwpRecoveryEvidence, refreshKwpRecoveryEvidence } from './kwpRecoveryEvidence';

/**
 * Admisyon sonucu. `READY` DIŞINDAKİ her değer "şimdi gönderme" demektir.
 * `UNKNOWN` FAIL-CLOSED yakalayıcıdır — beklenmeyen/tanınmayan bir durum
 * görülürse "güvenli" varsayılmaz, admisyon REDDEDİLİR.
 */
export type DiagnosticAdmission =
  | 'READY'             // handshake + session ready + recovery idle + ilk doğrulanmış PID
  | 'WAITING_SESSION'   // transport var ama session henüz hazır değil (ilk PID kanıtı yok)
  | 'RECOVERY_ACTIVE'   // KWP ATPC/reinit veya CAN ECU kurtarma merdiveni SÜRÜYOR
  | 'RECONNECTING'      // transport/native reconnect SÜRÜYOR
  | 'TRANSPORT_DOWN'    // transport bağlı değil / hata durumunda
  | 'DATA_NOT_PROVEN'   // session bir kez hazırdı ama veri şu an TAZE değil (ECU sessiz)
  | 'UNKNOWN';          // tanınmayan durum — fail-closed

export interface DiagnosticAdmissionResult {
  readonly admission: DiagnosticAdmission;
  /** Kararın TR gerekçesi — log/LAB için, kullanıcıya gösterilecek cümle DEĞİL. */
  readonly reason: string;
}

/** Çekirdeğin girdisi — hepsi mevcut TEK OTORİTELERDEN okunur, burada ÜRETİLMEZ. */
export interface DiagnosticAdmissionInput {
  readonly nativePlatform: boolean;
  readonly connectionState: OBDConnectionState;
  readonly transportReady: boolean;
  readonly sessionReady: boolean;
  readonly pollingActive: boolean;
  readonly dataFresh: boolean;
  /** obdService CAN ECU kurtarma merdiveni şu an çalışıyor mu. */
  readonly canRecoveryInFlight: boolean;
  /** obdService native transport reconnect'i şu an çalışıyor mu. */
  readonly nativeReconnectInFlight: boolean;
  /**
   * KWP ATPC/reinit kurtarması şu an IN_PROGRESS mi. `null` = ölçülmedi/kanıt
   * yok (eski APK, CAN protokolü, veya henüz hiç sorulmadı) — bu durumda bu
   * eksen KARARI ETKİLEMEZ (KWP her araçta uygulanabilir değildir); diğer
   * eksenler (session health) zaten fail-closed korumayı sağlar.
   */
  readonly kwpRecoveryInProgress: boolean | null;
}

const KNOWN_STATES: ReadonlySet<OBDConnectionState> = new Set([
  'idle', 'scanning', 'connecting', 'initializing', 'connected', 'reconnecting', 'error',
]);

/**
 * SAF ÇEKİRDEK — fail-closed admisyon kararı.
 *
 * SIRA BİLİNÇLİDİR (en kesin engelden en ince ayrıma): tanınmayan durum →
 * transport yok → reconnect sürüyor → recovery sürüyor → session hazır değil
 * → veri taze değil → READY.
 */
export function evaluateDiagnosticAdmission(input: DiagnosticAdmissionInput): DiagnosticAdmissionResult {
  if (!input.nativePlatform) {
    return { admission: 'READY', reason: 'web/demo modu — gerçek transport yok, kapı uygulanmaz' };
  }

  if (!KNOWN_STATES.has(input.connectionState)) {
    return { admission: 'UNKNOWN', reason: `tanınmayan connectionState: ${String(input.connectionState)}` };
  }

  if (input.connectionState === 'error') {
    return { admission: 'TRANSPORT_DOWN', reason: 'connectionState=error' };
  }
  if (input.connectionState === 'idle' || input.connectionState === 'scanning') {
    return { admission: 'TRANSPORT_DOWN', reason: `henüz bağlantı kurulmadı (connectionState=${input.connectionState})` };
  }
  if (
    input.connectionState === 'connecting'
    || input.connectionState === 'initializing'
    || input.connectionState === 'reconnecting'
  ) {
    return { admission: 'RECONNECTING', reason: `bağlantı/yeniden bağlanma sürüyor (connectionState=${input.connectionState})` };
  }
  if (input.nativeReconnectInFlight) {
    return { admission: 'RECONNECTING', reason: 'native transport reconnect sürüyor' };
  }
  if (!input.transportReady) {
    return { admission: 'TRANSPORT_DOWN', reason: 'transport bağlı değil (native handle yok / link kanıtı yok)' };
  }
  if (input.canRecoveryInFlight) {
    return { admission: 'RECOVERY_ACTIVE', reason: 'CAN ECU kurtarma merdiveni sürüyor' };
  }
  if (input.kwpRecoveryInProgress === true) {
    return { admission: 'RECOVERY_ACTIVE', reason: 'KWP ATPC/reinit kurtarması sürüyor — ilk geçerli PID bekleniyor' };
  }
  if (!input.sessionReady) {
    return { admission: 'WAITING_SESSION', reason: 'handshake var ama ilk doğrulanmış ECU/Mode 01 cevabı henüz yok' };
  }
  if (!input.pollingActive) {
    return { admission: 'WAITING_SESSION', reason: 'oturum zamanlayıcısı (stale watchdog) henüz kurulmadı' };
  }
  if (!input.dataFresh) {
    return { admission: 'DATA_NOT_PROVEN', reason: 'session bir kez hazırdı ama son ECU verisi şu an taze değil' };
  }

  return {
    admission: 'READY',
    reason: 'handshake + session ready + recovery idle + ilk doğrulanmış PID — tanı sorgusu güvenli',
  };
}

/** `READY` dışındaki HER şey admisyonu REDDEDER — çağıranlar tek bir bayrak kontrol eder. */
export function isDiagnosticAdmissionReady(a: DiagnosticAdmission): boolean {
  return a === 'READY';
}

/* ══════════════════════════════════════════════════════════════════════════
   İNCE İMPURE KABUK — canlı sinyalleri TEK OTORİTELERDEN toplar
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Canlı sinyalleri obdService + kwpRecoveryEvidence TEK OTORİTELERİNDEN toplar.
 *
 * FAIL-SOFT ÇAĞRI SINIRI: `getObdSessionHealth`/`getEcuRecoveryLadder` mevcut
 * TEK OTORİTEDİR ve normal çalışmada HER ZAMAN gerçek değer döner. Bu sarma
 * yalnız test double'larına karşı korumadır (bazı mevcut testler `obdService`i
 * KISMİ mock'lar ve bu iki fonksiyonu taşımaz) — üretimde asla tetiklenmez.
 * Düşerse `OBDData`nın ZATEN her testte mocklanan alanlarından (connectionState/
 * transportConnected/dataFresh) DÜRÜST bir yaklaşık türetilir; ikinci bir
 * otorite KURULMAZ, yalnız aynı tek otoritenin erişilemediği anda GERİ DÜŞÜLÜR.
 */
export function gatherDiagnosticAdmissionInput(): DiagnosticAdmissionInput {
  const nativePlatform = Capacitor.isNativePlatform();
  const obd = getOBDDataSnapshot();

  /* Yaklaşık (fallback): gerçek obdService'te `connectionState` YALNIZ ilk
     gerçek ECU frame'i aktıktan sonra 'connected' olur (bkz. obdService.ts
     `_hasEcuData` dalı) — yani 'connected' TEK BAŞINA zaten "session ready"
     kanıtıdır. `transportConnected`/`dataFresh` alanları bazı test double'larında
     taşınmaz (undefined); bunu "false" SAYMAK yaklaşığı gereksiz yere
     sıkılaştırır — DAHA GÜÇLÜ kanıt (getObdSessionHealth) varsa zaten onunla
     EZİLİR (aşağıda). */
  const connectedApprox = obd.connectionState === 'connected';
  let transportReady = connectedApprox;
  let sessionReady    = connectedApprox;
  let pollingActive   = connectedApprox;
  let dataFresh       = connectedApprox;
  try {
    const health = getObdSessionHealth();
    transportReady = health.transportReady;
    sessionReady   = health.sessionReady;
    pollingActive  = health.pollingActive;
    dataFresh      = health.dataFresh;
  } catch { /* fail-soft — OBDData'dan türeyen yaklaşık KORUNUR */ }

  let canRecoveryInFlight = false;
  let nativeReconnectInFlight = false;
  try {
    const ladder = getEcuRecoveryLadder();
    canRecoveryInFlight = ladder.inFlight;
    nativeReconnectInFlight = ladder.nativeReconnectInFlight;
  } catch { /* fail-soft — bilinmiyorsa "sürmüyor" varsayılır (diğer eksenler zaten korur) */ }

  let kwpRecoveryInProgress: boolean | null = null;
  try {
    const kwp = getKwpRecoveryEvidence();
    kwpRecoveryInProgress = kwp === null ? null : kwp.status === 'IN_PROGRESS';
  } catch { /* fail-soft */ }

  return {
    nativePlatform,
    connectionState: obd.connectionState,
    transportReady,
    sessionReady,
    pollingActive,
    dataFresh,
    canRecoveryInFlight,
    nativeReconnectInFlight,
    kwpRecoveryInProgress,
  };
}

/**
 * SENKRON admisyon okuması — native round-trip YAPMAZ, yalnız ÖNBELLEKTEKİ
 * (en son `refreshKwpRecoveryEvidence` çağrısından kalan) KWP kanıtını okur.
 * Sık çağrılan yollar için (ör. manufacturerPidService'in periyodik tick'i)
 * — ek native trafik üretmeden "şimdi güvenli mi" sorusuna cevap verir.
 */
export function getDiagnosticAdmissionSync(): DiagnosticAdmissionResult {
  const result = evaluateDiagnosticAdmission(gatherDiagnosticAdmissionInput());
  _noteAdmission(result.admission);
  return result;
}

/**
 * Read-only evidence projection for runtime diagnostics. Unlike the operational
 * sync getter this deliberately does not update admission episode counters.
 */
export function getDiagnosticAdmissionEvidence(): DiagnosticAdmissionResult {
  return evaluateDiagnosticAdmission(gatherDiagnosticAdmissionInput());
}

/**
 * ASENKRON admisyon okuması — tek-seferlik tanı turları (DTC taraması,
 * freeze-frame, ECU keşfi) için: KWP kanıtını ÖNCE tazeler (tek native
 * round-trip, cold-path — hot-path'e girmez), sonra karar üretir.
 */
export async function getDiagnosticAdmission(): Promise<DiagnosticAdmissionResult> {
  if (Capacitor.isNativePlatform()) {
    try { await refreshKwpRecoveryEvidence(); } catch { /* fail-soft — kanıt yoksa null kalır */ }
  }
  const result = evaluateDiagnosticAdmission(gatherDiagnosticAdmissionInput());
  _noteAdmission(result.admission);
  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   HEDEF 4 — KORELASYON KİMLİĞİ (minimal, mevcut logger'a EK alan)
   ══════════════════════════════════════════════════════════════════════════
   Tek bir engelleyici OLAY (recovery/reconnect/transport-down) süresince
   art arda ertelenen tanı denemeleri AYNI bölüm (episode) kimliğini taşır.
   Büyük bir logging refactor DEĞİLDİR: yalnız bir sayaç + damga — mevcut
   crash logger/kanıt defterlerine opsiyonel bir alan olarak eklenebilir. */

let _lastAdmission: DiagnosticAdmission = 'READY';
let _episodeId = 0;
let _episodeStartedAt: number | null = null;

function _noteAdmission(a: DiagnosticAdmission): void {
  if (a === 'READY') {
    _lastAdmission = a;
    _episodeStartedAt = null;
    return;
  }
  if (_lastAdmission === 'READY' || _episodeStartedAt === null) {
    _episodeId += 1;
    _episodeStartedAt = Date.now();
  }
  _lastAdmission = a;
}

/** Şu an süren engelleme bölümü; engelleme yoksa `null`. */
export function getDiagnosticAdmissionEpisode(): { readonly id: number; readonly startedAt: number } | null {
  return _episodeStartedAt === null ? null : { id: _episodeId, startedAt: _episodeStartedAt };
}

/** Test izolasyonu — modül durumunu sıfırlar. */
export function _resetDiagnosticAdmissionForTest(): void {
  _lastAdmission = 'READY';
  _episodeId = 0;
  _episodeStartedAt = null;
}
