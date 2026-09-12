/**
 * phoneHubLink.test.tsx — PHONE-HUB P1-A canlı bağlantı kilitleri.
 *
 * ── NE KİLİTLENİYOR ─────────────────────────────────────────────────────────
 * (A) Kanıt yoksa HİÇBİR alan başarılı/sıfır gösterilmez.
 * (B) "Bağlandı" YALNIZ şifreli oturum kurulduğunda yazılır.
 * (C) Doğrulama kodu, anahtar, MAC ve ham yük hiçbir modele/dışa aktarıma girmez.
 * (D) MEDIA/CALLS yetenekleri granted SAYILMAZ.
 * (E) Sürüş güvenliği kapısı "araç duruyor" VARSAYMAZ.
 * (F) Saf katmanlarda `Date.now`, timer, React ve I/O YOKTUR.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPhoneHubLinkView, buildPhoneHubLinkExport, buildHeadline,
  PHONE_HUB_LINK_SECTION_ORDER, MAX_EVENT_ROWS,
} from '../platform/devtools/phoneHubLinkModel';
import {
  buildPhoneHubUserView, deriveUserState, deriveTrustLevel,
  classifyMotion, evaluatePairingGate, MOTION_THRESHOLD_KMH,
} from '../platform/phoneHub/phoneHubUserModel';
import type { PhoneHubLinkSnapshotRaw } from '../platform/phoneHub/phoneHubLink';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

/* ══════════════════════════════════════════════════════════════════════════
 * Fikstürler
 * ════════════════════════════════════════════════════════════════════════ */

const ABSENT: PhoneHubLinkSnapshotRaw = { present: false };

