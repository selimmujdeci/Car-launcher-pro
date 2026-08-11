/**
 * addressSearchModel.ts — CAROS LAB · Adres Arama Kanıtı görünüm modeli (SAF).
 *
 * I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 * `sessionInspectorModel` sözleşmesini KULLANIR (OBSERVED · DERIVED ·
 * UNAVAILABLE · STALE) — paralel sistem kurulmaz.
 *
 * DÜRÜSTLÜK: defter boşsa hiçbir oran ÜRETİLMEZ. "Arama yapılmadı" ile
 * "aramalar başarılı" AYNI ŞEY DEĞİLDİR; ilki UNAVAILABLE'dır.
 * Kanıtı eksik sınıf `UNKNOWN` olarak GÖSTERİLİR, gizlenmez.
 */

import type { InspectorField, Observability } from './sessionInspectorModel';
import type { AddressSearchRawSnapshot } from './addressSearchSources';
import {
  ADDRESS_SEARCH_FAILURE_LABEL,
  ADDRESS_SEARCH_GAP_LABEL,
  ADDRESS_SEARCH_OUTCOME_LABEL,
  ADDRESS_SEARCH_STAGE_LABEL,
  ADDRESS_SEARCH_RING,
  type AddressSearchEvidenceGap,
  type AddressSearchFailureClass,
  type AddressSearchRecord,
  type AddressSearchStage,
  type AddressSearchSurface,
} from '../geo/addressSearchLedger';

const NA = '—';

export const ADDRESS_SEARCH_SURFACE_LABEL: Readonly<Record<AddressSearchSurface, string>> = {
  VOICE_ADDRESS:   'Mavi / adres kartı',
  MAP_SEARCH_BAR:  'harita arama çubuğu',
  NEARBY_SHORTCUT: 'yakın POI kestirmesi',
  UNKNOWN:         'bilinmeyen yüzey',
} as const;

