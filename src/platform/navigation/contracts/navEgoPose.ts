/**
 * navEgoPose.ts — NAV v3 · EGO KONUM SEMANTİĞİ SÖZLEŞMESİ (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/4 · v2 §3 (L2 — Konum Mimarisi).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK ·
 * ALGORİTMA YOK. Bu dosya EKF/HMM/eşleme IMPLEMENT ETMEZ — yalnız iki farklı
 * konum kavramını TİPLE ayırır. Kurucular ve motor F2'de gelir.
 *
 * ── NEDEN İKİ AYRI TİP ────────────────────────────────────────────────────
 * "Aracın fiilen NEREDE olduğu" ile "aracın yol grafiğinde HANGİ kenara
 * oturduğu" AYNI ŞEY DEĞİLDİR. Eşleşmiş konumu ham konummuş gibi tüketmek,
 * yanlış yola kilitlenmeyi (map-lock) GİZLER: ekran "yüksek güven" gösterir
 * ama araç aslında paralel yoldadır (v2 FMEA F05). Bu yüzden:
 *   · `RealtimeEgoPose`  — L2 çıktısı, HİÇBİR yola oturtulmamış, ham gerçek.
 *   · `MatchedRoadPose`  — L3 tarafı, grafiğe oturtulmuş TÜREV; ham pozu
 *                          DAİMA yanında taşır (tip bunu zorlar).
 *
 * ── SÖZLEŞME KURALLARI ───────────────────────────────────────────────────
 *  · `MatchedRoadPose.rawPose` HER ZAMAN doludur — ham konum ASLA kaybolmaz.
 *  · Hiçbir tüketici `mode`'u VARSAYAMAZ; her poz kendi modunu taşır.
 *  · L2 üstündeki her skaler alan `Evidenced<number>` taşır (kanıtsız sayı yok).
 *  · Zaman alanları `MonotonicMs` — duvar saati değil.
 */

import type { Evidenced } from './navEvidence';
import type { EdgeId } from './navEdgeId';
import type { MonotonicMs } from './navMonotonicTime';

/**
 * Ego mod durum makinesi (v2 §3.5). Bu dosya makineyi ÇALIŞTIRMAZ; yalnız
 * durum kümesini sözleşmede sabitler.
 */
export type EgoFixMode =
  | 'NONE'        // fix hiç yok — konum yayınlanmaz
  | 'GNSS'        // geçerli fix ≤ eşik — tam güven
  | 'GNSS_DR'     // fix bayat, hız kaynağı var — güven düşer
  | 'DR_ONLY'     // fix yok, yalnız OBD+IMU ölü hesap (süreli tavan)
  | 'LAST_KNOWN'; // hiçbir canlı kaynak yok — rehberlik DURDURULUR

export const EGO_FIX_MODES: readonly EgoFixMode[] = [
  'NONE', 'GNSS', 'GNSS_DR', 'DR_ONLY', 'LAST_KNOWN',
] as const;

/** Grafiğe oturma durumu. */
export type RoadMatchState =
  | 'MATCHED'          // güvenli eşleşme
  | 'MATCH_UNCERTAIN'  // aday(lar) var ama güven eşiğin altında → karar üretilmez
  | 'OFF_NETWORK'      // araç grafik dışında (kapsam VAR)
  | 'UNAVAILABLE';     // eşleme denenemedi (kapsam YOK) — "yol dışısın" DEĞİL

export const ROAD_MATCH_STATES: readonly RoadMatchState[] = [
  'MATCHED', 'MATCH_UNCERTAIN', 'OFF_NETWORK', 'UNAVAILABLE',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   L2 ÇIKTISI — ham, hiçbir yola oturtulmamış
   ══════════════════════════════════════════════════════════════════════════ */

export interface RealtimeEgoPose {
  /** Ayırt edici etiket — `MatchedRoadPose` ile karıştırılamaz. */
  readonly kind: 'REALTIME_EGO';
  /** Bu pozun üretildiği monotonik an. */
  readonly tsMonoMs: MonotonicMs;
  readonly lat: Evidenced<number>;
  readonly lon: Evidenced<number>;
  readonly headingDeg: Evidenced<number>;
  readonly speedMps: Evidenced<number>;
  /** Poz hangi modda üretildi — tüketici bunu VARSAYAMAZ, okur. */
  readonly mode: EgoFixMode;
  /** Yatay konum belirsizliği (1σ, metre). Bilinmiyorsa `null`. */
  readonly horizontalSigmaM: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   L3 TARAFI — grafiğe oturtulmuş türev; ham pozu DAİMA taşır
   ══════════════════════════════════════════════════════════════════════════ */

export interface MatchedRoadPose {
  readonly kind: 'MATCHED_ROAD';
  readonly tsMonoMs: MonotonicMs;
  readonly matchState: RoadMatchState;
  /** Eşleşilen kenar. `MATCHED` dışında `null`. */
  readonly edgeId: EdgeId | null;
  /** Kenar başından yol-boyu mesafe (metre). */
  readonly alongEdgeM: Evidenced<number>;
  readonly snappedLat: Evidenced<number>;
  readonly snappedLon: Evidenced<number>;
  /**
   * Ham konum — MAP-LOCK KORUMASI. Eşleşmiş konum ne olursa olsun ham gerçek
   * burada durur ve teşhis/geri-besleme kararları bunu kullanır.
   */
  readonly rawPose: RealtimeEgoPose;
  /** Eşleşmiş konumun ham konuma dik uzaklığı (metre). Bilinmiyorsa `null`. */
  readonly lateralOffsetM: number | null;
}

/* ── Tip daraltıcılar (saf) ─────────────────────────────────────────────── */

export function isRealtimeEgoPose(p: unknown): p is RealtimeEgoPose {
  return !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'REALTIME_EGO';
}

export function isMatchedRoadPose(p: unknown): p is MatchedRoadPose {
  return !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'MATCHED_ROAD';
}

/**
 * `MatchedRoadPose` sözleşmesini doğrular: ham poz DAİMA dolu ve doğru tipte
 * olmalı. Guard yardımcı — üretim kodu bunu asla üretmemeli, ama kurulursa
 * kilit test yakalar.
 */
export function matchedPoseCarriesRaw(p: MatchedRoadPose | null | undefined): boolean {
  return !!p && isRealtimeEgoPose(p.rawPose);
}

/**
 * Bu poz güvenilir bir rehberlik/eşleme kararına girebilir mi.
 * `DR_ONLY` / `LAST_KNOWN` / `MATCH_UNCERTAIN` → hayır (v2 §5.4 reroute kapıları).
 */
export function egoModeAllowsGuidance(mode: EgoFixMode): boolean {
  return mode === 'GNSS' || mode === 'GNSS_DR';
}
