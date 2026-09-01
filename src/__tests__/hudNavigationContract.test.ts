/**
 * P0-NAV-17 — HUD NAVİGASYON SÖZLEŞMESİ (KİLİT).
 *
 * ── ÖLÇÜM (2026-08-24, koddan) ────────────────────────────────────────────
 * `hudPresentationModel` NAV-17'nin istediklerinin ÇOĞUNA zaten sahipti ve
 * **bu tur HUD'ı YENİDEN TASARLAMADI**: tek baskın durum, öncelik sırası
 * (`REROUTING > GPS_DEGRADED > ARRIVING > MANEUVER_APPROACH > ROUTE_DEGRADED`),
 * eşiklerin BAŞKA otoritelerden gelmesi (`ACTIONABLE_ACCURACY_M`,
 * `MANEUVER_BANDS`), reroute sırasında manevra kartının çizilmemesi, şerit
 * rehberinin YALNIZ gerçek veriyle görünmesi.
 *
 * Ölçülen İKİ boşluk:
 *   1. `showManeuver = state !== 'REROUTING'` — yani rehberlik aktifken
 *      manevra kartı **gerçekten bir manevra OLUP OLMADIĞINA BAKILMADAN**
 *      çiziliyordu. Modelin böyle bir girdisi bile YOKTU (`hasNextManeuver`
 *      "sonra …" satırını yönetir, ŞU ANKİ manevrayı DEĞİL). NAV-17'nin
 *      **"rota yokken dönüş oku"** maddesi tam olarak budur.
 *   2. **VARIŞ durumu modelde YOKTU** — varıştan sonra eski yönlendirmenin
 *      ekranda kalmasını engelleyen bir kural bulunmuyordu.
 *
 * SAF: ağ YOK · timer YOK · React YOK.
 */

import { describe, it, expect } from 'vitest';

import {
  resolveHudPresentation, isGpsDecisionGrade,
  HUD_TONE_OF, HUD_STATE_LABEL,
  type HudPresentationInput, type HudState,
} from '../platform/navigation/core/hudPresentationModel';
import { ACTIONABLE_ACCURACY_M } from '../platform/navigation/core/offRouteModel';

/* ── Fikstür: normal seyir ───────────────────────────────────────────────── */

const base: HudPresentationInput = {
  guidanceActive: true,
  rerouting: false,
  distToTurnM: 1_200,
  maneuverDistanceSource: 'ALONG_ROUTE',
  arriveManeuver: false,
  gpsUsable: true,
  accuracyM: 8,
  honestyLevel: 'CLEAN',
  layout: 'LANDSCAPE',
  hasLaneData: false,
  hasNextManeuver: true,
  hasManeuver: true,
  arrived: false,
};

const h = (over: Partial<HudPresentationInput> = {}) =>
  resolveHudPresentation({ ...base, ...over });

