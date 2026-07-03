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
// Araç-tipi kontrolü (EV yetenek notu testi için; varsayılan ICE veri seti).
const OBD = vi.hoisted(() => ({ vehicleType: 'ice' as string }));
vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => {
    cb({
      vehicleType: OBD.vehicleType,
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
// World View — yolculuk süresi enjeksiyonu kontrolü (varsayılan: aktif trip YOK).
const TRIP = vi.hoisted(() => ({
  current: null as null | { liveDurationMin: number; liveDistanceKm: number },
}));
vi.mock('../platform/tripLogService', () => ({
  getTripSnapshot: () => ({
    active: TRIP.current !== null, current: TRIP.current,
    history: [], totalDistanceKm: 0, totalTrips: 0,
  }),
}));
// Yerel hava kısayolu (tryLocalWeatherAnswer) — beyin web+hava kesişimi testi
// gerçek veri VARMIŞ gibi davranır; varsayılan "henüz alınamadı" (bypass devre dışı).
const WEATHER = vi.hoisted(() => ({ narrative: 'Hava durumu henüz alınamadı.' as string }));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => WEATHER.narrative,
  refreshWeather: async () => { /* test'te kullanılmıyor */ },
  onWeatherState: (_cb: (s: unknown) => void) => () => {},
  // Şehir-tespit: belirli şehir adı geçen hava sorgusu → true (yerel yerine web).
  // Testlerdeki "hava durumu nasıl olacak" gibi genel sorgular → false.
  weatherQueryNamesCity: (t: string) =>
    /\b(istanbul|ankara|izmir|bursa|antalya|adana|mersin|tarsus|konya|gaziantep|trabzon)\b/i.test(t),
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

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    // Key artık URL'de değil, X-goog-api-key header'ında (2026 API key sistemi).
    expect(url).not.toContain('key=');
    expect((init.headers as Record<string, string>)['X-goog-api-key']).toBe('AIzaTest');
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

  it('Phase P — Contextual AI Partner: yardımcı pilot + World View + genel ASR/niyet talimatı', async () => {
    setupCompanion(true);
    TRIP.current = null;
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamam.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('bir şey söyle', GEMINI_OPTS);

    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('YARDIMCI PİLOT');                // komut robotu → bağlamsal ortak
    expect(prompt).toContain('World View');                    // dünya görüşü çerçevesi
    expect(prompt).toContain('birez muzuk ac');                // genel kelime ASR/niyet örneği
  });

  it('Phase P — World View: aktif yolculuk süresi prompt bağlamına girer (trip duration)', async () => {
    setupCompanion(true);
    TRIP.current = { liveDurationMin: 95, liveDistanceKm: 120 };  // 1 saat 35 dk yoldayız
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'İyi gidiyoruz.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('nasıl gidiyoruz', GEMINI_OPTS);

    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('yoldayız');                      // interpretTripDuration çıktısı
    expect(prompt).toContain('120 kilometre');                 // canlı mesafe
    expect(prompt).toContain('yüzde 23');                      // yakıt yorumu da hâlâ var (World View bütün)
    TRIP.current = null;
  });

  it('Vehicle-Aware — EV: Gemini\'ye "RPM/yakıt YOK, uydurma" yetenek notu girer', async () => {
    setupCompanion(true);
    OBD.vehicleType = 'ev';
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamam.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('menzilim ne kadar', GEMINI_OPTS);

    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('TAM ELEKTRİKLİ');                // EV yetenek notu
    expect(prompt).toContain('ASLA bahsetme');                 // olmayan özellikten bahsetme (Zero Redundancy)
    OBD.vehicleType = 'ice';
  });

  it('Vehicle-Aware — ICE: yetenek notu girmez (gereksiz prompt gürültüsü yok)', async () => {
    setupCompanion(true);
    OBD.vehicleType = 'ice';
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamam.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('nasılsın', GEMINI_OPTS);

    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).not.toContain('TAM ELEKTRİKLİ');            // ICE'de EV notu yok
  });

  it('geçersiz intent / bozuk JSON → offline fallback zinciri (sohbet)', async () => {
    setupCompanion(true);
    vi.stubGlobal('fetch', mockBrainJson({ type: 'action', intent: 'RM_RF_SLASH' }));
    const r = await tryCompanionBrain('nasılsın', GEMINI_OPTS);
    expect(r!.kind).toBe('chat');                              // action sızmaz, offline sohbet
    if (r!.kind === 'chat') expect(r.route).toBe('companion_offline');
  });

  it('FAZ 3 — kişilik beynin tepesinde: profesyonel → MAKAM ASİSTANI, samimi → MAHALLE ARKADAŞI', async () => {
    setupCompanion(true);
    useStore.getState().updateSettings({ companionPersonality: 'profesyonel' });
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Buyurun.' });
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionBrain('bir şey söyle', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('MAKAM ASİSTANI');
    expect(prompt).not.toContain('MAHALLE ARKADAŞI');          // kişilikler karışmaz

    useStore.getState().updateSettings({ companionPersonality: 'samimi' });
    await tryCompanionBrain('bir şey daha söyle', GEMINI_OPTS);
    const prompt2 = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt2).toContain('MAHALLE ARKADAŞI');
  });

  it('FAZ 3 — şive dayanıklılığı + çıkmaz yok talimatı promptta', async () => {
    setupCompanion(true);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamam.' });
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionBrain('uşağum bi bak hele', GEMINI_OPTS);
    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('uşağum');                        // şive örnekleri
    expect(prompt).toContain('KARAKTER İPUCU');                // engel değil ipucu
    expect(prompt).toContain('ASLA ÇIKMAZ YOK');               // no dead-ends talimatı
    expect(prompt).toContain('FIND_NEARBY_GAS');               // şiveli komut örneği
  });

  it('FAZ 3 — No Dead-Ends: online deneme çöktü + offline eşleşme yok → kişiliğe uygun tekrar-rica (null DEĞİL)', async () => {
    setupCompanion(true);
    useStore.getState().updateSettings({ companionPersonality: 'profesyonel' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const r = await tryCompanionBrain('xqwzt blgrh vmpld', GEMINI_OPTS);
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.route).toBe('companion_offline');
      expect(r.response).toBe('Tam anlayamadım, tekrar alabilir miyim?');
    }
  });

  it('FAZ 3 — Gemini HİÇ denenmediyse (offline) anlaşılmayan metin → null (eski dürüst zincir korunur)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await tryCompanionBrain('xqwzt blgrh vmpld', { provider: 'gemini', apiKey: 'k', hasNet: false });
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('companion KAPALI → null (eski zincir aynen)', async () => {
    setupCompanion(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await tryCompanionBrain('nasılsın', GEMINI_OPTS)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /* ── İNTERNET / grounding yeteneği (haber/güncel bilgi) ──────── */

  it('WEB kararı: beyin type:"web" → ikinci GROUNDED çağrı (google_search) yapılır, cevap CHAT döner', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      // 1) beyin kararı: internet gerekiyor
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'web', query: 'bugün gündem haber özeti' }) }] } }] }),
      })
      // 2) grounded cevap (çok parçalı text → birleştirilir)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Bugün öne çıkan ' }, { text: 'gelişme ekonomi oldu.' }] } }] }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('bugünün haberlerini özetle', GEMINI_OPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);                 // beyin + grounded
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toBe('Bugün öne çıkan gelişme ekonomi oldu.');
      expect(r.route).toBe('companion_gemini');
    }
  });

  it('GROUNDED çağrı google_search aracını taşır ve JSON modu KULLANMAZ (serbest metin)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'web', query: 'dolar kuru' }) }] } }] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Dolar 32 lira civarında.' }] } }] }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionBrain('dolar kaç para', GEMINI_OPTS);
    const [, init] = fetchSpy.mock.calls[1] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it('GROUNDED başarısız → "erişimim yok" demez; offline/reask zincirine düşer', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'web', query: 'haberler' }) }] } }] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); // grounded çöktü
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('haberleri söyle', GEMINI_OPTS);
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.route).toBe('companion_offline');             // grounding başarısız → reask
      expect(r.response.toLowerCase()).not.toContain('erişim');
    }
  });

  it('WEB + HAVA kesişimi: beyin type:"web" hava sorgusu döndürdü + gerçek hava verisi VAR → yerel narrative döner, GROUNDED çağrı YAPILMAZ', async () => {
    setupCompanion(true);
    WEATHER.narrative = 'Bugün hava açık, sıcaklık 24 derece.'; // "henüz alınamadı" İÇERMEZ → veri hazır sayılır
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'web', query: 'hava durumu nasıl olacak' }) }] } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('hava nasıl olacak', GEMINI_OPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);                 // yalnız beyin kararı — grounded İKİNCİ istek YOK
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toBe('Bugün hava açık, sıcaklık 24 derece.');
      expect(r.route).toBe('companion_gemini');
    }
    WEATHER.narrative = 'Hava durumu henüz alınamadı.'; // sonraki testler için sıfırla
  });

  it('beyin prompt\'u: internet/web kararı + fıkra + bilmece yetenekleri içerir', async () => {
    setupCompanion(true);
    const fetchSpy = mockBrainJson({ type: 'chat', say: 'Tamam.' });
    vi.stubGlobal('fetch', fetchSpy);
    await tryCompanionBrain('bir şey söyle', GEMINI_OPTS);

    const prompt = lastRequestBody(fetchSpy).system_instruction.parts[0].text;
    expect(prompt).toContain('İNTERNET ise');                  // web karar tipi
    expect(prompt).toContain('"type":"web"');
    expect(prompt).toContain('haberler');                      // güncel bilgi örneği
    expect(prompt).toContain('Fıkra isteyince');               // eğlence yeteneği
    expect(prompt).toContain('Bilmece isteyince');
    expect(prompt).toContain('cevabı HEMEN verme');            // bilmece davranışı
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

/* ── 3d. Groq sohbet ve beyin senaryoları ───────────────────── */

describe('Groq — companion sohbet ve beyin desteği', () => {
  const GROQ_OPTS = { provider: 'groq', apiKey: 'gsk_testkey', hasNet: true } as const;

  function mockGroqOk(content = 'İyiyim, teşekkürler!') {
    return vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    });
  }

  beforeEach(() => {
    _resetCompanionChatForTest();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setupCompanion(false);
  });

  it('Groq sohbet: companion açıkken Groq endpoint\'e istek atılır, companion_groq route döner', async () => {
    setupCompanion(true);
    const fetchSpy = mockGroqOk('Merhaba, yolculuk nasıl gidiyor?');
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionChat('nasılsın', GROQ_OPTS);
    expect(r!.route).toBe('companion_groq');
    expect(r!.response).toBe('Merhaba, yolculuk nasıl gidiyor?');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('api.groq.com');
  });

  it('Groq beyin: ACTION kararı → aksiyon döner, Groq endpoint kullanılır', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'Tarkan',
        feedback: 'Tarkan açılıyor', confidence: 0.9,
      }) } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('tarkan çal', GROQ_OPTS);
    expect(r!.kind).toBe('action');
    if (r!.kind === 'action') expect(r.semantic.intent).toBe('PLAY_MUSIC_SEARCH');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('api.groq.com');
  });

  it('Groq beyin promptu internet talimatı içermez (supportsGrounding:false), action/chat kuralları var', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ type: 'chat', say: 'Tamam.' }) } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionBrain('bir şey söyle', GROQ_OPTS);
    const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    const systemMsg = body.messages.find((m) => m.role === 'system')!.content;
    // Grounding talimatı OLMAMALI (Groq internet desteği yok)
    expect(systemMsg).not.toContain('İNTERNET ise');
    expect(systemMsg).not.toContain('"type":"web"');
    // Groq'ta dürüst uyarı olmalı
    expect(systemMsg).toContain('canlı/güncel internet erişimin YOK');
    // Komut kuralları yine de var
    expect(systemMsg).toContain('PLAY_MUSIC_SEARCH');
    expect(systemMsg).toContain('ASLA ÇIKMAZ YOK');
  });

  it('Groq beyin: Groq type:"web" üretirse sohbete dönüştürülür (No Dead-Ends, grounding yapılmaz)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      // Groq'un yanlışlıkla type:"web" ürettiği senaryo
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ type: 'web', query: 'haberler' }) } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('haberleri söyle', GROQ_OPTS);
    // Groq'ta web→chat dönüşümü askCompanionBrainGroq içinde yapılır; 2. istek YOK
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response.toLowerCase()).not.toContain('hata');
      expect(r.response).toContain('canlı');               // dürüst ama doğal yanıt
    }
  });

  it('Groq birincil + searchKey (Gemini arama) → Groq type:"web" grounding\'i Gemini google_search\'e devreder', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      // 1) Groq beyin: internet gerekiyor (searchKey varken web üretmesine izin var)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ type: 'web', query: 'güncel dolar kuru' }) } }] }) })
      // 2) Gemini grounded cevap (google_search) — arama Gemini'ye devredildi
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Dolar bugün 32 lira civarında.' }] } }] }) });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('dolar kaç para', {
      hasNet: true,
      searchKey: 'AIzaSearchKey',
      chain: [{ provider: 'groq' as const, apiKey: 'gsk_testkey' }],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [groqUrl] = fetchSpy.mock.calls[0] as [string];
    const [gemUrl]  = fetchSpy.mock.calls[1] as [string];
    expect(groqUrl).toContain('api.groq.com');
    expect(gemUrl).toContain('generativelanguage.googleapis.com'); // Gemini yalnız arama motoru
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toContain('Dolar');
      expect(r.route).toBe('companion_groq'); // asistan Groq, arama Gemini
    }
  });

  it('Groq 429 → soğuma penceresi: ikinci çağrıda Groq denenmez', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    const r1 = await tryCompanionChat('nasılsın', GROQ_OPTS);
    expect(r1!.route).toBe('companion_offline');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const r2 = await tryCompanionChat('naber', GROQ_OPTS);
    expect(r2!.route).toBe('companion_offline');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // pencere içinde tekrar istek YOK
  });

  it('Groq mesaj formatı: Authorization header ve messages dizisi doğru', async () => {
    setupCompanion(true);
    const fetchSpy = mockGroqOk('Tamam.');
    vi.stubGlobal('fetch', fetchSpy);

    await tryCompanionChat('merhaba', GROQ_OPTS);
    const [, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(init.headers['Authorization']).toBe('Bearer gsk_testkey');
    const body = JSON.parse(init.body) as { messages: { role: string }[]; model: string };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[body.messages.length - 1].role).toBe('user');
    expect(typeof body.model).toBe('string');
  });
});

