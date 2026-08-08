/**
 * tripSessionModel.test.ts — SEYAHAT OTURUMU kilitleri.
 *
 * KİLİTLENEN KUSUR: Mavi "3 saattir yoldayız" derken gerçek 40 dakikaydı ve
 * kat edilen km de yanlıştı. KÖK: `tripLogService`'te kapanış penceresi YALNIZ
 * `_onGPS`/`_onOBD` gövdesinde kuruluyordu; araç park edip veri tamamen
 * susunca yolculuk hiç kapanmıyor ve bir sonraki sürüşte AYNI oturum devam
 * ediyordu (`liveDurationMin` monotonik olduğu için park süresini de sayardı).
 *
 * Bu dosya İKİ şeyi kilitler:
 *   1. Saf oturum modelinin davranışı (mola ≠ yolculuk sonu, çifte sayım yok).
 *   2. Sahiplik sözleşmesi: bu katman HİÇBİR ŞEY ÖLÇMEZ (yapısal kilitler).
 */

import { describe, it, expect } from 'vitest';
import {
  emptyTripSession, advanceTripSession, projectTripSession,
  SESSION_MAX_BREAK_MS, MAX_STOP_PERIODS,
  type TripSession, type TripSessionSegment, type TripSessionSample,
} from '../platform/trip/core/tripSessionModel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const modelSrc   = read('src/platform/trip/core/tripSessionModel.ts');
const serviceSrc = read('src/platform/trip/tripSessionService.ts');
const logSrc     = read('src/platform/tripLogService.ts');

const MIN = 60_000;

/** Segment kurucu — kümülatif değerler `tripLogService` otoritesini taklit eder. */
function seg(over: Partial<TripSessionSegment> = {}): TripSessionSegment {
  return {
    key: 1000, startedMonoMs: 1000, startedWallMs: 1_700_000_000_000,
    movingMs: 0, idleMs: 0, unknownMs: 0, distanceM: 0,
    stoppedSinceMonoMs: null,
    ...over,
  };
}

function sample(monoMs: number, s: TripSessionSegment | null,
                over: Partial<TripSessionSample> = {}): TripSessionSample {
  return { monoMs, wallMs: 1_700_000_000_000 + monoMs, segment: s, lat: null, lon: null, ...over };
}

/** Kullanıcı senaryosu: 08:20 hareket · 08:50 durdu · 09:10 tekrar hareket. */
function breakScenario(): { session: TripSession; resumeMono: number } {
  const t0 = 1000;                       // 08:20 — hareket başladı
  let s = emptyTripSession();

  // 30 dk hareket
  s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0 })));
  s = advanceTripSession(s, sample(t0 + 30 * MIN, seg({
    key: t0, startedMonoMs: t0, movingMs: 30 * MIN, distanceM: 40_000,
  })));

  // 08:50 — yolculuk kapandı (tripLog trip'i bitti) → MOLA başlar
  s = advanceTripSession(s, sample(t0 + 30 * MIN, null));

  // 09:10 — 20 dk sonra yeni yolculuk başlar
  const resumeMono = t0 + 50 * MIN;
  s = advanceTripSession(s, sample(resumeMono, seg({
    key: resumeMono, startedMonoMs: resumeMono,
  })));
  return { session: s, resumeMono };
}

