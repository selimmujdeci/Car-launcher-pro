/**
 * maviEcoScoreQuery.test.ts — "MAVİ, EKO PUANIM KAÇ" KİLİTLERİ.
 *
 *   A · ayrıştırıcı — tanıma + gasp YOK (ekolayzır / maç skoru / sürüş modu)
 *   B · sesli cevap (saf) — kısa, dürüst, veri yoksa sayı YOK
 *   C · voiceInfoService — gerçek geçmiş, yüklenmemiş geçmiş "yok" SANILMAZ
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  spoken: [] as string[],
  loaded: true,
  history: [] as unknown[],
  active: false,
}));

vi.mock('../platform/assistant/maviSpeech', () => ({
  speakMaviAnswer: (t: string) => { M.spoken.push(t); },
}));
vi.mock('../platform/tripLogService', () => ({
  ensureTripHistoryLoaded: () => M.loaded,
  getTripSnapshot: () => ({ history: M.history, active: M.active }),
}));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), speakSafetyAlert: vi.fn(),
  speakAlert: vi.fn(), ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/vehicleMaintenanceService', () => ({ getMaintenanceSummaryText: async () => '' }));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => '', refreshWeather: async () => {},
  onWeatherState: () => () => {}, weatherQueryNamesCity: () => false,
}));

import { parseCommand } from '../platform/commandParser';
import { VEHICLE_TYPES } from '../platform/voice/contextGrammarModel';
import { commandTypeToIntentType } from '../platform/intentEngine';
import { buildEcoScoreSpeech, tripEcoScore } from '../platform/trip/ecoScoreModel';
import { isInformationalCommand, answerInformational } from '../platform/voiceInfoService';
import type { TripRecord } from '../platform/tripLogService';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

const DAY = 24 * 3600_000;
const NOW = 100 * DAY;
type Dyn = NonNullable<TripRecord['ecoDynamics']>;

function trip(id: string, endAgoDays: number, dyn: Partial<Dyn> | null = {}, over: Partial<TripRecord> = {}): TripRecord {
  return {
    id, startTime: 0, endTime: NOW - endAgoDays * DAY,
    distanceKm: 20, durationMin: 20, avgSpeedKmh: 60, maxSpeedKmh: 90,
    fuelConsumptionL: null, fuelCostTL: null, drivingScore: 100, harshEvents: 0,
    timeCoverage: 0.95, metricsVersion: dyn ? 2 : 1,
    ...(dyn === null ? {} : {
      ecoDynamics: {
        accelSec: 200, accelOverSec: 0, decelSec: 200, decelHardSec: 0,
        movingSec: 1_200, over110Sec: 0, over130Sec: 0, ...dyn,
      },
    }),
    ...over,
  };
}

/* ══════════════════ A · AYRIŞTIRICI ══════════════════ */

describe('A · ayrıştırıcı', () => {
  it.each([
    'eko puanım kaç', 'Mavi eko puanım ne', 'eko puanımı söyle', 'eko skorum kaç',
    'sürüş puanım kaç', 'sürüş karnem nasıl', 'sürüşüm nasıl', 'sürüşüm nasıldı',
    'ekonomik sürüyor muyum', 'ekonomik sürdüm mü', 'tasarruflu sürüyor muyum',
  ])('"%s" → trip_eco_score (tam güven)', (text) => {
    const c = parseCommand(text);
    expect(c?.type).toBe('trip_eco_score');
    expect(c?.confidence).toBe(1);
  });

  it.each([
    ['ekolayzırı aç', 'trip_eco_score'],
    ['maçın skoru ne', 'trip_eco_score'],
    ['puan durumu nasıl', 'trip_eco_score'],
    ['ekonomi haberleri', 'trip_eco_score'],
    /* 'nasıl' dolgu kelimesi → 'sürdüm'e iner; düz cümle gasp riski yüzünden kalıp yok. */
    ['eve kadar ben sürdüm', 'trip_eco_score'],
  ])('🔒 "%s" eko puanına GASP EDİLMEZ', (text, notType) => {
    expect(parseCommand(text)?.type ?? null).not.toBe(notType);
  });

  it('🔒 komşu komutlar yerinde kalır (sürüş modu · yakıt · bakım)', () => {
    expect(parseCommand('sürüş moduna geç')?.type).toBe('driving_mode');
    expect(parseCommand('bakım ne zaman')?.type).toBe('vehicle_maintenance');
    expect(parseCommand('yakıt ne kadar')?.type).not.toBe('trip_eco_score');
  });

  it('bilgi sorgusudur: eylem intent\'i YOK, araç gramerinde tanınır', () => {
    expect(isInformationalCommand('trip_eco_score')).toBe(true);
    expect(commandTypeToIntentType('trip_eco_score')).toBe('UNKNOWN');
    expect(VEHICLE_TYPES).toContain('trip_eco_score');
  });
});