/* ── 3e. tryCompanionBrain — hibrit zincir yedekleme (Gemini→Groq→Haiku) ── *
 * Kullanıcının Groq/Haiku anahtarı boşa durmasın diye devreye giren hibrit
 * zincir (bkz. CompanionChatOpts.chain, SIRA SABİT: gemini → groq → haiku). */

describe('tryCompanionBrain — hibrit zincir yedekleme (429/timeout sırasında asistan aptallaşmaz)', () => {
  const GEMINI_GROQ_CHAIN = {
    hasNet: true,
    chain: [
      { provider: 'gemini' as const, apiKey: 'AIzaTest' },
      { provider: 'groq' as const, apiKey: 'gsk_fallback' },
    ],
  } as const;
  const GEMINI_GROQ_HAIKU_CHAIN = {
    hasNet: true,
    chain: [
      { provider: 'gemini' as const, apiKey: 'AIzaTest' },
      { provider: 'groq' as const, apiKey: 'gsk_fallback' },
      { provider: 'haiku' as const, apiKey: 'sk-ant-fallback' },
    ],
  } as const;

  function mockBrainJson(obj: Record<string, unknown>) {
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
  }
  function mockGroqBrainJson(obj: Record<string, unknown>) {
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
  }
  function mockHaikuBrainJson(obj: Record<string, unknown>) {
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) };
  }

  beforeEach(() => {
    _resetCompanionChatForTest();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setupCompanion(false);
  });

  it('Gemini timeout/hata + chain\'de Groq var → Groq denenir, endpoint\'e istek atılır, sonuç döner', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error('timeout')) // 1) Gemini attı
      .mockResolvedValueOnce(mockGroqBrainJson({ type: 'chat', say: 'Groq yedek cevap.' })); // 2) Groq yedeği
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('nasılsın', GEMINI_GROQ_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [groqUrl] = fetchSpy.mock.calls[1] as [string];
    expect(groqUrl).toContain('api.groq.com');
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toBe('Groq yedek cevap.');
      expect(r.route).toBe('companion_groq');
    }
  });

  it('Gemini null döndü (geçersiz/boş yanıt) + chain\'de Groq var → Groq yedeği devreye girer', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // 1) Gemini başarısız (null)
      .mockResolvedValueOnce(mockGroqBrainJson({
        type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'Tarkan', feedback: 'Tarkan açılıyor', confidence: 0.9,
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('tarkan çal', GEMINI_GROQ_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r!.kind).toBe('action');
    if (r!.kind === 'action') expect(r.semantic.intent).toBe('PLAY_MUSIC_SEARCH');
  });

  it('chain\'de yalnız Gemini VARKEN attı → eski davranış (yalnız Gemini denenir, başka istek atılmaz)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('nasılsın', GEMINI_OPTS); // chain'de yalnız gemini (geriye uyum)
    expect(fetchSpy).toHaveBeenCalledTimes(1); // yalnız Gemini denendi
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') expect(r.route).toBe('companion_offline'); // reask zinciri
  });

  it('Gemini 429 soğuma penceresindeyken + chain\'de Groq var → doğrudan Groq kullanılır', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }) // 1) Gemini 429 → soğuma başlar
      .mockResolvedValueOnce(mockGroqBrainJson({ type: 'chat', say: 'Soğuma sırasında Groq cevabı.' }));
    vi.stubGlobal('fetch', fetchSpy);

    const r1 = await tryCompanionBrain('nasılsın', GEMINI_OPTS); // yalnız gemini → soğumaya düşer
    expect(r1!.kind).toBe('chat');
    if (r1!.kind === 'chat') expect(r1.route).toBe('companion_offline');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // İkinci çağrı: hâlâ soğuma penceresinde ama chain'de Groq VAR → Groq'a doğrudan gider.
    const r2 = await tryCompanionBrain('naber', GEMINI_GROQ_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [groqUrl] = fetchSpy.mock.calls[1] as [string];
    expect(groqUrl).toContain('api.groq.com');
    expect(r2!.kind).toBe('chat');
    if (r2!.kind === 'chat') {
      expect(r2.response).toBe('Soğuma sırasında Groq cevabı.');
      expect(r2.route).toBe('companion_groq');
    }
  });

  it('Gemini VE Groq ikisi de attı → çökmez, kişiliğe uygun tekrar-rica ile döner (No Dead-Ends)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn().mockRejectedValue(new Error('timeout')); // her iki çağrı da atar
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('xqwzt blgrh vmpld', GEMINI_GROQ_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Gemini + Groq yedeği denendi
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') expect(r.route).toBe('companion_offline');
  });

  it('Gemini web kararı verdi ama grounding çöktü + chain\'de Groq var → Groq yedeği dener', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(mockBrainJson({ type: 'web', query: 'haberler' })) // 1) beyin: internet gerekiyor
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // 2) grounded çağrı çöktü
      .mockResolvedValueOnce(mockGroqBrainJson({ type: 'chat', say: 'Groq ile devam ediyoruz.' })); // 3) Groq yedeği
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('haberleri söyle', GEMINI_GROQ_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toBe('Groq ile devam ediyoruz.');
      expect(r.route).toBe('companion_groq');
    }
  });

  /* ── 5 numaralı görev kilitleri: tam üç halkalı zincir + hava kesişimi ── */

  it('(a) zincir: Gemini reject + Groq reject → Haiku endpoint\'ine istek atılır ve cevap döner', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))         // 1) Gemini attı
      .mockRejectedValueOnce(new Error('network'))          // 2) Groq attı
      .mockResolvedValueOnce(mockHaikuBrainJson({ type: 'chat', say: 'Haiku zincirin sonunda cevap verdi.' })); // 3) Haiku
    vi.stubGlobal('fetch', fetchSpy);

    const r = await tryCompanionBrain('nasılsın', GEMINI_GROQ_HAIKU_CHAIN);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [haikuUrl, haikuInit] = fetchSpy.mock.calls[2] as [string, { headers: Record<string, string> }];
    expect(haikuUrl).toContain('api.anthropic.com');
    expect(haikuInit.headers['x-api-key']).toBe('sk-ant-fallback');
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.response).toBe('Haiku zincirin sonunda cevap verdi.');
      expect(r.route).toBe('companion_haiku');
    }
  });

  it('(b) Gemini 429 soğuma penceresinde + chain\'de Groq var → Groq direkt kullanılır (Haiku denenmez)', async () => {
    setupCompanion(true);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }) // 1) Gemini 429 → soğuma başlar
      .mockResolvedValueOnce(mockGroqBrainJson({ type: 'chat', say: 'Groq soğuma sırasında cevap verdi.' }));
    vi.stubGlobal('fetch', fetchSpy);

    const r1 = await tryCompanionBrain('nasılsın', GEMINI_OPTS); // yalnız gemini → soğumaya düşer
    expect(r1!.kind).toBe('chat');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const r2 = await tryCompanionBrain('naber', GEMINI_GROQ_HAIKU_CHAIN); // soğuma sürüyor
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Gemini ATLANDI, doğrudan Groq — Haiku'ya hiç gerek kalmadı
    const [groqUrl] = fetchSpy.mock.calls[1] as [string];
    expect(groqUrl).toContain('api.groq.com');
    expect(r2!.kind).toBe('chat');
    if (r2!.kind === 'chat') {
      expect(r2.response).toBe('Groq soğuma sırasında cevap verdi.');
      expect(r2.route).toBe('companion_groq');
    }
  });
});

/* ── 4. Tanı şeması ─────────────────────────────────────────── */

describe('voice_diag — route aşaması', () => {
  it("'voice_route' aşaması şemada kayıtlı", () => {
    expect(VOICE_DIAG_STAGES).toContain('voice_route');
  });
});
