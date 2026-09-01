/**
 * capabilityResolver.ts — **MAVİ F5 · TİPLİ EYLEM DOĞRULAMASI.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Bir `CapabilityActionRequest`i katalogla karşılaştırır ve **yürütülebilir mi**
 * sorusunun ŞEMA kısmını yanıtlar. Yanıt SAF VERİDİR: bu dosya hiçbir şey
 * yürütmez, konuşmaz, kaydetmez.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** yalnız tip + katalog import eder; I/O · timer · `Date.now` ·
 *    global durum YOK.
 *  · **FAIL-CLOSED:** şema düşerse `INVALID_ARGUMENT` döner ve
 *    **hiçbir koşulda `ok:true` üretmez**. "Muhtemelen doğrudur" varsayımı YOK.
 *  · **LLM OTORİTE DEĞİLDİR:** `provenance` yalnız KAYIT alanıdır; hiçbir
 *    kaynak doğrulamayı ATLAYAMAZ (`user_direct` bile).
 *  · **BİLİNMEYEN PARAMETRE SESSİZCE GEÇMEZ:** şemada olmayan alan
 *    `INVALID_ARGUMENT`tır — LLM'in uydurduğu alan yürütücüye SIZAMAZ.
 */

import type {
  CapabilityActionRequest, CapabilityArguments, CapabilityOperationDef,
  CapabilityParamSchema, CapabilityResolution,
} from './capabilityContract';
import { CAROS_CAPABILITY_CATALOG } from './carosCapabilityCatalog';

/** Serbest metin parametreleri için mutlak tavan (bounded girdi). */
export const PARAM_MAX_LENGTH_CEILING = 512;

/** Katalogda `capabilityId` + `operation` eşleşmesi. */
export function findOperation(
  capabilityId: string,
  operation: string,
  catalog: readonly CapabilityOperationDef[] = CAROS_CAPABILITY_CATALOG,
): CapabilityOperationDef | null {
  if (typeof capabilityId !== 'string' || typeof operation !== 'string') return null;
  for (const d of catalog) {
    if (d.capabilityId === capabilityId && d.operation === operation) return d;
  }
  return null;
}

/* ── Tek parametre doğrulaması ─────────────────────────────────────────── */

type ParamCheck =
  | { ok: true; value: string | number | boolean }
  | { ok: false; reason: string };

function checkParam(name: string, schema: CapabilityParamSchema, raw: unknown): ParamCheck {
  switch (schema.type) {
    case 'string': {
      if (typeof raw !== 'string') return { ok: false, reason: `${name}:not_string` };
      const v = raw.trim();
      if (v.length === 0) return { ok: false, reason: `${name}:empty` };
      const max = Math.min(schema.maxLength ?? PARAM_MAX_LENGTH_CEILING, PARAM_MAX_LENGTH_CEILING);
      if (v.length > max) return { ok: false, reason: `${name}:too_long` };
      return { ok: true, value: v };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, reason: `${name}:not_number` };
      if (schema.min !== undefined && raw < schema.min) return { ok: false, reason: `${name}:below_min` };
      if (schema.max !== undefined && raw > schema.max) return { ok: false, reason: `${name}:above_max` };
      return { ok: true, value: raw };
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') return { ok: false, reason: `${name}:not_boolean` };
      return { ok: true, value: raw };
    }
    case 'enum': {
      if (typeof raw !== 'string') return { ok: false, reason: `${name}:not_string` };
      const v = raw.trim();
      const values = schema.values ?? [];
      /* ALLOWLIST — büyük/küçük harf farkı hoş görülür ama küme SABİTTİR.
       * Liste boşsa hiçbir değer geçemez (fail-closed): şemada `values`
       * unutulmuş bir enum, "her şeyi kabul et" anlamına GELMEZ. */
      for (const allowed of values) {
        if (allowed.toLowerCase() === v.toLowerCase()) return { ok: true, value: allowed };
      }
      return { ok: false, reason: `${name}:not_in_enum` };
    }
    default:
      return { ok: false, reason: `${name}:unknown_type` };
  }
}

/* ── Ana çözümleme ─────────────────────────────────────────────────────── */

/**
 * İsteği katalogla çözer ve parametreleri doğrular.
 *
 * **Bu fonksiyon AUTHORITY VERMEZ.** `ok:true`, "şema doğru" demektir —
 * availability · izin · güvenlik · onay kapıları ÇALIŞMA ZAMANINDA
 * (`capabilityFabric`) ve KANONİK zincirde (`maviActionAuthority`) uygulanır.
 */
