/**
 * dtcOutcomeSemantics — MODE 03/07/0A YANITININ SEMANTİK SINIFI (P0-OBD-CORE-05).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `dtcScanEvidence.DtcReadOutcome` (ok/unsupported/no_response/failed) ürün
 * KARARI için yeterlidir ama TEŞHİS için kaba kalır: "ok" hem "43 00 00…"
 * (POZİTİF, 0 kod — servis çalıştı) hem "43 01 03 01 00" (POZİTİF, 1 kod)
 * anlamına gelir; "failed" hem BUS ERROR hem NRC-dışı bozuk yanıtı KARIŞTIRIR.
 *
 * SAHA ÖRNEKLERİ (bu modülün kilit testleri):
 *   03 → 43 00 00 00 00 00 00  = POSITIVE_EMPTY  (0 kod ama servis ÇALIŞTI)
 *   07 → 47 00 00 00 00 00 00  = POSITIVE_EMPTY
 *   0A → 7F 0A 11              = NEGATIVE_UNSUPPORTED (NRC 0x11 = service not supported)
 *
 * NEGATIVE_UNSUPPORTED "0 kod" DEĞİLDİR, "ECU sustu" DEĞİLDİR, coverage loss
 * SAYILMAZ — servis bu araçta desteklenmiyor, bu kalıcı ve normal bir bilgidir
 * (bkz. `dtcAuthority.isCoverageLoss` — zaten `unsupported`'ı kapsam kaybı
 * SAYMAZ; bu modül o kararı DEĞİŞTİRMEZ, yalnız NEDEN'i (NRC) ölçülebilir kılar).
 *
 * DEFERRED/NOT_RUN bu sınıflandırıcının ÜRETTİĞİ bir sonuç DEĞİLDİR — onlar
 * admisyon kapısının (bkz. `diagnosticAdmission.ts`) SORGU HİÇ GÖNDERİLMEDEN
 * verdiği kararlardır. Bu dosya yalnız GERÇEKTEN gelen bir ham yanıtı sınıflar.
 *
 * SAF: I/O yok, durum yok, `Date.now` yok — tam test edilebilir. Mevcut
 * parserlar (`OBDHandshake.ts`, `dtcClearModel.classifyClearResponse`)
 * YENİDEN YAZILMADI; hizalama/gövde-ayırma yöntemi AYNI ilkeyi izler (çift
 * hizada arama, ISO-TP segment önekleri temizlenir) ama bu YENİ bir sınıflayıcıdır
 * (Mode 03/07/0A'nın SID'i 04'ten farklıdır — kopya değil, kardeş kural).
 */

export type DtcReadSemanticOutcome =
  /** POZİTİF yanıt + en az 1 kod. */
  | 'POSITIVE_WITH_CODES'
  /** POZİTİF yanıt + 0 kod — "servis çalıştı, bulgu yok" (GERÇEK ölçüm). */
  | 'POSITIVE_EMPTY'
  /** Açık negatif yanıt (7F), NRC = servis desteklenmiyor (0x11/0x12/0x31). */
  | 'NEGATIVE_UNSUPPORTED'
  /** Açık negatif yanıt (7F), NRC BAŞKA bir sebep (busy/security/vs). */
  | 'NEGATIVE_OTHER'
  /** ELM327 "NO DATA" — ECU SUSTU. Kod yok DEMEK DEĞİL, ölçüm YOK demek. */
  | 'NO_DATA'
  /** Hiç bayt gelmedi (boş/null yanıt, prompt'a kadar zaman aşımı). */
  | 'PROMPT_TIMEOUT'
  /** Bir miktar bayt geldi ama yanıt tamamlanmadan kesildi. */
  | 'PARTIAL_TIMEOUT'
  /** Hat/protokol hatası (STOPPED · CAN ERROR · BUS ERROR · UNABLE TO CONNECT…). */
  | 'BUS_ERROR'
  /** Adaptör komutu anlamadı ("?") veya taşıma katmanı reddetti. */
  | 'TRANSPORT_ERROR'
  /** Admisyon kapısı BLOKLADI — sorgu hiç GÖNDERİLMEDİ. (Bu dosya üretmez.) */
  | 'DEFERRED'
  /** Bu turda hiç denenmedi (mod atlandı). (Bu dosya üretmez.) */
  | 'NOT_RUN'
  /** Yanıt geldi ama tanınan hiçbir kalıba uymadı — bozuk/beklenmeyen. */
  | 'MALFORMED';

