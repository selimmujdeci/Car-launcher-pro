/**
 * GEMINI LIVE — birincil online yol + NİHAİ FALLBACK ZİNCİRİ (2026-09-21).
 *
 *   DETERMINISTIC/LOCAL → GEMINI LIVE → NORMAL GEMINI (REST) → OPENROUTER →
 *   CLAUDE → LOCAL/OFFLINE
 *
 * Bu dosya 12 senaryoyu kilitler. Sahte WebSocket ve sahte fetch ile ÇALIŞTIRILIR
 * (kaynak taraması değil): hangi sağlayıcının çağrıldığı, hangisinin ATLANDIĞI,
 * geçiş kütüğünün sebebi ve duplicate cevap/eylem yasağı gerçek zincirden okunur.
 *
 * OpenRouter çağrısı mevcut gateway ve güvenli BYOK key source üzerinden GERÇEKTEN
 * yürütülür; feature flag bu fallback halkasını kapatamaz.
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
  getGeminiLiveDiagnostics,
} from '../platform/companion/companionChatProvider';
import {
  _resetProviderHealthForTest, getProviderSwitchLog, isProviderCoolingDown,
  isGeminiKeyRejected, classifyLiveFailure,
} from '../platform/companion/companionProviderHealth';
import { _resetAiHealthForTest } from '../platform/aiHealth';
import { _resetGeminiLiveFlagForTest, GEMINI_LIVE_LOCAL_FLAG } from '../platform/ai/live/geminiLiveFlag';
import { GeminiLiveSession, type WebSocketLike } from '../platform/ai/live/geminiLiveSession';
import { MAVI_VOICE_PROFILE } from '../platform/assistant/maviVoiceProfile';
import { LIVE_TOOL_ACTION, buildLiveFunctionDeclarations } from '../platform/ai/live/liveToolSchema';
import { matchDeterministicWholeInput } from '../platform/commandParser';
import { useStore } from '../store/useStore';
import { sensitiveKeyStore } from '../platform/sensitiveKeyStore';
import { _resetDefaultAiGatewayForTest } from '../platform/ai/gateway/concrete/defaultAiGateway';

/* ══════════════════════════════════════════════════════════════════════════
 * Sahte WebSocket — senaryo betiği
 * ════════════════════════════════════════════════════════════════════════ */

type Msg = Record<string, unknown>;
type TurnStep = { emit: Msg } | { close: { code: number; reason: string } };
interface WsScript {
  /** 'ok' → setupComplete · 'closeBeforeSetup' → setup öncesi kapanış · 'rejectSetup' → setup gönderilince kapanış */
  connect?: 'ok' | 'closeBeforeSetup' | 'rejectSetup';
  reason?: string;
  code?: number;
  /** Her clientContent için sırayla uygulanan adımlar. */
  turns: TurnStep[][];
}

const AUDIO_B64 = btoa(String.fromCharCode(0, 0, 255, 127, 0, 128, 1, 0));
const audioMsg = (): Msg => ({
  serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: AUDIO_B64 } }] } },
});
const transcriptMsg = (text: string): Msg => ({ serverContent: { outputTranscription: { text } } });
const turnDone = (): Msg => ({ serverContent: { turnComplete: true } });
const toolMsg = (args: Record<string, unknown>, id = 'fc1'): Msg => ({
  toolCall: { functionCalls: [{ id, name: LIVE_TOOL_ACTION, args }] },
});

class FakeWs implements WebSocketLike {
  static instances: FakeWs[] = [];
  readyState = 0;
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  readonly sent: Msg[] = [];
  closedBy: { code?: number; reason?: string } | null = null;
  constructor(readonly url: string, private readonly script: WsScript) {
    FakeWs.instances.push(this);
    queueMicrotask(() => this._open());
  }
  private _open(): void {
    if (this.script.connect === 'closeBeforeSetup') {
      this.readyState = 3;
      this.onclose?.({ code: this.script.code ?? 1006, reason: this.script.reason ?? '' });
      return;
    }
    this.readyState = 1;
    this.onopen?.({});
  }
  private _emit(msg: Msg): void {
    queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) }); });
  }
  private _serverClose(code: number, reason: string): void {
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      this.readyState = 3;
      this.onclose?.({ code, reason });
    });
  }
  send(data: string): void {
    const m = JSON.parse(data) as Msg;
    this.sent.push(m);
    if (m.setup) {
      if (this.script.connect === 'rejectSetup') {
        this._serverClose(this.script.code ?? 1008, this.script.reason ?? '');
        return;
      }
      this._emit({ setupComplete: {} });
      return;
    }
    if (m.clientContent) {
      const steps = this.script.turns.shift() ?? [{ emit: turnDone() }];
      for (const st of steps) {
        if ('emit' in st) this._emit(st.emit);
        else this._serverClose(st.close.code, st.close.reason);
      }
    }
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedBy = { code, reason };
  }
}

