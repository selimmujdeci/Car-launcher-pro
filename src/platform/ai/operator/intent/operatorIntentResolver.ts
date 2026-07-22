/**
 * operatorIntentResolver — DETERMİNİSTİK niyet çözümleyici (AI YOK).
 *
 * Kullanıcının doğal Türkçe isteğini anahtar-kelime/kural + DTC allowlist ile
 * MEVCUT Operatör görevlerinden birine eşler. SAF: IO/zaman/rastgelelik yok →
 * aynı girdi her zaman aynı niyeti verir.
 *
 * ── GÜVENLİK ────────────────────────────────────────────────────────────────
 *  - Kullanıcı metni VERİdir: normalize + sanitize edilir, YALNIZ sınıflandırılır;
 *    içindeki hiçbir ifade talimat olarak yürütülmez (prompt injection nötr).
 *  - Fail-closed: eşleşme yoksa 'chat', zayıf/çelişkili eşleşmede 'clarify' →
 *    operatör ÇALIŞTIRILMAZ.
 *  - Yazma/tehlikeli fiil ('sil', 'temizle', 'sıfırla'...) → 'needs_approval'
 *    (öncelik en yüksek; görev seçilmez, işlem yapılmaz).
 *  - Belirli DTC kodu ('P0401') → knowledge_explanation (kod bazlı açıklama).
 */

import type { OperatorTaskId } from '../operatorTypes';
import type {
  OperatorIntent,
  OperatorIntentReason,
  OperatorIntentTelemetry,
} from './operatorIntentTypes';

/* ── Sınırlar ──────────────────────────────────────────────────────────────── */

const MAX_INPUT_CHARS = 400;
const MAX_CANDIDATES  = 3;
/** Bir görevin "güçlü" sayılması için gereken en düşük skor. */
const STRONG_MIN      = 2;

/** Kapsam sıralaması (dar → geniş) — çoklu eşleşmede en DAR seçilir. */
const SCOPE_RANK: Readonly<Record<OperatorTaskId, number>> = {
  knowledge_explanation: 0,
  dtc_report:            1,
  status_summary:        2,
  diagnosis_summary:     3,
  health_check:          4,
  unified_report:        5,
};

/** DTC kodu deseni (normalize/küçük harf metin üstünde). */
const DTC_TOKEN = /[pbcu][0-3][0-9a-f]{3}/;

/** Yazma/tehlikeli TOKEN'lar (tam kelime eşleşmesi — "silecek" gibi kelimeleri VURMAZ). */
const WRITE_TOKENS = new Set(['sil', 'temizle', 'sifirla', 'resetle', 'reset', 'clear', 'sildir', 'formatla']);
/** Yazma/tehlikeli KALIPLAR (alt-dizi eşleşmesi). */
const WRITE_PHRASES: readonly string[] = ['kod sil', 'kodu sil', 'kodlari sil', 'dtc sil', 'dtc temizle', 'fabrika ayar', 'hafizayi sil', 'hafiza sil'];

/** Görev anahtar-kelimeleri: [kalıp, ağırlık]. Kalıplar NORMALİZE (aksansız) yazılır. */
const TASK_KEYWORDS: Readonly<Record<OperatorTaskId, ReadonlyArray<readonly [string, number]>>> = {
  health_check: [
    ['tara', 3], ['tarama', 3], ['kontrol et', 3], ['kontrol ed', 3], ['saglik', 3],
    ['genel kontrol', 3], ['araci kontrol', 2], ['arabayi kontrol', 2], ['check up', 3], ['tam kontrol', 2],
  ],
  dtc_report: [
    ['ariza kod', 3], ['hata kod', 3], ['dtc', 3], ['ariza var', 2], ['hata var', 2],
    ['kod oku', 3], ['kodlari goster', 3], ['kodlari oku', 3], ['motor lambasi', 3],
    ['ariza lambasi', 3], ['check engine', 3], ['ariza kodu', 3], ['ariza kodlar', 3],
  ],
  status_summary: [
    ['ne durumda', 3], ['durumda', 2], ['durum', 1], ['nasil gidiyor', 3],
    ['guncel durum', 3], ['anlik durum', 3], ['durumu ne', 3], ['durum ozet', 3],
  ],
  diagnosis_summary: [
    ['teshis', 3], ['cekis', 2], ['titri', 2], ['guc dus', 2], ['performans dus', 2],
    ['neden dustu', 3], ['son teshis', 3], ['sorun ne', 2], ['cekis dus', 3], ['neden titri', 3],
  ],
  knowledge_explanation: [],   // kod-güdümlü (DTC kodu ile tetiklenir)
  unified_report: [
    ['her sey', 3], ['hersey', 3], ['komple', 3], ['tam rapor', 3], ['genel rapor', 2],
    ['full rapor', 3], ['detayli rapor', 2], ['tum bilgi', 2], ['her seyi', 3], ['komple rapor', 3],
  ],
};

