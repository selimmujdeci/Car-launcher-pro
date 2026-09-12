/**
 * voiceGuidanceModel.ts — kademeli sesli yönlendirme KARARI (SAF).
 *
 * SAF: I/O YOK · TTS YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 *
 * ── NE DEĞİŞTİ, NE DEĞİŞMEDİ ────────────────────────────────────────────────
 * DEĞİŞMEDİ: eşikler ve anons metinleri `NavigationHUD` içindeki hâliyle
 * BİREBİR aynıdır — 600 m / 250 m / hız-uyarlanabilir son kademe
 * (`min(150, max(35, hız_m/s × 4))`), aynı yuvarlama (50 m), aynı cümleler.
 * **Yeni anons algoritması YAZILMADI.**
 *
 * DEĞİŞTİ: kararın SAHİBİ. Eskiden bu mantık bir React bileşeninin
 * `useEffect`'indeydi ve "hangi kademe söylendi" bilgisi bir bileşen ref'iydi
 * (`_spokenRef`). İki somut arıza üretiyordu:
 *   1. `NavigationHUD` yalnız `FullMapView` içinde mount edilir → **tam ekran
 *      kapatılınca sesli yönlendirme tamamen susuyordu.**
 *   2. Görünüm kapanıp açılınca ref sıfırlanıyor → aynı manevra için
 *      **"Şimdi sağa dönün" ikinci kez** seslendiriliyordu.
 *
 * Bu dosya kararı verir; söyleme işini `voiceGuidanceRuntime` yapar.
 */

/** Anons kademesi — uzaktan yakına. */
export type GuidanceStage = 'FAR' | 'NEAR' | 'IMMINENT';

/** Kademe bitleri — tek sayıda saklanır (mevcut `tiers` bitmask'i ile aynı). */
export const STAGE_BIT: Readonly<Record<GuidanceStage, number>> = {
  FAR: 1, NEAR: 2, IMMINENT: 4,
} as const;

export const STAGE_LABEL: Readonly<Record<GuidanceStage, string>> = {
  FAR: 'HAZIRLIK', NEAR: 'YAKLAŞMA', IMMINENT: 'DÖNÜŞ',
} as const;

/** Hazırlık kademesi eşiği (m). */
export const FAR_TIER_M = 600;
/** Yaklaşma kademesi eşiği (m). */
export const NEAR_TIER_M = 250;
/** Son kademe taban/tavan (m) ve hedef süre (sn). */
export const FINAL_TIER_MIN_M = 35;
export const FINAL_TIER_MAX_M = 150;
export const FINAL_TIER_SECONDS = 4;

/**
 * Son uyarı mesafesi — SABİT DEĞİL, HIZA BAĞLIDIR.
 *
 * Saha 2026-08-03: sabit 80 m şehir içinde erken (30 km/sa'te 9,6 sn önce),
 * otoyolda geç (110 km/sa'te yalnız 2,6 sn önce) kalıyordu. Ölçüt mesafe değil
 * ZAMANDIR: manevradan ~4 sn önce. 50 km/sa → 56 m · 100 km/sa → 111 m.
 */
export function finalTierMetres(speedKmh: number): number {
  const v = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : 0;
  return Math.min(FINAL_TIER_MAX_M, Math.max(FINAL_TIER_MIN_M, (v / 3.6) * FINAL_TIER_SECONDS));
}

export interface GuidanceDecisionInput {
  /** Navigasyon ACTIVE/REROUTING mi. */
  readonly navActive: boolean;
  /** Yeniden rota hesaplanıyor mu — manevra anonsu YAPILMAZ. */
  readonly isRerouting: boolean;
  /** Sıradaki manevraya kalan mesafe (m). */
  readonly distanceM: number;
  /** Mesafenin kaynağı — `UNKNOWN` iken KONUŞULMAZ (uydurma yasak). */
  readonly distanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN';
  readonly speedKmh: number;
  /** Manevra talimatı (ör. "Sola dönün"). Boşsa konuşulmaz. */
  readonly instruction: string;
  /** Bu manevra için ŞU ANA KADAR söylenmiş kademelerin bit maskesi. */
  readonly spokenBits: number;
}

export interface GuidanceDecision {
  readonly stage: GuidanceStage;
  /** Söylenecek metin. */
  readonly text: string;
  /** Karardan SONRA maskeye yazılacak bitler. */
  readonly nextBits: number;
}

/**
 * Bir sonraki anonsu seçer; söylenecek bir şey yoksa `null`.
 *
 * FAIL-CLOSED: mesafe kaynağı `UNKNOWN` (araç rota üzerinde konumlandırılamadı)
 * ise **hiçbir şey söylenmez** — "300 metre sonra sağa dönün" demek uydurmaktır.
 *
 * Yakın kademe tetiklenince uzaktakiler de kapatılır: araç manevraya doğrudan
 * yakın mesafede yakalanırsa (ör. süreç yeniden başladı) geçmiş kademeler
 * TEKRAR OYNATILMAZ.
 */
export function decideGuidance(input: GuidanceDecisionInput): GuidanceDecision | null {
  const { navActive, isRerouting, distanceM, distanceSource, speedKmh, instruction, spokenBits } = input;

  if (!navActive || isRerouting) return null;
  if (distanceSource === 'UNKNOWN') return null;
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  const inst = (instruction ?? '').trim();
  if (!inst) return null;

  // Talimatı cümle ortasına uydur: "Sola dönün" → "sola dönün"
  const lower = inst.charAt(0).toLowerCase() + inst.slice(1);
  const rounded = Math.round(distanceM / 50) * 50;

  const finalM = finalTierMetres(speedKmh);
  if (distanceM <= finalM && !(spokenBits & STAGE_BIT.IMMINENT)) {
    return {
      stage: 'IMMINENT',
      text: `Şimdi ${lower}`,
      nextBits: spokenBits | STAGE_BIT.IMMINENT | STAGE_BIT.NEAR | STAGE_BIT.FAR,
    };
  }
  if (distanceM <= NEAR_TIER_M && !(spokenBits & STAGE_BIT.NEAR)) {
    return {
      stage: 'NEAR',
      text: `${rounded} metre sonra ${lower}`,
      nextBits: spokenBits | STAGE_BIT.NEAR | STAGE_BIT.FAR,
    };
  }
  if (distanceM <= FAR_TIER_M && !(spokenBits & STAGE_BIT.FAR)) {
    return {
      stage: 'FAR',
      text: `${rounded} metre sonra ${lower}`,
      nextBits: spokenBits | STAGE_BIT.FAR,
    };
  }
  return null;
}

/**
 * Manevranın KANONİK kimliği.
 *
 * Üç alan birden gerekir: oturum (yeni hedef), rota revizyonu (reroute) ve adım
 * indeksi. Yalnız adım indeksi kullanmak reroute sonrası indeks 0'a döndüğünde
 * "zaten söylendi" yanlışını üretirdi — bu, eski kodda gerçekten yaşanmış bir
 * kusurdur (yeni rotanın ilk manevrası hiç seslendirilmiyordu).
 */
export function maneuverId(sessionId: number, routeRevision: number, stepIndex: number): string {
  return `${sessionId}:${routeRevision}:${stepIndex}`;
}
