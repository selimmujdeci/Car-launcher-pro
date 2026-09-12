/**
 * driverScore — sürücü skoru, SAF model (V-16/4).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · React importu YOK.
 *
 * ── TEK OTORİTE ─────────────────────────────────────────────────────────────
 * Skor, ham `driver_dna` satırından DEĞİL, zaten normalize edilmiş
 * `DriverDnaView`den üretilir. Ham satırı ikinci kez yorumlamak, kartla skorun
 * kaçınılmaz olarak ayrışmasına yol açardı (bu depoda defalarca görülen
 * "iki otorite" deseni).
 *
 * ── SKOR ÜRETMEMEK DE BİR SONUÇTUR ──────────────────────────────────────────
 * Enterprise sayfası "Driver scoring" vaat ediyordu. Bir sürücüye 100 üzerinden
 * puan vermek, o puanın **kanıtı** yoksa zarar verir: performans değerlendirmesi,
 * prim, hatta işten çıkarma buna dayanabilir. Bu yüzden model, aşağıdaki
 * durumların HERHANGİ BİRİNDE **skor ÜRETMEZ** ve nedenini söyler:
 *   · DNA henüz oluşmamış           → NO_DNA
 *   · öğrenme eşiği altında          → LEARNING
 *   · puanlanabilir tek bir oran yok → NO_MEASURES
 *   · katkı geri alınmış (retracted) → RETRACTED
 *
 * ── EKSİK BİLEŞEN GİZLENMEZ ────────────────────────────────────────────────
 * Skor YALNIZ elde olan bileşenlerden hesaplanır ve **kaçının eksik olduğu**
 * ayrıca bildirilir. Eksik bileşeni "0" ya da "ortalama" saymak, iki farklı
 * yalan üretirdi: birincisi sürücüyü cezalandırır, ikincisi ödüllendirir.
 */

import type { DriverDnaView, DnaRate } from './driverDnaView';

export type ScoreVerdict = 'OK' | 'NO_DNA' | 'LEARNING' | 'NO_MEASURES' | 'RETRACTED';

export const SCORE_VERDICT_LABEL: Readonly<Record<ScoreVerdict, string>> = {
  OK:           'HESAPLANDI',
  NO_DNA:       'DNA YOK — skor üretilmez',
  LEARNING:     'ÖĞRENME SÜRÜYOR — skor üretilmez',
  NO_MEASURES:  'PUANLANABİLİR ÖLÇÜM YOK — skor üretilmez',
  RETRACTED:    'KATKI GERİ ALINDI — skor üretilmez',
} as const;

/**
 * Bir bileşenin eşikleri: `good` ve altı 100 puan, `bad` ve üstü 0 puan,
 * arası doğrusal.
 *
 * Eşikler **açıkça yazılıdır** ki bir sürücü "neden 62 aldım" diye
 * sorduğunda cevap verilebilsin. Gizli formül, itiraz edilemez bir skor
 * demektir.
 */
export interface ScoreBand {
  readonly label: string;
  readonly good: number;
  readonly bad: number;
  readonly weight: number;
  readonly unit: string;
}

/** Sıra ANLAMLI DEĞİL; ağırlıklar toplamı 1 olmak zorunda DEĞİL (normalize edilir). */
export const SCORE_BANDS: readonly ScoreBand[] = [
  { label: 'Sert fren',      good: 0.5, bad: 8,  weight: 0.35, unit: '/100km' },
  { label: 'Sert hızlanma',  good: 0.5, bad: 8,  weight: 0.35, unit: '/100km' },
  { label: 'Rölanti payı',   good: 0.05, bad: 0.40, weight: 0.30, unit: '' },
];

export interface ScoreComponent {
  readonly label: string;
  /** Ölçülen ham oran. */
  readonly value: number;
  /** 0-100 arası bileşen puanı. */
  readonly points: number;
  readonly weight: number;
  readonly provenance: DnaRate['provenance'];
  readonly sampleCount: number;
}

export interface DriverScore {
  readonly verdict: ScoreVerdict;
  /** 0-100; üretilemediyse `null` — SAHTE 0 YOK. */
  readonly score: number | null;
  readonly components: readonly ScoreComponent[];
  /** Puanlanabilir olduğu hâlde ölçümü OLMAYAN bileşen sayısı. */
  readonly missingComponentCount: number;
  /** Bileşenlerden HERHANGİ BİRİ ölçülmemişse skor türetilmiş sayılır. */
  readonly provenance: 'MEASURED' | 'DERIVED';
  /** Skor güncel davranışı yansıtmayabilir mi (sapma). */
  readonly driftWarning: boolean;
  /** Skorun dayandığı yolculuk sayısı. */
  readonly tripCount: number | null;
}

