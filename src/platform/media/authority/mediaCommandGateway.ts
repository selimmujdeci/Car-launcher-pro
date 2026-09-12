/**
 * mediaCommandGateway.ts — MÜZİK HUB PAKET A · TEK medya komut kapısı.
 *
 * UI · Mavi · direksiyon tuşları · bildirim · yolcu sunucusu — hepsi buradan
 * geçer. Kapının garantileri:
 *   1. Her komut typed `CommandTruth` döndürür (transport ACK ≠ başarı).
 *   2. Aynı `commandId` iki kez yürütülmez (çift dokunuş / replay).
 *   3. Kaynağın desteklemediği komut sessizce yutulmaz — REDDEDİLİR.
 *   4. Kaynak devri işlemseldir; devir sürerken gelen komutlar serileştirilir.
 *   5. Ducking token tabanlıdır; bayat token sesi yükseltemez.
 *   6. Ses tek formülle hesaplanır (volumePolicy).
 *
 * Bu modül durum TUTAR (oturum, kuyruk kimliği, duck kayıtları) ama saf çekirdek
 * modüllerine (truth · capabilities · duck · volume · handover) devreder.
 */

import {
  beginTruth, finishTruth, withStage, honestClaim,
  type CommandTruth, type DesiredState, type ObservedState, type VerificationLevel,
  type HonestClaim,
} from './playbackTruth';
import {
  getSource, maxVerificationFor, supportsCommand,
  type CapabilityGatedCommand, type SourceClass,
} from './sourceCapabilities';
import {
  createSourceCoordinator, type BackendAdapter, type BackendCommandOutcome,
  type BackendPlaybackState, type PlayRequest, type SourceCoordinator,
} from './sourceCoordinator';
import { isInFlight } from './handoverMachine';
import {
  createExternalSessionAdapter, createNativeAuthorityAdapter,
  createSpotifyAdapter, createYouTubeAdapter,
} from './backendAdapters';
import {
  applyDuck, EMPTY_DUCK_STATE, effectiveDuckLevel, isDuckReason, releaseDuck,
  activeReasons, type DuckReason, type DuckState,
} from './duckPolicy';
import { computeEffectiveVolume, percentToUnit } from './volumePolicy';
import * as native from './nativeAuthorityBridge';
import {
  recordDuplicateBackend, recordHandover, recordTruth,
} from './mediaAuthorityEvidence';
import { createCommandMessage, type CommandMessage } from '../../message';

/* ── Oturum durumu ───────────────────────────────────────────────────────── */

let _sessionId = 'media-session-0';
let _sessionSeq = 0;
let _duck: DuckState = EMPTY_DUCK_STATE;
let _userVolume = 1;
let _muted = false;
/**
 * MUSIC F19 — kaynak seviye normalizasyonu (0.25..1).
 *
 * `volumePolicy` formülünde ZATEN var olan alandır; F19'a kadar hiç
 * beslenmiyordu (daima 1). **İkinci bir ses otoritesi DEĞİLDİR:** yazarı tek
 * bir seam'dir (`setSourceNormalization`) ve kullanıcı sesine DOKUNMAZ.
 */
let _sourceNormalization = 1;
let _coordinator: SourceCoordinator | null = null;
/** Native duck token'ları: JS token → native token eşlemesi. */
const _nativeDuckTokens = new Map<number, number>();

/** Bounded replay koruması. */
const RECENT_COMMAND_LIMIT = 64;
const _recentCommandIds: string[] = [];
/** ARCH-03: bounded, payload-free command/result evidence; execution remains this gateway. */
let _lastCanonicalCommand: CommandMessage | null = null;
let _lastCanonicalResult: CommandMessage | null = null;

export function getMediaCommandFlowEvidence(): Readonly<{
  command: CommandMessage | null; result: CommandMessage | null;
}> {
  return Object.freeze({ command: _lastCanonicalCommand, result: _lastCanonicalResult });
}

function now(): number { return Date.now(); }

function nextCommandId(command: string): string {
  return native.nextCommandId(command);
}

function isReplay(commandId: string): boolean {
  if (_recentCommandIds.includes(commandId)) return true;
  _recentCommandIds.push(commandId);
  while (_recentCommandIds.length > RECENT_COMMAND_LIMIT) _recentCommandIds.shift();
  return false;
}

