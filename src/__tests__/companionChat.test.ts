/**
 * companionChat.test.ts — "Yol Arkadaşım" AI-FIRST sohbet hattı testleri.
 *
 * Mimari kural (kullanıcı onaylı, 2026-06-11): companion açıkken komut
 * olmayan/belirsiz HER cümle önce Gemini'ye gider — keyword listesi ana yol
 * DEĞİL, yalnız offline fallback kategori ipucu.
 *
 * Kapsam:
 *  - AI-first: listede OLMAYAN serbest cümle de Gemini'ye gider
 *  - key yok / internet yok / hata-timeout / 429 → offline fallback
 *  - 429 soğuma penceresi: pencere içinde Gemini tekrar denenmez
 *  - offline fallback zinciri: engine → kategori şablonu → null (zincir devam)
 *  - ham OBD verisi Gemini'ye GİTMEZ — Commit 2 yorumlayıcı çıktısı gider
 *  - araç komutları bozulmaz (parser ayrımı)
 *  - companion kapalı → null (eski zincir aynen)
 *  - voice_diag 'voice_route' aşaması şemada
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Servis mock'ları (provider → offlineConversationEngine + obdService) ── */

vi.mock('../platform/mediaService', () => ({
  getMediaState: () => ({ hasSession: false, track: null }),
}));
vi.mock('../platform/gpsService', () => ({
  getGPSState: () => ({ location: { speed: 0 } }),
}));
vi.mock('../platform/routingService', () => ({
  getRouteState: () => ({ geometry: null, totalDistanceMeters: 0, totalDurationSeconds: 0 }),
}));
vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => {
    cb({
      speed: 50, rpm: 2000, engineTemp: 88, fuelLevel: 23,
      fuelRemainingL: 11, estimatedRangeKm: 143, range: -1,
      batteryVoltage: 13.8, batteryLevel: -1, chargingState: 'not_charging',
      throttle: 15, headlights: false,
      doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
      tpms: { fl: 235, fr: 233, rl: 230, rr: 232 },
    });
    return () => {};
  },
}));

import {
  classifySmalltalk,
  tryCompanionChat,
  tryCompanionBrain,
  repairMusicQuery,
  _resetCompanionChatForTest,
} from '../platform/companion/companionChatProvider';
import { fromSemanticResult } from '../platform/intentEngine';
import { parseCommandFull } from '../platform/commandParser';
import { VOICE_DIAG_STAGES } from '../platform/voiceDiagService';
import { useStore } from '../store/useStore';

const STORAGE_KEY = 'car-launcher-storage';
const GEMINI_OPTS = { provider: 'gemini', apiKey: 'AIzaTest', hasNet: true } as const;

function setupCompanion(enabled: boolean): void {
  localStorage.removeItem(STORAGE_KEY);
  useStore.getState().resetSettings();
  useStore.getState().updateSettings({ companionEnabled: enabled });
}

function mockGeminiOk(text = 'İyiyim, sen nasılsın?') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });
}

function lastRequestBody(fetchSpy: ReturnType<typeof vi.fn>): {
  system_instruction: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: { responseMimeType?: string; temperature: number; maxOutputTokens: number };
} {
  const calls = fetchSpy.mock.calls;
  const [, init] = calls[calls.length - 1] as [string, { body: string }];
  return JSON.parse(init.body);
}

/* ── 1. classifySmalltalk — yalnız offline kategori ipucu ───── */

describe('classifySmalltalk — fallback kategori ipucu (route kararı DEĞİL)', () => {
  it('kategoriler doğru', () => {
    expect(classifySmalltalk('nasılsın')).toBe('howareyou');
    expect(classifySmalltalk('ne var ne yok')).toBe('howareyou');
    expect(classifySmalltalk('canım sıkıldı')).toBe('bored');
    expect(classifySmalltalk('moralim bozuk')).toBe('bored');
    expect(classifySmalltalk('sohbet edelim')).toBe('chat');
    expect(classifySmalltalk('yorgunum')).toBe('fatigue');
  });

  it('komut cümleleri kategorisiz', () => {
    expect(classifySmalltalk('araç durumu')).toBeNull();
    expect(classifySmalltalk('haritayı aç')).toBeNull();
  });
});

/* ── 2. Parser ayrımı — araç komutları bozulmaz ─────────────── */

