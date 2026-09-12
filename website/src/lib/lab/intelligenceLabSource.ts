/**
 * intelligenceLabSource.ts — DRIVER DNA · FLEET INTELLIGENCE · EVIDENCE
 * TEK OKUMA KATMANI (SALT-OKUNUR).
 *
 * ── NEDEN BU DOSYA VAR ─────────────────────────────────────────────────
 * Bu üç yeteneğin SQL'i (053 · 054 · 055/056), saf görünüm katmanı ve kartları
 * ZATEN yazılmıştı — eksik olan TEK HALKA okuma ucuydu: hiçbir yer
 * `get_driver_dna` · `get_fleet_intelligence` · `get_evidence_coverage` ·
 * `get_subject_evidence` RPC'lerini çağırmıyordu, dolayısıyla kartlar hiçbir
 * sayfada mount edilmemişti. Bu dosya YENİ bir yetenek eklemez; var olan
 * zinciri tamamlar.
 *
 * KURALLAR (CLAUDE.md §Zorunlu Gözlemlenebilirlik):
 *   · SALT-OKUNUR — hiçbir şey üretmez/yazmaz/tetiklemez.
 *   · Her okuma kendi `try/catch`'i içinde; biri patlarsa diğerleri gelir.
 *   · `null` = OKUNAMADI. Boş sonuç ile ASLA karıştırılmaz.
 *   · Sunucu fail-closed'dır (oturum/şirket yoksa boş döner) — bu katman onu
 *     "veri yok" diye DEĞİL, okunabilirlik bayrağıyla ayrı raporlar.
 *   · TEKNİK SQL HATA METNİ YUKARI TAŞINMAZ (kullanıcıya sızmasın).
 *   · Cross-tenant izolasyon SUNUCUDA zorlanır (SECURITY DEFINER + company_id);
 *     burada ikinci bir kapı KURULMAZ (iki kapı iki gerçek kaynağı olurdu).
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import type { DriverDnaRow } from '@/lib/fleet/driverDnaView';
import type { FleetIntelligenceRow } from '@/lib/fleet/fleetIntelligenceView';
import type { EvidenceCoverageRow, SubjectEvidenceRow } from '@/lib/fleet/evidenceCoverageView';

/* ── Filo geneli okuma ─────────────────────────────────────────────────── */

export interface IntelligenceLabReading {
  /** `null` = okunamadı (boş sonuç DEĞİL). */
  readonly fleetIntelligence: FleetIntelligenceRow | null;
  readonly evidenceCoverage: EvidenceCoverageRow | null;
  readonly fleetIntelligenceReadable: boolean;
  readonly evidenceCoverageReadable: boolean;
  readonly readAt: number;
}

const UNREADABLE: Omit<IntelligenceLabReading, 'readAt'> = Object.freeze({
  fleetIntelligence: null,
  evidenceCoverage: null,
  fleetIntelligenceReadable: false,
  evidenceCoverageReadable: false,
});

/** Şirket geneli zekâ özetleri — Fleet Lab sayfası için tek okuma. */
export async function readIntelligenceLab(userId: string | null): Promise<IntelligenceLabReading> {
  const readAt = Date.now();
  if (userId === null) return { ...UNREADABLE, readAt };

  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { ...UNREADABLE, readAt };

  let fleetIntelligence: FleetIntelligenceRow | null = null;
  let evidenceCoverage: EvidenceCoverageRow | null = null;
  let fleetIntelligenceReadable = false;
  let evidenceCoverageReadable = false;

  try {
    const { data, error } = await supabase.rpc('get_fleet_intelligence');
    if (!error) {
      fleetIntelligenceReadable = true;
      const rows = Array.isArray(data) ? data : [];
      fleetIntelligence = (rows[0] as FleetIntelligenceRow | undefined) ?? null;
    }
  } catch {
    fleetIntelligenceReadable = false;
  }

  try {
    const { data, error } = await supabase.rpc('get_evidence_coverage');
    if (!error) {
      evidenceCoverageReadable = true;
      const rows = Array.isArray(data) ? data : [];
      evidenceCoverage = (rows[0] as EvidenceCoverageRow | undefined) ?? null;
    }
  } catch {
    evidenceCoverageReadable = false;
  }

  return { fleetIntelligence, evidenceCoverage, fleetIntelligenceReadable, evidenceCoverageReadable, readAt };
}

/* ── Sürücü DNA okuma ──────────────────────────────────────────────────── */

export interface DriverDnaReading {
  readonly row: DriverDnaRow | null;
  readonly readable: boolean;
  readonly readAt: number;
}

/**
 * Tek sürücünün DNA'sı.
 *
 * ⚠️ `p_driver_id` SUNUCUDA şirket kapsamına göre doğrulanır: başka şirketin
 * sürücüsü istenirse fonksiyon BOŞ döner (satır 0). Bu katman o boşluğu
 * "veri yok" olarak gösterir — yetki hatası metni kullanıcıya SIZMAZ.
 */
