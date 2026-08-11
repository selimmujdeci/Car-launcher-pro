/**
 * navigationDeliveryCore.test.ts — NAVIGATION_DELIVERY_CORE_P0 kilitleri.
 *
 * Kapsam (görev §6):
 *   A. Sesli yönlendirme sahipliği + dedupe
 *   B. Ölü hesaplama (DR) sahipliği
 *   C. Rota süre verisi ayrıştırma
 *   D. ETA modeli
 *   E. Görünüm regresyonu (yapısal kilitler)
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

import hudSrc      from '../components/map/NavigationHUD.tsx?raw';
import fullMapSrc  from '../components/map/FullMapView.tsx?raw';
import miniMapSrc  from '../components/map/MiniMapWidget.tsx?raw';
import runtimeSrc  from '../platform/navigation/navigationSessionRuntime.ts?raw';
import voiceRtSrc  from '../platform/navigation/voiceGuidanceRuntime.ts?raw';
import voiceModSrc from '../platform/navigation/core/voiceGuidanceModel.ts?raw';
import etaModSrc   from '../platform/navigation/core/etaModel.ts?raw';
import durModSrc   from '../platform/navigation/core/routeDurationModel.ts?raw';

import {
  decideGuidance, finalTierMetres, maneuverId, STAGE_BIT,
  FAR_TIER_M, NEAR_TIER_M,
} from '../platform/navigation/core/voiceGuidanceModel';
import {
  noteVoiceGuidanceTick, resetVoiceGuidance, getVoiceGuidanceSnapshot,
  _resetVoiceGuidanceForTest,
} from '../platform/navigation/voiceGuidanceRuntime';
import {
  parseRouteDurations, remainingRouteDurationS,
} from '../platform/navigation/core/routeDurationModel';
import {
  computeEta, ETA_MIN_FACTOR, ETA_MAX_FACTOR, ETA_MIN_CORRECTION_KMH,
} from '../platform/navigation/core/etaModel';

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/* ══════════════════════════════════════════════════════════════════════════
   A. SESLİ YÖNLENDİRME
   ══════════════════════════════════════════════════════════════════════════ */
describe('A1. Sesli yönlendirme kararı (saf model)', () => {
  const base = {
    navActive: true, isRerouting: false,
    distanceSource: 'ALONG_ROUTE' as const,
    speedKmh: 50, instruction: 'Sola dönün', spokenBits: 0,
  };

  it('EŞİKLER KORUNDU — 600 / 250 / hız-uyarlanabilir', () => {
    expect(FAR_TIER_M).toBe(600);
    expect(NEAR_TIER_M).toBe(250);
    // 50 km/sa → (50/3.6)*4 ≈ 55.6 m · 30 km/sa → taban 35 · 100 km/sa → 111 m
    expect(finalTierMetres(50)).toBeCloseTo(55.6, 1);
    expect(finalTierMetres(30)).toBe(35);
    expect(finalTierMetres(100)).toBeCloseTo(111.1, 1);
    expect(finalTierMetres(200)).toBe(150);   // tavan
  });

  it('METİNLER KORUNDU — "Şimdi ..." ve "N metre sonra ..."', () => {
    expect(decideGuidance({ ...base, distanceM: 500 })?.text).toBe('500 metre sonra sola dönün');
    expect(decideGuidance({ ...base, distanceM: 200 })?.text).toBe('200 metre sonra sola dönün');
    expect(decideGuidance({ ...base, distanceM: 30 })?.text).toBe('Şimdi sola dönün');
  });

  it('mesafe 50 m\'ye YUVARLANIR (eski davranış)', () => {
    expect(decideGuidance({ ...base, distanceM: 573 })?.text).toBe('550 metre sonra sola dönün');
  });

  it('kademe sırası: FAR → NEAR → IMMINENT', () => {
    let bits = 0;
    const far = decideGuidance({ ...base, distanceM: 580, spokenBits: bits })!;
    expect(far.stage).toBe('FAR'); bits = far.nextBits;
    const near = decideGuidance({ ...base, distanceM: 240, spokenBits: bits })!;
    expect(near.stage).toBe('NEAR'); bits = near.nextBits;
    const imm = decideGuidance({ ...base, distanceM: 30, spokenBits: bits })!;
    expect(imm.stage).toBe('IMMINENT');
  });

  it('AYNI kademe İKİNCİ KEZ konuşulmaz', () => {
    const first = decideGuidance({ ...base, distanceM: 580 })!;
    expect(decideGuidance({ ...base, distanceM: 570, spokenBits: first.nextBits })).toBeNull();
  });

  it('yakın kademe uzaktakileri de KAPATIR (geçmiş anons tekrar oynatılmaz)', () => {
    const imm = decideGuidance({ ...base, distanceM: 20 })!;
    expect(imm.nextBits & STAGE_BIT.FAR).toBeTruthy();
    expect(imm.nextBits & STAGE_BIT.NEAR).toBeTruthy();
    // Süreç yeniden başlayıp araç zaten manevraya yakınsa yalnız SON kademe.
    expect(decideGuidance({ ...base, distanceM: 400, spokenBits: imm.nextBits })).toBeNull();
  });

  it('mesafe kaynağı UNKNOWN → KONUŞULMAZ (uydurma yasak)', () => {
    expect(decideGuidance({ ...base, distanceM: 200, distanceSource: 'UNKNOWN' })).toBeNull();
  });

  it('navigasyon aktif değil veya reroute sürüyorsa KONUŞULMAZ', () => {
    expect(decideGuidance({ ...base, distanceM: 200, navActive: false })).toBeNull();
    expect(decideGuidance({ ...base, distanceM: 200, isRerouting: true })).toBeNull();
  });

  it('talimat boşsa KONUŞULMAZ (şerit/kavşak bilgisi uydurulmaz)', () => {
    expect(decideGuidance({ ...base, distanceM: 200, instruction: '   ' })).toBeNull();
  });

  it('geçersiz mesafe KONUŞULMAZ', () => {
    for (const d of [0, -5, NaN, Infinity]) {
      expect(decideGuidance({ ...base, distanceM: d })).toBeNull();
    }
  });

  it('kanonik kimlik oturum + revizyon + adım taşır', () => {
    expect(maneuverId(3, 7, 2)).toBe('3:7:2');
    expect(maneuverId(3, 8, 2)).not.toBe(maneuverId(3, 7, 2));
    expect(maneuverId(4, 7, 2)).not.toBe(maneuverId(3, 7, 2));
  });
});