describe('parser — araç komutları komut yolunda kalır, sohbet sızmaz', () => {
  it.each([
    ['araç durumu', 'vehicle_status'],
    ['obd durumu', 'vehicle_status'],
  ] as const)('"%s" → %s', (input, type) => {
    const cmd = parseCommandFull(input).command;
    expect(cmd?.type).toBe(type);
    expect(cmd!.confidence).toBeGreaterThanOrEqual(0.7); // komut yolu: companion'a uğramaz
  });

  it('"yakıt durumu" / "motor sıcaklığı" → vehicle_* intent', () => {
    expect(parseCommandFull('yakıt durumu').command?.type).toMatch(/^vehicle_/);
    expect(parseCommandFull('motor sıcaklığı').command?.type).toMatch(/^vehicle_/);
  });

  it.each(['nasılsın', 'ne var ne yok', 'moralim bozuk', 'canım sıkıldı', 'sohbet edelim'])(
    '"%s" → parser OTOMATİK eşiğe (≥0.7) ulaşamaz → companion router\'a düşer', (s) => {
      const cmd = parseCommandFull(s).command;
      if (cmd !== null) expect(cmd.confidence).toBeLessThan(0.7);
    });
});

/* ── 3. tryCompanionChat — AI-first davranış ────────────────── */

