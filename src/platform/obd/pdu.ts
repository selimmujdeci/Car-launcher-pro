/**
 * pdu — P0-VDK-F3A · PROTOKOLDEN BAĞIMSIZ TANI PDU'SU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (F2-C2'de ÖLÇÜLEN açık) ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bugünkü taşıma sınırı `CarLauncher` **metot setidir**: her yeni tanı servisi
 * için köprüye yeni bir metot eklemek gerekiyor (`readDtcClass` ·
 * `readAdvancedDtcs` · `sendTesterPresent` …). Bunun üç ölçülmüş bedeli var:
 *
 *  · **Yeni servis eklemek bir köprü değişikliğidir** — yani yeni APK. Bir
 *    servisi denemek için sahaya yeni sürüm göndermek gerekiyor.
 *  · **DoIP / J2534 / doğrudan CAN eklenemez.** Sınır ELM327 metotlarına
 *    şekillenmiş durumda; başka bir taşıma bu metotların altına GİRMİYOR.
 *  · **İstek kimliği her çağrı yerinde ELLE kuruluyor** (`${service}${sub}${payload}`).
 *    Aynı biçim `_recordAdvanced`, `_replayAdvancedDtcs` ve künye eşleştirmede
 *    üç kez tekrarlanıyor; biri değişirse replay sessizce eşleşmez.
 *
 * PDU bu üçünü tek sözleşmede toplar: **ne sorulduğu** taşımadan bağımsız
 * ifade edilir; **nasıl gönderildiği** taşımanın sorunudur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ TAŞIMA DEĞİLDİR.** Hiçbir hat açmaz, hiçbir bayt göndermez.
 *     Yalnız SÖZLEŞMEDİR; gönderim `pduTransport` uygulamalarınındır.
 * (2) **İKİNCİ SONUÇ SÖZLÜĞÜ DEĞİLDİR.** `PduOutcome` MEVCUT native/TS
 *     sözlüklerinin (`advancedDtcs.outcome` · `DtcReadSemanticOutcome`)
 *     ÜSTÜNE geçmez; onlara ÇEVRİLİR ve çeviri TEK yerdedir.
 * (3) **CDDL DEĞİLDİR.** `ServiceDef`/`DataObjectProp`/`ProcedureDef` bu
 *     turun DIŞINDADIR (F3-B). Burada yalnız "bir istek nasıl ifade edilir"
 *     sorusu yanıtlanır.
 * (4) **KARAR VERMEZ.** Admission · lease · tuning kararı · geç yanıt kapısı
 *     hepsi F1-A/B/C otoritelerinde KALIR.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) ADRESLEME
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * İsteğin KİME gittiği — protokol ailesinden bağımsız ifade.
 *
 * `unknown` fail-closed'dur: adres bilinmiyorsa istek GÖNDERİLMEZ. Ürünün
 * "uydurma adrese kör istek YASAK" kuralı bu değerle taşınır.
 */
export type PduAddressing =
  /** Yayın (OBD-II 7DF) — tek ECU'ya ait DEĞİL. */
  | 'functional'
  /** 11-bit CAN fiziksel adres (7E0/7E8 ailesi). */
  | 'physical_can11'
  /** 29-bit CAN fiziksel adres. */
  | 'physical_can29'
  /** ISO 14230 / ISO 9141 fiziksel adres (3 baytlık başlık). */
  | 'physical_kwp'
  /** Adres ÖLÇÜLMEDİ — istek gönderilemez. */
  | 'unknown';

export const PDU_ADDRESSING_LABEL: Readonly<Record<PduAddressing, string>> = {
  functional:     'fonksiyonel yayın (7DF)',
  physical_can11: 'fiziksel · 11-bit CAN',
  physical_can29: 'fiziksel · 29-bit CAN',
  physical_kwp:   'fiziksel · KWP/ISO',
  unknown:        'adres ÖLÇÜLMEDİ — istek gönderilemez',
} as const;

/** İsteğin hedefi. Fonksiyonel yayında başlıklar `null`dur. */
export interface PduTarget {
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly addressing: PduAddressing;
  /** İnsan okunur etiket (`Motor (ECM)`); ölçülmediyse `null`. */
  readonly label: string | null;
}

/** Fonksiyonel yayın hedefi — tek ECU'ya ait DEĞİL. */
export const FUNCTIONAL_TARGET: PduTarget = Object.freeze({
  txHeader: null, rxHeader: null, addressing: 'functional' as const,
  label: 'FONKSİYONEL (7DF)',
});