export const DTC_SEMANTIC_OUTCOME_LABEL: Readonly<Record<DtcReadSemanticOutcome, string>> = {
  POSITIVE_WITH_CODES:  'pozitif yanıt — kod var',
  POSITIVE_EMPTY:       'pozitif yanıt — 0 kod (servis çalıştı)',
  NEGATIVE_UNSUPPORTED: 'servis desteklenmiyor (NRC)',
  NEGATIVE_OTHER:       'ECU reddetti (NRC)',
  NO_DATA:              'ECU SUSTU (NO DATA) — ölçüm yok',
  PROMPT_TIMEOUT:       'zaman aşımı — hiç bayt gelmedi',
  PARTIAL_TIMEOUT:      'zaman aşımı — yanıt yarım kaldı',
  BUS_ERROR:            'hat/protokol hatası',
  TRANSPORT_ERROR:      'taşıma hatası / adaptör reddi',
  DEFERRED:             'ertelendi — oturum hazır değildi',
  NOT_RUN:              'hiç denenmedi',
  MALFORMED:            'tanınmayan/bozuk yanıt',
} as const;

/** SAE J1979 Mode 03/07/0A pozitif yanıt SID'leri (istek modu + 0x40). */
const POSITIVE_SID: Readonly<Record<'03' | '07' | '0A', string>> = {
  '03': '43', '07': '47', '0A': '4A',
};

/**
 * ISO 14229 negatif yanıt kodlarından "servis desteklenmiyor" ailesi.
 * 0x11 serviceNotSupported · 0x12 subFunctionNotSupported ·
 * 0x31 requestOutOfRange (bazı ECU'lar desteklenmeyen modu böyle reddeder).
 */
const UNSUPPORTED_NRC: ReadonlySet<string> = new Set(['11', '12', '31']);

/**
 * Ham ELM327 yanıtını hizalanmış hex gövdelere ayırır — `dtcClearModel`teki
 * `splitClearBodies` ile AYNI ilke (ISO-TP segment önekleri birleştirilir;
 * tek-uzunluklu gövdenin CAN-kimliği önizlemesi atılır). Mode 03/07/0A'nın
 * kendi SID'i farklı olduğu için AYRI fonksiyon — parser KOPYALANMADI, aynı
 * hizalama ilkesi yeniden uygulandı.
 */
/**
 * Bir ELM327 yanit satirinin cozulmus govdesi.
 *
 * P0-VDK-F2C1: `header` ALANI EKLENDI (additive). Olculen kayip: `ATH1` acikken
 * satir basindaki 11-bit CAN kimligi (`7E8`) hizayi bozdugu icin ATILIYORDU —
 * ama o uc hane **hangi ECU'nun cevapladiginin TEK kanitidir**. Atilinca
 * cok-ECU fonksiyonel yanitta kodlarin sahibi olculemez hale geliyordu.
 * Artik atilmiyor, TASINIYOR; hiza davranisi BIREBIR ayni kaldi.
 *
 * `header === null` -> satirda kimlik YOKTU (ATH0). Uydurulmaz.
 */
export interface DtcResponseBody {
  /** Hizalanmis, yalniz hex haneler iceren govde (kimlik SOYULMUS). */
  readonly hex: string;
  /** Olculen ECU kimligi (3 hane, 11-bit CAN); olculmediyse `null`. */
  readonly header: string | null;
}

/**
 * Ham ELM327 metnini satir/segment govdelerine ayirir.
 *
 * TEK YER: native `ElmProtocol.splitResponseBodies` + `alignBody` ile BIREBIR
 * ayni kurallari uygular (ISO-TP `0:`/`1:` segment birlestirme · cok-ECU ayri
 * satir · tek uzunlukta govdede bastaki 3 hanenin hiza icin soyulmasi).
 * `functionalDtc` parser'i bunu YENIDEN YAZMAZ — ikinci ayirici kurmak, ayni
 * hatayi iki yerde duzeltmek demek olurdu.
 */
export function splitDtcBodies(raw: string): DtcResponseBody[] {
  const bodies: string[] = [];
  let segmented = '';
  for (const line of raw.toUpperCase().split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^[0-9A-F]{1,2}:/.test(t)) {
      segmented += t.slice(t.indexOf(':') + 1).replace(/[^0-9A-F]/g, '');
    } else {
      const hex = t.replace(/[^0-9A-F]/g, '');
      if (hex.length > 0) bodies.push(hex);
    }
  }
  if (segmented.length > 0) bodies.push(segmented);
  return bodies.map((h) => (h.length % 2 === 1 && h.length >= 3
    ? { hex: h.slice(3), header: h.slice(0, 3) }
    : { hex: h, header: null }));
}

