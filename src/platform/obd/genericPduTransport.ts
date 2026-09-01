/**
 * genericPduTransport — P0-VDK-F4A · GENEL SALT-OKUNUR PDU TAŞIMASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÇÖZDÜĞÜ ANA BLOKER ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F3-B'de CDDL `ServiceDef` → `DiagnosticPdu` üretebilir hâle geldi
 * (`1902FF` · `190A` gerçekten kuruluyor). Ama **köprü onu gönderemiyordu**:
 * `CarLauncher` yalnız servise ÖZEL metotlar sunuyordu (`readDtcClass` ·
 * `readAdvancedDtcs` · `sendTesterPresent` · `readDtcFromEcu`). Yani yeni bir
 * salt-okunur servis tanımlamak **yeni bir Java metodu ve YENİ APK** demekti;
 * CDDL'in ürettiği PDU duvara çarpıyordu.
 *
 * Bu dosya o duvarı kaldırır: tek bir native yol (`sendDiagnosticPdu`) PDU'yu
 * olduğu gibi taşır. **Servis kimliğine göre dal seçilmez, parser seçilmez,
 * ayrıştırma yapılmaz.** Yankılanan bayt sayısı bile VERİdir (`responseEchoBytes`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ GÜVENLİK EVRENİ DEĞİLDİR.** İzin kararı native'de
 *     `DiagnosticServiceGate`tedir ve TS bozulsa bile orası tutar. Buradaki
 *     kontrol yalnız erken ret + kanıttır, otorite DEĞİLDİR.
 * (2) **İKİNCİ SONUÇ SÖZLÜĞÜ DEĞİLDİR.** Native genel köprü `readAdvancedDtcs`
 *     ile BİREBİR AYNI `outcome` kelimelerini üretir; çeviri `pdu.ts`tedir.
 * (3) **KARAR VERMEZ.** Admission · lease · tuning kararı · geç yanıt kapısı
 *     F1-A/B/C otoritelerinde KALIR.
 * (4) **LEGACY YOLU KALDIRMAZ.** Mevcut özel metotlar duruyor ve `pduParity`
 *     ile TANIK olarak kullanılıyor (F4A §6).
 */

import { CarLauncher } from '../nativePlugin';
import {
  isAddressable, pduOutcomeFromGeneric, pduUnmeasured,
  type DiagnosticPdu, type PduResponse, type PduSessionEvidence,
  type PduTuningEvidence,
} from './pdu';
import type {
  PduCapabilities, PduSendOptions, PduTransport,
} from './pduTransport';
import { recordObdNativeProvenance } from './obdNativeProvenance';
/* ARCH-05 çift kapının BİRİNCİSİ. Native `DiagnosticServiceGate` ikinci ve
   BAĞIMSIZ kapıdır; bu import onu ne gevşetir ne de yerine geçer. */
/* ⚠️ `securityWiring` BURADAN import EDİLMEZ: o modül `obdService`i okur ve
   bu taşıma zaten OBD grafiğinin İÇİNDEDİR → döngüsel import doğardı (ölçüldü:
   "GenericPduTransport is not a constructor"). Buna gerek de YOKTUR: teşhis
   sınıflandırması araç kapsamı ve hareket kanıtı İSTEMEZ; native yüzey kanıtı
   ise zaten bu dosyada ÖLÇÜLÜR (`genericBridgeAvailable`). */
import { judgeDiagnosticOperation } from '../security/enforcement';
/* ARCH-06/F1 — T0 sayaç (tek tamsayı artırımı). Bu satır hiçbir kararı,
   kadansı ya da sahipliği DEĞİŞTİRMEZ. */
import { bumpPerf } from '../perf/perfCounters';
import { readObdSessionEpochForNativeBoundary } from './obdEpochReader';