describe('TripSession — mola yolculuğu BİTİRMEZ', () => {
  it('KULLANICI SENARYOSU: 50 dk geçti · 30 dk hareket · 20 dk mola', () => {
    const { session, resumeMono } = breakScenario();
    const p = projectTripSession(session, resumeMono);

    expect(Math.round(p.elapsedMs / MIN), 'yola çıkalı geçen süre').toBe(50);
    expect(Math.round(p.movingMs / MIN), 'hareket süresi').toBe(30);
    expect(Math.round(p.stoppedMs / MIN), 'mola süresi').toBe(20);
  });

  it('AYNI oturum devam eder — mola yeni oturum AÇMAZ', () => {
    const { session } = breakScenario();
    expect(session.segmentCount, 'mola iki ayrı seyahat üretmiş').toBe(2);
    expect(session.sessionId).toBe('session-1000');   // ilk segmentin başlangıcı
  });

  it('Oturum başlangıcı HAREKET anıdır (gözlem anı değil)', () => {
    // Rota kurulup 20 dk beklendikten SONRA hareket edilirse başlangıç hareket anıdır.
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(500, null));            // rota var, hareket YOK
    expect(s.startMonoMs, 'hareketsizken oturum açılmış').toBeNull();

    s = advanceTripSession(s, sample(20 * MIN, seg({ key: 20 * MIN, startedMonoMs: 20 * MIN })));
    expect(s.startMonoMs).toBe(20 * MIN);
    expect(projectTripSession(s, 20 * MIN).elapsedMs).toBe(0);
  });

  it('MOLA EŞİĞİ aşılınca sonraki hareket YENİ oturum başlatır', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0, distanceM: 5000 })));
    s = advanceTripSession(s, sample(t0 + MIN, null));       // mola başladı

    const late = t0 + MIN + SESSION_MAX_BREAK_MS + 1;
    s = advanceTripSession(s, sample(late, seg({ key: late, startedMonoMs: late })));

    expect(s.segmentCount, 'eşik aşıldı ama eski oturum sürüyor').toBe(1);
    expect(s.sessionId).toBe(`session-${late}`);
    expect(projectTripSession(s, late).distanceMeters, 'eski mesafe yeni oturuma taşındı').toBe(0);
  });

  it('Süren mola OKUMA ANINDA büyür (yeni timer gerekmez)', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0 })));
    /* Üretimde `tripLogService` aktif yolculukta 5 sn'de bir yayın yapar; son
       AKTİF örnek ile kapanış arasındaki fark saniyeler mertebesindedir. */
    s = advanceTripSession(s, sample(t0 + 10 * MIN, seg({
      key: t0, startedMonoMs: t0, movingMs: 10 * MIN,
    })));
    s = advanceTripSession(s, sample(t0 + 10 * MIN, null));  // yolculuk kapandı → mola

    const p = projectTripSession(s, t0 + 25 * MIN);          // 15 dk sonra okundu
    expect(Math.round(p.currentBreakMs / MIN)).toBe(15);
    expect(Math.round(p.stoppedMs / MIN)).toBe(15);
    expect(p.breakExceededSession, '15 dk eşiği aşmamalı').toBe(false);
  });

  it('MOLA son DOĞRULANAN hareket anından başlar (bilinmeyen boşluk molaya yazılır)', () => {
    /* Bilinçli ve temkinli kural: aktif segmenti en son gördüğümüz andan sonrası
       "hareket" olarak İDDİA EDİLEMEZ. Üretimde bu fark 5 sn'lik tick kadardır;
       kanıtsız hareket saymaktansa molaya yazmak dürüst olan taraftır. */
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0 })));
    s = advanceTripSession(s, sample(t0 + 5 * MIN, null));
    expect(s.breakSinceMonoMs, 'mola kapanış anından başlatılmış').toBe(t0);
  });

  it('Uzun mola okuma anında EŞİK AŞIMI ilan eder', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0 })));
    s = advanceTripSession(s, sample(t0 + MIN, null));
    const p = projectTripSession(s, t0 + MIN + SESSION_MAX_BREAK_MS);
    expect(p.breakExceededSession).toBe(true);
  });
});

describe('TripSession — MESAFE sahipliği (çifte sayım YOK)', () => {
  it('Segment mesafesi KÜMÜLATİFtir — model biriktirmez', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0, distanceM: 1000 })));
    s = advanceTripSession(s, sample(t0 + MIN, seg({ key: t0, startedMonoMs: t0, distanceM: 2000 })));
    s = advanceTripSession(s, sample(t0 + 2 * MIN, seg({ key: t0, startedMonoMs: t0, distanceM: 3000 })));
    // Biriktirseydi 1000+2000+3000 = 6000 olurdu.
    expect(projectTripSession(s, t0 + 2 * MIN).distanceMeters).toBe(3000);
  });

  it('İKİ segment TOPLANIR, üst üste binmez', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0, distanceM: 10_000 })));
    s = advanceTripSession(s, sample(t0 + MIN, null));
    const k2 = t0 + 2 * MIN;
    s = advanceTripSession(s, sample(k2, seg({ key: k2, startedMonoMs: k2, distanceM: 4_000 })));
    expect(projectTripSession(s, k2).distanceMeters).toBe(14_000);
  });

  it('Segment sıfırlanınca (yeni yolculuk) mesafe GERİ GİTMEZ', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0, distanceM: 8_000 })));
    const k2 = t0 + 2 * MIN;
    // Mola görülmeden doğrudan yeni segment (distanceM 0'dan başlar)
    s = advanceTripSession(s, sample(k2, seg({ key: k2, startedMonoMs: k2, distanceM: 0 })));
    expect(projectTripSession(s, k2).distanceMeters).toBe(8_000);
  });
});