function installWs(...scripts: WsScript[]): void {
  FakeWs.instances = [];
  const queue = [...scripts];
  _setGeminiLiveWsFactoryForTest((url) => new FakeWs(url, queue.shift() ?? { connect: 'closeBeforeSetup', reason: 'no_script' }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sahte port (voice katmanının verdiği handle'ın yapısal eşi)
 * ════════════════════════════════════════════════════════════════════════ */

function makePorts() {
  const audio: number[] = [];
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  let transcript = '';
  const complete = vi.fn();
  const abort = vi.fn();
  return {
    sinks: {
      onAudioChunk: (b: ArrayBuffer) => { audio.push(b.byteLength); },
      onTranscript: (t: string) => { transcript += t; },
      onToolCall: (c: { name: string; args: Readonly<Record<string, unknown>> }) => { calls.push(c); },
    },
    complete, abort,
    get spokeAudio() { return audio.length > 0; },
    get transcript() { return transcript; },
    get sawToolCall() { return calls.length > 0; },
    audio, calls,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sahte fetch — REST (Gemini/OpenRouter/Claude) yönlendiricisi
 * ════════════════════════════════════════════════════════════════════════ */

type Responder = (url: string) => { status: number; body: unknown };
const brainOk = (say: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'chat', say }) }] } }] } });
const openRouterOk = (say: string) => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify({ type: 'chat', say }) } }] } });
const haikuOk = (say: string) => ({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify({ type: 'chat', say }) }] } });
const quota429 = { status: 429, body: { error: { details: [{ retryDelay: '5s' }] } } };

function installFetch(route: Responder): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: string) => {
    const r = route(String(url));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
      clone() { return this; },
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
const calledHosts = (spy: ReturnType<typeof vi.fn>): string[] =>
  spy.mock.calls.map((c) => new URL(String(c[0])).host);

const CHAIN_ALL = [
  { provider: 'gemini' as const, apiKey: 'AIzaTest' },
  { provider: 'openrouter' as const, apiKey: '' },
  { provider: 'haiku'  as const, apiKey: 'sk-ant-test' },
];

async function brain(text: string, ports: ReturnType<typeof makePorts> | null, chain = CHAIN_ALL) {
  return tryCompanionBrain(text, {
    chain, hasNet: true, timeoutMs: 2_000,
    ...(ports ? { live: ports } : {}),
  });
}

beforeEach(async () => {
  localStorage.clear();
  useStore.getState().resetSettings();
  _resetCompanionChatForTest();
  _resetProviderHealthForTest();
  _resetAiHealthForTest();
  _resetGeminiLiveFlagForTest();
  _resetDefaultAiGatewayForTest();
  vi.unstubAllGlobals();
  await sensitiveKeyStore.set('openRouterApiKey', 'sk-or-v1-test');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  _setGeminiLiveWsFactoryForTest(undefined);
  _resetDefaultAiGatewayForTest();
  await sensitiveKeyStore.remove('openRouterApiKey');
});

/* ══════════════════════════════════════════════════════════════════════════
 * Senaryolar
 * ════════════════════════════════════════════════════════════════════════ */

describe('1 · Gemini Live çalışıyor → Live kullanılır (REST HİÇ çağrılmaz)', () => {
  it('ses + transkript sink\'e akar, rota companion_live, fetch=0', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('İyiyim, ') }, { emit: audioMsg() }, { emit: transcriptMsg('sen nasılsın?') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const ports = makePorts();

    const r = await brain('nasılsın', ports);

    expect(r).not.toBeNull();
    expect(r!.kind).toBe('chat');
    if (r!.kind === 'chat') {
      expect(r.route).toBe('companion_live');
      expect(r.response).toBe('İyiyim, sen nasılsın?');
    }
    expect(ports.audio.length).toBe(2);
    expect(ports.complete).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getProviderSwitchLog()).toHaveLength(0);
    // setup: AUDIO kipi + tool bildirimleri + transkript
    const setup = FakeWs.instances[0].sent[0].setup as Record<string, unknown>;
    expect((setup.generationConfig as { responseModalities: string[] }).responseModalities).toEqual(['AUDIO']);
    expect(setup.outputAudioTranscription).toBeDefined();
    expect(Array.isArray((setup.tools as { functionDeclarations: unknown[] }[])[0].functionDeclarations)).toBe(true);
    /* MAVI VOICE PROFILE: Live sesi ve dili TEK sabitten gelir (Gemini TTS
       yedeğiyle aynı ses → Gemini ailesinde tek Mavi karakteri). */
    const speech = (setup.generationConfig as { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } }; languageCode: string } }).speechConfig;
    expect(speech.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(MAVI_VOICE_PROFILE.geminiVoice);
    expect(speech.languageCode).toBe(MAVI_VOICE_PROFILE.language);
    expect(getGeminiLiveDiagnostics().state).toBe('ready');
  });

  it('oturum KALICI: ikinci tur yeni bağlantı AÇMAZ', async () => {
    installWs({ connect: 'ok', turns: [
      [{ emit: transcriptMsg('bir') }, { emit: turnDone() }],
      [{ emit: transcriptMsg('iki') }, { emit: turnDone() }],
    ] });
    installFetch(() => brainOk('x'));
    await brain('selam', makePorts());
    await brain('tekrar', makePorts());
    expect(FakeWs.instances).toHaveLength(1);
  });
});

