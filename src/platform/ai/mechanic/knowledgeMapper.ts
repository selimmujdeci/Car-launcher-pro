/**
 * knowledgeMapper — teşhisten arıza kodu çıkarımı + kod bazlı bilgi kartı üretimi.
 *
 * ── KURALLAR ────────────────────────────────────────────────────────────────
 *  - SAF: IO yok, zaman yok, rastgelelik yok → aynı girdi → aynı çıktı. Kaynaklar
 *    (DTC kaydı + gözlem sayıları) DIŞARIDAN enjekte edilir (resolver).
 *  - VERİ UYDURMAZ: alanlar yalnız kaynaktan gelir; kaynak yoksa alan BOŞ kalır.
 *  - BOUNDED: kod/sebep/belirti/öneri sayıları ve metin uzunlukları sınırlıdır.
 *  - Serbest metinler sanitize edilir (satır sonu/kontrol karakteri temizlenir)
 *    → katalog metni prompt'a TALİMAT enjekte EDEMEZ.
 */

import type { MechanicDiagnosis } from './mechanicTypes';
import { stripControlChars } from '../controlChars';
import type {
  KnowledgeDifficulty,
  KnowledgeDriveRisk,
  VehicleKnowledgeCard,
  VehicleKnowledgeReport,
} from './knowledgeTypes';

/* ── Sınırlar ──────────────────────────────────────────────────────────────── */

/** En fazla bu kadar arıza kodu zenginleştirilir (araç-içi gecikme bütçesi). */
export const MAX_KNOWLEDGE_CODES = 3;
export const MAX_CAUSES   = 4;
export const MAX_SYMPTOMS = 4;
export const MAX_TIPS     = 4;
const MAX_TEXT_CHARS      = 140;

/**
 * OBD-II arıza kodu deseni: [PBCU] + 2. hane [0-3] + 3 hex hane.
 * `dtc.` önekli evidence anahtarlarını (ör. `dtc.P0401`) da yakalar.
 */
const DTC_TOKEN = /([PBCU][0-3][0-9A-F]{3})/gi;

/* ── Gevşek kaynak şekilleri (concrete katmandan decouple) ─────────────────── */

/** Bundled DTC kaydının gevşek şekli (`dtcDataSource.DtcRecord`). */
export interface KnowledgeRecordLike {
  readonly description?:       unknown;
  readonly trDescription?:     unknown;
  readonly severity?:          unknown;   // 'critical' | 'warning' | 'info'
  readonly driveSafe?:         unknown;   // 'safe' | 'caution' | 'unsafe' | 'unknown'
  readonly possibleCauses?:    unknown;
  readonly repairSuggestions?: unknown;
  readonly symptoms?:          unknown;   // ileride katalog taşırsa
  readonly estimatedCost?:     unknown;   // { tier?: 'low' | 'medium' | 'high' }
}

/** Bir kod için birleşik bilgi kaynağı (katalog + gözlem sayıları). */
export interface KnowledgeSource {
  readonly record?:                KnowledgeRecordLike | null;
  /** Bu araçta ilgili sinyallerin görülme sayısı (kronik proxy). */
  readonly vehicleSeenCount?:      number;
  /** Aynı üretici profilinde görülme sayısı (kronik proxy). */
  readonly manufacturerSeenCount?: number;
}

/** Kod → kaynak çözümleyici (concrete tarafından enjekte edilir). */
export type KnowledgeResolver = (code: string) => KnowledgeSource;

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function sanitize(text: unknown): string {
  if (typeof text !== 'string') return '';
  return stripControlChars(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function pickList(list: unknown, max: number): readonly string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (out.length >= max) break;
    const text = sanitize(item);
    if (text) out.push(text);
  }
  return out;
}

function toCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** DTC kaydı ya da severity'den deterministik sürüş riski (kayıt yoksa unknown). */
function normalizeDriveRisk(driveSafe: unknown, severity: unknown): KnowledgeDriveRisk {
  if (driveSafe === 'safe' || driveSafe === 'caution' || driveSafe === 'unsafe') return driveSafe;
  // driveSafe yoksa severity'den türet — diagnosticKnowledgeEngine ile aynı kural.
  if (severity === 'critical') return 'unsafe';
  if (severity === 'warning')  return 'caution';
  if (severity === 'info')     return 'safe';
  return 'unknown';
}

/** Sürüş riskinden deterministik servis önerisi (belirsizse ''). */
function adviseService(risk: KnowledgeDriveRisk): string {
  switch (risk) {
    case 'unsafe':  return 'En kısa sürede yetkili servise götür; güvenli değilse sürüşe devam etme.';
    case 'caution': return 'Yakın zamanda bir servise kontrol ettir.';
    case 'safe':    return 'Acil değil; rutin bakımda kontrol ettir.';
    default:        return '';
  }
}

