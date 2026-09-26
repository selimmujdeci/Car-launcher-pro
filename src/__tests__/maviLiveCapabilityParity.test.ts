/**
 * MAVİ REGRESSION FIX (2026-09-21, kök neden `28afb632`) — LIVE / REST YETENEK
 * PARİTESİ + TUR ÇÖZÜM ANLAMI.
 *
 * Denetim iki kök neden kanıtladı:
 *  1. Live oturumu REST beyninin intent/alan/örnek bilgisini ALMIYORDU
 *     (REST 17 KB · Live 2,6 KB; 20 bilgi bloğunun 17'si eksik).
 *  2. Live herhangi bir ses/transkript ürettiğinde tur "çözüldü" sayılıyor;
 *     "yapamıyorum", araçsız sahte onay ve transkriptsiz ses REST/yerel
 *     kurtarmayı engelliyordu.
 *
 * Bu dosya GERÇEK üretim girişinden (`tryCompanionBrain`, sahte WSS + sahte
 * fetch) kilitler: hangi sağlayıcı çağrıldı, hangi rota döndü, hangi eylem
 * üretildi. Kaynak-regex testi değildir (prompt parite bölümü hariç — o da
 * canlı `setup`/`system_instruction` gövdesinden okur).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/mediaService', () => ({ getMediaState: () => ({ hasSession: false, track: null }) }));
vi.mock('../platform/gpsService', () => ({ getGPSState: () => ({ location: { speed: 0 } }) }));
vi.mock('../platform/routingService', () => ({
  getRouteState: () => ({ geometry: null, totalDistanceMeters: 0, totalDurationSeconds: 0 }),
}));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));
vi.mock('../platform/tripLogService', () => ({
  getTripSnapshot: () => ({ active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 }),
  getTripJournalGlance: () => null,
}));
vi.mock('../platform/dtcService', () => ({ onDTCState: () => () => {} }));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => null, refreshWeather: async () => null,
  onWeatherState: () => () => {}, weatherQueryNamesCity: () => false,
}));

import {
  tryCompanionBrain, _resetCompanionChatForTest, _setGeminiLiveWsFactoryForTest,
} from '../platform/companion/companionChatProvider';
import { _resetProviderHealthForTest } from '../platform/companion/companionProviderHealth';
import { _resetAiHealthForTest } from '../platform/aiHealth';
import { _resetGeminiLiveFlagForTest, GEMINI_LIVE_LOCAL_FLAG } from '../platform/ai/live/geminiLiveFlag';
import type { WebSocketLike } from '../platform/ai/live/geminiLiveSession';
import {
  LIVE_TOOL_ACTION, LIVE_TOOL_UNRESOLVED, buildLiveFunctionDeclarations,
} from '../platform/ai/live/liveToolSchema';
import { resolveLiveTurn } from '../platform/ai/live/liveTurnResolution';
import { brainDecisionLines, brainExampleLines } from '../platform/companion/companionBrainKnowledge';
import { brainIntentAllowlist } from '../platform/capability/fabric/carosCapabilityCatalog';
import { resolveScreenEntry } from '../platform/screenCatalog';
import { matchDeterministicWholeInput, parseCommandFull } from '../platform/commandParser';
import { useStore } from '../store/useStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Sahte WebSocket — senaryo betiği (maviGeminiLiveFallback ile aynı yapı)
 * ════════════════════════════════════════════════════════════════════════ */
type Msg = Record<string, unknown>;
type TurnStep = { emit: Msg } | { close: { code: number; reason: string } };
interface WsScript { connect?: 'ok' | 'closeBeforeSetup' | 'rejectSetup'; reason?: string; code?: number; turns: TurnStep[][] }

const AUDIO_B64 = btoa(String.fromCharCode(0, 0, 255, 127, 0, 128, 1, 0));
const audioMsg = (): Msg => ({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: AUDIO_B64 } }] } } });
const transcriptMsg = (text: string): Msg => ({ serverContent: { outputTranscription: { text } } });
const turnDone = (): Msg => ({ serverContent: { turnComplete: true } });
const toolMsg = (args: Record<string, unknown>, name = LIVE_TOOL_ACTION, id = 'fc1'): Msg => ({
  toolCall: { functionCalls: [{ id, name, args }] },
});

