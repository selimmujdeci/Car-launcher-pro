/**
 * actionAuthorityModel.ts — Eylem Otoritesi ekranının SAF görünüm modeli (MAVI-M4-LAB).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: kapı kararı VERMEZ, defter TANIMLAMAZ, eylem
 * ÇALIŞTIRMAZ. `maviActionAuthority`nin ürettiği kararları yalnız SINIFLANDIRIR ve
 * gösterime hazırlar.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri Session Inspector modelinden AYNEN
 * yeniden kullanılır (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — ikinci bir
 * sınıflandırma sistemi kurulmaz.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · modül durumu yok · React importu yok.
 * "Şimdi" gerekiyorsa çağıran `nowMs` geçirir.
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ───────────────────────────────────────
 *  · `null` liste = KAYNAK OKUNAMADI; `[]` = GERÇEKTEN BOŞ. İkisi AYRI gösterilir.
 *  · Sayaç kaynağı yoksa `0` BASILMAZ (sahte sıfır yasak) → KAYNAK YOK.
 *  · Damga yoksa "şimdi" YAZILMAZ.
 *  · Bekleyen onay yalnız VAR/YOK'tur — ne olduğu (kim aranıyor, ne siliniyor)
 *    bu katmana HİÇ GELMEZ ve gösterilemez.
 */

import {
  observed, derived, unavailable,
  type InspectorField, type Observability,
} from './sessionInspectorModel';
import type { IntentType } from '../intentEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü sözleşmesi (Sources → Model)
 * ════════════════════════════════════════════════════════════════════════ */

export interface AaActionRaw {
  readonly intent:               IntentType;
  readonly actionId:             string;
  readonly risk:                 string;
  readonly requiresConfirmation: boolean;
  readonly capability:           string | null;
  readonly vehicleScope:         string | null;
  readonly motionPolicy:         string;
}

export interface AaDecisionRaw {
  readonly intent:   string | null;
  readonly actionId: string | null;
  readonly status:   string | null;
  readonly reason:   string | null;
  readonly atMs:     number | null;
}

export interface AaCountersRaw {
  readonly evaluated:            number;
  readonly allowed:              number;
  readonly denied:               number;
  readonly confirmationRequired: number;
  readonly unsupported:          number;
  readonly failed:               number;
}

export interface AaPendingRaw {
  readonly pending:     boolean;
  readonly actionId:    string | null;
  readonly ageMs:       number | null;
  readonly expiresInMs: number | null;
}

