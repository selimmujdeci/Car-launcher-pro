/**
 * pduParity — P0-VDK-F4A · LEGACY ⇄ GENEL KÖPRÜ PARITY TANIĞI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN ─────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Genel köprü yazmak kolaydır; **kanıtlanmış legacy yolla AYNI sonucu ürettiğini
 * göstermek** zordur. F4A §6 bu yüzden legacy yolun silinmesini YASAKLAR ve onu
 * TANIK olarak kullanmayı ister: aynı PDU iki yoldan gönderilir ve sonuçlar
 * alan alan karşılaştırılır.
 *
 * Fark varsa **hangi katmanda** olduğu görünür olmalıdır — "bir yerde farklı"
 * bir teşhis değildir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SAF MODEL ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Karşılaştırma SAFTIR: I/O yok · timer yok · `Date.now` yok · global durum yok.
 * Koşturucu (`runPduParity`) taşımaları DIŞARIDAN alır; kendi taşımasını
 * seçmez, politika okumaz, ikinci bir otorite kurmaz.
 *
 * ⚠️ GECİKME KARŞILAŞTIRILMAZ: iki çağrı farklı anlarda yapılır ve `latencyMs`
 * doğal olarak farklıdır. Onu "fark" saymak, her koşuyu MISMATCH yapardı.
 */

import type { DiagnosticPdu, PduResponse } from './pdu';
import { pduIdentity } from './pdu';
import type { PduSendOptions, PduTransport } from './pduTransport';

/* ══════════════════════════════════════════════════════════════════════════
   1) KARŞILAŞTIRILAN KATMANLAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Farkın HANGİ katmanda olduğu — serbest metin YOK. */
export type ParityAxis =
  /** Ham yanıt gövdesi (soyulmuş). */
  | 'RAW'
  /** Taşıma sonucu sınıfı. */
  | 'OUTCOME'
  /** Negatif yanıt kodu. */
  | 'NRC'
  /** F1-B oturum kanıtı (açıldı mı / hangi komutla). */
  | 'SESSION'
  /** F1-C ayar kanıtı (uygulandı mı / komutlar / mod). */
  | 'TUNING'
  /** F1-C geri alma kanıtı — adaptör kirli kaldı mı. */
  | 'RESTORE'
  /** ISO-TP çerçeve/bayt sayımı. */
  | 'FRAMING';

export const PARITY_AXIS_LABEL: Readonly<Record<ParityAxis, string>> = {
  RAW:     'ham yanıt',
  OUTCOME: 'sonuç sınıfı',
  NRC:     'negatif yanıt kodu',
  SESSION: 'oturum kanıtı',
  TUNING:  'ISO-TP ayar kanıtı',
  RESTORE: 'ayar geri alma kanıtı',
  FRAMING: 'çerçeve/bayt sayımı',
} as const;

export interface ParityDifference {
  readonly axis: ParityAxis;
  /** Legacy yolun ölçtüğü — `null` = ölçülmedi. */
  readonly legacy: string | null;
  /** Genel köprünün ölçtüğü — `null` = ölçülmedi. */
  readonly generic: string | null;
}

export type ParityVerdict =
  /** Karşılaştırılan tüm eksenler AYNI. */
  | 'MATCH'
  /** En az bir eksende fark var. */
  | 'PARITY_MISMATCH'
  /**
   * Karşılaştırma YAPILAMADI: taraflardan biri isteği hiç göndermedi
   * (köprüde karşılığı yok / güvenlik kapısı / adreslenemez). Bu bir fark
   * DEĞİLDİR — iki farklı soruyu karşılaştırmak yanıltıcı olurdu.
   */
  | 'NOT_COMPARABLE';

