/**
 * _schema.mjs — Profil doğrulama (harici bağımlılık YOK — el yazımı, bounded).
 *
 * Profil = "bu koşu neyi taahhüt ediyor": hangi lane (host/device), hangi fazlar,
 * hangi verdict tavanı. Geçersiz profil SESSİZCE varsayılana düşmez — REDDEDİLİR.
 * (Sessiz fallback = kimsenin fark etmediği eksik kanıt.)
 */
import { VERDICT_LADDER } from '../core/result-types.mjs';

export const LANES = Object.freeze(['host', 'device', 'vehicle']);

/**
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateProfile(profile) {
  const errors = [];
  const p = profile;

  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { valid: false, errors: ['Profil bir nesne olmalı'] };
  }

  if (!p.id || typeof p.id !== 'string')     errors.push('id zorunlu (string)');
  if (!p.name || typeof p.name !== 'string') errors.push('name zorunlu (string)');

  if (!LANES.includes(p.lane)) errors.push(`lane geçersiz: ${p.lane} (izinli: ${LANES.join(', ')})`);

  if (!VERDICT_LADDER.includes(p.maxVerdict)) {
    errors.push(`maxVerdict geçersiz: ${p.maxVerdict} (izinli: ${VERDICT_LADDER.join(', ')})`);
  }

  if (!Array.isArray(p.phases) || p.phases.length === 0) {
    errors.push('phases boş olamaz (koşulacak faz listesi zorunlu)');
  } else if (p.phases.some((x) => typeof x !== 'string')) {
    errors.push('phases yalnız faz id (string) içerebilir');
  }

  if (p.manualFallbacks != null && (typeof p.manualFallbacks !== 'object' || Array.isArray(p.manualFallbacks))) {
    errors.push('manualFallbacks nesne olmalı ({ fazId: "manuel talimat" })');
  }

  if (p.phaseTimeoutMs != null && (!Number.isFinite(p.phaseTimeoutMs) || p.phaseTimeoutMs <= 0)) {
    errors.push('phaseTimeoutMs pozitif sayı olmalı');
  }

  // YAPISAL KİLİT: host lane profili device/vehicle verdict iddia EDEMEZ.
  if (p.lane === 'host' && VERDICT_LADDER.indexOf(p.maxVerdict) > VERDICT_LADDER.indexOf('HOST_VERIFIED')) {
    errors.push(`host lane profili maxVerdict=${p.maxVerdict} isteyemez — cihaz kanıtı yok (en fazla HOST_VERIFIED)`);
  }

  return { valid: errors.length === 0, errors };
}