class FakeWs implements WebSocketLike {
  static instances: FakeWs[] = [];
  readyState = 0; binaryType?: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  readonly sent: Msg[] = [];
  constructor(readonly url: string, private readonly script: WsScript) { FakeWs.instances.push(this); queueMicrotask(() => this._open()); }
  private _open(): void {
    if (this.script.connect === 'closeBeforeSetup') { this.readyState = 3; this.onclose?.({ code: this.script.code ?? 1006, reason: this.script.reason ?? '' }); return; }
    this.readyState = 1; this.onopen?.({});
  }
  private _emit(msg: Msg): void { queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) }); }); }
  private _serverClose(code: number, reason: string): void { queueMicrotask(() => { if (this.readyState !== 1) return; this.readyState = 3; this.onclose?.({ code, reason }); }); }
  send(data: string): void {
    const m = JSON.parse(data) as Msg; this.sent.push(m);
    if (m.setup) { if (this.script.connect === 'rejectSetup') { this._serverClose(this.script.code ?? 1008, this.script.reason ?? ''); return; } this._emit({ setupComplete: {} }); return; }
    if (m.clientContent) { const steps = this.script.turns.shift() ?? [{ emit: turnDone() }]; for (const st of steps) { if ('emit' in st) this._emit(st.emit); else this._serverClose(st.close.code, st.close.reason); } }
  }
  close(): void { this.readyState = 3; }
}
function installWs(...scripts: WsScript[]): void {
  FakeWs.instances = []; const queue = [...scripts];
  _setGeminiLiveWsFactoryForTest((url) => new FakeWs(url, queue.shift() ?? { connect: 'closeBeforeSetup', reason: 'no_script' }));
}
/** Sahte voice portu — `spokeAudio` = ilk PCM parçası oynatmaya verildi (yaşam döngüsü kanıtı). */
function makePorts() {
  const audio: number[] = []; const calls: { name: string }[] = []; let transcript = '';
  return {
    sinks: {
      onAudioChunk: (b: ArrayBuffer) => { audio.push(b.byteLength); },
      onTranscript: (t: string) => { transcript += t; },
      onToolCall: (c: { name: string; args: Readonly<Record<string, unknown>> }) => { calls.push(c); },
    },
    complete: vi.fn(), abort: vi.fn(),
    get spokeAudio() { return audio.length > 0; }, get transcript() { return transcript; }, get sawToolCall() { return calls.length > 0; },
    audio, calls,
  };
}
const brainOk = (say: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'chat', say }) }] } }] } });
const brainAction = (obj: Record<string, unknown>) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'action', ...obj }) }] } }] } });
function installFetch(route: (url: string, body: string) => { status: number; body: unknown }) {
  const spy = vi.fn(async (url: string, init?: { body?: string }) => {
    const r = route(String(url), init?.body ?? '');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body), clone() { return this; } };
  });
  vi.stubGlobal('fetch', spy); return spy;
}
const CHAIN = [{ provider: 'gemini' as const, apiKey: 'AIzaTest' }];
type Evidence = 'action' | 'unknown';
async function brain(text: string, ports: ReturnType<typeof makePorts> | null, evidence: Evidence = 'unknown') {
  return tryCompanionBrain(text, {
    chain: CHAIN, hasNet: true, timeoutMs: 2_000,
    ...(ports ? { live: ports, liveRequestEvidence: evidence } : {}),
  });
}
/** voiceService `_liveRequestEvidence` ile AYNI kanıt kuralı (parser ≥0.5 ∨ ekran kataloğu). */
function evidenceFor(text: string): Evidence {
  const cmd = parseCommandFull(text).command;
  if (cmd && cmd.confidence >= 0.5) return 'action';
  return resolveScreenEntry(text) ? 'action' : 'unknown';
}
const liveSetup = () => FakeWs.instances[0].sent[0].setup as { systemInstruction?: { parts?: { text: string }[] }; tools?: { functionDeclarations: { name: string }[] }[] };
const liveTurns = (ws: FakeWs) => ws.sent.filter((m) => m.clientContent).map((m) => (m.clientContent as { turns: { role: string; parts: { text: string }[] }[] }).turns);

beforeEach(() => {
  localStorage.clear(); useStore.getState().resetSettings();
  // Live 2026-09-25'ten beri varsayılan KAPALI (tek ses: Emel) — bu dosya Live davranışını sınar.
  localStorage.setItem(GEMINI_LIVE_LOCAL_FLAG, 'true');
  _resetCompanionChatForTest(); _resetProviderHealthForTest(); _resetAiHealthForTest(); _resetGeminiLiveFlagForTest();
  vi.unstubAllGlobals();
});
afterEach(() => { vi.unstubAllGlobals(); _setGeminiLiveWsFactoryForTest(undefined); });

