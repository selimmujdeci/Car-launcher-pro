/**
 * Guardian Engine — Faz A saf motor — GUARDIAN-AI-G1.
 *
 * `runGuardian(input) → output` — SAF fonksiyon (singleton/global state YOK).
 * Girdi MUTASYONA UĞRATILMAZ; çıktı her zaman YENİ dizilerden kurulur.
 *
 * İLK SÜRÜMDE ANALİZ YOK: bu motor kural ÇALIŞTIRMAZ (viraj/hız/hava hesabı
 * YOK) — yalnız DI ile verilen `GuardianRuleResult[]`in `riskEvents`lerini:
 *   1. TOPLAR (tüm kuralları düzleştirir)
 *   2. TEKİLLEŞTİRİR (aynı id → FAIL-CLOSED: en yüksek severity kazanır —
 *      "en kötüyü asla kaybetme" güvenlik ilkesi; throw YOK, çünkü throw tüm
 *      çıktıyı düşürür = daha güvensiz)
 *   3. SIRALAR (severity DESC → distanceMeters ASC → id ASC, deterministik)
 *   4. `highestSeverity`i çıkarır (sıralı listenin ilk elemanı; boşsa null)
 *   5. `overallRiskScore`u hesaplar (bkz. models.ts — olasılıksal-OR formülü)
 */
import type { GuardianInput, GuardianOutput, GuardianRiskEvent, GuardianSeverity } from './models';
import { SEVERITY_WEIGHT } from './models';

/** confidence savunmacı clamp — aralık dışı/NaN/Infinity girişe karşı güvenli taraf (0). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Aynı `id`ye sahip birden çok olay gelirse — DÜŞÜK severity'yi sessizce
 * tutup YÜKSEK riski kaybetmek YASAK ("en kötüyü asla kaybetme"). Eşit
 * severity'de İLK GÖRÜLEN korunur (deterministik tie-break). Girdi dizisi
 * MUTASYONA UĞRATILMAZ — yeni bir `Map`/dizi üretilir.
 */
function dedupeKeepHighestSeverity(events: readonly GuardianRiskEvent[]): GuardianRiskEvent[] {
  const bestById = new Map<string, GuardianRiskEvent>();
  for (const event of events) {
    const existing = bestById.get(event.id);
    if (!existing || SEVERITY_WEIGHT[event.severity] > SEVERITY_WEIGHT[existing.severity]) {
      bestById.set(event.id, event);
    }
    // Eşit severity → existing (İLK GÖRÜLEN) korunur; hiçbir şey yapılmaz.
  }
  return Array.from(bestById.values());
}

/** Deterministik sıralama: severity DESC → distanceMeters ASC → id ASC. */
function compareRiskEvents(a: GuardianRiskEvent, b: GuardianRiskEvent): number {
  const severityDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  if (severityDiff !== 0) return severityDiff;
  const distanceDiff = a.distanceMeters - b.distanceMeters;
  if (distanceDiff !== 0) return distanceDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Olasılıksal-OR risk skoru — formül ve özellikler models.ts'te belgelendi.
 * Bounded [0,1], boş giriş → 0, deterministik, monoton (asla azalmaz).
 * DEDUPE SONRASI kümeden hesaplanır (duplicate id skoru şişirmez).
 */
function computeOverallRiskScore(dedupedEvents: readonly GuardianRiskEvent[]): number {
  if (dedupedEvents.length === 0) return 0;

  let survivalProduct = 1; // Π (1 − contribution_i)
  for (const event of dedupedEvents) {
    const weight     = SEVERITY_WEIGHT[event.severity] / 4; // 0..1
    const confidence = clamp01(event.confidence);           // 0..1
    const contribution = weight * confidence;                // 0..1
    survivalProduct *= (1 - contribution);
  }
  return clamp01(1 - survivalProduct);
}

/**
 * TEK giriş noktası. Girdi (`input.ruleResults`, iç `riskEvents` dizileri/
 * nesneleri) MUTASYONA UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir
 * (deterministik) — global durum/zamana bağımlılık YOK.
 */
export function runGuardian(input: GuardianInput): GuardianOutput {
  const ruleResults = input?.ruleResults ?? [];

  const allEvents: GuardianRiskEvent[] = [];
  for (const ruleResult of ruleResults) {
    const events = ruleResult?.riskEvents ?? [];
    for (const event of events) {
      allEvents.push(event); // referans taşınır — orijinal nesne/dizi YAZILMAZ
    }
  }

  const deduped = dedupeKeepHighestSeverity(allEvents);
  const sorted  = [...deduped].sort(compareRiskEvents);

  const highestSeverity: GuardianSeverity | null = sorted.length > 0 ? sorted[0].severity : null;
  const overallRiskScore = computeOverallRiskScore(sorted);

  return {
    riskEvents: sorted,
    highestSeverity,
    overallRiskScore,
  };
}
