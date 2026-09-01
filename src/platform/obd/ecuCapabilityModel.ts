/**
 * ecuCapabilityModel — P0-OBD-PARITY · ECU BAŞINA KANONİK YETENEK KÜNYESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Bu ECU'ya ne sorabiliriz ve ne cevap verdi?" sorusunun cevabı ürünün
 * **BEŞ ayrı defterine** dağılmıştı ve hiçbir yerde birleşmiyordu:
 *
 *   `ecuAddressability`   → adres kanıtlandı mı, hangi denemeler yapıldı
 *   `dtcAuthority` scans  → servis × ECU okuma sonucu
 *   `advancedDtcEvidence` → 0x19/0x18/0x13 ham yanıt + NRC
 *   `dtcPipelineAccounting` → RAW→PARSER→AUTHORITY→UI sayımı
 *   `kwpSessionProbe`     → oturum açılabildi mi
 *
 * Sonuç: sahada "bu ECU'da neden kod okuyamadık" sorusunu yanıtlamak beş
 * ekranı yan yana koymayı gerektiriyordu ve pratikte **kimse yapmıyordu**.
 * Daha kötüsü: bir sonraki adım (kanıtlı DTC SİLME) "bu ECU'ya hangi
 * oturum/servis/adresle ULAŞILDIĞI" bilgisine ihtiyaç duyar ve o bilgi
 * hiçbir yerde TEK parça hâlinde durmuyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR (sınırlar) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ OTORİTE DEĞİLDİR.** Hiçbir yeni ölçüm üretmez, hattan tek bayt
 *     istemez, hiçbir defteri YAZMAZ. Yalnız mevcut kanıtları okuyup TEK
 *     künyeye PROJEKTE eder. Girdiler dışarıdan verilir (saf fonksiyon).
 * (2) **HÜKÜM MOTORU DEĞİLDİR.** "Araç temiz/arızalı" DEMEZ; o karar
 *     `dtcAuthority.evaluateVehicleDtcVerdict` tekelindedir.
 * (3) **ADRES/ROL ÜRETMEZ.** Bilinmeyen alan `null` / `UNKNOWN` KALIR.
 *     Bu dosyanın hiçbir satırı bir adres, servis desteği ya da rol TAHMİN
 *     etmez — yalnız ÖLÇÜLENİ taşır.
 * (4) **YAZMA KAPISI DEĞİLDİR.** `clearReadiness` bir İZİN değil, bir
 *     KANIT ÖZETİDİR: "silme için gereken kanıt zinciri tam mı" sorusunu
 *     yanıtlar. Gerçek kapı `manufacturerClearGate` / `writeGate`tedir ve
 *     bu modül onu GEVŞETMEZ.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import type { EcuRole } from './ecuRoleModel';
import type { DtcSourceService, DtcScanOutcome } from './dtcAuthority';
/* P0-VDK-F4B — keşif ekseni taşıma sonucundan türetilir; ikinci sözlük YOK. */
import type { PduOutcome } from './pdu';

/* ══════════════════════════════════════════════════════════════════════════
   1) TEK SERVİSİN YETENEK KÜNYESİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir (ECU × servis) yeteneğinin ÖLÇÜLEN durumu.
 *
 * SEKİZİ DE AYRI KALIR. Ürünün geçmişte tekrar tekrar düştüğü tuzak, bunları
 * ikiye ("çalıştı / çalışmadı") indirmekti: o an "sorulmadı" ile "ECU sustu"
 * ile "servis yok" aynı kutuya düşer ve **kapsam yalanı** üretilirdi.
 */