/* ── Adapter kayıt defteri ───────────────────────────────────────────────── */

function buildAdapters(): Map<SourceClass, BackendAdapter> {
  const m = new Map<SourceClass, BackendAdapter>();
  m.set('LOCAL', createNativeAuthorityAdapter('LOCAL'));
  m.set('STREAM', createNativeAuthorityAdapter('STREAM'));
  m.set('INTERNET_RADIO', createNativeAuthorityAdapter('INTERNET_RADIO'));
  m.set('YOUTUBE', createYouTubeAdapter());
  m.set('SPOTIFY_CONNECT', createSpotifyAdapter());
  m.set('EXTERNAL_MEDIA_SESSION', createExternalSessionAdapter('EXTERNAL_MEDIA_SESSION'));
  m.set('BLUETOOTH_EXTERNAL', createExternalSessionAdapter('BLUETOOTH_EXTERNAL'));
  return m;
}

function coordinator(): SourceCoordinator {
  if (!_coordinator) {
    _coordinator = createSourceCoordinator({ now, adapters: buildAdapters() });
  }
  return _coordinator;
}

/** Şu an otoritenin bildiği aktif kaynak (yoksa null). */
export function getActiveSource(): SourceClass | null {
  return coordinator().getActiveSource();
}

/* ── PAKET B · Kurtarma kapıları ─────────────────────────────────────────── */

/**
 * Uçuşan kullanıcı/Mavi komutu sayısı. Kuyruk kurtarması bu sıfırdan büyükken
 * ERTELENİR — kullanıcı komutu her zaman önceliklidir.
 */
let _inFlight = 0;

export function isUserCommandInFlight(): boolean {
  return _inFlight > 0;
}

/**
 * Otorite generation'ı: her kaynak devri ve her durdurma ile artar. Kurtarma
 * kararı ile uygulaması arasında bu değer değişirse karar BAYATtır ve atılır.
 */
export function getAuthorityGeneration(): number {
  return _sessionSeq;
}

/**
 * Kapının ŞU ANKİ kanonik oturum kimliği (`CommandTruth.sessionId` ile aynı
 * kaynaktan). Bir komut sonucunun hâlâ güncel dünyaya ait olup olmadığı bununla
 * sınanır: araya yeni bir `playSource`/`stop` girdiyse kimlik ilerlemiştir ve
 * ESKİ sonuç bayattır (Cross-Domain §17).
 */
export function getMediaSessionId(): string {
  return _sessionId;
}

/** Kaynak devri sürüyor mu — devir bitmeden kurtarma başlamaz. */
export function isHandoverInFlight(): boolean {
  return isInFlight(coordinator().getState().phase);
}

/* ── Gözlem yardımcıları ─────────────────────────────────────────────────── */

/**
 * MUSIC F7.1 · Backend'in gözlenen durumu → kanonik `ObservedState`.
 * Eşleme birebirdir; ara değer TÜRETİLMEZ.
 */
function fromBackendState(s: BackendPlaybackState): ObservedState {
  switch (s) {
    case 'PLAYING': return 'PLAYING';
    case 'PAUSED': return 'PAUSED';
    case 'BUFFERING': return 'BUFFERING';
    case 'STOPPED': return 'STOPPED';
    case 'ERROR': return 'ERROR';
    default: return 'UNKNOWN';
  }
}

function observedStateFor(source: SourceClass | null): ObservedState {
  if (!source) return 'UNKNOWN';
  const d = getSource(source);
  if (d.backend === 'native_authority') {
    const s = native.getSnapshot();
    if (!s.authorityAvailable) return 'UNKNOWN';
    if (s.buffering) return 'BUFFERING';
    if (s.playing) return 'PLAYING';
    if ((s.queueLength ?? 0) > 0) return 'PAUSED';
    return 'STOPPED';
  }
  /* MUSIC F7.1: native OLMAYAN backend (YouTube IFrame …) kendi durumunu
     bildirebiliyorsa OKUNUR. Bildiremiyorsa `UNKNOWN` kalır — eskiden bu
     kaynaklar için durum HER ZAMAN `UNKNOWN`du ve bu yüzden transport
     kapının DIŞINDA sürülüyordu. */
  try {
    const adapter = _coordinator ? _coordinator.getAdapter(source) : null;
    const observed = adapter?.observe?.();
    return observed ? fromBackendState(observed) : 'UNKNOWN';
  } catch { return 'UNKNOWN'; }
}

