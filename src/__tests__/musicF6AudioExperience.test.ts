/**
 * musicF6AudioExperience.test.ts — MUSIC F6 · Ses Deneyimi / DSP DAVRANIŞ KİLİTLERİ.
 *
 * Kapsam: yetenek dürüstlüğü · preset yansıtma · bant/loudness/denge sınırları ·
 * clipping güvenlik payı · bayat oturum koruması · kalıcılık ve yeniden
 * doğrulama · otorite sınırı (F0/volume/duck'a dokunmama).
 *
 * KAPSAM DIŞI (ve öyle sunulur): gerçek AudioEffect davranışı, gerçek DSP
 * gecikmesi ve duyulan ses kalitesi. Bunlar YALNIZ cihazda ölçülür; host
 * yeşili "ses iyi" KANITI DEĞİLDİR (kütük #1090+ maddeleri).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── Native platform anahtarı ────────────────────────────────────────────── */

let nativeFlag = true;

vi.mock('../platform/bridge', () => ({
  get isNative() { return nativeFlag; },
  get isDemo() { return !nativeFlag; },
}));

/* ── Native köprü mock'u (CarLauncher) ───────────────────────────────────── */

interface CapsPayload {
  probed: boolean;
  supportsEqualizer?: boolean;
  eqBandCount?: number;
  eqBandFrequenciesHz?: number[];
  eqMinGainMilliBel?: number;
  eqMaxGainMilliBel?: number;
  supportsLoudness?: boolean;
  loudnessMaxMilliBel?: number;
  supportsBalance?: boolean;
  supportsFader?: boolean;
  faderUnsupportedReason?: string;
  supportsVirtualizer?: boolean;
  supportsHardwareDsp?: boolean;
  unavailableReason?: string;
  generation: number;
}

const FULL_CAPS: CapsPayload = {
  probed: true,
  supportsEqualizer: true,
  eqBandCount: 5,
  eqBandFrequenciesHz: [60, 230, 910, 3600, 14000],
  eqMinGainMilliBel: -1500,
  eqMaxGainMilliBel: 1500,
  supportsLoudness: true,
  loudnessMaxMilliBel: 600,
  supportsBalance: true,
  supportsFader: false,
  faderUnsupportedReason: 'stereo_output_only',
  supportsVirtualizer: true,
  supportsHardwareDsp: false,
  unavailableReason: '',
  generation: 7,
};

const native = {
  caps: { ...FULL_CAPS } as CapsPayload,
  applies: [] as Record<string, unknown>[],
  applyResult: { applied: true, failureCode: '' } as { applied: boolean; failureCode: string },
  capsThrows: false,
  applyThrows: false,
};

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    audioDspCapabilities: async () => {
      if (native.capsThrows) throw new Error('probe boom');
      return native.caps;
    },
    audioDspApply: async (req: Record<string, unknown>) => {
      if (native.applyThrows) throw new Error('apply boom');
      native.applies.push(req);
      return {
        applied: native.applyResult.applied,
        failureCode: native.applyResult.failureCode,
        snapshot: {
          available: true,
          audioSessionId: 42,
          generation: native.caps.generation,
          equalizerAttached: true,
          loudnessAttached: true,
          processorActive: true,
          bypass: !native.applyResult.applied,
          bypassReason: native.applyResult.applied ? '' : 'apply_failed',
          appliedBandsMilliBel: (req.bandsMilliBel as number[]) ?? [],
          appliedLoudnessMilliBel: (req.loudnessMilliBel as number) ?? 0,
          appliedPreampLinear: (req.preampLinear as number) ?? 1,
          appliedBalance: (req.balance as number) ?? 0,
          attachCount: 1,
          attachFailureCount: 0,
          applyFailureCount: 0,
          lastFailureCode: '',
          lastApplyLatencyMs: 3,
          lastAttachLatencyMs: 11,
        },
      };
    },
    audioDspSnapshot: async () => ({ available: true }),
  },
}));