/* ── Normalize / sanitize ──────────────────────────────────────────────────── */

/** Kullanıcı metnini eşleştirme için normalize eder (aksan katlama + sanitize). */
export function normalizeIntentText(raw: unknown): string {
  let s = typeof raw === 'string' ? raw.slice(0, MAX_INPUT_CHARS) : '';
  s = s.replace(new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g'), ' '); // kontrol karakteri
  s = s.replace(/İ/g, 'I').replace(/ı/g, 'i');                            // Türkçe İ/ı
  s = s.toLowerCase();
  s = s.replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ç/g, 'c')
       .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
  s = s.normalize('NFKD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), ''); // kalan birleşik işaret
  return s.replace(/\s+/g, ' ').trim();
}

function extractCode(normalized: string): string | undefined {
  const m = normalized.match(DTC_TOKEN);
  return m ? m[0].toUpperCase() : undefined;
}

function hasWriteIntent(normalized: string): boolean {
  for (const p of WRITE_PHRASES) if (normalized.includes(p)) return true;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) if (WRITE_TOKENS.has(t)) return true;
  return false;
}

function scoreTasks(normalized: string): Array<{ id: OperatorTaskId; score: number }> {
  const out: Array<{ id: OperatorTaskId; score: number }> = [];
  for (const id of Object.keys(TASK_KEYWORDS) as OperatorTaskId[]) {
    let score = 0;
    for (const [phrase, weight] of TASK_KEYWORDS[id]) {
      if (normalized.includes(phrase)) score += weight;
    }
    if (score > 0) out.push({ id, score });
  }
  // Skor azalan; eşitlikte KAPSAM DAR (rank küçük) önce → çoklu eşleşmede en dar.
  out.sort((a, b) => (b.score - a.score) || (SCOPE_RANK[a.id] - SCOPE_RANK[b.id]));
  return out;
}

function clampConfidence(score: number): number {
  return Math.max(0, Math.min(100, score * 25));
}

/* ── Ana çözümleyici ───────────────────────────────────────────────────────── */

const CHAT = (reason: OperatorIntentReason): OperatorIntent => ({ kind: 'chat', confidence: 0, reason });

/**
 * Kullanıcı metnini bir Operatör niyetine çözer. ASLA throw etmez.
 */
export function resolveOperatorIntent(userText: unknown): OperatorIntent {
  const normalized = normalizeIntentText(userText);

  // 1) Boş / çok kısa → sohbet (araç çalıştırma).
  if (normalized.length < 2) return CHAT('empty_or_too_short');

  // 2) Yazma/tehlikeli → onay gerekli (görev SEÇİLMEZ, işlem YAPILMAZ).
  if (hasWriteIntent(normalized)) {
    return { kind: 'needs_approval', confidence: 0, reason: 'write_or_dangerous' };
  }

  // 3) Belirli DTC kodu → kod bazlı açıklama (knowledge_explanation).
  const code = extractCode(normalized);
  if (code) {
    return { kind: 'operator_task', taskId: 'knowledge_explanation', code, confidence: 90, reason: 'dtc_code_detected' };
  }

  // 4) Anahtar-kelime skorlaması.
  const matched = scoreTasks(normalized);
  if (matched.length === 0) return CHAT('no_vehicle_intent');

  const best = matched[0];
  const second = matched[1];

  // Tek eşleşme → o görev (zayıf bile olsa tek ipucu, belirsiz değil).
  if (!second) {
    return { kind: 'operator_task', taskId: best.id, confidence: clampConfidence(best.score), reason: 'keyword_match' };
  }

  // Net kazanan (skor farkı ≥ 1).
  if (best.score - second.score >= 1) {
    return { kind: 'operator_task', taskId: best.id, confidence: clampConfidence(best.score), reason: 'keyword_match' };
  }

  // Tepe eşitliği:
  if (best.score >= STRONG_MIN) {
    // Güçlü çoklu eşleşme → EN DAR görev (best zaten dar; deterministik).
    return {
      kind: 'operator_task', taskId: best.id,
      confidence: Math.max(0, clampConfidence(best.score) - 10),
      reason: 'multiple_matches_narrowed',
    };
  }

  // Zayıf çoklu eşleşme → belirsiz, netleştir (operatör çalışmaz).
  return {
    kind: 'clarify',
    confidence: clampConfidence(best.score),
    reason: 'ambiguous_multiple',
    candidates: matched.slice(0, MAX_CANDIDATES).map((m) => m.id),
  };
}

/** Niyetin GÜVENLİ telemetrisi (kullanıcı metni/echo TAŞIMAZ). */
export function operatorIntentTelemetry(intent: OperatorIntent): OperatorIntentTelemetry {
  return {
    kind:           intent.kind,
    reason:         intent.reason,
    confidence:     intent.confidence,
    hasCode:        !!intent.code,
    candidateCount: intent.candidates?.length ?? 0,
  };
}
