/**
 * geminiLiveSession — Gemini Live (BidiGenerateContent, WSS) oturum istemcisi.
 *
 * ── ROL ────────────────────────────────────────────────────────────────────
 * Mavi'nin birincil ONLINE konuşma yolu (ürün kararı 2026-09-21). Bu modül
 * YALNIZ protokolün sahibidir: bağlantı, setup, tur gönderimi, sunucu
 * mesajlarının ayrıştırılması, session resumption / goAway, arıza
 * sınıflandırması için ham sebep. **Konuşmaz** (ses parçalarını çağıranın
 * verdiği sink'e iletir), **rota seçmez** (sağlayıcı zinciri
 * `companionChatProvider`), **eylem yürütmez** (tool çağrısı ham olarak
 * yukarı çıkar; intent/authority zinciri değişmez).
 *
 * ── TUR SAHİPLİĞİ ──────────────────────────────────────────────────────────
 * Aynı anda EN FAZLA bir tur uçuştadır. Yeni `sendTurn` eskisini `superseded`
 * ile kapatır; eski turun gecikmiş sunucu mesajları nesil sayacıyla DÜŞER
 * (eski nesil ses/tool çağrısı asla sink'e ulaşmaz). Sunucu tarafında yeni
 * `clientContent` zaten süren üretimi keser (`interrupted`).
 *
 * ── ARIZA SINIFI ───────────────────────────────────────────────────────────
 * Tarayıcı WebSocket'i HTTP el sıkışma durumunu açmaz. Elimizde: kapanış
 * kodu + sebep metni ve `setupComplete` görülüp görülmediği. Sınıflandırma
 * `companionProviderHealth.classifyLiveFailure` (tek sahip); bu modül yalnız
 * ham `reason` + `setupCompleted` iletir.
 *
 * ── DOĞRULUK SINIRI ────────────────────────────────────────────────────────
 * Mesaj şekilleri resmi WebSocket referansına göredir (ai.google.dev/api/live,
 * 2026-09): `setup` · `clientContent` · `toolResponse` ↔ `setupComplete` ·
 * `serverContent{modelTurn,turnComplete,interrupted,generationComplete,
 * outputTranscription}` · `toolCall{functionCalls}` · `goAway{timeLeft}` ·
 * `sessionResumptionUpdate{newHandle,resumable}`. Cihazda DOĞRULANMADI —
 * ledger maddesi açıktır. Bilinmeyen alanlar yok sayılır (fail-soft).
 */

import { GEMINI_LIVE_MODEL, geminiLiveEndpoint } from '../gateway/models';
/* Mavi ses kimliği TEK yerden (Live + Gemini TTS yedeği aynı ses). Yaprak modül. */
import { MAVI_VOICE_PROFILE } from '../../assistant/maviVoiceProfile';

/* ══════════════════════════════════════════════════════════════════════════
 * WebSocket soyutlaması (test enjeksiyonu)
 * ════════════════════════════════════════════════════════════════════════ */

