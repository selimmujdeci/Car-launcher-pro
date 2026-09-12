/**
 * companionFoundation.test.tsx — PHONE-HUB P1-PREP KİLİTLERİ.
 *
 * ANA İLKELER (bozulursa kilit düşer):
 *  1. GERÇEK BAĞLANTI YOKTUR — uygulanmış tek taşıma MOCK'tur ve `realConnectionReady`
 *     DAİMA false'tur.
 *  2. Geçersiz durum geçişi REDDEDİLİR; sessiz sıçrama YOK.
 *  3. Protokol uyuşmazlığı bağlantıyı DÜŞÜRÜR; yetenek yokluğu DÜŞÜRMEZ.
 *  4. Bilinmeyen yetenek TAŞINIR ama ASLA `granted` sayılmaz (fail-closed).
 *  5. Bozuk/checksum-hatalı zarf bağlantıyı DÜŞÜRMEZ, sayaç artırır.
 *  6. Nesil (generation) kapısı bayat çağrıyı reddeder.
 *  7. Diskten dönen oturum "BAĞLI" olarak geri YÜKLENMEZ.
 *  8. Şifreleme/sıkıştırma UYGULANMAMIŞTIR ve `AES_GCM`/`GZIP` REDDEDİLİR.
 *  9. Hiçbir eylem yürütülebilir DEĞİLDİR (handler yok).
 * 10. Yasaklı bağlantı/komut/izin yüzeyine hiç dokunulmaz (statik tarama).
 * 11. PII ne modele, ne diske, ne olay yüküne sızar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  // durum makinesi
  transition, allowedActions, transitionTable, CONNECTION_STATES, CONNECTION_ACTIONS,
  canSendApplicationMessage, isActiveState, isRestingState, expectsHeartbeat, normalizeState,
  // oturum
  createPhoneHubSession, withStatus, withHeartbeat, withNegotiated, withNextGeneration,
  assessHeartbeat, isHandshakeTimedOut, isResumable, connectDurationMs,
  migratePhoneHubSession, demoteRestoredSession,
  HANDSHAKE_TIMEOUT_MS, HEARTBEAT_DEGRADE_MS, HEARTBEAT_LOSS_MS, SESSION_RESUME_WINDOW_MS,
  // yetenek
  createCompanionCapabilityRegistry, LOCALLY_SUPPORTED_CAPABILITIES,
  capabilityDigest, capabilitiesChanged, COMPANION_CAPABILITIES,
  // zarf
  buildEnvelope, buildRequest, buildResponse, buildAck, validateEnvelope, verifyChecksum,
  computeEnvelopeChecksum, matchesRequest, SUPPORTED_ENCRYPTION, SUPPORTED_COMPRESSION,
  // anlaşma
  negotiateProtocol, negotiateFeatures, buildHelloPayload, parseHelloPayload,
  LOCAL_PROTOCOL_RANGE, HELLO_PAYLOAD_TYPE,
  // eşleştirme
  derivePeerKeyHash, createKnownDevice, withUserTrust, withRevokedTrust, withSeen,
  isPairingAllowed, pairingDenialReason, upsertKnownDevice, findKnownDevice,
  migrateKnownDevices,
  // taşıma
  createMockTransport, createScenarioTransport, createUnimplementedTransport,
  MOCK_SCENARIOS, IMPLEMENTED_TRANSPORT_TYPES, COMPANION_TRANSPORT_TYPES,
  isTransportImplemented,
  // yönetici
  createCompanionSessionManager,
  // olaylar
  COMPANION_EVENTS, COMPANION_EVENT_NAMES, COMPANION_EVENT_CATALOG,
  createCompanionEventBridge,
  // eylemler
  COMPANION_ACTIONS, COMPANION_ACTION_IDS, registerCompanionActions,
  isCompanionActionExecutable, companionActionPrivacy,
  // telemetri
  createCompanionTelemetry, emptyTelemetrySnapshot,
  // kalıcılık
  saveCompanionSession, loadCompanionSession, saveKnownDevices, loadKnownDevices,
  saveCapabilityCache, loadCapabilityCache, saveCompanionTelemetry,
  clearCompanionStorage, companionStorageHealth, isDeniedStorageKey, sanitizeForStorage,
  COMPANION_KEY_SESSION, COMPANION_STORAGE_KEYS,
  // döküm
  dumpSession, dumpCapabilities, dumpTransport, dumpTelemetry, assessFoundation,
  type CompanionEnvelope, type PhoneHubSession,
} from '../platform/companion';
import { createPlatformEventBus, DEFAULT_EVENT_CATALOG } from '../platform/eventBus';
import { createActionRegistry } from '../platform/maviCore/actionRegistry';
import { readCompanionFoundationSnapshot } from '../platform/devtools/companionFoundationSources';
import { PhoneHubFieldValidationScreen } from '../components/devtools/screens/PhoneHubFieldValidationScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const T0 = 1_900_000_000_000;

const PII_MAC = 'AA:BB:CC:DD:EE:FF';
const PII_PHONE = '+905551234567';

/** Enjekte edilebilir saat — modüller `Date.now()` çağırmaz. */
function makeClock(start = T0): { now: () => number; advance: (ms: number) => void; set: (v: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    set: (v: number) => { t = v; },
  };
}

/** Deterministik kimlik üreteci — ÖN EK BAŞINA sayaç (msg-1, msg-2, phs-1…). */
function makeIds(): (p: string) => string {
  const counters = new Map<string, number>();
  return (p: string) => {
    const n = (counters.get(p) ?? 0) + 1;
    counters.set(p, n);
    return `${p}-${n}`;
  };
}

/** Karşı tarafın el sıkışma yanıtı. */
function peerHello(
  nowMs: number,
  caps: readonly string[],
  correlationId: string,
  proto: { min: number; max: number } = { min: 1, max: 1 },
  role = 'PHONE',
): CompanionEnvelope {
  return buildEnvelope({
    messageId: `peer-${nowMs}`,
    nowMs,
    kind: 'RESPONSE',
    payloadType: HELLO_PAYLOAD_TYPE,
    payloadVersion: 1,
    payload: { protocol: proto, capabilities: [...caps], role, peerKeyHash: 'deadbeef' },
    correlationId,
    ack: false,
  });
}

interface Harness {
  readonly clock: ReturnType<typeof makeClock>;
  readonly transport: ReturnType<typeof createMockTransport>;
  readonly manager: ReturnType<typeof createCompanionSessionManager>;
  readonly bus: ReturnType<typeof createPlatformEventBus>;
  readonly seen: { name: string; payload: unknown }[];
}

function harness(opts: { locallySupported?: readonly ('MEDIA')[] } = {}): Harness {
  const clock = makeClock();
  const transport = createMockTransport({ adapterId: 'test-1' });
  const bus = createPlatformEventBus();
  const seen: { name: string; payload: unknown }[] = [];
  bus.subscribeDomain('companion', (e) => { seen.push({ name: e.name, payload: e.payload }); });

  const manager = createCompanionSessionManager({
    transport,
    now: clock.now,
    newId: makeIds(),
    bus,
    locallySupported: opts.locallySupported,
  });
  return { clock, transport, manager, bus, seen };
}