/* ══════════════════════════════════════════════════════════════════════════
   1) TS TARAFINDAKİ ERKEN KAPI — otorite DEĞİL, aynadır
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Native `DiagnosticServiceGate.READ_ONLY_SIDS` kümesinin TS aynası.
 *
 * ⚠️ Bu liste bir OTORİTE DEĞİLDİR. Native kapı bu dosyadan BAĞIMSIZ çalışır
 * ve bu liste yanlışlıkla genişletilse bile destructive bir servis hatta
 * çıkamaz. Buradaki amaç tek şeydir: gönderilemeyeceği KESİN olan bir isteği
 * köprüye hiç götürmemek ve gerekçeyi TS tarafında da sayılabilir kılmak.
 *
 * `genericPduBridge.test.ts` bu kümenin native kümeyle AYNI olduğunu kilitler.
 */
export const GENERIC_READ_ONLY_SERVICES: ReadonlySet<string> = new Set([
  '01', '03', '06', '07', '09', '0A',
  '10', '13', '17', '18', '19', '1A', '21', '22', '3E',
]);

/** UDS 0x19'un salt-okunur alt fonksiyonları (native kapıyla AYNI küme). */
export const GENERIC_UDS_19_SUBS: ReadonlySet<string> = new Set(['01', '02', '03', '06', '0A']);

/**
 * Görevin saydığı destructive kümenin TS aynası — **yalnız kanıt ve test için**.
 * Ürün kararı bu listeye BAKMAZ (beyaz liste dışı her şey zaten reddedilir).
 */
export const DESTRUCTIVE_SERVICES: readonly string[] = Object.freeze([
  '04', '11', '14', '27', '28', '2E', '2F', '31', '34', '35', '36', '37', '3B', '85',
]);

/** Erken kapı kararı — native gerekçe kodlarıyla AYNI ad uzayı. */
export type GenericGateVerdict =
  | 'OK' | 'SERVICE_NOT_READ_ONLY' | 'SUBFUNCTION_NOT_READ_ONLY' | 'MALFORMED_REQUEST';

const HEX_RE = /^[0-9A-F]*$/;

/** Native `DiagnosticServiceGate.judge` ile AYNI kural — fail-closed. */
export function judgeGenericPdu(pdu: DiagnosticPdu): GenericGateVerdict {
  const sid = pdu.service.toUpperCase();
  const sub = (pdu.subFunction ?? '').toUpperCase();
  const data = pdu.payload.toUpperCase();
  if (sid.length !== 2 || !HEX_RE.test(sid)) return 'MALFORMED_REQUEST';
  if (sub.length !== 0 && (sub.length !== 2 || !HEX_RE.test(sub))) return 'MALFORMED_REQUEST';
  if (!HEX_RE.test(data) || (data.length & 1) !== 0) return 'MALFORMED_REQUEST';
  if (sid.length + sub.length + data.length > 128) return 'MALFORMED_REQUEST';
  if (!GENERIC_READ_ONLY_SERVICES.has(sid)) return 'SERVICE_NOT_READ_ONLY';
  if (sid === '19' && !GENERIC_UDS_19_SUBS.has(sub)) return 'SUBFUNCTION_NOT_READ_ONLY';
  return 'OK';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) TAŞIMA
   ══════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function _tuningFrom(r: Record<string, unknown>): PduTuningEvidence | null {
  const has = 'tuningApplied' in r || 'tuningCommands' in r || 'tuningRestored' in r;
  if (!has) return null;
  return {
    applied: typeof r.tuningApplied === 'boolean' ? r.tuningApplied : null,
    commands: typeof r.tuningCommands === 'string' ? r.tuningCommands : null,
    previousMode: typeof r.tuningPreviousMode === 'string' ? r.tuningPreviousMode : null,
    newMode: typeof r.tuningNewMode === 'string' ? r.tuningNewMode : null,
    restored: typeof r.tuningRestored === 'boolean' ? r.tuningRestored : null,
    restoreDetail: typeof r.tuningRestoreDetail === 'string' ? r.tuningRestoreDetail : null,
  };
}

function _sessionFrom(r: Record<string, unknown>): PduSessionEvidence | null {
  /* Eski APK bu alanı TAŞIMAZ → `null` kalır ve keepalive AÇILMAZ (F1-B). */
  if (!('sessionOpened' in r)) return null;
  return {
    opened: typeof r.sessionOpened === 'boolean' ? r.sessionOpened : null,
    command: typeof r.sessionCommand === 'string' ? r.sessionCommand : null,
  };
}