/**
 * Başlık uzunluğundan adresleme sınıfını ÖLÇER — tahmin etmez.
 *
 * 3 hane → 11-bit CAN · 6 hane → KWP (3 bayt) · 8 hane → 29-bit CAN.
 * Tanınmayan biçim `unknown`dur ve fail-closed davranışı tetikler; bir
 * adresi "muhtemelen CAN'dır" diye sınıflandırmak, ürünün defalarca ödediği
 * "uydurma adrese istek" kusurudur.
 */
export function addressingFromHeader(txHeader: string | null): PduAddressing {
  if (txHeader === null) return 'functional';
  const h = txHeader.trim().toUpperCase();
  if (!/^[0-9A-F]+$/.test(h)) return 'unknown';
  return h.length === 3 ? 'physical_can11'
    : h.length === 6 ? 'physical_kwp'
      : h.length === 8 ? 'physical_can29' : 'unknown';
}

/** Hedefi ölçülmüş başlıklardan kurar. Adres tanınmazsa `unknown` kalır. */
export function pduTarget(
  txHeader: string | null, rxHeader: string | null, label: string | null = null,
): PduTarget {
  return {
    txHeader: txHeader === null || txHeader.length === 0 ? null : txHeader,
    rxHeader: rxHeader === null || rxHeader.length === 0 ? null : rxHeader,
    addressing: addressingFromHeader(txHeader === null || txHeader.length === 0 ? null : txHeader),
    label,
  };
}

/** Hedefe istek GÖNDERİLEBİLİR mi — `unknown` adres fail-closed engellenir. */
export function isAddressable(t: PduTarget): boolean {
  return t.addressing !== 'unknown';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) İSTEK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * KANONİK TANI İSTEĞİ.
 *
 * ⚠️ `service`/`subFunction`/`payload` HAM HEX'tir ve bu modül onları
 * YORUMLAMAZ. "Bu servis ne yapar" sorusu CDDL'in (F3-B) işidir.
 */
export interface DiagnosticPdu {
  /** Servis kimliği, 2 hane hex (`03` · `19` · `18` · `3E` · `22`…). */
  readonly service: string;
  /** Alt fonksiyon, 2 hane hex; servisin alt fonksiyonu yoksa `null`. */
  readonly subFunction: string | null;
  /** Gövde (hex); yoksa boş string. */
  readonly payload: string;
  readonly target: PduTarget;
  /** Ölçülen aktif protokol (ATDPN); bilinmiyorsa `null` — uydurulmaz. */
  readonly protocol: string | null;
  /**
   * P0-VDK-F4A — YANITTA YANKILANAN İSTEK BAYTI SAYISI (**VERİ, kod değil**).
   *
   * Olumlu yanıt servis baytı ISO 14229-1/14230-3'te EVRENSEL kuraldır
   * (`SID + 0x40`). Servise özel olan tek şey, isteğin kaç baytının yanıtta
   * yankılandığıdır: `19-02` alt fonksiyonu yankılar (→ `5902`), `18`
   * yankılamaz (→ `58`), `22` iki baytlık DID'i yankılar (→ `62F190`).
   *
   * Bu sayı burada VERİ olarak taşınır ki genel köprü **servis kimliğine göre
   * dal seçmesin**: yeni bir salt-okunur servis eklemek yalnız tanım (veri)
   * eklemek olsun. `0` = ECU SID'den sonra hiçbir şey yankılamaz.
   *
   * ⚠️ `pduIdentity` ve `encodePduRequest` bu alanı KULLANMAZ — replay künyesi
   * DEĞİŞMEZ (F2-B izleri geçerliliğini korur).
   */
  readonly responseEchoBytes: number;
}

export interface PduInput {
  readonly service: string;
  readonly subFunction?: string | null;
  readonly payload?: string;
  readonly target?: PduTarget;
  readonly protocol?: string | null;
  /** Bkz. `DiagnosticPdu.responseEchoBytes`. Verilmezse `0` (hiç yankı yok). */
  readonly responseEchoBytes?: number;
}

