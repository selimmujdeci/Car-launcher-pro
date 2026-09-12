/**
 * provenanceModel — CAROS LAB · Sinyal Kaynak İzi SAF modeli (V-12).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── BU EKRANIN CEVAPLADIĞI SORU ─────────────────────────────────────────────
 * *"Bu değer NEREDEN geldi ve NE ZAMAN ölçüldü?"* — Digital Twin'in ilk gerçek
 * katmanı. Kaynağı bilinmeyen bir değerle karar vermek zero-trust telemetrinin
 * ihlalidir; ekran tam olarak bunu görünür kılar.
 *
 * ── ÜÇ DURUM AYRIDIR ────────────────────────────────────────────────────────
 *  · AKIYOR          — yazıldı ve TAZE
 *  · BAYAT           — yazıldı ama üzerinden çok geçti
 *  · HİÇ YAZILMADI   — bu sinyal bu oturumda HİÇ akmadı (yaş HESAPLANMAZ)
 * Üçüncüsünü "bayat" saymak, hiç gelmemiş bir sinyali "gelmiş ama eskimiş"
 * göstermek olurdu — iki tamamen farklı arıza.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';

const SRC = 'vehicleDataLayer/vehicleProvenance.getProvenanceSnapshot()';

/** Bir sinyalin taze sayılacağı azami yaş — üstü BAYAT. */
export const PROVENANCE_FRESH_MS = 5_000;

export type ProvenanceState = 'FLOWING' | 'STALE' | 'NEVER';

export const PROVENANCE_STATE_LABEL: Readonly<Record<ProvenanceState, string>> = {
  FLOWING: 'AKIYOR',
  STALE:   'BAYAT',
  NEVER:   'HİÇ YAZILMADI',
} as const;

export type ProvenanceTone = 'ok' | 'muted' | 'warn';

export function provenanceStateTone(s: ProvenanceState): ProvenanceTone {
  return s === 'FLOWING' ? 'ok' : s === 'STALE' ? 'warn' : 'muted';
}

export interface ProvenanceRowInput {
  readonly key: string;
  readonly source: string;
  readonly updatedAt: number;
  readonly writes: number;
  readonly ageMs: number | null;
}

export interface ProvenanceViewRow {
  readonly key: string;
  readonly source: string;
  readonly state: ProvenanceState;
  readonly writes: number;
  readonly ageMs: number | null;
  /** Kaynak neden bu — kısa dürüstlük notu. */
  readonly note: string;
}

const SOURCE_NOTE: Readonly<Record<string, string>> = {
  fused: 'Birden çok kaynaktan HARMANLANMIŞ — tek üreticiye indirgenemez; "OBD" demek yalan olurdu.',
  obd: 'OBD-II poll döngüsünden.',
  can: 'CAN bus frame\'inden.',
  gps: 'Konum servisinden.',
  derived: 'Başka sinyallerden HESAPLANMIŞ — doğrudan ölçüm DEĞİL.',
  persisted: 'Diskten geri yüklenmiş — ÖLÇÜM DEĞİL.',
  unknown: 'Yazan taraf kaynağını bildirmedi — UYDURULMAZ.',
};

/** Yaş ve yazım sayısından durum türetir. */
export function deriveProvenanceState(row: ProvenanceRowInput): ProvenanceState {
  if (row.writes === 0 || row.ageMs === null) return 'NEVER';
  return row.ageMs <= PROVENANCE_FRESH_MS ? 'FLOWING' : 'STALE';
}

export function buildProvenanceRows(
  rows: readonly ProvenanceRowInput[],
): readonly ProvenanceViewRow[] {
  return rows.map((r) => ({
    key: r.key,
    source: r.source,
    state: deriveProvenanceState(r),
    writes: r.writes,
    ageMs: r.ageMs,
    note: SOURCE_NOTE[r.source] ?? SOURCE_NOTE['unknown'],
  }));
}

/* ── Genel hüküm ─────────────────────────────────────────────────────────── */