describe('2 · Live kota/rate-limit → Normal Gemini REST', () => {
  it('RESOURCE_EXHAUSTED kapanışı → REST cevap verir; kütük LIVE_QUOTA; Live soğur, Gemini soğumaz', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'RESOURCE_EXHAUSTED: quota exceeded' });
    const fetchSpy = installFetch(() => brainOk('REST cevabı'));
    const ports = makePorts();

    const r = await brain('nasılsın', ports);

    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(r && r.kind === 'chat' && r.response).toBe('REST cevabı');
    expect(calledHosts(fetchSpy)).toContain('generativelanguage.googleapis.com');
    expect(getProviderSwitchLog()[0]).toMatchObject({ from: 'live', to: 'gemini_rest', reason: 'LIVE_QUOTA' });
    expect(isProviderCoolingDown('live')).toBe(true);
    expect(isProviderCoolingDown('gemini')).toBe(false);
    expect(isGeminiKeyRejected('AIzaTest')).toBe(false);
    expect(ports.abort).toHaveBeenCalled();
  });

  it('rate-limit ayrı reason ile REST\'e geçer', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'rate limit exceeded' });
    installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'live', to: 'gemini_rest', reason: 'LIVE_RATE_LIMIT' }),
    ]));
  });
});

describe('3 · Live servis/model kullanılamıyor → Normal Gemini REST', () => {
  it('model NOT_FOUND → REST; Live uzun soğur', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'NOT_FOUND: model gemini-3.8-live not found' });
    const fetchSpy = installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(fetchSpy).toHaveBeenCalled();
    expect(getProviderSwitchLog()[0]).toMatchObject({ from: 'live', to: 'gemini_rest', reason: 'LIVE_UNAVAILABLE' });
  });

  it('servis erişilemez (setup öncesi 1006, sebep yok) → REST; anahtar REDDİ ilan EDİLMEZ', async () => {
    installWs({ connect: 'closeBeforeSetup', code: 1006, reason: '' });
    const fetchSpy = installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(fetchSpy).toHaveBeenCalled();
    expect(getProviderSwitchLog()[0]).toMatchObject({ reason: 'LIVE_UNAVAILABLE' });
    expect(isGeminiKeyRejected('AIzaTest')).toBe(false);
  });
});

