/**
 * pduTransport — P0-VDK-F3A · PDU TAŞIMA ARAYÜZÜ (Real / Virtual).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Ne soruluyor" `DiagnosticPdu`dur ve taşımadan bağımsızdır.
 * "Nasıl gönderiliyor" bu dosyanın uygulamalarının işidir.
 *
 * Bugün iki uygulama var:
 *   · `ElmPduTransport`     → mevcut `CarLauncher` köprüsü (davranış AYNI)
 *   · `VirtualPduTransport` → F2-B doğrulanmış iz replay'i
 *
 * Yarın eklenecekler (DoIP · J2534 · doğrudan CAN) **üst katmana
 * dokunmadan** buraya girer — F3-A'nın tek amacı budur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DÜRÜST SINIR: BUGÜNKÜ KÖPRÜ HER PDU'YU TAŞIYAMAZ ──────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `CarLauncher` genel bir "PDU gönder" metodu SUNMAZ; servise özel metotlar
 * sunar (`readDtcClass` 03/07/0A · `readAdvancedDtcs` 19/18/13 ·
 * `sendTesterPresent` 3E …). Bu yüzden `ElmPduTransport` bir PDU'yu ancak
 * karşılığı olan metoda EŞLEYEBİLİRSE gönderir.
 *
 * Karşılığı yoksa **istek GÖNDERİLMEZ** ve sonuç `NOT_SUPPORTED_BY_TRANSPORT`
 * olur. Bu bir kusur DEĞİL, ÖLÇÜLMÜŞ bir taşıma sınırıdır ve `gapRegistry`ye
 * `TRANSPORT_LIMITATION` olarak yazılır — gelecekteki genel PDU köprüsünün
 * (ya da DoIP'in) kapatacağı boşluk tam olarak budur.
 *
 * ⚠️ `NOT_SUPPORTED_BY_TRANSPORT` **asla** "araç bu servisi desteklemiyor"
 * DEMEK DEĞİLDİR. Biri taşıma hakkında, diğeri araç hakkında bir iddiadır ve
 * ikisini karıştırmak ürünün defalarca ödediği kusur sınıfıdır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ TAŞIMA OTORİTESİ DEĞİLDİR.** Real/Virtual anahtarı TEK yerde
 *     (`vdkTransport`) kalır; burada yalnız iki uygulama tanımlanır.
 * (2) **KARAR VERMEZ.** Admission · lease · tuning kararı · geç yanıt kapısı
 *     F1-A/B/C otoritelerindedir.
 * (3) **BAĞLANTI YÖNETMEZ.** Bağlanmaz · kopmaz · recovery başlatmaz.
 */

import { CarLauncher } from '../nativePlugin';
import {
  encodePduRequest, isAddressable,
  pduOutcomeFromAdvanced, pduOutcomeFromDtcClass, pduUnmeasured,
  type DiagnosticPdu, type PduResponse, type PduSessionEvidence,
  type PduTuningEvidence,
} from './pdu';

/* ══════════════════════════════════════════════════════════════════════════
   1) ARAYÜZ
   ══════════════════════════════════════════════════════════════════════════ */

export type PduTransportKind = 'elm327' | 'virtual';

/** Taşımanın GERÇEKTEN taşıyabildiği servisler — iddia değil, ölçüm. */
export interface PduCapabilities {
  readonly kind: PduTransportKind;
  /** Köprüde karşılığı OLAN servis kimlikleri. */
  readonly supportedServices: readonly string[];
  /** Genel "ham PDU gönder" yolu var mı — bugün HİÇBİR taşımada YOK. */
  readonly supportsArbitraryPdu: boolean;
}

