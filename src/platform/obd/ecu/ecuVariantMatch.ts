/**
 * ecuVariantMatch — P0-VDK-F6A · CDDL `VariantPattern` ÇALIŞMA-ZAMANI EŞLEŞTİRİCİSİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN AÇIK ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F3-B `VariantPattern`i **veri olarak** tanımladı ve `cddl/validate` onu
 * doğruladı — ama repoda o deseni ÖLÇÜLMÜŞ kanıta karşı DEĞERLENDİREN tek
 * satır yoktu (`variantRefs` yalnız referans bütünlüğü için okunuyordu).
 * Yani CDDL'in "yeni araç eklemek VERİ eklemektir" iddiası okuma tarafında
 * kanıtlanmamıştı.
 *
 * Bu dosya o değerlendirmeyi yapar ve **yeni bir eşleşme sözlüğü KURMAZ**:
 * kabul edilen kanıt türleri MEVCUT `VariantEvidenceKind`dır
 * (`vin_wmi · vin_vds · did_response · ecu_responded`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İKİ PAZARLIKSIZ KURAL ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **TÜM kanıtlar sağlanmalı.** Bir desenin kanıt listesi bir VE zinciridir;
 *     "biri tuttu, yeter" demek kanıtsız eşleşmedir. Ölçülemeyen kanıt
 *     `UNMEASURED`dır ve deseni GEÇİRMEZ (fail-closed) — "yanlış" ile
 *     "ölçemedik" ayrı tutulur ve ikisi de eşleşme ÜRETMEZ.
 * (2) **Birden çok desen tutarsa `AMBIGUOUS`.** İlki SEÇİLMEZ (görev §14).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type {
  EcuVariant, ProtocolClassName, VariantEvidence, VariantPattern,
} from '../cddl/schema';
import { foldAscii } from '../ecuRoleModel';
import type { EcuEndpoint } from './ecuEndpointModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖLÇÜLMÜŞ GERÇEKLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Desenin karşısına konacak ÖLÇÜLMÜŞ gerçekler.
 *
 * Her alan `null`/boş olabilir ve bu **bir ölçüm yokluğudur**; eksik alan
 * deseni geçirmez, ama "desen yanlış" hükmü de ÜRETMEZ.
 */
export interface VariantMatchFacts {
  /** ÖLÇÜLMÜŞ VIN; okunmadıysa `null`. Yalnız WMI/VDS ekseninde kullanılır. */
  readonly vin: string | null;
  readonly protocolClass: ProtocolClassName | 'unknown' | null;
  /** ÖLÇÜLMÜŞ DID yanıtları: DID kimliği → ham hex gövde. */
  readonly didResponses: Readonly<Record<string, string>>;
  /** Taramada GERÇEKTEN cevap veren istek adresleri. */
  readonly respondedTx: readonly string[];
}

export type VariantEvidenceOutcome = 'SATISFIED' | 'REFUTED' | 'UNMEASURED';

export interface VariantEvidenceCheck {
  readonly kind: VariantEvidence['kind'];
  readonly selector: string;
  readonly outcome: VariantEvidenceOutcome;
  readonly detail: string;
}

/**
 * Tek bir kanıt ekseni — SAF, üç değerli.
 *
 * ⚠️ `REFUTED` ile `UNMEASURED` **birleştirilemez**: birincisi araç hakkında
 * bir gerçektir ("VIN bu markaya ait DEĞİL"), ikincisi bizim ölçüm
 * kaybımızdır ("VIN okunamadı"). İkisini aynı saymak, okunamayan bir VIN'i
 * "marka uymadı" diye raporlamak olurdu.
 */
