/**
 * cddl/validate — P0-VDK-F3B · CDDL BELGE DOĞRULAMA (FAIL-CLOSED).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İLKE ──────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `traceExport.importTracePackage` ile AYNI felsefe:
 *
 *   · **BİLİNMEYEN SÜRÜM = RET.** "İleri uyumluluk" adına tanımadığımız bir
 *     şemayı kabul etmek, alan anlamlarını TAHMİN etmektir.
 *   · **BİLİNMEYEN ALAN = RET.** Yok sayılan bir alan, yazanın sandığından
 *     farklı davranan bir tanım demektir.
 *   · **ÇÖZÜLEMEYEN REFERANS = RET.** `serviceRef`/`ecuRef` bir yere işaret
 *     etmiyorsa tanım eksiktir; çalışma anında "bulamadım" demek geç kalmıştır.
 *   · **DESTRUCTIVE = RET (ürün yolu için).** Tanımlanabilir ama ürün yoluna
 *     GİREMEZ; bu turda hiçbir yürütücü yoktur.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import {
  CDDL_DOCUMENT_FIELDS, CDDL_SCHEMA_VERSION, isProductTrusted,
  type CddlDocument, type CddlProvenance, type CddlSource,
  type DataObjectProp, type EcuVariant, type ProcedureDef,
  type ServiceDef, type VariantPattern,
} from './schema';

/* ══════════════════════════════════════════════════════════════════════════
   1) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type CddlRejection =
  | 'NOT_AN_OBJECT'
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'UNKNOWN_FIELD'
  | 'MISSING_COLLECTION'
  | 'DUPLICATE_ID'
  | 'UNRESOLVED_SERVICE_REF'
  | 'UNRESOLVED_ECU_REF'
  | 'UNRESOLVED_VARIANT_REF'
  | 'DESTRUCTIVE_NOT_ALLOWED'
  | 'EVIDENCE_REQUIRED'
  | 'ROLE_UNKNOWN_FORBIDDEN'
  | 'PROVENANCE_INVALID'
  | 'BLOCKED_LICENSE'
  | 'UNTRUSTED_SOURCE'
  | 'MALFORMED_HEX';

export const CDDL_REJECTION_LABEL: Readonly<Record<CddlRejection, string>> = {
  NOT_AN_OBJECT:           'belge nesne değil',
  UNKNOWN_SCHEMA_VERSION:  'BİLİNMEYEN şema sürümü — fail-closed reddedildi',
  UNKNOWN_FIELD:           'tanınmayan alan — anlamı TAHMİN EDİLMEZ',
  MISSING_COLLECTION:      'zorunlu koleksiyon eksik',
  DUPLICATE_ID:            'aynı kimlik iki kez tanımlanmış',
  UNRESOLVED_SERVICE_REF:  'servis referansı çözülemedi',
  UNRESOLVED_ECU_REF:      'ECU referansı çözülemedi',
  UNRESOLVED_VARIANT_REF:  'varyant referansı çözülemedi',
  DESTRUCTIVE_NOT_ALLOWED: 'YAZMA/AKTÜATÖR tanımı ürün yoluna GİREMEZ',
  EVIDENCE_REQUIRED:       'kanıtsız eşleşme deseni — adresten rol UYDURULAMAZ',
  ROLE_UNKNOWN_FORBIDDEN:  'rolü bilinmeyen ECU profile DEĞİL keşfe aittir',
  PROVENANCE_INVALID:      'kaynak künyesi eksik (referans/lisans)',
  BLOCKED_LICENSE:         'ticari satışı engelleyen lisans',
  UNTRUSTED_SOURCE:        'learned/BYOD kaynak ÜRÜN YOLUNA giremez (F4)',
  MALFORMED_HEX:           'hex alan biçimi hatalı',
} as const;

export interface CddlIssue {
  readonly rejection: CddlRejection;
  /** Sorunun bulunduğu yol (`services[2].service`). */
  readonly path: string;
  readonly detail: string;
}

export type CddlValidation =
  | { readonly valid: true; readonly document: CddlDocument }
  | { readonly valid: false; readonly issues: readonly CddlIssue[] };

/* ══════════════════════════════════════════════════════════════════════════
   2) YARDIMCILAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Ticari satışı engelleyen lisans imzaları — `oemEcuProfile` ile AYNI kural. */
const BLOCKED_LICENSE_RE = /\b(GPL|AGPL|LGPL|SSPL|EUPL|NON[- ]?COMMERCIAL|CC[- ]BY[- ]NC)\b/i;
const HEX_RE = /^[0-9A-F]*$/;