export interface PduSendOptions {
  /** F1-C: ISO-TP akış kontrolü UYGULA (karar çağıranındır). */
  readonly isoTpTuning?: boolean;
  /** Hedefin adreslenebilirliği KANITLANMIŞ mı (KWP fail-closed kapısı). */
  readonly targetVerified?: boolean;
  /**
   * ARCH-05 — isteği DOĞURAN çağıran sınıfı. Verilmezse `LOCAL_UI` sayılır:
   * bu taşımaya bugün YALNIZ baş ünitenin kendi teşhis akışı ulaşır (uzak
   * kanal ve Mavi buraya ERİŞEMEZ; kilit testi bunu sabitler). Uzak/asistan
   * bir yol açılırsa sınıfını AÇIKÇA vermek ZORUNDADIR.
   */
  readonly principal?: import('../security/enforcement').SecurityPrincipalClass;
  /** ARCH-03 operasyon kimliği — güvenlik kararı bu operasyona bağlanır. */
  readonly operationId?: string;
}

export interface PduTransport {
  readonly capabilities: PduCapabilities;
  /**
   * PDU'yu gönderir ve ÖLÇÜLEN sonucu döner.
   *
   * ASLA throw etmez: taşıma hatası bir SONUÇTUR (`TRANSPORT_ERROR`) ve
   * kanıt olarak yukarı taşınmalıdır — istisna o kanıdı yok ederdi.
   */
  send(pdu: DiagnosticPdu, opts?: PduSendOptions): Promise<PduResponse>;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ELM327 TAŞIMASI — mevcut köprüye EŞLEME
   ══════════════════════════════════════════════════════════════════════════ */

/** `readDtcClass` ile taşınabilen fonksiyonel servisler. */
const DTC_CLASS_MODES: ReadonlySet<string> = new Set(['03', '07', '0A']);
/** `readAdvancedDtcs` ile taşınabilen üretici servisleri. */
const ADVANCED_SERVICES: ReadonlySet<string> = new Set(['19', '18', '13']);

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
  /* Eski APK bu alanları TAŞIMAZ → `null` kalır ve keepalive AÇILMAZ
     (F1-B fail-closed kuralı DEĞİŞMEDİ). */
  if (!('sessionOpened' in r)) return null;
  return {
    opened: typeof r.sessionOpened === 'boolean' ? r.sessionOpened : null,
    command: typeof r.sessionCommand === 'string' ? r.sessionCommand : null,
  };
}

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Gerçek ELM327 köprüsü.
 *
 * Her dal MEVCUT native metoda delege eder ve dönen zarfı PDU sözlüğüne
 * ÇEVİRİR. Hiçbir yeni komut üretilmez, hiçbir native davranış değişmez.
 */
export class ElmPduTransport implements PduTransport {
  readonly capabilities: PduCapabilities = Object.freeze({
    kind: 'elm327' as const,
    supportedServices: Object.freeze(['03', '07', '0A', '19', '18', '13', '3E']),
    /* Köprüde genel "ham PDU gönder" metodu YOKTUR — bu ölçülmüş sınırdır. */
    supportsArbitraryPdu: false,
  });

