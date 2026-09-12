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
import {
  SEARCH_PROVIDER_LABEL,
  SEARCH_VERDICT_LABEL,
  type SearchChainVerdict,
  type SearchProviderId,
} from '../geo/searchChainModel';

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
    /* Konum/şehir kapısı KULLANICIDAN aday GİZLER → etkisi görünür olmalı.
       Hiç çalışmadıysa "0 elendi" değil, ÖLÇÜLMEDİ gösterilir. */
    field('bias', 'Konum/şehir kapısında elenen',
      s.biasDroppedTotal === null ? NA : String(s.biasDroppedTotal),
      s.biasDroppedTotal === null ? 'UNAVAILABLE' : 'OBSERVED', src,
      s.biasDroppedTotal === null
        ? 'kapı hiç çalışmadı (aday yoktu) — sahte 0 gösterilmez'
        : 'yanlış il KANITI olan + gevşetilmiş & çok uzak adaylar'),
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
  /* Overpass KATEGORİ katmanı sağlığı — "pastane / en yakın eczane" cevabını
     üreten katman budur; soğumadaysa kategori sorguları SESSİZCE boş döner ve
     bu, ekranda görünmeden teşhis edilemezdi (gözlemlenebilirlik kuralı). */
  /* `?? null`: model SAF bir okuyucudur ve anlık görüntüyü kendisi kurmaz —
     alan hiç gelmezse "bilinmiyor" (UNAVAILABLE) demelidir, çökmemelidir. */
  const opc = snap.overpassCategory ?? null;
  stageFields.push(field('opc-cooldown', 'Overpass kategori · soğuma',
    opc === null ? NA : (opc.cooldownRemainingMs > 0 ? `${Math.round(opc.cooldownRemainingMs / 1000)} sn` : 'yok'),
    opc === null ? 'UNAVAILABLE' : 'OBSERVED',
    'geo/overpassCategorySearch.readOverpassCategoryStatus',
    'HTTP 429 sonrası ağa çıkılmaz — kategori sorguları bu sürede boş döner'));
  stageFields.push(field('opc-cache', 'Overpass kategori · önbellek/uçuşta',
    opc === null ? NA : `${opc.cachedKeys} / ${opc.inflight}`,
    opc === null ? 'UNAVAILABLE' : 'OBSERVED',
    'geo/overpassCategorySearch.readOverpassCategoryStatus',
    'önbellekteki kategori+hücre anahtarı sayısı / süren istek sayısı'));

  /* P0-NAV-07 — KAPSAM katmanları: uzak hedef adresini çözen çapa ve iki
     yüzeyin paylaştığı ToS sırası. Görünmezse "neden bulamadı" teşhis
     edilemez (gözlemlenebilirlik kuralı). */
  const anchorCount = snap.cityAnchorCount ?? null;
  stageFields.push(field('anchor-count', 'Çözülmüş şehir çapası',
    anchorCount === null ? NA : String(anchorCount),
    anchorCount === null ? 'UNAVAILABLE' : 'OBSERVED',
    'geo/cityAnchor.readCityAnchorCacheSize',
    'sorguda adı geçen ilin merkezi — uzak hedef adresi bu sayede bulunur'));

  const slotMs = snap.nominatimSlotDelayMs ?? null;
  stageFields.push(field('nominatim-slot', 'Nominatim ToS sırası',
    slotMs === null ? NA : `${slotMs} ms`,
    slotMs === null ? 'UNAVAILABLE' : 'OBSERVED',
    'geo/nominatimRateLimit.readNominatimSlotDelayMs',
    'iki arama yüzeyi TEK sayacı paylaşır; sürekli yüksekse birbirini bekletir'));

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

  /* ── 7 · Sağlayıcı sicili (P0-NAV-08) ──────────────────────────────────
   * `stage` yalnız KAZANANI gösterir. Kaybedenler — zaman aşımına uğrayan,
   * hata veren, hiç çağrılmayan — sahada görünmüyordu. Bu kart onları sayar.
   *
   * DÜRÜSTLÜK: hiç denenmemiş sağlayıcı UNAVAILABLE'dır, "0 hata" DEĞİL. */
  const providerFields: InspectorField[] = [];
  const provSrc = 'geo/addressSearchLedger.summarizeAddressSearches';
  for (const id of Object.keys(s.byProvider) as SearchProviderId[]) {
    const r = s.byProvider[id];
    if (r.attempted === 0) continue;
    const parts = [`${r.attempted} deneme`, `${r.hit} sonuç`, `${r.zero} boş`];
    if (r.timeout > 0)    parts.push(`${r.timeout} zaman aşımı`);
    if (r.error > 0)      parts.push(`${r.error} hata`);
    if (r.parseError > 0) parts.push(`${r.parseError} çözümleme hatası`);
    if (r.medianMs !== null) parts.push(`medyan ${r.medianMs} ms`);
    providerFields.push(field(
      `pv-${id}`, SEARCH_PROVIDER_LABEL[id], parts.join(' · '), 'OBSERVED', provSrc,
      r.parseError > 0
        ? 'çözümleme hatası KOD kusurudur — sağlayıcı sözleşmesi değişmiş olabilir'
        : r.timeout > 0
          ? 'zaman aşımı "veri yok" iddiasını ÇÜRÜTÜR — cevap gelmiş olabilirdi'
          : 'ulaşıldı / ulaşılamadı ayrımı bu satırda',
    ));
  }
  if (providerFields.length === 0) {
    providerFields.push(field('pv-none', 'Sağlayıcı denemesi', NA, 'UNAVAILABLE', provSrc,
      'hiçbir kayıt sağlayıcı düzeyi kanıt bildirmedi — sahte 0 gösterilmez'));
  }

  /* ── 8 · Zincir hükmü + tekilleştirme + puan kanıtı ─────────────────────
   * "0 sonuç" tek başına bir teşhis DEĞİLDİR: gerçek veri boşluğu mu,
   * beklemediğimiz bir sağlayıcı mı, yoksa kendi kapılarımız mı eledi? */
  const chainFields: InspectorField[] = [];
  if (s.chainVerdictSampleCount === 0) {
    chainFields.push(field('cv-none', 'Zincir hükmü', NA, 'UNAVAILABLE', provSrc,
      'sağlayıcı denemesi bildiren kayıt yok — hüküm TÜRETİLEMEZ'));
  } else {
    for (const v of Object.keys(s.byChainVerdict) as SearchChainVerdict[]) {
      if (s.byChainVerdict[v] === 0) continue;
      chainFields.push(field(
        `cv-${v}`, SEARCH_VERDICT_LABEL[v], String(s.byChainVerdict[v]),
        v === 'UNKNOWN' ? 'UNAVAILABLE' : 'DERIVED', provSrc,
        `${s.chainVerdictSampleCount} kayıt üzerinden — sağlayıcı olgularından türetildi`,
      ));
    }
  }
  chainFields.push(field('dedupe', 'Tekilleştirmede birleşen aday',
    s.dedupeMergedTotal === null ? NA : String(s.dedupeMergedTotal),
    s.dedupeMergedTotal === null ? 'UNAVAILABLE' : 'OBSERVED', provSrc,
    s.dedupeMergedTotal === null
      ? 'hiçbir kayıt tekilleştirme ölçmedi — sahte 0 gösterilmez'
      : 'çevrimiçi + çevrimdışı aynı yeri verdiğinde tek kayda iner'));

  /* Son kaydın BİRİNCİ sonucunun puan bileşenleri — "neden bu birinci". */
  const lastScored = snap.records.slice().reverse().find((r) => r.topScore !== null) ?? null;
  const ts = lastScored?.topScore ?? null;
  chainFields.push(field('topscore', 'Son aramada 1. sonucun puanı',
    ts === null ? NA
      : `${ts.total} = ad ${ts.name} · kategori ${ts.category} · mesafe ${ts.distance}`
        + ` · bağlam ${ts.context} · katman +${ts.layerBonus}`,
    ts === null ? 'UNAVAILABLE' : 'OBSERVED', provSrc,
    ts === null
      ? 'sıralama koşan kayıt yok (merdiven yüzeyi sıralama YAPMAZ — açık borç)'
      : 'ham bileşenler; ağırlıklar sorgu niyetine göre değişir'));

  return {
    verdict,
    verdictNote,
    cards: [
      { id: 'summary',   title: '1 · Özet',                     fields: summaryFields },
      { id: 'failures',  title: '2 · Sebep Sınıfları',          fields: failureFields },
      { id: 'stages',    title: '3 · Cevaplayan Katman',        fields: stageFields },
      { id: 'surfaces',  title: '4 · Arama Yüzeyleri',          fields: surfaceFields },
      { id: 'timing',    title: '5 · Zamanlama',                fields: timingFields },
      { id: 'gaps',      title: '6 · Eksik Kanıt (borç)',       fields: gapFields },
      { id: 'providers', title: '7 · Sağlayıcı Sicili',         fields: providerFields },
      { id: 'chain',     title: '8 · Zincir Hükmü',             fields: chainFields },
    ],
    recent: snap.records.slice().reverse(),
    nextMeasurement: s.nextMeasurement,
  };
}
