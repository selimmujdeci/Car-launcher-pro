/**
 * voiceNbest.test.ts — n-best STT alternatifleri (yerel parser tarafı).
 *
 * #1 iyileştirme: Vosk tek "en iyi tahmin"de sık yanılıyor. voiceService
 * alternatifleri (a) yerel parser'da dener → EN YÜKSEK güvenli komutu seçer,
 * (b) beyne verir (ayrı test: companionChat _withAltHint). Bu dosya (a)'yı kilitler.
 *
 * commandParser GERÇEK (mock DEĞİL) — "eve git" gibi net komutların gerçek
 * güven skoruyla en iyisinin seçildiği doğrulanır. voiceService'in ağır
 * yan-etkili bağımlılıkları (native/TTS/ses) mock'lanır.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: { addListener: () => Promise.resolve({ remove: async () => {} }) } }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/audioService', () => ({ duckMedia: vi.fn(), unduckMedia: vi.fn() }));
vi.mock('../platform/aiVoiceService', () => ({ resolveApiKey: (_p: string, k?: string) => k ?? '' }));
vi.mock('../platform/aiHealth', () => ({ isAiNetHealthy: () => true }));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceInfoService', () => ({ isInformationalCommand: () => false, answerInformational: vi.fn() }));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/offlineConversationEngine', () => ({ tryOfflineConversation: () => ({ handled: false, response: '' }) }));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
// commandParser GERÇEK — kasıtlı mock YOK.

import { _dedupeAlts, _bestLocalParse } from '../platform/voiceService';

describe('_dedupeAlts — n-best liste temizliği', () => {
  it('top ilk sırada, alternatifler eklenir', () => {
    expect(_dedupeAlts(['eve git', 'ege git'], 'eve git')).toEqual(['eve git', 'ege git']);
  });
  it('tekrarları eler (case-insensitive), top öne alınır', () => {
    expect(_dedupeAlts(['Eve Git', 'ege git', 'eve git'], 'eve git'))
      .toEqual(['eve git', 'ege git']);
  });
  it('boş/undefined alternatif → yalnız top', () => {
    expect(_dedupeAlts(undefined, 'eve git')).toEqual(['eve git']);
    expect(_dedupeAlts([], 'eve git')).toEqual(['eve git']);
  });
  it('en fazla 4 alternatif (STT_MAX_ALTERNATIVES)', () => {
    expect(_dedupeAlts(['a1', 'b2', 'c3', 'd4', 'e5'], 'top').length).toBe(4);
  });
  it('boş string alternatifler atlanır', () => {
    expect(_dedupeAlts(['', '  ', 'ege git'], 'eve git')).toEqual(['eve git', 'ege git']);
  });
});

describe('_bestLocalParse — en yüksek güvenli komutu seçer (gerçek parser)', () => {
  it('top ÇÖP ama alt sırada NET komut varsa onu seçer', () => {
    // "eve git" gerçek parser'da navigate_home @1.0; ilk sıradaki çöp kazanamaz.
    const r = _bestLocalParse(['zxcv qwer', 'eve git']);
    expect(r.command?.type).toBe('navigate_home');
  });
  it('top zaten NET ise onu korur', () => {
    const r = _bestLocalParse(['haritayı aç', 'harita as']);
    expect(r.command?.type).toBe('open_maps');
  });
  it('tek alternatif → o parse edilir (eski davranış)', () => {
    const r = _bestLocalParse(['müziği aç']);
    expect(r.command?.type).toBe('open_music');
  });
});
