/**
 * navLayers.ts — NAV v3 · KATMAN SINIRLARI VE BAĞIMLILIK YASASI (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/1 · v2 §1.1 (P1–P9).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 * Bu dosya bir MİMARİ KAYITTIR: katmanları, her katmanın HANGİ alt katmanlardan
 * okuyabileceğini ve L4–L6'nın DOKUNAMAYACAĞI ham kaynak modüllerini sabitler.
 * Kilit test (`navV3ContractsF0.test.ts`) bu tabloyu kullanır.
 *
 * ── KATMANLAR ────────────────────────────────────────────────────────────
 *   L1 MapStore            — sürümlü, karolu harita verisi (graph/adas)
 *   L2 Ego/Localization    — aracın ham konum/yön/hız gerçeği (EKF + eşleme)
 *   L3 CEH (Ufuk)          — "önümde ne var?" sorusunun TEK cevaplayıcısı
 *   L4 Routing             — rota arama + maliyet + reroute
 *   L5 Guidance            — manevra + zamanlı ses + ETA bileşimi
 *   L6 Arbitration         — Guardian dedupe/sıralama + HMI güvenliği
 *   L7 Presentation        — salt-okunur projeksiyon (HUD/harita/mini harita)
 *   L8 Outcome/Accountability — tahmin↔gözlem karşılaştırması (yalnız SÖZLEŞME)
 *
 * ── BAĞIMLILIK YASASI (yönlü, döngüsüz) ──────────────────────────────────
 *  · L2 yalnız L1'den okur.
 *  · L3 L1 + L2'den okur.
 *  · L4/L5/L6 **L1'e DOKUNAMAZ** — harita/yol gerçeğini L3 (ufuk) üzerinden alır.
 *    (v2 P2 · ADR-N01: "önümde ne var?" tek cevaplayıcı L3.)
 *  · L7 L2–L6'nın salt-okunur projeksiyonlarından okur; hiçbirine YAZMAZ,
 *    zamanlayıcı/abonelik/GPS sahibi OLAMAZ (v2 P3).
 *  · L8 L2–L6'yı GÖZLEMLER; hiçbirine YAZMAZ, otoritatif harita gerçeğini
 *    EZEMEZ (bkz. `navOutcomeContract.ts`).
 */

export type NavLayerId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';

export const NAV_LAYER_IDS: readonly NavLayerId[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'] as const;

export const NAV_LAYER_NAME: Readonly<Record<NavLayerId, string>> = {
  L1: 'MapStore',
  L2: 'Ego/Localization',
  L3: 'CEH (Horizon)',
  L4: 'Routing',
  L5: 'Guidance',
  L6: 'Arbitration',
  L7: 'Presentation',
  L8: 'Outcome/Accountability',
} as const;

/**
 * Her katmanın OKUYABİLECEĞİ katmanlar (yönlü kenarlar). Bir katman bu listede
 * OLMAYAN bir katmandan truth okuyamaz.
 */
export const NAV_LAYER_DEPENDENCY_LAW: Readonly<Record<NavLayerId, readonly NavLayerId[]>> = {
  L1: [],
  L2: ['L1'],
  L3: ['L1', 'L2'],
  L4: ['L3'],                       // ← L1 YOK: yol gerçeği ufuktan
  L5: ['L3', 'L4'],
  L6: ['L3', 'L4', 'L5'],
  L7: ['L2', 'L3', 'L4', 'L5', 'L6'], // salt-okunur projeksiyon
  L8: ['L2', 'L3', 'L4', 'L5', 'L6'], // salt-gözlem
} as const;

/** L4–L6'nın DOĞRUDAN import edemeyeceği ham kaynak modülleri (yol/konum gerçeği). */
export const NAV_RAW_SOURCE_MODULES: readonly string[] = [
  'gpsService',
  'mapService',
  'mapSourceManager',
  'mapSourceStore',
  'overpassService',
  'overpass',
] as const;

/**
 * `NAV_RAW_SOURCE_MODULES` kuralının F0'da BİLİNÇLİ istisnası: bunlar yol/konum
 * gerçeği DEĞİL, güç/kontrol portudur.
 */
export const NAV_RAW_SOURCE_ALLOWLIST: readonly string[] = [
  'navGpsPowerBridge', // yalnız GPS donanım gücünü açar/kapar — truth üretmez
] as const;

/**
 * F0'da bağlayıcı ham-kaynak kilidinin uygulandığı L4 sahipleri. Tam L4–L6
 * taraması (Guardian adaptörleri dâhil) v2'deki gibi F3/F4 kilididir.
 */
export const NAV_L4_TRUTH_OWNERS: readonly string[] = [
  'src/platform/routingService.ts',
  'src/platform/navigationService.ts',
] as const;

/* ── Saf doğrulayıcılar ─────────────────────────────────────────────────── */

/** `from` katmanı `to` katmanından truth okuyabilir mi. */
export function mayDependOn(from: NavLayerId, to: NavLayerId): boolean {
  const allowed = NAV_LAYER_DEPENDENCY_LAW[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Bağımlılık yasası döngüsüz mü (DFS). Her zaman `true` olmalı — kilit test. */
export function isDependencyLawAcyclic(): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  for (const id of NAV_LAYER_IDS) color[id] = WHITE;

  const visit = (node: NavLayerId): boolean => {
    color[node] = GRAY;
    for (const next of NAV_LAYER_DEPENDENCY_LAW[node]) {
      if (color[next] === GRAY) return false;          // geri kenar → döngü
      if (color[next] === WHITE && !visit(next)) return false;
    }
    color[node] = BLACK;
    return true;
  };

  for (const id of NAV_LAYER_IDS) {
    if (color[id] === WHITE && !visit(id)) return false;
  }
  return true;
}

/** L4/L5/L6'nın hiçbiri L1'e bağımlı OLMAMALI (P2). */
export function routingLayersIsolatedFromMapStore(): boolean {
  return (['L4', 'L5', 'L6'] as const).every((l) => !mayDependOn(l, 'L1'));
}
