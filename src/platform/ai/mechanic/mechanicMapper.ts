/**
 * mechanicMapper — mevcut AI Usta raporunu Mavi sunum modeline çeviren SAF eşleme.
 *
 * ── KURALLAR ────────────────────────────────────────────────────────────────
 *  - VERİ UYDURMAZ: alanlar yalnız rapordan gelir; eksikse alan YOK ya da
 *    "yetersiz veri" olarak İŞARETLENİR.
 *  - Güven yüzdesi ve aciliyet DETERMİNİSTİK katmandan aynen taşınır
 *    (yeniden hesaplanmaz, yuvarlanır ve 0..100'e sıkıştırılır).
 *  - BOUNDED: neden/kanıt/adım sayıları ve metin uzunlukları sınırlıdır.
 *  - Serbest metinler sanitize edilir (satır sonu/kontrol karakteri temizlenir)
 *    → araç/rapor metni prompt'a TALİMAT enjekte EDEMEZ.
 *  - SAF: IO yok, zaman yok, rastgelelik yok → aynı rapor → aynı çıktı.
 */

import type {
  MechanicCause,
  MechanicDataAvailability,
  MechanicDiagnosis,
  MechanicRiskLevel,
} from './mechanicTypes';

/* ── Sınırlar ──────────────────────────────────────────────────────────────── */

export const MAX_CAUSES      = 3;
export const MAX_EVIDENCE    = 4;
export const MAX_NEXT_STEPS  = 3;
const MAX_TEXT_CHARS         = 140;

/** Aciliyet → kullanıcı risk seviyesi. Güvenlik lehine YUKARI yuvarlanır. */
const RISK_BY_URGENCY: Readonly<Record<string, MechanicRiskLevel>> = {
  none:     'Düşük',
  watch:    'Düşük',
  soon:     'Orta',
  urgent:   'Yüksek',
  critical: 'Kritik',
};

/** Bu seviyelerde güvenlik uyarısı ÖNE ÇIKARILIR. */
const EMERGENCY_RISKS: ReadonlySet<MechanicRiskLevel> = new Set(['Yüksek', 'Kritik']);

const SAFETY_WARNING =
  'Bu bulgu sürüş güvenliğini etkileyebilir: güvenli bir yerde durup kontrol etmen önerilir.';

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

function sanitize(text: unknown): string {
  if (typeof text !== 'string') return '';
  const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
  return text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function clampPercent(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function sanitizeList(list: unknown, max: number, pick: (item: unknown) => string): readonly string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (out.length >= max) break;
    const text = sanitize(pick(item));
    if (text) out.push(text);
  }
  return out;
}

/** Rapordaki tek bir olası nedeni sunum modeline çevirir. */
function toCause(raw: unknown): MechanicCause | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const description = sanitize(r['description']);
  if (!description) return undefined;
  return {
    code:        sanitize(r['code']) || 'unknown',
    description,
    confidence:  clampPercent(r['confidence']),
    evidence:    sanitizeList(r['supportingEvidence'], MAX_EVIDENCE, (e) => (typeof e === 'string' ? e : '')),
  };
}

/** Mevcut AI Usta raporunun (aiCore `AiAgentReport`) gevşek şekli. */
export interface MechanicReportLike {
  readonly headline?:        unknown;
  readonly urgency?:         unknown;
  readonly confidence?:      unknown;
  readonly hasEvidence?:     unknown;
  readonly evidence?:        unknown;
  readonly possibleCauses?:  unknown;
  readonly counterEvidence?: unknown;
  readonly nextSafeChecks?:  unknown;
}

/**
 * Raporu Mavi teşhis modeline çevirir. Rapor yoksa/boşsa `unavailable`
 * durumunda DÜRÜST bir teşhis döner (uydurma neden ÜRETİLMEZ).
 */
export function mapMechanicReport(report: MechanicReportLike | null | undefined): MechanicDiagnosis {
  if (!report || typeof report !== 'object') {
    return {
      summary:      'Teşhis için araç verisi alınamadı.',
      otherCauses:  [],
      confidence:   0,
      risk:         'Düşük',
      availability: 'unavailable',
      evidence:     [],
      counterEvidence: [],
      nextSteps:    [],
      insufficientDataNote: 'Şu an araçtan teşhis verisi okunamıyor; bu yüzden bir neden söylenemez.',
    };
  }

  const urgency = typeof report.urgency === 'string' ? report.urgency : 'none';
  const risk = RISK_BY_URGENCY[urgency] ?? 'Düşük';
  const hasEvidence = report.hasEvidence === true;

  /* KANIT YOKSA NEDEN SUNULMAZ — savunmacı kapı. Deterministik ajan zaten
     `hasEvidence:false` iken nedenleri boş bırakır; burada bir daha zorlanır ki
     bozuk/eski bir rapor "kanıtsız neden" sızdıramasın. */
  const causes: MechanicCause[] = [];
  if (hasEvidence && Array.isArray(report.possibleCauses)) {
    for (const raw of report.possibleCauses) {
      if (causes.length >= MAX_CAUSES) break;
      const cause = toCause(raw);
      if (cause) causes.push(cause);
    }
  }
  // Güven sırası DETERMİNİSTİK: yüksek güven önce, eşitlikte kod alfabetik.
  causes.sort((a, b) => (b.confidence - a.confidence) || a.code.localeCompare(b.code));

  const evidence = sanitizeList(report.evidence, MAX_EVIDENCE,
    (e) => (typeof e === 'object' && e !== null ? String((e as Record<string, unknown>)['summary'] ?? '') : ''));
  const counterEvidence = sanitizeList(report.counterEvidence, MAX_EVIDENCE,
    (e) => (typeof e === 'object' && e !== null ? String((e as Record<string, unknown>)['summary'] ?? '') : ''));
  const nextSteps = sanitizeList(report.nextSafeChecks, MAX_NEXT_STEPS,
    (s) => (typeof s === 'object' && s !== null ? String((s as Record<string, unknown>)['description'] ?? '') : ''));

  /* Veri yeterliliği: kanıt yoksa ASLA neden sunulmaz. */
  const availability: MechanicDataAvailability =
    !hasEvidence            ? 'insufficient'
    : causes.length === 0    ? 'partial'
    : 'sufficient';

  const summary = sanitize(report.headline) ||
    (hasEvidence ? 'Belirti değerlendirildi.' : 'Teşhis için yeterli kanıt yok.');

  return {
    summary,
    ...(causes[0] ? { topCause: causes[0] } : {}),
    otherCauses:  causes.slice(1),
    confidence:   hasEvidence ? clampPercent(report.confidence) : 0,
    risk,
    availability,
    evidence,
    counterEvidence,
    nextSteps,
    ...(availability === 'insufficient'
      ? { insufficientDataNote: 'Kanıt yetersiz olduğu için bir neden söylenmiyor; tahmin üretilmedi.' }
      : availability === 'partial'
        ? { insufficientDataNote: 'Belirti görüldü ama olası neden ayrıştırılamadı.' }
        : {}),
    ...(EMERGENCY_RISKS.has(risk) ? { safetyWarning: SAFETY_WARNING } : {}),
  };
}
