/**
 * functionalDtcSource — P0-VDK-F2C1 · FONKSİYONEL DTC ANLAM OTORİTESİ SEÇİMİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Geçiş boyunca aynı yanıt için İKİ çözüm elde olabilir: TS kanonik
 * çözümleyicisi (`functionalDtc`) ve native listesi (`ElmProtocol`). İkisinin
 * arasında **gizli bir "hangisi doluysa onu kullan" mantığı YASAKTIR** — o
 * mantık ikinci bir anlam otoritesi doğurur ve hangi kodun nereden geldiği
 * bir daha ölçülemez.
 *
 * Bu dosya seçimi TEK yerde, ADI KONMUŞ kurallarla yapar:
 *
 *   ham gövde VAR  →  TS kanonik sonuç = **ÜRÜN OTORİTESİ**
 *                      native listesi   = **PARİTE TANIĞI** (yalnız karşılaştırma)
 *   ham gövde YOK  →  native listesi    = **LEGACY YEDEK** (provenance açık)
 *   ikisi de YOK   →  **fail-closed** (sonuç YOK, "temiz" DEĞİL)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KIRPILMIŞ HAM GÖVDE OTORİTE OLAMAZ ────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Native köprü ham yanıtı `DTC_RAW_MAX` (240 hane) sınırında KIRPAR — bellek/
 * log şişmesin diye. Kırpılmış bir gövdeden çözülen liste EKSİK olabilir ve
 * eksik liste "daha az arıza var" demektir. Bu yüzden kırpma ölçüldüğünde TS
 * sonucu otorite OLMAZ; native listesi (tam gövdeden çözülmüştür) yedeğe
 * geçer ve durum kanıtta GÖRÜNÜR kalır.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import {
  parseFunctionalDtcResponse,
  type FunctionalDtcMode, type FunctionalDtcParseResult, type FunctionalDtcRecord,
} from './functionalDtc';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sonucun ANLAM KAYNAĞI — adı konmuş, gizli seçim YOK.
 */
export type FunctionalDtcProvenance =
  /** Ham gövde TS kanonik çözümleyicisinden geçti — ÜRÜN OTORİTESİ. */
  | 'CANONICAL_TS'
  /** Ham gövde yok/kırpık; native listesi kullanıldı — YEDEK. */
  | 'LEGACY_NATIVE'
  /** Ne ham gövde ne native listesi var — sonuç YOK (fail-closed). */
  | 'NONE';

export const FUNCTIONAL_PROVENANCE_LABEL: Readonly<Record<FunctionalDtcProvenance, string>> = {
  CANONICAL_TS:  'kanonik TS çözümleyicisi (ürün otoritesi)',
  LEGACY_NATIVE: 'native listesi (LEGACY yedek — kanonik parite KANITLANMADI)',
  NONE:          'kaynak YOK — fail-closed',
} as const;

/** Kanonik sonuç ile native tanığın karşılaştırması. */
export type FunctionalParityStatus =
  /** İkisi de var ve AYNI. */
  | 'MATCH'
  /** İkisi de var ve FARKLI — sessizce biri seçilmez. */
  | 'MISMATCH'
  /** Kanonik sonuç var ama tanık YOK (replay: native hiç çağrılmadı). */
  | 'WITNESS_ABSENT'
  /** Kanonik sonuç YOK — karşılaştırılacak bir şey yok. */
  | 'NOT_APPLICABLE';

export const FUNCTIONAL_PARITY_LABEL: Readonly<Record<FunctionalParityStatus, string>> = {
  MATCH:          'kanonik ve native AYNI',
  MISMATCH:       'KANONİK ≠ NATIVE — çelişki görünür kılındı',
  WITNESS_ABSENT: 'native tanık yok (replay) — parite karşılaştırılamadı',
  NOT_APPLICABLE: 'kanonik çözüm yok',
} as const;

/**
 * Ham gövdenin neden otorite OLAMADIĞI. `null` = engel yok.
 * Gelecekteki Diagnostic Gap Resolver bu ayrımı okuyacak.
 */
export type FunctionalSourceBlock =
  /** Köprü ham gövdeyi hiç taşımadı (eski APK). */
  | 'RAW_ABSENT'
  /** Ham gövde `DTC_RAW_MAX` sınırında kırpılmış — çözüm eksik olabilir. */
  | 'RAW_TRUNCATED'
  /**
   * Ham gövde geldi ama kanonik çözümleyici onu TANIYAMADI (pozitif SID yok ·
   * kısmi sayaç · hex değil). Çözümleyici bir HÜKÜM VERMEDİ; "0 kod" DEMEDİ.
   */
  | 'RAW_UNPARSEABLE';