/**
 * MUSIC F7.1 · Transport komutunu SAHİBİNE dağıtır.
 *
 * `native_authority` backend'i eski yolunda kalır (davranış DEĞİŞMEDİ).
 * Diğer backend'ler kendi `BackendTransport`ından sürülür; sunmuyorsa komut
 * `unsupported_capability` ile REDDEDİLİR — sessizce yutulmaz, sahte başarı
 * üretilmez.
 */
async function backendTransport(
  source: SourceClass,
  op: 'resume' | 'pause' | 'seek',
  positionSec = 0,
): Promise<BackendCommandOutcome> {
  const adapter = coordinator().getAdapter(source);
  const t = adapter?.transport;
  if (!t) return { accepted: false, failureCode: 'unsupported_capability' };
  try {
    if (op === 'resume') return await t.resume();
    if (op === 'pause') return await t.pause();
    return await t.seek(positionSec);
  } catch {
    return { accepted: false, failureCode: `${op}_threw` };
  }
}

/** Bu kaynağın transportu native otoriteye mi ait? */
function isNativeBackend(source: SourceClass): boolean {
  return getSource(source).backend === 'native_authority';
}

function verificationFor(source: SourceClass | null, observedPlaying: boolean): VerificationLevel {
  if (!source) return 'NONE';
  const max = maxVerificationFor(source);
  if (max === 'RENDERING_VERIFIED') {
    return native.isRenderingVerified() ? 'RENDERING_VERIFIED' : 'TRANSPORT_ACK';
  }
  if (!observedPlaying) return 'TRANSPORT_ACK';
  return max;
}

/* ── Ortak komut yürütücüsü ──────────────────────────────────────────────── */

interface RunInput {
  readonly command: string;
  readonly desiredState: DesiredState;
  readonly commandId?: string;
  readonly capabilityCommand?: CapabilityGatedCommand;
  readonly source?: SourceClass | null;
  /** Caller provenance only; it never changes the gateway or playback owner. */
  readonly requester?: string;
  /**
   * Komut, devir zincirine kuyruklanmalı mı (varsayılan: EVET).
   *
   * `false` YALNIZ devrin KENDİSİ için kullanılır: `switchTo` zaten aynı zinciri
   * kullanır; onu bir de `serialize()` içinden çağırmak zincirin kendini
   * beklemesine (KİLİTLENME) yol açar — komut asla dönmezdi.
   */
  readonly serialize?: boolean;
  readonly run: () => Promise<{
    ok: boolean;
    failureCode: string | null;
    verified?: boolean;
    observed?: ObservedState;
  }>;
}

