/**
 * evidenceInputGuard.ts — kanıt girdisinin ÇAĞRI SINIRI kapısı (yaprak modül).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (kütük #497, madde 2) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * #497'nin ilk katmanı (`default` dalları) union dışı girdinin **çökme**
 * yaratmasını engelledi: artık `UNKNOWN`'a düşülüyor. Ama bu tek başına
 * yetmez — çünkü o düşüş **sessizdir**. Sessiz düşüş şu iki durumu ayırt
 * edilemez kılar:
 *
 *   · "araç hakkında bilgimiz yok"  (gerçekten kanıt yok)
 *   · "kanıt geldi ama ANLAYAMADIK" (şema kaydı, bozuk veri, sürüm farkı)
 *
 * İkincisi bir ARIZA sinyalidir ve görünmezse şema sürüklenmesi aylarca fark
 * edilmez. Bu yüzden kural: **bilinmeyen girdi sessizce yutulmaz** — reddedilir
 * VE sayılır.
 *
 * ── GİZLİLİK (bağlayıcı) ──────────────────────────────────────────────────
 * Reddedilen DEĞER hiçbir yerde saklanmaz ve LAB'a taşınmaz. Yalnız
 * **hangi alan** bozuktu, **kaç adet** ve **hangi kaynaktan** geldiği tutulur.
 * Değerin kendisi VIN · plaka · konum · sürücü kimliği taşıyabilir; sayı ve
 * kaynak taşımaz.
 *
 * ── SAFLIK ────────────────────────────────────────────────────────────────
 * Doğrulayıcı SAFTIR (I/O yok · timer yok · `Date.now` yok — zaman dışarıdan
 * verilir). Sayaç modül düzeyindedir ve yalnız bu dosyada mutasyona uğrar.
 */

import {
  EVIDENCE_CATEGORIES, EVIDENCE_SOURCES, EVIDENCE_SEVERITIES,
  EVIDENCE_PROVENANCES, EVIDENCE_STATES,
  type AiEvidence,
} from '../../fleet/aiEvidence';

/** Hangi alan tanınmadı — bounded kod, serbest metin YOK. */
export const UNKNOWN_INPUT_FIELDS = [
  'category', 'source', 'severity', 'provenance', 'state',
] as const;
export type UnknownInputField = (typeof UNKNOWN_INPUT_FIELDS)[number];

export interface UnknownInputStats {
  /** Toplam reddedilen girdi sayısı. */
  readonly totalRejected: number;
  /** Hangi alan kaç kez tanınmadı. */
  readonly byField: Readonly<Record<UnknownInputField, number>>;
  /**
   * Hangi kaynaktan geldi. Kaynağın KENDİSİ tanınmıyorsa `'SOURCE_UNKNOWN'`
   * altında sayılır — uydurma kaynak adı üretilmez.
   */
  readonly bySource: Readonly<Record<string, number>>;
  /** Son reddin zamanı (çağıranın verdiği saat). Hiç yoksa `null`. */
  readonly lastRejectedAtMs: number | null;
}

const _byField: Record<UnknownInputField, number> = {
  category: 0, source: 0, severity: 0, provenance: 0, state: 0,
};
const _bySource: Record<string, number> = {};
let _totalRejected = 0;
let _lastRejectedAtMs: number | null = null;

/** Sayaç taşmasını önler — sayaç bir teşhis aracıdır, sonsuz büyümez. */
const COUNTER_CEILING = 1_000_000;

function bump(field: UnknownInputField, source: string, atMs: number): void {
  if (_totalRejected < COUNTER_CEILING) _totalRejected++;
  if (_byField[field] < COUNTER_CEILING) _byField[field]++;
  const key = (EVIDENCE_SOURCES as readonly string[]).includes(source)
    ? source : 'SOURCE_UNKNOWN';
  const cur = _bySource[key] ?? 0;
  if (cur < COUNTER_CEILING) _bySource[key] = cur + 1;
  _lastRejectedAtMs = atMs;
}

export interface InputGuardResult {
  readonly accepted: boolean;
  /** Reddedildiyse hangi alan yüzünden — LAB'da gösterilir. */
  readonly rejectedField: UnknownInputField | null;
}

/**
 * Ham kanıt girdisini doğrular.
 *
 * ⚠️ Girdi **reddedilirse motora HİÇ verilmez**. `default` dalları bir güvenlik
 * ağıdır; asıl kapı burasıdır. Kanıt yarım kabul edilmez: tek bir alanı bile
 * tanınmıyorsa o kanıt karara giremez, çünkü hangi kategoriye ait olduğu
 * bilinmeyen bir gözlem hangi niyete hizmet ettiğini de bilemez.
 */
export function validateEvidenceInput(
  raw: Partial<AiEvidence> | null | undefined,
  nowMs: number,
): InputGuardResult {
  if (raw == null) {
    bump('category', 'SOURCE_UNKNOWN', nowMs);
    return { accepted: false, rejectedField: 'category' };
  }
  const src = typeof raw.source === 'string' ? raw.source : 'SOURCE_UNKNOWN';

  const checks: ReadonlyArray<readonly [UnknownInputField, unknown, readonly string[]]> = [
    ['category',   raw.category,   EVIDENCE_CATEGORIES],
    ['source',     raw.source,     EVIDENCE_SOURCES],
    ['severity',   raw.severity,   EVIDENCE_SEVERITIES],
    ['provenance', raw.provenance, EVIDENCE_PROVENANCES],
    ['state',      raw.state,      EVIDENCE_STATES],
  ];

  for (const [field, value, allowed] of checks) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      bump(field, src, nowMs);
      return { accepted: false, rejectedField: field };
    }
  }
  return { accepted: true, rejectedField: null };
}

/** CAROS LAB okuma ucu — senkron, yan etkisiz, salt-okunur kopya. */
export function readUnknownInputStats(): UnknownInputStats {
  return {
    totalRejected: _totalRejected,
    byField: { ..._byField },
    bySource: { ..._bySource },
    lastRejectedAtMs: _lastRejectedAtMs,
  };
}

/** Yalnız testler için — sayaçları sıfırlar. */
export function _resetUnknownInputStatsForTest(): void {
  _totalRejected = 0;
  _lastRejectedAtMs = null;
  for (const k of UNKNOWN_INPUT_FIELDS) _byField[k] = 0;
  for (const k of Object.keys(_bySource)) delete _bySource[k];
}
