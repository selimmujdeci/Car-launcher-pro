/**
 * routeIntent.ts — NAV v3 · L3 · ROTA NİYETİ GİRDİSİ (SAF SÖZLEŞME · F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.3 · CLAUDE.md §CROSS-DOMAIN 3 + 12.
 *
 * SAF: I/O YOK · timer YOK · saat OKUMAZ · React YOK · L4 importu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN "PUSH", NEDEN "PULL" DEĞİL ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * MPP'yi hesaplamak için aktif rota bilgisi gerekir. Ama F0 bağımlılık yasası
 * yönlüdür ve **L4 → L3** okur (`NAV_LAYER_DEPENDENCY_LAW.L4 = ['L3']`).
 * L3'ün `routingService`i import etmesi ters kenar açar ve grafiği DÖNGÜLÜ
 * yapar (`isDependencyLawAcyclic()` bozulur).
 *
 * Bu yüzden rota niyeti **İTİLİR**: bileşim kökü (tik sahibi
 * `navigationSessionRuntime` → `navEgoHorizonBridge`) L4'ten okuduğu
 * salt-okunur projeksiyonu bu sözleşmeyle CEH'e verir. L3 hiçbir L4 modülünü
 * GÖRMEZ (kilit test kaynak taramasıyla denetler).
 *
 * ── NİYET ≠ FİZİKSEL GERÇEK (pazarlıksız) ────────────────────────────────
 * Bu yapı "aracın nerede olduğunu" SÖYLEMEZ; "sürücünün nereye gitmek
 * istediğini" söyler. Paralel yolda, servis yolunda veya viyadük altında
 * rota aynen durur ama araç o yolda DEĞİLDİR. Bu yüzden:
 *   · `onCorridor` L4'ün ROTA-GÖRELİ eşleştiricisinin hükmüdür — yol-ağı
 *     eşleştirmesi DEĞİLDİR ve tek başına fiziksel doğrulama SAYILMAZ.
 *   · CEH bu girdiden üretilen kolu `ROUTE_INTENT` kökeniyle işaretler ve
 *     `physicallyConfirmed` YALNIZ `MatchedRoadPose` uyuşunca `true` olur.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';

/* ══════════════════════════════════════════════════════════════════════════
   1) MANEVRA — makine-okur; serbest metin TAŞIMAZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rotadaki tek manevra noktası.
 *
 * Sürücüye gösterilen TÜRKÇE talimat metni bilinçli olarak TAŞINMAZ: CEH bir
 * sunum katmanı değildir ve serbest metin ufuk nesnesinin kimliğini kararsız
 * yapar (aynı manevra dil değişince farklı görünürdü).
 */
export interface RouteIntentManeuver {
  readonly stepIndex: number;
  /**
   * Bu manevradan rotanın SONUNA kalan yol-boyu mesafe (m).
   * Kaynak: L4 `maneuverAnchors[i].alongRemainingM`. `null` = çapa çözülemedi.
   */
  readonly alongRemainingM: number | null;
  /** OSRM `maneuver.type` (`turn` · `arrive` · `roundabout`…). */
  readonly maneuverType: string;
  /** OSRM `maneuver.modifier` (`left` · `right` · `straight`…). */
  readonly maneuverModifier: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) NİYET ANLIK GÖRÜNTÜSÜ
   ══════════════════════════════════════════════════════════════════════════ */

export interface RouteIntentSnapshot {
  /** Aktif, sürülebilir bir rota var mı. `false` → diğer alanlar OKUNMAZ. */
  readonly available: boolean;
  /** Navigasyon oturum kimliği — oturum sınırı kanıtı (F0 §17). */
  readonly sessionId: number | null;
  /** Monotonik rota revizyonu; reroute'ta artar. */
  readonly routeRevision: number;
  /** Bu projeksiyonun okunduğu monotonik an. `null` → bayatlık HESAPLANMAZ. */
  readonly observedAtMonoMs: MonotonicMs | null;
  /**
   * Aracın rota SONUNA kalan yol-boyu mesafesi (m) — L4 ölçümü.
   * `null` = ilerleme ölçülemedi → rota-göreli mesafe ÜRETİLEMEZ.
   */
  readonly vehicleAlongRemainingM: number | null;
  /** Rotanın toplam uzunluğu (m). `null` = bilinmiyor. */
  readonly totalDistanceM: number | null;
  /** Sıradaki manevralar (yalnız ÖNDE olanlar anlamlıdır). */
  readonly maneuvers: readonly RouteIntentManeuver[];
  /**
   * Rota çizgisi `[lon, lat][]` — **yalnız fiziksel çelişki kontrolü** için.
   * Salt-okunur referanstır; CEH bunu KOPYALAMAZ ve DEĞİŞTİRMEZ.
   * `null` = geometri yok → çelişki kontrolü YAPILAMAZ (varsayım üretilmez).
   */
  readonly geometry: readonly (readonly [number, number])[] | null;
  /**
   * L4'ün ROTA-GÖRELİ eşleştiricisi aracı koridorda görüyor mu.
   * ⚠️ Yol-ağı eşleştirmesi DEĞİLDİR — fiziksel doğrulama SAYILMAZ.
   */
  readonly onCorridor: boolean;
  /**
   * Fiziksel eşleşmenin rotadan "çelişkili" sayıldığı dik mesafe (m).
   *
   * Bu sayı **L4'ün KENDİ sapma eşiğidir** ve niyetle birlikte itilir; L3
   * kendi eşiğini İCAT ETMEZ (iki farklı eşik = iki farklı "rotadan çıktı"
   * hükmü demektir). `null` → çelişki kontrolü YAPILMAZ: ne doğrulama ne
   * çelişki iddia edilir (fail-closed).
   */
  readonly conflictThresholdM: number | null;
}

/** Rota yok — fail-closed varsayılan. */
export const NO_ROUTE_INTENT: RouteIntentSnapshot = {
  available: false,
  sessionId: null,
  routeRevision: 0,
  observedAtMonoMs: null,
  vehicleAlongRemainingM: null,
  totalDistanceM: null,
  maneuvers: [],
  geometry: null,
  onCorridor: false,
  conflictThresholdM: null,
};

/* ══════════════════════════════════════════════════════════════════════════
   3) SAF DOĞRULAYICI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu niyet MESAFE üretmek için kullanılabilir mi. Rota "var" olsa bile
 * ilerleme ölçülemiyorsa (`vehicleAlongRemainingM === null`) ufukta
 * mesafe İDDİA EDİLEMEZ — uydurma mesafe, yanlış zamanlı uyarı demektir.
 */
export function routeIntentCarriesDistance(r: RouteIntentSnapshot | null | undefined): boolean {
  return !!r && r.available === true
    && typeof r.vehicleAlongRemainingM === 'number'
    && Number.isFinite(r.vehicleAlongRemainingM)
    && r.vehicleAlongRemainingM >= 0;
}
