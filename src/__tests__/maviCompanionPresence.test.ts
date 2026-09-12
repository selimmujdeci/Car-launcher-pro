/**
 * maviCompanionPresence.test — MAVİ F1 kilitleri.
 *
 * ── KİLİTLENEN İNVARYANT ────────────────────────────────────────────────────
 * "Yol Arkadaşı" (`companionEnabled`) bir **PRESENCE** ayarıdır, bir **CAPABILITY
 * GATE'İ DEĞİLDİR.** Kapalıyken Mavi tam yeteneklidir: doğal dil anlama, sohbet
 * cevabı, navigation/media/settings/vehicle niyetleri, LLM erişimi ve mevcut
 * fallback zinciri AYNEN çalışır. Kapalıyken yalnız KENDİLİĞİNDEN konuşma ve
 * sohbeti uzatma isteği kısılır.
 *
 * ── NEDEN VAR (ölçülen kusur) ───────────────────────────────────────────────
 * F1 öncesi `companionEnabled !== true` DÖRT ayrı yerde erken `null` döndürüyordu;
 * `voiceService` bunu "beyin yok" sayıp YEREL regex zincirine düşüyordu. Yani bir
 * kişilik ayarı Mavi'nin beynini kapatıyordu.
 *
 * ── BU DOSYA NE YAPMAZ ──────────────────────────────────────────────────────
 * Güvenlik, onay, authority ve tek-cevap sözleşmelerini DEĞİŞTİRMEZ — yalnız
 * bunların presence'tan BAĞIMSIZ olduğunu kanıtlar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  tryCompanionBrain, tryCompanionChat, currentPresenceMode,
  _buildPromptForTest, _resetCompanionChatForTest,
} from '../platform/companion/companionChatProvider';
import { fromSemanticResult } from '../platform/intentEngine';
import { useStore } from '../store/useStore';
import { useCognitiveStore } from '../store/useCognitiveStore';
import { _resetAiHealthForTest } from '../platform/aiHealth';

const STORAGE_KEY = 'car-launcher-storage';
const GEMINI_OPTS = { provider: 'gemini', apiKey: 'AIzaTest', hasNet: true } as const;

/** Presence şalteri — YETENEK şalteri DEĞİL (bu dosyanın tezi). */
function setPresence(on: boolean): void {
  localStorage.removeItem(STORAGE_KEY);
  useStore.getState().resetSettings();
  useStore.getState().updateSettings({ companionEnabled: on });
}

function mockBrainJson(obj: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
  });
}

function mockChatOk(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });
}

function lastPrompt(fetchSpy: ReturnType<typeof vi.fn>): string {
  const calls = fetchSpy.mock.calls;
  const [, init] = calls[calls.length - 1] as [string, { body: string }];
  const body = JSON.parse(init.body) as { system_instruction: { parts: { text: string }[] } };
  return body.system_instruction.parts[0].text;
}