export function makePdu(i: PduInput): DiagnosticPdu {
  return {
    service: i.service.toUpperCase(),
    subFunction: i.subFunction === undefined || i.subFunction === null
      ? null : i.subFunction.toUpperCase(),
    payload: (i.payload ?? '').toUpperCase(),
    target: i.target ?? FUNCTIONAL_TARGET,
    protocol: i.protocol ?? null,
    /* Varsayılan 0: yankı İDDİA EDİLMEZ. Yanlış bir yankı sayısı, olumlu yanıtın
       yanlış yerden soyulmasına ve gövdenin bozulmasına yol açar — bu yüzden
       varsayılan "bilmiyorum" değil, "yankı yok"tur ve tanım onu açıkça yazar. */
    responseEchoBytes: i.responseEchoBytes === undefined
      || !Number.isFinite(i.responseEchoBytes) || i.responseEchoBytes < 0
      ? 0 : Math.min(8, Math.floor(i.responseEchoBytes)),
  };
}

/**
 * HAM İSTEK KÜNYESİ — **TEK YER**.
 *
 * ── ÖLÇÜLEN BORÇ ──────────────────────────────────────────────────────────
 * Bu biçim bugün ÜÇ yerde elle kuruluyordu (`_recordAdvanced` · replay kapısı
 * · künye eşleştirme). Üç kopyadan biri değişirse replay SESSİZCE eşleşmez ve
 * hangi yanıtın hangi isteğe ait olduğu ölçülemez hâle gelir. Künye artık
 * tek bir yerden üretilir.
 *
 * Alt fonksiyonu servisin KENDİSİ olan yollarda (`18-18` · `13-13`) tekrar
 * YAZILMAZ — mevcut `_recordAdvanced` davranışıyla BİREBİR aynı.
 */
export function encodePduRequest(pdu: DiagnosticPdu): string {
  const sub = pdu.subFunction === null || pdu.subFunction === pdu.service
    ? '' : pdu.subFunction;
  return `${pdu.service}${sub}${pdu.payload}`;
}

/** İki PDU'nun AYNI soruyu sorup sormadığı — replay künye eşleşmesinin temeli. */
export function pduIdentity(pdu: DiagnosticPdu): string {
  return [
    pdu.service,
    pdu.subFunction ?? '',
    pdu.payload,
    pdu.target.txHeader ?? '',
    pdu.target.rxHeader ?? '',
  ].join('|');
}

/* ══════════════════════════════════════════════════════════════════════════
   3) YANIT
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Taşıma katmanının ÖLÇTÜĞÜ sonuç.
 *
 * ⚠️ Bu bir HÜKÜM DEĞİLDİR: "araç arızalı" · "servis desteklenmiyor" gibi
 * iddialar üst katmanların (parser · authority · verdict) işidir. Burada
 * yalnız "hat ne yaptı" ölçülür.
 *
 * `UNKNOWN` fail-closed'dur ve ASLA "yanıt geldi" sayılmaz.
 */
export type PduOutcome =
  /** Pozitif yanıt geldi (gövde çözümlenmedi — o üst katmanın işi). */
  | 'POSITIVE'
  /** Açık negatif yanıt (`7F <svc> <NRC>`). */
  | 'NEGATIVE'
  /** ECU sustu (ELM "NO DATA") — ölçüm YOK, "kod yok" DEĞİL. */
  | 'NO_RESPONSE'
  /** İstek gönderildi, hiç bayt gelmeden süre doldu. */
  | 'TIMEOUT'
  /** Yanıt geldi ama tanınan hiçbir kalıba uymadı. */
  | 'MALFORMED'
  /** Hat/adaptör hatası (BUS ERROR · BUFFER FULL · bağlantı koptu). */
  | 'TRANSPORT_ERROR'
  /** Hedef adreslenebilir DEĞİL — istek GÖNDERİLMEDİ. */
  | 'NOT_ADDRESSABLE'
  /** Taşıma bu PDU'yu TAŞIYAMIYOR (köprüde karşılığı yok) — istek gitmedi. */
  | 'NOT_SUPPORTED_BY_TRANSPORT'
  /**
   * P0-VDK-F4A — NATIVE GÜVENLİK KAPISI REDDETTİ; hatta TEK BAYT ÇIKMADI.
   *
   * ⚠️ Diğer iki "gitmedi" durumundan AYRI tutulur ve birleştirilmesi YASAKTIR:
   *  · `NOT_SUPPORTED_BY_TRANSPORT` = "köprü bunu taşıyamıyor" (yetenek eksiği)
   *  · `DENIED_BY_SAFETY_GATE`      = "taşıyabilirdi ama İZİN VERİLMEDİ" (politika)
   *  · `NEGATIVE`                   = "ARAÇ desteklemiyor dedi" (araç iddiası)
   * Üçünü karıştırmak, bir güvenlik reddini araç yeteneği sanmaktır.
   */
  | 'DENIED_BY_SAFETY_GATE'
  /** Sınıflandırılamadı — fail-closed. */
  | 'UNKNOWN';