export interface ParityResult {
  readonly verdict: ParityVerdict;
  /** İsteğin künyesi — hangi PDU karşılaştırıldı. */
  readonly identity: string;
  readonly differences: readonly ParityDifference[];
  /** `NOT_COMPARABLE` gerekçesi; aksi hâlde `null`. */
  readonly incomparableReason: string | null;
  readonly legacyOutcome: PduResponse['outcome'];
  readonly genericOutcome: PduResponse['outcome'];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SAF KARŞILAŞTIRMA
   ══════════════════════════════════════════════════════════════════════════ */

/** İstek HİÇ gitmedi mi — karşılaştırma bu durumda ANLAMSIZDIR. */
function _notSent(o: PduResponse['outcome']): boolean {
  return o === 'NOT_SUPPORTED_BY_TRANSPORT' || o === 'NOT_ADDRESSABLE'
    || o === 'DENIED_BY_SAFETY_GATE';
}

function _s(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function _diff(
  axis: ParityAxis, a: unknown, b: unknown, out: ParityDifference[],
): void {
  const l = _s(a); const g = _s(b);
  if (l !== g) out.push({ axis, legacy: l, generic: g });
}

/**
 * İki yanıtı alan alan karşılaştırır.
 *
 * ⚠️ `protocol`, `transportKind` ve `latencyMs` KARŞILAŞTIRILMAZ:
 *  · `latencyMs` iki ayrı ana aittir (bkz. dosya başlığı),
 *  · `transportKind` taşımanın KENDİ etiketidir — iki taşımanın farklı
 *    etiket kullanması bir kusur değil, tanımdır,
 *  · `protocol` çağrı anındaki ölçümdür ve isteğin sonucu değildir.
 */
export function comparePduResponses(
  pdu: DiagnosticPdu, legacy: PduResponse, generic: PduResponse,
): ParityResult {
  const identity = pduIdentity(pdu);

  if (_notSent(legacy.outcome) || _notSent(generic.outcome)) {
    const who = _notSent(legacy.outcome) && _notSent(generic.outcome) ? 'her iki yol'
      : _notSent(legacy.outcome) ? 'legacy yol' : 'genel köprü';
    return {
      verdict: 'NOT_COMPARABLE', identity, differences: [],
      incomparableReason:
        `${who} isteği GÖNDERMEDİ (legacy=${legacy.outcome} · generic=${generic.outcome})`,
      legacyOutcome: legacy.outcome, genericOutcome: generic.outcome,
    };
  }

  const d: ParityDifference[] = [];
  _diff('OUTCOME', legacy.outcome, generic.outcome, d);
  _diff('RAW', legacy.raw, generic.raw, d);
  _diff('NRC', legacy.nrc, generic.nrc, d);
  _diff('SESSION', _sessionKey(legacy), _sessionKey(generic), d);
  _diff('TUNING', _tuningKey(legacy), _tuningKey(generic), d);
  _diff('RESTORE', _restoreKey(legacy), _restoreKey(generic), d);
  _diff('FRAMING', `${legacy.byteCount}/${legacy.frameCount}`,
    `${generic.byteCount}/${generic.frameCount}`, d);

  return {
    verdict: d.length === 0 ? 'MATCH' : 'PARITY_MISMATCH',
    identity, differences: d, incomparableReason: null,
    legacyOutcome: legacy.outcome, genericOutcome: generic.outcome,
  };
}

function _sessionKey(r: PduResponse): string {
  return r.session === null ? 'null'
    : `${r.session.opened}/${r.session.command ?? ''}`;
}

function _tuningKey(r: PduResponse): string {
  return r.tuning === null ? 'null'
    : `${r.tuning.applied}/${r.tuning.commands ?? ''}/${r.tuning.previousMode ?? ''}→${r.tuning.newMode ?? ''}`;
}

function _restoreKey(r: PduResponse): string {
  return r.tuning === null ? 'null'
    : `${r.tuning.restored}/${r.tuning.restoreDetail ?? ''}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KOŞTURUCU — taşımalar DIŞARIDAN gelir
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aynı PDU'yu iki yoldan gönderir ve karşılaştırır.
 *
 * SIRA BİLİNÇLİ: önce legacy, sonra generic. İkisi arasında ECU durumu
 * değişebilir (oturum zaman aşımı) — bu, parity'nin doğasında olan ve
 * raporda AÇIKÇA taşınan bir sınırdır. Bu yüzden `PARITY_MISMATCH` bir
 * "kusur kanıtı" değil, bir "incele" işaretidir.
 *
 * Ürün yolu bu fonksiyonu ÇAĞIRMAZ; kabul/kanıt koşusuna aittir.
 */
export async function runPduParity(
  pdu: DiagnosticPdu,
  legacyTransport: PduTransport,
  genericTransport: PduTransport,
  opts: PduSendOptions = {},
): Promise<ParityResult> {
  const legacy = await legacyTransport.send(pdu, opts);
  const generic = await genericTransport.send(pdu, opts);
  return comparePduResponses(pdu, legacy, generic);
}