/* ══════════════════════════════════════════════════════════════════════════
 * A · LIVE / REST YETENEK PARİTESİ (canlı setup vs canlı system_instruction)
 * ════════════════════════════════════════════════════════════════════════ */
describe('A · Live systemInstruction, REST beyninin yetenek bilgisini taşır', () => {
  async function captureBoth(): Promise<{ rest: string; live: string }> {
    localStorage.setItem(GEMINI_LIVE_LOCAL_FLAG, 'false'); _resetGeminiLiveFlagForTest();
    let rest = '';
    installFetch((_u, body) => { try { rest = JSON.parse(body).system_instruction.parts[0].text; } catch { /* */ } return brainOk('ok'); });
    await brain('merhaba', null);
    localStorage.setItem(GEMINI_LIVE_LOCAL_FLAG, 'true'); _resetGeminiLiveFlagForTest(); _resetCompanionChatForTest();
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('selam') }, { emit: turnDone() }]] });
    installFetch(() => brainOk('REST OLMAMALI'));
    await brain('merhaba', makePorts());
    return { rest, live: liveSetup().systemInstruction?.parts?.[0]?.text ?? '' };
  }

  it('5-10 · PLAY_MUSIC_SEARCH · OPEN_PHONE/contactName · NAVIGATE_ADDRESS · SEARCH_POI · SET_SETTING · REMEMBER/FORGET · OPEN_SCREEN ekran listesi · QUERY_SENSOR · web sınıfı — Live ve REST\'te AYNI', async () => {
    const { rest, live } = await captureBoth();
    const markers: RegExp[] = [
      /PLAY_MUSIC_SEARCH \+ query=DÜZELTİLMİŞ/,
      /OPEN_PHONE \+ contactName=YALNIZ kişinin adı/,
      /NAVIGATE_ADDRESS \+ destination/,
      /SEARCH_POI \+ category \+ query/,
      /settingKey \("brightness"\|"wifi"\|"bluetooth"\|"volume"\)/,
      /performanceMode \(/,
      /→ REMEMBER \+ memoryText/,
      /→ FORGET \+ memoryText/,
      /İç ekranlar: .*"klima"/,
      /"trafik"/, /"ariza kodlari"/,
      /OPEN_APP KULLANMA, özel intent/,
      /SENSÖR DEĞERİ UYDURMA/,
      /Şunlar İNTERNET'tir/,
      /CHECK_VEHICLE_HEALTH/, /CHECK_MAINTENANCE/, /FIND_NEARBY_GAS/,
      /"klimayı aç" →/, /"Selim'i ara" →/, /"acıktım bir şeyler yiyelim" →/, /"arabam dizel, unutma" →/,
      /Şive\/sokak ağzı komutları da KOMUTTUR/,
      /KUSURLU cihaz-içi konuşma tanıma/,
    ];
    for (const re of markers) {
      expect(rest, `REST: ${re}`).toMatch(re);
      expect(live, `LIVE: ${re}`).toMatch(re);
    }
    // Live, REST'e özgü JSON zarfını KÖRLEMESİNE almaz; kararı tool ile verir.
    expect(live).not.toMatch(/\{"type":"action"/);
    expect(live).toMatch(/mavi_action\{"intent":"OPEN_SCREEN","screen":"klima"/);
    expect(live).toMatch(/mavi_web_search\{"query"/);
    expect(live).toMatch(/mavi_unresolved/);
    // Büyüklük: Live artık "fakir beyin" değil.
    expect(live.length).toBeGreaterThan(rest.length * 0.8);
  });

  it('intent listesi her iki yüzeyde katalogdan ve BİREBİR aynı', () => {
    const intents = [...brainIntentAllowlist()];
    const restLine = brainDecisionLines('rest_json', intents).find((l) => l.startsWith('intent yalnız şunlardan biri'));
    const liveLine = brainDecisionLines('live_tool', intents).find((l) => l.startsWith('intent yalnız şunlardan biri'));
    expect(restLine).toBeTruthy();
    expect(liveLine).toBe(restLine);
    for (const i of ['OPEN_SCREEN', 'SET_SETTING', 'OPEN_PHONE', 'PLAY_MUSIC_SEARCH', 'NAVIGATE_ADDRESS', 'SEARCH_POI', 'REMEMBER', 'FORGET', 'QUERY_SENSOR']) {
      expect(restLine).toContain(i);
    }
  });

  it('🔒 SEMANTİK SÖZLEŞME: her örnek ifade iki yüzeyde AYNI intent + alanlarla yazılır (tekrar kopma yasağı)', () => {
    const rest = brainExampleLines('rest_json', true).slice(1);
    const live = brainExampleLines('live_tool', true).slice(1);
    expect(live.length).toBe(rest.length);
    for (let i = 0; i < rest.length; i++) {
      const u = rest[i].slice(0, rest[i].indexOf('" →') + 1);
      expect(live[i].startsWith(u), `sıra ${i}: ${u}`).toBe(true);
      const m = rest[i].match(/→ (\{.*\})/);
      if (!m) continue;   // chat örneği
      const obj = JSON.parse(m[1]) as { type: string } & Record<string, unknown>;
      if (obj.type === 'action') {
        const { type: _t, ...fields } = obj; void _t;
        expect(live[i]).toContain(`mavi_action${JSON.stringify(fields)}`);
      } else if (obj.type === 'web') {
        expect(live[i]).toContain(`mavi_web_search{"query":${JSON.stringify(obj.query)}}`);
      }
    }
  });

  it('function declarations: action · web · unresolved (üç araç), intent enum katalogdan', () => {
    const decls = buildLiveFunctionDeclarations() as { name: string; parameters: { properties: { intent?: { enum: string[] } } } }[];
    expect(decls.map((d) => d.name)).toEqual([LIVE_TOOL_ACTION, 'mavi_web_search', LIVE_TOOL_UNRESOLVED]);
    expect(decls[0].parameters.properties.intent!.enum).toEqual([...brainIntentAllowlist()]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · TUR ÇÖZÜM ANLAMI — gerçek zincir üzerinden
 * ════════════════════════════════════════════════════════════════════════ */
describe('B · "model bir şey söyledi" ≠ "istek çözüldü"', () => {
  it('1 · "klimayı aç" + Live OPEN_SCREEN tool → action pipeline, REST ÇAĞRILMAZ', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: toolMsg({ intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'open', feedback: 'Klima açılıyor', confidence: 0.9 }) }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('klimayı aç', makePorts(), evidenceFor('klimayı aç'));
    expect(r?.kind).toBe('action');
    if (r?.kind === 'action') { expect(r.semantic.intent).toBe('OPEN_SCREEN'); expect(r.semantic.screen).toBe('klima'); }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('2 · "klimayı aç" + Live SES "Bunu şu an yapamıyorum." → ÇÖZÜLMÜŞ SAYILMAZ (companion_reask), REST ÇAĞRILMAZ (ses verildi)', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('Bunu şu an yapamıyorum.') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    expect(evidenceFor('klimayı aç')).toBe('action');   // kanıt: kanonik ekran kataloğu
    const r = await brain('klimayı aç', makePorts(), evidenceFor('klimayı aç'));
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') { expect(r.route).toBe('companion_reask'); expect(r.response).toBe('Bunu şu an yapamıyorum.'); }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('3 · "klimayı aç" + Live SES "Tamam klimayı açıyorum." ama TOOL YOK → action success SAYILMAZ, companion_live DEĞİL', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('Tamam, klimayı açıyorum.') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('klimayı aç', makePorts(), evidenceFor('klimayı aç'));
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).toBe('companion_reask');
    expect(r?.kind === 'action').toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('4 · Live yalnız SES (transkript/tool yok) → boş başarılı cevap DÖNMEZ; reask metni dolu, REST yok (ses verildi)', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('sonraki şarkıya geç', makePorts(), 'unknown');
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') { expect(r.route).toBe('companion_reask'); expect(r.response.trim().length).toBeGreaterThan(0); }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('11 · genel sohbet ("nasılsın") + anlamlı Live cevabı → CHAT_RESOLVED (companion_live), fallback YOK', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('İyiyim, yol nasıl gidiyor?') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    expect(evidenceFor('nasılsın bugün')).toBe('unknown');
    const r = await brain('nasılsın bugün', makePorts(), evidenceFor('nasılsın bugün'));
    expect(r).toEqual({ kind: 'chat', response: 'İyiyim, yol nasıl gidiyor?', route: 'companion_live' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('12 · çözülmedi + ses HENÜZ VERİLMEDİ (yalnız transkript) → Gemini REST kurtarır', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: transcriptMsg('Bunu yapamıyorum.') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainAction({ intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'open', feedback: 'Klima açılıyor', confidence: 0.9 }));
    const r = await brain('klimayı aç', makePorts(), 'action');
    expect(r?.kind).toBe('action');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('12b · model `mavi_unresolved` dedi (konuşmadı) → REST kurtarır, eylem TEK', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: toolMsg({ note: 'eşleyemedim' }, LIVE_TOOL_UNRESOLVED) }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainAction({ intent: 'OPEN_PHONE', contactName: 'annem', feedback: 'Annem aranıyor', confidence: 0.9 }));
    const r = await brain('annemi ara', makePorts(), evidenceFor('annemi ara'));
    expect(r?.kind).toBe('action');
    if (r?.kind === 'action') expect(r.semantic.contactName).toBe('annem');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('13 · çözülmedi + ses VERİLDİ → REST ÇAĞRILMAZ (ikinci sesli cevap yok); kurtarma reask rotası', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: toolMsg({ note: 'x' }, LIVE_TOOL_UNRESOLVED) }, { emit: transcriptMsg('Bunu yapamıyorum.') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('annemi ara', makePorts(), 'action');
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).toBe('companion_reask');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('14 · geçersiz intent tool + SES → eylem ÜRETİLMEZ, REST de eylem üretemez (duplicate/yanlış eylem yok)', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: toolMsg({ intent: 'AC_ON' }) }, { emit: audioMsg() }, { emit: transcriptMsg('Klimayı açamıyorum.') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainAction({ intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'open' }));
    const r = await brain('klimayı aç', makePorts(), 'action');
    expect(r?.kind).toBe('chat');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('15 · Live tool çağrısından SONRA kopma → eylem TEK, REST çağrılmaz', async () => {
    installWs({ connect: 'ok', turns: [[
      { emit: toolMsg({ intent: 'PLAY_MUSIC_SEARCH', query: 'Sezen Aksu', feedback: 'Sezen Aksu açılıyor', confidence: 0.9 }) },
      { close: { code: 1006, reason: '' } },
    ]] });
    const fetchSpy = installFetch(() => brainAction({ intent: 'PLAY_MUSIC_SEARCH', query: 'DUPLICATE' }));
    const ports = makePorts();
    const r = await brain('sezen aksu çal', ports, evidenceFor('sezen aksu çal'));
    expect(r?.kind).toBe('action');
    if (r?.kind === 'action') expect(r.semantic.query).toBe('Sezen Aksu');
    expect(ports.calls.length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Live tool round-trip: PLAY_MUSIC_SEARCH · OPEN_PHONE · NAVIGATE_ADDRESS · SEARCH_POI · SET_SETTING · REMEMBER · FORGET AYNI parseBrainJson sözleşmesinden geçer', async () => {
    const cases: Array<[string, Record<string, unknown>, (s: Record<string, unknown>) => void]> = [
      ['ibrahim tatlıses çal', { intent: 'PLAY_MUSIC_SEARCH', query: 'İbrahim Tatlıses' }, (s) => expect(s.query).toBe('İbrahim Tatlıses')],
      ['annemi ara', { intent: 'OPEN_PHONE', contactName: 'annem' }, (s) => expect(s.contactName).toBe('annem')],
      ['kadıköy moda caddesine git', { intent: 'NAVIGATE_ADDRESS', destination: 'Kadıköy Moda Caddesi' }, (s) => expect(s.destination).toBe('Kadıköy Moda Caddesi')],
      ['acıktım bir şeyler yiyelim', { intent: 'SEARCH_POI', category: 'RESTAURANT', query: 'restoran' }, (s) => expect(s.category).toBe('RESTAURANT')],
      ['parlaklığı kıs', { intent: 'SET_SETTING', settingKey: 'brightness', settingKind: 'number', settingAction: 'dec' }, (s) => { expect(s.settingKey).toBe('brightness'); expect(s.settingAction).toBe('dec'); }],
      ['arabam dizel unutma', { intent: 'REMEMBER', memoryText: 'Arabası dizel' }, (s) => expect(s.memoryText).toBe('Arabası dizel')],
      ['benzin tercihimi unut', { intent: 'FORGET', memoryText: 'benzin' }, (s) => expect(s.memoryText).toBe('benzin')],
    ];
    for (const [text, args, check] of cases) {
      _resetCompanionChatForTest();
      installWs({ connect: 'ok', turns: [[{ emit: toolMsg({ ...args, feedback: 'Yapılıyor', confidence: 0.9 }) }, { emit: turnDone() }]] });
      const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
      const r = await brain(text, makePorts(), evidenceFor(text));
      expect(r?.kind, text).toBe('action');
      if (r?.kind === 'action') { expect(r.semantic.intent).toBe(args.intent); check(r.semantic as unknown as Record<string, unknown>); }
      expect(fetchSpy, text).not.toHaveBeenCalled();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · Saf karar tablosu
 * ════════════════════════════════════════════════════════════════════════ */
describe('C · resolveLiveTurn (saf)', () => {
  const base = { firstValidTool: null, sawToolCall: false, declaredUnresolved: false, transcript: '', audioCommitted: false, requestEvidence: 'unknown' as const };
  it('geçerli tool → ACTION_RESOLVED (ses/transkriptten bağımsız)', () => {
    const tool = { kind: 'web' as const, query: 'q' };
    expect(resolveLiveTurn({ ...base, firstValidTool: tool, transcript: 'x', audioCommitted: true }).kind).toBe('ACTION_RESOLVED');
  });
  it('mavi_unresolved → UNRESOLVED (model_declared)', () => {
    expect(resolveLiveTurn({ ...base, sawToolCall: true, declaredUnresolved: true })).toMatchObject({ kind: 'UNRESOLVED', why: 'model_declared' });
  });
  it('hiç çıktı yok → NO_OUTPUT; yalnız geçersiz tool → INVALID_TOOL', () => {
    expect(resolveLiveTurn(base).kind).toBe('NO_OUTPUT');
    expect(resolveLiveTurn({ ...base, sawToolCall: true }).kind).toBe('INVALID_TOOL');
  });
  it('ses var transkript yok → NO_OUTPUT (audioCommitted=true taşınır)', () => {
    expect(resolveLiveTurn({ ...base, audioCommitted: true })).toEqual({ kind: 'NO_OUTPUT', audioCommitted: true });
  });
  it('transkript + eylem kanıtı → UNRESOLVED; transkript + kanıt yok → CHAT_RESOLVED', () => {
    expect(resolveLiveTurn({ ...base, transcript: 'yapamıyorum', requestEvidence: 'action' })).toMatchObject({ kind: 'UNRESOLVED', why: 'action_request_without_tool' });
    expect(resolveLiveTurn({ ...base, transcript: 'iyiyim' })).toEqual({ kind: 'CHAT_RESOLVED', transcript: 'iyiyim', audioCommitted: false });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D · BAĞLAM TAZELİĞİ / FOLLOW-UP
 * ════════════════════════════════════════════════════════════════════════ */
describe('D · Live bağlamı sağlayıcı sınırında kaybolmaz', () => {
  it('"X sanatçısını çal" REST\'te çözüldü → "sonrakine geç" Live turu önceki turları (user+model) sunucu bağlamına taşır', async () => {
    // Tur 1: Live çıktı üretmez (konuşmaz) → REST cevaplar.
    installWs({ connect: 'ok', turns: [
      [{ emit: turnDone() }],
      [{ emit: toolMsg({ intent: 'MEDIA_NEXT', feedback: 'Sonraki', confidence: 0.9 }) }, { emit: turnDone() }],
    ] });
    installFetch(() => brainAction({ intent: 'PLAY_MUSIC_SEARCH', query: 'Sezen Aksu', feedback: 'Sezen Aksu açılıyor', confidence: 0.9 }));
    const r1 = await brain('sezen aksu çal', makePorts(), 'action');
    expect(r1?.kind).toBe('action');
    // Tur 2: Live — clientContent, REST'in cevapladığı turu da taşımalı.
    const r2 = await brain('sonrakine geç', makePorts(), 'action');
    expect(r2?.kind).toBe('action');
    const ws = FakeWs.instances[0];
    expect(ws.sent.filter((m) => m.setup).length).toBe(1);          // sistem talimatı yeniden GÖNDERİLMEZ
    const turns = liveTurns(ws);
    expect(turns[1].map((t) => t.role)).toEqual(['user', 'model', 'user']);
    expect(turns[1][0].parts[0].text).toContain('sezen aksu çal');
    expect(turns[1][1].parts[0].text).toContain('Sezen Aksu açılıyor');
    expect(turns[1][2].parts[0].text).toContain('sonrakine geç');
  });

  it('"Klimayı aç" Live\'da çözüldü → "kapat" turu geçmişi TEKRAR göndermez (sunucu zaten gördü)', async () => {
    installWs({ connect: 'ok', turns: [
      [{ emit: toolMsg({ intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'open', feedback: 'Klima açılıyor', confidence: 0.9 }) }, { emit: turnDone() }],
      [{ emit: toolMsg({ intent: 'OPEN_SCREEN', screen: 'klima', screenAction: 'close', feedback: 'Klima kapanıyor', confidence: 0.9 }) }, { emit: turnDone() }],
    ] });
    installFetch(() => brainOk('REST OLMAMALI'));
    await brain('klimayı aç', makePorts(), 'action');
    const r2 = await brain('kapat', makePorts(), 'action');
    expect(r2?.kind).toBe('action');
    const turns = liveTurns(FakeWs.instances[0]);
    expect(turns[0].map((t) => t.role)).toEqual(['user']);
    expect(turns[1].map((t) => t.role)).toEqual(['user']);
    expect(turns[1][0].parts[0].text).toContain('kapat');
  });

  it('yeni sunucu bağlamı (resumption\'sız yeniden bağlanma) → geçmiş yeniden teslim edilir', async () => {
    installWs(
      { connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('Motor 90 derece, normal.') }, { emit: turnDone() }]] },
      { connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('Evet, normal aralıkta.') }, { emit: turnDone() }]] },
    );
    installFetch(() => brainOk('REST OLMAMALI'));
    await brain('motor sıcaklığı kaç', makePorts(), 'unknown');
    FakeWs.instances[0].onclose?.({ code: 1006, reason: '' });   // soket düştü, handle yok → taze bağlam
    const r2 = await brain('normal mi', makePorts(), 'unknown');
    expect(r2).toMatchObject({ kind: 'chat', route: 'companion_live' });
    expect(FakeWs.instances.length).toBe(2);
    const turns = liveTurns(FakeWs.instances[1]);
    expect(turns[0].map((t) => t.role)).toEqual(['user', 'model', 'user']);
    expect(turns[0][1].parts[0].text).toContain('Motor 90 derece');
  });

  it('konu ipucu/hafıza sistem talimatına DONDURULMAZ; [BAĞLAM] satırı tur metninde verilir', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('selam') }, { emit: turnDone() }]] });
    installFetch(() => brainOk('REST OLMAMALI'));
    await brain('merhaba', makePorts());
    const sys = liveSetup().systemInstruction?.parts?.[0]?.text ?? '';
    expect(sys).toMatch(/\[BAĞLAM\] satırında verilir/);
    expect(sys).toMatch(/\[ARAÇ\] satırında/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E · MEVCUT ÇALIŞANLAR KORUNDU — deterministik yol genişletilmedi
 * ════════════════════════════════════════════════════════════════════════ */
describe('E · deterministik/yerel yol regress olmadı ve genişletilmedi', () => {
  it('sesi aç · sonraki şarkı · eve git · işe git · haritayı aç → hızlı yol; "klimayı aç"/"annemi ara"/"X çal" → hâlâ beyne gider', () => {
    expect(matchDeterministicWholeInput('sesi aç')?.type).toBe('volume_up');
    expect(matchDeterministicWholeInput('sonraki şarkı')?.type).toBe('music_next');
    expect(matchDeterministicWholeInput('eve git')?.type).toBe('navigate_home');
    expect(matchDeterministicWholeInput('işe git')?.type).toBe('navigate_work');
    expect(matchDeterministicWholeInput('haritayı aç')?.type).toBe('open_maps');
    expect(matchDeterministicWholeInput('klimayı aç')).toBeNull();
    expect(matchDeterministicWholeInput('annemi ara')).toBeNull();
    expect(matchDeterministicWholeInput('sezen aksu çal')).toBeNull();
  });
  it('istek kanıtı yürütmez: resolveScreenEntry saf, yalnız katalog eşleşmesi', () => {
    expect(resolveScreenEntry('klimayı aç')?.id).toBe('climate');
    expect(resolveScreenEntry('nasılsın bugün')).toBeNull();
  });
});