export const PDU_OUTCOME_LABEL: Readonly<Record<PduOutcome, string>> = {
  POSITIVE:                   'pozitif yanıt',
  NEGATIVE:                   'negatif yanıt (NRC)',
  NO_RESPONSE:                'ECU SUSTU — ölçüm yok',
  TIMEOUT:                    'zaman aşımı — hiç bayt gelmedi',
  MALFORMED:                  'tanınmayan/bozuk yanıt',
  TRANSPORT_ERROR:            'hat/adaptör hatası',
  NOT_ADDRESSABLE:            'hedef adreslenemez — istek GÖNDERİLMEDİ',
  NOT_SUPPORTED_BY_TRANSPORT: 'taşıma bu PDU’yu taşıyamıyor — istek GİTMEDİ',
  DENIED_BY_SAFETY_GATE:      'güvenlik kapısı REDDETTİ — hatta tek bayt çıkmadı',
  UNKNOWN:                    'sınıflandırılamadı — fail-closed',
} as const;

/** ISO-TP akış kontrolü kanıtı (F1-C) — ölçülmediyse alanlar `null`. */
export interface PduTuningEvidence {
  readonly applied: boolean | null;
  readonly commands: string | null;
  readonly previousMode: string | null;
  readonly newMode: string | null;
  readonly restored: boolean | null;
  readonly restoreDetail: string | null;
}

/** Tanı oturumu kanıtı (F1-B) — ölçülmediyse alanlar `null`. */
export interface PduSessionEvidence {
  readonly opened: boolean | null;
  readonly command: string | null;
}

/**
 * PDU yanıtı. **Ölçülmeyen her alan `null`** — sahte `0`, sahte `false`,
 * sahte protokol YAZILMAZ.
 */
export interface PduResponse {
  readonly outcome: PduOutcome;
  /** HAM yanıt (taşımanın gördüğü biçimde); ölçülmediyse `null`. */
  readonly raw: string | null;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  readonly byteCount: number | null;
  readonly frameCount: number | null;
  readonly protocol: string | null;
  /** Taşımanın kendi sınıf etiketi (kanıt) — çeviri öncesi ham hâli. */
  readonly transportKind: string | null;
  readonly session: PduSessionEvidence | null;
  readonly tuning: PduTuningEvidence | null;
  /** Sonuç neden böyle sınıflandırıldı — sessiz başarısızlık YASAK. */
  readonly detail: string | null;
}

/** Ölçüm YOKLUĞUNU ifade eden yanıt — "yanıt gelmedi" ile KARIŞTIRILAMAZ. */
export function pduUnmeasured(outcome: PduOutcome, detail: string): PduResponse {
  return {
    outcome, raw: null, nrc: null, latencyMs: null, byteCount: null,
    frameCount: null, protocol: null, transportKind: null,
    session: null, tuning: null, detail,
  };
}

/**
 * Bir sonucun KAPSAM KAYBI olup olmadığı.
 *
 * Kapsam kaybı = "bu ECU/servis hakkında bir şey ÖĞRENEMEDİK". Bunu
 * "sorun yok" saymak, ürünün en pahalı kusur sınıfıdır (ECU susunca
 * "araç temiz" demek). `NEGATIVE` kapsam kaybı DEĞİLDİR: ECU cevap verdi.
 */