/** Genel köprünün bu ortamda VAR olup olmadığı — iddia değil, ölçüm. */
export function genericBridgeAvailable(): boolean {
  return typeof CarLauncher.sendDiagnosticPdu === 'function';
}

/**
 * Genel salt-okunur PDU taşıması.
 *
 * Yeni bir salt-okunur servis eklemek için bu sınıfa **dokunulmaz**: PDU
 * neyse o gönderilir. Köprünün yeteneği artık servis LİSTESİ değil,
 * `supportsArbitraryPdu: true`dur.
 */
export class GenericPduTransport implements PduTransport {
  readonly capabilities: PduCapabilities = Object.freeze({
    kind: 'elm327' as const,
    /* Liste, native kapının izin verdiği kümedir — "her şeyi taşırım" iddiası
       YOKTUR; taşıma genel, İZİN sınırlıdır ve ikisi ayrı şeylerdir. */
    supportedServices: Object.freeze([...GENERIC_READ_ONLY_SERVICES]),
    supportsArbitraryPdu: true,
  });

  async send(pdu: DiagnosticPdu, opts: PduSendOptions = {}): Promise<PduResponse> {
    /* ARCH-04/F5: native SINIR künyesi. İstek anındaki oturum mührü burada
       ölçülür; sonuç döndüğünde tekrar okunur ve ikisi karşılaştırılır. */
    const requestEpoch = _epoch();
    const bridgeAvailable = genericBridgeAvailable();
    const fn = CarLauncher.sendDiagnosticPdu;
    if (!fn) {
      /* Eski APK: genel köprü YOK. "Araç desteklemiyor" DEĞİL — köprü taşıyamıyor. */
      const r = pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        'eski APK: sendDiagnosticPdu yok');
      _note(pdu, r, requestEpoch, requestEpoch, bridgeAvailable, 'NO_BRIDGE');
      return r;
    }
    if (!isAddressable(pdu.target)) {
      const r = pduUnmeasured('NOT_ADDRESSABLE',
        `hedef adreslenemez (${pdu.target.txHeader ?? 'null'}) — istek GÖNDERİLMEDİ`);
      _note(pdu, r, requestEpoch, requestEpoch, bridgeAvailable, 'NOT_ADDRESSABLE');
      return r;
    }
    /* ── ARCH-05 · ÜRÜN YETKİ KAPISI (native kapıdan ÖNCE, ondan BAĞIMSIZ) ──
       Servis bayti önce RİSK SINIFINA çevrilir (`DIAGNOSTIC_READ` · `CLEAR_DTC`
       · privileged · UNKNOWN), sonra o sınıfın yetkisi sorulur. Sınıflandırma
       tablosunda OLMAYAN her servis `UNKNOWN`dur ve UNKNOWN = DENY: "muhtemelen
       zararsızdır" değerlendirmesi YOKTUR. Privileged sınıfların yetkisi hiçbir
       principal'a VERİLMEZ → bu yoldan SecurityAccess/coding/adaptation/flashing
       ÜRETİLEMEZ. Ret hâlinde köprü çağrılmaz: hatta TEK BAYT çıkmaz. */
    const authz = judgeDiagnosticOperation({
      principalClass: opts.principal ?? 'LOCAL_UI',
      service: pdu.service,
      operationId: opts.operationId ?? `pdu:${requestEpoch}:${pdu.service}${pdu.subFunction ?? ''}`,
      targetRef: pdu.target.txHeader ?? null,
      /* Native yüzey kanıtı ALAN SAHİBİNİN ölçümüdür: genel PDU köprüsü var mı.
         Yoksa `false` — bu bir yetki değil, yüzeyin gerçekten var olduğunun
         kanıtıdır ve yetenek kapısı ondan BAĞIMSIZ işler. */
      nativePermission: bridgeAvailable,
    });
    if (!authz.allowed) {
      const r = pduUnmeasured('DENIED_BY_SAFETY_GATE',
        `ARCH-05 yetki kapısı: ${authz.operationClass}/${authz.evidence.decision} (${pdu.service}${pdu.subFunction ?? ''})`);
      _note(pdu, r, requestEpoch, requestEpoch, bridgeAvailable, `AUTHZ_${authz.evidence.decision}`);
      return r;
    }