const EMPTY: Omit<DriverScore, 'verdict'> = {
  score: null, components: [], missingComponentCount: 0,
  provenance: 'DERIVED', driftWarning: false, tripCount: null,
};

/** Ham oranı 0-100 puana çevirir. Aralık dışı değerler KIRPILIR. */
export function bandPoints(band: ScoreBand, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= band.good) return 100;
  if (value >= band.bad) return 0;
  return ((band.bad - value) / (band.bad - band.good)) * 100;
}

/**
 * DNA görünümünden sürücü skoru.
 *
 * @param view `buildDriverDnaView()` çıktısı — ham satır DEĞİL.
 */
export function computeDriverScore(view: DriverDnaView): DriverScore {
  if (!view.present) {
    /* `absentReason` iki farklı gerçeği ayırır: hiç satır yok mu, yoksa
       eşik altında mı. İkisini "skor yok" diye birleştirmek, sürücünün
       hiç sürmediğiyle henüz yeterince sürmediğini aynı şey yapardı. */
    return {
      ...EMPTY,
      verdict: view.absentReason === 'BELOW_THRESHOLD' ? 'LEARNING' : 'NO_DNA',
      tripCount: view.tripCount,
    };
  }

  if (view.retracted) {
    /* Sürücü değişimi nedeniyle katkı geri alınmışsa eldeki birikim o
       sürücüyü tarif etmiyor olabilir. Skor vermek yanlış kişiyi puanlar. */
    return { ...EMPTY, verdict: 'RETRACTED', tripCount: view.tripCount };
  }

  if (view.status === 'FORMING') {
    return { ...EMPTY, verdict: 'LEARNING', tripCount: view.tripCount };
  }

  const byLabel = new Map(view.rates.map((r) => [r.label, r]));
  const components: ScoreComponent[] = [];
  let missing = 0;

  for (const band of SCORE_BANDS) {
    const rate = byLabel.get(band.label);
    if (rate === undefined || rate.value === null || rate.sampleCount <= 0) {
      missing += 1;
      continue;
    }
    components.push({
      label: band.label,
      value: rate.value,
      points: bandPoints(band, rate.value),
      weight: band.weight,
      provenance: rate.provenance,
      sampleCount: rate.sampleCount,
    });
  }

  if (components.length === 0) {
    return {
      ...EMPTY, verdict: 'NO_MEASURES',
      missingComponentCount: missing, tripCount: view.tripCount,
    };
  }

  /* Ağırlıklar YALNIZ elde olan bileşenler üzerinden normalize edilir.
     Eksik bileşeni 0 saymak sürücüyü cezalandırır, ortalama saymak
     ödüllendirir — ikisi de uydurmadır. */
  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score = components.reduce((a, c) => a + c.points * c.weight, 0) / totalWeight;

  return {
    verdict: 'OK',
    score,
    components,
    missingComponentCount: missing,
    provenance: components.every((c) => c.provenance === 'MEASURED') ? 'MEASURED' : 'DERIVED',
    driftWarning: view.driftState === 'DRIFTING',
    tripCount: view.tripCount,
  };
}

/** Skorun nasıl okunması gerektiğini söyleyen cümle. */
export function scoreDisclaimer(s: DriverScore): string {
  switch (s.verdict) {
    case 'NO_DNA':
      return 'Bu sürücü için henüz sürüş birikimi yok. Skor UYDURULMAZ.';
    case 'LEARNING':
      return 'Sürüş birikimi öğrenme eşiğinin altında. Erken verilen bir skor haksız olurdu.';
    case 'NO_MEASURES':
      return 'Yolculuklar var ama puanlanabilir bir ölçüm yok. Skor üretilmez.';
    case 'RETRACTED':
      return 'Sürücü değişimi nedeniyle katkılar geri alındı; eldeki birikim bu sürücüyü tarif etmeyebilir.';
    default: {
      const parts: string[] = [];
      if (s.provenance !== 'MEASURED') {
        parts.push('Bileşenlerin en az biri ölçülmedi; skor TÜRETİLMİŞTİR.');
      }
      if (s.missingComponentCount > 0) {
        parts.push(`${s.missingComponentCount} bileşenin ölçümü yok; skor yalnız elde olanlardan hesaplandı.`);
      }
      if (s.driftWarning) {
        parts.push('Sürüş biçimi son dönemde DEĞİŞİYOR; skor güncel davranışı yansıtmayabilir.');
      }
      parts.push('Eşikler açıktır; skorun gerekçesi bileşen listesinde görülebilir.');
      return parts.join(' ');
    }
  }
}
