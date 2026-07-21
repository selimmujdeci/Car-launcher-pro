import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveSttLatencyMetrics,
  recordSttLatencyMetrics,
  getRecentSttLatencyMetrics,
  _resetSttLatencyRingForTest,
  type RawSttTelemetry,
} from '../platform/sttLatencyTelemetry';

// STT-LATENCY-2: native Android capture altyapısı (thread/AudioRecord/Vosk) vitest'te
// çalıştırılamaz — bu yüzden ölçüm MANTIĞI (süre türetimi + monotonluk doğrulaması) saf
// bir katmana (sttLatencyTelemetry.ts) çıkarılmıştır. Bu dosya o saf katmanı test eder;
// gerçek native davranış (thread zamanlaması, AudioRecord) DEVICE VALIDATION LEDGER'a düşer.

describe('sttLatencyTelemetry — deriveSttLatencyMetrics', () => {
  beforeEach(() => {
    _resetSttLatencyRingForTest();
  });

  it('senaryo 1 — success: zaman sırası monoton, tüm süreler ≥0, nativeTotalMs alt segmentlerden küçük olamaz', () => {
    const raw: RawSttTelemetry = {
      audioRecordStartAtMs: 120,
      firstPcmFrameAtMs: 180,
      vadFloorReadyAtMs: 1200,
      firstSpeechDetectedAtMs: 1500,
      lastSpeechFrameAtMs: 3200,
      speechEndDetectedAtMs: 4300,
      decodeStartAtMs: 4300,
      decodeEndAtMs: 4340,
      bridgeResolveAtMs: 4360,
      pcmFrameCount: 340,
      acceptedWaveformCount: 1,
      sampleRate: 16000,
      bufferSize: 8000,
      modelLoadAttempted: false,
      modelLoadSucceeded: true,
      modelSourceCategory: 'preloaded',
      terminalStatus: 'success',
    };

    const m = deriveSttLatencyMetrics(raw);

    expect(m.terminalStatus).toBe('success');
    expect(m.monotonic).toBe(true);

    const segments = [
      m.requestToAudioStartMs,
      m.audioStartToFirstFrameMs,
      m.vadFloorLearningMs,
      m.floorReadyToSpeechStartMs,
      m.speechDurationMs,
      m.postSpeechSilenceMs,
      m.decodeMs,
      m.decodeEndToResolveMs,
    ];
    for (const s of segments) {
      expect(s).toBeDefined();
      expect(s as number).toBeGreaterThanOrEqual(0);
    }

    expect(m.nativeTotalMs).toBe(4360);
    // nativeTotalMs, TEK BAŞINA hiçbir alt segmentten küçük olamaz (aynı ankordan ölçülür).
    for (const s of segments) {
      expect(m.nativeTotalMs as number).toBeGreaterThanOrEqual(s as number);
    }

    expect(m.pcmFrameCount).toBe(340);
    expect(m.acceptedWaveformCount).toBe(1);
    expect(m.modelSourceCategory).toBe('preloaded');
  });

  it('senaryo 2 — no_speech: hiç konuşma algılanmadıysa açık (dangling) zaman segmenti kalmaz', () => {
    // Konuşma hiç algılanmadı (firstSpeechDetectedAtMs/lastSpeechFrameAtMs YOK) —
    // native bu alanları hiç yazmaz (bkz. CarLauncherPlugin#putRelMs).
    const raw: RawSttTelemetry = {
      audioRecordStartAtMs: 100,
      firstPcmFrameAtMs: 150,
      vadFloorReadyAtMs: 1100,
      decodeStartAtMs: 9000,
      decodeEndAtMs: 9020,
      bridgeResolveAtMs: 9030,
      terminalStatus: 'no_speech',
    };

    const m = deriveSttLatencyMetrics(raw);

    expect(m.terminalStatus).toBe('no_speech');
    // Ulaşılmayan faz → türetilmiş süre de undefined (sahte/açık segment ÜRETİLMEZ).
    expect(m.floorReadyToSpeechStartMs).toBeUndefined();
    expect(m.speechDurationMs).toBeUndefined();
    expect(m.postSpeechSilenceMs).toBeUndefined();
    // Ulaşılan fazlar yine de doğru hesaplanır.
    expect(m.requestToAudioStartMs).toBe(100);
    expect(m.decodeMs).toBe(20);
    expect(m.monotonic).toBe(true);
  });

  it('senaryo 3 — cancel benzeri: eksik/kısmi veriyle bile throw etmez, tek tutarlı sonuç üretir (saf fonksiyon idempotent)', () => {
    const raw: RawSttTelemetry = {
      audioRecordStartAtMs: 80,
      terminalStatus: 'cancelled',
    };

    const m1 = deriveSttLatencyMetrics(raw);
    const m2 = deriveSttLatencyMetrics(raw); // aynı ham veri → aynı sonuç (yan etkisiz)

    expect(m1).toEqual(m2);
    expect(m1.terminalStatus).toBe('cancelled');
    expect(m1.nativeTotalMs).toBeUndefined(); // bridgeResolveAtMs hiç gelmedi
  });

  it('senaryo 4 — model_error: modelLoadSucceeded=false + kategori bounded, ses fazı hiç başlamamış', () => {
    const raw: RawSttTelemetry = {
      modelLoadAttempted: true,
      modelLoadSucceeded: false,
      modelSourceCategory: 'unavailable',
      modelErrorCategory: 'unpack_failed',
      terminalStatus: 'model_error',
    };

    const m = deriveSttLatencyMetrics(raw);

    expect(m.terminalStatus).toBe('model_error');
    expect(m.modelLoadAttempted).toBe(true);
    expect(m.modelLoadSucceeded).toBe(false);
    expect(m.modelSourceCategory).toBe('unavailable');
    expect(m.modelErrorCategory).toBe('unpack_failed');
    // Ses fazına hiç girilmedi → tüm zaman türevleri boş.
    expect(m.requestToAudioStartMs).toBeUndefined();
    expect(m.decodeMs).toBeUndefined();
  });

  it('senaryo 5 — decode_error: transcript/PII alanı YAPISAL OLARAK yok (RawSttTelemetry/SttLatencyMetrics şeması)', () => {
    const raw: RawSttTelemetry = {
      audioRecordStartAtMs: 90,
      decodeStartAtMs: 4000,
      terminalStatus: 'decode_error',
      // @ts-expect-error — transcript alanı şemada YOK; kaçak enjekte edilse bile...
      transcript: 'gizli-metin-asla-buraya-gelmemeli',
    } as RawSttTelemetry;

    const m = deriveSttLatencyMetrics(raw);

    expect(m.terminalStatus).toBe('decode_error');
    // ...deriveSttLatencyMetrics ÇIKTISINDA da yok — yalnız bilinen bounded alanlar kopyalanır.
    expect(Object.keys(m)).not.toContain('transcript');
    expect(JSON.stringify(m)).not.toContain('gizli-metin');
  });

  it('senaryo 6 — double-resolve koruması: yerel halka her kayıt için TEK giriş tutar (kendiliğinden çoğalmaz)', () => {
    const raw: RawSttTelemetry = { bridgeResolveAtMs: 500, terminalStatus: 'success' };
    const m = deriveSttLatencyMetrics(raw);

    recordSttLatencyMetrics(m);
    expect(getRecentSttLatencyMetrics()).toHaveLength(1);

    // Aynı native oturumun İKİNCİ kez kaydedilmesi (örn. yanlışlıkla iki kez çağrılırsa)
    // ring'e AYRI bir giriş olarak düşer — bu katman native'in "tek kullanımlık tel"
    // korumasının YERİNE geçmez, yalnız türetimi test eder (native tarafta voskTelemetry
    // resolveVosk/rejectVosk'ta HEMEN null'lanır → ikinci çağrı zaten tel=null görür).
    recordSttLatencyMetrics(m);
    expect(getRecentSttLatencyMetrics()).toHaveLength(2);
  });

  it('bozuk/ters sıralı zaman damgası → monotonic=false, negatif süre asla üretilmez', () => {
    const raw: RawSttTelemetry = {
      audioRecordStartAtMs: 500,
      firstPcmFrameAtMs: 100, // GERİYE gitti — bozuk veri
      decodeStartAtMs: 4000,
      decodeEndAtMs: 4010,
      bridgeResolveAtMs: 4020,
      terminalStatus: 'success',
    };

    const m = deriveSttLatencyMetrics(raw);

    expect(m.monotonic).toBe(false);
    // audioStartToFirstFrameMs negatif olurdu → undefined (asla negatif sayı dönmez).
    expect(m.audioStartToFirstFrameMs).toBeUndefined();
  });

  it('raw yoksa (Google STT yolu — Vosk hiç devreye girmedi) unknown + boş metrik döner', () => {
    expect(deriveSttLatencyMetrics(undefined)).toEqual({ terminalStatus: 'unknown', monotonic: true });
    expect(deriveSttLatencyMetrics(null)).toEqual({ terminalStatus: 'unknown', monotonic: true });
  });

  it('bilinmeyen/eksik terminalStatus → bounded "unknown"a düşer (serbest string sızmaz)', () => {
    const raw = { terminalStatus: 'not_a_real_status' } as unknown as RawSttTelemetry;
    const m = deriveSttLatencyMetrics(raw);
    expect(m.terminalStatus).toBe('unknown');
  });

  it('getRecentSttLatencyMetrics halkası sınırlı boyutta tutulur (bounded ring)', () => {
    for (let i = 0; i < 30; i++) {
      recordSttLatencyMetrics(deriveSttLatencyMetrics({ bridgeResolveAtMs: i, terminalStatus: 'success' }));
    }
    expect(getRecentSttLatencyMetrics().length).toBeLessThanOrEqual(20);
  });
});