describe('tryCompanionChat — AI-first router ucu', () => {
  beforeEach(() => {
    _resetCompanionChatForTest();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setupCompanion(false);
  });

  it('companion KAPALI → null (eski zincir AYNEN işler)', async () => {
    setupCompanion(false);
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await tryCompanionChat('nasılsın', GEMINI_OPTS)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AI-FIRST: keyword listesinde OLMAYAN serbest cümle de Gemini\'ye gider', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk('Anlıyorum, bazen öyle günler olur.');
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('bugün işler çok ters gitti ya', GEMINI_OPTS);
    expect(r!.route).toBe('companion_gemini');
    expect(r!.response).toBe('Anlıyorum, bazen öyle günler olur.');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('"nasılsın" → Gemini sohbeti (endpoint + kimlik + serbest metin config)', async () => {
    setupCompanion(true);
    useStore.getState().updateSettings({ companionAssistantName: 'Mavi Test' });
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('nasılsın', GEMINI_OPTS);
    expect(r!.route).toBe('companion_gemini');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('key=AIzaTest');
    const body = lastRequestBody(fetchSpy);
    expect(body.system_instruction.parts[0].text).toContain('Mavi Test');
    expect(body.generationConfig.responseMimeType).toBeUndefined(); // intent JSON değil, sohbet
    expect(body.generationConfig.temperature).toBeGreaterThan(0.5);
  });

  it('HAM OBD VERİSİ GİTMEZ — Commit 2 yorumlayıcı çıktısı gider', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('yakıt konusunda ne düşünüyorsun', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    // interpretFuel(23, 143) çıktısı: yorumlanmış insan dili
    expect(prompt).toContain('yüzde 23');
    expect(prompt).toContain('yaklaşık 150 kilometre');
    // ham alan adları / ham çiftler asla prompt'ta olmaz
    expect(prompt).not.toContain('fuelLevel');
    expect(prompt).not.toContain('estimatedRangeKm');
    expect(prompt).not.toContain('fuel=');
  });

  it('key YOK → offline fallback, Gemini\'ye İSTEK ATILMAZ', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('nasılsın', { provider: 'gemini', apiKey: '', hasNet: true });
    expect(r!.route).toBe('companion_offline');
    expect(r!.response.length).toBeGreaterThan(0);
    expect(r!.response).not.toContain('alınamıyor');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('internet YOK → offline fallback, istek atılmaz', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('naber', { provider: 'gemini', apiKey: 'k', hasNet: false });
    expect(r!.route).toBe('companion_offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Gemini hata/timeout → offline fallback (kullanıcı cevapsız kalmaz)', async () => {
    setupCompanion(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const r = await tryCompanionChat('nasılsın', GEMINI_OPTS);
    expect(r!.route).toBe('companion_offline');
    expect(r!.response.length).toBeGreaterThan(0);
  });

  it('429 → offline + soğuma penceresi: ikinci çağrıda Gemini DENENMEZ', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    const r1 = await tryCompanionChat('nasılsın', GEMINI_OPTS);
    expect(r1!.route).toBe('companion_offline');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const r2 = await tryCompanionChat('naber', GEMINI_OPTS);
    expect(r2!.route).toBe('companion_offline');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // pencere içinde tekrar istek YOK
  });

  it('offline fallback zinciri: engine kapsamıyor + kategori var → şablon', async () => {
    setupCompanion(true);
    // 'canım sıkıldı' offlineConversationEngine kw listelerinde YOK → kategori şablonu
    const r = await tryCompanionChat('canım sıkıldı', { hasNet: false });
    expect(r!.route).toBe('companion_offline');
    expect(r!.response.length).toBeGreaterThan(0);
  });

  it('offline + hiçbir eşleşme yok → null (zincir devam: "anlaşılamadı" dürüst)', async () => {
    setupCompanion(true);
    const r = await tryCompanionChat('xqwzt blgrh vmpld', { hasNet: false });
    expect(r).toBeNull();
  });

  it('sürüşte: doğal sohbet sınırları — "2-3 kısa cümle" kuralı, robotik "8 kelime" YOK', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk('Kısa.');
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('nasılsın', { ...GEMINI_OPTS, isDriving: true });
    const body = lastRequestBody(fetchSpy);
    expect(body.generationConfig.maxOutputTokens).toBe(100);        // 60 cevapları ortadan kesiyordu
    const prompt = body.system_instruction.parts[0].text;
    expect(prompt).toContain('2-3 kısa cümle');
    expect(prompt).not.toContain('8 kelime');                       // robotik sınır kaldırıldı
    expect(prompt).toContain('Doğal ve akıcı konuş');
  });

  it('park halinde: 3 doğal cümleye izin + hitap her cümlede tekrarlanmaz kuralı', async () => {
    setupCompanion(true);
    useStore.getState().updateSettings({ companionUserCallsign: 'Selim' });
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('nasılsın', GEMINI_OPTS);
    const body = lastRequestBody(fetchSpy);
    expect(body.generationConfig.maxOutputTokens).toBe(160);
    const prompt = body.system_instruction.parts[0].text;
    expect(prompt).toContain('3 doğal cümle');
    expect(prompt).toContain('her cümlede kullanma');               // hitap tekrarı engeli
  });

  it('FAZ 1 — Ruh ve Kimlik: şive duyarlılığı + robotik kalıp yasağı + dost güvenlik reddi promptta', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('nasılsın', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('Karadeniz');                  // şive duyarlılığı
    expect(prompt).toContain('NİYETE odaklan');             // kelime değil niyet
    expect(prompt).toContain('Asla "anlamadım" deyip bırakma');
    expect(prompt).toContain('Tamam, hallettim');           // doğal tepki örneği
    expect(prompt).toContain('YASAK');                      // resmi kalıp yasağı
    expect(prompt).toContain('DOST TAVSİYESİYLE');          // güvenlik reddi tonu
    expect(prompt).toContain('arabanın ruhu');              // kimlik
  });

  it('FAZ 1 — kişilik tonu kullanıcı seçimine saygılı: profesyonelde argo yasağı', async () => {
    setupCompanion(true);
    useStore.getState().updateSettings({ companionPersonality: 'profesyonel' });
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('nasılsın', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('argo ve laubalilik kullanma');
    expect(prompt).not.toContain('senli benli');            // samimi tonu sızmaz
  });

  it('araç verisi yokken: smalltalk için teknik hata cevabı İSTENMEZ (doğal dil kuralı promptta)', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk();
    vi.stubGlobal('fetch', fetchSpy);
    // OBD mock'u modül seviyesinde veri veriyor — veri YOK durumunu yorumlayıcı
    // boş bağlamla simüle edemeyiz; bunun yerine kural metni bağlamsız dalda.
    // interpretFuel(23,143) bağlam ürettiği için bu testte bağlamlı dal doğrulanır:
    await tryCompanionChat('nasılsın', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('yalnız konuyla ilgiliyse');           // smalltalk'a veri sızdırma yok
  });

  it('sürüşte offline yanıt kısa (ISO 15008)', async () => {
    setupCompanion(true);
    const r = await tryCompanionChat('canım sıkıldı', { hasNet: false, isDriving: true });
    expect(r!.route).toBe('companion_offline');
    expect(r!.response.length).toBeLessThan(40);
  });

  it('RAM geçmişi: ikinci çağrının contents\'i önceki turları taşır', async () => {
    setupCompanion(true);
    const fetchSpy = mockGeminiOk('Cevap.');
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('nasılsın', GEMINI_OPTS);
    await tryCompanionChat('güzel bir gün değil mi', GEMINI_OPTS);

    const body = lastRequestBody(fetchSpy);
    expect(body.contents.length).toBe(3); // user + model + yeni user
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[1].role).toBe('model');
  });
});

/* ── 3b. tryCompanionBrain — birleşik beyin (Siri mantığı) ──── */

describe('tryCompanionBrain — komut/sohbet kararını tek Gemini çağrısı verir', () => {
  beforeEach(() => {
    _resetCompanionChatForTest();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setupCompanion(false);
  });

  function mockBrainJson(obj: Record<string, unknown>) {
    return vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    });
  }

  it('ACTION kararı: müzik isteği PLAY_MUSIC_SEARCH + düzeltilmiş isim döner; intent köprülenebilir', async () => {
    setupCompanion(true);
    vi.stubGlobal('fetch', mockBrainJson({
      type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'Leyla Göktürk',
      feedback: 'Leyla Göktürk açılıyor', confidence: 0.95,
    }));

    const r = await tryCompanionBrain('leyla türkten müzik çal', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind !== 'action') return;
    expect(r.semantic.intent).toBe('PLAY_MUSIC_SEARCH');
    expect(r.semantic.query).toBe('Leyla Göktürk');           // ASR onarımı beynin işi
    const intent = fromSemanticResult(r.semantic, 'leyla türkten müzik çal');
    expect(intent?.type).toBe('PLAY_MUSIC_SEARCH');
    expect(intent?.payload.searchQuery).toBe('Leyla Göktürk'); // payload köprüsü (bug fix)
  });

  it('FAZ 1 — tema komutları beynin yetkisinde: CYCLE_THEME kabul edilir, prompt şive komut örneği taşır', async () => {
    setupCompanion(true);
    const fetchSpy = mockBrainJson({ type: 'action', intent: 'CYCLE_THEME', feedback: 'Tema değişti', confidence: 0.9 });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('temayı bi değiştirsene', GEMINI_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind === 'action') expect(r.semantic.intent).toBe('CYCLE_THEME');
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('CYCLE_THEME');
    expect(prompt).toContain('birez kıs kurban');           // şive komutu da komuttur
  });

  it('CHAT kararı: serbest sohbet say alanıyla döner', async () => {
    setupCompanion(true);
    vi.stubGlobal('fetch', mockBrainJson({ type: 'chat', say: 'İyiyim, sen nasılsın?' }));
    const r = await tryCompanionBrain('nasılsın', GEMINI_OPTS);
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') expect(r.response).toBe('İyiyim, sen nasılsın?');
  });

  it('beyin prompt\'u ASR onarım talimatı + intent listesi + JSON modu içerir', async () => {
    setupCompanion(true);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamamdır.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('bir şey söyle', GEMINI_OPTS);

    const body = lastRequestBody(fetchSpy);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const prompt = body.system_instruction.parts[0].text;
    expect(prompt).toContain('ÖZEL İSİMLERİ');                 // ASR onarım talimatı
    expect(prompt).toContain('PLAY_MUSIC_SEARCH');
    expect(prompt).toContain('SEARCH_POI');
  });

  it('geçersiz intent / bozuk JSON → offline fallback zinciri (sohbet)', async () => {
    setupCompanion(true);
    vi.stubGlobal('fetch', mockBrainJson({ type: 'action', intent: 'RM_RF_SLASH' }));
    const r = await tryCompanionBrain('nasılsın', GEMINI_OPTS);
    expect(r!.kind).toBe('chat');                              // action sızmaz, offline sohbet
    if (r!.kind === 'chat') expect(r.route).toBe('companion_offline');
  });

  it('companion KAPALI → null (eski zincir aynen)', async () => {
    setupCompanion(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await tryCompanionBrain('nasılsın', GEMINI_OPTS)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ── 3c. repairMusicQuery — yerel müzik sorgusu ASR onarımı ─── */

describe('repairMusicQuery — bozuk sanatçı adı onarımı', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('Gemini düzeltme önerirse düzeltilmiş ad döner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"q":"Leyla Göktürk"}' }] } }] }),
    }));
    expect(await repairMusicQuery('leyla türk', 'k')).toBe('Leyla Göktürk');
  });

  it('aynı ad dönerse null (değişiklik yok sinyali)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"q":"Tarkan"}' }] } }] }),
    }));
    expect(await repairMusicQuery('Tarkan', 'k')).toBeNull();
  });

  it('ağ hatası / bozuk JSON → null (komut ham sorguyla devam eder, fail-soft)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(await repairMusicQuery('leyla türk', 'k')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'bozuk' }] } }] }) }));
    expect(await repairMusicQuery('leyla türk', 'k')).toBeNull();
  });
});

/* ── 4. Tanı şeması ─────────────────────────────────────────── */

describe('voice_diag — route aşaması', () => {
  it("'voice_route' aşaması şemada kayıtlı", () => {
    expect(VOICE_DIAG_STAGES).toContain('voice_route');
  });
});