beforeEach(() => {
  _resetCompanionChatForTest();
  _resetAiHealthForTest();
  useCognitiveStore.getState().setMode('IMMERSIVE');
  setPresence(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useCognitiveStore.getState().setMode('IMMERSIVE');
  setPresence(false);
  _resetCompanionChatForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — YETENEK MATRİSİ: her iki presence kipinde AYNI
 * ════════════════════════════════════════════════════════════════════════ */

const PRESENCE_MODES: ReadonlyArray<[string, boolean]> = [
  ['Yol Arkadaşı KAPALI', false],
  ['Yol Arkadaşı AÇIK', true],
];

describe.each(PRESENCE_MODES)('MAVI F1 · %s — yetenekler AYNI', (_label, on) => {
  it('bilgi sorusu beyne gider (regex parser\'a DÜŞMEZ)', async () => {
    setPresence(on);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Türkiye\'nin başkenti Ankara.' });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('türkiyenin başkenti neresi', GEMINI_OPTS);
    expect(fetchSpy).toHaveBeenCalled();          // ← beyin GERÇEKTEN çağrıldı
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('chat');
  });

  it('serbest sohbet cevaplanır', async () => {
    setPresence(on);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Anlıyorum, zor bir gün olmuş.' });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('bugün işler çok ters gitti ya', GEMINI_OPTS);
    expect(r).not.toBeNull();
    if (r!.kind === 'chat') expect(r.response).toContain('zor bir gün');
  });

  it('sohbet ucu (tryCompanionChat) da çalışır', async () => {
    setPresence(on);
    const fetchSpy = mockChatOk('İyiyim, sen nasılsın?');
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('nasılsın', GEMINI_OPTS);
    expect(r).not.toBeNull();
    expect(r!.route).toBe('companion_gemini');
  });

  it('NAVIGATION komutu: intent üretilir ve köprülenir', async () => {
    setPresence(on);
    vi.stubGlobal('fetch', mockBrainJson({
      type: 'action', intent: 'NAVIGATE_ADDRESS', destination: 'Kadıköy',
      feedback: 'Kadıköy rotası açılıyor', confidence: 0.95,
    }));

    const r = await tryCompanionBrain('kadıköye git', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind !== 'action') return;
    expect(r.semantic.intent).toBe('NAVIGATE_ADDRESS');
    const intent = fromSemanticResult(r.semantic, 'kadıköye git');
    expect(intent?.type).toBe('NAVIGATE_ADDRESS');
    expect(intent?.payload.destination).toBe('Kadıköy');
  });

  it('MEDIA komutu: intent üretilir ve köprülenir', async () => {
    setPresence(on);
    vi.stubGlobal('fetch', mockBrainJson({
      type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'Sezen Aksu',
      feedback: 'Açılıyor', confidence: 0.95,
    }));

    const r = await tryCompanionBrain('sezen aksu çal', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind !== 'action') return;
    const intent = fromSemanticResult(r.semantic, 'sezen aksu çal');
    expect(intent?.type).toBe('PLAY_MUSIC_SEARCH');
    expect(intent?.payload.searchQuery).toBe('Sezen Aksu');
  });

  it('SETTINGS komutu: SET_SETTING intent\'i üretilir', async () => {
    setPresence(on);
    vi.stubGlobal('fetch', mockBrainJson({
      type: 'action', intent: 'SET_SETTING', settingKey: 'brightness',
      settingKind: 'number', settingAction: 'inc',
      feedback: 'Parlaklık artırılıyor', confidence: 0.92,
    }));

    const r = await tryCompanionBrain('ekran parlaklığını artır', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind !== 'action') return;
    const intent = fromSemanticResult(r.semantic, 'ekran parlaklığını artır');
    expect(intent?.type).toBe('SET_SETTING');
    expect(intent?.payload.settingKey).toBe('brightness');
  });

  it('VEHICLE sorusu: QUERY_SENSOR intent\'i üretilir (değer UYDURULMAZ)', async () => {
    setPresence(on);
    vi.stubGlobal('fetch', mockBrainJson({
      type: 'action', intent: 'QUERY_SENSOR', sensorQuery: 'motor suyu sıcaklığı',
      feedback: 'Motor suyu sıcaklığı okunuyor', confidence: 0.9,
    }));

    const r = await tryCompanionBrain('motor suyu kaç derece', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind !== 'action') return;
    expect(r.semantic.intent).toBe('QUERY_SENSOR');
    const intent = fromSemanticResult(r.semantic, 'motor suyu kaç derece');
    expect(intent?.type).toBe('QUERY_SENSOR');
  });

  it('prompt KOMUT yeteneklerini her iki kipte de taşır', async () => {
    setPresence(on);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'ok' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('bir şey söyle', GEMINI_OPTS);

    const p = lastPrompt(fetchSpy);
    expect(p).toContain('NAVIGATE_ADDRESS');
    expect(p).toContain('SET_SETTING');
    expect(p).toContain('QUERY_SENSOR');
    expect(p).toContain('PLAY_MUSIC_SEARCH');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 — PRESENCE yalnız TONU değiştirir
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI F1 · presence yalnız TONU değiştirir', () => {
  it('AÇIK → yol arkadaşı çerçevesi; KAPALI → asistan çerçevesi + sohbeti uzatmama talimatı', () => {
    setPresence(true);
    const onPrompt = _buildPromptForTest(false);
    setPresence(false);
    const offPrompt = _buildPromptForTest(false);

    expect(onPrompt).toContain('yol arkadaşısın');
    expect(onPrompt).not.toContain('sohbeti KENDİN UZATMA');

    expect(offPrompt).toContain('asistansın');
    expect(offPrompt).toContain('sohbeti KENDİN UZATMA');
    // Kapalıyken bile SOHBET YASAK DEĞİLDİR — yalnız uzatma kısılır.
    expect(offPrompt).toContain('Sohbet edebilirsin');
  });

  it('KAPALI promptu da doğal konuşma ve araç bağlamı kurallarını KORUR', () => {
    setPresence(false);
    const p = _buildPromptForTest(false);
    expect(p).toContain('Doğal ve akıcı konuş');
    expect(p).toContain('YASAK');                        // resmi kalıp yasağı
    expect(p).toContain('şive');                         // şive duyarlılığı korunur
  });

  it('currentPresenceMode ayarı yansıtır; ayar okunamazsa NÖTR (assistant)', () => {
    setPresence(true);
    expect(currentPresenceMode()).toBe('companion');
    setPresence(false);
    expect(currentPresenceMode()).toBe('assistant');

    const spy = vi.spyOn(useStore, 'getState').mockImplementation(() => { throw new Error('store yok'); });
    expect(currentPresenceMode()).toBe('assistant');     // fail-soft: daha az konuşan yön
    spy.mockRestore();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 — GÜVENLİK / FALLBACK presence'tan BAĞIMSIZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI F1 · güvenlik ve fallback presence\'tan bağımsız', () => {
  it.each(PRESENCE_MODES)('%s — bilişsel koruma modunda ONLINE AÇILMAZ', async (_l, on) => {
    setPresence(on);
    useCognitiveStore.getState().setMode('CRITICAL');
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'olmamalı' });
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionBrain('nasılsın', GEMINI_OPTS);
    // PRE-GATE online'ı kapattı → sağlayıcıya İSTEK GİTMEZ (her iki kipte AYNI).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(PRESENCE_MODES)('%s — sağlayıcı düşerse aynı fallback davranışı', async (_l, on) => {
    setPresence(on);
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('nasılsın', GEMINI_OPTS);
    expect(fetchSpy).toHaveBeenCalled();
    // Zincir düştü → offline sohbet ya da null; İKİ KİPTE de aynı sınıf sonuç.
    if (r !== null) expect(r.kind).toBe('chat');
  });

  it('boş metin her iki kipte de null (girdi sözleşmesi değişmedi)', async () => {
    for (const [, on] of PRESENCE_MODES) {
      setPresence(on);
      expect(await tryCompanionBrain('   ', GEMINI_OPTS)).toBeNull();
      expect(await tryCompanionChat('   ', GEMINI_OPTS)).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 — YAPISAL KİLİTLER (regresyon)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI F1 · yapısal kilitler', () => {
  const providerSrc = readFileSync(
    resolve(process.cwd(), 'src/platform/companion/companionChatProvider.ts'), 'utf8',
  );

  it('sağlayıcıda `companionEnabled` ERKEN-RETURN kapısı YOKTUR', () => {
    // Bu desen geri gelirse presence yeniden bir beyin şalterine döner.
    expect(providerSrc).not.toMatch(/companionEnabled\s*!==\s*true\)\s*return\s+null/);
    expect(providerSrc).not.toMatch(/companionEnabled\s*!==\s*true\)\s*\{?\s*return\s+null/);
  });

  it('presence kararı TEK yerde alınır (paralel ikinci beyin YOK)', () => {
    /* Yorum satırları hariç: `companionEnabled` sağlayıcıda YALNIZ iki yerde
     * geçmelidir — (1) presence çözücü, (2) modelin gördüğü ayar açıklaması.
     * Üçüncü bir kod kullanımı, kararın ikinci bir yerde alınmaya başladığının
     * (yani presence'ın yeniden bir kapıya dönüştüğünün) erken işaretidir. */
    const codeHits = providerSrc.split('\n')
      .filter((l) => l.includes('companionEnabled'))
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      });
    expect(codeHits).toHaveLength(2);
    expect(codeHits.some((l) => l.includes('=== true'))).toBe(true);           // presence çözücü
    expect(codeHits.some((l) => l.includes('SET_SETTING'))).toBe(true);        // prompt açıklaması
  });

  it('PROAKTİFLİK hâlâ presence\'a bağlıdır (companionEngine kapısı DURUYOR)', () => {
    const engineSrc = readFileSync(
      resolve(process.cwd(), 'src/platform/companion/companionEngine.ts'), 'utf8',
    );
    // Kendiliğinden konuşma presence ayarının GERÇEK işidir — bu kapı KALMALI.
    expect(engineSrc).toMatch(/companionEnabled\s*!==\s*true\)\s*return/);
  });

  it('güvenlik çekirdeği presence\'ı HİÇ okumaz (güvenlik ayardan bağımsız)', () => {
    const kernelSrc = readFileSync(
      resolve(process.cwd(), 'src/platform/assistant/assistantSafetyKernel.ts'), 'utf8',
    );
    expect(kernelSrc).not.toContain('companionEnabled');
  });

  it('tek-cevap otoritesi (maviSpeech) presence\'ı HİÇ okumaz', () => {
    const speechSrc = readFileSync(
      resolve(process.cwd(), 'src/platform/assistant/maviSpeech.ts'), 'utf8',
    );
    expect(speechSrc).not.toContain('companionEnabled');
  });

  it('eylem otoritesi presence\'ı HİÇ okumaz (yetki ayardan bağımsız)', () => {
    const authoritySrc = readFileSync(
      resolve(process.cwd(), 'src/platform/action/maviActionAuthority.ts'), 'utf8',
    );
    expect(authoritySrc).not.toContain('companionEnabled');
  });
});