export function resolveCapabilityAction(
  request: CapabilityActionRequest,
  catalog: readonly CapabilityOperationDef[] = CAROS_CAPABILITY_CATALOG,
): CapabilityResolution {
  try {
    if (!request || typeof request !== 'object') {
      return { ok: false, failure: 'INVALID_ARGUMENT', reason: 'request:malformed', route: 'LEGACY_FALLBACK' };
    }

    const def = findOperation(request.capabilityId, request.operation, catalog);
    if (!def) {
      /* Katalogda yok → capability yolu YOK. Bu bir HATA DEĞİL, bir YÖNLENDİRME
       * kararıdır: eski yol aynen çalışır ve `LEGACY_FALLBACK` sayılır. */
      return {
        ok: false, failure: 'CAPABILITY_NOT_FOUND',
        reason: 'catalog:no_match', route: 'LEGACY_FALLBACK',
      };
    }

    const c = request.confidence;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
      return { ok: false, failure: 'INVALID_ARGUMENT', reason: 'confidence:out_of_range', route: 'CAPABILITY' };
    }

    const params = request.parameters ?? {};
    const out: Record<string, string | number | boolean> = {};

    /* 1) Şemadaki her alan — zorunluluk ve tip. */
    for (const [name, schema] of Object.entries(def.parameters)) {
      const raw = (params as Record<string, unknown>)[name];
      if (raw === undefined || raw === null) {
        if (schema.required === true) {
          return { ok: false, failure: 'INVALID_ARGUMENT', reason: `${name}:missing`, route: 'CAPABILITY' };
        }
        continue;                                   // opsiyonel ve verilmemiş
      }
      const checked = checkParam(name, schema, raw);
      if (!checked.ok) {
        return { ok: false, failure: 'INVALID_ARGUMENT', reason: checked.reason, route: 'CAPABILITY' };
      }
      out[name] = checked.value;
    }

    /* 2) Şemada OLMAYAN alan → reddedilir. LLM'in uydurduğu bir alanın
     *    yürütücüye sızması, tipli sözleşmenin tamamını anlamsız kılardı. */
    for (const name of Object.keys(params)) {
      if (!(name in def.parameters)) {
        return { ok: false, failure: 'INVALID_ARGUMENT', reason: `${name}:unknown_param`, route: 'CAPABILITY' };
      }
    }

    return { ok: true, def, args: Object.freeze(out) as CapabilityArguments, route: 'CAPABILITY' };
  } catch {
    /* FAIL-CLOSED: çözümleyici içinde beklenmedik bir hata olursa capability
     * yolu KULLANILMAZ; eski yol aynen devam eder (davranış regresyonu yok). */
    return { ok: false, failure: 'INVALID_ARGUMENT', reason: 'resolver:exception', route: 'LEGACY_FALLBACK' };
  }
}

/* ── Katalog bütünlüğü ─────────────────────────────────────────────────── */

export interface CatalogIntegrityReport {
  readonly ok: boolean;
  /** Aynı `capabilityId`+`operation` çifti birden fazla kez tanımlanmış. */
  readonly duplicateOperations: readonly string[];
  /** Aynı `legacyIntent` birden fazla girişte kullanılmış. */
  readonly duplicateLegacyIntents: readonly string[];
  /** `values` verilmemiş enum parametresi (fail-closed → hiçbir değer geçemez). */
  readonly emptyEnums: readonly string[];
}

/**
 * Katalogu **çalışma zamanında** denetler. Duplicate capability kimliği
 * sessizce kabul edilirse iki farklı işlem aynı adla çözülür ve hangisinin
 * yürüdüğü tanım sırasına kalırdı — bu, sessiz bir yetki kaymasıdır.
 */
export function inspectCatalogIntegrity(
  catalog: readonly CapabilityOperationDef[] = CAROS_CAPABILITY_CATALOG,
): CatalogIntegrityReport {
  const seenOps = new Set<string>();
  const seenIntents = new Set<string>();
  const duplicateOperations: string[] = [];
  const duplicateLegacyIntents: string[] = [];
  const emptyEnums: string[] = [];

  for (const d of catalog) {
    const opKey = `${d.capabilityId}#${d.operation}`;
    if (seenOps.has(opKey)) duplicateOperations.push(opKey);
    else seenOps.add(opKey);

    if (d.legacyIntent !== null) {
      if (seenIntents.has(d.legacyIntent)) duplicateLegacyIntents.push(d.legacyIntent);
      else seenIntents.add(d.legacyIntent);
    }

    for (const [name, schema] of Object.entries(d.parameters)) {
      if (schema.type === 'enum' && (schema.values ?? []).length === 0) {
        emptyEnums.push(`${opKey}.${name}`);
      }
    }
  }

  return Object.freeze({
    ok: duplicateOperations.length === 0
      && duplicateLegacyIntents.length === 0
      && emptyEnums.length === 0,
    duplicateOperations: Object.freeze(duplicateOperations),
    duplicateLegacyIntents: Object.freeze(duplicateLegacyIntents),
    emptyEnums: Object.freeze(emptyEnums),
  });
}