export type EcuServiceCapability =
  /** Soruldu, POZİTİF yanıt geldi ve en az bir kayıt çözüldü. */
  | 'SUPPORTED_WITH_DATA'
  /** Soruldu, POZİTİF yanıt geldi, 0 kayıt. GERÇEK "bu serviste kod yok". */
  | 'SUPPORTED_EMPTY'
  /** Soruldu, ECU açıkça "bu servisi bilmiyorum" dedi (NRC 0x11/0x12/0x31). */
  | 'UNSUPPORTED'
  /** Soruldu, ECU SUSTU. "Kod yok" DEĞİL — ölçüm YOK. */
  | 'NO_RESPONSE'
  /** Soruldu, açık negatif yanıt (NRC) ama servis-yok ailesinden DEĞİL. */
  | 'NEGATIVE_RESPONSE'
  /** Oturum/koşul reddi — servis VAR ama bu oturumda kapalı. */
  | 'SESSION_FAILED'
  /** Yanıt geldi, çözülemedi (zarf/stride/bozuk bayt). */
  | 'PARSE_FAILED'
  /** Fiziksel adres kanıtlanmadığı için istek HİÇ GÖNDERİLMEDİ. */
  | 'NOT_ADDRESSABLE'
  /** Bu turda hiç sorulmadı (protokol kapısı · bütçe · admisyon). */
  | 'NOT_QUERIED';

export const ECU_SERVICE_CAPABILITY_LABEL: Readonly<Record<EcuServiceCapability, string>> = {
  SUPPORTED_WITH_DATA: 'DESTEKLİ — kayıt var',
  SUPPORTED_EMPTY:     'DESTEKLİ — kayıt yok',
  UNSUPPORTED:         'SERVİS YOK (ECU reddetti)',
  NO_RESPONSE:         'ECU SUSTU (ölçüm yok)',
  NEGATIVE_RESPONSE:   'NEGATİF YANIT (NRC)',
  SESSION_FAILED:      'OTURUM/KOŞUL REDDİ',
  PARSE_FAILED:        'ÇÖZÜLEMEDİ (bozuk gövde)',
  NOT_ADDRESSABLE:     'ADRESLENEMEDİ (istek gönderilmedi)',
  NOT_QUERIED:         'SORULMADI',
} as const;

/**
 * Yetenek bir KAPSAM KAYBI mı?
 *
 * `UNSUPPORTED` ve `SUPPORTED_EMPTY` kayıp DEĞİLDİR — ikisi de GERÇEK
 * ölçümdür ("ECU bu servisi bilmiyor" / "bu serviste kod yok"). Geri kalan
 * her şey "bilmiyoruz" demektir ve "temiz" hükmünü ENGELLER.
 */
export function isCapabilityCoverageLoss(c: EcuServiceCapability): boolean {
  return c !== 'SUPPORTED_WITH_DATA' && c !== 'SUPPORTED_EMPTY' && c !== 'UNSUPPORTED';
}

/** Yetenek GERÇEKTEN ölçüldü mü (yanıt geldi ve anlaşıldı). */
export function isCapabilityMeasured(c: EcuServiceCapability): boolean {
  return c === 'SUPPORTED_WITH_DATA' || c === 'SUPPORTED_EMPTY' || c === 'UNSUPPORTED';
}

/**
 * Kanonik tarama sonucu + kod adedinden yetenek türetir (SAF).
 *
 * `diagnosticOutcome` (advancedDtcEvidence sözlüğü) VARSA daha ince ayrım
 * yapar; yoksa kaba sonuçtan türetir. İkinci bir sözlük KURULMAZ — mevcut
 * `DtcScanOutcome` ve `AdvancedDtcOutcome` değerleri okunur.
 */