async function runCommand(input: RunInput): Promise<CommandTruth> {
  const commandId = input.commandId ?? nextCommandId(input.command);
  const source = input.source !== undefined ? input.source : getActiveSource();
  const backend = source ? getSource(source).backend : 'none';

  let draft = beginTruth({
    commandId,
    sessionId: _sessionId,
    sourceId: source ?? 'NONE',
    backend,
    command: input.command,
    desiredState: input.desiredState,
    atMs: now(),
  });
  // Contract is evidence only: no router, no second dedup and no new playback owner.
  _lastCanonicalCommand = createCommandMessage({
    messageId: commandId, kind: 'COMMAND', name: 'media.command.execute',
    source: input.requester ?? 'media.requester', target: 'media.command_gateway', createdAtMs: now(),
    correlationId: commandId, causationId: null, operationId: commandId,
    sessionId: _sessionId, generation: _sessionSeq, epoch: null, scopeRef: `media:${source ?? 'NONE'}`,
    provenance: ['mediaCommandGateway'], attempt: 0, idempotencyKey: commandId, payload: null,
  });
  const recordCanonicalResult = (): void => {
    _lastCanonicalResult = createCommandMessage({
      messageId: `${commandId}:result`, kind: 'RESULT', name: 'media.command.result',
      source: 'media.command_gateway', target: null, createdAtMs: now(),
      correlationId: commandId, causationId: commandId, operationId: commandId,
      sessionId: _sessionId, generation: _sessionSeq, epoch: null, scopeRef: `media:${source ?? 'NONE'}`,
      provenance: ['mediaCommandGateway', 'playbackTruth'], attempt: 0, idempotencyKey: null, payload: null,
    });
  };

  // 1) Replay / çift dokunuş
  if (isReplay(commandId)) {
    const t = finishTruth(draft, {
      outcome: 'REJECTED', observedState: observedStateFor(source),
      verificationLevel: 'NONE', failureCode: 'duplicate_command', atMs: now(),
    });
    recordCanonicalResult();
    recordTruth(t);
    return t;
  }

  draft = withStage(draft, 'intent_resolved', now());

  // 2) Kaynak çözümü
  if (!source) {
    const t = finishTruth(draft, {
      outcome: 'REJECTED', observedState: 'UNKNOWN',
      verificationLevel: 'NONE', failureCode: 'no_active_source', atMs: now(),
    });
    recordCanonicalResult();
    recordTruth(t);
    return t;
  }
  draft = withStage(draft, 'source_resolved', now(), source);

  // 3) Yetenek kapısı — desteklenmeyen komut SESSİZCE YUTULMAZ
  if (input.capabilityCommand && !supportsCommand(source, input.capabilityCommand)) {
    const t = finishTruth(draft, {
      outcome: 'REJECTED', observedState: observedStateFor(source),
      verificationLevel: 'NONE', failureCode: 'unsupported_capability', atMs: now(),
    });
    recordCanonicalResult();
    recordTruth(t);
    return t;
  }

  // 4) Yürütme (devir sürüyorsa serileştirilir; devrin KENDİSİ zaten zincirdedir)
  draft = withStage(draft, 'playback_requested', now());
  // Komut uçarken kuyruk kurtarması ERTELENİR (kullanıcı komutu önceliklidir).
  _inFlight += 1;
  let res: Awaited<ReturnType<RunInput['run']>>;
  try {
    res = input.serialize === false
      ? await input.run()
      : await coordinator().serialize(input.run);
  } finally {
    _inFlight = Math.max(0, _inFlight - 1);
  }
  draft = withStage(draft, 'transport_acknowledged', now());

  const observed = res.observed ?? observedStateFor(source);
  const observedPlaying = observed === 'PLAYING';
  const verification = verificationFor(source, observedPlaying);

  // 5) Sözleşme denetimi — 1'den fazla audible backend ASLA olmamalı
  if (coordinator().audibleBackends() > 1) recordDuplicateBackend();

  const wantsPlaying = input.desiredState === 'PLAYING';
  const reached = res.ok && (
    input.desiredState === 'UNCHANGED' ||
    (wantsPlaying ? observedPlaying || res.verified === true : !observedPlaying)
  );

  const t = finishTruth(draft, {
    outcome: !res.ok ? 'FAILED' : reached ? 'VERIFIED' : 'ACCEPTED_UNVERIFIED',
    observedState: observed,
    verificationLevel: verification,
    failureCode: res.failureCode,
    atMs: now(),
  });
  recordCanonicalResult();
  recordTruth(t);
  return t;
}

/* ── Genel komutlar ──────────────────────────────────────────────────────── */

export interface GatewayPlayRequest {
  readonly source: SourceClass;
  readonly items: PlayRequest['items'];
  readonly startIndex?: number;
  readonly positionMs?: number;
  readonly autoPlay?: boolean;
  readonly commandId?: string;
}

/**
 * Kaynak seçip çalar — işlemsel devirle. Eski kaynağın durduğu doğrulanmadan
 * yeni kaynak COMMITTED olmaz.
 */
export async function playSource(req: GatewayPlayRequest): Promise<CommandTruth> {
  _sessionSeq += 1;
  _sessionId = `media-session-${_sessionSeq}`;

  const request: PlayRequest = {
    items: req.items,
    startIndex: Math.max(0, req.startIndex ?? 0),
    positionMs: Math.max(0, req.positionMs ?? 0),
    autoPlay: req.autoPlay !== false,
  };

  const startedAt = now();
  return runCommand({
    command: 'playSource',
    desiredState: request.autoPlay ? 'PLAYING' : 'PAUSED',
    commandId: req.commandId,
    source: req.source,
    // `switchTo` devir zincirinin SAHİBİDİR — ikinci kez kuyruklanırsa kilitlenir.
    serialize: false,
    run: async () => {
      const out = await coordinator().switchTo(req.source, request);
      recordHandover({ ok: out.ok, elapsedMs: now() - startedAt, target: req.source });
      return {
        ok: out.ok,
        failureCode: out.failureCode,
        verified: out.renderingVerified,
        observed: out.ok ? (request.autoPlay ? 'PLAYING' : 'PAUSED') : observedStateFor(req.source),
      };
    },
  });
}