/* ══════════════════ B · SESLİ CEVAP (SAF) ══════════════════ */

describe('B · sesli cevap', () => {
  it('haftalık puan + bant + gelişim ipucu', () => {
    const s = buildEcoScoreSpeech([trip('a', 1, { accelOverSec: 30 })], NOW, false);
    const score = tripEcoScore(trip('a', 1, { accelOverSec: 30 })).score;
    expect(s).toContain(`Bu hafta eko puanın ${score}`);
    expect(s).toContain('Gelişim alanın hızlanma.');
    expect(s).not.toContain('Son yolculuğun');           // tek yolculuk = haftalık puan
  });

  it('her şey iyiyse ipucu yerine övgü', () => {
    const s = buildEcoScoreSpeech([trip('a', 1)], NOW, false);
    expect(s).toContain('Bu hafta eko puanın 100, çok iyi.');
    expect(s).toContain('Böyle devam');
    expect(s).not.toContain('Gelişim alanın');
  });

  it('birden çok yolculukta son yolculuk ayrıca söylenir', () => {
    const s = buildEcoScoreSpeech([
      trip('new', 0.5, { decelHardSec: 40 }), trip('old', 2),
    ], NOW, false);
    const last = tripEcoScore(trip('new', 0.5, { decelHardSec: 40 })).score;
    expect(s).toContain(`Son yolculuğun ${last}.`);
  });

  it('son yolculuk yoksa haftalık fark söylenir (küçük fark gürültüdür, söylenmez)', () => {
    const up = buildEcoScoreSpeech([trip('a', 1), trip('b', 9, { accelOverSec: 40 })], NOW, false);
    expect(up).toMatch(/Geçen haftaya göre \d+ puan daha iyi\./);
    const flat = buildEcoScoreSpeech([trip('a', 1), trip('b', 9)], NOW, false);
    expect(flat).not.toContain('Geçen haftaya göre');
  });

  it('🔒 puanlanamayan hafta: sayı YOK, neden VAR', () => {
    const s = buildEcoScoreSpeech([trip('a', 1, null)], NOW, false);
    expect(s).toMatch(/^Bu hafta puanlanmış yolculuk yok\./);
    expect(s).toContain('Eko ölçümü yok');
    expect(s).not.toMatch(/\d{2,}/);
  });

  it('bu hafta yolculuk yok ama geçen hafta var → geçen haftanın puanı', () => {
    const s = buildEcoScoreSpeech([trip('b', 9)], NOW, false);
    expect(s).toBe('Bu hafta henüz yolculuk yok. Geçen haftaki eko puanın 100 olarak hesaplandı.');
  });

  it('hiç kayıt yok → nasıl oluşacağını söyler', () => {
    expect(buildEcoScoreSpeech([], NOW, false)).toMatch(/^Henüz puanlanmış bir yolculuğun yok\./);
  });

  it('🔒 aktif yolculuk puanlanmış gibi SÖYLENMEZ', () => {
    const s = buildEcoScoreSpeech([trip('a', 1)], NOW, true);
    expect(s).toMatch(/Şu anki yolculuğun bitince puanlanacak\.$/);
  });
});

/* ══════════════════ C · voiceInfoService ══════════════════ */

describe('C · voiceInfoService', () => {
  beforeEach(() => {
    M.spoken.length = 0;
    M.loaded = true;
    M.history = [];
    M.active = false;
  });

  it('gerçek geçmişten cevap verir', async () => {
    M.history = [trip('a', 0.1, {}, { endTime: Date.now() - 3600_000 })];
    await answerInformational('trip_eco_score');
    expect(M.spoken).toHaveLength(1);
    expect(M.spoken[0]).toContain('Bu hafta eko puanın 100');
  });

  it('🔒 geçmiş yüklenmediyse "yolculuk yok" DENMEZ', async () => {
    M.loaded = false;
    await answerInformational('trip_eco_score');
    expect(M.spoken).toEqual(['Yolculuk geçmişi henüz yüklenmedi. Birazdan tekrar sor.']);
  });
});
