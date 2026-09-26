/**
 * tripJourneyIntentSemantics.test.ts
 *
 * YOLCULUK (JOURNEY) ile SÜRÜŞ GÜNLÜĞÜ (DRIVE_LOG) ayrımı.
 *
 * ── ÜRÜN KURALI ───────────────────────────────────────────────────────────
 * Navigasyon hedefi VARSA → "hedefe giden bir yolculuktayım".
 * Hedef YOKSA → "aracın hareket geçmişini kaydediyorum".
 *
 * CarOS kullanıcının niyetini UYDURMAZ: dinlenme tesisinde durmak, yakıt
 * almak, yemek yemek ve motoru kapatmak aktif rotadaki yolculuğu KENDİ
 * BAŞINA bitirmez. Hedefsiz sürüşte ise "yolculuk tamamlandı" hükmü HİÇ
 * verilmez — yalnız gerçek hareket/duruş geçmişi tutulur.
 *
 * ── KATMAN SINIRI ─────────────────────────────────────────────────────────
 * Depolama yaşam döngüsü (`tripLogService`in 60 sn duruş penceresiyle
 * mühürlediği `TripRecord`) ile ÜRÜN yolculuğu AYRI şeylerdir. Segmentin
 * kapanması yolculuğun bittiği anlamına GELMEZ; bu dosya tam olarak bu
 * ayrımı kilitler.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTripSession, projectTripSession, emptyTripSession,
  SESSION_MAX_BREAK_MS,
  type TripSession, type TripSessionSample, type TripSessionSegment,
} from '../platform/trip/core/tripSessionModel';
import { readNavIntent, registerNavIntentReader } from '../platform/trip/navIntentPort';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar — gerçek servis şekliyle aynı girdi biçimi
 * ════════════════════════════════════════════════════════════════════════ */

const MIN = 60_000;

function seg(over: Partial<TripSessionSegment> & { key: number }): TripSessionSegment {
  return {
    startedMonoMs: over.key,
    startedWallMs: 1_700_000_000_000,
    movingMs: 0, idleMs: 0, unknownMs: 0, distanceM: 0,
    stoppedSinceMonoMs: null,
    ...over,
  };
}

function sample(
  monoMs: number,
  segment: TripSessionSegment | null,
  intent: { routeActive?: boolean; arrivalSeq?: number } = {},
): TripSessionSample {
  return {
    monoMs, wallMs: 1_700_000_000_000 + monoMs,
    segment, lat: 36.9, lon: 34.6,
    routeActive: intent.routeActive === true,
    arrivalSeq: intent.arrivalSeq ?? 0,
  };
}

/** Rota aktif hâlde yola çıkmış bir yolculuk. */
function journeyUnderway(): TripSession {
  let s = emptyTripSession();
  s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN, movingMs: 0 }), { routeActive: true }));
  s = advanceTripSession(s, sample(40 * MIN, seg({
    key: 10 * MIN, movingMs: 30 * MIN, distanceM: 45_000,
  }), { routeActive: true }));
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) ROTA VAR → YOLCULUK
 * ════════════════════════════════════════════════════════════════════════ */