export function isPduCoverageLoss(o: PduOutcome): boolean {
  return o === 'NO_RESPONSE' || o === 'TIMEOUT' || o === 'MALFORMED'
    || o === 'TRANSPORT_ERROR' || o === 'NOT_ADDRESSABLE'
    || o === 'NOT_SUPPORTED_BY_TRANSPORT' || o === 'DENIED_BY_SAFETY_GATE'
    || o === 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SÖZLÜK ÇEVİRİSİ — TEK YER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Native `readAdvancedDtcs.outcome` sözlüğünü PDU sözlüğüne çevirir.
 *
 * ⚠️ İKİNCİ SÖZLÜK KURULMUYOR: bu fonksiyon iki MEVCUT sözlük arasında
 * köprüdür ve çeviri TEK yerdedir. Tanınmayan değer `UNKNOWN`a düşer
 * (fail-closed) — "muhtemelen pozitiftir" YOKTUR.
 */
export function pduOutcomeFromAdvanced(nativeOutcome: string | null | undefined): PduOutcome {
  switch (nativeOutcome) {
    case 'ok':              return 'POSITIVE';
    case 'negative_nrc':    return 'NEGATIVE';
    case 'no_response':     return 'NO_RESPONSE';
    case 'timeout':         return 'TIMEOUT';
    case 'malformed':       return 'MALFORMED';
    case 'transport_error': return 'TRANSPORT_ERROR';
    case 'not_addressable': return 'NOT_ADDRESSABLE';
    default:                return 'UNKNOWN';
  }
}

/** PDU sözlüğünü native `readAdvancedDtcs` sözlüğüne geri çevirir. */
export function advancedOutcomeFromPdu(o: PduOutcome): string {
  switch (o) {
    case 'POSITIVE':        return 'ok';
    case 'NEGATIVE':        return 'negative_nrc';
    case 'NO_RESPONSE':     return 'no_response';
    case 'TIMEOUT':         return 'timeout';
    case 'MALFORMED':       return 'malformed';
    case 'NOT_ADDRESSABLE': return 'not_addressable';
    /* P0-VDK-F4A — GÜVENLİK REDDİ: native sözlükte bunun karşılığı YOKTUR.
       Bilinçli olarak `transport_error`a düşürülür (kapsam kaybı sayılır) —
       "desteklenmiyor" DENMEZ. Kaybolan tek şey gerekçenin İNCELİĞİDİR ve o
       `PduResponse.detail` içinde AYNEN durur; sessiz kayıp YOKTUR. */
    case 'DENIED_BY_SAFETY_GATE': return 'transport_error';
    /* Taşıyamama ve bilinmezlik hat hatasıdır: üst katman bunu kapsam kaybı
       sayar ve ASLA "desteklenmiyor" (araç hakkında iddia) DEMEZ. */
    default:                return 'transport_error';
  }
}

/**
 * P0-VDK-F4A — GENEL KÖPRÜ (`sendDiagnosticPdu`) sözlüğünü PDU sözlüğüne çevirir.
 *
 * ⚠️ ÜÇÜNCÜ SÖZLÜK KURULMADI: native tarafta genel köprü, `readAdvancedDtcs`
 * ile **BİREBİR AYNI** `outcome` kelimelerini üretir (parity karşılaştırması
 * ancak böyle anlamlıdır). Tek ek kelime `denied`dir ve onun PDU karşılığı
 * ayrı bir sonuçtur (`DENIED_BY_SAFETY_GATE`) — `NOT_SUPPORTED_BY_TRANSPORT`
 * ya da `NEGATIVE` ile BİRLEŞTİRİLMEZ.
 */
export function pduOutcomeFromGeneric(nativeOutcome: string | null | undefined): PduOutcome {
  if (nativeOutcome === 'denied') return 'DENIED_BY_SAFETY_GATE';
  return pduOutcomeFromAdvanced(nativeOutcome);
}

/**
 * Native `readDtcClass.outcome` sözlüğünü PDU sözlüğüne çevirir.
 * (`OK` · `NO_RESPONSE` · `UNSUPPORTED` · `BUS_ERROR` · `NO_SID` ·
 *  `PARSER_UNAVAILABLE` — sonuncusu F2-C1'de eklendi.)
 */
export function pduOutcomeFromDtcClass(nativeOutcome: string | null | undefined): PduOutcome {
  switch (nativeOutcome) {
    case 'OK':                 return 'POSITIVE';
    case 'NO_RESPONSE':        return 'NO_RESPONSE';
    /* `UNSUPPORTED` native'de AÇIK negatif yanıt (`7F`) ya da `?` demektir. */
    case 'UNSUPPORTED':        return 'NEGATIVE';
    case 'BUS_ERROR':          return 'TRANSPORT_ERROR';
    case 'NO_SID':             return 'MALFORMED';
    case 'PARSER_UNAVAILABLE': return 'POSITIVE';
    default:                   return 'UNKNOWN';
  }
}