function checkProvenance(
  p: CddlProvenance | undefined, path: string, out: CddlIssue[],
  allowUntrusted: boolean,
): void {
  if (p === undefined || typeof p !== 'object') {
    out.push({ rejection: 'PROVENANCE_INVALID', path, detail: 'kaynak künyesi YOK' });
    return;
  }
  if (typeof p.reference !== 'string' || p.reference.trim().length === 0) {
    out.push({ rejection: 'PROVENANCE_INVALID', path: `${path}.reference`, detail: 'referans boş' });
  }
  if (typeof p.license !== 'string' || p.license.trim().length === 0) {
    out.push({ rejection: 'PROVENANCE_INVALID', path: `${path}.license`, detail: 'lisans boş' });
  } else if (BLOCKED_LICENSE_RE.test(p.license)) {
    out.push({
      rejection: 'BLOCKED_LICENSE', path: `${path}.license`,
      detail: `ticari satışı engelleyen lisans: ${p.license}`,
    });
  }
  if (!allowUntrusted && !isProductTrusted(p.source as CddlSource)) {
    out.push({
      rejection: 'UNTRUSTED_SOURCE', path: `${path}.source`,
      detail: `${String(p.source)} — ürün yoluna giremez (F4)`,
    });
  }
}

function checkDuplicates(
  ids: readonly string[], path: string, out: CddlIssue[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      out.push({ rejection: 'DUPLICATE_ID', path, detail: `tekrarlı kimlik: ${id}` });
    }
    seen.add(id);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DOĞRULAMA
   ══════════════════════════════════════════════════════════════════════════ */

export interface ValidateOptions {
  /**
   * `learned`/`byod` kaynaklı tanımlara İZİN VER (yalnız analiz/gözlem için).
   * Varsayılan `false` — ürün yolu fail-closed'dur.
   */
  readonly allowUntrustedSource?: boolean;
}

/**
 * CDDL belgesini doğrular — **her adımda fail-closed**.
 *
 * Sıra bilinçlidir: en ucuz ve en kesin eleme önce (şema sürümü → alan
 * kümesi → koleksiyonlar → içerik → referanslar).
 */
export function validateCddlDocument(
  input: unknown, opts: ValidateOptions = {},
): CddlValidation {
  const issues: CddlIssue[] = [];
  const allowUntrusted = opts.allowUntrustedSource === true;

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, issues: [{ rejection: 'NOT_AN_OBJECT', path: '', detail: 'belge nesne değil' }] };
  }
  const doc = input as Record<string, unknown>;

  /* (1) ŞEMA SÜRÜMÜ — bilinmeyen sürüm RET. */
  if (doc.schemaVersion !== CDDL_SCHEMA_VERSION) {
    return {
      valid: false,
      issues: [{
        rejection: 'UNKNOWN_SCHEMA_VERSION', path: 'schemaVersion',
        detail: `beklenen ${CDDL_SCHEMA_VERSION}, gelen ${String(doc.schemaVersion)}`,
      }],
    };
  }

  /* (2) BİLİNMEYEN ALAN — yok sayma YOK. */
  for (const key of Object.keys(doc)) {
    if (!CDDL_DOCUMENT_FIELDS.includes(key)) {
      issues.push({ rejection: 'UNKNOWN_FIELD', path: key, detail: `tanınmayan alan: ${key}` });
    }
  }

  /* (3) ZORUNLU KOLEKSİYONLAR. */
  const coll = ['services', 'variants', 'patterns', 'dataObjects',
    'comParams', 'procedures', 'dtcCatalog'] as const;
  for (const c of coll) {
    if (!Array.isArray(doc[c])) {
      issues.push({ rejection: 'MISSING_COLLECTION', path: c, detail: `${c} dizi değil` });
    }
  }
  if (issues.some((i) => i.rejection === 'MISSING_COLLECTION')) {
    return { valid: false, issues };
  }

  const services = doc.services as ServiceDef[];
  const variants = doc.variants as EcuVariant[];
  const patterns = doc.patterns as VariantPattern[];
  const dataObjects = doc.dataObjects as DataObjectProp[];
  const procedures = doc.procedures as ProcedureDef[];

  checkDuplicates(services.map((s) => s.id), 'services', issues);
  checkDuplicates(variants.map((v) => v.id), 'variants', issues);
  checkDuplicates(patterns.map((p) => p.id), 'patterns', issues);
  checkDuplicates(dataObjects.map((d) => d.id), 'dataObjects', issues);
  checkDuplicates(procedures.map((p) => p.id), 'procedures', issues);

  const serviceIds = new Set(services.map((s) => s.id));
  const variantIds = new Set(variants.map((v) => v.id));

  /* (4) SERVİSLER. */
  services.forEach((s, i) => {
    const path = `services[${i}]`;
    if (typeof s.service !== 'string' || !HEX_RE.test(s.service.toUpperCase()) || s.service.length !== 2) {
      issues.push({ rejection: 'MALFORMED_HEX', path: `${path}.service`, detail: `servis 2 hex hane olmalı: ${String(s.service)}` });
    }
    if (s.subFunction !== null && (typeof s.subFunction !== 'string'
      || !HEX_RE.test(s.subFunction.toUpperCase()) || s.subFunction.length !== 2)) {
      issues.push({ rejection: 'MALFORMED_HEX', path: `${path}.subFunction`, detail: 'alt fonksiyon 2 hex hane ya da null olmalı' });
    }
    /* DESTRUCTIVE tanımlanabilir ama ürün yoluna GİREMEZ. */
    if (s.effect === 'destructive') {
      issues.push({
        rejection: 'DESTRUCTIVE_NOT_ALLOWED', path: `${path}.effect`,
        detail: `${s.id} (${s.service}) — Safety Kernel'in işi, bu turda KAPALI`,
      });
    }
    checkProvenance(s.provenance, `${path}.provenance`, issues, allowUntrusted);
  });

  /* (5) VARYANTLAR. */
  variants.forEach((v, i) => {
    const path = `variants[${i}]`;
    if ((v.role as string) === 'unknown') {
      issues.push({
        rejection: 'ROLE_UNKNOWN_FORBIDDEN', path: `${path}.role`,
        detail: `${v.id}: rolü bilinmeyen adres profile DEĞİL keşfe aittir`,
      });
    }
    for (const ref of v.serviceRefs ?? []) {
      if (!serviceIds.has(ref)) {
        issues.push({
          rejection: 'UNRESOLVED_SERVICE_REF', path: `${path}.serviceRefs`,
          detail: `${v.id} → ${ref} bulunamadı`,
        });
      }
    }
    checkProvenance(v.provenance, `${path}.provenance`, issues, allowUntrusted);
  });

  /* (6) DESENLER — KANITSIZ EŞLEŞME YOK. */
  patterns.forEach((p, i) => {
    const path = `patterns[${i}]`;
    if (!Array.isArray(p.evidence) || p.evidence.length === 0) {
      issues.push({
        rejection: 'EVIDENCE_REQUIRED', path: `${path}.evidence`,
        detail: `${p.id}: kanıtsız desen — adresten rol UYDURULAMAZ`,
      });
    }
    for (const ref of p.variantRefs ?? []) {
      if (!variantIds.has(ref)) {
        issues.push({
          rejection: 'UNRESOLVED_VARIANT_REF', path: `${path}.variantRefs`,
          detail: `${p.id} → ${ref} bulunamadı`,
        });
      }
    }
    checkProvenance(p.provenance, `${path}.provenance`, issues, allowUntrusted);
  });

  /* (7) VERİ NESNELERİ. */
  dataObjects.forEach((d, i) => {
    const path = `dataObjects[${i}]`;
    if (!serviceIds.has(d.serviceRef)) {
      issues.push({ rejection: 'UNRESOLVED_SERVICE_REF', path: `${path}.serviceRef`, detail: `${d.id} → ${d.serviceRef}` });
    }
    if (!variantIds.has(d.ecuRef)) {
      issues.push({ rejection: 'UNRESOLVED_ECU_REF', path: `${path}.ecuRef`, detail: `${d.id} → ${d.ecuRef}` });
    }
    if (typeof d.identifier !== 'string' || !HEX_RE.test(d.identifier.toUpperCase())) {
      issues.push({ rejection: 'MALFORMED_HEX', path: `${path}.identifier`, detail: `${d.id}: hex değil` });
    }
    checkProvenance(d.provenance, `${path}.provenance`, issues, allowUntrusted);
  });

  /* (8) PROSEDÜRLER — bildirim doğrulanır, ÇALIŞTIRILMAZ. */
  procedures.forEach((p, i) => {
    const path = `procedures[${i}]`;
    if (p.effect === 'destructive') {
      issues.push({
        rejection: 'DESTRUCTIVE_NOT_ALLOWED', path: `${path}.effect`,
        detail: `${p.id}: yürütücü YOK ve destructive prosedür ürün yoluna GİREMEZ`,
      });
    }
    (p.steps ?? []).forEach((st, j) => {
      if (!serviceIds.has(st.serviceRef)) {
        issues.push({ rejection: 'UNRESOLVED_SERVICE_REF', path: `${path}.steps[${j}]`, detail: `${st.id} → ${st.serviceRef}` });
      }
      if (!variantIds.has(st.ecuRef)) {
        issues.push({ rejection: 'UNRESOLVED_ECU_REF', path: `${path}.steps[${j}]`, detail: `${st.id} → ${st.ecuRef}` });
      }
    });
    checkProvenance(p.provenance, `${path}.provenance`, issues, allowUntrusted);
  });

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, document: doc as unknown as CddlDocument };
}