export interface WebSocketLike {
  binaryType?: string;
  readonly readyState: number;
  onopen:    ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror:   ((ev: unknown) => void) | null;
  onclose:   ((ev: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

function defaultWsFactory(url: string): WebSocketLike {
  if (typeof WebSocket === 'undefined') throw new Error('WebSocket unavailable');
  return new WebSocket(url) as unknown as WebSocketLike;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme tipleri
 * ════════════════════════════════════════════════════════════════════════ */

export interface LiveSessionConfig {
  readonly apiKey: string;
  readonly model?: string;
  /** Oturum başında BİR KEZ gönderilir. Değişirse `configFingerprint` farkı yeniden bağlanmayı zorlar. */
  readonly systemInstruction: string;
  /** `functionDeclarations` dizisi (bkz. liveToolSchema). Boşsa tool gönderilmez. */
  readonly functionDeclarations?: readonly unknown[];
  readonly voiceName?: string;
  readonly languageCode?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Setup tamamlanma bütçesi. */
  readonly connectTimeoutMs?: number;
}

export interface LiveToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface LiveTurnSinks {
  /** 16-bit PCM 24 kHz mono ham ses parçası (base64 çözülmüş). */
  onAudioChunk?(pcm: ArrayBuffer): void;
  /** Çıkış transkripti parçası (sohbet metni — geçmiş/UI için). */
  onTranscript?(text: string): void;
  /** Tool çağrısı (ham). Yürütme/yetki ÇAĞIRANIN zincirindedir. */
  onToolCall?(call: LiveToolCall): void;
  /** Sunucu üretimi kesti (yeni girdi / barge-in). */
  onInterrupted?(): void;
}

export interface LiveTurnOptions {
  /** İlk çıktı (ses · transkript · tool) bu sürede gelmezse tur `failed/LIVE_TIMEOUT` (producedOutput=false). */
  readonly firstOutputTimeoutMs: number;
  /** Tur toplam tavanı (uzun cevap emniyeti). */
  readonly totalTimeoutMs?: number;
  /**
   * Bu oturumun sunucu bağlamında HENÜZ olmayan önceki turlar (REST/yerel yolda
   * cevaplanmış ya da yeni bağlamda kaybolmuş). `clientContent.turns` dizisinde
   * kullanıcı turunun ÖNÜNE eklenir — sistem talimatı yeniden gönderilmez
   * (Live gecikme avantajı korunur). FONKSİYON: bağlantı kurulduktan SONRA
   * çağrılır (sunucu bağlamı nesli o anda kesindir). Boş dönerse davranış eski.
   */
  readonly priorTurns?: () => readonly { readonly role: 'user' | 'model'; readonly text: string }[];
}

export type LiveTurnOutcome =
  | {
      readonly status: 'complete';
      readonly transcript: string;
      readonly toolCalls: readonly LiveToolCall[];
      readonly producedOutput: boolean;
      readonly interrupted: boolean;
    }
  | {
      readonly status: 'failed';
      /** Ham sebep metni — sınıflandırma sağlık defterinde. */
      readonly reason: string;
      readonly setupCompleted: boolean;
      readonly transcript: string;
      readonly toolCalls: readonly LiveToolCall[];
      /** true ise çağıran BAŞKA sağlayıcıya DÜŞEMEZ (duplicate cevap yasağı). */
      readonly producedOutput: boolean;
    }
  | { readonly status: 'superseded' };

export type LiveSessionState = 'idle' | 'connecting' | 'ready' | 'closed';

const DEFAULT_CONNECT_TIMEOUT_MS = 4_000;
const DEFAULT_TOTAL_TIMEOUT_MS   = 30_000;
const DEFAULT_VOICE              = MAVI_VOICE_PROFILE.geminiVoice;
const DEFAULT_LANGUAGE           = MAVI_VOICE_PROFILE.language;

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);   // WebView ve vitest (Node ≥16) ortak; yoksa throw → çağıran try'da
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Çerçeve çözümü SENKRON (string · ArrayBuffer · typed array). Neden: mesaj ve
 * kapanış olayları aynı kuyruktan gelir; çözüm bir `await` ile ertelenirse son
 * mesajlar (transkript · resumption handle) kapanıştan SONRA işlenir ve düşer —
 * ölçülen sıra hatası. Yalnız `Blob` (eski WebView, binaryType uygulanmadı) async.
 */
function decodeFrameSync(data: unknown): unknown | null {
  try {
    if (typeof data === 'string') return JSON.parse(data);
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    if (ArrayBuffer.isView(data)) return JSON.parse(new TextDecoder().decode(data as Uint8Array));
  } catch { /* bozuk çerçeve — yok sayılır */ }
  return null;
}
async function decodeBlobFrame(data: unknown): Promise<unknown | null> {
  try {
    const maybeBlob = data as { text?: () => Promise<string> } | null;
    if (maybeBlob && typeof maybeBlob.text === 'function') return JSON.parse(await maybeBlob.text());
  } catch { /* bozuk çerçeve */ }
  return null;
}

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] };
    turnComplete?: boolean;
    interrupted?: boolean;
    generationComplete?: boolean;
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  error?: { message?: string; status?: string; code?: number };
}