export function play(commandId?: string, requester?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'play',
    desiredState: 'PLAYING',
    commandId,
    requester,
    capabilityCommand: 'play',
    run: async () => {
      const src = getActiveSource();
      /* MUSIC F7.1: yürütme SAHİBİNE gider. Native backend eski yolunda kalır. */
      if (src && !isNativeBackend(src)) {
        const out = await backendTransport(src, 'resume');
        return {
          ok: out.accepted,
          failureCode: out.accepted ? null : (out.failureCode || 'play_rejected'),
          observed: observedStateFor(src),
        };
      }
      const res = await native.command('play');
      const s = await native.refreshSnapshot();
      return {
        ok: res.accepted,
        failureCode: res.accepted ? null : (res.failureCode || 'play_rejected'),
        verified: s.renderingVerified,
      };
    },
  });
}

export function pause(commandId?: string, requester?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'pause',
    desiredState: 'PAUSED',
    commandId,
    requester,
    capabilityCommand: 'pause',
    run: async () => {
      const src = getActiveSource();
      if (src && !isNativeBackend(src)) {
        const out = await backendTransport(src, 'pause');
        return {
          ok: out.accepted,
          failureCode: out.accepted ? null : (out.failureCode || 'pause_rejected'),
          observed: observedStateFor(src),
        };
      }
      const res = await native.command('pause');
      await native.refreshSnapshot();
      return { ok: res.accepted, failureCode: res.accepted ? null : (res.failureCode || 'pause_rejected') };
    },
  });
}

export function stop(commandId?: string): Promise<CommandTruth> {
  // Durdurma dünyayı değiştirir → generation ilerler; uçuşan kurtarma kararları
  // bayatlar ve UYGULANMAZ (durdurulmuş kuyruğa hizalama yapılmaz).
  _sessionSeq += 1;
  return runCommand({
    command: 'stop',
    desiredState: 'STOPPED',
    commandId,
    capabilityCommand: 'stop',
    run: async () => {
      const out = await coordinator().stopActive();
      return {
        ok: out.verified,
        failureCode: out.verified ? null : (out.failureCode ?? 'stop_unverified'),
        observed: out.verified ? 'STOPPED' : 'UNKNOWN',
      };
    },
  });
}

export function next(commandId?: string, requester?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'next',
    desiredState: 'PLAYING',
    commandId,
    requester,
    capabilityCommand: 'next',
    run: async () => {
      const res = await native.command('next');
      const s = await native.refreshSnapshot();
      return {
        ok: res.accepted,
        failureCode: res.accepted ? null : (res.failureCode || 'next_rejected'),
        verified: s.renderingVerified,
      };
    },
  });
}

export function previous(commandId?: string, requester?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'previous',
    desiredState: 'PLAYING',
    commandId,
    requester,
    capabilityCommand: 'previous',
    run: async () => {
      const res = await native.command('previous');
      const s = await native.refreshSnapshot();
      return {
        ok: res.accepted,
        failureCode: res.accepted ? null : (res.failureCode || 'previous_rejected'),
        verified: s.renderingVerified,
      };
    },
  });
}

export function seek(positionSec: number, commandId?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'seek',
    desiredState: 'UNCHANGED',
    commandId,
    capabilityCommand: 'seek',
    run: async () => {
      if (!Number.isFinite(positionSec) || positionSec < 0) {
        return { ok: false, failureCode: 'invalid_position' };
      }
      const src = getActiveSource();
      if (src && !isNativeBackend(src)) {
        const out = await backendTransport(src, 'seek', positionSec);
        return {
          ok: out.accepted,
          failureCode: out.accepted ? null : (out.failureCode || 'seek_rejected'),
          observed: observedStateFor(src),
        };
      }
      const res = await native.command('seek', { positionMs: Math.round(positionSec * 1000) });
      return { ok: res.accepted, failureCode: res.accepted ? null : (res.failureCode || 'seek_rejected') };
    },
  });
}