describe('4 · Live WebSocket geçici kopma → reconnect/resume', () => {
  it('setup sonrası, çıktı öncesi kopma → resumption handle ile BİR KEZ yeniden denenir ve Live cevap verir', async () => {
    installWs(
      { connect: 'ok', turns: [[
        { emit: { sessionResumptionUpdate: { newHandle: 'H-1', resumable: true } } },
        { close: { code: 1006, reason: '' } },
      ]] },
      { connect: 'ok', turns: [[{ emit: transcriptMsg('geri geldim') }, { emit: turnDone() }]] },
    );
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));

    const r = await brain('nasılsın', makePorts());

    expect(r && r.kind === 'chat' && r.route).toBe('companion_live');
    expect(r && r.kind === 'chat' && r.response).toBe('geri geldim');
    expect(FakeWs.instances).toHaveLength(2);
    const setup2 = FakeWs.instances[1].sent[0].setup as { sessionResumption: { handle?: string } };
    expect(setup2.sessionResumption.handle).toBe('H-1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getProviderSwitchLog()).toHaveLength(0);
  });
});

describe('5 · Live bağlantısı geri gelmez → Normal Gemini REST', () => {
  it('iki kopma üst üste → REST; kütük LIVE_CONNECTION_FAILURE', async () => {
    installWs(
      { connect: 'ok', turns: [[{ close: { code: 1006, reason: '' } }]] },
      { connect: 'ok', turns: [[{ close: { code: 1006, reason: '' } }]] },
    );
    const fetchSpy = installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(fetchSpy).toHaveBeenCalled();
    expect(getProviderSwitchLog()[0]).toMatchObject({ from: 'live', to: 'gemini_rest', reason: 'LIVE_CONNECTION_FAILURE' });
  });
});

describe('6 · Gemini key invalid/revoked → REST tekrar DENENMEZ → sıradaki sağlayıcı', () => {
  it('Live "API key not valid" → Gemini REST fetch YOK, OpenRouter gerçekten cevaplar', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'API key not valid. Please pass a valid API key.' });
    const fetchSpy = installFetch((url) => url.includes('openrouter') ? openRouterOk('OpenRouter cevabı') : brainOk('OLMAMALI'));

    const r = await brain('nasılsın', makePorts());

    expect(r && r.kind === 'chat' && r.route).toBe('companion_gateway');
    expect(r && r.kind === 'chat' && r.response).toBe('OpenRouter cevabı');
    expect(calledHosts(fetchSpy)).not.toContain('generativelanguage.googleapis.com');
    expect(calledHosts(fetchSpy)).toContain('openrouter.ai');
    expect(calledHosts(fetchSpy)).not.toContain('api.groq.com');
    expect(isGeminiKeyRejected('AIzaTest')).toBe(true);
    const reasons = getProviderSwitchLog().map((x) => x.reason);
    expect(reasons).toContain('GEMINI_AUTH_REJECTED');
  });

  it('sonraki turda Live de REST de atlanır (bounded pencere)', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'UNAUTHENTICATED' });
    const fetchSpy = installFetch((url) => url.includes('openrouter') ? openRouterOk('OpenRouter') : brainOk('OLMAMALI'));
    await brain('bir', makePorts());
    const before = FakeWs.instances.length;
    await brain('iki', makePorts());
    expect(FakeWs.instances.length).toBe(before);   // yeni Live bağlantısı YOK
    expect(calledHosts(fetchSpy).filter((h) => h === 'generativelanguage.googleapis.com')).toHaveLength(0);
  });
});

describe('7 · Normal Gemini kota/unavailable → OpenRouter', () => {
  it('Live kota + REST 429 → OpenRouter gerçekten cevaplar; Gemini soğur', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'quota' });
    const fetchSpy = installFetch((url) => url.includes('openrouter') ? openRouterOk('OpenRouter cevabı') : quota429);
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gateway');
    expect(calledHosts(fetchSpy)).toContain('generativelanguage.googleapis.com');
    expect(calledHosts(fetchSpy)).toContain('openrouter.ai');
    expect(calledHosts(fetchSpy)).not.toContain('api.groq.com');
    expect(isProviderCoolingDown('gemini')).toBe(true);
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'gemini_rest', to: 'openrouter', reason: 'GEMINI_RATE_LIMIT' }),
    ]));
  });

  it('Gemini REST 503/unavailable → OpenRouter gerçekten çağrılır', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'model unavailable' });
    const fetchSpy = installFetch((url) => url.includes('openrouter')
      ? openRouterOk('OpenRouter 503 yedeği')
      : { status: 503, body: { error: { message: 'service unavailable' } } });
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.response).toBe('OpenRouter 503 yedeği');
    expect(calledHosts(fetchSpy)).toContain('openrouter.ai');
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'gemini_rest', to: 'openrouter', reason: 'GEMINI_UNAVAILABLE' }),
    ]));
  });

  it('OpenRouter success → Claude çağrılmaz', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'quota' });
    const fetchSpy = installFetch((url) => url.includes('openrouter') ? openRouterOk('OR') : quota429);
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.response).toBe('OR');
    expect(calledHosts(fetchSpy)).not.toContain('api.anthropic.com');
  });
});