export async function readDriverDna(
  userId: string | null,
  driverId: string | null,
): Promise<DriverDnaReading> {
  const readAt = Date.now();
  if (userId === null || driverId === null || driverId === '') {
    return { row: null, readable: false, readAt };
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { row: null, readable: false, readAt };

  try {
    const { data, error } = await supabase.rpc('get_driver_dna', { p_driver_id: driverId });
    if (error) return { row: null, readable: false, readAt };
    const rows = Array.isArray(data) ? data : [];
    return { row: (rows[0] as DriverDnaRow | undefined) ?? null, readable: true, readAt };
  } catch {
    return { row: null, readable: false, readAt };
  }
}

/* ── Özne kanıtı okuma ─────────────────────────────────────────────────── */

/** Kanıt öznesi — sunucu sözleşmesiyle birebir (`p_subject_kind`). */
export type EvidenceSubjectKind = 'VEHICLE' | 'DRIVER' | 'TRIP';

export interface SubjectEvidenceReading {
  readonly rows: readonly SubjectEvidenceRow[] | null;
  readonly readable: boolean;
  readonly readAt: number;
}

/**
 * Bir öznenin (araç · sürücü · yolculuk) kanıtları.
 *
 * ⚠️ Ham tanımlayıcı SIZDIRMAZ: sunucu zaten VIN/konum döndürmez; bu katman
 * dönen satırları OLDUĞU GİBİ taşır ve görünüm katmanı (`subjectEvidenceView`)
 * maskelemeyi uygular.
 */
export async function readSubjectEvidence(
  userId: string | null,
  kind: EvidenceSubjectKind,
  subjectId: string | null,
): Promise<SubjectEvidenceReading> {
  const readAt = Date.now();
  if (userId === null || subjectId === null || subjectId === '') {
    return { rows: null, readable: false, readAt };
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { rows: null, readable: false, readAt };

  try {
    const { data, error } = await supabase.rpc('get_subject_evidence', {
      p_subject_kind: kind,
      p_subject_id: subjectId,
    });
    if (error) return { rows: null, readable: false, readAt };
    return {
      rows: Array.isArray(data) ? (data as SubjectEvidenceRow[]) : [],
      readable: true,
      readAt,
    };
  } catch {
    return { rows: null, readable: false, readAt };
  }
}

/* ── Fleet Insight detay + kanıt zinciri (migration 062) ────────────────── */

/** `list_fleet_insights()` satırı (SQL sütun adlarıyla birebir). */
export interface FleetInsightRow {
  readonly insight_id?: string | null;
  readonly type?: string | null;
  readonly source?: string | null;
  readonly state?: string | null;
  readonly confidence?: string | null;
  readonly subject_kind?: string | null;
  readonly subject_id?: string | null;
  readonly evidence_count?: number | null;
  readonly vehicle_count?: number | null;
  readonly driver_count?: number | null;
  readonly trip_count?: number | null;
  readonly measured_count?: number | null;
  readonly unknown_reason?: string | null;
  readonly revision?: number | null;
  readonly created_at?: string | null;
  readonly expires_at?: string | null;
}

/** `get_fleet_insight_chain()` satırı — iki yönlü zincir. */
export interface FleetInsightChainRow {
  readonly direction?: string | null;
  readonly evidence_id?: string | null;
  readonly source?: string | null;
  readonly category?: string | null;
  readonly metric?: string | null;
  readonly value?: number | string | null;
  readonly provenance?: string | null;
  readonly confidence?: string | null;
  readonly severity?: string | null;
  readonly state?: string | null;
  readonly consumer?: string | null;
  readonly consumer_id?: string | null;
  readonly created_at?: string | null;
  readonly expires_at?: string | null;
}

export interface FleetInsightListReading {
  readonly rows: readonly FleetInsightRow[] | null;
  readonly readable: boolean;
}

/** İçgörü listesi — Fleet Intelligence kartından detaya inmenin ilk adımı. */
export async function readFleetInsights(userId: string | null): Promise<FleetInsightListReading> {
  if (userId === null) return { rows: null, readable: false };
  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { rows: null, readable: false };
  try {
    const { data, error } = await supabase.rpc('list_fleet_insights', { p_limit: 50 });
    if (error) return { rows: null, readable: false };
    return { rows: Array.isArray(data) ? (data as FleetInsightRow[]) : [], readable: true };
  } catch {
    return { rows: null, readable: false };
  }
}

export interface FleetInsightChainReading {
  readonly rows: readonly FleetInsightChainRow[] | null;
  readonly readable: boolean;
}

/**
 * Bir içgörünün iki yönlü kanıt zinciri.
 *
 * ⚠️ Kanıtı olmayan içgörü için sunucu BOŞ döner — bu katman sahte zincir
 * UYDURMAZ; boş liste ile okunamadı AYRI raporlanır.
 */
export async function readFleetInsightChain(
  userId: string | null,
  insightId: string | null,
): Promise<FleetInsightChainReading> {
  if (userId === null || insightId === null || insightId === '') {
    return { rows: null, readable: false };
  }
  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { rows: null, readable: false };
  try {
    const { data, error } = await supabase.rpc('get_fleet_insight_chain', {
      p_insight_id: insightId,
    });
    if (error) return { rows: null, readable: false };
    return { rows: Array.isArray(data) ? (data as FleetInsightChainRow[]) : [], readable: true };
  } catch {
    return { rows: null, readable: false };
  }
}