export function deriveServiceCapability(
  /**
   * `'deferred'` KANONİK `DtcScanOutcome` ÜYESİ DEĞİLDİR ama tarama katmanının
   * `EcuModeStatus`unda VARDIR (admisyon kapısı sorguyu hiç göndermedi).
   * Girdi tipi bunu açıkça kabul eder: değeri sessizce `failed`e düşürmek,
   * "hiç sorulmadı" ile "soruldu ve düştü" ayrımını yok ederdi.
   */
  outcome: DtcScanOutcome | 'deferred' | null,
  codeCount: number | null,
  diagnosticOutcome?: string | null,
): EcuServiceCapability {
  const d = (diagnosticOutcome ?? '').toLowerCase();
  if (d === 'malformed') return 'PARSE_FAILED';
  if (d === 'not_addressable') return 'NOT_ADDRESSABLE';
  if (d === 'security_required' || d === 'condition_required' || d === 'session_required') {
    return 'SESSION_FAILED';
  }

  switch (outcome) {
    case 'ok':
      /* "0 kod" YALNIZ pozitif yanıt geldiyse anlamlıdır — ve burada geldi. */
      return (codeCount ?? 0) > 0 ? 'SUPPORTED_WITH_DATA' : 'SUPPORTED_EMPTY';
    case 'unsupported':  return 'UNSUPPORTED';
    case 'no_data':      return 'NO_RESPONSE';
    case 'timeout':      return 'NO_RESPONSE';
    case 'failed':       return d === 'negative_nrc' ? 'NEGATIVE_RESPONSE' : 'PARSE_FAILED';
    case 'deferred':     return 'NOT_QUERIED';
    case 'not_scanned':  return 'NOT_QUERIED';
    default:             return 'NOT_QUERIED';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   1b) SERVİS VARLIĞI — P0-VDK-F4B (KEŞİF EKSENİ)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ NEDEN AYRI BİR EKSEN — VE NEDEN İKİNCİ OTORİTE DEĞİL.
 *
 * Yukarıdaki `EcuServiceCapability` şu soruyu yanıtlar:
 *   **"Bu DTC okuması VERİ getirdi mi?"**  (`SUPPORTED_WITH_DATA` / `SUPPORTED_EMPTY`)
 * Keşif ise BAŞKA bir soru sorar:
 *   **"Bu ECU'da bu SERVİS var mı?"**
 *
 * İkisi aynı tipe sıkıştırılamaz, çünkü NRC yorumları BİRBİRİNİN TERSİDİR:
 *
 *  · Veri ekseninde `0x31 requestOutOfRange` = "bu KİMLİK (DID/LID) yok" → kalıcı yokluk.
 *    (`capabilityOutcome.classifyNrc` bu yüzden 0x11/0x12/0x31'i `unsupported` sayar ve
 *     o karar KİMLİK sorgusu için DOĞRUDUR.)
 *  · Servis ekseninde AYNI NRC = "servis VAR, ama argümanım aralık dışı" → servis MEVCUT.
 *
 * Bu iki yorumu tek fonksiyonda birleştirmek, keşfin var olan bir servisi
 * "yok" diye kaydetmesine yol açardı — görevin açıkça yasakladığı hata.
 * Bu yüzden eksen AYRI ama **dosya AYNI**: yetenek otoritesi tek yerde kalır,
 * paralel bir `serviceCapabilityAuthority` KURULMAZ.
 */
export type ServicePresence =
  /** POZİTİF yanıt geldi — servis KANITLI mevcut. */
  | 'PRESENT'
  /** ECU `7F <svc> 11` (serviceNotSupported) dedi — servis KANITLI YOK. */
  | 'ABSENT'
  /**
   * ECU AKTİF olarak negatif yanıt verdi ama gerekçe "servis yok" DEĞİL
   * (0x12 · 0x22 · 0x31 · 0x33 · 0x7E · 0x7F · koşul ailesi …).
   * Yanıt vermesi servisin VARLIĞININ kanıtıdır; erişim koşula bağlıdır.
   */
  | 'PRESENT_BUT_CONDITIONED'
  /** ECU sustu / zaman aşımı / hat hatası — ARAÇ hakkında hiçbir şey öğrenilmedi. */
  | 'UNKNOWN'
  /** Köprü bu PDU'yu taşıyamadı — **araç sınırı DEĞİL**, bizim sınırımız. */
  | 'UNKNOWN_TRANSPORT_LIMIT'
  /** Hedef adreslenemedi — istek hiç gönderilmedi. */
  | 'UNKNOWN_ADDRESSING'
  /** Yanıt geldi ama tanınan hiçbir kalıba uymadı. */
  | 'UNKNOWN_RESPONSE_SHAPE'
  /** Güvenlik kapısı yokladı bile — servis keşif korpusuna GİREMEZ. */
  | 'PROBE_FORBIDDEN'
  /** Bütçe/oturum bitti; yoklama TAMAMLANMADI. **"YOK" DEĞİLDİR.** */
  | 'DEFERRED'
  /** Bu turda hiç yoklanmadı. */
  | 'NOT_PROBED';

export const SERVICE_PRESENCE_LABEL: Readonly<Record<ServicePresence, string>> = {
  PRESENT:                 'VAR (pozitif yanıt)',
  ABSENT:                  'YOK (ECU 7F-11 dedi)',
  PRESENT_BUT_CONDITIONED: 'VAR — koşula bağlı (NRC)',
  UNKNOWN:                 'BİLİNMİYOR (ECU sustu/hat)',
  UNKNOWN_TRANSPORT_LIMIT: 'BİLİNMİYOR — köprü taşıyamadı',
  UNKNOWN_ADDRESSING:      'BİLİNMİYOR — adreslenemedi',
  UNKNOWN_RESPONSE_SHAPE:  'BİLİNMİYOR — yanıt tanınmadı',
  PROBE_FORBIDDEN:         'YOKLANMAZ (güvenlik kapısı)',
  DEFERRED:                'YARIM KALDI (bütçe/oturum)',
  NOT_PROBED:              'YOKLANMADI',
} as const;

/** ISO 14229-1: servisin KENDİSİNİN yokluğunu bildiren TEK NRC. */
export const NRC_SERVICE_NOT_SUPPORTED = 0x11;

/**
 * Yoklama sonucundan SERVİS VARLIĞI türetir (SAF).
 *
 * PAZARLIKSIZ KURAL: **NRC 0x11 görmeden hiçbir servise "yok" DENMEZ.**
 * `nrc === null` iken `NEGATIVE` gelmişse bile servis VAR sayılır (koşullu):
 * ECU aktif olarak yanıt vermiştir; NRC baytını okuyamamak bizim ölçüm
 * kaybımızdır, aracın yokluk beyanı değildir.
 */
export function deriveServicePresence(
  outcome: PduOutcome, nrc: number | null,
): ServicePresence {
  switch (outcome) {
    case 'POSITIVE':
      return 'PRESENT';
    case 'NEGATIVE':
      return nrc === NRC_SERVICE_NOT_SUPPORTED ? 'ABSENT' : 'PRESENT_BUT_CONDITIONED';
    case 'NO_RESPONSE':
    case 'TIMEOUT':
    case 'TRANSPORT_ERROR':
      return 'UNKNOWN';
    case 'NOT_SUPPORTED_BY_TRANSPORT':
      return 'UNKNOWN_TRANSPORT_LIMIT';
    case 'NOT_ADDRESSABLE':
      return 'UNKNOWN_ADDRESSING';
    case 'DENIED_BY_SAFETY_GATE':
      return 'PROBE_FORBIDDEN';
    case 'MALFORMED':
      return 'UNKNOWN_RESPONSE_SHAPE';
    default:
      return 'UNKNOWN';
  }
}

/** Varlık GERÇEKTEN ölçüldü mü (ECU yanıt verdi ve anlaşıldı). */
export function isPresenceMeasured(p: ServicePresence): boolean {
  return p === 'PRESENT' || p === 'ABSENT' || p === 'PRESENT_BUT_CONDITIONED';
}

/** Servisin MEVCUT olduğu kanıtlandı mı (alt fonksiyon keşfinin ÖN KOŞULU). */
export function isServiceProbablyPresent(p: ServicePresence): boolean {
  return p === 'PRESENT' || p === 'PRESENT_BUT_CONDITIONED';
}

/**
 * Sonuç bir KAPSAM KAYBI mı? `ABSENT` kayıp DEĞİLDİR — ölçülmüş bir gerçektir.
 * `PROBE_FORBIDDEN` de kayıp değildir: bilinçli bir üründür kararıdır.
 */
export function isPresenceCoverageLoss(p: ServicePresence): boolean {
  return !isPresenceMeasured(p) && p !== 'PROBE_FORBIDDEN';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ECU KÜNYESİ
   ══════════════════════════════════════════════════════════════════════════ */

/** ECU'ya nasıl ulaşıldığının ÖLÇÜLEN durumu (adres kanıtı). */
export type EcuAddressingState = 'PROVEN' | 'UNKNOWN' | 'NOT_ADDRESSABLE';

/** Oturum kanıtı — `UNKNOWN` = ölçülmedi, `NOT_REQUIRED` = varsayılan yetti. */
export type EcuSessionState = 'OPENED' | 'REFUSED' | 'NOT_REQUIRED' | 'UNKNOWN';

export interface EcuServiceRow {
  readonly service: DtcSourceService;
  /** UDS'te alt fonksiyon ('02'/'0A'); diğerlerinde servisle aynı. */
  readonly subFunction: string;
  readonly capability: EcuServiceCapability;
  /** Bu servisten çözülen kayıt; ölçülmediyse `null` (sahte 0 YASAK). */
  readonly codeCount: number | null;
  /** Son ham yanıt (kırpılmış); yoksa `null`. */
  readonly raw: string | null;
  readonly nrc: number | null;
}

export interface EcuCapability {
  readonly rxHeader: string;
  /** Fiziksel istek adresi; türetilemediyse `null` — boş string YAZILMAZ. */
  readonly txHeader: string | null;
  readonly label: string;
  /** Rol yalnız KANITLA gelir; yoksa `null` (adresten rol UYDURULMAZ). */
  readonly role: EcuRole | null;
  readonly addressBits: number;
  readonly protocol: string | null;
  readonly addressing: EcuAddressingState;
  /** Adres kararının TR gerekçesi — LAB'da NEDEN görünür. */
  readonly addressingReason: string;
  readonly session: EcuSessionState;
  readonly sessionEpoch: number;
  /** Servis satırları — sabit sırada, eksik servis `NOT_QUERIED` olarak DURUR. */
  readonly services: readonly EcuServiceRow[];
  /** Bu ECU'da çözülen toplam kayıt; hiçbir servis ölçülmediyse `null`. */
  readonly totalCodes: number | null;
  /**
   * 0..1 — bu ECU hakkında ne kadarını GÖREBİLDİĞİMİZ.
   * Ölçülen servis / sorulan servis oranı. Hiç servis sorulmadıysa `null`.
   */
  readonly confidence: number | null;
  /** Kapsam kaybı yaratan servisler (TR etiketleriyle) — boşsa tam ölçüldü. */
  readonly coverageGaps: readonly string[];
  /** Son ölçüm damgası; hiç ölçülmediyse `null`. */
  readonly lastValidatedAtMs: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PROJEKSİYON — mevcut defterlerden künye üretir (SAF)
   ══════════════════════════════════════════════════════════════════════════ */

/** Künyede HER ZAMAN görünecek servis satırları (eksik olan `NOT_QUERIED` durur). */
const CANONICAL_ROWS: ReadonlyArray<{ service: DtcSourceService; subFunction: string }> = [
  { service: '03', subFunction: '03' },
  { service: '07', subFunction: '07' },
  { service: '0A', subFunction: '0A' },
  { service: '19', subFunction: '02' },
  { service: '19', subFunction: '0A' },
  { service: '18', subFunction: '18' },
  { service: '13', subFunction: '13' },
];

/** Projeksiyon girdisi — çağıran mevcut defterlerden doldurur. */
export interface EcuCapabilityInput {
  readonly rxHeader: string;
  readonly txHeader: string | null;
  readonly label: string;
  readonly role: EcuRole | null;
  readonly addressBits: number;
  readonly protocol: string | null;
  readonly addressing: EcuAddressingState;
  readonly addressingReason: string;
  readonly session: EcuSessionState;
  readonly sessionEpoch: number;
  readonly lastValidatedAtMs: number | null;
  /**
   * Ölçülen servis sonuçları. Anahtar `${service}|${subFunction}`.
   * Burada OLMAYAN kanonik satır `NOT_QUERIED` olarak durur — sessizce
   * gizlenmez, çünkü "sorulmadı" bir kapsam gerçeğidir.
   */
  readonly measured: ReadonlyMap<string, {
    outcome: DtcScanOutcome | null;
    codeCount: number | null;
    diagnosticOutcome?: string | null;
    raw?: string | null;
    nrc?: number | null;
  }>;
}

/**
 * ECU künyesini üretir (SAF).
 *
 * CONFIDENCE KURALI: güven, SORULAN servislerin kaçının ÖLÇÜLDÜĞÜ oranıdır.
 * Hiç servis sorulmadıysa `null` — "%0 güven" ile "güven bilinmiyor" AYRI
 * gerçeklerdir ve ürün bu ikisini geçmişte karıştırdı.
 *
 * `NOT_ADDRESSABLE` bir ECU'da güven `0`dır (soruldu sayılmaz ama adres
 * kanıtlanamadığı ÖLÇÜLDÜ) — `null` DEĞİL: burada bir şey biliyoruz.
 */
export function buildEcuCapability(input: EcuCapabilityInput): EcuCapability {
  const services: EcuServiceRow[] = CANONICAL_ROWS.map(({ service, subFunction }) => {
    const m = input.measured.get(`${service}|${subFunction}`);
    /* Adres kanıtlanmadıysa istek zaten GÖNDERİLEMEZ → "sorulmadı" değil,
       "adreslenemedi" doğru sınıftır (ikisi farklı kök nedendir). */
    const fallback: EcuServiceCapability =
      input.addressing === 'NOT_ADDRESSABLE' ? 'NOT_ADDRESSABLE' : 'NOT_QUERIED';
    return {
      service, subFunction,
      capability: m === undefined
        ? fallback
        : deriveServiceCapability(m.outcome, m.codeCount, m.diagnosticOutcome),
      codeCount: m?.codeCount ?? null,
      raw: m?.raw ?? null,
      nrc: m?.nrc ?? null,
    };
  });

  const asked = services.filter((r) => r.capability !== 'NOT_QUERIED');
  const measuredRows = asked.filter((r) => isCapabilityMeasured(r.capability));

  /* Toplam kayıt: YALNIZ gerçekten ölçülen satırlardan. Hiç ölçüm yoksa
     `null` — 0 yazmak "kod yok" demektir ve bu bir YALAN olurdu. */
  const totalCodes = measuredRows.length === 0
    ? null
    : measuredRows.reduce((a, r) => a + (r.codeCount ?? 0), 0);

  const gaps = services
    .filter((r) => isCapabilityCoverageLoss(r.capability))
    .map((r) => `${r.service}${r.subFunction === r.service ? '' : `-${r.subFunction}`}: `
      + ECU_SERVICE_CAPABILITY_LABEL[r.capability]);

  return {
    rxHeader: input.rxHeader,
    txHeader: input.txHeader,
    label: input.label,
    role: input.role,
    addressBits: input.addressBits,
    protocol: input.protocol,
    addressing: input.addressing,
    addressingReason: input.addressingReason,
    session: input.session,
    sessionEpoch: input.sessionEpoch,
    services,
    totalCodes,
    confidence: asked.length === 0 ? null : measuredRows.length / asked.length,
    coverageGaps: gaps,
    lastValidatedAtMs: input.lastValidatedAtMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SİLME HAZIRLIĞI — KANIT ÖZETİ (İZİN DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir sonraki fazın (kanıtlı DTC silme) ihtiyaç duyduğu kanıt zincirinin
 * TAM olup olmadığını söyler.
 *
 * ⚠️ BU BİR İZİN DEĞİLDİR. `READY` dönmesi "silme komutu gönderilebilir"
 * DEMEK DEĞİLDİR — yalnız "silme için gereken kanıt zinciri eksiksiz"
 * demektir. Gerçek yazma kapısı `manufacturerClearGate` / `writeGate`tedir,
 * kullanıcı onayı ayrıdır ve bu modül onları GEVŞETMEZ.
 *
 * SÖZLEŞME: bir ECU'daki DTC hangi (adres × oturum × servis) ile OKUNDUYSA,
 * silme de AYNI zincire bağlanabilmelidir. Zincirin bir halkası ölçülmemişse
 * hazırlık `BLOCKED`tır — tahmine dayalı destructive komut YASAK.
 */
export type EcuClearReadiness =
  /** Adres kanıtlı + en az bir DTC servisi ölçüldü → zincir tam. */
  | 'READY'
  /** Zincir eksik: adres kanıtlanmadı ya da hiçbir DTC servisi ölçülmedi. */
  | 'BLOCKED'
  /** Bu ECU'da okunmuş DTC yok — silinecek bir şey de yok. */
  | 'NOTHING_TO_CLEAR';

export const ECU_CLEAR_READINESS_LABEL: Readonly<Record<EcuClearReadiness, string>> = {
  READY:            'KANIT ZİNCİRİ TAM (izin DEĞİL)',
  BLOCKED:          'KANIT EKSİK — destructive komut YASAK',
  NOTHING_TO_CLEAR: 'SİLİNECEK KAYIT YOK',
} as const;

/**
 * Kanıt zincirini değerlendirir (SAF, FAIL-CLOSED).
 *
 * Sıra önemli: önce ZİNCİR sorulur, sonra kayıt varlığı. Adres kanıtlanmamış
 * bir ECU'da "silinecek kayıt yok" demek, yanlış bir güven verirdi —
 * orada aslında HİÇBİR ŞEY bilmiyoruz.
 */
export function evaluateEcuClearReadiness(cap: EcuCapability): EcuClearReadiness {
  if (cap.addressing !== 'PROVEN') return 'BLOCKED';
  if (cap.session === 'REFUSED') return 'BLOCKED';
  const measured = cap.services.filter((r) => isCapabilityMeasured(r.capability));
  if (measured.length === 0) return 'BLOCKED';
  if ((cap.totalCodes ?? 0) === 0) return 'NOTHING_TO_CLEAR';
  return 'READY';
}

/**
 * Araç geneli künye özeti — LAB tek satırı ve kapsam dürüstlüğü için.
 *
 * `fullCoverageProven` YALNIZ (a) en az bir ECU künyesi VAR, (b) hiçbir
 * künyede kapsam boşluğu YOK ve (c) hiçbir künyenin güveni `null` DEĞİL
 * ise `true` olur. Üçü birden şart — "tam araç taraması" iddiası bu ürünün
 * en kolay söyleyip en zor kanıtladığı cümledir.
 */
export interface EcuCapabilitySummary {
  readonly ecuCount: number;
  readonly provenCount: number;
  readonly notAddressableCount: number;
  readonly totalCodes: number | null;
  readonly fullCoverageProven: boolean;
  readonly gapCount: number;
}

export function summarizeEcuCapabilities(
  caps: readonly EcuCapability[],
): EcuCapabilitySummary {
  const gapCount = caps.reduce((a, c) => a + c.coverageGaps.length, 0);
  const anyUnknownConfidence = caps.some((c) => c.confidence === null);
  const totals = caps.map((c) => c.totalCodes);
  return {
    ecuCount: caps.length,
    provenCount: caps.filter((c) => c.addressing === 'PROVEN').length,
    notAddressableCount: caps.filter((c) => c.addressing === 'NOT_ADDRESSABLE').length,
    /* Bir ECU'nun toplamı ölçülemediyse ARAÇ toplamı da bilinmez. */
    totalCodes: totals.some((t) => t === null)
      ? null
      : totals.reduce<number>((a, t) => a + (t ?? 0), 0),
    fullCoverageProven: caps.length > 0 && gapCount === 0 && !anyUnknownConfidence,
    gapCount,
  };
}
