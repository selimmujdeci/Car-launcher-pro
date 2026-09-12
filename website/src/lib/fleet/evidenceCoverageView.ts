/**
 * evidenceCoverageView.ts — FLEET DASHBOARD · KANIT KARTLARI GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * **"Bu filo hakkında söylenen her şeyin arkasında kanıt var mı — ne kadarı
 * güçlü, ne kadarı bayat, ne eksik?"**
 *
 * ── BU BİR AI PANELİ DEĞİLDİR ─────────────────────────────────────────
 * Cevap/öneri/cümle üretilmez. Kartlar yalnız kanıt sayılarını, kalitesini
 * ve **eksikleri** gösterir.
 *
 * ── İKİ OTORİTE YASAĞI ────────────────────────────────────────────────
 * Güven FORMÜLÜ burada yeniden yazılmaz; sunucu (migration 055) türetir,
 * bu katman yalnız daraltır ve gösterir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

/** `get_evidence_coverage()` satırı — alanlar eksik/bozuk gelebilir. */
export interface EvidenceCoverageRow {
  readonly company_id?: string | null;
  readonly evidence_total?: number | null;
  readonly active_count?: number | null;
  readonly expired_count?: number | null;
  readonly rejected_count?: number | null;
  readonly unknown_confidence_count?: number | null;
  readonly merge_refresh_total?: number | null;
  readonly chain_link_count?: number | null;
  readonly distinct_source_count?: number | null;
  readonly distinct_category_count?: number | null;
  readonly vehicles_total?: number | null;
  readonly vehicles_with_evidence?: number | null;
  readonly drivers_total?: number | null;
  readonly drivers_with_evidence?: number | null;
  readonly vehicle_coverage?: number | string | null;
  readonly driver_coverage?: number | string | null;
  readonly high_confidence_ratio?: number | string | null;
  readonly integrity_ok?: boolean | null;
}

export interface EvidenceCard {
  readonly key: 'COVERAGE' | 'QUALITY' | 'EXPIRED' | 'MISSING';
  readonly label: string;
  /** `null` = bilinmiyor (0 DEĞİL). */
  readonly value: number | null;
  readonly unit: 'PERCENT' | 'COUNT';
  /** Kanıt bağlamı — yorum DEĞİL. */
  readonly detail: string;
  readonly known: boolean;
}

export interface EvidenceCoverageView {
  readonly present: boolean;
  readonly cards: readonly EvidenceCard[];
  readonly vehicleCoverage: number | null;
  readonly driverCoverage: number | null;
  readonly highConfidenceRatio: number | null;
  readonly expiredCount: number;
  readonly missingVehicleCount: number | null;
  readonly missingDriverCount: number | null;
  readonly integrityOk: boolean | null;
  readonly chainLinkCount: number | null;
  readonly absentReason: 'NO_ROW' | 'NO_EVIDENCE' | null;
}

export const EMPTY_EVIDENCE_COVERAGE_VIEW: EvidenceCoverageView = Object.freeze({
  present: false,
  cards: Object.freeze([]) as readonly EvidenceCard[],
  vehicleCoverage: null, driverCoverage: null, highConfidenceRatio: null,
  expiredCount: 0, missingVehicleCount: null, missingDriverCount: null,
  integrityOk: null, chainLinkCount: null, absentReason: 'NO_ROW',
});

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

/**
 * Sunucu satırını kart görünümüne çevirir.
 *
 * Kanıt yoksa **kart dolu gösterilmez** — gerekçe yazılır. Yarım bir kanıt
 * tablosu, kullanıcıya "her şey kanıtlı" izlenimi verir.
 */
export function buildEvidenceCoverageView(
  row: EvidenceCoverageRow | null | undefined,
): EvidenceCoverageView {
  if (row === null || row === undefined) return EMPTY_EVIDENCE_COVERAGE_VIEW;

  const total = num(row.evidence_total);
  const active = num(row.active_count);
  const expired = num(row.expired_count) ?? 0;
  const rejected = num(row.rejected_count) ?? 0;
  const unknownConf = num(row.unknown_confidence_count) ?? 0;
  const vehCov = num(row.vehicle_coverage);
  const drvCov = num(row.driver_coverage);
  const quality = num(row.high_confidence_ratio);
  const vehTotal = num(row.vehicles_total);
  const vehWith = num(row.vehicles_with_evidence);
  const drvTotal = num(row.drivers_total);
  const drvWith = num(row.drivers_with_evidence);
  const chain = num(row.chain_link_count);
  const integrity = typeof row.integrity_ok === 'boolean' ? row.integrity_ok : null;

  const missingVehicles = vehTotal === null || vehWith === null
    ? null : Math.max(0, vehTotal - vehWith);
  const missingDrivers = drvTotal === null || drvWith === null
    ? null : Math.max(0, drvTotal - drvWith);

  if ((total ?? 0) === 0) {
    return {
      ...EMPTY_EVIDENCE_COVERAGE_VIEW,
      vehicleCoverage: vehCov, driverCoverage: drvCov,
      missingVehicleCount: missingVehicles, missingDriverCount: missingDrivers,
      integrityOk: integrity,
      absentReason: 'NO_EVIDENCE',
    };
  }

  const cards: EvidenceCard[] = [
    {
      key: 'COVERAGE', label: 'Kanıt kapsamı',
      value: pct(vehCov), unit: 'PERCENT',
      detail: vehTotal === null
        ? 'Araç sayısı bilinmiyor'
        : `${vehWith ?? 0}/${vehTotal} aracın kanıtı var`,
      known: vehCov !== null,
    },
    {
      key: 'QUALITY', label: 'Kanıt kalitesi',
      value: pct(quality), unit: 'PERCENT',
      detail: unknownConf > 0
        ? `${unknownConf} kanıtın güveni türetilemedi`
        : `${active ?? 0} aktif kanıt`,
      known: quality !== null,
    },
    {
      key: 'EXPIRED', label: 'Süresi dolmuş kanıt',
      value: expired, unit: 'COUNT',
      /* Süresi dolan kanıt SİLİNMEZ — geçmiş iddialar açıklanabilir kalsın. */
      detail: 'Silinmedi — geçmiş iddialar izlenebilir kalır',
      known: true,
    },
    {
      key: 'MISSING', label: 'Kanıtı olmayan',
      value: missingVehicles === null && missingDrivers === null
        ? null : (missingVehicles ?? 0) + (missingDrivers ?? 0),
      unit: 'COUNT',
      detail: `${missingVehicles ?? '—'} araç · ${missingDrivers ?? '—'} sürücü`
        + (rejected > 0 ? ` · ${rejected} kayıt kanıt sayılmadı` : ''),
      known: missingVehicles !== null || missingDrivers !== null,
    },
  ];

  return {
    present: true, cards,
    vehicleCoverage: vehCov, driverCoverage: drvCov, highConfidenceRatio: quality,
    expiredCount: expired,
    missingVehicleCount: missingVehicles, missingDriverCount: missingDrivers,
    integrityOk: integrity, chainLinkCount: chain,
    absentReason: null,
  };
}