export function checkVariantEvidence(
  e: VariantEvidence, f: VariantMatchFacts,
): VariantEvidenceCheck {
  const base = { kind: e.kind, selector: e.selector } as const;

  switch (e.kind) {
    case 'vin_wmi': {
      if (f.vin === null || f.vin.trim().length < 3) {
        return { ...base, outcome: 'UNMEASURED', detail: 'VIN okunmadı' };
      }
      const wmi = foldAscii(f.vin).slice(0, 3);
      const want = e.selector.split(/[,\s]+/).map(foldAscii).filter((s) => s.length > 0);
      return want.includes(wmi)
        ? { ...base, outcome: 'SATISFIED', detail: `WMI ${wmi} listede` }
        : { ...base, outcome: 'REFUTED', detail: `WMI ${wmi} listede DEĞİL` };
    }

    case 'vin_vds': {
      if (f.vin === null || f.vin.trim().length < 9) {
        return { ...base, outcome: 'UNMEASURED', detail: 'VIN kısa/okunmadı' };
      }
      let re: RegExp | null = null;
      try { re = new RegExp(e.selector); } catch { re = null; }
      if (re === null) {
        /* Bozuk desenle "eşleşti" demek, doğrulayıcıyı atlatmış bir kaydı ürün
           yoluna sokmaktır — mevcut `matchOemProfile` ile AYNI karar. */
        return { ...base, outcome: 'REFUTED', detail: 'VDS deseni derlenemedi' };
      }
      const vds = foldAscii(f.vin).slice(3, 9);
      return re.test(vds)
        ? { ...base, outcome: 'SATISFIED', detail: `VDS ${vds} desene uyuyor` }
        : { ...base, outcome: 'REFUTED', detail: `VDS ${vds} desene UYMUYOR` };
    }

    case 'did_response': {
      const did = foldAscii(e.selector);
      const raw = f.didResponses[did];
      if (typeof raw !== 'string' || raw.length === 0) {
        return { ...base, outcome: 'UNMEASURED', detail: `${did} okunmadı` };
      }
      if (e.expect === null || e.expect.length === 0) {
        /* Beklenti yoksa soru "cevap verdi mi"dir ve cevap ÖLÇÜLDÜ. */
        return { ...base, outcome: 'SATISFIED', detail: `${did} yanıt verdi` };
      }
      let re: RegExp | null = null;
      try { re = new RegExp(e.expect); } catch { re = null; }
      if (re === null) {
        return { ...base, outcome: 'REFUTED', detail: `${did} beklenti deseni derlenemedi` };
      }
      return re.test(foldAscii(raw))
        ? { ...base, outcome: 'SATISFIED', detail: `${did} yanıtı desene uyuyor` }
        : { ...base, outcome: 'REFUTED', detail: `${did} yanıtı desene UYMUYOR` };
    }

    case 'ecu_responded': {
      const want = foldAscii(e.selector);
      if (f.respondedTx.length === 0) {
        return { ...base, outcome: 'UNMEASURED', detail: 'keşif çalışmadı' };
      }
      return f.respondedTx.some((t) => foldAscii(t) === want)
        ? { ...base, outcome: 'SATISFIED', detail: `${want} cevap verdi` }
        : { ...base, outcome: 'REFUTED', detail: `${want} cevap VERMEDİ` };
    }

    default:
      return { ...base, outcome: 'UNMEASURED', detail: 'tanınmayan kanıt türü' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) DESEN EŞLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

export type VariantMatchOutcome = 'NO_PATTERNS' | 'NO_MATCH' | 'SINGLE' | 'AMBIGUOUS';

export const VARIANT_MATCH_LABEL: Readonly<Record<VariantMatchOutcome, string>> = {
  NO_PATTERNS: 'TANIM YOK — değerlendirilecek desen yok',
  NO_MATCH:    'EŞLEŞME YOK — hiçbir desenin tüm kanıtları sağlanmadı',
  SINGLE:      'TEK DESEN eşleşti',
  AMBIGUOUS:   'BELİRSİZ — birden çok desen eşleşti, İLKİ SEÇİLMEDİ',
} as const;

export interface PatternMatch {
  readonly patternId: string;
  readonly manufacturer: string;
  readonly modelFamily: string;
  readonly checks: readonly VariantEvidenceCheck[];
  readonly variantRefs: readonly string[];
}

export interface VariantMatchResult {
  readonly outcome: VariantMatchOutcome;
  readonly matched: readonly PatternMatch[];
  readonly reason: string;
}

/**
 * Desenleri ÖLÇÜLMÜŞ gerçeklere karşı değerlendirir.
 *
 * Protokol kısıtı ÖNCE uygulanır: aktif protokol ölçülmüşse ve desen o sınıfı
 * saymıyorsa desen HİÇ değerlendirilmez (yanlış transporta desen uydurmak,
 * `matchOemProfile`ın da reddettiği şeydir).
 *
 * Kanıt listesi BOŞ olan desen ASLA eşleşmez — kanıtsız eşleşme YOK.
 */
export function matchVariantPatterns(
  patterns: readonly VariantPattern[], f: VariantMatchFacts,
): VariantMatchResult {
  if (patterns.length === 0) {
    return { outcome: 'NO_PATTERNS', matched: [], reason: VARIANT_MATCH_LABEL.NO_PATTERNS };
  }

  const pc = f.protocolClass ?? null;
  const hits: PatternMatch[] = [];

  for (const p of [...patterns].sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.evidence.length === 0) continue;                       // kanıtsız desen
    if (pc !== null && pc !== 'unknown' && p.protocols.length > 0
        && !p.protocols.includes(pc)) continue;                  // protokol kısıtı

    const checks = p.evidence.map((e) => checkVariantEvidence(e, f));
    /* VE ZİNCİRİ: bir eksen bile sağlanmıyorsa desen TUTMAZ. */
    if (!checks.every((c) => c.outcome === 'SATISFIED')) continue;

    hits.push({
      patternId: p.id, manufacturer: p.manufacturer, modelFamily: p.modelFamily,
      checks: Object.freeze(checks), variantRefs: Object.freeze([...p.variantRefs]),
    });
  }

  if (hits.length === 0) {
    return { outcome: 'NO_MATCH', matched: [], reason: VARIANT_MATCH_LABEL.NO_MATCH };
  }
  if (hits.length > 1) {
    return {
      outcome: 'AMBIGUOUS', matched: Object.freeze(hits),
      reason: `${hits.length} desen aynı anda eşleşti (${hits.map((h) => h.patternId)
        .join(' · ')}) — hiçbiri seçilmedi, rol YÜKSELTİLMEDİ.`,
    };
  }
  return {
    outcome: 'SINGLE', matched: Object.freeze(hits),
    reason: `${hits[0]!.patternId} deseni ${hits[0]!.checks.length} kanıtın `
      + 'tamamıyla eşleşti.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DESEN → UÇ NOKTA ROLÜ
   ══════════════════════════════════════════════════════════════════════════ */

export type VariantRoleOutcome =
  | 'NO_VARIANT' | 'SINGLE_VARIANT' | 'AMBIGUOUS_VARIANT';

export interface VariantRoleHit {
  readonly outcome: VariantRoleOutcome;
  /** Tek varyant eşleştiyse rolü; aksi hâlde `null` (uydurma YOK). */
  readonly variant: EcuVariant | null;
  readonly reason: string;
}

/**
 * Eşleşen desenin varyantları içinden BU uç noktaya karşılık geleni bulur.
 *
 * Eşleşme yalnız **adresle** kurulur ve bu bir rol iddiası DEĞİLDİR: desen
 * zaten ÖLÇÜLMÜŞ kanıtla (VIN/DID/yanıt) tutmuştur; adres burada sadece
 * "aynı araçtaki hangi satır" sorusunu cevaplar.
 *
 * Birden çok varyant aynı adresi gösteriyorsa `AMBIGUOUS_VARIANT` — ilki
 * SEÇİLMEZ.
 */
export function variantForEndpoint(
  match: PatternMatch, variants: readonly EcuVariant[], ep: EcuEndpoint,
): VariantRoleHit {
  const refs = new Set(match.variantRefs);
  const tx = foldAscii(ep.txHeader);
  const rx = foldAscii(ep.rxHeader);

  const hits = variants
    .filter((v) => refs.has(v.id))
    .filter((v) => v.addressing === ep.addressing)
    .filter((v) => foldAscii(v.txHeader) === tx || foldAscii(v.rxHeader) === rx)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (hits.length === 0) {
    return {
      outcome: 'NO_VARIANT', variant: null,
      reason: `${match.patternId} deseninde ${ep.txHeader}/${ep.rxHeader} adresine `
        + 'karşılık gelen varyant YOK — rol uydurulmadı.',
    };
  }
  if (hits.length > 1) {
    return {
      outcome: 'AMBIGUOUS_VARIANT', variant: null,
      reason: `${hits.length} varyant aynı adresi gösteriyor `
        + `(${hits.map((h) => h.id).join(' · ')}) — hiçbiri seçilmedi.`,
    };
  }
  return {
    outcome: 'SINGLE_VARIANT', variant: hits[0]!,
    reason: `${match.patternId} → ${hits[0]!.id} (${hits[0]!.role}).`,
  };
}
