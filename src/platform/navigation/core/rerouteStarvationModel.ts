/**
 * rerouteStarvationModel — "SAPTIM AMA KİMSE ROTA KURMUYOR" (SAF · P0-NAV-13).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (zaman DIŞARIDAN) · React YOK ·
 * global durum YOK · ağ YOK. **YENİ ZAMANLAYICI KURMAZ** — hüküm, zaten var
 * olan damgalardan OKUMA ANINDA türetilir (NAV-13'ün açık kuralı: "polling/timer
 * artırarak problemi çözme").
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-13 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sapma durum makinesi (`offRouteModel`) NAV-13'ün istediği her şeye SAHİPTİ:
 * `ON_ROUTE → SUSPECTED_OFF_ROUTE → CONFIRMED_OFF_ROUTE → REROUTING → REJOINED`
 * artı çoklu kanıt (ardışık örnek SAYISI **ve** SÜRE **ve** hız **ve** doğruluk
 * **ve** yön). Tek GPS gürültüsü reroute başlatamaz — bu kilitli.
 *
 * Ölçülen İKİ boşluk:
 *
 *  1. **KAPI SESSİZDİ — İDDİA EDİLEN GÖZLEM YOKTU.** `routingService` içindeki
 *     yorum aynen şöyle diyor: *"Kapı artık nedeniyle DEFTERE yazılıyor (LAB'da
 *     görünür, kütükte ölçülebilir)."* Ölçüm bunu ÇÜRÜTTÜ:
 *     `getRerouteBlockStats()` ÜRÜNDE HİÇBİR YERDEN OKUNMUYOR — tek çağıranı
 *     bir testti. Yani engellenen reroute'ların sebebi yazılıyor ama
 *     **hiçbir ekrana taşınmıyordu**; kütük #402'nin kapatmayı amaçladığı
 *     "sapma %17,5, reroute %0, arada ne olduğu bilinmiyor" boşluğu
 *     GÖZLEM TARAFINDA AÇIK KALMIŞ.
 *
 *  2. **KALICI ENGELDE KAÇIŞ YOKTU.** Doğruluk sürekli `ACTIONABLE_ACCURACY_M`
 *     üstünde kalırsa (ucuz head unit GPS'i · şehir kanyonu · kapalı otopark
 *     çıkışı) `WEAK_ACCURACY` her tick'te geri döner ve sürücü rota dışındayken
 *     **sonsuza kadar yeni rota alamaz** — üstelik SESSİZCE. NAV-13'ün kuralı
 *     açıktır: *"gerçekten rota dışındaysa sonsuza kadar beklemesin."*
 *
 * ── BU MODÜL NE YAPAR, NE YAPMAZ ──────────────────────────────────────────
 *  · YAPAR: "ne kadar süredir sapmış hâldeyiz ve bu sürede rota kurulabildi mi"
 *    sorusunu ÖLÇER ve sınıflandırır.
 *  · YAPMAZ: reroute TETİKLEMEZ, eşik GEVŞETMEZ, doğruluk kapısını EZMEZ.
 *    Zayıf sinyalde rota kurmak yanlış yere rota kurmaktır (fail-closed) ve o
 *    kural PAZARLIKSIZDIR. Bu modül yalnız **açlığı GÖRÜNÜR** kılar; ne
 *    yapılacağı (kullanıcıyı uyarmak · düz hatta düşmek) ayrı bir karardır ve
 *    kanıt olmadan alınamaz.
 */

import type { RerouteBlockReason } from './routeRequestLedger';

/* ══════════════════════════════════════════════════════════════════════════
   EŞİKLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Doğrulanmış sapmadan sonra rota kurulamadan geçen bu süre "geçici engel"
 * sayılır (ms).
 *
 * NEDEN 15 SANİYE: throttle penceresi hızla değişir (2,5–6 sn) ve tek bir
 * yavaş sağlayıcı denemesi 8 sn'ye kadar sürebilir. 15 sn, NORMAL bir
 * gecikmenin üst sınırıdır — altında alarm üretmek gürültü olurdu.
 */
export const REROUTE_TRANSIENT_MS = 15_000;

/**
 * Bu süreden uzun süre sapmış ve rota kurulamamışsa durum AÇLIKTIR (ms).
 *
 * NEDEN 45 SANİYE: 50 km/h'te 45 saniye ≈ 625 metredir. Sürücü bu mesafeyi
 * yanlış yolda, eski rotanın talimatlarıyla giderse ürün ona YALAN söylüyor
 * demektir. Bu eşik bir ALARM eşiğidir, bir aksiyon eşiği DEĞİL.
 */
export const REROUTE_STARVED_MS = 45_000;

