/**
 * validationExport — doğrulama raporunun SAF üretimi + son gizlilik kapısı.
 *
 * ── NEDEN AYRI (VE SAF) BİR KAPI ────────────────────────────────────────────
 * Rapor cihazdan DIŞARI çıkar (dosya/pano). Bu yüzden export, kayıt katmanına
 * GÜVENMEZ: toplayıcı zaten maskeli değer yazsa bile burada ikinci kez
 * maskelenir (savunma katmanları üst üste biner). `remoteLogService`'in
 * maskeleme kuralları AYNEN izlenir; ancak o modül Supabase/health grafiğini
 * sürüklediği için burada bilinçli olarak BAĞIMSIZ ve SAF bir kopya tutulur —
 * bu dosya hiçbir servisi import ETMEZ, doğrudan test edilebilir.
 *
 * ── GARANTİLER ──────────────────────────────────────────────────────────────
 *  - Ham VIN · ham MAC · koordinat · api_key/token · kullanıcı metni ÇIKMAZ.
 *  - Deny-list anahtarları her derinlikte DÜŞER.
 *  - Derinlik/uzunluk tavanlıdır (şişme yok). ASLA throw etmez.
 */

import type { ValidationSnapshot, ValidationSummary } from './validationTypes';
import { maskVinStrict } from '../privacy/vinMask';

/** Rapor şema kimliği — tüketiciler sürüm ayrımı yapabilsin. */
export const VALIDATION_REPORT_SCHEMA = 'caros.validation.v1';

/** Derinlik tavanı — iç içe yapı şişmesine karşı. */
const MAX_DEPTH = 6;
/** String tavanı. */
const MAX_STRING = 240;

/**
 * Her derinlikte düşürülen anahtarlar (normalize: küçük harf, `_`/`-` yok).
 * Kişi/araç tanımlayıcıya götürebilecek her alan burada.
 */
const DENY_KEYS: ReadonlySet<string> = new Set([
  'vin', 'rawvin', 'address', 'addr', 'mac', 'macaddress', 'deviceaddress',
  'lat', 'lon', 'lng', 'latitude', 'longitude', 'coords', 'coordinates',
  'apikey', 'token', 'accesstoken', 'refreshtoken', 'password', 'secret',
  'prompt', 'usertext', 'usermessage', 'query', 'transcript', 'reply', 'answer',
  'email', 'phone', 'contact', 'name',
]);

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[_-]/g, '');
}

/* ── String maskeleri — sıra önemli: key=value önce (VIN maskesi değeri yutmasın) ── */

const MASKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=***'],
  // 17 karakterlik VIN — yalnız WMI (ilk 3) açık kalır.
  [/\b([A-HJ-NPR-Z0-9]{3})[A-HJ-NPR-Z0-9]{14}\b/g, '$1**************'],
  // MAC — ortadaki oktetler gizlenir.
  [/\b([0-9A-F]{2}):[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:([0-9A-F]{2})\b/gi, '$1:**:**:**:**:$2'],
  // Koordinat çifti.
  [/\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/g, '**.****,**.****'],
];

/**
 * Metni maskeler ve kırpar — SAF.
 *
 * `maxLen` varsayılanı alan-bazlı tavandır (rapor alanları kısa olmalı). İnsan-okur
 * ÖZET METNİ gibi uzun belgeler `Infinity` geçerek kırpmayı devre dışı bırakır —
 * maskeleme yine uygulanır (gizlilik kapısı hiçbir yolda atlanmaz).
 */
export function maskSensitiveText(input: string, maxLen: number = MAX_STRING): string {
  const raw = input ?? '';
  let s = Number.isFinite(maxLen) ? raw.slice(0, maxLen) : raw;
  for (const [re, rep] of MASKS) s = s.replace(re, rep);
  return s;
}