export const FUNCTIONAL_SOURCE_BLOCK_LABEL: Readonly<Record<FunctionalSourceBlock, string>> = {
  RAW_ABSENT:      'köprü ham gövde taşımadı (eski APK)',
  RAW_TRUNCATED:   'ham gövde KIRPILMIŞ — kanonik çözüm eksik olabilir',
  RAW_UNPARSEABLE: 'kanonik çözümleyici gövdeyi TANIYAMADI — hüküm vermedi',
} as const;

export interface FunctionalDtcSourceInput {
  readonly mode: FunctionalDtcMode;
  /** Köprüden gelen HAM ELM327 metni; taşınmadıysa `null`. */
  readonly rawResponse: string | null;
  /**
   * Native'in ÇÖZDÜĞÜ liste (parite tanığı ya da legacy yedek).
   * Replay'de `null` — native hiç çağrılmaz.
   */
  readonly nativeCodes: readonly string[] | null;
}

export interface FunctionalDtcSourceResult {
  readonly mode: FunctionalDtcMode;
  readonly provenance: FunctionalDtcProvenance;
  /** ÜRÜNÜN kullanacağı kodlar — otorite hangisiyse ONUN listesi. */
  readonly codes: readonly string[];
  /** Kanonik kayıtlar (ham bayt · sıra · ECU atfı); legacy yedekte boş. */
  readonly records: readonly FunctionalDtcRecord[];
  /** Kanonik çözümün TAM sonucu; ham gövde yoksa `null`. */
  readonly parse: FunctionalDtcParseResult | null;
  readonly parity: FunctionalParityStatus;
  /** Yalnız `MISMATCH`te dolu: iki listenin farkı (en çok 8 künye). */
  readonly parityDetail: string | null;
  readonly block: FunctionalSourceBlock | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KIRPMA TESPİTİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Native köprünün ham yanıt üst sınırı (`ElmProtocol.DTC_RAW_MAX`).
 *
 * ⚠️ Bu sabit native tarafla ELDE TUTULAN bir sözleşmedir ve
 * `functionalDtcSource.test.ts` içinde Java kaynağından DOĞRULANIR — sabit
 * orada değişirse kilit düşer. Kopya bir sabiti sessizce eskitmek, bu ürünün
 * defalarca ödediği kusur sınıfıdır.
 */
export const NATIVE_DTC_RAW_MAX = 240;

/**
 * Ham gövdenin kırpılmış OLABİLECEĞİNİ ölçer — **muhafazakâr**.
 *
 * Tam sınıra oturan bir yanıt kırpılmamış da olabilir; ama "belki tamdır"
 * demek eksik listeyi otorite yapmak demektir. Fail-closed taraf: sınıra
 * değen her gövde kırpık SAYILIR.
 */
export function isRawTruncated(raw: string | null): boolean {
  return raw !== null && raw.length >= NATIVE_DTC_RAW_MAX;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) OTORİTE SEÇİMİ
   ══════════════════════════════════════════════════════════════════════════ */

function _diff(canonical: readonly string[], native: readonly string[]): string {
  const c = new Set(canonical);
  const n = new Set(native);
  const onlyC = canonical.filter((x) => !n.has(x));
  const onlyN = native.filter((x) => !c.has(x));
  const parts: string[] = [];
  if (onlyC.length > 0) parts.push(`yalnız kanonik: ${onlyC.slice(0, 8).join(',')}`);
  if (onlyN.length > 0) parts.push(`yalnız native: ${onlyN.slice(0, 8).join(',')}`);
  if (parts.length === 0) parts.push(`sıra farkı: ${canonical.join(',')} ≠ ${native.join(',')}`);
  return parts.join(' · ');
}

/**
 * Otoriteyi seçer ve çelişkiyi GÖRÜNÜR kılar.
 *
 * ── ÇELİŞKİDE NE OLUR ─────────────────────────────────────────────────────
 * Kanonik sonuç ile native tanık farklıysa **kanonik kazanır** (ölçülmüş ham
 * gövdeden çözülmüştür ve ürünün tek anlam otoritesidir) — ama fark
 * `PARSER_PARITY_MISMATCH` olarak kanıta yazılır ve LAB'da görünür. Sessizce
 * birini seçip diğerini atmak, bu fazın kapatmaya çalıştığı kusurun ta kendisi
 * olurdu.
 */
export function resolveFunctionalDtcSource(
  input: FunctionalDtcSourceInput,
): FunctionalDtcSourceResult {
  const { mode, rawResponse, nativeCodes } = input;
  const truncated = isRawTruncated(rawResponse);
  const hasRaw = rawResponse !== null && rawResponse.length > 0;

  /* ── (1) HAM GÖVDE YOK ya da KIRPIK → kanonik otorite OLAMAZ ──────────── */
  if (!hasRaw || truncated) {
    const block: FunctionalSourceBlock = !hasRaw ? 'RAW_ABSENT' : 'RAW_TRUNCATED';
    /* Kırpık gövde yine de ÇÖZÜLÜR: kanıt kaybolmaz, yalnız otorite olmaz. */
    const parse = hasRaw
      ? parseFunctionalDtcResponse({ mode, rawResponse, truncated: true })
      : null;
    if (nativeCodes !== null) {
      return {
        mode, provenance: 'LEGACY_NATIVE', codes: [...nativeCodes],
        records: [], parse, parity: 'NOT_APPLICABLE', parityDetail: null, block,
      };
    }
    /* Ne ham gövde ne native listesi → SONUÇ YOK. "0 kod" DEMEK DEĞİL. */
    return {
      mode, provenance: 'NONE', codes: [], records: [], parse,
      parity: 'NOT_APPLICABLE', parityDetail: null, block,
    };
  }

  /* ── (2) HAM GÖVDE VAR → KANONİK ÇÖZÜM ────────────────────────────────── */
  const parse = parseFunctionalDtcResponse({ mode, rawResponse });
  const codes = parse.records.map((r) => r.code);

  /* ── (2a) ÇÖZÜMLEYİCİ GÖVDEYİ TANIYAMADIYSA OTORİTE OLAMAZ ─────────────
     ÖLÇÜLEN RİSK: `MALFORMED`/`PARTIAL_TIMEOUT` demek "kod yok" DEĞİL,
     "anlayamadım" demektir. Böyle bir sonucu ürün otoritesi yapmak, native'in
     GERÇEKTEN çözdüğü kodları sessizce DÜŞÜRÜRDÜ — yani "daha az arıza var"
     yalanı. Bu, ürünün en pahalı kusur sınıfıdır.

     Bu bir "hangisi doluysa onu kullan" kuralı DEĞİLDİR: koşul kanonik
     çözümün BAŞARISIZLIĞIdır, native listesinin doluluğu değil. Native de
     yoksa sonuç yine YOK'tur (aşağıdaki `NONE` dalı). */
  const unparseable = parse.outcome === 'MALFORMED' || parse.outcome === 'PARTIAL_TIMEOUT';
  if (unparseable) {
    if (nativeCodes !== null && nativeCodes.length > 0) {
      return {
        mode, provenance: 'LEGACY_NATIVE', codes: [...nativeCodes],
        records: [], parse, parity: 'NOT_APPLICABLE', parityDetail: null,
        block: 'RAW_UNPARSEABLE',
      };
    }
    /* Native de kod vermiyor → kanonik sonuç (0 kod) taşınır ama ÇÖZÜLEMEDİ
       damgası kalır; üst katman `MALFORMED` sınıfını zaten kapsam kaybı sayar. */
    return {
      mode, provenance: 'CANONICAL_TS', codes, records: parse.records, parse,
      parity: nativeCodes === null ? 'WITNESS_ABSENT' : 'MATCH',
      parityDetail: null, block: 'RAW_UNPARSEABLE',
    };
  }

  if (nativeCodes === null) {
    /* Replay: native hiç çağrılmadı → tanık YOK. Bu bir kusur DEĞİLDİR. */
    return {
      mode, provenance: 'CANONICAL_TS', codes, records: parse.records, parse,
      parity: 'WITNESS_ABSENT', parityDetail: null, block: null,
    };
  }

  const same = codes.length === nativeCodes.length
    && codes.every((c, i) => c === nativeCodes[i]);
  return {
    mode, provenance: 'CANONICAL_TS', codes, records: parse.records, parse,
    parity: same ? 'MATCH' : 'MISMATCH',
    parityDetail: same ? null : _diff(codes, nativeCodes),
    block: null,
  };
}