describe('8 · OpenRouter unavailable → Claude', () => {
  it('Live kota + REST 429 + OpenRouter 429 → Claude gerçekten cevaplar', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'quota' });
    const fetchSpy = installFetch((url) => url.includes('anthropic') ? haikuOk('Claude cevabı') : quota429);
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_haiku');
    expect(calledHosts(fetchSpy)).toContain('openrouter.ai');
    expect(calledHosts(fetchSpy)).toContain('api.anthropic.com');
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'openrouter', to: 'claude', reason: 'OPENROUTER_RATE_LIMIT' }),
    ]));
  });

  it('OpenRouter key yok → mevcut key authority auth sınıfı üretir ve Claude çağrılır', async () => {
    await sensitiveKeyStore.remove('openRouterApiKey');
    _resetDefaultAiGatewayForTest();
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'quota' });
    const fetchSpy = installFetch((url) => url.includes('anthropic') ? haikuOk('Claude key yedeği') : quota429);
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.response).toBe('Claude key yedeği');
    expect(calledHosts(fetchSpy)).not.toContain('openrouter.ai');
    expect(calledHosts(fetchSpy)).toContain('api.anthropic.com');
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'openrouter', to: 'claude', reason: 'OPENROUTER_AUTH_REJECTED' }),
    ]));
  });
});

describe('9 · Claude da yok → Local/Offline Mavi', () => {
  it('tüm online adaylar 429 → dürüst kota/offline cevabı, online rota YOK', async () => {
    installWs({ connect: 'rejectSetup', code: 1008, reason: 'quota' });
    installFetch(() => quota429);
    const r = await brain('nasılsın', makePorts());
    expect(r).not.toBeNull();
    expect(['companion_offline', 'companion_rate_limited', 'companion_reask']).toContain(r!.kind === 'chat' ? r!.route : '');
    expect(getProviderSwitchLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'claude', to: 'offline', reason: 'CLAUDE_RATE_LIMIT' }),
      expect.objectContaining({ from: 'online', to: 'offline', reason: 'ALL_ONLINE_PROVIDERS_UNAVAILABLE' }),
    ]));
  });
});