function _splitBodies(raw: string): string[] {
  return splitDtcBodies(raw).map((b) => b.hex);
}

/**
 * Bir Mode 03/07/0A ham yanıtını semantik sınıfa çevirir.
 *
 * @param service   '03' (onaylı) · '07' (bekleyen) · '0A' (kalıcı)
 * @param raw       ham ELM327 yanıtı; `null`/`undefined` = hiç bayt gelmedi
 * @param codeCount SORGU GERÇEKTEN gönderildiyse çözümlenen kod sayısı (POZİTİF
 *                  yanıtta 0 ile >0 ayrımı için — ayrı çözümleyici SONUCU, burada
 *                  YENİDEN parse EDİLMEZ, tek doğruluk kaynağı bozulmaz).
 */
export function classifyDtcReadResponse(
  service: '03' | '07' | '0A',
  raw: string | null | undefined,
  codeCount: number,
): DtcReadSemanticOutcome {
  if (raw === null || raw === undefined) return 'PROMPT_TIMEOUT';
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (compact.length === 0) return 'PROMPT_TIMEOUT';

  if (compact === '?') return 'TRANSPORT_ERROR';
  if (compact.includes('NODATA')) return 'NO_DATA';
  if (
    compact.includes('UNABLETOCONNECT') || compact.includes('CANERROR')
    || compact.includes('BUSERROR') || compact.includes('BUSINIT:ERROR')
    || compact.includes('STOPPED') || compact.includes('BUFFERFULL')
    || compact.includes('DATAERROR') || compact.includes('RXERROR')
  ) return 'BUS_ERROR';

  const bodies = _splitBodies(raw);
  const posSid = POSITIVE_SID[service];

  // (1) Açık negatif yanıt — 7F <mode> <NRC>, ÇİFT hizada. `includes` KULLANILMAZ
  //     (dtcClearModel'in kök nedeni: hizasız eşleşme sahte sonuç üretir).
  for (const body of bodies) {
    for (let i = 0; i + 6 <= body.length; i += 2) {
      if (body.startsWith('7F' + service, i)) {
        const nrc = body.slice(i + 4, i + 6);
        return UNSUPPORTED_NRC.has(nrc) ? 'NEGATIVE_UNSUPPORTED' : 'NEGATIVE_OTHER';
      }
    }
  }

  // (2) Pozitif yanıt — SID (43/47/4A), ÇİFT hizada.
  for (const body of bodies) {
    for (let i = 0; i + 2 <= body.length; i += 2) {
      if (body.startsWith(posSid, i)) {
        const payload = body.slice(i + 2);
        // SID var ama tek bir data baytı bile yok → gövde erken kesilmiş.
        if (payload.length < 2) return codeCount > 0 ? 'POSITIVE_WITH_CODES' : 'PARTIAL_TIMEOUT';
        return codeCount > 0 ? 'POSITIVE_WITH_CODES' : 'POSITIVE_EMPTY';
      }
    }
  }

  // (3) Hiçbir tanınan kalıba uymadı — çok kısa gövde muhtemelen kesilmiş yanıt,
  //     yeterli uzunlukta ama tanınmayan SID ise gerçekten bozuk/beklenmeyen.
  const totalLen = bodies.reduce((n, b) => n + b.length, 0);
  return totalLen < 4 ? 'PARTIAL_TIMEOUT' : 'MALFORMED';
}

/** Bu sınıf "ölçülmüş kapsam kaybı" mı — DTC_OS-F0-1 fail-closed felsefesiyle aynı ayrım. */
export function isSemanticCoverageLoss(o: DtcReadSemanticOutcome): boolean {
  return o === 'NO_DATA' || o === 'PROMPT_TIMEOUT' || o === 'PARTIAL_TIMEOUT'
      || o === 'BUS_ERROR' || o === 'TRANSPORT_ERROR' || o === 'MALFORMED'
      || o === 'DEFERRED' || o === 'NOT_RUN';
}

/** Bu sınıf GERÇEK bir ölçüm mü (pozitif VEYA negatif — ikisi de bir CEVAPTIR). */
export function isSemanticMeasurement(o: DtcReadSemanticOutcome): boolean {
  return o === 'POSITIVE_WITH_CODES' || o === 'POSITIVE_EMPTY'
      || o === 'NEGATIVE_UNSUPPORTED' || o === 'NEGATIVE_OTHER';
}
