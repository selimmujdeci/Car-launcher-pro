/**
 * enforcementPointsModel.ts — CAROS LAB · Denetim Noktası Verisi SAF model.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Girdi yalnız `EnforcementPointsRawSnapshot`; çıktı kart/alan listesi ve hüküm.
 *
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR
 * (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem KURULMAZ.
 *
 * Bu ekranın cevaplaması gereken TEK soru: **"denetim noktası uyarısı neden
 * çıkıyor ya da neden çıkmıyor?"** Cevabı sayı olarak veremiyorsa ekran işe
 * yaramaz. Bu yüzden düşülen her kapı ayrı sayaç olarak gösterilir.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { EnforcementPointsRawSnapshot } from './enforcementPointsSources';

export type EnforcementCardId = 'package' | 'quality' | 'policy' | 'gates' | 'activity';

export interface EnforcementCard {
  readonly id:      EnforcementCardId;
  readonly title:   string;
  readonly fields:  readonly InspectorField[];
}

export const ENFORCEMENT_CARD_TITLE: Readonly<Record<EnforcementCardId, string>> = {
  package:  '1 · Paket Kimliği · Tazelik',
  quality:  '2 · Veri Kalitesi (kaynağın söyleMEdikleri)',
  policy:   '3 · Uyarı Politikası (eşikler)',
  gates:    '4 · Kapı Sayaçları — uyarı NEDEN çıkmıyor',
  activity: '5 · Canlılık',
};

/**
 * Ekranın tek cümlelik hükmü — FAIL-CLOSED.
 *
 *  · `NO_PACKAGE`      — paket yüklenmedi/bozuk → uyarı ÜRETİLEMEZ (denetim
 *                        yok DEĞİL, BİLİNMİYOR).
 *  · `NEVER_QUERIED`   — paket hazır ama Guardian bu kaynağı hiç okumadı.
 *  · `POSITION_BLIND`  — okumaların çoğu konum belirsizliği kapısında düşüyor
 *                        (#508'in doğrudan izi).
 *  · `HEADING_BLIND`   — okumaların çoğu yön kapısında düşüyor (durağan/yavaş).
 *  · `NO_POINTS_NEAR`  — kapılar geçiliyor ama yakında nokta yok (normal).
 *  · `EMITTING`        — en az bir dilim üretildi.
 */
export type EnforcementVerdict =
  | 'NO_PACKAGE' | 'NEVER_QUERIED' | 'POSITION_BLIND' | 'HEADING_BLIND'
  | 'NO_POINTS_NEAR' | 'EMITTING';

export const ENFORCEMENT_VERDICT_LABEL: Readonly<Record<EnforcementVerdict, string>> = {
  NO_PACKAGE:     'PAKET YOK — uyarı üretilemez (bu "denetim yok" DEMEK DEĞİLDİR)',
  NEVER_QUERIED:  'PAKET HAZIR — ama Guardian bu kaynağı hiç okumadı',
  POSITION_BLIND: 'KONUM BELİRSİZ — okumalar konum kapısında düşüyor (#508)',
  HEADING_BLIND:  'YÖN YOK — okumalar yön kapısında düşüyor (durağan/yavaş araç)',
  NO_POINTS_NEAR: 'KAPILAR GEÇİLİYOR — yarıçapta ileride nokta yok',
  EMITTING:       'DİLİM ÜRETİLİYOR — kural besleniyor',
};

export interface EnforcementVerdictResult {
  readonly status:   EnforcementVerdict;
  readonly reasons:  readonly string[];
}

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function pct(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `%${((100 * part) / whole).toFixed(0)}`;
}

function meters(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return `${Math.round(v)} m`;
}