    const gate = judgeGenericPdu(pdu);
    if (gate !== 'OK') {
      /* Erken ret. Native kapı bunu ZATEN reddederdi; burada durdurmak yalnız
         gereksiz bir köprü çağrısını önler ve gerekçeyi TS'te de sayılabilir kılar. */
      const r = pduUnmeasured('DENIED_BY_SAFETY_GATE',
        `TS erken kapı: ${gate} (${pdu.service}${pdu.subFunction ?? ''})`);
      _note(pdu, r, requestEpoch, requestEpoch, bridgeAvailable, gate);
      return r;
    }

    try {
      bumpPerf('bridge.sendDiagnosticPdu.called');
      const r = await fn({
        service: pdu.service,
        subFunction: pdu.subFunction ?? '',
        payload: pdu.payload,
        tx: pdu.target.txHeader ?? '',
        rx: pdu.target.rxHeader ?? '',
        echoBytes: pdu.responseEchoBytes,
        ...(opts.targetVerified === true ? { targetVerified: true } : {}),
        ...(opts.isoTpTuning === true ? { isoTpTuning: true } : {}),
      }) as Record<string, unknown>;

      const outcome = pduOutcomeFromGeneric(
        typeof r.outcome === 'string' ? r.outcome : null);
      const gateCode = typeof r.gate === 'string' ? r.gate : null;
      const err = typeof r.error === 'string' ? r.error : null;
      const response: PduResponse = {
        outcome,
        raw: typeof r.raw === 'string' && r.raw.length > 0 ? r.raw : null,
        nrc: _num(r.nrc),
        latencyMs: _num(r.latencyMs),
        byteCount: _num(r.byteCount),
        frameCount: _num(r.frameCount),
        protocol: pdu.protocol,
        transportKind: typeof r.kind === 'string' ? r.kind : null,
        session: _sessionFrom(r),
        tuning: _tuningFrom(r),
        /* Sessiz başarısızlık YASAK: native kapı gerekçesi kaybolmaz. */
        detail: outcome === 'DENIED_BY_SAFETY_GATE'
          ? `native kapı: ${gateCode ?? 'UNKNOWN'}`
          : outcome === 'NOT_ADDRESSABLE'
            ? `native adresleme: ${gateCode ?? 'UNKNOWN'}`
            : err,
      };
      _note(pdu, response, requestEpoch, _epoch(), bridgeAvailable, gateCode);
      return response;
    } catch (e) {
      /* İstisna = TAŞIMA hatası. Araç yeteneği hakkında kanıt DEĞİLDİR. */
      const r = pduUnmeasured('TRANSPORT_ERROR',
        e instanceof Error ? e.message : String(e));
      _note(pdu, r, requestEpoch, _epoch(), bridgeAvailable, 'TRANSPORT_ERROR');
      return r;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ARCH-04/F5 — NATIVE SINIR KANITI (yan yol; ürün kararına GİRMEZ)
   ══════════════════════════════════════════════════════════════════════════ */

/** Oturum mührünü okur; okunamazsa `null` — sahte epoch YOK. */
function _epoch(): number | null {
  return readObdSessionEpochForNativeBoundary();
}

/**
 * Kanıt kaydı. Ham yük/ham yanıt TAŞINMAZ ve bu fonksiyon ASLA throw etmez:
 * kanıt yolu ürün yolunu bozamaz.
 */
function _note(
  pdu: DiagnosticPdu, r: PduResponse,
  requestEpoch: number | null, resultEpoch: number | null,
  bridgeAvailable: boolean, gateReason: string | null,
): void {
  try {
    recordObdNativeProvenance({
      bridgeMethod: 'sendDiagnosticPdu',
      transportClass: r.transportKind,
      transactionRef: null,
      requestEpoch,
      resultEpoch,
      targetRef: pdu.target.txHeader ?? null,
      serviceRef: `${pdu.service}${pdu.subFunction ?? ''}`,
      nativeResultClass: r.outcome,
      latencyMs: r.latencyMs,
      byteCount: r.byteCount,
      nativeCapabilityAvailable: bridgeAvailable,
      gateReason,
    });
  } catch { /* kanıt kaybı ürünü bozmaz */ }
}
