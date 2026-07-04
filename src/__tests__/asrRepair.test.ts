/**
 * asrRepair.test.ts — offline ASR onarım katmanı testleri.
 *
 * repairTranscript SAF fonksiyon (servis import'u yok) — mock gerektirmez.
 * _bestLocalParse entegrasyon testleri voiceNbest.test.ts'teki deseni izler:
 * commandParser GERÇEK (mock DEĞİL), yalnız ağır yan-etkili servisler mock'lanır.
 */
import { describe, it, expect, vi } from 'vitest';
import { repairTranscript } from '../platform/asrRepair';

describe('repairTranscript — bilinen Vosk TR karışıklık sözlüğü', () => {
  it('bağlam örneği: "birez muzuk ac" → "biraz muzik ac"', () => {
    expect(repairTranscript('birez muzuk ac')).toBe('biraz muzik ac');
  });

  it('İngilizce alıntının Türkçe fonetik yazımı: "vayfay ac" → "wifi ac"', () => {
    expect(repairTranscript('vayfay ac')).toBe('wifi ac');
  });

  it('ünsüz kümesi ünlü türemesi: "tirafik nasil" → "trafik nasil"', () => {
    expect(repairTranscript('tirafik nasil')).toBe('trafik nasil');
  });

  it('h-düşmesi: "arita ac" → "harita ac"', () => {
    expect(repairTranscript('arita ac')).toBe('harita ac');
  });
});

describe('repairTranscript — domain lexicon snap (muhafazakâr eşikler)', () => {
  it('sözlük-dışı domain-yakın kelime en yakın lexicon kelimesine çekilir', () => {
    // 'muzii' bilinen karışıklık sözlüğünde YOK — yalnız mesafe-tabanlı snap.
    expect(repairTranscript('muzii ac')).toBe('muzik ac');
  });

  it('kısa kelime (<4 harf) ASLA hedef alınmaz — "ac" dokunulmadan kalır', () => {
    expect(repairTranscript('ac')).toBeNull();
  });

  it('token zaten lexicon\'da ise dokunulmaz', () => {
    expect(repairTranscript('muzik ac')).toBeNull();
  });

  it('doğru çekimli (kök+ek) kelime bozulmaz — "haritayı" kısaltılmaz', () => {
    // commandParser zaten Tier-2 prefix eşleşmesiyle ('harita' kökü) yakalar;
    // burada tekrar dokunmak "haritayı"yı anlamsızca "harita"ya kısaltırdı.
    expect(repairTranscript('haritayı aç')).toBeNull();
  });

  it('lexicon\'dan çok uzak kelimeye dokunulmaz', () => {
    expect(repairTranscript('zzzzzzzz')).toBeNull();
  });

  it('onarım gerekmiyorsa (temiz transcript) null döner', () => {
    expect(repairTranscript('eve git')).toBeNull();
  });

  it('boş/whitespace transcript → null', () => {
    expect(repairTranscript('')).toBeNull();
    expect(repairTranscript('   ')).toBeNull();
  });
});

/* ── _bestLocalParse entegrasyonu ─────────────────────────────── */

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
// commandParser GERÇEK — kasıtlı mock YOK (asrRepair de gerçek).

import { _bestLocalParse } from '../platform/voiceService';

describe('_bestLocalParse — offline ASR onarımı entegrasyonu', () => {
  it('bozuk transcript onarımla komuta dönüşür ("vayfay ac" → wifi set_setting)', () => {
    // Onarım OLMADAN 'vayfay' hiçbir kalıba (Tier1/2/3 veya matchVoiceSetting)
    // yakın değil → komut yok. Onarımla 'wifi ac' → donanım refleksi (1.0).
    const r = _bestLocalParse(['vayfay ac']);
    expect(r.command?.type).toBe('set_setting');
    expect(r.command?.extra?.settingKey).toBe('wifi');
    expect(r.command?.confidence).toBe(1.0);
  });

  it('temiz transcript davranışı BİREBİR aynı kalır (onarım tetiklenmez)', () => {
    const r = _bestLocalParse(['eve git']);
    expect(r.command?.type).toBe('navigate_home');
    expect(r.command?.confidence).toBe(1.0);
  });

  it('eşitlikte orijinal (ilk sıradaki aday) kazanır', () => {
    // İki özdeş yüksek-güven aday: ikinci aday DAHA YÜKSEK değilse (>, ≥ değil)
    // ilk aday kazanır — onarım hiçbir zaman mevcut davranışı geriletemez.
    const r = _bestLocalParse(['eve git', 'eve git']);
    expect(r.command?.type).toBe('navigate_home');
    expect(r.command?.confidence).toBe(1.0);
  });
});