export interface AaRawSnapshot {
  readonly readAt:            number;
  readonly actions:           readonly AaActionRaw[] | null;
  readonly decisions:         readonly AaDecisionRaw[] | null;
  readonly capacity:          number;
  readonly counters:          AaCountersRaw | null;
  readonly countersSaturated: boolean;
  readonly pending:           AaPendingRaw | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Görünüm tipleri
 * ════════════════════════════════════════════════════════════════════════ */

/** Ekranda gösterilecek azami karar satırı — halka kapasitesiyle uyumlu tavan. */
export const MAX_AA_DECISION_ROWS = 40;

export type AaDecisionTone = 'ALLOWED' | 'BLOCKED' | 'CONFIRM' | 'NEUTRAL';

export const AA_DECISION_TONE_LABEL: Readonly<Record<AaDecisionTone, string>> = {
  ALLOWED: 'GEÇTİ',
  BLOCKED: 'ENGELLENDİ',
  CONFIRM: 'ONAY BEKLENDİ',
  NEUTRAL: 'DİĞER',
} as const;

export interface AaDecisionRow {
  readonly key:      string;
  readonly intent:   string;
  readonly actionId: string;
  readonly status:   string;
  readonly reason:   string;
  readonly tone:     AaDecisionTone;
  readonly atMs:     number | null;
}

export type AaRiskTone = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface AaActionRow {
  readonly key:                  string;
  readonly intent:               string;
  readonly actionId:             string;
  readonly risk:                 string;
  readonly riskTone:             AaRiskTone;
  readonly requiresConfirmation: boolean;
  /** Port adı — `null` ise "port gerekmez" (gerçek servis çağırır). */
  readonly capability:           string | null;
  /** AiSafetyGate kapsamı — `null` ise araç ECU'suna dokunmaz. */
  readonly vehicleScope:         string | null;
  readonly motionPolicy:         string;
  /** `requires_stopped` → doğrulanmış duruş şart (M2 fail-closed). */
  readonly requiresStopped:      boolean;
}

export type AaSectionId = 'pending' | 'counters';

export interface AaSection {
  readonly id:     AaSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

export const AA_SECTION_TITLE: Readonly<Record<AaSectionId, string>> = {
  pending:  '1 · Bekleyen Açık Onay',
  counters: '2 · Kapı Sayaçları',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Defter satırları
 * ════════════════════════════════════════════════════════════════════════ */

function _riskTone(risk: string): AaRiskTone {
  if (risk === 'high')   return 'HIGH';
  if (risk === 'medium') return 'MEDIUM';
  if (risk === 'low')    return 'LOW';
  return 'UNKNOWN';
}

/**
 * Defterdeki eylemleri satırlara çevirir.
 * `null` giriş (kaynak okunamadı) → `null` döner; `[]` → `[]` (gerçekten boş).
 */
export function buildAaActionRows(snap: AaRawSnapshot): readonly AaActionRow[] | null {
  const src = snap?.actions;
  if (!Array.isArray(src)) return null;
  const rows: AaActionRow[] = [];
  for (const a of src) {
    if (!a || typeof a.actionId !== 'string') continue;
    rows.push({
      key:                  a.actionId,
      intent:               String(a.intent),
      actionId:             a.actionId,
      risk:                 a.risk,
      riskTone:             _riskTone(a.risk),
      requiresConfirmation: a.requiresConfirmation === true,
      capability:           a.capability,
      vehicleScope:         a.vehicleScope,
      motionPolicy:         a.motionPolicy,
      requiresStopped:      a.motionPolicy === 'requires_stopped',
    });
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar satırları
 * ════════════════════════════════════════════════════════════════════════ */

function _tone(status: string): AaDecisionTone {
  if (status === 'allowed')            return 'ALLOWED';
  if (status === 'needs_confirmation') return 'CONFIRM';
  if (status === 'denied' || status === 'unsupported' || status === 'failed') return 'BLOCKED';
  return 'NEUTRAL';
}

/**
 * Kapı kararlarını satırlara çevirir. Sıra KAYNAKTAN GELDİĞİ GİBİ korunur
 * (otorite halkası EN YENİ → EN ESKİ döndürür); burada YENİDEN SIRALANMAZ.
 * Tavan uygulanır — liste sınırsız büyümez.
 */
export function buildAaDecisionRows(snap: AaRawSnapshot): readonly AaDecisionRow[] | null {
  const src = snap?.decisions;
  if (!Array.isArray(src)) return null;
  const rows: AaDecisionRow[] = [];
  for (let i = 0; i < src.length && rows.length < MAX_AA_DECISION_ROWS; i++) {
    const d = src[i];
    if (!d) continue;
    const status = d.status ?? '';
    rows.push({
      // Damga tekrar edebilir (aynı ms içinde iki karar) → indeks anahtara girer.
      key:      `${i}-${d.actionId ?? '?'}-${d.atMs ?? 0}`,
      intent:   d.intent ?? '—',
      actionId: d.actionId ?? '—',
      status:   status || '—',
      reason:   d.reason ?? '—',
      tone:     _tone(status),
      atMs:     d.atMs,
    });
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler (bekleyen onay + sayaçlar)
 * ════════════════════════════════════════════════════════════════════════ */

const SRC_AUTH    = 'action/maviActionAuthority.getActionAuthorityDiagnostics()';
const SRC_PENDING = 'action/pendingActionConfirmation.getPendingActionDiagnostics()';

function _ms(v: number | null): string | null {
  return v === null ? null : `${Math.max(0, Math.round(v))} ms`;
}

export function buildAaSections(snap: AaRawSnapshot): readonly AaSection[] {
  const readAt = snap?.readAt ?? null;

  /* ── 1 · Bekleyen açık onay — YALNIZ VAR/YOK ───────────────────────────
     Neyin onaylandığı (kim aranıyor · ne siliniyor) GÖSTERİLMEZ: o bilgi
     kişi adı ve ham komut taşır, gözlem katmanına hiç gelmez. */
  const p = snap?.pending ?? null;
  /** `note` sözleşme gereği ZORUNLU — her alan gerekçesini taşır. */
  const fin = (id: string, label: string, source: string, note: string, updatedAt: number | null) =>
    ({ id, label, source, note, updatedAt });

  const pendingFields: InspectorField[] = [
    p
      ? observed(
          fin('pending-flag', 'Bekleyen onay', SRC_PENDING,
            'Yalnız VAR/YOK. Onaylama veya iptal etme yolu bu ekranda YOKTUR.', readAt),
          p.pending ? 'VAR' : 'YOK',
        )
      : unavailable(
          fin('pending-flag', 'Bekleyen onay', SRC_PENDING, 'Onay deposu okunamadı.', null),
          'Onay deposu okunamadı.',
        ),
    p && p.pending
      ? observed(
          fin('pending-action', 'Eylem kimliği', SRC_PENDING,
            'Sabit defter kimliği — kullanıcı içeriği DEĞİL.', readAt),
          p.actionId,
        )
      : unavailable(
          fin('pending-action', 'Eylem kimliği', SRC_PENDING, '', null),
          p ? 'Bekleyen onay yok.' : 'Onay deposu okunamadı.',
        ),
    p && p.pending
      ? observed(fin('pending-age', 'Bekleme süresi', SRC_PENDING, '', readAt), _ms(p.ageMs))
      : unavailable(fin('pending-age', 'Bekleme süresi', SRC_PENDING, '', null),
          p ? 'Bekleyen onay yok.' : 'Onay deposu okunamadı.'),
    p && p.pending
      ? derived(
          fin('pending-expires', 'Kalan süre', SRC_PENDING,
            'TTL dolduğunda onay kendiliğinden geçersizdir (fail-closed).', readAt),
          _ms(p.expiresInMs),
        )
      : unavailable(fin('pending-expires', 'Kalan süre', SRC_PENDING, '', null),
          p ? 'Bekleyen onay yok.' : 'Onay deposu okunamadı.'),
  ];

  /* ── 2 · Kapı sayaçları — kaynak yoksa SAHTE 0 basılmaz ────────────────── */
  const c = snap?.counters ?? null;
  const counterField = (id: string, label: string, value: number | undefined, note: string): InspectorField =>
    c
      ? observed(fin(id, label, SRC_AUTH, note, readAt), value)
      : unavailable(fin(id, label, SRC_AUTH, note, null), 'Otorite tanı yüzeyi okunamadı.');

  const counterFields: InspectorField[] = [
    counterField('c-evaluated', 'evaluated', c?.evaluated,
      'Kapıya SORULAN araç etkili eylem sayısı (defter dışı intentler sayılmaz).'),
    counterField('c-allowed', 'allowed', c?.allowed, 'Kapı geçildi → yürütücü çağrılabilir.'),
    counterField('c-denied', 'denied', c?.denied, 'Hareket politikası veya AiSafetyGate reddi.'),
    counterField('c-confirmation', 'confirmationRequired', c?.confirmationRequired,
      'Açık kullanıcı onayı istendi; eylem BAŞLAMADI.'),
    counterField('c-unsupported', 'unsupported', c?.unsupported, 'Yürütücü portu yok → dürüst desteklenmiyor.'),
    counterField('c-failed', 'failed', c?.failed, 'Kapı aşamasında başarısız karar.'),
    c
      ? derived(
          fin('c-capacity', 'Karar halkası kapasitesi', SRC_AUTH,
            'Sabit boyutlu dairesel tampon — bellek büyümez, en eski kayıt düşer.', readAt),
          snap.capacity,
        )
      : unavailable(fin('c-capacity', 'Karar halkası kapasitesi', SRC_AUTH, '', null),
          'Otorite tanı yüzeyi okunamadı.'),
    c && snap.countersSaturated
      ? derived(fin('c-saturated', 'Sayaç doydu', SRC_AUTH,
          'Tavana ulaşıldı — sayım DURDU, taşma yok.', readAt), 'EVET')
      : unavailable(fin('c-saturated', 'Sayaç doydu', SRC_AUTH, '', null),
          c ? 'Tavana ulaşılmadı.' : 'Otorite tanı yüzeyi okunamadı.'),
  ];

  return [
    { id: 'pending',  title: AA_SECTION_TITLE.pending,  fields: pendingFields },
    { id: 'counters', title: AA_SECTION_TITLE.counters, fields: counterFields },
  ];
}

/** Bölümlerdeki alanların gözlemlenebilirlik sınıfı dağılımı (rozet sayacı). */
export function countByAaClass(sections: readonly AaSection[]): Readonly<Record<Observability, number>> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const s of sections) {
    for (const f of s.fields) out[f.klass]++;
  }
  return out;
}