describe('rota aktifken oturum bir YOLCULUKTUR', () => {
  it('1 · aktif rota + normal sürüş → tek yolculuk, tür JOURNEY', () => {
    const s = journeyUnderway();
    const p = projectTripSession(s, 40 * MIN);
    expect(p.kind).toBe('JOURNEY');
    expect(p.segmentCount).toBe(1);
    expect(p.journeyCompleted).toBe(false);
    expect(p.movingMs).toBe(30 * MIN);
  });

  it('2 · dinlenme tesisinde 30 dk mola yolculuğu BİTİRMEZ', () => {
    let s = journeyUnderway();
    /* Depolama segmenti duruş penceresiyle KAPANIR (segment = null). */
    s = advanceTripSession(s, sample(41 * MIN, null, { routeActive: true }));
    const during = projectTripSession(s, 71 * MIN);      // 30 dk mola
    expect(during.state).toBe('STOPPED');
    expect(during.kind).toBe('JOURNEY');
    expect(during.journeyCompleted).toBe(false);
    expect(during.breakExceededSession).toBe(false);
    expect(during.sessionId).toBe(projectTripSession(journeyUnderway(), 40 * MIN).sessionId);
  });

  it('2b · rota aktifken 90 dk mola bile YENİ oturum açmaz (eşik işlemez)', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    s = advanceTripSession(s, sample(41 * MIN, null, { routeActive: true }));
    /* Eşiğin (45 dk) ÇOK üstünde bir mola — yemek + yakıt + uyku. */
    const resumeAt = 41 * MIN + 90 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt }), { routeActive: true }));
    expect(s.sessionId).toBe(id);
    expect(s.segmentCount).toBe(2);
    expect(projectTripSession(s, resumeAt).kind).toBe('JOURNEY');
  });

  it('3 · motor/ignition OFF (veri kesildi) yolculuğu BİTİRMEZ', () => {
    let s = journeyUnderway();
    /* Motor kapandı: örnek akmaz, depolama segmenti kapanır. */
    s = advanceTripSession(s, sample(41 * MIN, null, { routeActive: true }));
    const p = projectTripSession(s, 41 * MIN + 50 * MIN);
    expect(p.journeyCompleted).toBe(false);
    expect(p.kind).toBe('JOURNEY');
  });

  it('4 · aynı rotada yeniden hareket AYNI yolculuğu sürdürür', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    s = advanceTripSession(s, sample(41 * MIN, null, { routeActive: true }));
    const resumeAt = 61 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt, movingMs: 0 }), { routeActive: true }));
    s = advanceTripSession(s, sample(100 * MIN, seg({
      key: resumeAt, movingMs: 39 * MIN, distanceM: 60_000,
    }), { routeActive: true }));

    const p = projectTripSession(s, 100 * MIN);
    expect(p.sessionId).toBe(id);
    expect(p.segmentCount).toBe(2);
    /* Mesafe ve hareket süresi TOPLANIR — mola aradan çıkarılır. */
    expect(p.distanceMeters).toBe(105_000);
    expect(p.movingMs).toBe(69 * MIN);
    expect(p.journeyCompleted).toBe(false);
  });

  it('5 · reroute yolculuğu bitirmez (rota aktif kalır)', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    /* REROUTING de `isNavigating` sayılır → niyet sürüyor. */
    s = advanceTripSession(s, sample(45 * MIN, seg({
      key: 10 * MIN, movingMs: 35 * MIN, distanceM: 52_000,
    }), { routeActive: true }));
    expect(s.sessionId).toBe(id);
    expect(projectTripSession(s, 45 * MIN).journeyCompleted).toBe(false);
  });

  it('6 · hedef değişikliği tek başına YENİ yolculuk açmaz', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    /* Yeni hedef = yeni navigasyon oturumu; varış mührü ARTMADI. */
    s = advanceTripSession(s, sample(50 * MIN, seg({
      key: 10 * MIN, movingMs: 40 * MIN, distanceM: 70_000,
    }), { routeActive: true, arrivalSeq: 0 }));
    expect(s.sessionId).toBe(id);
    expect(s.completion).toBe('OPEN');
    expect(projectTripSession(s, 50 * MIN).segmentCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) VARIŞ — TEK MEŞRU TAMAMLANMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('tamamlanma hükmü', () => {
  it('7 · mühürlenmiş varış → DESTINATION_REACHED', () => {
    let s = journeyUnderway();
    s = advanceTripSession(s, sample(60 * MIN, seg({
      key: 10 * MIN, movingMs: 50 * MIN, distanceM: 90_000,
    }), { routeActive: true, arrivalSeq: 1 }));

    const p = projectTripSession(s, 60 * MIN);
    expect(p.completion).toBe('DESTINATION_REACHED');
    expect(p.journeyCompleted).toBe(true);
  });

  it('7b · varıştan sonraki YENİ hareket YENİ yolculuktur', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    s = advanceTripSession(s, sample(60 * MIN, seg({
      key: 10 * MIN, movingMs: 50 * MIN,
    }), { routeActive: true, arrivalSeq: 1 }));
    s = advanceTripSession(s, sample(61 * MIN, null, { routeActive: false, arrivalSeq: 1 }));
    /* Kısa bir mola — eşiğin ALTINDA; yine de varılmış yolculuğa eklenmez. */
    s = advanceTripSession(s, sample(70 * MIN, seg({ key: 70 * MIN }), { arrivalSeq: 1 }));
    expect(s.sessionId).not.toBe(id);
    expect(s.completion).toBe('OPEN');
    expect(s.segmentCount).toBe(1);
  });

  it('8 · rota İPTALİ varış SAYILMAZ', () => {
    let s = journeyUnderway();
    const id = s.sessionId;
    /* Kullanıcı yanlış hedefi iptal etti: rota kapandı, varış mührü ARTMADI. */
    s = advanceTripSession(s, sample(45 * MIN, seg({
      key: 10 * MIN, movingMs: 35 * MIN,
    }), { routeActive: false, arrivalSeq: 0 }));

    const p = projectTripSession(s, 45 * MIN);
    expect(p.completion).toBe('OPEN');
    expect(p.journeyCompleted).toBe(false);
    expect(p.sessionId).toBe(id);          // sürüş devam ediyor
    /* Niyet GERÇEKTEN vardı — iptal onu geçmişe dönük silmez. */
    expect(p.kind).toBe('JOURNEY');
  });

  it('8b · oturum açılışından ÖNCEKİ varış bu yolculuğu tamamlamaz', () => {
    /* Önceki yolculukta varış olmuş (seq = 3) ve mühür KALICI. */
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(10 * MIN, seg({ key: 10 * MIN }), {
      routeActive: true, arrivalSeq: 3,
    }));
    s = advanceTripSession(s, sample(20 * MIN, seg({ key: 10 * MIN, movingMs: 10 * MIN }), {
      routeActive: true, arrivalSeq: 3,
    }));
    expect(s.completion).toBe('OPEN');
    /* Yeni varış (4) ise sahiplenilir. */
    s = advanceTripSession(s, sample(30 * MIN, seg({ key: 10 * MIN, movingMs: 20 * MIN }), {
      routeActive: true, arrivalSeq: 4,
    }));
    expect(s.completion).toBe('DESTINATION_REACHED');
  });

  it('9 · GPS geçici kaybı tamamlanma ÜRETMEZ', () => {
    let s = journeyUnderway();
    /* Kanıt yokluğu segmenti kapatır ama hüküm vermez. */
    s = advanceTripSession(s, sample(42 * MIN, null, { routeActive: true }));
    s = advanceTripSession(s, sample(44 * MIN, seg({ key: 44 * MIN }), { routeActive: true }));
    expect(s.completion).toBe('OPEN');
    expect(projectTripSession(s, 44 * MIN).journeyCompleted).toBe(false);
  });

  it('10 · OBD kopması tamamlanma ÜRETMEZ', () => {
    let s = journeyUnderway();
    s = advanceTripSession(s, sample(43 * MIN, null, { routeActive: true }));
    const p = projectTripSession(s, 43 * MIN + 20 * MIN);
    expect(p.journeyCompleted).toBe(false);
    expect(p.completion).toBe('OPEN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) ROTA YOK → SÜRÜŞ GÜNLÜĞÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('rota yokken oturum SÜRÜŞ GÜNLÜĞÜDÜR', () => {
  it('12 · hedefsiz hareket kaydedilir, tür DRIVE_LOG', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    s = advanceTripSession(s, sample(42 * MIN, seg({
      key: 8 * MIN, movingMs: 34 * MIN, distanceM: 26_000,
    })));

    const p = projectTripSession(s, 42 * MIN);
    expect(p.kind).toBe('DRIVE_LOG');
    expect(p.movingMs).toBe(34 * MIN);
    expect(p.distanceMeters).toBe(26_000);
    expect(p.journeyCompleted).toBe(false);
  });

  it('13 · hedefsiz duruş "yolculuk tamamlandı" ÜRETMEZ', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    s = advanceTripSession(s, sample(42 * MIN, seg({ key: 8 * MIN, movingMs: 34 * MIN, distanceM: 26_000 })));
    s = advanceTripSession(s, sample(43 * MIN, null));

    const p = projectTripSession(s, 60 * MIN);
    expect(p.state).toBe('STOPPED');
    expect(p.journeyCompleted).toBe(false);
    expect(p.completion).toBe('OPEN');
  });

  it('14 · hedefsiz yeniden hareket geçmişi SÜRDÜRÜR', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    s = advanceTripSession(s, sample(42 * MIN, seg({ key: 8 * MIN, movingMs: 34 * MIN, distanceM: 26_000 })));
    const id = s.sessionId;
    s = advanceTripSession(s, sample(43 * MIN, null));
    s = advanceTripSession(s, sample(60 * MIN, seg({ key: 60 * MIN, movingMs: 0, distanceM: 0 })));
    s = advanceTripSession(s, sample(78 * MIN, seg({ key: 60 * MIN, movingMs: 18 * MIN, distanceM: 14_000 })));

    const p = projectTripSession(s, 78 * MIN);
    expect(p.sessionId).toBe(id);
    expect(p.segmentCount).toBe(2);
    expect(p.distanceMeters).toBe(40_000);
    expect(p.stopPeriods.length).toBe(1);
    expect(p.journeyCompleted).toBe(false);
  });

  it('15 · depolama segmentinin kapanması ÜRÜN yolculuğunu bitirmez', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    s = advanceTripSession(s, sample(42 * MIN, seg({ key: 8 * MIN, movingMs: 34 * MIN, distanceM: 26_000 })));
    /* `tripLogService` duruş penceresini doldurdu → TripRecord MÜHÜRLENDİ. */
    s = advanceTripSession(s, sample(43 * MIN, null));

    const p = projectTripSession(s, 44 * MIN);
    /* Kayıt kapandı ama ürün "yolculuk tamamlandı" DEMEZ. */
    expect(p.journeyCompleted).toBe(false);
    expect(p.sessionId).not.toBeNull();
  });

  it('15b · hedefsiz sürüşte uzun mola YENİ BLOK açar ama tamamlanma İLAN ETMEZ', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    s = advanceTripSession(s, sample(42 * MIN, seg({ key: 8 * MIN, movingMs: 34 * MIN, distanceM: 26_000 })));
    const id = s.sessionId;
    s = advanceTripSession(s, sample(43 * MIN, null));

    const during = projectTripSession(s, 43 * MIN + SESSION_MAX_BREAK_MS + MIN);
    /* Eşik aşıldı: bir sonraki hareket yeni BLOK açacak... */
    expect(during.breakExceededSession).toBe(true);
    /* ...ama bu bir "yolculuk tamamlandı" hükmü DEĞİLDİR. */
    expect(during.journeyCompleted).toBe(false);
    expect(during.completion).toBe('OPEN');

    const resumeAt = 43 * MIN + SESSION_MAX_BREAK_MS + 2 * MIN;
    s = advanceTripSession(s, sample(resumeAt, seg({ key: resumeAt })));
    expect(s.sessionId).not.toBe(id);
    expect(s.kind).toBe('DRIVE_LOG');
  });

  it('11 · yolda hedef girilirse AYNI sürüş yolculuğa YÜKSELİR (bölünmez)', () => {
    let s = emptyTripSession();
    s = advanceTripSession(s, sample(8 * MIN, seg({ key: 8 * MIN })));
    const id = s.sessionId;
    expect(s.kind).toBe('DRIVE_LOG');
    s = advanceTripSession(s, sample(20 * MIN, seg({ key: 8 * MIN, movingMs: 12 * MIN }), {
      routeActive: true,
    }));
    expect(s.kind).toBe('JOURNEY');
    expect(s.sessionId).toBe(id);
    expect(s.segmentCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) NİYET KAPISI — kanıtsız yolculuk iddiası YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('navigasyon niyeti kapısı', () => {
  it('kayıt YOKSA niyet yok sayılır — sahte hedef üretilmez', () => {
    registerNavIntentReader(null);
    expect(readNavIntent()).toEqual({ routeActive: false, arrivalSeq: 0 });
  });

  it('okuma patlarsa FAIL-SOFT: niyet yokluğu döner', () => {
    registerNavIntentReader(() => { throw new Error('nav down'); });
    expect(readNavIntent()).toEqual({ routeActive: false, arrivalSeq: 0 });
    registerNavIntentReader(null);
  });

  it('bozuk varış sırası 0 sayılır — sahte varış sahiplenilmez', () => {
    registerNavIntentReader(() => ({ routeActive: true, arrivalSeq: Number.NaN }));
    expect(readNavIntent()).toEqual({ routeActive: true, arrivalSeq: 0 });
    registerNavIntentReader(null);
  });

  it('niyet kapısı MESAFE/ETA taşımaz (ikinci mesafe sahibi doğmadı)', () => {
    registerNavIntentReader(() => ({ routeActive: true, arrivalSeq: 2 }));
    expect(Object.keys(readNavIntent()).sort()).toEqual(['arrivalSeq', 'routeActive']);
    registerNavIntentReader(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) ÜRETİM ERİŞİLEBİLİRLİĞİ — kapı GERÇEKTEN bağlı mı
 * ════════════════════════════════════════════════════════════════════════ */

function src(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf-8');
}

describe('üretim yolu — niyet köprüsü bağlı', () => {
  it('kompozisyon kökü okuyucuyu KAYDEDER (yoksa niyet hiç görünmezdi)', () => {
    const wiring = src('src', 'hooks', 'useLayoutServices.ts');
    expect(wiring).toContain('registerNavIntentReader');
    expect(wiring).toContain('getNavArrivalMark');
    expect(wiring).toContain('isNavigating');
    /* Kayıt oturumdan ÖNCE yapılmalı: ilk örnek bile niyeti görsün. */
    expect(wiring.indexOf('registerNavIntentReader('))
      .toBeLessThan(wiring.indexOf('startTripSession()'));
  });

  it('oturum katmanı navigasyonu IMPORT ETMEZ — yalnız ince kapıdan okur', () => {
    const service = src('src', 'platform', 'trip', 'tripSessionService.ts');
    expect(service).toContain("from './navIntentPort'");
    expect(service).not.toMatch(/from '\.\.\/navigationService'/);
    const port = src('src', 'platform', 'trip', 'navIntentPort.ts');
    /* Kapının çalışma zamanı bağımlılığı YOK (tip importu bile gerekmedi). */
    expect(port).not.toMatch(/^import\s+(?!type)/m);
  });

  it('varış MÜHÜRLENİR ve iptal onu SİLMEZ (5 sn penceresi kaçmasın)', () => {
    const nav = src('src', 'platform', 'navigationService.ts');
    /* Mühür varış kararının İÇİNDE yazılır — ayrı bir dedektör YOK. */
    const arrivedBody = nav.slice(
      nav.indexOf('function transitionToArrived'),
      nav.indexOf('function transitionToArrived') + 900,
    );
    expect(arrivedBody).toContain('_arrivalMark');
    expect(arrivedBody).toContain('seq: _arrivalMark.seq + 1');
    /* `stopNavigation` her izi temizler AMA mührü temizlemez. */
    const stopBody = nav.slice(
      nav.indexOf('export function stopNavigation'),
      nav.indexOf('export function getNavigationState'),
    );
    expect(stopBody).not.toContain('_arrivalMark');
  });

  it('17 · harsh-event tek otoritesi (9d78b68e) bozulmadı', () => {
    const trip = src('src', 'platform', 'tripLogService.ts');
    expect(trip).not.toContain('_active.harshBrakeEvents');
    expect(trip).not.toContain('_active.harshAccelEvents');
    expect(trip).toContain('harshBrakeCount: acc.harshBrakeCount');
    const model = src('src', 'components', 'cockpit', 'tripComputerModel.ts');
    expect(model).toContain('metric(m.harshBrakeCount');
    expect(model).toContain('metric(m.harshAccelCount');
  });

  it('11 · yeniden başlatma: oturum TEMİZ açılır, eski varış devralınmaz', () => {
    /* Süreç öldü → modül durumu sıfırdan doğar (bilinen sınır; bkz. rapor).
       Kritik olan: kalıcı varış mührü yeni oturumu SAHTE tamamlamaz ve
       duplicate bir "tamamlanmış yolculuk" doğmaz. */
    const fresh = emptyTripSession();
    expect(fresh.sessionId).toBeNull();
    expect(fresh.completion).toBe('OPEN');
    const s = advanceTripSession(fresh, sample(5 * MIN, seg({ key: 5 * MIN }), {
      routeActive: true, arrivalSeq: 7,      // restart ÖNCESİ varış mührü
    }));
    expect(s.completion).toBe('OPEN');
    expect(s.arrivalSeqAtOpen).toBe(7);
    expect(projectTripSession(s, 5 * MIN).journeyCompleted).toBe(false);
  });
});