function established(overrides: Partial<PhoneHubLinkSnapshotRaw> = {}): PhoneHubLinkSnapshotRaw {
  return {
    present: true,
    schemaVersion: 1,
    uuid: '6f5c1a20-7d3e-4a91-b8c4-2e9f0d5a7b31',
    uuidDistinctFromObdSpp: true,
    server: {
      state: 'CLIENT_CONNECTED', running: true, disposed: false,
      listenStartedAtMs: 1000, acceptedCount: 1, rejectedSecondClient: 0,
      hasActiveSocket: true, lastErrorCode: null,
    },
    preconditions: { ready: true, blockerCode: null, connectPermission: true },
    identity: { hasIdentity: true, hardwareBacked: false },
    trust: {
      hasTrustedPeer: true, peerFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      lastConnectedAtMs: 5000, protocolVersion: 1, connectCount: 3,
    },
    session: {
      generation: 2, state: 'CONNECTED', serverSide: true,
      handshakeStage: 'ESTABLISHED', awaitingUserConfirm: false, trustSkipped: true,
      disposed: false, startedAtMs: 2000, establishedAtMs: 2400,
      negotiationDurationMs: 400, lastInboundAgeMs: 120,
      protocolVersion: 1, peerFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      peerAppVersion: '0.1.0', grantedCapabilities: ['HEALTH'],
      heartbeatsSent: 5, heartbeatsReceived: 5,
      framesSent: 12, framesReceived: 11, bytesSent: 900, bytesReceived: 850,
      appMessagesReceived: 2, writeQueueDepth: 0, writeQueueCapacity: 64,
      writeQueueRejections: 0, checksumFailures: 0, malformedFrames: 0,
      oversizeRejections: 0, resyncEvents: 0, unknownTypeDropped: 0,
      decryptFailures: 0, replayRejections: 0, encryptionActive: true,
      readerAlive: true, writerAlive: true,
      lastErrorCode: null, disconnectReasonCode: null, trulyEstablished: true,
    },
    pairing: { awaitingConfirmation: false, expiresAtMs: -1 },
    connectStartedAtMs: 1900,
    lastSessionState: 'CONNECTED',
    lastErrorCode: null,
    lastErrorAtMs: -1,
    diagnostics: {
      size: 3, capacity: 200, dropped: 0, redacted: 0,
      events: [
        { t: 1, side: 'HEAD_UNIT', category: 'LIFECYCLE', stage: 'start',
          code: null, severity: 'INFO', generation: 2, details: 'oturum basladi' },
      ],
    },
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * A · Kanıt yoksa hiçbir şey uydurulmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · kanıtsız bilgi üretilmez', () => {
  it('native okunamadıysa TÜM alanlar KAYNAK YOK olur', () => {
    const view = buildPhoneHubLinkView(ABSENT);
    expect(view.present).toBe(false);

    const allFields = view.sections.flatMap((s) => s.fields);
    expect(allFields.length).toBeGreaterThan(20);
    for (const field of allFields) {
      expect(field.klass).toBe('UNAVAILABLE');
      expect(field.value).toBe('—');
    }
  });

  it('sahte sıfır sayaç ÜRETİLMEZ', () => {
    const view = buildPhoneHubLinkView(ABSENT);
    const counters = view.sections.find((s) => s.id === 'counters');
    expect(counters).toBeDefined();
    for (const field of counters!.fields) {
      expect(field.value).not.toBe('0');
      expect(field.klass).toBe('UNAVAILABLE');
    }
  });

  it('ölçülmemiş süre (-1) KAYNAK YOK olur, "-1 ms" YAZILMAZ', () => {
    const raw = established();
    raw.session!.negotiationDurationMs = -1;
    const view = buildPhoneHubLinkView(raw);
    const field = view.sections
      .find((s) => s.id === 'session')!.fields
      .find((f) => f.id === 'session-negotiation')!;
    expect(field.klass).toBe('UNAVAILABLE');
    expect(field.value).not.toContain('-1');
  });

  it('gerçek 0 ile ölçülmemiş -1 AYRIŞIR', () => {
    const raw = established();
    raw.session!.checksumFailures = 0;
    const view = buildPhoneHubLinkView(raw);
    const field = view.sections
      .find((s) => s.id === 'counters')!.fields
      .find((f) => f.id === 'cnt-checksum')!;
    expect(field.klass).toBe('OBSERVED');
    expect(field.value).toBe('0');
  });

  it('oturum yokken oturum alanları KAYNAK YOK olur ama sunucu alanları OKUNUR', () => {
    const raw = established({ session: null });
    const view = buildPhoneHubLinkView(raw);

    const sessionFields = view.sections.find((s) => s.id === 'session')!.fields;
    expect(sessionFields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);

    const serverState = view.sections
      .find((s) => s.id === 'server')!.fields
      .find((f) => f.id === 'server-state')!;
    expect(serverState.klass).toBe('OBSERVED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · "Bağlandı" yalnız şifreli oturumda
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · bağlandı iddiası', () => {
  it('şifreli oturum kuruluysa gerçekten kurulu sayılır', () => {
    expect(buildPhoneHubLinkView(established()).trulyEstablished).toBe(true);
  });

  it('soket açık ama şifreleme yoksa BAĞLANDI YAZILMAZ', () => {
    const raw = established();
    raw.session!.encryptionActive = false;
    raw.session!.trulyEstablished = false;
    raw.session!.state = 'HANDSHAKING';

    const view = buildPhoneHubLinkView(raw);
    expect(view.trulyEstablished).toBe(false);
    expect(view.headline).not.toContain('KURULU');

    const user = buildPhoneHubUserView(raw);
    expect(user.state).not.toBe('CONNECTED');
  });

  it('kullanıcı ekranı da şifresiz oturumu TRUSTED saymaz', () => {
    const raw = established();
    raw.session!.trulyEstablished = false;
    expect(deriveTrustLevel(raw)).toBe('PAIRED_ONLY');
  });

  it('güven kaydı varlığı tek başına TRUSTED yapmaz', () => {
    const raw = established({ session: null });
    expect(deriveTrustLevel(raw)).toBe('PAIRED_ONLY');
    expect(deriveUserState(raw)).toBe('WAITING_FOR_PHONE');
  });

  it('native okunamadıysa güven BİLİNMİYOR olur', () => {
    expect(deriveTrustLevel(ABSENT)).toBe('UNKNOWN');
    expect(deriveUserState(ABSENT)).toBe('NOT_CONNECTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · Gizlilik
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · gizlilik', () => {
  const FORBIDDEN = [
    '428193',                                // doğrulama kodu benzeri
    'AA:BB:CC:DD:EE:FF',                     // MAC
    '+905551112233',                         // telefon numarası
    'sessionKey', 'privateKey', 'nonce',
  ];

  it('model çıktısı yasak değerlerden hiçbirini taşımaz', () => {
    const raw = established();
    const serialized = JSON.stringify(buildPhoneHubLinkView(raw));
    for (const needle of FORBIDDEN) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('tam parmak izi GÖSTERİLMEZ, kısaltılır', () => {
    const raw = established();
    const full = raw.trust!.peerFingerprint!;
    const view = buildPhoneHubLinkView(raw);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain(full);
    expect(serialized).toContain(full.slice(0, 8));
  });

  it('dışa aktarılan JSON PII taşımaz ve ayrıştırılabilir', () => {
    const view = buildPhoneHubLinkView(established());
    const json = buildPhoneHubLinkExport(view, 1234);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.tool).toBe('phone-hub-link-diagnostics');
    expect(parsed.exportedAt).toBe(1234);
    for (const needle of FORBIDDEN) {
      expect(json).not.toContain(needle);
    }
  });

  it('kullanıcı görünümünde ham anahtar veya MAC alanı YOKTUR', () => {
    const view = buildPhoneHubUserView(established());
    const keys = Object.keys(view);
    for (const forbidden of ['mac', 'address', 'publicKey', 'payload', 'stack']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it('onay bekleyen kod ekran modeline GİRMEZ, yalnız bayrak taşınır', () => {
    const raw = established({
      pairing: { awaitingConfirmation: true, expiresAtMs: 9000 },
    });
    const view = buildPhoneHubLinkView(raw);
    expect(view.awaitingUserConfirmation).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/\b\d{6}\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D · Yetenek kapısı
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · yetenek kapısı', () => {
  it('bu fazda yalnız HEALTH verilebilir', () => {
    const view = buildPhoneHubLinkView(established());
    const field = view.sections
      .find((s) => s.id === 'session')!.fields
      .find((f) => f.id === 'session-granted-list')!;
    expect(field.value).toBe('HEALTH');
  });

  it('bağlantı kurulmuş olması yetenek sayısını şişirmez', () => {
    const user = buildPhoneHubUserView(established());
    expect(user.grantedCapabilityCount).toBe(1);
  });

  it('yetenek listesi boşsa sayı 0 olur ama liste KAYNAK YOK kalır', () => {
    const raw = established();
    raw.session!.grantedCapabilities = [];
    const view = buildPhoneHubLinkView(raw);
    const count = view.sections
      .find((s) => s.id === 'session')!.fields
      .find((f) => f.id === 'session-granted-count')!;
    const list = view.sections
      .find((s) => s.id === 'session')!.fields
      .find((f) => f.id === 'session-granted-list')!;
    expect(count.value).toBe('0');
    expect(list.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E · Sürüş güvenliği kapısı
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · sürüş güvenliği', () => {
  it('hız kaynağı yoksa araç duruyor VARSAYILMAZ', () => {
    expect(classifyMotion(null)).toBe('UNKNOWN');
    expect(evaluatePairingGate('UNKNOWN')).toBe('ALLOWED_WITH_WARNING');
  });

  it('NaN hız da BİLİNMİYOR sayılır', () => {
    expect(classifyMotion(Number.NaN)).toBe('UNKNOWN');
  });

  it('hareket hâlinde ilk eşleştirme KİLİTLENİR', () => {
    expect(classifyMotion(MOTION_THRESHOLD_KMH + 1)).toBe('MOVING');
    expect(evaluatePairingGate('MOVING')).toBe('BLOCKED_MOVING');
  });

  it('araç duruyorsa eşleştirmeye izin verilir', () => {
    expect(classifyMotion(0)).toBe('STOPPED');
    expect(classifyMotion(MOTION_THRESHOLD_KMH)).toBe('STOPPED');
    expect(evaluatePairingGate('STOPPED')).toBe('ALLOWED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F · OBD izolasyonu ve saha borcu
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · OBD ve saha', () => {
  it('OBD eşzamanlılık etkisi FIELD_TEST_REQUIRED olarak AÇIK kalır', () => {
    const view = buildPhoneHubLinkView(established());
    const obd = view.sections.find((s) => s.id === 'obd')!;
    const effect = obd.fields.find((f) => f.id === 'obd-concurrency-effect')!;

    /* Değer '—' KALMALI: ölçülmemiş alana metin yazmak "ölçüldü" izlenimi
     * verirdi. İşaret NOTTA durur. */
    expect(effect.klass).toBe('UNAVAILABLE');
    expect(effect.value).toBe('—');
    expect(effect.note).toContain('FIELD_TEST_REQUIRED');

    const latency = obd.fields.find((f) => f.id === 'obd-accept-latency')!;
    expect(latency.note).toContain('FIELD_TEST_REQUIRED');
  });

  it('UUID ayrımı TÜRETİLMİŞ olarak işaretlenir (ölçüm değil, kural)', () => {
    const view = buildPhoneHubLinkView(established());
    const field = view.sections
      .find((s) => s.id === 'obd')!.fields
      .find((f) => f.id === 'obd-uuid-isolation')!;
    expect(field.klass).toBe('DERIVED');
  });

  it('saha borcu listesi BOŞALTILAMAZ', () => {
    const view = buildPhoneHubLinkView(established());
    expect(view.fieldTestRequired.length).toBeGreaterThanOrEqual(3);
    expect(view.fieldTestRequired.join(' ')).toContain('head unit');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G · Model saflığı ve sınırlılık
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · saf katman kuralları', () => {
  const PURE_FILES = [
    'src/platform/devtools/phoneHubLinkModel.ts',
    'src/platform/phoneHub/phoneHubUserModel.ts',
  ];

  it('saf modellerde Date.now, timer, React ve I/O YOKTUR', () => {
    for (const relative of PURE_FILES) {
      const source = readFileSync(resolve(process.cwd(), relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(source, `${relative}: Date.now yasak`).not.toContain('Date.now');
      expect(source, `${relative}: setInterval yasak`).not.toContain('setInterval');
      expect(source, `${relative}: setTimeout yasak`).not.toContain('setTimeout');
      expect(source, `${relative}: React importu yasak`).not.toContain("from 'react'");
      expect(source, `${relative}: fetch yasak`).not.toContain('fetch(');
      expect(source, `${relative}: localStorage yasak`).not.toContain('localStorage');
    }
  });

  it('olay listesi SINIRLIDIR', () => {
    const raw = established();
    raw.diagnostics!.events = Array.from({ length: 500 }, (_, i) => ({
      t: i, side: 'PHONE', category: 'SOCKET', stage: 'read',
      code: 'READ_FAILED', severity: 'WARN', generation: 1, details: 'x',
    }));
    const view = buildPhoneHubLinkView(raw);
    expect(view.events.length).toBe(MAX_EVENT_ROWS);
  });

  it('bozuk/eksik girdi ÇÖKMEZ', () => {
    const broken = { present: true } as PhoneHubLinkSnapshotRaw;
    expect(() => buildPhoneHubLinkView(broken)).not.toThrow();
    expect(() => buildPhoneHubUserView(broken)).not.toThrow();
    expect(() => buildHeadline(broken)).not.toThrow();
  });

  it('bölüm sırası kararlıdır', () => {
    const view = buildPhoneHubLinkView(established());
    const ids = view.sections.map((s) => s.id);
    expect(ids).toEqual(PHONE_HUB_LINK_SECTION_ORDER.filter((id) => id !== 'events'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H · CAROS LAB kataloğu
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · CAROS LAB kaydı', () => {
  it('araç katalogda AVAILABLE olarak kayıtlıdır', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'phone-hub-link');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('communication');
  });

  it('katalog notu OBD ve gizlilik sınırlarını AÇIKÇA beyan eder', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'phone-hub-link')!;
    expect(tool.note).toContain('OBD');
    expect(tool.note).toContain('FIELD_TEST_REQUIRED');
    expect(tool.note).toContain('MAC');
  });

  it('P0.5 ve P0.8 araçları SİLİNMEMİŞTİR', () => {
    const ids = CAROS_LAB_TOOLS.map((t) => t.id);
    expect(ids).toContain('phone-hub-probe');
    expect(ids).toContain('phone-hub-field-validation');
    expect(ids).toContain('phone-hub-link');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * I · Native köprü fail-soft
 * ════════════════════════════════════════════════════════════════════════ */

describe('P1-A · native köprü fail-soft', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('plugin yoksa okuma present:false döner ve ÇÖKMEZ', async () => {
    vi.doMock('@capacitor/core', () => ({
      registerPlugin: () => ({}),
    }));
    const mod = await import('../platform/phoneHub/phoneHubLink');
    mod._resetPhoneHubLinkForTest();

    const snapshot = await mod.refreshPhoneHubLink();
    expect(snapshot.present).toBe(false);
    expect(mod.getPhoneHubLink().present).toBe(false);
  });

  it('plugin patlarsa eski kanıt TAZE gibi kalmaz', async () => {
    vi.doMock('@capacitor/core', () => ({
      registerPlugin: () => ({
        getSnapshot: () => Promise.reject(new Error('native patladı')),
      }),
    }));
    const mod = await import('../platform/phoneHub/phoneHubLink');
    mod._resetPhoneHubLinkForTest();

    const snapshot = await mod.refreshPhoneHubLink();
    expect(snapshot.present).toBe(false);
  });

  it('eylemler plugin yokken ÇÖKMEZ, kodlanmış hata döner', async () => {
    vi.doMock('@capacitor/core', () => ({
      registerPlugin: () => ({}),
    }));
    const mod = await import('../platform/phoneHub/phoneHubLink');

    const result = await mod.startPhoneHubServer();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('TRANSPORT_NOT_IMPLEMENTED');
  });

  it('doğrulama kodu ÖNBELLEĞE ALINMAZ — plugin yoksa null döner', async () => {
    vi.doMock('@capacitor/core', () => ({
      registerPlugin: () => ({}),
    }));
    const mod = await import('../platform/phoneHub/phoneHubLink');
    await expect(mod.getPhoneHubPairingCode()).resolves.toBeNull();
  });
});