/**
 * VIN'i maskeler: yalnız WMI açık, benzersiz seri gizli — SAF.
 * Uygulama `platform/privacy/vinMask`'te tektir (o modül de hiçbir servisi
 * import etmez, bu dosyanın "saf ve bağımsız" güvencesi korunur).
 */
export function maskVin(vin: string | null | undefined): string | null {
  return maskVinStrict(vin);
}

/* ── Derin temizleyici ─────────────────────────────────────────────────────── */

/**
 * Deny-list + maske + derinlik tavanı — her değer için. ASLA throw etmez.
 * Fonksiyon/undefined/symbol düşer; bilinmeyen tip metne indirgenmez, düşer.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (depth > MAX_DEPTH) return '[derin]';

  const t = typeof value;
  if (t === 'string')  return maskSensitiveText(value as string);
  if (t === 'number')  return Number.isFinite(value as number) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'undefined' || t === 'bigint') return undefined;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const v = sanitizeValue(item, depth + 1);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  if (t === 'object') {
    const out: Record<string, unknown> = {};
    let keys: string[];
    try { keys = Object.keys(value as object); } catch { return {}; }
    for (const key of keys) {
      if (DENY_KEYS.has(normalizeKey(key))) continue;
      let v: unknown;
      try { v = sanitizeValue((value as Record<string, unknown>)[key], depth + 1); }
      catch { v = '[okunamadı]'; }
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  return undefined;
}

/* ── Rapor kurulumu ────────────────────────────────────────────────────────── */

/** Rapora iliştirilebilecek ortam bilgisi (opsiyonel, kişisel veri İÇERMEZ). */
export interface ValidationReportMeta {
  readonly appVersion?: string;
  readonly platform?:   string;
  readonly generatedAtWallMs?: number;
}

/**
 * Doğrulama raporunu kurar ve gizlilik kapısından geçirir — SAF.
 *
 * `obd.vinMasked` alanı kaynakta zaten maskelidir; burada BİR KEZ DAHA
 * `maskVin`'den geçirilir (idempotent) ve `vinPresent` bayrağı korunur.
 * Ham VIN alanı raporda YAPISAL OLARAK yoktur (deny-list `vin` anahtarını da
 * ayrıca düşürür).
 */
export function buildValidationReport(
  snap: ValidationSnapshot,
  summary: ValidationSummary,
  meta: ValidationReportMeta = {},
): Record<string, unknown> {
  const body = {
    schema:      VALIDATION_REPORT_SCHEMA,
    generatedAtWallMs: meta.generatedAtWallMs ?? 0,
    appVersion:  meta.appVersion ?? '',
    platform:    meta.platform ?? '',
    session: {
      sessionId:     snap.sessionId,
      startedWallMs: snap.startedWallMs,
      durationMs:    Math.round(snap.durationMs),
      active:        snap.active,
    },
    obd: {
      ...snap.obd,
      vinMasked: maskVin(snap.obd.vinMasked),
    },
    perf: { ...snap.perf },
    summary: {
      overall: summary.overall,
      passed:  summary.passed,
      warned:  summary.warned,
      failed:  summary.failed,
      skipped: summary.skipped,
      tests:   summary.tests.map((t) => ({ ...t })),
    },
    mavi: snap.mavi.map((r) => ({ ...r })),
    log:  snap.log.map((e) => ({ ...e })),
    /* Teknisyen BEYANI (ölçüm değil): raporun hangi koşulda toplandığını taşır.
       İşaretlenmemiş adım = o koşulun BİLİNMEDİĞİ anlamına gelir. */
    checklistDone: [...(snap.checklistDone ?? [])],   // fail-soft: eski snapshot şekli
  };

  return sanitizeValue(body) as Record<string, unknown>;
}

/** Raporu JSON metnine çevirir — ASLA throw etmez. */
export function serializeValidationReport(report: Record<string, unknown>): string {
  try {
    return JSON.stringify(report, null, 2);
  } catch {
    return '{"schema":"caros.validation.v1","error":"serialize_failed"}';
  }
}