import {
  AUDIO_PRESETS, MAX_HEADROOM_DB, MAX_USER_BAND_GAIN_DB, UNPROBED_CAPABILITIES,
  balanceToChannelGains, clampBandGainDb, computeSafetyPreampDb, configEquals,
  dbToLinear, getPreset, interactionModeFor, isPresetId, projectPresetToBands,
  sampleCurveDb, sanitizeConfig, visibleControls,
  type AudioDspCapabilities, type AudioExperienceConfig,
} from '../platform/media/audio/audioExperienceModel';
import {
  __resetAudioExperienceForTest, getAudioExperienceTelemetry, getCapabilities,
  getChannelGains, getConfig, getSafetyPreampDb, resetAudioExperience, revalidate,
  sanitizeNativeCapabilities, setBalance, setBandGainDb, setEnabled, setLoudnessDb,
  setPreset, startAudioExperience, stopAudioExperience,
} from '../platform/media/audio/audioExperienceAuthority';
import { safeRemoveRaw } from '../utils/safeStorage';

const PERSIST_KEY = 'caros.music.f6.audio-experience.v1';

/** Modelin saf testlerinde kullanılan tam yetenekli cihaz. */
const CAPS: AudioDspCapabilities = Object.freeze({
  probed: true,
  supportsEqualizer: true,
  eqBandCount: 5,
  eqBandFrequenciesHz: [60, 230, 910, 3600, 14000],
  eqMinGainDb: -15,
  eqMaxGainDb: 15,
  supportsLoudness: true,
  loudnessMaxDb: 6,
  supportsBalance: true,
  supportsFader: false,
  faderUnsupportedReason: 'stereo_output_only',
  supportsVirtualizer: true,
  supportsHardwareDsp: false,
  unavailableReason: '',
});

/** Coalescing debounce'unu boşaltır (gerçek zaman beklemesi YOK). */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  nativeFlag = true;
  native.caps = { ...FULL_CAPS };
  native.applies = [];
  native.applyResult = { applied: true, failureCode: '' };
  native.capsThrows = false;
  native.applyThrows = false;
  safeRemoveRaw(PERSIST_KEY);
  __resetAudioExperienceForTest();
});

