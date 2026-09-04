/**
 * musicF6AudioSurface.test.tsx — MUSIC F6 · Ses yüzeyi KİLİTLERİ.
 *
 * Kilitlenen sözleşmeler:
 *   1. Yetenek dürüstlüğü — desteklenmeyen kontrol RENDER EDİLMEZ.
 *   2. Yetenek yoksa TEK dürüst açıklama; sahte kontrol yığını YOK.
 *   3. Sürüş sözleşmesi — ince ayar adımları kapanır, preset ve açma/kapama açık.
 *   4. Güvenlik payı kullanıcıdan GİZLENMEZ ve "ses düzeyin değişti" DENMEZ.
 *   5. Ayarlar yüzeyinde ölçülmemiş/karşılıksız DSP iddiası KALMAZ.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

let nativeFlag = true;
vi.mock('../platform/bridge', () => ({
  get isNative() { return nativeFlag; },
  get isDemo() { return !nativeFlag; },
}));

const caps = {
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
  supportsVirtualizer: false,
  supportsHardwareDsp: false,
  unavailableReason: '',
  generation: 3,
};

const native = { caps: { ...caps } };

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    audioDspCapabilities: async () => native.caps,
    audioDspApply: async () => ({ applied: true, failureCode: '' }),
    audioDspSnapshot: async () => ({ available: true }),
  },
}));

import { AudioExperiencePanel } from '../components/media/AudioExperiencePanel';
import {
  __resetAudioExperienceForTest, setBandGainDb, setPreset, startAudioExperience,
  stopAudioExperience,
} from '../platform/media/audio/audioExperienceAuthority';
import { safeRemoveRaw } from '../utils/safeStorage';

const PERSIST_KEY = 'caros.music.f6.audio-experience.v1';

function render(drivingMode: 'idle' | 'normal' | 'driving' = 'idle'): string {
  return renderToStaticMarkup(createElement(AudioExperiencePanel, { drivingMode }));
}

beforeEach(async () => {
  vi.useFakeTimers();
  nativeFlag = true;
  native.caps = { ...caps };
  safeRemoveRaw(PERSIST_KEY);
  __resetAudioExperienceForTest();
});

afterEach(() => {
  stopAudioExperience();
  vi.useRealTimers();
});

describe('F6/UI-1 — yetenek dürüstlüğü', () => {
  it('tam yetenekli cihazda EQ · loudness · denge çizilir, fader ÇİZİLMEZ', async () => {
    await startAudioExperience();
    const html = render('idle');
    expect(html).toContain('data-testid="ax-eq"');
    expect(html).toContain('data-testid="ax-loudness"');
    expect(html).toContain('data-testid="ax-balance"');
    expect(html).not.toContain('ax-fader');
  });

  it('cihazın bant SAYISI kadar bant çizilir — fazlası UYDURULMAZ', async () => {
    native.caps = { ...caps, eqBandCount: 3, eqBandFrequenciesHz: [60, 1000, 12000] };
    await startAudioExperience();
    const html = render('idle');
    expect(html).toContain('data-testid="ax-band-0"');
    expect(html).toContain('data-testid="ax-band-2"');
    expect(html).not.toContain('data-testid="ax-band-3"');
  });

  it('loudness desteklenmiyorsa kontrol HİÇ çizilmez (kapalı kutu bırakılmaz)', async () => {
    native.caps = { ...caps, supportsLoudness: false, loudnessMaxMilliBel: 0 };
    await startAudioExperience();
    const html = render('idle');
    expect(html).not.toContain('data-testid="ax-loudness"');
    expect(html).toContain('data-testid="ax-eq"');
  });

  it('hiçbir yetenek yoksa TEK dürüst açıklama gösterilir', async () => {
    nativeFlag = false;
    await startAudioExperience();
    const html = render('idle');
    expect(html).toContain('data-testid="audio-experience-unavailable"');
    expect(html).not.toContain('data-testid="ax-eq"');
    expect(html).not.toContain('data-testid="ax-presets"');
    expect(html).toMatch(/kullanılamıyor/);
  });
});

describe('F6/UI-2 — sürüş sözleşmesi', () => {
  it('sürüşte ince adım düğmeleri kapanır', async () => {
    await startAudioExperience();
    const html = render('driving');
    expect(html).toContain('data-interaction="REDUCED"');
    expect(html).not.toContain('ax-band-0-up');
    expect(html).not.toContain('ax-loudness-up');
    expect(html).not.toContain('ax-balance-right');
    expect(html).not.toContain('data-testid="ax-reset"');
  });

  it('sürüşte preset ve açma/kapama AÇIK kalır', async () => {
    await startAudioExperience();
    const html = render('driving');
    expect(html).toContain('data-testid="ax-presets"');
    expect(html).toContain('data-testid="ax-bypass"');
    expect(html).toContain('data-testid="ax-driving-note"');
  });

  it('durur hâlde tüm adım düğmeleri açıktır', async () => {
    await startAudioExperience();
    const html = render('idle');
    expect(html).toContain('data-interaction="FULL"');
    expect(html).toContain('ax-band-0-up');
    expect(html).toContain('ax-loudness-up');
    expect(html).toContain('ax-balance-right');
  });
});

describe('F6/UI-3 — güvenlik payı ve preset dürüstlüğü', () => {
  it('güvenlik payı uygulandığında kullanıcıya AÇIKÇA bildirilir', async () => {
    await startAudioExperience();
    setPreset('bass');
    const html = render('idle');
    expect(html).toContain('data-testid="ax-headroom"');
    expect(html).toMatch(/Ses düzeyi ayarınız değişmedi/);
  });

  it('düz profilde güvenlik payı notu GÖSTERİLMEZ', async () => {
    await startAudioExperience();
    setPreset('flat');
    const html = render('idle');
    expect(html).not.toContain('data-testid="ax-headroom"');
  });

  it('CUSTOM düğmesi yalnız kullanıcı bandı değiştirdikten sonra görünür', async () => {
    await startAudioExperience();
    expect(render('idle')).not.toContain('ax-preset-custom');
    setBandGainDb(0, 3);
    expect(render('idle')).toContain('ax-preset-custom');
  });

  it('preset etiketleri ölçülmemiş iddia TAŞIMAZ', async () => {
    await startAudioExperience();
    const html = render('idle').toLowerCase();
    expect(html).not.toMatch(/ai sound|studio quality|hi-fi|audiophile/);
  });
});

describe('F6/UI-4 — ayarlar yüzeyinde karşılıksız DSP iddiası kalmadı', () => {
  it('SettingsPage artık Web Audio tabanlı sahte DSP anahtarlarını çizmez', async () => {
    /* Kanıt statiktir: bu kilit, kaldırılan üç anahtarın (Web Audio zincirine
       üretimde HİÇBİR kaynak bağlı olmadığı için duyulur etkisi olmayan)
       geri sızmasını engeller. Boş küme dönmemesi için dosya varlığı da
       doğrulanır — kör guard düşen guarddır. */
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/settings/SettingsPage.tsx', 'utf8');
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('AudioExperiencePanel');
    expect(src).not.toContain('Crystal Cabin DSP');
    expect(src).not.toContain('setAGCEnabled');
    expect(src).not.toContain('setDriverFocus');
    expect(src).not.toContain('setSvcEnabled');
  });
});