export interface AddressSearchCard {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/**
 * Ekranın tepesindeki tek cümlelik hüküm.
 * `NO_DATA` bir arıza değil, dürüst bir "henüz ölçüm yok"tur.
 */
export type AddressSearchVerdict =
  | 'NO_DATA'
  | 'HEALTHY'
  | 'FAILURES_PRESENT'
  | 'DOMINANT_CAUSE'
  | 'EVIDENCE_TOO_THIN'
  | 'UNAVAILABLE';

export const ADDRESS_SEARCH_VERDICT_LABEL: Readonly<Record<AddressSearchVerdict, string>> = {
  NO_DATA:           'HENÜZ ARAMA KAYDI YOK — ÖLÇÜM BEKLENİYOR',
  HEALTHY:           'KARARA BAĞLANAN TÜM ARAMALAR ÇÖZÜLDÜ',
  FAILURES_PRESENT:  'BAŞARISIZLIK VAR — BASKIN SEBEP AYIRT EDİLEMEDİ',
  DOMINANT_CAUSE:    'BASKIN SEBEP BELİRLENDİ',
  EVIDENCE_TOO_THIN: 'KANIT ÇOK ZAYIF — SINIFLAR İDDİA EDİLEMEZ',
  UNAVAILABLE:       'DEFTER OKUNAMADI — DURUM BİLİNMİYOR',
} as const;

/** Sınıfların çoğu `UNKNOWN` ise hüküm verilmez; bu eşik o kararı verir. */
export const ADDRESS_SEARCH_MIN_MEAN_CONFIDENCE = 0.3;

function field(
  id: string, label: string, value: string, klass: Observability,
  source: string, note: string, updatedAt: number | null = null,
): InspectorField {
  return { id, label, value, klass, source, updatedAt, note };
}

function pct(n: number): string {
  return `%${Math.round(n * 100)}`;
}

export interface AddressSearchView {
  readonly verdict: AddressSearchVerdict;
  /** Hükmü tek cümlede açıklayan satır — PII taşımaz. */
  readonly verdictNote: string;
  readonly cards: readonly AddressSearchCard[];
  /** En yeni kayıt önce — LAB listesi için. */
  readonly recent: readonly AddressSearchRecord[];
  /** "Önce bunu ölç" — en çok eksik olan kanıt. */
  readonly nextMeasurement: AddressSearchEvidenceGap | null;
}

/** Kayıt satırının insan-okur özeti. Adres metni İÇERMEZ (yalnız biçim). */
export function describeRecord(rec: AddressSearchRecord): string {
  const s = rec.shape;
  const flags: string[] = [];
  if (s.hasNumberedStreet)   flags.push('numaralı yol');
  if (s.hasSuffixedRoadType) flags.push('ekli tip');
  if (s.hasAbbrev)           flags.push('kısaltma');
  if (s.hasHouseNumber)      flags.push('kapı no');
  if (s.hasMahalle)          flags.push('mahalle');
  if (s.hasDottedCapitalI)   flags.push('İ harfi');
  if (s.roadTypeWord !== 'NONE') flags.push(s.roadTypeWord.toLowerCase());
  const shape = `${s.tokenCount} sözcük${flags.length ? ' · ' + flags.join(' · ') : ''}`;
  return `${ADDRESS_SEARCH_SURFACE_LABEL[rec.surface]} · ${shape} → `
       + `${rec.resultCount} sonuç · ${ADDRESS_SEARCH_OUTCOME_LABEL[rec.outcome]}`;
}

export function buildAddressSearchView(snap: AddressSearchRawSnapshot): AddressSearchView {
  const src = 'geo/addressSearchLedgerStore';

  if (!snap.ledgerReadable || snap.summary === null) {
    return {
      verdict: 'UNAVAILABLE',
      verdictNote: 'Defter okunamadı; hiçbir alan yorumlanamaz.',
      cards: [{
        id: 'summary',
        title: '1 · Özet',
        fields: [field('read', 'Defter', NA, 'UNAVAILABLE', src,
          'okuma başarısız — sahte 0 gösterilmez')],
      }],
      recent: [],
      nextMeasurement: null,
    };
  }

  const s = snap.summary;
  const decided = s.resolvedCount + s.failedCount;

  /* ── Hüküm ─────────────────────────────────────────────────────────────── */
  let verdict: AddressSearchVerdict;
  let verdictNote: string;
  if (s.total === 0) {
    verdict = 'NO_DATA';
    verdictNote = 'Bu oturumda hiç arama yapılmadı. Oran üretilmez — '
                + '"kayıt yok" ile "hepsi başarılı" aynı şey değildir.';
  } else if (decided === 0) {
    verdict = 'NO_DATA';
    verdictNote = `${s.total} deneme var ama hiçbiri karara bağlanmadı `
                + `(${s.awaitingChoiceCount} seçim bekliyor, ${s.supersededCount} yargılanmadı).`;
  } else if (s.meanConfidence !== null && s.meanConfidence < ADDRESS_SEARCH_MIN_MEAN_CONFIDENCE) {
    verdict = 'EVIDENCE_TOO_THIN';
    verdictNote = `Ortalama kanıt sağlamlığı ${s.meanConfidence} — sınıflar `
                + 'iddia edilemez. Eksik kanıt kapatılmadan kök neden aranmaz.';
  } else if (s.failedCount === 0) {
    verdict = 'HEALTHY';
    verdictNote = `${decided} karara bağlanmış denemenin tamamı çözüldü.`;
  } else if (s.dominantFailure !== null) {
    verdict = 'DOMINANT_CAUSE';
    verdictNote = `${s.failedCount}/${decided} başarısız · baskın sebep: `
                + `${ADDRESS_SEARCH_FAILURE_LABEL[s.dominantFailure]}.`;
  } else {
    verdict = 'FAILURES_PRESENT';
    verdictNote = `${s.failedCount}/${decided} başarısız ama hiçbir sebep sınıfı `
                + 'açık farkla önde değil — tek bir kök neden İDDİA EDİLEMEZ.';
  }

  /* ── 1 · Özet ──────────────────────────────────────────────────────────── */
  const summaryFields: InspectorField[] = [
    field('total', 'Deneme (halka üst sınırı ' + ADDRESS_SEARCH_RING + ')',
      String(s.total), s.total > 0 ? 'OBSERVED' : 'UNAVAILABLE', src,
      'yalnız bu oturum — defter diske YAZILMAZ (gizlilik)'),
    field('resolved', 'Çözülen', String(s.resolvedCount),
      s.total > 0 ? 'OBSERVED' : 'UNAVAILABLE', src,
      'doğrudan rota + kullanıcının listeden seçtikleri'),
    field('failed', 'Başarısız', String(s.failedCount),
      s.total > 0 ? 'OBSERVED' : 'UNAVAILABLE', src,
      '0 sonuç · seçilmeden kapatıldı · servis hatası'),
    field('rate', 'Başarısızlık oranı',
      s.failureRate === null ? NA : pct(s.failureRate),
      s.failureRate === null ? 'UNAVAILABLE' : 'DERIVED', src,
      s.failureRate === null
        ? 'karara bağlanmış deneme yok → oran ÜRETİLMEZ'
        : 'yalnız karara bağlanmış denemeler üzerinden'),
    field('awaiting', 'Seçim bekleyen', String(s.awaitingChoiceCount),
      'OBSERVED', src, 'liste sunuldu, kullanıcı henüz dokunmadı — orana GİRMEZ'),
    field('superseded', 'Yargılanmayan', String(s.supersededCount),
      'OBSERVED', src, 'kullanıcı yazmaya devam etti (debounce) — orana GİRMEZ'),
    field('confidence', 'Ortalama kanıt sağlamlığı',
      s.meanConfidence === null ? NA : String(s.meanConfidence),
      s.meanConfidence === null ? 'UNAVAILABLE' : 'DERIVED', src,
      '1.0 = sınıf tam kanıtlı · 0 = sınıf iddia edilmiyor'),
  ];

  /* ── 2 · Sebep sınıfları ───────────────────────────────────────────────── */
  const failureFields: InspectorField[] = (Object.keys(s.byFailureClass) as AddressSearchFailureClass[])
    .filter((k) => s.byFailureClass[k] > 0)
    .sort((a, b) => s.byFailureClass[b] - s.byFailureClass[a])
    .map((k) => field(
      `fc-${k}`, ADDRESS_SEARCH_FAILURE_LABEL[k], String(s.byFailureClass[k]),
      k === 'UNKNOWN' ? 'UNAVAILABLE' : 'DERIVED', src,
      k === 'UNKNOWN'
        ? 'kanıt yetersiz — bu kayıtlar kök neden sayımına GİRMEZ'
        : 'kopma anındaki kanıttan sınıflandırıldı',
    ));
  if (failureFields.length === 0) {
    failureFields.push(field('fc-none', 'Sınıf', NA, 'UNAVAILABLE', src,
      'kayıt yok — sınıf dağılımı üretilmez'));
  }

  /* ── 3 · Cevaplayan katman ─────────────────────────────────────────────── */
  const stageFields: InspectorField[] = (Object.keys(s.byStage) as AddressSearchStage[])
    .filter((k) => s.byStage[k] > 0)
    .sort((a, b) => s.byStage[b] - s.byStage[a])
    .map((k) => field(
      `st-${k}`, ADDRESS_SEARCH_STAGE_LABEL[k], String(s.byStage[k]),
      'OBSERVED', src, 'cevabı gerçekten ÜRETEN katman'),
    );
  if (stageFields.length === 0) {
    stageFields.push(field('st-none', 'Katman', NA, 'UNAVAILABLE', src, 'kayıt yok'));
  }
  stageFields.push(field('provider', 'BYOK premium sağlayıcı',
    snap.providerName === null
      ? NA
      : `${snap.providerName}${snap.providerHasKey === true ? ' · anahtar VAR' : ' · anahtar YOK'}`,
    snap.providerName === null ? 'UNAVAILABLE' : 'OBSERVED',
    'geocodingProviders.getGeocodeProviderStatus',
    'yalnız ad + anahtar VAR/YOK — anahtar değeri ASLA okunmaz'));

  /* ── 4 · Yüzeyler (iki yüzey ayrışması) ────────────────────────────────── */
  const surfaceFields: InspectorField[] = (Object.keys(s.bySurface) as AddressSearchSurface[])
    .filter((k) => s.bySurface[k] > 0)
    .map((k) => field(
      `sf-${k}`, ADDRESS_SEARCH_SURFACE_LABEL[k], String(s.bySurface[k]),
      'OBSERVED', src,
      'aynı sorgu iki yüzeyde FARKLI sonuç verebilir — ayrışma burada görünür'),
    );
  if (surfaceFields.length === 0) {
    surfaceFields.push(field('sf-none', 'Yüzey', NA, 'UNAVAILABLE', src, 'kayıt yok'));
  }

  /* ── 5 · Zamanlama ─────────────────────────────────────────────────────── */
  const timingFields: InspectorField[] = [
    field('median', 'Sağlayıcı gecikmesi (medyan)',
      s.medianProviderMs === null ? NA : `${s.medianProviderMs} ms`,
      s.medianProviderMs === null ? 'UNAVAILABLE' : 'OBSERVED', src,
      s.medianProviderMs === null ? 'hiçbir denemede gecikme ölçülmedi' : 'rate-limit beklemesi DAHİL'),
    field('slow', 'Fast-fail eşiğini aşan', String(s.slowCount),
      'DERIVED', src, '2 s üstü — doğru cevap gelse bile kullanılmamış olabilir'),
  ];

  /* ── 6 · Eksik kanıt (sonraki turun iş listesi) ────────────────────────── */
  const gapFields: InspectorField[] = (Object.keys(s.evidenceGapCounts) as AddressSearchEvidenceGap[])
    .filter((k) => s.evidenceGapCounts[k] > 0)
    .sort((a, b) => s.evidenceGapCounts[b] - s.evidenceGapCounts[a])
    .map((k) => field(
      `gap-${k}`, ADDRESS_SEARCH_GAP_LABEL[k], String(s.evidenceGapCounts[k]),
      'UNAVAILABLE', src, 'ölçülmeyen kanıt — bu sayı bir borçtur, arıza değil'),
    );
  if (gapFields.length === 0) {
    gapFields.push(field('gap-none', 'Eksik kanıt', '0',
      s.total > 0 ? 'OBSERVED' : 'UNAVAILABLE', src,
      s.total > 0 ? 'tüm kayıtlarda kanıt tamdı' : 'kayıt yok'));
  }
  gapFields.push(field('next', 'ÖNCE BUNU ÖLÇ',
    s.nextMeasurement === null ? NA : ADDRESS_SEARCH_GAP_LABEL[s.nextMeasurement],
    s.nextMeasurement === null ? 'UNAVAILABLE' : 'DERIVED', src,
    'en çok eksik olan kanıt — enstrümantasyonun sonraki adımı'));

  return {
    verdict,
    verdictNote,
    cards: [
      { id: 'summary',  title: '1 · Özet',                     fields: summaryFields },
      { id: 'failures', title: '2 · Sebep Sınıfları',          fields: failureFields },
      { id: 'stages',   title: '3 · Cevaplayan Katman',        fields: stageFields },
      { id: 'surfaces', title: '4 · Arama Yüzeyleri',          fields: surfaceFields },
      { id: 'timing',   title: '5 · Zamanlama',                fields: timingFields },
      { id: 'gaps',     title: '6 · Eksik Kanıt (borç)',       fields: gapFields },
    ],
    recent: snap.records.slice().reverse(),
    nextMeasurement: s.nextMeasurement,
  };
}