export type ProvenanceVerdict =
  | 'UNAVAILABLE'
  /** Hiçbir sinyal yazılmamış — twin tamamen boş. */
  | 'NO_SIGNALS'
  /** Bazıları akıyor. */
  | 'PARTIAL'
  /** İzlenen her sinyal akıyor. */
  | 'ALL_FLOWING';

export const PROVENANCE_VERDICT_LABEL: Readonly<Record<ProvenanceVerdict, string>> = {
  UNAVAILABLE: 'OKUNAMADI',
  NO_SIGNALS:  'HİÇ SİNYAL YOK — twin boş',
  PARTIAL:     'KISMİ — bazı sinyaller akmıyor',
  ALL_FLOWING: 'TÜM İZLENEN SİNYALLER AKIYOR',
} as const;

export function provenanceVerdictTone(v: ProvenanceVerdict): ProvenanceTone {
  return v === 'ALL_FLOWING' ? 'ok' : v === 'PARTIAL' ? 'warn' : 'muted';
}

export function deriveProvenanceVerdict(
  rows: readonly ProvenanceViewRow[] | null,
): ProvenanceVerdict {
  if (rows === null) return 'UNAVAILABLE';
  if (rows.length === 0) return 'UNAVAILABLE';
  const flowing = rows.filter((r) => r.state === 'FLOWING').length;
  if (flowing === 0) return 'NO_SIGNALS';
  return flowing === rows.length ? 'ALL_FLOWING' : 'PARTIAL';
}

/* ── Özet alanları ───────────────────────────────────────────────────────── */

export function buildProvenanceFields(input: {
  readonly rows: readonly ProvenanceViewRow[] | null;
  readonly nowMs: number;
}): readonly InspectorField[] {
  if (input.rows === null) {
    return [unavailable({
      id: 'pv-store', label: 'Kaynak izi defteri', source: SRC, note: '',
    }, 'Okuma hata verdi — "sinyal yok" ile KARIŞTIRILMAZ.')];
  }

  const rows = input.rows;
  const flowing = rows.filter((r) => r.state === 'FLOWING').length;
  const stale = rows.filter((r) => r.state === 'STALE').length;
  const never = rows.filter((r) => r.state === 'NEVER').length;

  const out: InspectorField[] = [
    observed({
      id: 'pv-counts', label: 'Sinyal durumu', source: SRC,
      note: '"HİÇ YAZILMADI" ile "BAYAT" AYRIDIR: ilki hiç akmamış, ikincisi akmış ve eskimiş — iki farklı arıza.',
    }, `${flowing} akıyor · ${stale} bayat · ${never} hiç yazılmadı`),

    observed({
      id: 'pv-tracked', label: 'İzlenen sinyal', source: SRC,
      note: 'Kaynak izi defterinin kapsamı — bu listede olmayan alanın izi TUTULMAZ.',
    }, rows.length),
  ];

  /* En taze yazımın yaşı: defterin GERÇEKTEN beslendiğinin kanıtı. */
  const freshest = rows
    .filter((r) => r.ageMs !== null)
    .sort((a, b) => (a.ageMs as number) - (b.ageMs as number))[0];

  out.push(freshest === undefined
    ? unavailable({ id: 'pv-freshest', label: 'En taze yazım', source: SRC, note: '' },
        'Hiçbir sinyal hiç yazılmadı — yaş HESAPLANMAZ.')
    : derived({
        id: 'pv-freshest', label: 'En taze yazım', source: SRC,
        note: 'Defterin beslendiğinin kanıtı.',
        updatedAt: input.nowMs - (freshest.ageMs as number),
      }, formatAge(input.nowMs - (freshest.ageMs as number), input.nowMs)));

  const unknownSources = rows.filter((r) => r.source === 'unknown' && r.writes > 0).length;
  out.push(observed({
    id: 'pv-unknown', label: 'Kaynağı bildirilmemiş', source: SRC,
    note: 'Yazılmış ama üreticisi bildirilmemiş sinyaller. Kaynağı bilinmeyen değerle KARAR vermek zero-trust ihlalidir.',
  }, unknownSources));

  return out;
}
