/**
 * fleetReportPdf — filo raporunun PDF gövdesi (V-16/1).
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React importu YOK.
 * Zaman damgası ÇAĞIRAN tarafından verilir (`generatedAtLabel`).
 *
 * ── TEK OTORİTE ─────────────────────────────────────────────────────────────
 * PDF, ekranın ve CSV'nin kullandığı AYNI sayılardan üretilir; burada hiçbir
 * metrik YENİDEN HESAPLANMAZ. Ayrı bir hesap ikinci otorite olurdu ve PDF ile
 * ekran kaçınılmaz olarak ayrışırdı.
 *
 * ── SAHTE VERİ YASAĞI ───────────────────────────────────────────────────────
 * Bilinmeyen alan `—` yazılır, **0 YAZILMAZ**. Zaman serisi bir ÖLÇÜM DEĞİL
 * TÜRETİMDİR (geçmiş sağlık durumu saklanmıyor) — bu, raporda AÇIKÇA yazar.
 * Rapor "o gün kaç araç kritikti" İDDİA ETMEZ.
 */

import { buildPdf, type PdfBlock, type PdfBuildResult, type PdfCell } from './pdfWriter';

export interface FleetTallyInput {
  readonly total: number;
  readonly critical: number;
  readonly warning: number;
  readonly verified: number;
  readonly noEvidence: number;
}

export interface DayRowInput {
  readonly key: string;
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

export interface VehicleRowInput {
  readonly title: string;
  readonly verdict: string;
  /** Ölçülmediyse `null` — rapora `—` yazılır, 0 DEĞİL. */
  readonly batteryVolt: number | null;
  readonly lastSeenLabel: string | null;
  readonly evidence: string | null;
}

export interface FleetReportInput {
  readonly generatedAtLabel: string;
  readonly windowDays: number;
  readonly tally: FleetTallyInput;
  readonly days: readonly DayRowInput[];
  readonly vehicles: readonly VehicleRowInput[];
  /** Günlük okunamadıysa `true` — rapor bunu SAKLAMAZ. */
  readonly logUnreadable: boolean;
}

/** Bilinmeyen değer gösterimi — sahte `0` YASAK. */
const DASH = '—';

function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return digits > 0 ? v.toFixed(digits).replace('.', ',') : String(v);
}

export function buildFleetReportBlocks(input: FleetReportInput): readonly PdfBlock[] {
  const t = input.tally;
  const blocks: PdfBlock[] = [
    { kind: 'title', text: 'CarOS Pro — Filo Raporu' },
    { kind: 'text', text: `Oluşturma: ${input.generatedAtLabel}` },
    { kind: 'spacer', height: 8 },

    { kind: 'heading', text: 'Filo sağlık dağılımı' },
    {
      kind: 'note',
      text: 'ÖLÇÜM · şu anki hüküm, araçlardan okunan telemetriden türetildi.',
    },
    {
      kind: 'table',
      headers: ['Toplam araç', 'Kritik', 'Uyarı', 'Kanıtlı sağlıklı', 'Kanıt bekliyor'],
      widths: [104, 100, 100, 110, 101],
      rows: [[
        { text: num(t.total), align: 'right' },
        { text: num(t.critical), align: 'right' },
        { text: num(t.warning), align: 'right' },
        { text: num(t.verified), align: 'right' },
        { text: num(t.noEvidence), align: 'right' },
      ]],
    },
    { kind: 'spacer', height: 10 },

    { kind: 'heading', text: `Son ${input.windowDays} gün — olay yoğunluğu` },
  ];

  /* Dürüstlük cümlesi ekrandakiyle AYNI: türetimi ölçüm gibi sunmak yasak. */
  blocks.push({
    kind: 'note',
    text: 'TÜRETİLDİ · olay ve bildirim günlüğünden. Geçmiş sağlık durumu SAKLANMIYOR; '
        + 'bu tablo "o gün kaç araç kritikti" İDDİA ETMEZ.',
  });

  if (input.logUnreadable) {
    blocks.push({
      kind: 'text',
      text: 'Olay günlüğü OKUNAMADI — bu bölüm boş DEĞİL, BİLİNMİYOR. "Olay yok" ile karıştırılmamalıdır.',
    });
  } else if (input.days.length === 0) {
    blocks.push({ kind: 'text', text: 'Bu pencerede kayıtlı olay yok (ölçülmüş bir YOK).' });
  } else {
    blocks.push({
      kind: 'table',
      headers: ['Gün', 'Kritik', 'Uyarı', 'Bilgi'],
      widths: [160, 118, 118, 119],
      rows: input.days.map((d): readonly PdfCell[] => [
        { text: d.key },
        { text: num(d.critical), align: 'right' },
        { text: num(d.warning), align: 'right' },
        { text: num(d.info), align: 'right' },
      ]),
    });
  }

  blocks.push({ kind: 'spacer', height: 10 });
  blocks.push({ kind: 'heading', text: 'Araç bazlı hüküm' });

  if (input.vehicles.length === 0) {
    blocks.push({ kind: 'text', text: 'Bu hesapta araç yok.' });
  } else {
    blocks.push({
      kind: 'table',
      headers: ['Araç', 'Hüküm', 'Akü (V)', 'Son görülme', 'Kanıt'],
      widths: [130, 86, 60, 90, 149],
      rows: input.vehicles.map((v): readonly PdfCell[] => [
        { text: v.title },
        { text: v.verdict },
        { text: num(v.batteryVolt, 1), align: 'right' },
        { text: v.lastSeenLabel ?? DASH },
        { text: v.evidence ?? DASH },
      ]),
    });
  }

  blocks.push({ kind: 'spacer', height: 12 });
  blocks.push({
    kind: 'note',
    text: 'Boş bırakılan alanlar ÖLÇÜLMEMİŞTİR. Sahte 0 veya sahte tarih yazılmaz.',
  });

  return blocks;
}

export function buildFleetReportPdf(input: FleetReportInput): PdfBuildResult {
  return buildPdf({
    title: 'CarOS Pro — Filo Raporu',
    footer: `CarOS Pro · ${input.generatedAtLabel}`,
    blocks: buildFleetReportBlocks(input),
  });
}

/** Dosya adı — tarih ÇAĞIRANDAN gelir (bu modül saat okumaz). */
export function fleetReportFileName(isoDate: string): string {
  return `filo-raporu-${isoDate.slice(0, 10)}.pdf`;
}