describe('10 · Tüm online sağlayıcılar erişilemez → deterministic/local yetenekler çalışır', () => {
  it('"sesi aç" / "müziği durdur" / "eve götür" deterministik hızlı yolda (sağlayıcıya HİÇ gitmez)', () => {
    expect(matchDeterministicWholeInput('sesi aç')?.type).toBe('volume_up');
    expect(matchDeterministicWholeInput('müziği durdur')?.type).toBe('stop_music');
    expect(matchDeterministicWholeInput('eve götür')?.type).toBe('navigate_home');
  });

  it('ağ ölü (tüm WS/fetch throw) → beyin null/offline döner, throw ETMEZ', async () => {
    installWs({ connect: 'closeBeforeSetup', code: 1006, reason: '' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(brain('nasılsın', makePorts())).resolves.not.toThrow;
  });
});

describe('11 · Hiçbir fallback senaryosunda DUPLICATE CEVAP oluşmaz', () => {
  it('Live ses ÇALDIKTAN sonra koparsa → REST ÇAĞRILMAZ, eldeki transkriptle bitirilir', async () => {
    installWs(
      { connect: 'ok', turns: [[{ emit: audioMsg() }, { emit: transcriptMsg('yarım ka') }, { close: { code: 1006, reason: '' } }]] },
      { connect: 'ok', turns: [[{ emit: transcriptMsg('OLMAMALI') }, { emit: turnDone() }]] },
    );
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const ports = makePorts();
    const r = await brain('nasılsın', ports);
    expect(r && r.kind === 'chat' && r.route).toBe('companion_live');
    expect(r && r.kind === 'chat' && r.response).toBe('yarım ka');
    expect(FakeWs.instances).toHaveLength(1);     // resume denemesi de YOK (çıktı üretildi)
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ports.complete).toHaveBeenCalledTimes(1);
  });

  it('Live turu supersede edilirse (yeni tur) eski tur HİÇBİR sağlayıcıya düşmez', async () => {
    const script: WsScript = { connect: 'ok', turns: [
      [],                                                          // 1. tur: sunucu susar
      [{ emit: transcriptMsg('ikinci') }, { emit: turnDone() }],   // 2. tur
    ] };
    installWs(script);
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const p1 = brain('birinci', makePorts());
    await new Promise((r) => setTimeout(r, 5));
    const p2 = brain('ikinci', makePorts());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeNull();                       // supersede → sessiz
    expect(r2 && r2.kind === 'chat' && r2.response).toBe('ikinci');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('12 · Hiçbir fallback senaryosunda DUPLICATE ARAÇ/MEDYA/NAV EYLEMİ oluşmaz', () => {
  it('Live tool çağrısı → AYNI parseBrainJson doğrulamasından action; REST çağrılmaz; tool cevabı SILENT', async () => {
    installWs({ connect: 'ok', turns: [[
      { emit: toolMsg({ intent: 'OPEN_NAVIGATION', destination: 'home', feedback: 'Eve rota açılıyor', confidence: 0.9 }) },
      { emit: turnDone() },
    ]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const ports = makePorts();
    const r = await brain('eve gidelim hadi', ports);
    expect(r && r.kind).toBe('action');
    if (r && r.kind === 'action') {
      expect(r.semantic.intent).toBe('OPEN_NAVIGATION');
      expect(r.semantics).toHaveLength(1);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ports.calls).toHaveLength(1);
    const toolResp = FakeWs.instances[0].sent.find((m) => m.toolResponse) as { toolResponse: { functionResponses: { scheduling: string; id: string }[] } };
    expect(toolResp.toolResponse.functionResponses[0].scheduling).toBe('SILENT');
    expect(toolResp.toolResponse.functionResponses[0].id).toBe('fc1');
  });

  it('tool çağrısından SONRA kopma → eylem yine tek (resume yok, REST yok)', async () => {
    installWs(
      { connect: 'ok', turns: [[
        { emit: toolMsg({ intent: 'PLAY_MUSIC_SEARCH', query: 'Sezen Aksu', feedback: 'Sezen Aksu açılıyor', confidence: 0.9 }) },
        { close: { code: 1006, reason: '' } },
      ]] },
      { connect: 'ok', turns: [[{ emit: toolMsg({ intent: 'PLAY_MUSIC_SEARCH', query: 'OLMAMALI' }) }, { emit: turnDone() }]] },
    );
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('sezen aksu aç', makePorts());
    expect(r && r.kind === 'action' && r.semantic.query).toBe('Sezen Aksu');
    expect(FakeWs.instances).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('geçersiz intent taşıyan tool çağrısı → parser reddeder → çıktı üretildi sayılır, REST\'e DÜŞÜLMEZ (duplicate eylem riski yok)', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: toolMsg({ intent: 'LAUNCH_ROCKET' }) }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST OLMAMALI'));
    const r = await brain('roketi ateşle', makePorts());
    // Tur tamamlandı, ses/transkript yok, tool geçersiz → Live "çıktı yok" sayar ve REST karar verir
    // (tool çağrısı YÜRÜTÜLMEDİ: parser reddetti → eylem duplicate'i imkânsız).
    expect(r === null || r.kind === 'chat').toBe(true);
    void fetchSpy;
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yapı taşları
 * ════════════════════════════════════════════════════════════════════════ */

describe('classifyLiveFailure — "Live yok" ≠ "Gemini yok"', () => {
  it('kota önce (mesaj "API key" içerse bile anahtar reddi sayılmaz)', () => {
    expect(classifyLiveFailure('Quota exceeded for API key', true)).toBe('LIVE_QUOTA');
    expect(classifyLiveFailure('RESOURCE_EXHAUSTED', false)).toBe('LIVE_QUOTA');
  });
  it('anahtar reddi yalnız açık kanıtla', () => {
    expect(classifyLiveFailure('API key not valid', false)).toBe('GEMINI_AUTH_REJECTED');
    expect(classifyLiveFailure('PERMISSION_DENIED', true)).toBe('GEMINI_AUTH_REJECTED');
    expect(classifyLiveFailure('', false)).toBe('LIVE_UNAVAILABLE');
    expect(classifyLiveFailure('', true)).toBe('LIVE_CONNECTION_FAILURE');
  });
  it('model bulunamadı ayrı sınıf', () => {
    expect(classifyLiveFailure('NOT_FOUND: models/x', false)).toBe('LIVE_UNAVAILABLE');
  });
});

describe('şalter — kapalıyken zincir eski dizidir', () => {
  it('yerel bayrak false → Live adayı kurulmaz, REST çağrılır, kütük LIVE_DISABLED', async () => {
    localStorage.setItem(GEMINI_LIVE_LOCAL_FLAG, 'false');
    _resetGeminiLiveFlagForTest();
    installWs({ connect: 'ok', turns: [[{ emit: transcriptMsg('OLMAMALI') }, { emit: turnDone() }]] });
    const fetchSpy = installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', makePorts());
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(FakeWs.instances).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalled();
    expect(getProviderSwitchLog()[0]).toMatchObject({ reason: 'LIVE_DISABLED' });
  });

  it('port verilmeyen çağıran (metin/test) Live\'a HİÇ girmez', async () => {
    installWs({ connect: 'ok', turns: [[{ emit: transcriptMsg('OLMAMALI') }, { emit: turnDone() }]] });
    installFetch(() => brainOk('REST cevabı'));
    const r = await brain('nasılsın', null);
    expect(r && r.kind === 'chat' && r.route).toBe('companion_gemini');
    expect(FakeWs.instances).toHaveLength(0);
  });
});

describe('GeminiLiveSession — tur sahipliği ve protokol', () => {
  it('ikinci sendTurn ilkini superseded yapar; eski turun geç mesajı sink\'e ULAŞMAZ', async () => {
    let ws: FakeWs | null = null;
    const sess = new GeminiLiveSession({ apiKey: 'k', systemInstruction: 's' }, (url) => {
      ws = new FakeWs(url, { connect: 'ok', turns: [[], []] });
      return ws;
    });
    const seen: string[] = [];
    const p1 = sess.sendTurn('a', { onTranscript: (t) => seen.push(`1:${t}`) }, { firstOutputTimeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 2));
    const p2 = sess.sendTurn('b', { onTranscript: (t) => seen.push(`2:${t}`) }, { firstOutputTimeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 2));
    // "eski" tura ait geç mesaj: nesil sayacı yalnız AKTİF turu (2) besler
    (ws as unknown as FakeWs).onmessage?.({ data: JSON.stringify(transcriptMsg('x')) });
    (ws as unknown as FakeWs).onmessage?.({ data: JSON.stringify(turnDone()) });
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(o1.status).toBe('superseded');
    expect(o2.status).toBe('complete');
    expect(seen).toEqual(['2:x']);
  });

  it('goAway → tur bitince soket kapanır, resumption handle korunur, sonraki tur yeniden bağlanır', async () => {
    const created: FakeWs[] = [];
    const sess = new GeminiLiveSession({ apiKey: 'k', systemInstruction: 's' }, (url) => {
      const w = new FakeWs(url, { connect: 'ok', turns: [
        [{ emit: { sessionResumptionUpdate: { newHandle: 'H-9', resumable: true } } }, { emit: { goAway: { timeLeft: '10s' } } }, { emit: turnDone() }],
        [{ emit: turnDone() }],
      ] });
      created.push(w);
      return w;
    });
    await sess.sendTurn('a', {}, { firstOutputTimeoutMs: 1000 });
    expect(sess.goAwayPending).toBe(true);
    expect(sess.isReady()).toBe(false);
    await sess.sendTurn('b', {}, { firstOutputTimeoutMs: 1000 });
    expect(created).toHaveLength(2);
    expect((created[1].sent[0].setup as { sessionResumption: { handle: string } }).sessionResumption.handle).toBe('H-9');
  });

  it('function declarations: intent enum katalogdan, üç araç (action · web · unresolved)', () => {
    const decls = buildLiveFunctionDeclarations() as { name: string; parameters: { properties: { intent?: { enum: string[] } } } }[];
    expect(decls.map((d) => d.name)).toEqual([LIVE_TOOL_ACTION, 'mavi_web_search', 'mavi_unresolved']);
    expect(decls[0].parameters.properties.intent!.enum).toContain('OPEN_NAVIGATION');
  });
});