/** estimatedCost.tier'den zorluk seviyesi (yoksa 'bilinmiyor'). */
function normalizeDifficulty(estimatedCost: unknown): KnowledgeDifficulty {
  if (typeof estimatedCost !== 'object' || estimatedCost === null) return 'bilinmiyor';
  const tier = (estimatedCost as Record<string, unknown>)['tier'];
  if (tier === 'low')    return 'kolay';
  if (tier === 'medium') return 'orta';
  if (tier === 'high')   return 'zor';
  return 'bilinmiyor';
}

/** Gözlem sayılarından DÜRÜST kronik/geçmiş notu (gerçek veri yoksa ''). */
function buildChronicNote(source: KnowledgeSource | null | undefined): string {
  const v = toCount(source?.vehicleSeenCount);
  const m = toCount(source?.manufacturerSeenCount);
  if (v > 0) return `İlgili sistem sinyalleri bu araçta daha önce gözlemlendi (${v} kez) — tekrarlayan olabilir.`;
  if (m > 0) return 'Bu arıza örüntüsü aynı üretici profilinde daha önce gözlemlendi.';
  return '';
}

/* ── Kod çıkarımı ──────────────────────────────────────────────────────────── */

/**
 * Teşhisten arıza kodlarını çıkarır (SAF, deterministik).
 * Öncelik: topCause (kod + kanıt) → otherCauses → rapor kanıtı. Deduplike, büyük harf.
 * OBD_DTC_PRESENT nedeninde ham DTC kodları `evidence` anahtarlarında (`dtc.P0401`)
 * taşınır; burada oradan yakalanır. Kod bulunamazsa boş dizi → blok üretilmez.
 */
export function extractDtcCodes(
  diagnosis: MechanicDiagnosis | undefined | null,
  max = MAX_KNOWLEDGE_CODES,
): string[] {
  if (!diagnosis || typeof diagnosis !== 'object') return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (s: unknown): void => {
    if (typeof s !== 'string') return;
    const matches = s.match(DTC_TOKEN);
    if (!matches) return;
    for (const raw of matches) {
      const code = raw.toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      if (out.length < max) out.push(code);
    }
  };

  if (diagnosis.topCause) {
    consider(diagnosis.topCause.code);
    for (const e of diagnosis.topCause.evidence ?? []) consider(e);
  }
  for (const c of diagnosis.otherCauses ?? []) {
    consider(c.code);
    for (const e of c.evidence ?? []) consider(e);
  }
  for (const e of diagnosis.evidence ?? []) consider(e);

  return out;
}

/* ── Kart + rapor üretimi ──────────────────────────────────────────────────── */

/** Tek bir kod + kaynaktan bilgi kartı üretir (SAF; kaynak yoksa found:false). */
export function buildKnowledgeCard(
  code: string,
  source: KnowledgeSource | null | undefined,
): VehicleKnowledgeCard {
  const rec = source?.record ?? null;
  const found = !!rec && typeof rec === 'object';
  const driveRisk = found ? normalizeDriveRisk(rec.driveSafe, rec.severity) : 'unknown';
  return {
    code:             code.toUpperCase(),
    faultDescription: found ? (sanitize(rec.trDescription) || sanitize(rec.description)) : '',
    possibleCauses:   found ? pickList(rec.possibleCauses, MAX_CAUSES) : [],
    symptoms:         found ? pickList(rec.symptoms, MAX_SYMPTOMS) : [],
    chronicNote:      buildChronicNote(source),
    driveRisk,
    serviceAdvice:    adviseService(driveRisk),
    difficulty:       found ? normalizeDifficulty(rec.estimatedCost) : 'bilinmiyor',
    maintenanceTips:  found ? pickList(rec.repairSuggestions, MAX_TIPS) : [],
    found,
  };
}

/**
 * Teşhisten çıkarılan kodları çözümleyip bilgi raporu üretir (SAF).
 * Resolver başına hata güvenli boşa düşer (fail-soft) — kod yine kart olur.
 */
export function buildVehicleKnowledgeReport(
  diagnosis: MechanicDiagnosis | undefined | null,
  resolve: KnowledgeResolver,
): VehicleKnowledgeReport {
  const codes = extractDtcCodes(diagnosis);
  const cards: VehicleKnowledgeCard[] = [];
  for (const code of codes) {
    let source: KnowledgeSource = {};
    try { source = resolve(code) ?? {}; } catch { source = {}; }
    cards.push(buildKnowledgeCard(code, source));
  }
  return { cards, requestedCodes: codes, available: codes.length > 0 };
}