/** Oturumun yeniden bağlanmasını gerektiren yapılandırma parmak izi (anahtar HARİÇ). */
export function liveConfigFingerprint(cfg: LiveSessionConfig): string {
  return [
    cfg.model ?? GEMINI_LIVE_MODEL, cfg.voiceName ?? DEFAULT_VOICE, cfg.languageCode ?? DEFAULT_LANGUAGE,
    String(cfg.temperature ?? ''), String(cfg.maxOutputTokens ?? ''),
    String(cfg.functionDeclarations?.length ?? 0),
    cfg.systemInstruction,
  ].join('\u0001');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Oturum
 * ════════════════════════════════════════════════════════════════════════ */

interface PendingTurn {
  readonly gen: number;
  readonly sinks: LiveTurnSinks;
  transcript: string;
  toolCalls: LiveToolCall[];
  producedOutput: boolean;
  interrupted: boolean;
  firstOutputTimer: ReturnType<typeof setTimeout> | null;
  totalTimer: ReturnType<typeof setTimeout> | null;
  resolve: (o: LiveTurnOutcome) => void;
}

export class GeminiLiveSession {
  private _ws: WebSocketLike | null = null;
  private _state: LiveSessionState = 'idle';
  private _setupCompleted = false;
  private _resumeHandle: string | null = null;
  private _goAwayPending = false;
  /**
   * SUNUCU BAĞLAMI NESLİ: resumption handle OLMADAN açılan her soket yeni (boş)
   * bir sunucu bağlamıdır → sayaç artar. Çağıran (`companionChatProvider`) bunu
   * "hangi geçmiş turlar bu bağlamda var" sorusu için okur; handle ile devam
   * eden bağlantıda sayaç DEĞİŞMEZ (bağlam korunmuştur).
   */
  private _contextEpoch = 0;
  private _fingerprint = '';
  private _connectPromise: Promise<void> | null = null;
  private _turnGen = 0;
  private _pending: PendingTurn | null = null;
  private _lastCloseReason = '';
  private _lastCloseCode: number | null = null;

  private readonly _cfg: LiveSessionConfig;
  private readonly _wsFactory: WebSocketFactory;

  constructor(cfg: LiveSessionConfig, wsFactory: WebSocketFactory = defaultWsFactory) {
    this._cfg = cfg;
    this._wsFactory = wsFactory;
    this._fingerprint = liveConfigFingerprint(cfg);
  }

  get state(): LiveSessionState { return this._state; }
  get setupCompleted(): boolean { return this._setupCompleted; }
  get resumeHandle(): string | null { return this._resumeHandle; }
  get contextEpoch(): number { return this._contextEpoch; }
  get lastCloseReason(): string { return this._lastCloseReason; }
  get lastCloseCode(): number | null { return this._lastCloseCode; }
  get fingerprint(): string { return this._fingerprint; }
  /** Sunucu `goAway` gönderdi: bu tur bitince yeniden bağlanılmalı. */
  get goAwayPending(): boolean { return this._goAwayPending; }

  isReady(): boolean {
    return this._state === 'ready' && this._ws !== null && this._ws.readyState === WS_OPEN;
  }

  /**
   * Bağlanır ve `setupComplete` bekler. Zaten hazırsa anında döner; süren
   * bir bağlanma varsa ona katılır. Reddedilirse `Error.message` ham sebep
   * (sınıflandırma çağıranın).
   */
  connect(): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect().finally(() => { this._connectPromise = null; });
    return this._connectPromise;
  }

  private _doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._closeSocket(1000, 'reconnect');
      this._state = 'connecting';
      this._setupCompleted = false;
      this._goAwayPending = false;
      this._lastCloseReason = '';
      this._lastCloseCode = null;
      if (!this._resumeHandle) this._contextEpoch++;   // taze sunucu bağlamı

      let ws: WebSocketLike;
      try {
        ws = this._wsFactory(geminiLiveEndpoint(this._cfg.apiKey));
      } catch (e) {
        this._state = 'closed';
        reject(new Error(e instanceof Error ? e.message : 'ws_factory_failed'));
        return;
      }
      this._ws = ws;
      try { ws.binaryType = 'arraybuffer'; } catch { /* eski WebView */ }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._closeSocket(1000, 'setup_timeout');
        this._state = 'closed';
        reject(new Error('setup_timeout'));
      }, this._cfg.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        try { ws.send(JSON.stringify(this._buildSetup())); }
        catch (e) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          this._state = 'closed';
          reject(new Error(e instanceof Error ? e.message : 'setup_send_failed'));
        }
      };
      ws.onerror = () => { /* kapanış olayı sebep taşır; burada karar verilmez */ };
      ws.onclose = (ev) => {
        this._lastCloseReason = String(ev?.reason ?? '');
        this._lastCloseCode = typeof ev?.code === 'number' ? ev.code : null;
        if (this._ws === ws) { this._ws = null; this._state = 'closed'; }
        if (!settled) {
          settled = true; clearTimeout(timer);
          reject(new Error(this._lastCloseReason || `closed_before_setup:${this._lastCloseCode ?? '?'}`));
          return;
        }
        this._failPendingOnClose();
      };
      const onFrame = (msg: unknown): void => {
        if (!msg || this._ws !== ws) return;
        const m = msg as ServerMessage;
        if (m.setupComplete !== undefined && !settled) {
          settled = true; clearTimeout(timer);
          this._setupCompleted = true;
          this._state = 'ready';
          resolve();
          return;
        }
        this._handleServerMessage(m);
      };
      ws.onmessage = (ev) => {
        const sync = decodeFrameSync(ev.data);
        if (sync !== null) { onFrame(sync); return; }
        void decodeBlobFrame(ev.data).then(onFrame);
      };
    });
  }

  private _buildSetup(): unknown {
    const cfg = this._cfg;
    const setup: Record<string, unknown> = {
      model: `models/${cfg.model ?? GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voiceName ?? DEFAULT_VOICE } },
          languageCode: cfg.languageCode ?? DEFAULT_LANGUAGE,
        },
        ...(typeof cfg.temperature === 'number' ? { temperature: cfg.temperature } : {}),
        ...(typeof cfg.maxOutputTokens === 'number' ? { maxOutputTokens: cfg.maxOutputTokens } : {}),
      },
      systemInstruction: { parts: [{ text: cfg.systemInstruction }] },
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this._resumeHandle ? { handle: this._resumeHandle } : {},
    };
    if (cfg.functionDeclarations && cfg.functionDeclarations.length > 0) {
      setup.tools = [{ functionDeclarations: cfg.functionDeclarations }];
    }
    return { setup };
  }

  /**
   * Metin turu gönderir; sonuç `turnComplete`/hata/supersede ile çözülür.
   * Ses/transkript/tool parçaları UÇUŞTA sink'e akar. Bağlı değilse önce bağlanır.
   */
  async sendTurn(text: string, sinks: LiveTurnSinks, opts: LiveTurnOptions): Promise<LiveTurnOutcome> {
    // Önceki uçuştaki tur derhal supersede: iki tur ASLA paralel sürmez.
    this._supersedePending();
    const gen = ++this._turnGen;

    try {
      await this.connect();
    } catch (e) {
      if (gen !== this._turnGen) return { status: 'superseded' };
      return {
        status: 'failed', reason: e instanceof Error ? e.message : String(e),
        setupCompleted: this._setupCompleted, transcript: '', toolCalls: [], producedOutput: false,
      };
    }
    if (gen !== this._turnGen) return { status: 'superseded' };
    const ws = this._ws;
    if (!ws || !this.isReady()) {
      return {
        status: 'failed', reason: this._lastCloseReason || 'not_ready',
        setupCompleted: this._setupCompleted, transcript: '', toolCalls: [], producedOutput: false,
      };
    }

    return new Promise<LiveTurnOutcome>((resolve) => {
      const pending: PendingTurn = {
        gen, sinks, transcript: '', toolCalls: [], producedOutput: false, interrupted: false,
        firstOutputTimer: null, totalTimer: null, resolve,
      };
      this._pending = pending;
      pending.firstOutputTimer = setTimeout(() => {
        if (this._pending !== pending || pending.producedOutput) return;
        this._finishPending(pending, {
          status: 'failed', reason: 'first_output_timeout', setupCompleted: true,
          transcript: pending.transcript, toolCalls: pending.toolCalls, producedOutput: false,
        });
      }, opts.firstOutputTimeoutMs);
      pending.totalTimer = setTimeout(() => {
        if (this._pending !== pending) return;
        this._finishPending(pending, {
          status: 'failed', reason: 'turn_total_timeout', setupCompleted: true,
          transcript: pending.transcript, toolCalls: pending.toolCalls, producedOutput: pending.producedOutput,
        });
      }, opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);

      try {
        let priorList: readonly { role: 'user' | 'model'; text: string }[] = [];
        try { priorList = opts.priorTurns ? opts.priorTurns() : []; } catch { priorList = []; }
        const prior = priorList
          .filter((t) => typeof t.text === 'string' && t.text.trim())
          .map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
        ws.send(JSON.stringify({
          clientContent: { turns: [...prior, { role: 'user', parts: [{ text }] }], turnComplete: true },
        }));
      } catch (e) {
        this._finishPending(pending, {
          status: 'failed', reason: e instanceof Error ? e.message : 'send_failed', setupCompleted: true,
          transcript: '', toolCalls: [], producedOutput: false,
        });
      }
    });
  }

  /** Tool sonucunu sunucuya bildirir (varsayılan SILENT: model bunun üstüne konuşmaz). */
  sendToolResponse(call: LiveToolCall, response: Readonly<Record<string, unknown>>, scheduling: 'SILENT' | 'WHEN_IDLE' | 'INTERRUPT' = 'SILENT'): void {
    const ws = this._ws;
    if (!ws || !this.isReady()) return;
    try {
      ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: [{
            ...(call.id ? { id: call.id } : {}),
            name: call.name, response, scheduling,
          }],
        },
      }));
    } catch { /* fail-soft: sonuç bildirilemedi; tur zaten yukarıda yürüdü */ }
  }

  /** Uçuştaki turu iptal eder (sonucu `superseded`). Bağlantı AÇIK kalır. */
  cancelTurn(): void {
    this._turnGen++;
    this._supersedePending();
  }

  /** Oturumu kapatır; resumption handle KORUNUR (sonraki connect ile devam). */
  close(reason = 'client_close'): void {
    this._supersedePending();
    this._closeSocket(1000, reason);
    this._state = 'closed';
  }

  /* ── iç ─────────────────────────────────────────────────────────────── */

  private _handleServerMessage(m: ServerMessage): void {
    if (m.sessionResumptionUpdate) {
      const u = m.sessionResumptionUpdate;
      if (u.resumable && typeof u.newHandle === 'string' && u.newHandle) this._resumeHandle = u.newHandle;
    }
    if (m.goAway) this._goAwayPending = true;
    if (m.error) {
      const reason = `${m.error.status ?? ''} ${m.error.message ?? ''}`.trim();
      const p = this._pending;
      if (p) {
        this._finishPending(p, {
          status: 'failed', reason: reason || 'server_error', setupCompleted: this._setupCompleted,
          transcript: p.transcript, toolCalls: p.toolCalls, producedOutput: p.producedOutput,
        });
      }
      return;
    }

    const p = this._pending;
    if (!p) return;

    if (m.toolCall?.functionCalls) {
      for (const fc of m.toolCall.functionCalls) {
        if (typeof fc?.name !== 'string' || !fc.name) continue;
        const call: LiveToolCall = { ...(fc.id ? { id: fc.id } : {}), name: fc.name, args: Object.freeze({ ...(fc.args ?? {}) }) };
        p.toolCalls.push(call);
        this._markOutput(p);
        try { p.sinks.onToolCall?.(call); } catch { /* sink hatası oturumu kırmaz */ }
      }
    }

    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        p.interrupted = true;
        try { p.sinks.onInterrupted?.(); } catch { /* yok */ }
      }
      const tx = sc.outputTranscription?.text;
      if (typeof tx === 'string' && tx) {
        p.transcript += tx;
        this._markOutput(p);
        try { p.sinks.onTranscript?.(tx); } catch { /* yok */ }
      }
      const parts = sc.modelTurn?.parts ?? [];
      for (const part of parts) {
        const d = part?.inlineData;
        if (d && typeof d.data === 'string' && d.data && /audio\/pcm/i.test(d.mimeType ?? 'audio/pcm')) {
          this._markOutput(p);
          try { p.sinks.onAudioChunk?.(base64ToArrayBuffer(d.data)); } catch { /* yok */ }
        } else if (typeof part?.text === 'string' && part.text) {
          // Native audio modelleri metin part'ı vermez; verirse transkript gibi işlenir.
          p.transcript += part.text;
          this._markOutput(p);
          try { p.sinks.onTranscript?.(part.text); } catch { /* yok */ }
        }
      }
      if (sc.turnComplete) {
        this._finishPending(p, {
          status: 'complete', transcript: p.transcript, toolCalls: p.toolCalls,
          producedOutput: p.producedOutput, interrupted: p.interrupted,
        });
        if (this._goAwayPending) this._closeSocket(1000, 'go_away');
      }
    }
  }

  private _markOutput(p: PendingTurn): void {
    if (p.producedOutput) return;
    p.producedOutput = true;
    if (p.firstOutputTimer) { clearTimeout(p.firstOutputTimer); p.firstOutputTimer = null; }
  }

  private _finishPending(p: PendingTurn, outcome: LiveTurnOutcome): void {
    if (this._pending !== p) return;
    this._pending = null;
    if (p.firstOutputTimer) clearTimeout(p.firstOutputTimer);
    if (p.totalTimer) clearTimeout(p.totalTimer);
    p.resolve(outcome);
  }

  private _supersedePending(): void {
    const p = this._pending;
    if (!p) return;
    this._finishPending(p, { status: 'superseded' });
  }

  private _failPendingOnClose(): void {
    const p = this._pending;
    if (!p) return;
    this._finishPending(p, {
      status: 'failed', reason: this._lastCloseReason || `closed:${this._lastCloseCode ?? '?'}`,
      setupCompleted: this._setupCompleted, transcript: p.transcript, toolCalls: p.toolCalls,
      producedOutput: p.producedOutput,
    });
  }

  private _closeSocket(code: number, reason: string): void {
    const ws = this._ws;
    if (!ws) return;
    this._ws = null;
    ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
    try { ws.close(code, reason); } catch { /* zaten kapalı */ }
  }
}