/** Başarılı bağlantıya kadar sür. Karşı taraf `caps` beyan eder. */
function connect(h: Harness, caps: readonly string[] = ['MEDIA', 'CALLS']): void {
  h.manager.beginSession('deadbeef');
  h.transport.queue({ kind: 'OPEN_OK' });
  h.transport.step(h.clock.now());
  h.manager.openTransport();
  h.transport.deliver(peerHello(h.clock.now(), caps, 'msg-1'), h.clock.now());
  h.manager.pump();
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — DURUM MAKİNESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — durum makinesi geçersiz geçişe izin vermez', () => {
  it('mutlu yol: IDLE → CONNECTING → NEGOTIATING → CONNECTED', () => {
    expect(transition('IDLE', 'OPEN').next).toBe('CONNECTING');
    expect(transition('CONNECTING', 'NEGOTIATE').next).toBe('NEGOTIATING');
    expect(transition('NEGOTIATING', 'NEGOTIATED').next).toBe('CONNECTED');
  });

  it('geçersiz geçiş REDDEDİLİR ve durum KORUNUR (sessiz sıçrama yok)', () => {
    const r = transition('IDLE', 'NEGOTIATED');
    expect(r.ok).toBe(false);
    expect(r.next).toBe('IDLE');
    expect(r.error).toBe('INVALID_STATE_TRANSITION');

    expect(transition('CONNECTED', 'NEGOTIATED').ok).toBe(false);
    expect(transition('IDLE', 'RECOVER').ok).toBe(false);
    expect(transition('FAILED', 'NEGOTIATE').ok).toBe(false);
  });

  it('bilinmeyen durum/eylem fail-closed (throw YOK)', () => {
    expect(() => transition('WAT', 'OPEN')).not.toThrow();
    expect(transition('WAT', 'OPEN').ok).toBe(false);
    expect(transition('IDLE', 'HACK').ok).toBe(false);
    expect(transition(null, null).ok).toBe(false);
    expect(normalizeState('nonsense')).toBe('IDLE');
  });

  it('kasıtlı kapatma ile beklenmeyen kayıp KARIŞTIRILMAZ', () => {
    /* CLOSE → DISCONNECTED (otomatik yeniden bağlanma YOK) */
    expect(transition('CONNECTED', 'CLOSE').next).toBe('DISCONNECTED');
    /* LOSE → RECONNECTING (kayıp yeniden bağlanma tetikler) */
    expect(transition('CONNECTED', 'LOSE').next).toBe('RECONNECTING');
  });

  it('yetenek değişimi için CONNECTED/DEGRADED → NEGOTIATING açıktır', () => {
    expect(transition('CONNECTED', 'NEGOTIATE').next).toBe('NEGOTIATING');
    expect(transition('DEGRADED', 'NEGOTIATE').next).toBe('NEGOTIATING');
  });

  it('RESET her durumdan IDLE\'a döner', () => {
    for (const s of CONNECTION_STATES) {
      expect(transition(s, 'RESET').next).toBe('IDLE');
    }
  });

  it('gönderim kapısı YALNIZ CONNECTED/DEGRADED', () => {
    for (const s of CONNECTION_STATES) {
      const expected = s === 'CONNECTED' || s === 'DEGRADED';
      expect(canSendApplicationMessage(s)).toBe(expected);
      expect(expectsHeartbeat(s)).toBe(expected);
    }
    /* NEGOTIATING sırasında bile uygulama mesajı gönderilmez */
    expect(canSendApplicationMessage('NEGOTIATING')).toBe(false);
  });

  it('aktif/dinlenme sınıflandırması kesişmez', () => {
    for (const s of CONNECTION_STATES) {
      expect(isActiveState(s)).toBe(!isRestingState(s));
    }
  });

  it('geçiş tablosu deterministik ve tam listelenir', () => {
    const table = transitionTable();
    expect(table.length).toBeGreaterThan(20);
    for (const row of table) {
      expect(CONNECTION_STATES).toContain(row.from);
      expect(CONNECTION_ACTIONS).toContain(row.action);
      expect(CONNECTION_STATES).toContain(row.to);
    }
    expect(allowedActions('IDLE')).toContain('OPEN');
    expect(allowedActions('IDLE')).not.toContain('NEGOTIATED');
    expect(allowedActions('nonsense')).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — OTURUM
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — oturum modeli sahte değer üretmez', () => {
  it('yeni oturumda hiçbir şey VARSAYILMAZ', () => {
    const s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    expect(s.protocolVersion).toBeNull();
    expect(s.capabilities).toEqual([]);
    expect(s.transportType).toBe('UNKNOWN');
    expect(s.deviceRole).toBe('UNKNOWN');
    expect(s.status).toBe('IDLE');
    expect(s.connectedAt).toBeNull();
    expect(s.lastSeen).toBeNull();
    expect(s.generation).toBe(1);
    expect(connectDurationMs(s)).toBeNull();
  });

  it('connectedAt İLK CONNECTED\'da yazılır, toparlanmada KORUNUR', () => {
    let s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    s = withStatus(s, 'CONNECTED', T0 + 500);
    expect(s.connectedAt).toBe(T0 + 500);
    s = withStatus(s, 'DEGRADED', T0 + 900);
    s = withStatus(s, 'CONNECTED', T0 + 1200);
    expect(s.connectedAt).toBe(T0 + 500);
    expect(connectDurationMs(s)).toBe(500);
  });

  it('lastSeen GERİLETİLMEZ (saat sıçraması)', () => {
    let s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    s = withHeartbeat(s, T0 + 1000);
    s = withHeartbeat(s, T0 - 5000);
    expect(s.lastSeen).toBe(T0 + 1000);
  });

  it('kalp atışı hükmü: damga yoksa UNKNOWN, negatif yaş UNKNOWN', () => {
    const s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    expect(assessHeartbeat(s, T0 + 999_999)).toBe('UNKNOWN');
    const beat = withHeartbeat(s, T0);
    expect(assessHeartbeat(beat, T0 - 1000)).toBe('UNKNOWN');
    expect(assessHeartbeat(beat, T0 + 1000)).toBe('OK');
    expect(assessHeartbeat(beat, T0 + HEARTBEAT_DEGRADE_MS)).toBe('DEGRADED');
    expect(assessHeartbeat(beat, T0 + HEARTBEAT_LOSS_MS)).toBe('LOST');
  });

  it('el sıkışma zaman aşımı yalnız el sıkışırken anlamlıdır', () => {
    let s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    s = withStatus(s, 'CONNECTING', T0);
    expect(isHandshakeTimedOut(s, T0 + HANDSHAKE_TIMEOUT_MS + 1)).toBe(true);
    const connected = withStatus(withHeartbeat(s, T0), 'CONNECTED', T0);
    expect(isHandshakeTimedOut(connected, T0 + HANDSHAKE_TIMEOUT_MS + 1)).toBe(false);
  });

  it('yeni nesil eski ANLAŞMAYI SIFIRLAR (sahte yetenek taşınmaz)', () => {
    let s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    s = withNegotiated(s, 1, ['MEDIA'], 'PHONE');
    expect(s.capabilities).toEqual(['MEDIA']);
    s = withNextGeneration(s);
    expect(s.generation).toBe(2);
    expect(s.capabilities).toEqual([]);
    expect(s.protocolVersion).toBeNull();
  });

  it('resume penceresi dışındaki oturum yeniden kullanılmaz', () => {
    const s = withHeartbeat(createPhoneHubSession({ sessionId: 'a', nowMs: T0 }), T0);
    expect(isResumable(s, T0 + 1000)).toBe(true);
    expect(isResumable(s, T0 + SESSION_RESUME_WINDOW_MS + 1)).toBe(false);
    expect(isResumable(null, T0)).toBe(false);
  });

  it('DİSKTEN dönen oturum "BAĞLI" olarak geri YÜKLENMEZ', () => {
    let s = createPhoneHubSession({ sessionId: 'a', nowMs: T0 });
    s = withNegotiated(withStatus(s, 'CONNECTED', T0), 1, ['MEDIA'], 'PHONE');
    const restored = demoteRestoredSession(s);
    expect(restored.status).toBe('DISCONNECTED');
    expect(restored.generation).toBe(s.generation + 1);
    expect(restored.capabilities).toEqual([]);
    expect(restored.protocolVersion).toBeNull();
  });

  it('göç: bozuk gövde fail-soft, tanınamayan null', () => {
    expect(migratePhoneHubSession(null)).toBeNull();
    expect(migratePhoneHubSession({ noId: 1 })).toBeNull();
    const m = migratePhoneHubSession({
      sessionId: 'x', status: 'BOGUS', transportType: 'TELEPATHY',
      deviceRole: 'ALIEN', protocolVersion: -5, generation: 'abc',
      capabilities: ['MEDIA', 42, 'WEIRD_ONE'], connectedAt: 0,
    })!;
    expect(m.status).toBe('IDLE');
    expect(m.transportType).toBe('UNKNOWN');
    expect(m.deviceRole).toBe('UNKNOWN');
    expect(m.protocolVersion).toBeNull();
    expect(m.generation).toBe(1);
    expect(m.connectedAt).toBeNull();
    expect(m.capabilities).toEqual(['MEDIA', 'WEIRD_ONE']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — YETENEK DEFTERİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — bilinmeyen yetenek taşınır, ASLA granted olmaz', () => {
  it('yerel destek listesi bilinçli olarak BOŞ → granted daima boş', () => {
    expect(LOCALLY_SUPPORTED_CAPABILITIES).toEqual([]);
    const reg = createCompanionCapabilityRegistry();
    const snap = reg.applyDeclaration([...COMPANION_CAPABILITIES], 1);
    expect(snap.granted).toEqual([]);
    expect(snap.unsupported.length).toBe(COMPANION_CAPABILITIES.length);
  });

  it('bilinmeyen jeton UNKNOWN listesinde taşınır, granted DEĞİL', () => {
    const reg = createCompanionCapabilityRegistry({ locallySupported: ['MEDIA'] });
    const snap = reg.applyDeclaration(['MEDIA', 'FUTURE_THING', 'CALLS'], 3);
    expect(snap.granted).toEqual(['MEDIA']);
    expect(snap.unknown).toEqual(['FUTURE_THING']);
    expect(snap.unsupported).toEqual(['CALLS']);
    expect(reg.isGranted('FUTURE_THING')).toBe(false);
    expect(reg.isGranted('MEDIA')).toBe(true);
    expect(reg.generation).toBe(3);
  });

  it('geçersiz jeton REDDEDİLİR ve sayılır', () => {
    const reg = createCompanionCapabilityRegistry();
    const snap = reg.applyDeclaration(['MEDIA', '', 42, 'lowercase', null, 'X'.repeat(99)], 1);
    expect(snap.rejectedTokenCount).toBeGreaterThanOrEqual(4);
    expect(snap.unsupported).toEqual(['MEDIA']);
  });

  it('yeni beyan ESKİ kaydı TAMAMEN değiştirir (kaybedilen yetenek kalmaz)', () => {
    const reg = createCompanionCapabilityRegistry({ locallySupported: ['MEDIA'] });
    reg.applyDeclaration(['MEDIA'], 1);
    expect(reg.isGranted('MEDIA')).toBe(true);
    reg.applyDeclaration(['CALLS'], 2);
    expect(reg.isGranted('MEDIA')).toBe(false);
    expect(reg.has('MEDIA')).toBe(false);
  });

  it('özet nesli İÇERMEZ → yeniden bağlanma sahte "değişti" üretmez', () => {
    const a = capabilityDigest(['MEDIA'], ['CALLS'], []);
    const b = capabilityDigest(['MEDIA'], ['CALLS'], []);
    expect(a).toBe(b);
    expect(capabilitiesChanged({ digest: a } as never, { digest: b } as never)).toBe(false);
    expect(capabilitiesChanged({ digest: a } as never, { digest: 'other' } as never)).toBe(true);
  });

  it('defter bounded ve throw etmez', () => {
    const reg = createCompanionCapabilityRegistry();
    const many = Array.from({ length: 200 }, (_, i) => `UNKNOWN_${i}`);
    expect(() => reg.applyDeclaration(many, 1)).not.toThrow();
    const snap = reg.snapshot();
    expect(snap.unknown.length).toBeLessThanOrEqual(32);
    expect(snap.truncated).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — ZARF
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — zarf sağlaması ve fail-closed doğrulama', () => {
  it('kurulan zarf geçerlidir ve sağlaması doğrulanır', () => {
    const env = buildRequest('m1', T0, 'test.type', { a: 1 });
    expect(validateEnvelope(env).ok).toBe(true);
    expect(verifyChecksum(env)).toBe(true);
    expect(env.correlationId).toBe('m1');
    expect(env.ack).toBe(true);
  });

  it('sağlama toplamı ANAHTAR SIRASINDAN bağımsızdır (kararlı JSON)', () => {
    const a = buildEnvelope({ messageId: 'm', nowMs: T0, kind: 'EVENT', payloadType: 't', payload: { x: 1, y: 2 } });
    const b = buildEnvelope({ messageId: 'm', nowMs: T0, kind: 'EVENT', payloadType: 't', payload: { y: 2, x: 1 } });
    expect(a.checksum).toBe(b.checksum);
  });

  it('yük DEĞİŞTİRİLİRSE checksum uyuşmaz', () => {
    const env = buildRequest('m1', T0, 'test.type', { a: 1 });
    const tampered = { ...env, payload: { a: 2 } };
    expect(verifyChecksum(tampered)).toBe(false);
    expect(validateEnvelope(tampered).errors).toContain('CHECKSUM_MISMATCH');
  });

  it('ŞİFRELEME ve SIKIŞTIRMA uygulanmamıştır → reddedilir', () => {
    expect(SUPPORTED_ENCRYPTION).toEqual(['NONE']);
    expect(SUPPORTED_COMPRESSION).toEqual(['NONE']);
    const enc = buildEnvelope({
      messageId: 'm', nowMs: T0, kind: 'EVENT', payloadType: 't', encryption: 'AES_GCM',
    });
    expect(validateEnvelope(enc).errors).toContain('ENCRYPTION_UNSUPPORTED');
    const gz = buildEnvelope({
      messageId: 'm', nowMs: T0, kind: 'EVENT', payloadType: 't', compression: 'GZIP',
    });
    expect(validateEnvelope(gz).errors).toContain('COMPRESSION_UNSUPPORTED');
  });

  it('şema sürümü farklıysa SESSİZCE kabul edilmez', () => {
    const env = buildRequest('m1', T0, 't');
    const future = { ...env, schemaVersion: 99 };
    const v = validateEnvelope({ ...future, checksum: computeEnvelopeChecksum(future) });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('ENVELOPE_SCHEMA_UNSUPPORTED');
  });

  it('yük tavanı aşılırsa REDDEDİLİR (sessiz kırpma YOK)', () => {
    const big = { blob: 'x'.repeat(20_000) };
    const env = buildEnvelope({ messageId: 'm', nowMs: T0, kind: 'EVENT', payloadType: 't', payload: big });
    expect(validateEnvelope(env).errors).toContain('PAYLOAD_TOO_LARGE');
  });

  it('bozuk girdi throw ETMEZ ve tüm hataları toplar', () => {
    expect(() => validateEnvelope(null)).not.toThrow();
    expect(validateEnvelope(null).errors).toContain('ENVELOPE_MALFORMED');
    expect(validateEnvelope('nope').ok).toBe(false);
    expect(validateEnvelope({}).ok).toBe(false);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => validateEnvelope({ payload: cyc })).not.toThrow();
  });

  it('ACK yük TAŞIMAZ ve isteğe bağlanır', () => {
    const req = buildRequest('m1', T0, 't', { a: 1 });
    const ack = buildAck('m2', T0 + 5, req);
    expect(ack.payload).toBeNull();
    expect(validateEnvelope(ack).ok).toBe(true);
    expect(matchesRequest(req, ack)).toBe(true);
  });

  it('yanıt YANLIŞ isteğe eşlenmez', () => {
    const r1 = buildRequest('m1', T0, 't');
    const r2 = buildRequest('m2', T0, 't');
    const resp = buildResponse('m3', T0 + 1, r1, 't.resp');
    expect(matchesRequest(r1, resp)).toBe(true);
    expect(matchesRequest(r2, resp)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — ANLAŞMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — protokol uyuşmazlığı FAIL, yetenek yokluğu değil', () => {
  it('kesişimde EN YÜKSEK ortak sürüm seçilir', () => {
    /* İmza: negotiateProtocol(remote, local). Kesişim [2,3] → en yükseği 3. */
    const r = negotiateProtocol({ min: 1, max: 3 }, { min: 2, max: 5 });
    expect(r.ok).toBe(true);
    expect(r.agreed).toBe(3);
    /* Ters yön aynı sonucu verir (simetri). */
    expect(negotiateProtocol({ min: 2, max: 5 }, { min: 1, max: 3 }).agreed).toBe(3);
  });

  it('kesişim boşsa REDDEDİLİR — downgrade YAPILMAZ', () => {
    const r = negotiateProtocol({ min: 5, max: 9 }, { min: 1, max: 2 });
    expect(r.ok).toBe(false);
    expect(r.agreed).toBeNull();
    expect(r.error).toBe('PROTOCOL_VERSION_MISMATCH');
  });

  it('okunamayan karşı beyan uyuşmazlık sayılır (fail-closed)', () => {
    for (const bad of [null, {}, { min: 'a', max: 2 }, { min: 3, max: 1 }, { min: 0, max: 0 }]) {
      expect(negotiateProtocol(bad).ok).toBe(false);
    }
  });

  it('yetenek kesişimi: bilinmeyen granted olmaz, boş kesişim HATA DEĞİL', () => {
    const r = negotiateFeatures(['MEDIA', 'CALLS', 'FUTURE'], ['MEDIA']);
    expect(r.granted).toEqual(['MEDIA']);
    expect(r.remoteOnly).toEqual(['CALLS']);
    expect(r.unknownRemote).toEqual(['FUTURE']);
    const empty = negotiateFeatures(['CALLS'], []);
    expect(empty.granted).toEqual([]);
    expect(empty.remoteOnly).toEqual(['CALLS']);
  });

  it('hello yükü PII alanı İÇERMEZ ve tur-gidiş dayanıklıdır', () => {
    const p = buildHelloPayload(['MEDIA'], 'PHONE', 'deadbeef');
    const json = JSON.stringify(p);
    expect(json).not.toContain(PII_MAC);
    expect(json).not.toMatch(/name|model|address|mac/i);
    const parsed = parseHelloPayload(p);
    expect(parsed.ok).toBe(true);
    expect(parsed.capabilities).toEqual(['MEDIA']);
    expect(parsed.protocol).toEqual({ min: LOCAL_PROTOCOL_RANGE.min, max: LOCAL_PROTOCOL_RANGE.max });
    expect(parseHelloPayload('garbage').ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — EŞLEŞTİRME (YEREL GÜVEN)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — eşleştirme fail-closed ve PII\'siz', () => {
  it('ham kimlik SAKLANMAZ, yalnız geri çevrilemez karma', () => {
    const key = derivePeerKeyHash(PII_MAC)!;
    expect(key).not.toContain('AA');
    expect(key).toHaveLength(8);
    expect(derivePeerKeyHash(PII_MAC)).toBe(key);
    expect(derivePeerKeyHash('')).toBeNull();
    expect(derivePeerKeyHash(null)).toBeNull();
  });

  it('bağlanma izni YALNIZ kullanıcı onayıyla açılır', () => {
    let rec = createKnownDevice('abcd1234', T0);
    expect(rec.trust).toBe('SEEN');
    expect(isPairingAllowed(rec)).toBe(false);
    expect(pairingDenialReason(rec)).toBe('PAIRING_NOT_TRUSTED');
    expect(pairingDenialReason(null)).toBe('PAIRING_RECORD_MISSING');

    rec = withUserTrust(rec, T0 + 10);
    expect(isPairingAllowed(rec)).toBe(true);
    rec = withRevokedTrust(rec);
    expect(isPairingAllowed(rec)).toBe(false);
    expect(rec.trustedAt).toBeNull();
  });

  it('görülme damgası GERİLETİLMEZ', () => {
    const rec = withSeen(createKnownDevice('abcd1234', T0), T0 - 5000);
    expect(rec.lastSeenAt).toBe(T0);
  });

  it('defter bounded; güvenilir kayıt önce atılmaz', () => {
    let list: readonly ReturnType<typeof createKnownDevice>[] = [];
    const trusted = withUserTrust(createKnownDevice('trusted1', T0), T0);
    list = upsertKnownDevice(list, trusted);
    for (let i = 0; i < 20; i++) {
      list = upsertKnownDevice(list, createKnownDevice(`dev${i}`, T0 + i));
    }
    expect(list.length).toBeLessThanOrEqual(8);
    expect(findKnownDevice(list, 'trusted1')).not.toBeNull();
  });

  it('göç: TRUSTED olmayan kayıtta onay damgası TAŞINMAZ', () => {
    const list = migrateKnownDevices([
      { peerKeyHash: 'a', trust: 'SEEN', trustedAt: 12345 },
      { noKey: true },
      { peerKeyHash: 'b', trust: 'TRUSTED', trustedAt: 999 },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].trustedAt).toBeNull();
    expect(list[1].trustedAt).toBe(999);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 7 — TAŞIMA SÖZLEŞMESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — yalnız MOCK uygulanmıştır', () => {
  it('9 taşıma beyan edildi, 1\'i uygulandı', () => {
    expect(COMPANION_TRANSPORT_TYPES).toHaveLength(9);
    expect(IMPLEMENTED_TRANSPORT_TYPES).toEqual(['MOCK']);
    for (const t of COMPANION_TRANSPORT_TYPES) {
      expect(isTransportImplemented(t)).toBe(t === 'MOCK');
    }
  });

  it('uygulanmamış taşıma DÜRÜSTÇE reddeder, throw ETMEZ', () => {
    const t = createUnimplementedTransport('BLE');
    expect(t.open().error).toBe('TRANSPORT_NOT_IMPLEMENTED');
    expect(t.send({} as CompanionEnvelope).error).toBe('TRANSPORT_NOT_IMPLEMENTED');
    expect(t.poll()).toEqual([]);
    expect(t.describe().implemented).toBe(false);
    /* Kapatma idempotenttir ve HATA DEĞİLDİR */
    expect(t.close().ok).toBe(true);
    expect(t.close().ok).toBe(true);
  });

  it('mock taşıma kapalıyken göndermez, poll TÜKETİR', () => {
    const t = createMockTransport();
    expect(t.send(buildRequest('m', T0, 't')).error).toBe('TRANSPORT_UNAVAILABLE');
    t.queue({ kind: 'OPEN_OK' });
    t.step(T0);
    expect(t.open().ok).toBe(true);
    t.deliver({ hello: 1 }, T0);
    expect(t.poll()).toHaveLength(1);
    expect(t.poll()).toHaveLength(0);       // tüketildi
  });

  it('close İDEMPOTENT ve kuyrukları bırakır (zero-leak)', () => {
    const t = createMockTransport();
    t.open();
    t.deliver({ a: 1 }, T0);
    expect(t.close().ok).toBe(true);
    expect(t.close().ok).toBe(true);
    expect(t.status().inboundQueued).toBe(0);
    expect(t.status().writable).toBe(false);
  });

  it('yedi senaryonun tamamı için betik vardır', () => {
    expect(MOCK_SCENARIOS).toHaveLength(7);
    for (const name of MOCK_SCENARIOS) {
      const t = createScenarioTransport(name);
      expect(t.runAll(T0)).toBeGreaterThan(0);
    }
  });

  it('mock adapter sınırlarını AÇIKÇA beyan eder', () => {
    const d = createMockTransport().describe();
    expect(d.limitations).toContain('NO_REAL_LINK');
    expect(d.limitations).toContain('NO_ENCRYPTION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 8 — ENTEGRASYON: YEDİ SENARYO
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — uçtan uca senaryolar (mock taşıma)', () => {
  it('SENARYO 1 — başarılı bağlantı', () => {
    const h = harness({ locallySupported: ['MEDIA'] });
    connect(h, ['MEDIA', 'CALLS', 'FUTURE_X']);

    expect(h.manager.state).toBe('CONNECTED');
    expect(h.manager.session!.protocolVersion).toBe(1);
    expect(h.manager.session!.deviceRole).toBe('PHONE');
    expect(h.manager.capabilitySnapshot()!.granted).toEqual(['MEDIA']);
    expect(h.manager.capabilitySnapshot()!.unknown).toEqual(['FUTURE_X']);

    const t = h.manager.telemetry.snapshot();
    expect(t.connectionAttempts).toBe(1);
    expect(t.successfulConnects).toBe(1);

    const names = h.seen.map((e) => e.name);
    expect(names).toContain(COMPANION_EVENTS.PHONE_SESSION_CREATED);
    expect(names).toContain(COMPANION_EVENTS.PHONE_CONNECTED);
    expect(names).toContain(COMPANION_EVENTS.PHONE_CAPABILITIES_UPDATED);
  });

  it('SENARYO 2 — el sıkışma zaman aşımı → FAILED', () => {
    const h = harness();
    h.manager.beginSession();
    h.transport.queue({ kind: 'OPEN_OK' });
    h.transport.step(h.clock.now());
    h.manager.openTransport();
    expect(h.manager.state).toBe('NEGOTIATING');

    h.clock.advance(HANDSHAKE_TIMEOUT_MS + 1);
    const r = h.manager.tick();
    expect(r.state).toBe('FAILED');
    expect(r.errors).toContain('HANDSHAKE_TIMEOUT');
    expect(h.seen.some((e) => e.name === COMPANION_EVENTS.PHONE_ERROR)).toBe(true);
  });

  it('SENARYO 3 — kalp atışı kaybı: DEGRADED sonra RECONNECTING', () => {
    const h = harness();
    connect(h);
    expect(h.manager.state).toBe('CONNECTED');

    h.clock.advance(HEARTBEAT_DEGRADE_MS + 1);
    expect(h.manager.tick().state).toBe('DEGRADED');

    h.clock.advance(HEARTBEAT_LOSS_MS);
    const lost = h.manager.tick();
    expect(lost.state).toBe('RECONNECTING');
    expect(lost.errors).toContain('HEARTBEAT_TIMEOUT');
    expect(h.manager.telemetry.snapshot().heartbeatLoss).toBe(1);
  });

  it('SENARYO 4 — yetenek değişimi YENİDEN ANLAŞMA tetikler', () => {
    const h = harness({ locallySupported: ['MEDIA'] });
    connect(h, ['MEDIA']);
    const first = h.seen.filter((e) => e.name === COMPANION_EVENTS.PHONE_CAPABILITIES_UPDATED).length;
    expect(first).toBe(1);

    /* Karşı taraf MEDIA'yı kaybetti, CALLS ekledi */
    h.clock.advance(100);
    h.transport.deliver(peerHello(h.clock.now(), ['CALLS'], 'msg-x'), h.clock.now());
    h.manager.pump();

    expect(h.manager.state).toBe('CONNECTED');
    expect(h.manager.capabilitySnapshot()!.granted).toEqual([]);
    expect(h.manager.isDisposed).toBe(false);
    const after = h.seen.filter((e) => e.name === COMPANION_EVENTS.PHONE_CAPABILITIES_UPDATED).length;
    expect(after).toBe(2);
  });

  it('SENARYO 5 — yeniden bağlanma nesli artırır ve yetenekleri sıfırlar', () => {
    const h = harness({ locallySupported: ['MEDIA'] });
    connect(h, ['MEDIA']);
    const gen1 = h.manager.generation;
    expect(h.manager.capabilitySnapshot()!.granted).toEqual(['MEDIA']);

    /* Bağlantı koptu */
    h.clock.advance(HEARTBEAT_LOSS_MS + 1);
    h.manager.tick();
    expect(h.manager.state).toBe('RECONNECTING');

    h.transport.queue({ kind: 'RESTORE' });
    h.transport.step(h.clock.now());
    h.manager.reconnect();

    expect(h.manager.generation).toBe(gen1 + 1);
    expect(h.manager.capabilitySnapshot()).toBeNull();
    expect(h.manager.telemetry.snapshot().reconnectCount).toBe(1);
  });

  it('SENARYO 6 — protokol uyuşmazlığı bağlantıyı DÜŞÜRÜR', () => {
    const h = harness();
    h.manager.beginSession();
    h.transport.queue({ kind: 'OPEN_OK' });
    h.transport.step(h.clock.now());
    h.manager.openTransport();

    h.transport.deliver(
      peerHello(h.clock.now(), ['MEDIA'], 'msg-1', { min: 7, max: 9 }), h.clock.now());
    const r = h.manager.pump();

    expect(r.errors).toContain('PROTOCOL_VERSION_MISMATCH');
    expect(h.manager.state).toBe('FAILED');
    expect(h.manager.telemetry.snapshot().protocolMismatch).toBe(1);
  });

  it('SENARYO 7 — checksum hatası bağlantıyı DÜŞÜRMEZ, sayaç artar', () => {
    const h = harness();
    h.manager.beginSession();
    h.transport.queue({ kind: 'OPEN_OK' });
    h.transport.step(h.clock.now());
    h.manager.openTransport();

    const good = peerHello(h.clock.now(), ['MEDIA'], 'msg-1');
    h.transport.deliver({ ...good, payload: { tampered: true } }, h.clock.now());
    const r = h.manager.pump();

    expect(r.rejected).toBe(1);
    expect(r.errors).toContain('CHECKSUM_MISMATCH');
    expect(h.manager.telemetry.snapshot().checksumFailure).toBe(1);
    /* KRİTİK: tek bozuk mesaj oturumu KAPATMAZ */
    expect(h.manager.state).toBe('NEGOTIATING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 9 — GÖNDERİM KAPILARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — gönderim iki kapıdan geçer', () => {
  it('bağlı değilken uygulama mesajı GÖNDERİLMEZ', () => {
    const h = harness();
    h.manager.beginSession();
    const r = h.manager.send('test.type', { a: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('SESSION_NOT_ACTIVE');
  });

  it('BAYAT nesille gönderim REDDEDİLİR', () => {
    const h = harness();
    connect(h);
    const gen = h.manager.generation;
    expect(h.manager.send('t', { a: 1 }, gen).ok).toBe(true);
    const stale = h.manager.send('t', { a: 1 }, gen - 1);
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe('SESSION_GENERATION_STALE');
  });

  it('kendi zarfımız geçersizse GÖNDERMEYİZ ve "gönderdim" DEMEYİZ', () => {
    const h = harness();
    connect(h);
    const before = h.transport.status().sentCount;
    const r = h.manager.send('t', { blob: 'x'.repeat(20_000) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('PAYLOAD_TOO_LARGE');
    expect(h.transport.status().sentCount).toBe(before);
  });

  it('taşıma gönderimi düşerse telemetri sayar', () => {
    const h = harness();
    connect(h);
    h.transport.queue({ kind: 'DROP_SEND' });
    h.transport.step(h.clock.now());
    const r = h.manager.send('t', { a: 1 });
    expect(r.ok).toBe(false);
    expect(h.manager.telemetry.snapshot().sendFailures).toBeGreaterThan(0);
  });

  it('oturum yoksa pump/tick fail-soft', () => {
    const h = harness();
    expect(h.manager.pump().errors).toContain('SESSION_NOT_ACTIVE');
    expect(h.manager.tick().errors).toContain('SESSION_NOT_ACTIVE');
  });

  it('dispose İDEMPOTENT ve sonrası no-op (zero-leak)', () => {
    const h = harness();
    connect(h);
    h.manager.dispose();
    h.manager.dispose();
    expect(h.manager.isDisposed).toBe(true);
    expect(h.manager.send('t').ok).toBe(false);
    expect(h.manager.beginSession().ok).toBe(false);
    expect(h.transport.status().writable).toBe(false);
  });

  it('geçersiz geçiş denemesi telemetriye yazılır', () => {
    const h = harness();
    connect(h);
    /* CONNECTED durumdan RECOVER geçersizdir */
    h.clock.advance(10);
    h.manager.tick();  // OK, hiçbir şey yapmaz
    const before = h.manager.telemetry.snapshot().invalidTransitions;
    h.manager.openTransport();  // CONNECTED'dan OPEN geçersiz
    expect(h.manager.telemetry.snapshot().invalidTransitions).toBeGreaterThan(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 10 — EVENT BUS
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — Event Bus entegrasyonu, doğrudan bağımlılık YOK', () => {
  it('yedi olay katalogda kayıtlı ve companion alanına çözülür', () => {
    expect(COMPANION_EVENT_NAMES).toHaveLength(7);
    const catalogNames = new Set(DEFAULT_EVENT_CATALOG.map((e) => e.name));
    for (const name of COMPANION_EVENT_NAMES) {
      expect(catalogNames.has(name)).toBe(true);
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);
    }
    for (const entry of COMPANION_EVENT_CATALOG) {
      expect(entry.domain).toBe('companion');
    }
  });

  it('yayınlanan olayın domain\'i companion olur', () => {
    const bus = createPlatformEventBus();
    const got: string[] = [];
    bus.subscribeDomain('companion', (e) => { got.push(e.domain); });
    const bridge = createCompanionEventBridge(bus);
    bridge.error({ sessionId: 's', generation: 1, code: 'UNKNOWN', state: 'IDLE' }, T0);
    expect(got).toEqual(['companion']);
  });

  it('bus YOKSA companion akışı ÇÖKMEZ (fail-soft)', () => {
    const bridge = createCompanionEventBridge(null);
    expect(() => bridge.heartbeat({ sessionId: 's', generation: 1, ageMs: null, verdict: 'OK' }, T0)).not.toThrow();
    expect(bridge.status().droppedCount).toBe(1);
    expect(bridge.status().publishedCount).toBe(0);
  });

  it('bus PATLARSA yayın yutulur ve sayaç artar', () => {
    const bad = { publish: () => { throw new Error('boom'); } };
    const bridge = createCompanionEventBridge(bad);
    expect(() => bridge.connected({
      sessionId: 's', generation: 1, transportType: 'MOCK',
      deviceRole: 'PHONE', status: 'CONNECTED', protocolVersion: 1,
    }, T0)).not.toThrow();
    expect(bridge.status().droppedCount).toBe(1);
  });

  it('dispose sonrası yayın no-op', () => {
    const bus = createPlatformEventBus();
    const bridge = createCompanionEventBridge(bus);
    bridge.dispose();
    bridge.dispose();
    bridge.sessionCreated({
      sessionId: 's', generation: 1, transportType: 'MOCK',
      deviceRole: 'UNKNOWN', status: 'IDLE', protocolVersion: null,
    }, T0);
    expect(bridge.status().publishedCount).toBe(0);
    expect(bridge.isDisposed).toBe(true);
  });

  it('olay yüklerinde mesaj İÇERİĞİ ve PII YOK', () => {
    const h = harness();
    connect(h);
    h.manager.send('secret.type', { text: PII_PHONE, mac: PII_MAC });
    /* Yanıt gelsin ki mesaj olayı da üretilsin */
    h.clock.advance(20);
    h.transport.deliver(buildEnvelope({
      messageId: 'peer-2', nowMs: h.clock.now(), kind: 'EVENT',
      payloadType: 'app.thing', payload: { secret: PII_PHONE },
    }), h.clock.now());
    h.manager.pump();

    const json = JSON.stringify(h.seen);
    expect(json).not.toContain(PII_PHONE);
    expect(json).not.toContain(PII_MAC);
    expect(json).not.toContain('905551234567');
    /* Mesaj olayı yalnız tür/boyut taşır */
    const msg = h.seen.find((e) => e.name === COMPANION_EVENTS.PHONE_MESSAGE);
    expect(msg).toBeTruthy();
    expect(JSON.stringify(msg!.payload)).toContain('payloadChars');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 11 — ACTION REGISTRY
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — eylemler YER TUTUCU, hiçbiri yürütülebilir değil', () => {
  it('dokuz eylem MEVCUT defterle kaydedilir', () => {
    const reg = createActionRegistry();
    const r = registerCompanionActions(reg);
    expect(r.registered).toHaveLength(9);
    expect(reg.size).toBe(9);
    for (const id of Object.values(COMPANION_ACTION_IDS)) expect(reg.has(id)).toBe(true);
  });

  it('ikinci kayıt SESSİZCE atlanır (throw YOK)', () => {
    const reg = createActionRegistry();
    registerCompanionActions(reg);
    const second = registerCompanionActions(reg);
    expect(second.registered).toHaveLength(0);
    expect(second.skipped).toHaveLength(9);
    expect(reg.size).toBe(9);
  });

  it('HİÇBİR eylem yürütülebilir DEĞİL', () => {
    for (const def of COMPANION_ACTIONS) {
      expect(isCompanionActionExecutable(def.id)).toBe(false);
    }
  });

  it('araç ECU kapsamı hiçbir eyleme VERİLMEZ', () => {
    for (const def of COMPANION_ACTIONS) {
      expect(def.vehicleScope).toBeUndefined();
    }
  });

  it('geri alınamaz eylemler doğru işaretlenmiş', () => {
    const byId = new Map(COMPANION_ACTIONS.map((d) => [d.id, d]));
    expect(byId.get(COMPANION_ACTION_IDS.ANSWER_CALL)!.reversible).toBe(false);
    expect(byId.get(COMPANION_ACTION_IDS.REPLY_MESSAGE)!.reversible).toBe(false);
    expect(byId.get(COMPANION_ACTION_IDS.REPLY_MESSAGE)!.risk).toBe('high');
    expect(byId.get(COMPANION_ACTION_IDS.PLAY_MEDIA)!.reversible).toBe(true);
  });

  it('hassas eylemler hassas gizlilik sınıfına eşlenir', () => {
    expect(companionActionPrivacy(COMPANION_ACTION_IDS.REPLY_MESSAGE)).toBe('SENSITIVE');
    expect(companionActionPrivacy(COMPANION_ACTION_IDS.READ_NOTIFICATION)).toBe('SENSITIVE');
    expect(companionActionPrivacy(COMPANION_ACTION_IDS.PLAY_MEDIA)).toBe('LOW');
    expect(companionActionPrivacy('nope')).toBeNull();
  });

  it('payload doğrulayıcıları fail-closed', () => {
    const reply = COMPANION_ACTIONS.find((d) => d.id === COMPANION_ACTION_IDS.REPLY_MESSAGE)!;
    expect(reply.validate({}).ok).toBe(false);
    expect(reply.validate({ text: '  ' }).ok).toBe(false);
    expect(reply.validate({ text: 'merhaba' }).ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 12 — TELEMETRİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 12 — telemetri sahte 0 üretmez', () => {
  it('hiç ölçüm yokken alanlar null (0 DEĞİL)', () => {
    const s = emptyTelemetrySnapshot();
    expect(s.connectDurationMsLast).toBeNull();
    expect(s.messageLatencyMsLast).toBeNull();
    expect(s.messageLatencyMsMedian).toBeNull();
    expect(s.lastUpdatedAt).toBeNull();
    expect(s.connectionAttempts).toBe(0);
  });

  it('negatif/geçersiz süre KAYDEDİLMEZ ama sayaç artar', () => {
    const t = createCompanionTelemetry();
    t.recordConnectSuccess(-5, T0);
    t.recordConnectSuccess(Number.NaN, T0);
    expect(t.snapshot().successfulConnects).toBe(2);
    expect(t.snapshot().connectDurationMsLast).toBeNull();
  });

  it('gecikme örnekleri bounded ve medyan doğru', () => {
    const t = createCompanionTelemetry();
    for (let i = 1; i <= 100; i++) t.recordMessageLatency(i, T0 + i);
    const s = t.snapshot();
    expect(s.messageLatencySampleCount).toBeLessThanOrEqual(32);
    expect(s.messageLatencyMsMax).toBe(100);
    expect(s.messageLatencyMsMedian).not.toBeNull();
  });

  it('lastUpdatedAt GERİLETİLMEZ', () => {
    const t = createCompanionTelemetry();
    t.recordReconnect(T0 + 1000);
    t.recordReconnect(T0 - 1000);
    expect(t.snapshot().lastUpdatedAt).toBe(T0 + 1000);
  });

  it('restore bozuk gövdede çökmez ve sayaçları ATAR', () => {
    const t = createCompanionTelemetry();
    expect(() => t.restore('garbage')).not.toThrow();
    t.restore({ connectionAttempts: 5, heartbeatLoss: -3, messageLatencyMsLast: 42 });
    const s = t.snapshot();
    expect(s.connectionAttempts).toBe(5);
    expect(s.heartbeatLoss).toBe(0);
    expect(s.messageLatencyMsLast).toBe(42);
  });

  it('gerçek akışta gidiş-dönüş gecikmesi ölçülür', () => {
    const h = harness();
    h.manager.beginSession();
    h.transport.queue({ kind: 'OPEN_OK' });
    h.transport.step(h.clock.now());
    h.manager.openTransport();
    h.clock.advance(37);
    h.transport.deliver(peerHello(h.clock.now(), ['MEDIA'], 'msg-1'), h.clock.now());
    h.manager.pump();
    expect(h.manager.telemetry.snapshot().messageLatencyMsLast).toBe(37);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 13 — YEREL KALICILIK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 13 — kalıcılık yalnız yerel, PII\'siz, göç eder', () => {
  it('oturum tur-gidişi çalışır', () => {
    const s = withNegotiated(
      withStatus(createPhoneHubSession({ sessionId: 'sid1', nowMs: T0, transportType: 'MOCK' }), 'CONNECTED', T0),
      1, ['MEDIA'], 'PHONE');
    expect(saveCompanionSession(s)).toBe(true);
    const back = loadCompanionSession()!;
    expect(back.sessionId).toBe('sid1');
    expect(back.capabilities).toEqual(['MEDIA']);
    expect(back.protocolVersion).toBe(1);
  });

  it('bozuk JSON çökertmez', () => {
    localStorage.setItem(COMPANION_KEY_SESSION, '{bozuk');
    expect(loadCompanionSession()).toBeNull();
  });

  it('bilinen cihaz ve yetenek önbelleği tur-gidişi', () => {
    saveKnownDevices([withUserTrust(createKnownDevice('abcd1234', T0), T0)]);
    const devices = loadKnownDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].trust).toBe('TRUSTED');

    saveCapabilityCache([{ peerKeyHash: 'abcd1234', tokens: ['MEDIA'], digest: 'g:MEDIA|u:|x:', updatedAt: T0 }]);
    expect(loadCapabilityCache()).toHaveLength(1);
  });

  it('yasaklı anahtarlar diske YAZILMAZ', () => {
    expect(isDeniedStorageKey('macAddress')).toBe(true);
    expect(isDeniedStorageKey('phoneNumber')).toBe(true);
    expect(isDeniedStorageKey('notificationBody')).toBe(true);
    expect(isDeniedStorageKey('payload')).toBe(true);
    /* Meşru alanlar korunur */
    expect(isDeniedStorageKey('peerKeyHash')).toBe(false);
    expect(isDeniedStorageKey('payloadType')).toBe(false);

    const cleaned = sanitizeForStorage({ ok: 1, macAddress: PII_MAC, payload: { x: 1 } }) as Record<string, unknown>;
    expect(cleaned.ok).toBe(1);
    expect(cleaned.macAddress).toBeUndefined();
    expect(cleaned.payload).toBeUndefined();
  });

  it('kirli oturum diske yazılırken süzülür', () => {
    const dirty = {
      ...createPhoneHubSession({ sessionId: 'sid', nowMs: T0 }),
      macAddress: PII_MAC,
    } as unknown as PhoneHubSession;
    saveCompanionSession(dirty);
    const stored = localStorage.getItem(COMPANION_KEY_SESSION) ?? '';
    expect(stored).not.toContain(PII_MAC);
  });

  it('telemetri kaydı + sağlık özeti + temizleme', () => {
    saveCompanionTelemetry(emptyTelemetrySnapshot());
    saveCompanionSession(createPhoneHubSession({ sessionId: 'sid', nowMs: T0 }));
    const h = companionStorageHealth();
    expect(h.sessionPresent).toBe(true);
    expect(h.telemetryPresent).toBe(true);

    expect(clearCompanionStorage()).toBe(true);
    expect(companionStorageHealth().sessionPresent).toBe(false);
    for (const k of COMPANION_STORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });

  it('kalıcılık katmanında AĞ ÇAĞRISI YOK', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/companion/companionStore.ts'), 'utf8');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'supabase', 'firebase', 'axios', 'WebSocket', 'navigator.send']) {
      expect(src).not.toContain(bad);
    }
  });

  it('yeniden başlatma simülasyonu: diskten dönen oturum BAĞLI DEĞİL', () => {
    const h = harness();
    connect(h);
    saveCompanionSession(h.manager.session);

    const restored = loadCompanionSession();
    const h2 = harness();
    h2.manager.adoptRestoredSession(restored);
    expect(h2.manager.state).toBe('DISCONNECTED');
    expect(h2.manager.session!.protocolVersion).toBeNull();
    expect(h2.manager.capabilitySnapshot()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 14 — DURUM DÖKÜMÜ + HAZIRLIK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 14 — döküm dürüst, hazırlık fail-closed', () => {
  it('oturum yokken döküm null alanlar verir (sahte 0 YOK)', () => {
    const d = dumpSession(null, T0);
    expect(d.present).toBe(false);
    expect(d.sessionId).toBeNull();
    expect(d.lastSeenAgeMs).toBeNull();
    expect(d.heartbeat).toBe('UNKNOWN');
    expect(d.connectDurationMs).toBeNull();
  });

  it('yetenek dökümü BİLİNMEYEN jetonları SIZDIRMAZ', () => {
    const reg = createCompanionCapabilityRegistry({ locallySupported: ['MEDIA'] });
    const snap = reg.applyDeclaration(['MEDIA', 'PEER_PRIVATE_THING'], 1);
    const d = dumpCapabilities(snap);
    expect(d.granted).toEqual(['MEDIA']);
    expect(d.unknownCount).toBe(1);
    /* Karşı tarafın özel jeton ADI hiçbir alanda (digest dahil) GÖRÜNMEZ. */
    expect(JSON.stringify(d)).not.toContain('PEER_PRIVATE_THING');
    expect(d.digest).not.toContain('PEER_PRIVATE_THING');
    /* Ama değişim yine tespit edilir: farklı bilinmeyen küme → farklı özet. */
    const other = createCompanionCapabilityRegistry({ locallySupported: ['MEDIA'] })
      .applyDeclaration(['MEDIA', 'ANOTHER_PRIVATE'], 1);
    expect(dumpCapabilities(other).digest).not.toBe(d.digest);
    expect(d.grantedPrivacy).toEqual(['MEDIA:LOW']);
  });

  it('anlaşma yoksa yetenek dökümü present:false', () => {
    expect(dumpCapabilities(null).present).toBe(false);
  });

  it('taşıma dökümü sınırları taşır', () => {
    const t = createMockTransport();
    const d = dumpTransport(t.describe(), t.status());
    expect(d.implemented).toBe(true);
    expect(d.link).toBe('CLOSED');
    expect(d.limitations).toContain('NO_REAL_LINK');
  });

  it('hazırlık: oturum yoksa NOT_READY ve gerekçeler listelenir', () => {
    const v = assessFoundation({
      session: dumpSession(null, T0),
      capabilities: dumpCapabilities(null),
      transport: dumpTransport(
        createUnimplementedTransport('BLE').describe(),
        createUnimplementedTransport('BLE').status()),
      telemetry: dumpTelemetry(null),
    });
    expect(v.readiness).toBe('NOT_READY');
    expect(v.unmet).toContain('NO_SESSION');
    expect(v.unmet).toContain('TRANSPORT_NOT_IMPLEMENTED');
    expect(v.realConnectionReady).toBe(false);
  });

  it('mock ile tam bağlanıldığında altyapı READY ama GERÇEK bağlantı DEĞİL', () => {
    const h = harness({ locallySupported: ['MEDIA'] });
    connect(h, ['MEDIA']);
    const v = assessFoundation({
      session: dumpSession(h.manager.session, h.clock.now()),
      capabilities: dumpCapabilities(h.manager.capabilitySnapshot()),
      transport: dumpTransport(h.transport.describe(), h.transport.status()),
      telemetry: dumpTelemetry(h.manager.telemetry.snapshot()),
    });
    expect(v.unmet).toEqual([]);
    expect(v.readiness).toBe('READY');
    /* EN ÖNEMLİ KİLİT: altyapı hazır olsa bile gerçek bağlantı hazır DEĞİL */
    expect(v.realConnectionReady).toBe(false);
    expect(v.implementedTransports).toEqual(['MOCK']);
  });

  it('döküm JSON-serileştirilebilir ve throw etmez', () => {
    const h = harness();
    connect(h);
    expect(() => JSON.stringify({
      session: dumpSession(h.manager.session, h.clock.now()),
      capabilities: dumpCapabilities(h.manager.capabilitySnapshot()),
      transport: dumpTransport(h.transport.describe(), h.transport.status()),
      telemetry: dumpTelemetry(h.manager.telemetry.snapshot()),
    })).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 15 — LAB ENTEGRASYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 15 — LAB bölümü salt gözlem', () => {
  it('kaynak okuma oturum BAŞLATMAZ, taşıma AÇMAZ', () => {
    const snap = readCompanionFoundationSnapshot();
    expect(snap.liveRuntimeAttached).toBe(false);
    expect(snap.transport.link).toBe('CLOSED');
    expect(snap.transport.writable).toBe(false);
    expect(snap.verdict.realConnectionReady).toBe(false);
  });

  it('temiz kurulumda NOT_READY ve oturum KAYNAK YOK', () => {
    const snap = readCompanionFoundationSnapshot();
    expect(snap.session.present).toBe(false);
    expect(snap.verdict.readiness).toBe('NOT_READY');
    expect(snap.verdict.unmet).toContain('NO_SESSION');
  });

  it('sözleşme gerçekleri doğru sayılır', () => {
    const f = readCompanionFoundationSnapshot().contract;
    expect(f.declaredTransportCount).toBe(COMPANION_TRANSPORT_TYPES.length);
    expect(f.implementedTransports).toEqual(['MOCK']);
    expect(f.eventCount).toBe(7);
    expect(f.actionCount).toBe(9);
    expect(f.executableActionCount).toBe(0);
    expect(f.locallySupportedCapabilityCount).toBe(0);
  });

  it('ekran Companion bölümünü render eder ve "hazır bağlantı" iddia etmez', () => {
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).toContain('phf-section-companion');
    expect(html).toContain('Companion Foundation');
    expect(html).toContain('GERÇEK BAĞLANTI HAZIR DEĞİL');
    expect(html).toContain('companion-session-absent');
  });

  it('ekran render\'ında PII deseni yok', () => {
    const html = renderToStaticMarkup(<PhoneHubFieldValidationScreen />);
    expect(html).not.toMatch(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/);
    expect(html).not.toMatch(/\+\d{10,}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 16 — STATİK GÜVENLİK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 16 — yasaklı bağlantı/komut/izin yüzeyine dokunulmaz', () => {
  const FILES = [
    'src/platform/companion/companionDomain.ts',
    'src/platform/companion/connectionStateMachine.ts',
    'src/platform/companion/companionSession.ts',
    'src/platform/companion/companionCapabilityRegistry.ts',
    'src/platform/companion/messageEnvelope.ts',
    'src/platform/companion/protocolNegotiation.ts',
    'src/platform/companion/pairingModel.ts',
    'src/platform/companion/connectionTransport.ts',
    'src/platform/companion/mockTransport.ts',
    'src/platform/companion/companionEvents.ts',
    'src/platform/companion/companionActions.ts',
    'src/platform/companion/companionTelemetry.ts',
    'src/platform/companion/companionStore.ts',
    'src/platform/companion/companionSessionManager.ts',
    'src/platform/companion/companionStateDump.ts',
    'src/platform/companion/index.ts',
    'src/platform/devtools/companionFoundationSources.ts',
  ];

  /** Yorumlar çıkarılır → yalnız YÜRÜTÜLEN kod taranır. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  const FORBIDDEN = [
    'createBond', 'startDiscovery', 'cancelDiscovery', 'startScan', 'stopScan',
    'BluetoothSocket', 'createRfcommSocket', 'RfcommSocket',
    'new WebSocket', 'createConnection', 'net.Socket', 'navigator.bluetooth',
    'requestDevice(', 'requestPermissions', 'requestPermission(',
    'dispatchMediaKeyEvent', 'ACTION_CALL', 'placeCall', 'sendTextMessage', 'sendSms',
    'NotificationListener', 'BluetoothAdapter', 'WifiP2p', 'UsbManager',
    // OBD davranışını değiştirebilecek çağrılar
    'connectObd', 'disconnectObd', 'resetObd', 'startPolling', 'stopPolling',
  ];

  for (const file of FILES) {
    it(`${file} — yasaklı çağrı YOK`, () => {
      const code = stripComments(readFileSync(resolve(process.cwd(), file), 'utf8'));
      for (const bad of FORBIDDEN) {
        expect(code, `${file} içinde YASAK: ${bad}`).not.toContain(bad);
      }
    });
  }

  it('SAF katmanlarda timer / Date.now / localStorage YOK', () => {
    const PURE = [
      'src/platform/companion/companionDomain.ts',
      'src/platform/companion/connectionStateMachine.ts',
      'src/platform/companion/companionSession.ts',
      'src/platform/companion/messageEnvelope.ts',
      'src/platform/companion/protocolNegotiation.ts',
      'src/platform/companion/pairingModel.ts',
      'src/platform/companion/companionStateDump.ts',
      'src/platform/companion/companionSessionManager.ts',
      'src/platform/companion/mockTransport.ts',
    ];
    for (const file of PURE) {
      const code = stripComments(readFileSync(resolve(process.cwd(), file), 'utf8'));
      expect(code, `${file}: Date.now`).not.toContain('Date.now(');
      expect(code, `${file}: setInterval`).not.toContain('setInterval(');
      expect(code, `${file}: setTimeout`).not.toContain('setTimeout(');
      expect(code, `${file}: localStorage`).not.toContain('localStorage');
      expect(code, `${file}: react`).not.toContain("from 'react'");
    }
  });

  it('companion katmanı OBD servislerini import ETMEZ', () => {
    for (const file of FILES) {
      const code = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(code, `${file}`).not.toContain("from '../obdService'");
      expect(code, `${file}`).not.toContain("from '../obd/");
    }
  });

  it('barrel import YAN ETKİSİZDİR (timer/abonelik/depolama okuma yok)', () => {
    /* Modül zaten bu dosyanın başında import edildi; hiçbir kayıt oluşmamalı. */
    for (const k of COMPANION_STORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });
});