/** Sayaç alanı: 0 da anlamlıdır (ölçüldü), bu yüzden UNAVAILABLE'a düşmez. */
function counter(
  id: string, label: string, note: string, at: number, value: number, whole: number,
): InspectorField {
  const share = pct(value, whole);
  return observed(
    { id, label, source: 'enforcementMapSource', note, updatedAt: at },
    share === null ? String(value) : `${value} (${share})`,
  );
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export function deriveEnforcementVerdict(
  snap: EnforcementPointsRawSnapshot,
): EnforcementVerdictResult {
  const s = snap.status;
  const g = snap.gates;
  const reasons: string[] = [];

  if (s.loadState !== 'READY') {
    reasons.push(
      s.loadState === 'FAILED'
        ? `Paket yüklenemedi — sınıf: ${s.failureKind ?? 'BİLİNMİYOR'}.`
        : `Paket durumu: ${s.loadState} — henüz kullanılabilir değil.`,
    );
    reasons.push('Nokta listesi BOŞ olduğu için değil, OKUNAMADIĞI için uyarı yok. Bu ikisi aynı şey değildir.');
    return { status: 'NO_PACKAGE', reasons };
  }

  reasons.push(`Paket hazır: ${s.pointCount ?? 0} nokta · ${s.queryablePointCount ?? 0} tanesi sorguya giriyor.`);

  if (g.readCount === 0) {
    reasons.push('Guardian bu kaynağı hiç okumadı — map yuvası bağlı mı, tick koşuyor mu kontrol edilmeli.');
    return { status: 'NEVER_QUERIED', reasons };
  }

  if (g.emittedCount > 0) {
    reasons.push(`${g.emittedCount}/${g.readCount} okuma dilim üretti.`);
    return { status: 'EMITTING', reasons };
  }

  const half = g.readCount / 2;
  if (g.uncertainPosition > half) {
    reasons.push(
      `${g.uncertainPosition}/${g.readCount} okuma konum belirsizliği kapısında düştü ` +
      `(tavan ${snap.maxUncertaintyM} m). Bu, bayat GPS fix'inin (#508) doğrudan sonucudur — ` +
      'kusur burada değil, konum tazeliğindedir.',
    );
    return { status: 'POSITION_BLIND', reasons };
  }

  if (g.headingUnavailable > half) {
    reasons.push(
      `${g.headingUnavailable}/${g.readCount} okuma yön kapısında düştü ` +
      `(en düşük güvenilir hız ${snap.minHeadingSpeedMps} m/s). Durağan araçta beklenen davranıştır.`,
    );
    return { status: 'HEADING_BLIND', reasons };
  }

  reasons.push(`${g.noPointAhead}/${g.readCount} okumada ${snap.radiusM} m yarıçapta ileride nokta bulunamadı.`);
  return { status: 'NO_POINTS_NEAR', reasons };
}

/* ── Kartlar ─────────────────────────────────────────────────────────────── */

export function buildEnforcementCards(
  snap: EnforcementPointsRawSnapshot,
): readonly EnforcementCard[] {
  const s  = snap.status;
  const g  = snap.gates;
  const at = snap.readAt;
  const tc = s.typeCounts;
  const total = s.pointCount ?? 0;

  const pkg: InspectorField[] = [
    observed({
      id: 'load-state', label: 'Yükleme durumu', source: 'enforcementPointsSource',
      note: 'IDLE: hiç denenmedi · LOADING: sürüyor · READY: doğrulandı · FAILED: reddedildi. "Denendi" ile "başarılı" AYRI alanlardır.',
      updatedAt: at,
    }, s.loadState),
    s.failureKind === null
      ? unavailable({
          id: 'failure', label: 'Düşme sınıfı', source: 'enforcementPointsSource',
          note: 'Yükleme düşmedi — gösterilecek hata sınıfı yok.',
        })
      : observed({
          id: 'failure', label: 'Düşme sınıfı', source: 'enforcementPointsSource',
          note: 'Hata MESAJI değil yalnız SINIFI taşınır. NO_VALID_POINTS: paket sıfır geçerli nokta taşıyor — bilinçli olarak REDDEDİLİR, çünkü boş liste sessizce "denetim yok" anlamına gelirdi.',
          updatedAt: at,
        }, s.failureKind),
    observed({
      id: 'source-id', label: 'Kaynak', source: 'paket',
      note: 'Atıf zinciri (karar K6): denetim noktası verisi EGM kamuya açık EDS haritasından üretilmiştir. Cihaz EGM\'ye GİTMEZ — paket geliştirici tarafında üretilip gömülür (K5).',
      updatedAt: at,
    }, s.sourceId),
    observed({
      id: 'schema', label: 'Şema sürümü', source: 'paket',
      note: 'Farklı sürüm → paket tamamen REDDEDİLİR (kısmi okuma yapılmaz).',
      updatedAt: at,
    }, s.schemaVersion),
    observed({
      id: 'fetched-at', label: 'Paket üretim anı', source: 'paket',
      note: 'Paketin EGM\'den çekildiği an — cihazın "şimdi"si DEĞİL. Tazeleme politikası HENÜZ KARARLAŞTIRILMADI (ADR §6-D.3): paket bugün STATİKTİR ve yalnız uygulama güncellemesiyle yenilenir.',
      updatedAt: at,
    }, s.fetchedAt),
    observed({
      id: 'package-url', label: 'Paket yolu', source: 'enforcementPointsSource',
      note: 'Uygulamaya gömülü dosya. Çalışma anında ağ isteği YAPILMAZ.',
      updatedAt: at,
    }, snap.packageUrl),
    s.loadDurationMs === null
      ? unavailable({
          id: 'load-ms', label: 'Yükleme süresi', source: 'enforcementPointsSource',
          note: 'Yükleme tamamlanmadı.',
        })
      : observed({
          id: 'load-ms', label: 'Yükleme süresi', source: 'enforcementPointsSource',
          note: 'Ayrıştırma + indeksleme dâhil, bir kerelik maliyet (tik gövdesinde DEĞİL).',
          updatedAt: at,
        }, `${s.loadDurationMs} ms`),
  ];

  const quality: InspectorField[] = [
    observed({
      id: 'count', label: 'Paketteki nokta', source: 'paket',
      note: 'BEYAN edilen değil, ayrıştırmada SAYILAN değer.',
      updatedAt: at,
    }, s.pointCount),
    observed({
      id: 'queryable', label: 'Sorguya giren nokta', source: 'enforcementPointsSource',
      note: 'Park ihlali noktaları seyir hâlinde risk DEĞİLDİR → yakınlık sorgusunun dışında tutulur. Paketten SİLİNMEZ; fark burada görünür kalsın diye ayrı gösterilir.',
      updatedAt: at,
    }, s.queryablePointCount),
    observed({
      id: 'dropped', label: 'Ayrıştırmada elenen', source: 'enforcementPointsSource',
      note: 'Bozuk/aralık dışı koordinat taşıyan kayıtlar. Sessizce 0\'a düşürülmez, ELENİR ve SAYILIR.',
      updatedAt: at,
    }, s.droppedPointCount === null ? null : String(s.droppedPointCount)),
    tc === null
      ? unavailable({
          id: 'type-unknown', label: 'Türü BİLİNMEYEN', source: 'paket',
          note: 'Paket hazır değil.',
        })
      : derived({
          id: 'type-unknown', label: 'Türü BİLİNMEYEN', source: 'paket',
          note: 'EGM tür alanı YAYINLAMAZ; tür yalnız serbest metinden çıkarılır. Bu yüzden ürün dili "radar" DEMEZ, "denetim noktası" der (karar K3). Türü bilinmeyen kayıtlar ELENMEZ — varlıkları gözlemdir, yalnız türleri belirsizdir.',
          updatedAt: at,
        }, `${tc.UNKNOWN ?? 0} (${pct(tc.UNKNOWN ?? 0, total) ?? '—'})`),
    tc === null
      ? unavailable({ id: 'type-avg', label: 'Ortalama hız koridoru', source: 'paket', note: 'Paket hazır değil.' })
      : derived({
          id: 'type-avg', label: 'Ortalama hız koridoru', source: 'paket',
          note: 'Metinde "OHTS" geçen kayıtlardan ÇIKARILDI (DERIVED, gözlem değil).',
          updatedAt: at,
        }, String(tc.AVERAGE_SPEED ?? 0)),
    tc === null
      ? unavailable({ id: 'type-red', label: 'Kırmızı ışık', source: 'paket', note: 'Paket hazır değil.' })
      : derived({
          id: 'type-red', label: 'Kırmızı ışık', source: 'paket',
          note: 'Metinden ÇIKARILDI (DERIVED).', updatedAt: at,
        }, String(tc.RED_LIGHT ?? 0)),
    tc === null
      ? unavailable({ id: 'type-park', label: 'Park ihlali', source: 'paket', note: 'Paket hazır değil.' })
      : derived({
          id: 'type-park', label: 'Park ihlali', source: 'paket',
          note: 'Sorgu dışı bırakılır — seyir hâlinde sürücü riski değildir.',
          updatedAt: at,
        }, String(tc.PARKING ?? 0)),
    observed({
      id: 'speed-limit', label: 'Hız limiti taşıyan kayıt', source: 'paket',
      note: 'Kaynakta hız limiti HİÇ YOKTUR. Bu yüzden uyarı hız eşiği İDDİA ETMEZ (karar K4); limit gerekiyorsa yolun KENDİ limitinden gelir. Sahte 0 değil, YAPISAL 0.',
      updatedAt: at,
    }, '0'),
  ];

  const policy: InspectorField[] = [
    observed({
      id: 'radius', label: 'Uyarı yarıçapı', source: 'guardianEnforcementPolicy',
      note: '90 km/h\'te ≈ 28 s önceden haber. Daha uzunu şehir içinde alakasız noktaları toplar, daha kısası otoyolda geç kalır.',
      updatedAt: at,
    }, `${snap.radiusM} m`),
    observed({
      id: 'max-uncertainty', label: 'Konum belirsizliği tavanı', source: 'guardianEnforcementPolicy',
      note: 'belirsizlik = fix doğruluğu + hız × fix yaşı. Kapı YAŞA değil BELİRSİZLİĞE kurulur: 94 km/h\'te 19,5 s bayat fix ≈ 509 m hata demektir ve bu, 700 m yarıçapta uyarıyı noktanın ÜSTÜNDE çaldırırdı.',
      updatedAt: at,
    }, `${snap.maxUncertaintyM} m`),
    observed({
      id: 'ahead-angle', label: '"İleride" koni yarı açısı', source: 'guardianEnforcementPolicy',
      note: 'Noktanın kerterizi araç yönünden bu açıdan fazla saparsa nokta ARKADA sayılır. Paketin yön ipuçları serbest metindir ve dereceye ÇEVRİLMEZ — elimizdeki tek gerçek yön aracın gidiş yönüdür.',
      updatedAt: at,
    }, `±${snap.aheadHalfAngleDeg}°`),
    observed({
      id: 'min-heading-speed', label: 'Yönün güvenilir sayıldığı en düşük hız', source: 'guardianEnforcementPolicy',
      note: 'Altında GPS heading gürültüdür (durağan araçta rastgele döner) → uyarı verilmez (fail-closed).',
      updatedAt: at,
    }, `${snap.minHeadingSpeedMps} m/s`),
    observed({
      id: 'max-fix-age', label: 'Fix yaşı mutlak tavanı', source: 'guardianEnforcementPolicy',
      note: 'Durağan araçta belirsizlik büyümez ama fix ölmüş olabilir; bu tavan o boşluğu kapatır.',
      updatedAt: at,
    }, `${snap.maxFixAgeMs} ms`),
    observed({
      id: 'min-confidence', label: 'Minimum güven', source: 'guardianEnforcementPolicy',
      note: 'Güven konum belirsizliğinden TÜRETİLİR (noktanın varlığı yetkili kaynaktan gelir; belirsiz olan bizim nerede olduğumuzdur).',
      updatedAt: at,
    }, String(snap.minConfidence)),
    observed({
      id: 'severity-unspecified', label: 'Türü belirsiz nokta severity', source: 'guardianEnforcementPolicy',
      note: 'Bilinçli olarak DÜŞÜK: varlığı gözlendi ama ne olduğu bilinmiyor. Bilinmeyen bir şeye yüksek ağırlık atfetmek olurdu.',
      updatedAt: at,
    }, snap.severityUnspecified),
  ];

  const reads = g.readCount;
  const gates: InspectorField[] = [
    observed({
      id: 'read-count', label: 'Kaynak okuma sayısı', source: 'enforcementMapSource',
      note: 'Guardian tik başına bir okuma. 0 ise map yuvası bağlanmamış ya da tick koşmuyor demektir.',
      updatedAt: at,
    }, String(reads)),
    counter('gate-package', 'Düştü: paket hazır değil',
      'Paket henüz yüklenmedi ya da reddedildi. Bu "denetim yok" DEĞİL, "bilinmiyor" demektir.', at, g.packageNotReady, reads),
    counter('gate-location', 'Düştü: konum yok/bozuk',
      'Snapshot yok ya da koordinat/doğruluk geçersiz.', at, g.noLocation, reads),
    counter('gate-stale', 'Düştü: fix ölü/geçersiz',
      'Fix yaşı negatif (saat sıçraması) ya da mutlak tavanı aştı.', at, g.staleFix, reads),
    counter('gate-speed', 'Düştü: hız okunamadı',
      'Belirsizlik hesabı hızsız yapılamaz — hız TAHMİN EDİLMEZ.', at, g.noSpeed, reads),
    counter('gate-uncertain', 'Düştü: KONUM BELİRSİZ (#508)',
      'Bu sayaç yüksekse kusur bu katmanda DEĞİL, GPS fix tazeliğindedir. Sahada ölçülen fix yaşı p50 19,5 s\'tir; otoyol hızında bu kapı çoğunlukla KAPALI kalır. Sessizce yanlış uyarmaktansa sessiz kalmak tercih edilmiştir.', at, g.uncertainPosition, reads),
    counter('gate-heading', 'Düştü: yön güvenilmez',
      'Araç yavaş/durağan ya da heading yok. Yön bilinmeden "ileride" iddia edilemez.', at, g.headingUnavailable, reads),
    counter('gate-no-point', 'Düştü: yarıçapta ileride nokta yok',
      'Tüm kapılar geçildi ama yakında denetim noktası bulunmadı — NORMAL sonuç.', at, g.noPointAhead, reads),
    observed({
      id: 'last-gate', label: 'Son okumada düşülen kapı', source: 'enforcementMapSource',
      note: 'Boşsa son okuma dilim ÜRETTİ.', updatedAt: at,
    }, g.lastGate === null ? (reads > 0 ? 'YOK — dilim üretildi' : null) : g.lastGate),
  ];

  const activity: InspectorField[] = [
    observed({
      id: 'emitted', label: 'Üretilen dilim', source: 'enforcementMapSource',
      note: 'Kaç okuma speedCamera dilimi üretti — kuralın FİİLEN beslendiğinin kanıtı.',
      updatedAt: at,
    }, String(g.emittedCount)),
    observed({
      id: 'query-count', label: 'Uzamsal sorgu sayısı', source: 'enforcementPointsSource',
      note: 'İndekse yapılan yakınlık sorgusu. Okuma sayısından KÜÇÜKTÜR — önceki kapılarda düşen okumalar sorguya hiç ulaşmaz.',
      updatedAt: at,
    }, String(snap.queryCount)),
    observed({
      id: 'hit-count', label: 'Nokta bulan sorgu', source: 'enforcementPointsSource',
      note: 'Yarıçap + yön kapısını geçen nokta bulunan sorgu sayısı.',
      updatedAt: at,
    }, String(snap.hitCount)),
    g.lastUncertaintyM === null
      ? unavailable({
          id: 'last-uncertainty', label: 'Son ölçülen konum belirsizliği', source: 'enforcementMapSource',
          note: 'Hesaplanamadı (konum/hız/fix yaşı eksik) — sahte 0 üretilmez.',
        })
      : derived({
          id: 'last-uncertainty', label: 'Son ölçülen konum belirsizliği', source: 'enforcementMapSource',
          note: 'doğruluk + hız × fix yaşı. Tavanla karşılaştırıldığında uyarının neden çıkıp çıkmadığı doğrudan görünür.',
          updatedAt: at,
        }, meters(g.lastUncertaintyM)),
    g.lastDistanceM === null
      ? unavailable({
          id: 'last-distance', label: 'Son üretilen dilimin mesafesi', source: 'enforcementMapSource',
          note: 'Henüz dilim üretilmedi.',
        })
      : derived({
          id: 'last-distance', label: 'Son üretilen dilimin mesafesi', source: 'enforcementMapSource',
          note: 'KUŞ UÇUŞU mesafedir, rota boyunca DEĞİL — yol dönüyorsa gerçek sürüş mesafesi daha uzundur.',
          updatedAt: at,
        }, meters(g.lastDistanceM)),
  ];

  return [
    { id: 'package',  title: ENFORCEMENT_CARD_TITLE.package,  fields: pkg },
    { id: 'quality',  title: ENFORCEMENT_CARD_TITLE.quality,  fields: quality },
    { id: 'policy',   title: ENFORCEMENT_CARD_TITLE.policy,   fields: policy },
    { id: 'gates',    title: ENFORCEMENT_CARD_TITLE.gates,    fields: gates },
    { id: 'activity', title: ENFORCEMENT_CARD_TITLE.activity, fields: activity },
  ];
}

/** Sınıf dağılımı — ekran başlığındaki "ÖLÇÜLDÜ/TÜRETİLDİ/KAYNAK YOK" sayacı. */
export function countByEnforcementClass(
  cards: readonly EnforcementCard[],
): Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