/** Kanıt yoksa kullanıcıya dürüst açıklama (boş kart YOK). */
export function evidenceAbsenceExplanation(v: EvidenceCoverageView): string | null {
  if (v.present) return null;
  if (v.absentReason === 'NO_EVIDENCE') {
    return 'Henüz hiç kanıt kaydedilmedi. Kanıt olmadan hiçbir iddia '
         + 'açıklanamaz; bu yüzden kapsam ve kalite gösterilmiyor.';
  }
  return 'Bu şirket için kanıt kaydı bulunamadı.';
}

/* ── Özne kanıt listesi (Trip / Driver / Insight detayı) ───────────────── */

/** `get_subject_evidence()` satırı. */
export interface SubjectEvidenceRow {
  readonly evidence_id?: string | null;
  readonly source?: string | null;
  readonly category?: string | null;
  readonly metric?: string | null;
  readonly value?: number | string | null;
  readonly provenance?: string | null;
  readonly confidence?: string | null;
  readonly state?: string | null;
  readonly subject_revision?: number | null;
  readonly refresh_count?: number | null;
}

export interface SubjectEvidenceItem {
  readonly id: string;
  readonly source: string;
  readonly category: string;
  readonly metric: string;
  /** `null` = ölçüm yok (0 DEĞİL). */
  readonly value: number | null;
  readonly provenance: string;
  readonly confidence: string;
  readonly state: string;
  readonly revision: number;
  readonly refreshCount: number;
  /** Geçerli mi — `ACTIVE` dışındakiler kanıt olarak SUNULMAZ. */
  readonly active: boolean;
}

export interface SubjectEvidenceView {
  readonly items: readonly SubjectEvidenceItem[];
  readonly activeCount: number;
  readonly supersededCount: number;
  readonly expiredCount: number;
  /** Kanıtı olmayan özne için dürüst gerekçe. */
  readonly emptyReason: string | null;
}

/**
 * Özne kanıtlarını görünüm modeline çevirir (SALT-OKUNUR).
 *
 * ⚠️ Kanıt YOKSA boş liste değil, GEREKÇE döner: "kanıt yok" bir bilgidir,
 * boş bir kutu değil.
 */
export function buildSubjectEvidenceView(
  rows: readonly SubjectEvidenceRow[] | null | undefined,
): SubjectEvidenceView {
  if (rows === null || rows === undefined || rows.length === 0) {
    return {
      items: [], activeCount: 0, supersededCount: 0, expiredCount: 0,
      emptyReason: 'Bu kayıt için henüz kanıt üretilmedi. '
        + 'Kanıtı olmayan hiçbir iddia açıklanamaz.',
    };
  }

  const items: SubjectEvidenceItem[] = [];
  for (const r of rows) {
    const id = typeof r.evidence_id === 'string' ? r.evidence_id : null;
    const metric = typeof r.metric === 'string' ? r.metric : null;
    if (id === null || metric === null) continue;   // bozuk satır SESSİZCE uydurulmaz
    items.push({
      id, metric,
      source: typeof r.source === 'string' ? r.source : 'SOURCE_UNKNOWN',
      category: typeof r.category === 'string' ? r.category : 'UNKNOWN',
      value: num(r.value),
      provenance: typeof r.provenance === 'string' ? r.provenance : 'UNKNOWN',
      confidence: typeof r.confidence === 'string' ? r.confidence : 'UNKNOWN',
      state: typeof r.state === 'string' ? r.state : 'ACTIVE',
      revision: num(r.subject_revision) ?? 0,
      refreshCount: num(r.refresh_count) ?? 0,
      active: r.state === 'ACTIVE',
    });
  }

  return {
    items,
    activeCount: items.filter((i) => i.active).length,
    supersededCount: items.filter((i) => i.state === 'SUPERSEDED').length,
    expiredCount: items.filter((i) => i.state === 'EXPIRED').length,
    emptyReason: items.length === 0
      ? 'Kanıt satırları okunamadı — sahte veri üretilmedi.' : null,
  };
}