/* ══════════════════════════════════════════════════════════════════════════
   1) ROTA YOKKEN DÖNÜŞ OKU ÇİZİLMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-17 › manevra kartı kanıt ister', () => {
  it('gerçek manevra YOKSA kart ÇİZİLMEZ', () => {
    /* Boş adım listesi (düz hat sentinel'i yazılmadan önce · 0 adımlı rota)
       ekranda içeriksiz bir dönüş kartı bırakıyordu. */
    const p = h({ hasManeuver: false });
    expect(p.showManeuver).toBe(false);
    expect(p.showNextManeuver).toBe(false);
    expect(p.showLaneGuidance).toBe(false);
  });

  it('gerçek manevra VARSA kart çizilir', () => {
    expect(h().showManeuver).toBe(true);
  });

  it('manevra yokken ŞERİT rehberi de çizilmez (uydurma yasağı)', () => {
    const p = h({ hasManeuver: false, hasLaneData: true, distToTurnM: 100 });
    expect(p.showLaneGuidance).toBe(false);
  });

  it('reroute sırasında kart ÇİZİLMEZ (mevcut kilit korunuyor)', () => {
    const p = h({ rerouting: true });
    expect(p.state).toBe('REROUTING');
    expect(p.showManeuver).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) VARIŞTAN SONRA ESKİ YÖNLENDİRME KALMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-17 › varış', () => {
  it('VARILDIYSA durum ARRIVED ve manevra kartı DÜŞER', () => {
    const p = h({ arrived: true });
    expect(p.state).toBe('ARRIVED');
    expect(p.showManeuver).toBe(false);
    expect(p.showNextManeuver).toBe(false);
  });

  it('VARIŞ her şeyin ÜSTÜNDEDİR (reroute ve GPS bozukluğu dâhil)', () => {
    /* Varıldıysa eski manevra artık yönlendirme değil, kalıntıdır. */
    expect(h({ arrived: true, rerouting: true }).state).toBe('ARRIVED');
    expect(h({ arrived: true, gpsUsable: false }).state).toBe('ARRIVED');
    expect(h({ arrived: true, honestyLevel: 'DEGRADED' }).state).toBe('ARRIVED');
  });

  it('varışta yolculuk özeti de düşer ("kalan 0 km" yönlendirme değildir)', () => {
    expect(h({ arrived: true }).showTrip).toBe(false);
    expect(h().showTrip).toBe(true);
  });

  it('varış tonu SAKİNDİR (alarm değil)', () => {
    expect(HUD_TONE_OF.ARRIVED).toBe('NEUTRAL');
    expect(HUD_STATE_LABEL.ARRIVED.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) GPS YOKKEN SAHTE KESİNLİK YOK (mevcut kilitler korunuyor)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-17 › konum dürüstlüğü', () => {
  it('kullanılabilir konum yoksa durum GPS_DEGRADED', () => {
    expect(h({ gpsUsable: false }).state).toBe('GPS_DEGRADED');
  });

  it('doğruluk karar sınırının dışındaysa GPS_DEGRADED', () => {
    expect(h({ accuracyM: ACTIONABLE_ACCURACY_M + 1 }).state).toBe('GPS_DEGRADED');
    expect(h({ accuracyM: ACTIONABLE_ACCURACY_M - 1 }).state).not.toBe('GPS_DEGRADED');
  });

  it('eşik İCAT EDİLMEZ — sapma motorunun eşiğiyle AYNI', () => {
    /* İki katmanın aynı "bu fix'le karar verilir mi" sorusunu farklı
       eşiklerle yanıtlaması, kütük #402'de ölçülen kusurun ta kendisidir. */
    expect(isGpsDecisionGrade(true, ACTIONABLE_ACCURACY_M)).toBe(true);
    expect(isGpsDecisionGrade(true, ACTIONABLE_ACCURACY_M + 0.1)).toBe(false);
    expect(isGpsDecisionGrade(false, 1)).toBe(false);
  });

  it('doğruluk BİLDİRİLMEDİYSE ekran KAPATILMAZ (bilinçli sözleşme)', () => {
    /* ⚠️ Bu, "fail-closed"un İSTİSNASIDIR ve BİLİNÇLİDİR (`isGpsDecisionGrade`
       içinde `bildirilmedi → kapatma` olarak yazılı). Gerekçe: doğruluk
       bildirmeyen head unit'ler vardır; onlarda HUD'ı SÜREKLİ bozuk göstermek
       ürünü kullanılamaz kılardı. Birincil kapı `gpsUsable`dır — doğruluk
       yalnız İNCELTMEDİR.

       Kilit bu davranışı MÜHÜRLER: biri "tutarlılık" adına burayı fail-closed
       yaparsa, o cihazlarda navigasyonun neden hep "Konum güvenilmez" dediği
       sahada anlaşılmaz olurdu. */
    expect(h({ accuracyM: null }).state).toBe('ACTIVE_NORMAL');
    /* Ama konumun KENDİSİ yoksa kapı YİNE kapanır — asıl fail-closed budur. */
    expect(h({ gpsUsable: false, accuracyM: null }).state).toBe('GPS_DEGRADED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) REHBERLİK YOKKEN YÜZEY ÇİZİLMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-17 › rehberlik yokken', () => {
  it('rehberlik sürmüyorsa HER ŞEY kapalıdır', () => {
    const p = h({ guidanceActive: false });
    expect(p.state).toBe('OFF');
    expect(p.showManeuver).toBe(false);
    expect(p.showTrip).toBe(false);
    expect(p.showSpeed).toBe(false);
    expect(p.showStatus).toBe(false);
    /* Rehberlik yokken zoom kolonu GERİ GELİR (sürüş modu bitti). */
    expect(p.showZoomControls).toBe(true);
    expect(p.maneuverHeightBudget).toBe(0);
  });

  it('manevra mesafesi YOL-BOYU değilse manevra bandı uygulanmaz', () => {
    /* Kuş uçuşu mesafeyle "50 m sonra dönün" demek uydurmaktır. */
    const p = h({ distToTurnM: 30, maneuverDistanceSource: 'STRAIGHT_LINE' });
    expect(p.state).not.toBe('MANEUVER_APPROACH');
    const q = h({ distToTurnM: 30, maneuverDistanceSource: 'UNKNOWN' });
    expect(q.state).not.toBe('MANEUVER_APPROACH');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) SÖZLEŞME BÜTÜNLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-17 › sözleşme bütünlüğü', () => {
  it('HER durumun etiketi ve tonu tanımlıdır', () => {
    const states: readonly HudState[] = [
      'OFF', 'ACTIVE_NORMAL', 'MANEUVER_APPROACH', 'ARRIVING',
      'REROUTING', 'GPS_DEGRADED', 'ROUTE_DEGRADED', 'ARRIVED',
    ];
    for (const st of states) {
      expect(HUD_STATE_LABEL[st], `${st} etiketi yok`).toBeTruthy();
      expect(HUD_TONE_OF[st], `${st} tonu yok`).toBeTruthy();
    }
  });

  it('her hüküm bir GEREKÇE taşır (sessiz karar YOK)', () => {
    for (const over of [
      {}, { arrived: true }, { rerouting: true }, { gpsUsable: false },
      { guidanceActive: false }, { honestyLevel: 'DEGRADED' as const },
    ]) {
      expect(h(over).reason.length, JSON.stringify(over)).toBeGreaterThan(0);
    }
  });

  it('sürüm damgası taşınır (eşik değişimi sahada ayırt edilsin)', () => {
    expect(h().version).toMatch(/^HUD-\d{4}\.\d{2}\.\d{2}$/);
  });
});