export function setShuffle(enabled: boolean, commandId?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'setShuffle',
    desiredState: 'UNCHANGED',
    commandId,
    capabilityCommand: 'setShuffle',
    run: async () => {
      const res = await native.command('setShuffle', { enabled });
      return { ok: res.accepted, failureCode: res.accepted ? null : (res.failureCode || 'shuffle_rejected') };
    },
  });
}

export function setRepeat(mode: 'off' | 'one' | 'all', commandId?: string): Promise<CommandTruth> {
  return runCommand({
    command: 'setRepeat',
    desiredState: 'UNCHANGED',
    commandId,
    capabilityCommand: 'setRepeat',
    run: async () => {
      const res = await native.command('setRepeat', { mode });
      return { ok: res.accepted, failureCode: res.accepted ? null : (res.failureCode || 'repeat_rejected') };
    },
  });
}

/* ── Ses (tek otorite) ───────────────────────────────────────────────────── */

/** Kullanıcı ses düzeyi (0–100). Duck çarpanı AYRI uygulanır. */
export async function setUserVolumePercent(percent: number): Promise<void> {
  _userVolume = percentToUnit(percent);
  await applyVolume();
}

export async function setMuted(muted: boolean): Promise<void> {
  _muted = muted === true;
  await applyVolume();
}

/**
 * FİİLEN duyulan ses = tek formül (kullanıcı × duck). Bu bir PROJEKSİYONdur:
 * native `CarosPlaybackService` de aynı çarpımı yapar (`applyEffectiveVolume`).
 */
export function getEffectiveVolume(): number {
  return computeEffectiveVolume({
    userVolume: _userVolume,
    duckLevel: effectiveDuckLevel(_duck),
    sourceNormalization: _sourceNormalization,
    muted: _muted,
  });
}

/**
 * MUSIC F19 · Kaynak seviye normalizasyonunu ayarlar.
 *
 * TEK YAZAR: `loudnessRuntime`. Değer bir KANITTAN gelir (ReplayGain/R128
 * etiketi veya F17 ölçümü) ve **yalnız KISAR** (≤ 1).
 *
 * Kullanıcı sesi (`_userVolume`) DEĞİŞMEZ — kullanıcı slider'ını nerede
 * bıraktıysa orada kalır; değişen yalnız kaynağa yazılan etkin değerdir.
 * Duck'a da DOKUNULMAZ: duck'ı native uygular (F6.1 çift-duck düzeltmesi).
 *
 * @returns değer gerçekten değiştiyse `true` (gereksiz native yazımı yok).
 */
export async function setSourceNormalization(factor: number): Promise<boolean> {
  const next = !Number.isFinite(factor) ? 1 : Math.max(0, Math.min(1, factor));
  if (Math.abs(next - _sourceNormalization) < 1e-6) return false;
  _sourceNormalization = next;
  await applyVolume();
  return true;
}

export function getSourceNormalization(): number { return _sourceNormalization; }

/**
 * MUSIC F20 · Parça sınırı geçiş politikasını native'e yazar.
 *
 * Bu bir SES KOMUTU DEĞİLDİR: çalma/duraklatma durumunu değiştirmez, kuyruğa
 * dokunmaz ve playback truth ÜRETMEZ. Yalnız oynatma sahibinin (native
 * servis) parça sınırında uygulayacağı kazanç rampasını bildirir.
 *
 * @returns native komutu KABUL ettiyse `true` (sahte başarı yok).
 */
export async function setTransitionPolicy(policy: {
  readonly fadeEnabled: boolean;
  readonly fadeOutMs: number;
  readonly fadeInMs: number;
}): Promise<boolean> {
  const res = await native.command('setTransitionPolicy', {
    fadeEnabled: policy.fadeEnabled === true,
    fadeOutMs: Math.max(0, Math.round(policy.fadeOutMs)),
    fadeInMs: Math.max(0, Math.round(policy.fadeInMs)),
  });
  return res.accepted;
}