  async send(pdu: DiagnosticPdu, opts: PduSendOptions = {}): Promise<PduResponse> {
    if (!isAddressable(pdu.target)) {
      return pduUnmeasured('NOT_ADDRESSABLE',
        `hedef adreslenemez (${pdu.target.txHeader ?? 'null'}) — istek GÖNDERİLMEDİ`);
    }

    try {
      if (DTC_CLASS_MODES.has(pdu.service) && pdu.target.addressing === 'functional') {
        return await this._dtcClass(pdu);
      }
      if (DTC_CLASS_MODES.has(pdu.service)) {
        return await this._dtcFromEcu(pdu);
      }
      if (ADVANCED_SERVICES.has(pdu.service)) {
        return await this._advanced(pdu, opts);
      }
      if (pdu.service === '3E') {
        return await this._testerPresent(pdu);
      }
      /* Köprüde karşılığı YOK → istek GİTMEDİ. Araç hakkında hiçbir şey
         öğrenilmedi ve "desteklenmiyor" DENMEZ. */
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        `ELM327 köprüsünde servis ${pdu.service} için metot yok`);
    } catch (e) {
      /* İstisna = TAŞIMA hatası (bağlantı koptu / plugin reject). Araç
         yeteneği hakkında kanıt DEĞİLDİR. */
      return pduUnmeasured('TRANSPORT_ERROR',
        e instanceof Error ? e.message : String(e));
    }
  }

  private async _dtcClass(pdu: DiagnosticPdu): Promise<PduResponse> {
    const fn = CarLauncher.readDtcClass;
    if (!fn) {
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        'eski APK: readDtcClass yok');
    }
    const r = await fn({ mode: pdu.service as '03' | '07' | '0A' }) as Record<string, unknown>;
    return {
      outcome: pduOutcomeFromDtcClass(typeof r.outcome === 'string' ? r.outcome : null),
      raw: typeof r.raw === 'string' && r.raw.length > 0 ? r.raw : null,
      nrc: null,
      latencyMs: _num(r.elapsedMs),
      byteCount: null, frameCount: null,
      protocol: typeof r.protocol === 'string' ? r.protocol : pdu.protocol,
      transportKind: typeof r.outcome === 'string' ? r.outcome : null,
      session: null, tuning: null, detail: null,
    };
  }

  private async _dtcFromEcu(pdu: DiagnosticPdu): Promise<PduResponse> {
    const fn = CarLauncher.readDtcFromEcu;
    if (!fn) {
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        'eski APK: readDtcFromEcu yok');
    }
    const r = await fn({
      tx: pdu.target.txHeader ?? '', rx: pdu.target.rxHeader ?? '',
      mode: pdu.service as '03' | '07' | '0A',
    }) as Record<string, unknown>;
    return {
      outcome: pduOutcomeFromDtcClass(typeof r.outcome === 'string' ? r.outcome : null),
      raw: typeof r.raw === 'string' && r.raw.length > 0 ? r.raw : null,
      nrc: null,
      latencyMs: _num(r.elapsedMs),
      byteCount: null, frameCount: null,
      protocol: typeof r.protocol === 'string' ? r.protocol : pdu.protocol,
      transportKind: typeof r.outcome === 'string' ? r.outcome : null,
      session: null, tuning: null, detail: null,
    };
  }

  private async _advanced(pdu: DiagnosticPdu, opts: PduSendOptions): Promise<PduResponse> {
    const fn = CarLauncher.readAdvancedDtcs;
    if (!fn) {
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        'eski APK: readAdvancedDtcs yok');
    }
    const r = await fn({
      service: pdu.service as '19' | '18' | '13',
      subFunction: pdu.subFunction ?? pdu.service,
      payload: pdu.payload,
      tx: pdu.target.txHeader ?? '', rx: pdu.target.rxHeader ?? '',
      ...(opts.targetVerified === true ? { targetVerified: true } : {}),
      ...(opts.isoTpTuning === true ? { isoTpTuning: true } : {}),
    }) as Record<string, unknown>;
    return {
      outcome: pduOutcomeFromAdvanced(typeof r.outcome === 'string' ? r.outcome : null),
      raw: typeof r.raw === 'string' && r.raw.length > 0 ? r.raw : null,
      nrc: _num(r.nrc),
      latencyMs: null,
      byteCount: _num(r.byteCount),
      frameCount: _num(r.frameCount),
      protocol: pdu.protocol,
      transportKind: typeof r.kind === 'string' ? r.kind : null,
      session: _sessionFrom(r),
      tuning: _tuningFrom(r),
      detail: typeof r.error === 'string' ? r.error : null,
    };
  }

  private async _testerPresent(pdu: DiagnosticPdu): Promise<PduResponse> {
    const fn = CarLauncher.sendTesterPresent;
    if (!fn) {
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        'eski APK: sendTesterPresent yok');
    }
    const r = await fn({
      tx: pdu.target.txHeader ?? '', rx: pdu.target.rxHeader ?? '',
    }) as Record<string, unknown>;
    return {
      outcome: pduOutcomeFromAdvanced(typeof r.outcome === 'string' ? r.outcome : null),
      raw: typeof r.raw === 'string' && r.raw.length > 0 ? r.raw : null,
      nrc: _num(r.nrc),
      latencyMs: null, byteCount: null, frameCount: null,
      protocol: pdu.protocol,
      transportKind: typeof r.kind === 'string' ? r.kind : null,
      session: null, tuning: null,
      detail: typeof r.error === 'string' ? r.error : null,
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SANAL TAŞIMA — doğrulanmış izden
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir PDU'yu izdeki ölçülmüş yanıta çeviren teslim fonksiyonu.
 *
 * ⚠️ `vdkTransport` bu fonksiyonu ENJEKTE eder; `pduTransport` doğrudan
 * `virtualTransport`a bağlanmaz. Böylece Real/Virtual anahtarı TEK yerde
 * kalır ve bu dosya ikinci bir replay otoritesi kurmaz.
 */
export type VirtualPduDelivery = (
  pdu: DiagnosticPdu, opts: PduSendOptions,
) => Promise<PduResponse>;

/**
 * Sanal taşıma — ölçülmüş izden yanıt verir, ASLA yanıt UYDURMAZ.
 *
 * Yetenek listesi ELM ile AYNI tutulur (`supportedServices`): replay'in
 * gerçek taşımadan DAHA FAZLA servis taşıyormuş gibi görünmesi, izin
 * kapsamadığı bir yolu "çalışıyor" sanmamıza yol açardı.
 */
export class VirtualPduTransport implements PduTransport {
  readonly capabilities: PduCapabilities = Object.freeze({
    kind: 'virtual' as const,
    /* ⚠️ Bu liste "sanal taşımanın izde KARŞILIĞI olan" servislerdir ve
       `vdkTransport._operationOf`un tanıdığı kümeyle AYNI OLMAK ZORUNDADIR.
       P0-VDK-F6A'da `22`/`21` (DID okuması) kanonik ize girdi; burada
       eklenmeseydi replay onları `NOT_SUPPORTED_BY_TRANSPORT` sayar ve
       çok-ECU kimlik korpusu HİÇ oynatılamazdı. */
    supportedServices: Object.freeze(['03', '07', '0A', '13', '18', '19', '21', '22', '3E']),
    supportsArbitraryPdu: false,
  });

  private readonly deliver: VirtualPduDelivery;

  constructor(deliver: VirtualPduDelivery) { this.deliver = deliver; }

  async send(pdu: DiagnosticPdu, opts: PduSendOptions = {}): Promise<PduResponse> {
    if (!isAddressable(pdu.target)) {
      return pduUnmeasured('NOT_ADDRESSABLE',
        `hedef adreslenemez (${pdu.target.txHeader ?? 'null'}) — istek GÖNDERİLMEDİ`);
    }
    if (!this.capabilities.supportedServices.includes(pdu.service)) {
      return pduUnmeasured('NOT_SUPPORTED_BY_TRANSPORT',
        `sanal taşıma servis ${pdu.service} için kayıt taşımıyor`);
    }
    try {
      return await this.deliver(pdu, opts);
    } catch (e) {
      return pduUnmeasured('TRANSPORT_ERROR',
        e instanceof Error ? e.message : String(e));
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) YETENEK SORGUSU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir PDU'nun bu taşımayla GÖNDERİLEBİLİR olup olmadığı.
 *
 * Çağıran bunu ÖNCEDEN sorabilir ve gönderilemeyecek bir isteği hiç
 * kurmayabilir — ama sormamak da güvenlidir: `send` yine fail-closed
 * `NOT_SUPPORTED_BY_TRANSPORT` döner.
 */
export function canCarry(t: PduTransport, pdu: DiagnosticPdu): boolean {
  if (!isAddressable(pdu.target)) return false;
  return t.capabilities.supportsArbitraryPdu
    || t.capabilities.supportedServices.includes(pdu.service);
}

/** Ham istek künyesi — kanıt/iz yazımında TEK biçim (`pdu.encodePduRequest`). */
export { encodePduRequest };