describe('TripSession — FAIL-SAFE kapıları', () => {
  it('Geriye giden zaman örneği YOK SAYILIR', () => {
    const t0 = 10_000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0, distanceM: 5_000 })));
    const before = s;
    s = advanceTripSession(s, sample(t0 - 5_000, seg({ key: t0, startedMonoMs: t0, distanceM: 99_000 })));
    expect(s).toBe(before);
  });

  it('Bozuk örnek oturumu DEĞİŞTİRMEZ', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1000, seg()));
    const before = s;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      s = advanceTripSession(s, sample(bad, seg()));
    }
    expect(s).toBe(before);
  });

  it('Bozuk segment (key yok) MOLA sayılır — sahte segment üretilmez', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1000, seg({ key: 1000, startedMonoMs: 1000 })));
    s = advanceTripSession(s, {
      monoMs: 2000, wallMs: 0, lat: null, lon: null,
      segment: { bogus: true } as unknown as TripSessionSegment,
    });
    expect(s.state).toBe('STOPPED');
    expect(s.currentSegment).toBeNull();
  });

  it('Hiç hareket edilmediyse oturum AÇILMAZ (sahte sıfırlar yok)', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(1000, null));
    s = advanceTripSession(s, sample(9_999_999, null));
    const p = projectTripSession(s, 9_999_999);
    expect(p.sessionId).toBeNull();
    expect(p.state).toBe('NOT_STARTED');
    expect(p.elapsedMs).toBe(0);
    expect(p.distanceMeters).toBe(0);
  });

  it('ÖLÇÜLEMEYEN süre MOLA sayılmaz — ayrı kovada durur', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({
      key: t0, startedMonoMs: t0, movingMs: 5 * MIN, idleMs: 2 * MIN, unknownMs: 7 * MIN,
    })));
    const p = projectTripSession(s, t0);
    expect(Math.round(p.stoppedMs / MIN), 'bilinmeyen süre molaya karışmış').toBe(2);
    expect(Math.round(p.unknownMs / MIN)).toBe(7);
  });

  it('Mola kaydı SINIRSIZ büyümez', () => {
    let s = emptyTripSession();
    let t = 1000;
    s = advanceTripSession(s, sample(t, seg({ key: t, startedMonoMs: t })));
    for (let i = 0; i < MAX_STOP_PERIODS + 20; i++) {
      t += MIN;
      s = advanceTripSession(s, sample(t, null));
      t += MIN;
      s = advanceTripSession(s, sample(t, seg({ key: t, startedMonoMs: t })));
    }
    expect(s.stopPeriods.length).toBeLessThanOrEqual(MAX_STOP_PERIODS);
  });

  it('Duruş (segment içi) durumu STOPPED yapar ama oturumu bitirmez', () => {
    const t0 = 1000;
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(t0, seg({ key: t0, startedMonoMs: t0 })));
    s = advanceTripSession(s, sample(t0 + MIN, seg({
      key: t0, startedMonoMs: t0, stoppedSinceMonoMs: t0 + 30_000,
    })));
    expect(s.state).toBe('STOPPED');
    expect(s.sessionId).toBe('session-1000');
    expect(s.segmentCount).toBe(1);
  });
});