describe('A2. Sesli yönlendirme runtime (görünümden bağımsız)', () => {
  let spoken: string[];
  const speak = (t: string) => { spoken.push(t); };

  const tick = (over: Partial<Parameters<typeof noteVoiceGuidanceTick>[0]> = {}) =>
    noteVoiceGuidanceTick({
      navActive: true, isRerouting: false, sessionId: 1, routeRevision: 1,
      stepIndex: 0, instruction: 'Sağa dönün', distanceM: 500,
      distanceSource: 'ALONG_ROUTE', speedKmh: 50, ...over,
    }, speak);

  beforeEach(() => { spoken = []; _resetVoiceGuidanceForTest(); });

  it('anons üretir ve durumu MODÜL düzeyinde tutar', () => {
    expect(tick()).not.toBeNull();
    expect(spoken).toEqual(['500 metre sonra sağa dönün']);
    expect(getVoiceGuidanceSnapshot().lastSpokenManeuverId).toBe('1:1:0');
    expect(getVoiceGuidanceSnapshot().owner).toBe('NAV_SESSION_RUNTIME');
  });

  it('🔒 GÖRÜNÜM REMOUNT ANONSU TEKRARLATMAZ — durum bileşende değil', () => {
    tick();
    expect(spoken).toHaveLength(1);
    // Görünüm kapanıp açılsa bile modül durumu yaşar → aynı kademe tekrar YOK.
    tick({ distanceM: 480 });
    tick({ distanceM: 460 });
    expect(spoken).toHaveLength(1);
    expect(getVoiceGuidanceSnapshot().duplicateSuppressed).toBeGreaterThan(0);
  });

  it('aynı manevrada kademe ilerledikçe YENİ anons üretir', () => {
    tick({ distanceM: 500 });
    tick({ distanceM: 200 });
    tick({ distanceM: 30 });
    expect(spoken).toEqual([
      '500 metre sonra sağa dönün',
      '200 metre sonra sağa dönün',
      'Şimdi sağa dönün',
    ]);
  });

  it('ROTA REVİZYONU değişince kuyruk TEMİZLENİR (yeni rota sessiz kalmaz)', () => {
    tick({ routeRevision: 1, distanceM: 500 });
    expect(spoken).toHaveLength(1);
    tick({ routeRevision: 2, distanceM: 500 });
    expect(spoken).toHaveLength(2);
    expect(getVoiceGuidanceSnapshot().routeKey).toBe('1:2');
  });

  it('OTURUM değişince kuyruk TEMİZLENİR', () => {
    tick({ sessionId: 1, distanceM: 500 });
    tick({ sessionId: 2, distanceM: 500 });
    expect(spoken).toHaveLength(2);
  });

  it('reroute sırasında manevra anonsu BASTIRILIR, durum BİR KEZ bildirilir', () => {
    tick({ isRerouting: true, distanceM: 200 });
    tick({ isRerouting: true, distanceM: 180 });
    expect(spoken).toEqual(['Rota yeniden hesaplanıyor']);
    expect(getVoiceGuidanceSnapshot().state).toBe('REROUTING');
  });

  it('navigasyon aktif değilken ses ÜRETİLMEZ ve durum temizlenir', () => {
    tick({ distanceM: 500 });
    expect(tick({ navActive: false })).toBeNull();
    expect(spoken).toHaveLength(1);
    expect(getVoiceGuidanceSnapshot().state).toBe('IDLE');
    expect(getVoiceGuidanceSnapshot().trackedManeuvers).toBe(0);
  });

  it('navigasyon bitince reset TÜM durumu siler', () => {
    tick({ distanceM: 500 });
    resetVoiceGuidance('test');
    const s = getVoiceGuidanceSnapshot();
    expect(s.state).toBe('IDLE');
    expect(s.lastSpokenManeuverId).toBeNull();
    expect(s.trackedManeuvers).toBe(0);
  });

  it('süreç yeniden başladıktan sonra GEÇMİŞ anonslar tekrar oynatılmaz', () => {
    // Yeni süreç: maske boş, araç manevraya 25 m kalmış.
    _resetVoiceGuidanceForTest();
    tick({ distanceM: 25 });
    // FAR ve NEAR kademeleri GERİYE DÖNÜK olarak söylenmez.
    expect(spoken).toEqual(['Şimdi sağa dönün']);
  });

  it('TTS hatası anonsu ÇÖKERTMEZ (fail-soft)', () => {
    const boom = () => { throw new Error('tts yok'); };
    expect(() => noteVoiceGuidanceTick({
      navActive: true, isRerouting: false, sessionId: 1, routeRevision: 1,
      stepIndex: 0, instruction: 'Sağa dönün', distanceM: 500,
      distanceSource: 'ALONG_ROUTE', speedKmh: 50,
    }, boom)).not.toThrow();
  });

  it('izlenen manevra sayısı SINIRLIDIR (bellek sızıntısı yok)', () => {
    for (let i = 0; i < 200; i++) tick({ stepIndex: i, distanceM: 500 });
    expect(getVoiceGuidanceSnapshot().trackedManeuvers).toBeLessThanOrEqual(64);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B. ÖLÜ HESAPLAMA SAHİPLİĞİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('B. Ölü hesaplama (DR) sahipliği', () => {
  it('🔒 DR ilerleme beslemesi GÖRÜNÜMDE DEĞİL', () => {
    const fm = code(fullMapSrc);
    // Görünüm ilerleme fonksiyonlarını artık HİÇ çağırmaz.
    expect(fm).not.toContain('updateRouteProgress(');
    expect(fm).not.toContain('updateNavigationProgress(');
    // Ama DR'yi ÇİZMEYE devam eder (marker/kamera) — bu ilerleme üretmez.
    expect(fm).toContain('projectDeadReckon');
  });

  it('🔒 DR sahibi görünümden bağımsız runtime\'dır', () => {
    const rt = code(runtimeSrc);
    expect(rt).toContain('projectDeadReckon');
    expect(rt).toContain("allowReroute: false");
    expect(rt).toContain('DR_MAX_DT_SEC');
  });

  it('🔒 TIMER SAHİPLİĞİ TEK YERDE — görünümde interval yok', () => {
    expect(code(runtimeSrc)).toContain('setInterval(_drTick');
    expect(code(fullMapSrc)).not.toContain('lastDrProgressMs');
  });

  it('🔒 DR zamanlayıcısı İDEMPOTENT kurulur (çift tick = çift ilerleme)', () => {
    expect(code(runtimeSrc)).toContain('if (_drTimer !== null) return;');
  });

  it('🔒 ÇİFT İLERLEME YAPISAL OLARAK İMKÂNSIZ — mutlak eşleştirme', () => {
    // `updateRouteProgress` konumu rotaya eşleştirip MUTLAK kalan üretir;
    // DR mesafesi ilerlemeye EKLENMEZ (yalnız gözlem alanıdır).
    const rt = code(runtimeSrc);
    expect(rt).toContain('_drDistanceM =');
    expect(rt).not.toContain('_drDistanceM +');
  });

  it('🔒 hız kaynağı yoksa SAHTE İLERLEME yapılmaz', () => {
    const rt = code(runtimeSrc);
    /* #528: durum atamaları `_setDrState()` üzerinden yapılır (DR canlılık sinyali
       merkeze bildirilsin diye). DAVRANIŞ DEĞİŞMEDİ — kilit kaldırılmadı, yeni
       biçime taşındı: hız kanıtı kapısı hâlâ aynı yerde ve aynı eşikte. */
    expect(rt).toContain('if (!(speedKmh >= 1)) { _setDrState(\'DR_EXPIRED\'); return; }');
  });

  it('🔒 GPS tazeyken DR çalışmaz (erken döner)', () => {
    /* SÖZLEŞME AYNI, BİÇİM GÜNCELLENDİ (#451 · PR-451a): tek satırlık erken
       dönüş, çapayı da temizlemesi gerektiği için bloğa çevrildi. Kilit
       KALDIRILMADI — kontrol edilen davranış (GPS tazeyken DR'nin erken
       dönmesi) aynen denetlenir, ek olarak çapanın unutulması da denetlenir.
       Bayat çapa kalsaydı, sonraki GPS kaybında araç çoktan geçtiği bir
       noktadan ilerletilirdi. */
    const c = code(runtimeSrc);
    expect(c).toContain('if (ageMs <= GPS_STALE_MS) {');
    expect(c).toMatch(/_setDrState\('GPS_FRESH'\); _drConfidence = 1;/);
    expect(c, 'GPS tazelenince DR çapası unutulmuyor').toMatch(
      /if \(ageMs <= GPS_STALE_MS\) \{[\s\S]{0,200}?_clearDrProjection\(\);[\s\S]{0,40}?return;/,
    );
  });

  it('🔒 DR güveni bitince ilerleme DURUR', () => {
    expect(code(runtimeSrc)).toContain("if (_drConfidence <= 0) { _setDrState('DR_EXPIRED'); return; }");
  });

  it('🔒 navigasyon bitince DR ve ses TEMİZLENİR', () => {
    const rt = code(runtimeSrc);
    expect(rt).toContain('_onNavigationInactive');
    expect(rt).toContain("resetVoiceGuidance('navigasyon aktif değil')");
    expect(rt).toContain('clearInterval(_drTimer)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C. ROTA SÜRE VERİSİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('C. OSRM süre verisi ayrıştırma', () => {
  it('geçerli dizi doğrulanır ve suffix-sum kurulur', () => {
    const p = parseRouteDurations([10, 20, 30], 4);
    expect(p.integrity).toBe('VALID');
    expect(p.source).toBe('OSRM_ANNOTATION');
    expect(p.sumSeconds).toBe(60);
    expect(Array.from(p.cumulativeDurations!)).toEqual([60, 50, 30, 0]);
    expect(p.cumulativeDurations![p.cumulativeDurations!.length - 1]).toBe(0);
  });

  it('UZUNLUK UYUŞMAZLIĞI diziyi TÜMDEN reddeder', () => {
    const p = parseRouteDurations([10, 20], 5);
    expect(p.integrity).toBe('LENGTH_MISMATCH');
    expect(p.cumulativeDurations).toBeNull();
  });

  it('NaN / Infinity / negatif değer diziyi reddeder', () => {
    for (const bad of [NaN, Infinity, -1]) {
      const p = parseRouteDurations([10, bad, 30], 4);
      expect(p.integrity).toBe('INVALID_VALUES');
      expect(p.segmentDurations).toBeNull();
    }
  });

  it('dizi yoksa MISSING (kaynak NONE)', () => {
    expect(parseRouteDurations(null, 4).integrity).toBe('MISSING');
    expect(parseRouteDurations(undefined, 4).source).toBe('NONE');
    expect(parseRouteDurations([], 4).integrity).toBe('MISSING');
  });

  it('kalan süre segment içinde ORANTILI azalır', () => {
    // 3 segment × 100 m, süreler 10/20/30 sn
    const p = parseRouteDurations([10, 20, 30], 4);
    const cumM = new Float64Array([300, 200, 100, 0]);
    // Segment 1'in tam ortası: kalan mesafe 150 m → kalan süre 30 + 20×0.5 = 40
    expect(remainingRouteDurationS({
      cumulativeDurations: p.cumulativeDurations,
      segmentDurations: p.segmentDurations,
      cumulativeDistances: cumM, segIdx: 1, alongRemainingM: 150,
    })).toBeCloseTo(40, 5);
    // Segment 1'in sonunda: 30
    expect(remainingRouteDurationS({
      cumulativeDurations: p.cumulativeDurations,
      segmentDurations: p.segmentDurations,
      cumulativeDistances: cumM, segIdx: 1, alongRemainingM: 100,
    })).toBeCloseTo(30, 5);
  });

  it('GEÇİLEN segmentlerin süresi TEKRAR EKLENMEZ (mutlak okuma)', () => {
    const p = parseRouteDurations([10, 20, 30], 4);
    const cumM = new Float64Array([300, 200, 100, 0]);
    const args = {
      cumulativeDurations: p.cumulativeDurations,
      segmentDurations: p.segmentDurations,
      cumulativeDistances: cumM,
    };
    const a = remainingRouteDurationS({ ...args, segIdx: 0, alongRemainingM: 300 })!;
    const b = remainingRouteDurationS({ ...args, segIdx: 1, alongRemainingM: 200 })!;
    const c = remainingRouteDurationS({ ...args, segIdx: 2, alongRemainingM: 100 })!;
    expect(a).toBe(60); expect(b).toBe(50); expect(c).toBe(30);
    // Aynı çağrı tekrar edilse bile değer DEĞİŞMEZ (birikim yok).
    expect(remainingRouteDurationS({ ...args, segIdx: 2, alongRemainingM: 100 })).toBe(30);
  });

  it('eksik girdi → null (kesin süre uydurulmaz)', () => {
    const p = parseRouteDurations([10, 20, 30], 4);
    const cumM = new Float64Array([300, 200, 100, 0]);
    expect(remainingRouteDurationS({
      cumulativeDurations: null, segmentDurations: null,
      cumulativeDistances: cumM, segIdx: 0, alongRemainingM: 300,
    })).toBeNull();
    expect(remainingRouteDurationS({
      cumulativeDurations: p.cumulativeDurations, segmentDurations: p.segmentDurations,
      cumulativeDistances: cumM, segIdx: 99, alongRemainingM: 300,
    })).toBeNull();
    expect(remainingRouteDurationS({
      cumulativeDurations: p.cumulativeDurations, segmentDurations: p.segmentDurations,
      cumulativeDistances: cumM, segIdx: 0, alongRemainingM: null,
    })).toBeNull();
  });

  it('mesafe ve süre dizileri FARKLI geometriye aitse reddedilir', () => {
    const p = parseRouteDurations([10, 20, 30], 4);
    expect(remainingRouteDurationS({
      cumulativeDurations: p.cumulativeDurations, segmentDurations: p.segmentDurations,
      cumulativeDistances: new Float64Array([500, 400, 0]), // 3 nokta ≠ 4
      segIdx: 0, alongRemainingM: 300,
    })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D. ETA MODELİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('D. ETA modeli', () => {
  const base = {
    navActive: true,
    remainingRouteDurationS: 600,
    durationIntegrity: 'VALID' as const,
    durationSource: 'OSRM_ANNOTATION' as const,
    routeRevision: 3,
    durationRevision: 3,
    remainingDistanceM: 10_000,
    rollingAvgKmh: 60,
    stopBufferS: 0,
  };

  it('geçerli süre modeli → ROUTE_MODEL', () => {
    const v = computeEta(base);
    expect(v.state).toBe('ROUTE_MODEL');
    expect(v.baseSeconds).toBe(600);
    // Model 10 km / 600 sn = 60 km/sa; gözlenen de 60 → çarpan 1
    expect(v.correctionFactor).toBeCloseTo(1, 3);
    expect(v.etaSeconds).toBe(600);
  });

  it('rota süresi ANA otoritedir — anlık hız onu EZEMEZ', () => {
    // Gözlenen hız modelin yarısı → ham oran 2, ama TAVAN 1.5
    const v = computeEta({ ...base, rollingAvgKmh: 30 });
    expect(v.state).toBe('ROUTE_MODEL');
    expect(v.correctionFactor).toBe(ETA_MAX_FACTOR);
    expect(v.etaSeconds).toBe(900);
  });

  it('hızlı gidilse bile ETA taban çarpanın altına inmez', () => {
    const v = computeEta({ ...base, rollingAvgKmh: 200 });
    expect(v.correctionFactor).toBe(ETA_MIN_FACTOR);
  });

  it('🔒 ARAÇ DURUNCA ETA SONSUZA ÇIKMAZ', () => {
    for (const kmh of [0, 0.5, ETA_MIN_CORRECTION_KMH - 0.1]) {
      const v = computeEta({ ...base, rollingAvgKmh: kmh });
      expect(v.correctionFactor).toBe(1);
      expect(v.etaSeconds).toBe(600);
      expect(Number.isFinite(v.etaSeconds as number)).toBe(true);
    }
  });

  it('🔒 ANLIK HIZ SIÇRAMASI ETA\'yı ZIPLATMAZ (çarpan kırpılı)', () => {
    const vals = [10, 40, 60, 90, 130, 200].map(
      (kmh) => computeEta({ ...base, rollingAvgKmh: kmh }).etaSeconds as number);
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(600 * ETA_MIN_FACTOR);
      expect(v).toBeLessThanOrEqual(600 * ETA_MAX_FACTOR);
    }
  });

  it('durma tamponu ETA\'ya EKLENİR', () => {
    expect(computeEta({ ...base, stopBufferS: 45 }).etaSeconds).toBe(645);
  });

  it('🔒 BAYAT ROTA SÜRESİ KULLANILMAZ → STALE, sayı YOK', () => {
    const v = computeEta({ ...base, durationRevision: 2 });
    expect(v.state).toBe('STALE');
    expect(v.etaSeconds).toBeNull();
  });

  it('reroute sonrası yeni revizyon ATOMİK devralınır', () => {
    const v = computeEta({ ...base, routeRevision: 4, durationRevision: 4,
      remainingRouteDurationS: 300, remainingDistanceM: 5_000 });
    expect(v.state).toBe('ROUTE_MODEL');
    expect(v.baseSeconds).toBe(300);
  });

  it('bozuk süre dizisi → DEGRADED_FALLBACK (mesafe ÷ hız)', () => {
    const v = computeEta({
      ...base, durationIntegrity: 'LENGTH_MISMATCH', remainingRouteDurationS: null,
    });
    expect(v.state).toBe('DEGRADED_FALLBACK');
    expect(v.etaSeconds).toBeGreaterThan(0);
  });

  it('🔒 DÜZ HAT OSRM ETA\'sı gibi GÖSTERİLMEZ', () => {
    const v = computeEta({
      ...base, durationSource: 'STRAIGHT_LINE_ESTIMATE',
      durationIntegrity: 'MISSING', remainingRouteDurationS: null,
    });
    expect(v.state).not.toBe('ROUTE_MODEL');
    expect(v.state).toBe('DEGRADED_FALLBACK');
    expect(v.source).toBe('STRAIGHT_LINE_ESTIMATE');
  });

  it('ne süre ne mesafe varsa sayı ÜRETİLMEZ', () => {
    const v = computeEta({
      ...base, remainingRouteDurationS: null, durationIntegrity: 'MISSING',
      remainingDistanceM: null,
    });
    expect(v.state).toBe('INSUFFICIENT_ROUTE_DATA');
    expect(v.etaSeconds).toBeNull();
  });

  it('navigasyon aktif değilse UNKNOWN', () => {
    expect(computeEta({ ...base, navActive: false }).state).toBe('UNKNOWN');
  });

  it('ETA asla negatif olmaz', () => {
    const v = computeEta({ ...base, remainingRouteDurationS: 0, remainingDistanceM: 0 });
    expect(v.etaSeconds).toBeGreaterThanOrEqual(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E. GÖRÜNÜM REGRESYONU + SAFLIK
   ══════════════════════════════════════════════════════════════════════════ */
describe('E. 🔒 Görünüm regresyonu', () => {
  it('🔒 NavigationHUD MANEVRA/REROUTE sesi ÜRETMEZ', () => {
    const s = code(hudSrc);
    // Kademeli anons ve reroute bildirimi görünümden ALINDI.
    expect(s).not.toContain('Şimdi ${');
    expect(s).not.toContain('metre sonra');
    expect(s).not.toContain('Rota yeniden hesaplanıyor');
    // Kademe durumu artık bileşen ref'i DEĞİL.
    expect(s).not.toContain('_spokenRef');
    expect(s).not.toContain('markFirstNewInstruction');
  });

  /* ⚠️ AÇIK BORÇ — BİLİNÇLİ OLARAK KAPSAM DIŞI:
   * `NavigationHUD` içinde LIMP_HOME (sistem koruma modu) için TEK bir
   * `speakNavigation` çağrısı KALDI. O bir navigasyon yönlendirmesi değil,
   * bilişsel/termal durum bildirimidir ve sahibi `useCognitiveStore`dur;
   * taşınması bu turun kapsamı (ses + DR + ETA) dışındadır. Kilit bunun
   * TEK ve YALNIZ o çağrı olduğunu sabitler — yenisi eklenemez. */
  it('🔒 HUD\'da kalan TEK ses çağrısı LIMP_HOME bildirimidir (açık borç)', () => {
    const s = code(hudSrc);
    const calls = s.match(/speakNavigation\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(s).toContain('Sistem koruma modu aktif');
  });

  it('🔒 FullMapView ve MiniMapWidget SES ÜRETMEZ', () => {
    expect(code(fullMapSrc)).not.toContain('speakNavigation(');
    expect(code(miniMapSrc)).not.toContain('speakNavigation(');
  });

  it('🔒 görünümler oturum motorunu BAŞLATIP DURDURMAZ', () => {
    for (const src of [hudSrc, fullMapSrc, miniMapSrc]) {
      const s = code(src);
      expect(s).not.toContain('startNavigationSessionRuntime');
      expect(s).not.toContain('stopNavigationSessionRuntime');
      expect(s).not.toContain('noteVoiceGuidanceTick');
      expect(s).not.toContain('resetVoiceGuidance');
    }
  });

  it('🔒 ETA tek otoritededir — görünüm kendi ETA\'sını hesaplamaz', () => {
    for (const src of [hudSrc, miniMapSrc]) {
      expect(code(src)).not.toContain('computeEta(');
    }
  });

  it('🔒 saf katmanlar I/O · saat · React KULLANMAZ', () => {
    for (const [name, src] of [
      ['voiceGuidanceModel', voiceModSrc],
      ['etaModel', etaModSrc],
      ['routeDurationModel', durModSrc],
    ] as const) {
      const s = code(src);
      for (const forbidden of ['fetch(', 'Date.now', 'performance.now', 'useState', 'setTimeout', 'setInterval']) {
        expect(s, `${name} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('🔒 ses runtime kendi GPS aboneliğini/timer\'ını KURMAZ', () => {
    const s = code(voiceRtSrc);
    expect(s).not.toContain('onGPSLocation');
    expect(s).not.toContain('setInterval');
    expect(s).not.toContain('requestAnimationFrame');
  });

  it('🔒 mini ve tam ekran AYNI store\'dan okur (tek ETA/ilerleme kaynağı)', () => {
    expect(code(hudSrc)).toContain('useNavigation()');
    expect(code(miniMapSrc)).toContain('useNavigation()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F. ENTEGRASYON — runtime tick zinciri
   ══════════════════════════════════════════════════════════════════════════ */
describe('F. Oturum motoru entegrasyonu', () => {
  beforeEach(() => { vi.resetModules(); });

  it('DR tick\'i navigasyon aktif değilken ilerleme ÜRETMEZ', async () => {
    const routing = await import('../platform/routingService');
    const spy = vi.spyOn(routing, 'updateRouteProgress');
    const rt = await import('../platform/navigation/navigationSessionRuntime');
    rt._resetNavigationSessionRuntimeForTest();
    rt._setLastFixForTest({ lat: 36.8, lng: 34.6, heading: 90, ts: 0, speedMs: 20 });
    rt._drTickForTest();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('anlık görüntü DR sahibini ve timer durumunu TAŞIR', async () => {
    const rt = await import('../platform/navigation/navigationSessionRuntime');
    rt._resetNavigationSessionRuntimeForTest();
    const s = rt.getNavigationSessionRuntimeSnapshot();
    expect(s.drOwner).toBe('NAV_SESSION_RUNTIME');
    expect(s.drTimerRunning).toBe(false);
    expect(s.drState).toBe('IDLE');
  });
});