/* ══════════════════════════════════════════════════════════════════════════
   HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type RerouteHealth =
  /** Sapma yok ya da rota zaten kuruldu. */
  | 'HEALTHY'
  /** Sapma doğrulandı, rota isteği YOLDA. */
  | 'REROUTING'
  /** Sapma doğrulandı, engel var ama süre normal sınırlarda. */
  | 'BLOCKED_TRANSIENT'
  /** Sapma doğrulandı, uzun süredir rota KURULAMIYOR — sürücü yalnız. */
  | 'STARVED'
  /** Kanıt yetersiz — hüküm iddia EDİLMEZ. */
  | 'UNKNOWN';

export const REROUTE_HEALTH_LABEL: Readonly<Record<RerouteHealth, string>> = {
  HEALTHY:           'sapma yok ya da rota kuruldu',
  REROUTING:         'rota isteği yolda',
  BLOCKED_TRANSIENT: 'engel var, süre normal sınırlarda',
  STARVED:           'UZUN SÜREDİR ROTA KURULAMIYOR — sürücü eski talimatla gidiyor',
  UNKNOWN:           'kanıt yetersiz — hüküm iddia edilmiyor',
} as const;

export interface RerouteHealthInput {
  /** Sapmanın DOĞRULANDIĞI an (ms, duvar saati). Sapma yoksa `null`. */
  readonly confirmedAtMs: number | null;
  /** Sapma doğrulandıktan SONRA rota uygulanan an. Yoksa `null`. */
  readonly lastCommitAtMs: number | null;
  /** Şu anki durum makinesi hâli. */
  readonly offRouteState: string;
  /** Son engelin sebebi ve zamanı. Engel yoksa `null`. */
  readonly lastBlock: { readonly reason: RerouteBlockReason; readonly tsMs: number } | null;
  /** Şu an (ms). Ölçülemezse `null` → hüküm `UNKNOWN`. */
  readonly nowMs: number | null;
}

export interface RerouteHealthVerdict {
  readonly health: RerouteHealth;
  /** Doğrulanmış sapmadan bu yana geçen süre (ms). Ölçülemezse `null`. */
  readonly offRouteForMs: number | null;
  /** Açlığın sebebi — son engelin sınıfı. Engel yoksa `null`. */
  readonly blockedBy: RerouteBlockReason | null;
  readonly why: string;
}

/**
 * Reroute sağlığını ÖLÇER. **SAF · KARAR ÜRETMEZ.**
 *
 * Sıra bilinçlidir: rota kurulduysa geçmiş engeller ANLAMSIZDIR; istek
 * yoldaysa açlık İDDİA EDİLEMEZ; ancak ikisi de yoksa süreye bakılır.
 */
export function judgeRerouteHealth(i: RerouteHealthInput): RerouteHealthVerdict {
  const none = (health: RerouteHealth, why: string): RerouteHealthVerdict =>
    ({ health, offRouteForMs: null, blockedBy: null, why });

  if (i.confirmedAtMs === null) {
    return none('HEALTHY', 'doğrulanmış sapma yok');
  }
  if (i.nowMs === null || !Number.isFinite(i.nowMs)) {
    return none('UNKNOWN', 'şimdiki zaman ölçülmedi');
  }

  /* Sapma doğrulandıktan SONRA rota uygulandıysa açlık BİTMİŞTİR. */
  if (i.lastCommitAtMs !== null && i.lastCommitAtMs >= i.confirmedAtMs) {
    return none('HEALTHY', 'sapmadan sonra rota uygulandı');
  }

  const offRouteForMs = Math.max(0, i.nowMs - i.confirmedAtMs);
  const blockedBy = i.lastBlock?.reason ?? null;

  /* İstek YOLDAYSA açlık iddia edilemez — beklemek normaldir. */
  if (i.offRouteState === 'REROUTING') {
    return {
      health: 'REROUTING', offRouteForMs, blockedBy,
      why: `rota isteği yolda (${Math.round(offRouteForMs / 1000)} sn)`,
    };
  }

  if (offRouteForMs >= REROUTE_STARVED_MS) {
    return {
      health: 'STARVED', offRouteForMs, blockedBy,
      why: `${Math.round(offRouteForMs / 1000)} sn'dir rota dışında ve rota KURULAMADI`
         + (blockedBy !== null ? ` — son engel: ${blockedBy}` : ' — engel sebebi bildirilmedi'),
    };
  }

  if (offRouteForMs >= REROUTE_TRANSIENT_MS || blockedBy !== null) {
    return {
      health: 'BLOCKED_TRANSIENT', offRouteForMs, blockedBy,
      why: `${Math.round(offRouteForMs / 1000)} sn'dir bekleniyor`
         + (blockedBy !== null ? ` — son engel: ${blockedBy}` : ''),
    };
  }

  return {
    health: 'BLOCKED_TRANSIENT', offRouteForMs, blockedBy,
    why: `sapma yeni doğrulandı (${Math.round(offRouteForMs / 1000)} sn)`,
  };
}