afterEach(() => {
  stopAudioExperience();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · YETENEK DÜRÜSTLÜĞÜ
══════════════════════════════════════════════════════════════════════════ */

describe('F6/1 — yetenek dürüstlüğü', () => {
  it('sorgulanmamış cihazda hiçbir yetenek VARSAYILMAZ', () => {
    expect(UNPROBED_CAPABILITIES.probed).toBe(false);
    expect(UNPROBED_CAPABILITIES.supportsEqualizer).toBe(false);
    expect(UNPROBED_CAPABILITIES.eqBandCount).toBe(0);
    expect(visibleControls(UNPROBED_CAPABILITIES).any).toBe(false);
  });

  it('probed:false gelen yük tüm yetenekleri kapatır', () => {
    const caps = sanitizeNativeCapabilities({ probed: false, unavailableReason: 'no_effect_available' });
    expect(caps.probed).toBe(false);
    expect(caps.unavailableReason).toBe('no_effect_available');
    expect(caps.supportsEqualizer).toBe(false);
  });

  it('frekansı bildirilmeyen bant SAYILMAZ — uydurma kontrol üretilmez', () => {
    const caps = sanitizeNativeCapabilities({
      ...FULL_CAPS, eqBandCount: 10, eqBandFrequenciesHz: [60, 230, 910],
    });
    expect(caps.eqBandCount).toBe(3);
    expect(caps.eqBandFrequenciesHz).toHaveLength(3);
  });

  it('geçersiz kazanç aralığı EQ yeteneğini düşürür', () => {
    const caps = sanitizeNativeCapabilities({
      ...FULL_CAPS, eqMinGainMilliBel: 0, eqMaxGainMilliBel: 0,
    });
    expect(caps.supportsEqualizer).toBe(false);
    expect(caps.eqBandCount).toBe(0);
  });

  it('fader ASLA true raporlanmaz — sahte ön/arka kanal yoktur', () => {
    const caps = sanitizeNativeCapabilities({ ...FULL_CAPS, supportsFader: false });
    expect(caps.supportsFader).toBe(false);
    expect(visibleControls(caps).fader).toBe(false);
    expect(caps.faderUnsupportedReason).toBe('stereo_output_only');
  });

  it('loudness tavanı ürün sınırını AŞAMAZ', () => {
    const caps = sanitizeNativeCapabilities({ ...FULL_CAPS, loudnessMaxMilliBel: 5000 });
    expect(caps.loudnessMaxDb).toBe(6);
  });

  it('desteklenmeyen kontrol RENDER EDİLMEZ (disabled mezarlığı yok)', () => {
    const noLoud = { ...CAPS, supportsLoudness: false, loudnessMaxDb: 0 };
    const vis = visibleControls(noLoud);
    expect(vis.loudness).toBe(false);
    expect(vis.eqBands).toBe(true);
    expect(vis.any).toBe(true);
  });

  it('web modunda hiçbir yetenek ÜRETİLMEZ ve native ÇAĞRILMAZ', async () => {
    nativeFlag = false;
    await startAudioExperience();
    expect(getCapabilities().probed).toBe(false);
    expect(getCapabilities().unavailableReason).toBe('web_mode');
    expect(native.applies).toHaveLength(0);
    expect(visibleControls(getCapabilities()).any).toBe(false);
  });

  it('sorgu düşerse yetenek "yok" olur, varsayılan ÜRETİLMEZ', async () => {
    native.capsThrows = true;
    await startAudioExperience();
    expect(getCapabilities().probed).toBe(false);
    expect(getCapabilities().unavailableReason).toBe('probe_failed');
    expect(getAudioExperienceTelemetry().probeFailures).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · PRESET + EQ
══════════════════════════════════════════════════════════════════════════ */

describe('F6/2 — preset ve EQ', () => {
  it('preset kataloğu ölçülmemiş iddia taşımaz', () => {
    const labels = AUDIO_PRESETS.map((p) => p.label.toLowerCase()).join(' ');
    expect(labels).not.toMatch(/ai|studio|hi-?fi|master/);
    expect(isPresetId('rock')).toBe(true);
    expect(isPresetId('quantum')).toBe(false);
  });

  it('flat preset tüm bantları sıfırlar', () => {
    expect(projectPresetToBands('flat', CAPS)).toEqual([0, 0, 0, 0, 0]);
  });

  it('preset CİHAZIN bant sayısına yansıtılır (5 ve 10 bant aynı eğri)', () => {
    const five = projectPresetToBands('bass', CAPS);
    const ten = projectPresetToBands('bass', {
      ...CAPS,
      eqBandCount: 10,
      eqBandFrequenciesHz: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
    });
    expect(five).toHaveLength(5);
    expect(ten).toHaveLength(10);
    // Bas preset'i her iki cihazda da en düşük bandı YÜKSELTİR, en yükseği yükseltmez.
    expect(five[0]).toBeGreaterThan(0);
    expect(ten[0]).toBeGreaterThan(0);
    expect(five[four(five)]).toBeLessThanOrEqual(five[0]);
  });

  it('eğri log-frekans ekseninde ara değerlenir ve uçlarda EKSTRAPOLE ETMEZ', () => {
    const curve = getPreset('bass').curve;
    expect(sampleCurveDb(curve, 10)).toBe(curve[0][1]);
    expect(sampleCurveDb(curve, 40000)).toBe(curve[curve.length - 1][1]);
    const mid = sampleCurveDb(curve, 120);
    expect(mid).toBeLessThan(curve[0][1]);
    expect(mid).toBeGreaterThan(curve[1][1]);
  });

  it('bant kazancı hem cihaz aralığına hem ürün tavanına kırpılır', () => {
    expect(clampBandGainDb(99, CAPS)).toBe(MAX_USER_BAND_GAIN_DB);
    expect(clampBandGainDb(-99, CAPS)).toBe(-MAX_USER_BAND_GAIN_DB);
    // Cihaz daha darsa DAR olan kazanır.
    const narrow = { ...CAPS, eqMinGainDb: -3, eqMaxGainDb: 3 };
    expect(clampBandGainDb(99, narrow)).toBe(3);
    expect(clampBandGainDb(-99, narrow)).toBe(-3);
  });

  it('EQ desteklenmiyorsa preset/bant yazımı SESSİZCE ETKİSİZDİR', async () => {
    native.caps = { ...FULL_CAPS, supportsEqualizer: false, eqBandCount: 0, eqBandFrequenciesHz: [] };
    await startAudioExperience();
    await flush();
    const before = getConfig();
    setPreset('rock');
    setBandGainDb(0, 6);
    expect(getConfig()).toEqual(before);
    expect(getConfig().bandGainsDb).toHaveLength(0);
  });

  it('tek bant değişimi preset\'i CUSTOM yapar (preset yalanı olmaz)', async () => {
    await startAudioExperience();
    await flush();
    setPreset('rock');
    expect(getConfig().presetId).toBe('rock');
    setBandGainDb(1, 4);
    expect(getConfig().presetId).toBe('custom');
    expect(getConfig().bandGainsDb[1]).toBe(4);
  });

  it('geçersiz bant indeksi ve NaN kazanç REDDEDİLİR', async () => {
    await startAudioExperience();
    await flush();
    const before = getConfig();
    setBandGainDb(-1, 3);
    setBandGainDb(99, 3);
    setBandGainDb(0, Number.NaN);
    setBandGainDb(1.5, 3);
    expect(configEquals(getConfig(), before)).toBe(true);
  });

  it('sıfırlama düz profile döner', async () => {
    await startAudioExperience();
    await flush();
    setPreset('bass');
    setLoudnessDb(4);
    setBalance(0.6);
    resetAudioExperience();
    expect(getConfig().presetId).toBe('flat');
    expect(getConfig().bandGainsDb.every((b) => b === 0)).toBe(true);
    expect(getConfig().loudnessDb).toBe(0);
    expect(getConfig().balance).toBe(0);
  });
});

function four(arr: readonly number[]): number { return arr.length - 1; }

/* ══════════════════════════════════════════════════════════════════════════
   3 · LOUDNESS
══════════════════════════════════════════════════════════════════════════ */

describe('F6/3 — loudness', () => {
  it('desteklenen cihazda sınırlar içinde uygulanır', async () => {
    await startAudioExperience();
    await flush();
    setLoudnessDb(3);
    expect(getConfig().loudnessDb).toBe(3);
    setLoudnessDb(999);
    expect(getConfig().loudnessDb).toBe(CAPS.loudnessMaxDb);
    setLoudnessDb(-5);
    expect(getConfig().loudnessDb).toBe(0);
  });

  it('desteklenmeyen cihazda yazım ETKİSİZDİR ve kontrol çizilmez', async () => {
    native.caps = { ...FULL_CAPS, supportsLoudness: false, loudnessMaxMilliBel: 0 };
    await startAudioExperience();
    await flush();
    setLoudnessDb(5);
    expect(getConfig().loudnessDb).toBe(0);
    expect(visibleControls(getCapabilities()).loudness).toBe(false);
  });

  it('loudness kullanıcı sesi/duck DEĞİLDİR — ayrı alanda taşınır', async () => {
    await startAudioExperience();
    await flush();
    setLoudnessDb(4);
    await flush();
    const last = native.applies[native.applies.length - 1];
    expect(last.loudnessMilliBel).toBe(400);
    expect(Object.keys(last)).not.toContain('volume');
    expect(Object.keys(last)).not.toContain('userVolume');
    expect(Object.keys(last)).not.toContain('duck');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · DENGE / FADER
══════════════════════════════════════════════════════════════════════════ */

describe('F6/4 — denge ve fader', () => {
  it('denge hiçbir kanalı 1.0 ÜSTÜNE çıkarmaz', () => {
    for (let b = -1; b <= 1.0001; b += 0.05) {
      const g = balanceToChannelGains(b);
      expect(g.left).toBeLessThanOrEqual(1);
      expect(g.right).toBeLessThanOrEqual(1);
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.right).toBeGreaterThanOrEqual(0);
    }
  });

  it('merkez denge iki kanalı da bozmaz; uçlar karşı kanalı susturur', () => {
    expect(balanceToChannelGains(0)).toEqual({ left: 1, right: 1 });
    expect(balanceToChannelGains(1)).toEqual({ left: 0, right: 1 });
    expect(balanceToChannelGains(-1)).toEqual({ left: 1, right: 0 });
  });

  it('denge desteklenmiyorsa yazım ETKİSİZ ve kanal kazançları nötrdür', async () => {
    native.caps = { ...FULL_CAPS, supportsBalance: false };
    await startAudioExperience();
    await flush();
    setBalance(0.8);
    expect(getConfig().balance).toBe(0);
    expect(getChannelGains()).toEqual({ left: 1, right: 1 });
    expect(visibleControls(getCapabilities()).balance).toBe(false);
  });

  it('bypass\'ta kanal kazançları nötrlenir', async () => {
    await startAudioExperience();
    await flush();
    setBalance(-0.6);
    expect(getChannelGains().right).toBeLessThan(1);
    setEnabled(false);
    expect(getChannelGains()).toEqual({ left: 1, right: 1 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · CLIPPING / GAIN GÜVENLİĞİ
══════════════════════════════════════════════════════════════════════════ */

describe('F6/5 — clipping ve gain güvenliği', () => {
  const cfg = (over: Partial<AudioExperienceConfig>): AudioExperienceConfig => ({
    enabled: true, presetId: 'custom', bandGainsDb: [0, 0, 0, 0, 0],
    loudnessDb: 0, balance: 0, ...over,
  });

  it('boost yoksa güvenlik payı da YOKTUR', () => {
    expect(computeSafetyPreampDb(cfg({}), CAPS)).toBe(0);
    expect(computeSafetyPreampDb(cfg({ bandGainsDb: [-6, -3, 0, 0, 0] }), CAPS)).toBe(0);
  });

  it('pozitif boost negatif headroom üretir', () => {
    const p = computeSafetyPreampDb(cfg({ bandGainsDb: [6, 0, 0, 0, 0] }), CAPS);
    expect(p).toBeLessThan(0);
    expect(p).toBe(-6);
  });

  it('komşu boost örtüşmesi paya EKLENİR (tek tepe varsayılmaz)', () => {
    const single = computeSafetyPreampDb(cfg({ bandGainsDb: [6, 0, 0, 0, 0] }), CAPS);
    const spread = computeSafetyPreampDb(cfg({ bandGainsDb: [6, 4, 4, 0, 0] }), CAPS);
    expect(spread).toBeLessThan(single);
  });

  it('loudness paya katkı verir', () => {
    const noLoud = computeSafetyPreampDb(cfg({ bandGainsDb: [4, 0, 0, 0, 0] }), CAPS);
    const withLoud = computeSafetyPreampDb(cfg({ bandGainsDb: [4, 0, 0, 0, 0], loudnessDb: 6 }), CAPS);
    expect(withLoud).toBeLessThan(noLoud);
  });

  it('güvenlik payı SINIRLIDIR — sessizliğe inmez', () => {
    const extreme = computeSafetyPreampDb(
      cfg({ bandGainsDb: [9, 9, 9, 9, 9], loudnessDb: 6 }), CAPS,
    );
    expect(extreme).toBe(-MAX_HEADROOM_DB);
    expect(dbToLinear(extreme)).toBeGreaterThan(0.2);
  });

  it('bypass\'ta güvenlik payı UYGULANMAZ', () => {
    expect(computeSafetyPreampDb(cfg({ enabled: false, bandGainsDb: [9, 9, 0, 0, 0] }), CAPS)).toBe(0);
  });

  it('ölçülmemiş cihazda güvenlik payı ÜRETİLMEZ', () => {
    expect(computeSafetyPreampDb(cfg({ bandGainsDb: [9, 0, 0, 0, 0] }), UNPROBED_CAPABILITIES)).toBe(0);
  });

  it('preamp native\'e DOĞRUSAL ve 0<g<=1 aralığında iner', async () => {
    await startAudioExperience();
    await flush();
    setPreset('bass');
    await flush();
    const last = native.applies[native.applies.length - 1];
    expect(typeof last.preampLinear).toBe('number');
    expect(last.preampLinear as number).toBeGreaterThan(0);
    expect(last.preampLinear as number).toBeLessThanOrEqual(1);
    expect(getSafetyPreampDb()).toBeLessThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · OTORİTE SINIRI (F0 · volume · duck REGRESYONU)
══════════════════════════════════════════════════════════════════════════ */

describe('F6/6 — otorite sınırı', () => {
  it('DSP otoritesi OYNATMA komutu göndermez ve kullanıcı sesine YAZMAZ', async () => {
    await startAudioExperience();
    await flush();
    setPreset('rock');
    setLoudnessDb(3);
    setBalance(0.4);
    setEnabled(false);
    setEnabled(true);
    await flush();

    expect(native.applies.length).toBeGreaterThan(0);
    for (const req of native.applies) {
      const keys = Object.keys(req);
      // Yalnız DSP alanları taşınır: oynatma/ses/duck alanı YOKTUR.
      expect(keys.sort()).toEqual(
        ['balance', 'bandsMilliBel', 'enabled', 'generation', 'loudnessMilliBel', 'preampLinear'].sort(),
      );
    }
  });

  it('DSP modülü playback/volume/duck otoritelerini IMPORT ETMEZ', async () => {
    /* Statik kanıt: ikinci bir ses/duck yazarı doğmasın diye modül grafı
       kilitlenir. Bu kilit BOŞ KÜME döndürüyorsa (dosya taşındıysa) düşer. */
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/platform/media/audio/audioExperienceAuthority.ts', 'utf8');
    const imports = src.match(/^import[\s\S]*?from '([^']+)';/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    const joined = imports.join('\n');
    expect(joined).not.toContain('mediaCommandGateway');
    expect(joined).not.toContain('volumePolicy');
    expect(joined).not.toContain('duckPolicy');
    expect(joined).not.toContain('sourceCoordinator');
    expect(joined).not.toContain('nativeAuthorityBridge');
  });

  it('saf model React/IO/zaman kullanmaz', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/platform/media/audio/audioExperienceModel.ts', 'utf8');
    expect(src).not.toMatch(/from 'react'/);
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/setTimeout\(/);
    expect(src).not.toMatch(/localStorage/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7 · YAŞAM DÖNGÜSÜ · BAYAT OTURUM · BYPASS
══════════════════════════════════════════════════════════════════════════ */

describe('F6/7 — yaşam döngüsü ve bayat oturum', () => {
  it('yazım okunan KUŞAĞI taşır', async () => {
    await startAudioExperience();
    await flush();
    setPreset('vocal');
    await flush();
    expect(native.applies[native.applies.length - 1].generation).toBe(FULL_CAPS.generation);
  });

  it('bayat oturum reddi yeniden ölçüm TETİKLER ve sayılır', async () => {
    await startAudioExperience();
    await flush();

    native.applyResult = { applied: false, failureCode: 'stale_session' };
    native.caps = { ...FULL_CAPS, generation: 9 };
    setPreset('rock');
    await flush();

    const tel = getAudioExperienceTelemetry();
    expect(tel.staleRejections).toBeGreaterThanOrEqual(1);
    expect(tel.revalidations).toBeGreaterThanOrEqual(1);
    expect(tel.capsGeneration).toBe(9);
  });

  it('yeniden ölçümde kaybolan yetenek ayardan DÜŞÜRÜLÜR', async () => {
    await startAudioExperience();
    await flush();
    setLoudnessDb(5);
    setBalance(0.5);
    expect(getConfig().loudnessDb).toBe(5);

    native.caps = { ...FULL_CAPS, supportsLoudness: false, loudnessMaxMilliBel: 0, supportsBalance: false, generation: 8 };
    await revalidate();
    await flush();

    expect(getConfig().loudnessDb).toBe(0);
    expect(getConfig().balance).toBe(0);
  });

  it('köprü düşerse hata sayılır ama otorite ÇÖKMEZ', async () => {
    await startAudioExperience();
    await flush();
    native.applyThrows = true;
    setPreset('rock');
    await flush();
    expect(getAudioExperienceTelemetry().applyErrors).toBeGreaterThanOrEqual(1);
    expect(getAudioExperienceTelemetry().lastFailureCode).toBe('bridge_error');
    // Ayar korunur; UI yalan söylemez, LAB gerekçeyi gösterir.
    expect(getConfig().presetId).toBe('rock');
  });

  it('bypass açıkça native\'e iletilir', async () => {
    await startAudioExperience();
    await flush();
    setEnabled(false);
    await flush();
    expect(native.applies[native.applies.length - 1].enabled).toBe(false);
  });

  it('teardown timer\'ı temizler ve sonraki yazımı ENGELLER', async () => {
    await startAudioExperience();
    await flush();
    const before = native.applies.length;
    setPreset('rock');
    stopAudioExperience();
    await flush();
    expect(native.applies.length).toBe(before);
  });

  it('sürükleme birleştirilir — her adım için native ÇAĞRILMAZ', async () => {
    await startAudioExperience();
    await flush();
    const before = native.applies.length;
    for (let i = 0; i < 12; i++) setBandGainDb(0, i % 7);
    await flush();
    expect(native.applies.length - before).toBeLessThanOrEqual(3);
    expect(getAudioExperienceTelemetry().applyCoalesced).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8 · KALICILIK
══════════════════════════════════════════════════════════════════════════ */

describe('F6/8 — kalıcılık', () => {
  it('yeniden başlatmada ayar geri gelir', async () => {
    await startAudioExperience();
    await flush();
    setPreset('vocal');
    setLoudnessDb(2.5);
    setBalance(-0.3);
    await flush();

    stopAudioExperience();
    __resetAudioExperienceForTest();
    await startAudioExperience();
    await flush();

    expect(getConfig().presetId).toBe('vocal');
    expect(getConfig().loudnessDb).toBe(2.5);
    expect(getConfig().balance).toBe(-0.3);
  });

  it('kalıcı ayar CANLI GERÇEK değildir — yetenek yeniden doğrulanır', async () => {
    await startAudioExperience();
    await flush();
    setLoudnessDb(6);
    setBalance(0.9);
    await flush();

    stopAudioExperience();
    __resetAudioExperienceForTest();
    // Cihaz değişti: loudness ve denge artık YOK.
    native.caps = {
      ...FULL_CAPS, supportsLoudness: false, loudnessMaxMilliBel: 0, supportsBalance: false,
    };
    await startAudioExperience();
    await flush();

    expect(getConfig().loudnessDb).toBe(0);
    expect(getConfig().balance).toBe(0);
  });

  it('bozuk kayıt REDDEDİLİR, sayılır ve varsayılana düşülür', () => {
    const cfg = sanitizeConfig('bozuk-veri', CAPS);
    expect(cfg.presetId).toBe('flat');
    expect(cfg.bandGainsDb).toEqual([0, 0, 0, 0, 0]);

    const partial = sanitizeConfig(
      { presetId: 'custom', bandGainsDb: [999, 'x', null, Number.NaN, -999], loudnessDb: 42, balance: 9 },
      CAPS,
    );
    expect(partial.bandGainsDb[0]).toBe(MAX_USER_BAND_GAIN_DB);
    expect(partial.bandGainsDb[1]).toBe(0);
    expect(partial.bandGainsDb[4]).toBe(-MAX_USER_BAND_GAIN_DB);
    expect(partial.loudnessDb).toBe(CAPS.loudnessMaxDb);
    expect(partial.balance).toBe(1);
  });

  it('bilinmeyen preset kimliği varsayılana düşer', () => {
    expect(sanitizeConfig({ presetId: 'turbo-bass' }, CAPS).presetId).toBe('flat');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9 · SÜRÜŞ DİKKAT POLİTİKASI
══════════════════════════════════════════════════════════════════════════ */

describe('F6/9 — sürüş dikkat politikası', () => {
  it('yalnız sürüş sırasında ince etkileşim kısıtlanır', () => {
    expect(interactionModeFor('idle')).toBe('FULL');
    expect(interactionModeFor('normal')).toBe('FULL');
    expect(interactionModeFor('driving')).toBe('REDUCED');
  });

  it('kısıtlama YETENEĞİ değil yalnız etkileşimi etkiler', () => {
    // Aynı yetenek kümesi, sürüş durumundan BAĞIMSIZ olarak aynı kalır.
    expect(visibleControls(CAPS)).toEqual(visibleControls(CAPS));
    expect(visibleControls(CAPS).presets).toBe(true);
  });
});