describe('🔒 YAPISAL — ikinci ölçüm sahibi doğmadı', () => {
  it('Saf model HİÇBİR ŞEY import etmez (I/O · timer · saat yok)', () => {
    const code = modelSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code, 'saf model dışarıya bağımlı hâle gelmiş').not.toMatch(/^\s*import\s/m);
    expect(code, 'saf modele I/O · timer · saat girmiş')
      .not.toMatch(/addEventListener|setInterval|setTimeout|Date\.now\(|performance\.now\(/);
  });

  it('Oturum katmanı YENİ ZAMANLAYICI kurmaz', () => {
    expect(serviceSrc, 'oturum katmanına timer eklenmiş')
      .not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
  });

  it('Oturum katmanı ODOMETREYE ve DR mesafesine DOKUNMAZ', () => {
    expect(serviceSrc).not.toMatch(/odometer|advanceAlongRoute|consumedM|drDistance/i);
    expect(modelSrc.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/odometer|advanceAlongRoute/i);
  });

  it('Oturum katmanı KALAN rota mesafesini okumaz', () => {
    expect(serviceSrc).not.toMatch(/updateRouteProgress|distanceMeters.*nav|routeRemain/i);
    expect(serviceSrc).not.toMatch(/navigationService|routingService/);
  });

  it('Oturum katmanı yalnız tripLogService YAYININA abone olur (tek abonelik)', () => {
    const subs = serviceSrc.match(/onTripState\(/g) ?? [];
    expect(subs.length, 'ikinci abonelik doğmuş').toBe(1);
    expect(serviceSrc).not.toMatch(/onGPSLocation|onOBDData/);
  });

  it('Oturum katmanı HİÇBİR ŞEY YAZMAZ (salt okuma)', () => {
    expect(serviceSrc).not.toMatch(/safeSetRaw|localStorage\.setItem|updateSettings|setState\(/);
  });
});

describe('🔒 tripLogService — kapanış kusuru kapandı', () => {
  it('Veri sessizliği damgası HER İKİ örnek yolunda yazılır', () => {
    const stamps = logSrc.match(/lastSamplePerfMs = performance\.now\(\)/g) ?? [];
    expect(stamps.length, 'sessizlik damgası eksik yolda kalmış').toBe(2);
  });

  it('Bitiş değerlendirmesi MEVCUT tick\'e bağlandı — yeni timer YOK', () => {
    expect(logSrc).toContain('_liveClock = setInterval(_liveTick, 5_000)');
    expect(logSrc).toMatch(/silentMs >= TRIP_SILENCE_END_MS/);
    // Yalnız iki zamanlayıcı olmalı: _idleTimer (setTimeout) ve _liveClock.
    const intervals = logSrc.match(/setInterval\(/g) ?? [];
    expect(intervals.length, 'tripLogService\'e yeni interval eklenmiş').toBe(1);
  });

  it('SESSİZLİK eşiği DURUŞ eşiğinden belirgin biçimde UZUN (tünel bölünmesin)', () => {
    /* 60 sn'de kapatmak uzun tünelde sürüşü ortadan bölerdi (Ovit ≈ 11 dk). */
    const m = logSrc.match(/const TRIP_SILENCE_END_MS\s*=\s*(\d+)\s*\*\s*60_000/);
    expect(m, 'sessizlik eşiği kaldırılmış').not.toBeNull();
    expect(Number(m![1]), 'sessizlik eşiği tünel süresinin altına düşmüş')
      .toBeGreaterThanOrEqual(12);
  });

  it('Sessizlik kapanışı DÜZGÜN KAPANIŞ İDDİA ETMEZ', () => {
    /* Duruşu görmedik, kanıtı kaybettik → `cleanClose` true YAZILMAMALI. */
    const tick = logSrc.slice(logSrc.indexOf('function _liveTick'),
                              logSrc.indexOf('function _startTrip'));
    expect(tick).not.toMatch(/cleanClose\s*=\s*true/);
  });

  it('DURUŞ tabanlı kapanış (60 sn) KORUNDU — eski davranış bozulmadı', () => {
    expect(logSrc).toContain('const TRIP_END_IDLE_MS     = 60_000;');
    const idle = logSrc.match(/}, TRIP_END_IDLE_MS\);/g) ?? [];
    expect(idle.length, 'duruş penceresi yolları değişmiş').toBe(2);
  });
});