/**
 * MUSIC F6.1 · ÇİFT DUCK DÜZELTMESİ.
 *
 * Native `setVolume` komutu `CarosPlaybackService.setUserVolume()`e düşer ve
 * orada saklanan alan açıkça **duck ÖNCESİ kullanıcı seviyesidir**; native
 * kendi duck çarpanını AYRICA uygular (`userVolume × duck`). Buraya
 * `getEffectiveVolume()` (duck DAHİL) yazılırsa duck İKİ KEZ uygulanır —
 * NAVIGATION duck'ında ses %30 yerine %9'a düşer.
 *
 * Bu yol üretimde ilk kez F6.1'de canlandı (öncesinde hiçbir üretim çağrısı
 * `duck()` yapmıyordu), kusur o yüzden sahada duyulmamıştı.
 *
 * Kural: **duck TEK KEZ, sahibi tarafından uygulanır.** JS tarafı yalnız
 * politika (`duckPolicy`) ve sebebi taşır; uygulayan native otoritedir.
 */
function nativeUserVolume(): number {
  /* MUSIC F19: kaynak normalizasyonu native'in BİLMEDİĞİ bir çarpandır
     (native yalnız `userVolume × duck` yapar) → buraya DAHİL edilir. Duck
     hâlâ dışarıda bırakılır: onu native uygular, iki kez uygulanmaz. */
  return computeEffectiveVolume({
    userVolume: _userVolume,
    duckLevel: 1,
    sourceNormalization: _sourceNormalization,
    muted: _muted,
  });
}

async function applyVolume(): Promise<void> {
  await native.command('setVolume', { volume: nativeUserVolume() });
}

/* ── Ducking (token tabanlı, nested) ─────────────────────────────────────── */

/**
 * Duck başlatır. @returns token (0 = kabul edilmedi).
 * TTS/navigasyon/Mavi bu token'ı SAKLAMALI ve bitişte aynısıyla bırakmalıdır.
 */
export async function duck(reason: DuckReason): Promise<number> {
  if (!isDuckReason(reason)) return 0;
  const res = applyDuck(_duck, reason);
  if (res.token === 0) return 0;
  _duck = res.state;
  // Native tarafta da aynı politika uygulanır (tek seviye, iki uygulayıcı değil).
  const nativeRes = await native.command('duck', { reason });
  if (nativeRes.accepted) _nativeDuckTokens.set(res.token, res.token);
  await applyVolume();
  return res.token;
}

/** Duck'ı yalnız kendi token'ıyla bırakır. BAYAT TOKEN SESİ YÜKSELTMEZ. */
export async function unduck(token: number): Promise<boolean> {
  const res = releaseDuck(_duck, token);
  if (!res.removed) return false;   // bayat/bilinmeyen token → etkisiz
  _duck = res.state;
  const nativeToken = _nativeDuckTokens.get(token);
  if (nativeToken !== undefined) {
    _nativeDuckTokens.delete(token);
    await native.command('unduck', { token: nativeToken });
  }
  await applyVolume();
  return true;
}

export function getActiveDuckReasons(): readonly DuckReason[] {
  return activeReasons(_duck);
}

/* ── Mavi / sesli asistan için dürüst ifade ──────────────────────────────── */

/**
 * Sesli cevabın hangi iddiayı kurabileceğini döner:
 *   PLAYING       — "çalıyor" denebilir (gözlendi)
 *   REQUEST_SENT  — "başlatma isteği gönderildi" (doğrulama yok)
 *   FAILED        — hata nedeniyle olmadı
 *   NOT_ATTEMPTED — komut hiç denenmedi (ör. desteklenmiyor)
 */
export function claimFor(truth: CommandTruth): HonestClaim {
  return honestClaim(truth);
}

/* ── Test kancaları ──────────────────────────────────────────────────────── */

export function __resetGatewayForTest(adapters?: Map<SourceClass, BackendAdapter>): void {
  _inFlight = 0;
  _duck = EMPTY_DUCK_STATE;
  _userVolume = 1;
  _muted = false;
  _sourceNormalization = 1;
  _sessionSeq = 0;
  _sessionId = 'media-session-0';
  _recentCommandIds.length = 0;
  _lastCanonicalCommand = null;
  _lastCanonicalResult = null;
  _nativeDuckTokens.clear();
  _coordinator = adapters
    ? createSourceCoordinator({ now, adapters })
    : null;
}
