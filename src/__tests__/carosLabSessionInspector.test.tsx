/**
 * carosLabSessionInspector.test.tsx — CAROS LAB Faz A3 · Session Inspector KİLİTLERİ (18).
 *
 * YAKLAŞIM: model + kart kurucuları TAMAMEN SAF (servis importu yok) → gerçek
 * davranış servis mock'u olmadan doğrulanır. Ekran/mount kilitleri
 * `renderToStaticMarkup` + saf kaynak sayaçlarıyla alınır (jsdom'da createRoot yok).
 *
 * ANA İLKE: bu ekran YENİ OTORİTE DEĞİLDİR. Kilitlerin çoğu "uydurmadı mı" sorusunu
 * sorar: kaynağı olmayan alan UNAVAILABLE mı, damgasız alan STALE olmuyor mu,
 * çelişen kaynaklar sessizce ezilmiyor mu.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  observed, derived, unavailable, applyStaleness, formatAge,
  detectMismatches, deriveSessionHealth, countByClass, boundCard,
  INSPECTOR_CARD_ORDER, MAX_FIELDS_PER_CARD, MAX_MISMATCHES,
  type InspectorCard, type SessionHealthInput, type MismatchInput,
} from '../platform/devtools/sessionInspectorModel';
import {
  buildInspectorCards, buildMismatchInput, buildHealthInput,
  type SessionRawSnapshot,
} from '../platform/devtools/sessionInspectorBuild';
import {
  _resetDevtoolsCaptureForTest, _devtoolsCaptureRefs, getDevtoolsCaptureStatus,
} from '../platform/devtools/devtoolsCapture';
import { isCarosLabAllowed, shouldRenderCarosLab } from '../platform/devtools/carosLabGate';
import { getCarosLabTool, resolveToolActivation, CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { carosLabNavReduce, CAROS_LAB_INITIAL_NAV } from '../platform/devtools/carosLabNavigation';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { CarosLabShell } from '../components/devtools/CarosLabShell';
import { SessionInspectorScreen } from '../components/devtools/screens/SessionInspectorScreen';
import { useDebugStore } from '../platform/debug';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture — TAMAMEN yapısal (servis mock'u gerekmez)
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function snapshot(over: Partial<SessionRawSnapshot> = {}): SessionRawSnapshot {
  return {
    readAt: NOW,
    obdStatus: { connectionState: 'connected', source: 'real', vehicleType: 'diesel', lastSeenMs: NOW - 500 },
    obdData: {
      transportConnected: true, dataFresh: true, lastRxAt: NOW - 300,
      lastSeenMs: NOW - 500, source: 'real', connectionState: 'connected',
    },
    sessionHealth: { transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true },
    connLifecycle: {
      resetRequestedCount: 1, resetCompletedCount: 1, disconnectCalledCount: 0, reconnectRequestedCount: 2,
      lastResetReason: 'user_request', lastResetAt: NOW - 60_000, lastDisconnectAt: 0, lastReconnectAt: NOW - 30_000,
      connectionState: 'connected', lastPacketAgeMs: 480,
    },
    transportStats: { transport: 'classic', connected: true, reconnectAttempts: 2, lastDisconnectReason: null },
    handshake: {
      outcome: 'success', ranAt: NOW - 120_000, vinPresent: true, vinClass: 'ok',
      bitmapClass: 'ok', readBlocksCount: 2, supportedCount: 31,
      failReason: null, timeoutStage: null, durationMs: 4200,
      protocolTried: '6', protocolActive: '6', lastSuccessAt: NOW - 120_000,
      reconnectReason: null, reconnectHistoryCount: 1,
    },
    health: { connectionQuality: 88, lastPacketAgeMs: 480, isStale: false, reconnectPressure: 0.3 },
    freshWindowMs: 12_000,
    kwp: null,
    hal: {
      halConnected: true, halConf: 0.85, activeSource: 'OBD', canPhase: 'CONNECTED', canRetryCount: 0,
      canAlive: null, obdAlive: true, gpsAlive: true, sourceHealthUpdatedAtMono: 123456.7,
    },
    connectivity: [
      { source: 'OBD', available: true, connected: true, confidence: 0.85, lastSignalAt: NOW - 400, errorReason: null },
      { source: 'GPS', available: true, connected: true, confidence: 0.7, lastSignalAt: NOW - 900, errorReason: null },
    ],
    capture: { obdRefs: 0, canRefs: 0 },
    debug: {
      collecting: false, trafficBufferLen: 12, trafficBufferMax: 500,
      listenerCount: 4, obdDropped: 0, hzCountersWritten: false, fallbackWritten: false,
    },
    ...over,
  };
}

function healthInput(over: Partial<SessionHealthInput> = {}): SessionHealthInput {
  return {
    connectionState: 'connected', transportReady: true, sessionReady: true,
    pollingActive: true, dataFresh: true, lastSeenMs: NOW - 500,
    freshWindowMs: 12_000, nowMs: NOW, dataSource: 'real',
    kwpStatus: null, kwpAtLimit: null, mismatchCount: 0,
    ...over,
  };
}

function mismatchInput(over: Partial<MismatchInput> = {}): MismatchInput {
  return {
    connectionState: 'connected', transportConnected: true, transportReady: true,
    dataFresh: true, healthIsStale: false, connectivityObdConnected: true,
    halObdAlive: true, protocolTried: '6', protocolActive: '6',
    ...over,
  };
}

/** Kaynak metninden yorumları çıkarır (yasak-isim taraması yalnız KODA bakmalı). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function findField(cards: readonly InspectorCard[], id: string) {
  for (const c of cards) for (const f of c.fields) if (f.id === id) return f;
  return null;
}

beforeEach(() => {
  _resetDevtoolsCaptureForTest();
  useDebugStore.setState({ obdTrafficLog: [], collecting: false });
});

afterEach(() => { vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1–2 · Kapı + mount koşulu
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — developer gate korunuyor', () => {
  it('kapı iki koşulu birden ister; fail-closed', () => {
    /* 2026-07-26: kapı ROL DEĞİL, TEK derleme bayrağıdır — fail-closed korunur. */
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true })).toBe(true);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(isCarosLabAllowed(undefined)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
  });
});

describe('KİLİT 2 — Session Inspector seçilmeden mount OLMUYOR', () => {
  it('shell katalog görünümünde inspector markup\'ı basılmaz', () => {
    const html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(html).not.toContain('session-inspector');
    expect(html).not.toContain('OTURUM ÖZETİ');
  });

  it('araç AVAILABLE ve yalnız seçilince ekrana çözülür', () => {
    const tool = getCarosLabTool('session-inspector')!;
    expect(tool.status).toBe('AVAILABLE');
    expect(resolveToolActivation(tool)).toBe('session-inspector');
    expect(renderAvailableTool('session-inspector')).not.toBeNull();

    const nav = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: 'session-inspector' });
    expect(nav.activeId).toBe('session-inspector');
  });

  it('ekran ayrı lazy chunk olarak çözülür (KİLİT 15)', () => {
    const el = renderAvailableTool('session-inspector');
    const type = (el as { type?: unknown }).type as { $$typeof?: symbol } | undefined;
    expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3–5 · Yaşam döngüsü: başlatma yok, abonelik yok, timer yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — mount hiçbir OBD/AI/Deep Scan/HAL BAŞLATMA çağrısı yapmıyor', () => {
  it('kaynak okuyucu YALNIZ senkron getter import eder; start/connect/reset yolu YOK', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('src/platform/devtools/sessionInspectorSources.ts', 'utf8');
    // Yorumları çıkar — yasak isimlerin "bilerek çağrılmaz" açıklamalarında geçmesi normaldir.
    const src = stripComments(raw);

    const FORBIDDEN = [
      'connectOBD', 'disconnectOBD', 'startOBD', 'stopOBD', 'resetObd', 'reconnect(',
      'refreshKwpRecoveryEvidence', 'startConnectivityManager', 'startDeepScan',
      'sendCommand', 'clearDTC', 'readDTC', 'setInterval', 'setTimeout', 'subscribe(',
      'addListener', 'onOBDData', 'await ',
    ];
    for (const f of FORBIDDEN) expect(src).not.toContain(f);

    // Yalnız beklenen senkron getter'lar
    for (const g of [
      'getOBDStatusSnapshot', 'getObdSessionHealth', 'getHandshakeDiagnostics',
      'getKwpRecoveryEvidence', 'getConnectivitySnapshot', 'getDevtoolsCaptureStatus',
    ]) expect(src).toContain(g);
  });

  it('ekran bileşeni timer/abonelik kurmaz', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/SessionInspectorScreen.tsx', 'utf8'),
    );
    for (const f of ['setInterval', 'setTimeout', 'useEffect', 'subscribe', 'addListener']) {
      expect(src).not.toContain(f);
    }
  });

  it('shell render edilince yakalama referansı 0 kalır (KİLİT 14 ile ortak)', () => {
    renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
  });
});

describe('KİLİT 4 — unmount temizliği: bu ekranın temizlenecek aboneliği YOK', () => {
  it('inspector hiçbir yakalama kanalı açmaz (açılmayanın sızıntısı olmaz)', () => {
    expect(getDevtoolsCaptureStatus()).toEqual({ obdRefs: 0, canRefs: 0 });
    // Kart kurma tamamen saf — yan etki üretmez
    buildInspectorCards(snapshot());
    expect(getDevtoolsCaptureStatus()).toEqual({ obdRefs: 0, canRefs: 0 });
  });
});

describe('KİLİT 5 — yeni timer/polling YOK', () => {
  it('saf kurucular çağrıldığında hiçbir zamanlayıcı kurulmaz', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    const snap = snapshot();
    buildInspectorCards(snap);
    detectMismatches(buildMismatchInput(snap));
    deriveSessionHealth(buildHealthInput(snap, 0));
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Müdahale yüzeyi yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 + 17 — reconnect/reset/recover/command/ECU-write yüzeyi YOK', () => {
  it('ekran markup\'ında yalnız YENİLE kontrolü var', () => {
    const html = renderToStaticMarkup(<SessionInspectorHarness />);
    expect(html).toContain('session-refresh');
    for (const banned of [
      'RECONNECT', 'YENİDEN BAĞLAN', 'SIFIRLA', 'RESET', 'KURTAR', 'RECOVER',
      'GÖNDER', 'DTC SİL', 'TARAMA BAŞLAT',
    ]) expect(html).not.toContain(banned);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toContain('type="submit"');
  });

  it('modüller hiçbir müdahale API\'si dışa vermez', async () => {
    const model = await import('../platform/devtools/sessionInspectorModel');
    const build = await import('../platform/devtools/sessionInspectorBuild');
    const src   = await import('../platform/devtools/sessionInspectorSources');
    const names = [...Object.keys(model), ...Object.keys(build), ...Object.keys(src)]
      .map((n) => n.toLowerCase());
    for (const f of ['reconnect', 'reset', 'recover', 'sendcommand', 'writeecu', 'cleardtc', 'startscan']) {
      expect(names).not.toContain(f);
    }
    expect(names).toContain('readsessionrawsnapshot');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–9 · Sınıflandırma dürüstlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — OBSERVED değerler gerçek kaynaklara dayanıyor', () => {
  it('her alan gerçek bir kaynak etiketi taşır', () => {
    const cards = buildInspectorCards(snapshot());
    for (const c of cards) {
      for (const f of c.fields) {
        expect(typeof f.source).toBe('string');
        expect(f.source.length).toBeGreaterThan(0);
        if (f.klass === 'OBSERVED' || f.klass === 'DERIVED' || f.klass === 'STALE') {
          expect(f.source).not.toBe('YOK');
        }
      }
    }
  });

  it('gerçek alanlar doğru okunur', () => {
    const cards = buildInspectorCards(snapshot());
    expect(findField(cards, 'connectionState')!.value).toBe('connected');
    expect(findField(cards, 'protocolActive')!.value).toBe('6');
    expect(findField(cards, 'supportedCount')!.value).toBe('31');
    expect(findField(cards, 'sessionReady')!.klass).toBe('OBSERVED');
  });

  it('altı katman kartı doğru sırayla üretilir', () => {
    const cards = buildInspectorCards(snapshot());
    expect(cards.map((c) => c.id)).toEqual([...INSPECTOR_CARD_ORDER]);
  });

  it('değer null/boş ise OBSERVED değil UNAVAILABLE olur (sahte değer yok)', () => {
    const f = observed({ id: 'x', label: 'x', source: 's', note: 'n' }, null);
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(observed({ id: 'x', label: 'x', source: 's', note: 'n' }, '').klass).toBe('UNAVAILABLE');
  });
});

describe('KİLİT 8 — DERIVED değerlerin SAF ve test edilebilir kuralı var', () => {
  it('protokol tutarlılığı kuralı: tried === active', () => {
    const same = buildInspectorCards(snapshot());
    expect(findField(same, 'protocolMatch')!.value).toBe('EŞLEŞİYOR');
    expect(findField(same, 'protocolMatch')!.klass).toBe('DERIVED');
    expect(findField(same, 'protocolMatch')!.note).toContain('KURAL:');

    const diff = buildInspectorCards(snapshot({
      handshake: { ...snapshot().handshake!, protocolTried: '6', protocolActive: '5' },
    }));
    expect(findField(diff, 'protocolMatch')!.value).toBe('FARKLI');
  });

  it('KWP tavan kuralı: recoveryCount >= maxPerSession', () => {
    const atLimit = buildInspectorCards(snapshot({
      kwp: {
        status: 'FAILED', coreNoDataStreak: 4, maxCoreNoDataStreak: 6, recoveryCount: 3,
        suppressedCount: 2, atpcSendFailures: 0, lastRecoveryAt: NOW - 5_000,
        lastRecoveryToFirstPidMs: -1, killedByDataGate: 1, protocolAtRecovery: '5',
        threshold: 4, maxPerSession: 3,
      },
    }));
    const f = findField(atLimit, 'kwpAtLimit')!;
    expect(f.klass).toBe('DERIVED');
    expect(f.value).toBe('EVET');
    expect(f.note).toContain('KURAL:');
  });

  it('türetme girdisi eksikse DERIVED değil UNAVAILABLE olur', () => {
    const cards = buildInspectorCards(snapshot({
      handshake: { ...snapshot().handshake!, protocolActive: null },
    }));
    expect(findField(cards, 'protocolMatch')!.klass).toBe('UNAVAILABLE');
    expect(derived({ id: 'x', label: 'x', source: 's', note: 'n' }, null).klass).toBe('UNAVAILABLE');
  });
});

describe('KİLİT 9 — eksik protocol/session/source alanları UNAVAILABLE gösteriliyor', () => {
  it('kaynağı olmayan alanlar (poll kadansı · kuyruk · keep-alive) UNAVAILABLE', () => {
    const cards = buildInspectorCards(snapshot());
    for (const id of ['pollCadence', 'commandQueue', 'keepAlive']) {
      const f = findField(cards, id)!;
      expect(f.klass).toBe('UNAVAILABLE');
      expect(f.value).toBe('—');
      expect(f.source).toBe('YOK');
    }
  });

  it('ölü debugStore alanları UNAVAILABLE ve nedeni yazılı', () => {
    const cards = buildInspectorCards(snapshot());
    const hz = findField(cards, 'hzCounters')!;
    expect(hz.klass).toBe('UNAVAILABLE');
    expect(hz.note).toContain('YAZAN kod YOK');
    const fb = findField(cards, 'fallbackStatus')!;
    expect(fb.klass).toBe('UNAVAILABLE');
    expect(fb.note).toContain('ÇAĞIRANI YOK');
  });

  it('KWP kanıtı yoksa uydurulmaz — neden açıkça yazılır', () => {
    const cards = buildInspectorCards(snapshot({ kwp: null }));
    const f = findField(cards, 'kwpEvidence')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('tazeleme TETİKLEMEZ');
  });

  it('HAL sourceHealth null = BİLİNMİYOR → UNAVAILABLE (false ile karıştırılmaz)', () => {
    const cards = buildInspectorCards(snapshot());
    const canAlive = findField(cards, 'halCanAlive')!;   // fixture: null
    expect(canAlive.klass).toBe('UNAVAILABLE');
    expect(canAlive.note).toContain('KARIŞTIRILMAZ');

    const obdAlive = findField(cards, 'halObdAlive')!;   // fixture: true
    expect(obdAlive.klass).toBe('OBSERVED');

    const dead = buildInspectorCards(snapshot({ hal: { ...snapshot().hal!, obdAlive: false } }));
    expect(findField(dead, 'halObdAlive')!.klass).toBe('OBSERVED');
    expect(findField(dead, 'halObdAlive')!.value).toBe('false');
  });

  it('kaynak tamamen okunamadıysa kart UNAVAILABLE alanla döner (çökmez)', () => {
    const cards = buildInspectorCards(snapshot({
      handshake: null, sessionHealth: null, health: null, hal: null, connectivity: null,
      capture: null, debug: null, connLifecycle: null,
    }));
    expect(cards).toHaveLength(6);
    expect(findField(cards, 'handshake')!.klass).toBe('UNAVAILABLE');
    expect(findField(cards, 'hal')!.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · Çelişkiler sessizce ezilmiyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — çelişen kaynaklar sessizce EZİLMİYOR', () => {
  it('connected iken transportConnected=false → mismatch, iki taraf da görünür', () => {
    const m = detectMismatches(mismatchInput({ transportConnected: false }));
    expect(m).toHaveLength(1);
    expect(m[0].aValue).toBe('connected');
    expect(m[0].bValue).toBe('false');
    expect(m[0].aSource).not.toBe(m[0].bSource);
  });

  it('bağımsız watchdog\'lar çelişince ayrı ayrı raporlanır', () => {
    const m = detectMismatches(mismatchInput({
      transportReady: false, connectivityObdConnected: false, halObdAlive: false,
    }));
    const ids = m.map((x) => x.id);
    expect(ids).toContain('state-vs-sessionhealth');
    expect(ids).toContain('state-vs-connectivity');
    expect(ids).toContain('state-vs-hal');
  });

  it('iki tazelik motoru zıt sonuç verirse yakalanır', () => {
    const m = detectMismatches(mismatchInput({ dataFresh: true, healthIsStale: true }));
    expect(m.map((x) => x.id)).toContain('fresh-vs-stale');
  });

  it('protokol tried/active farkı araç değişimi olarak işaretlenir', () => {
    const m = detectMismatches(mismatchInput({ protocolTried: '6', protocolActive: '5' }));
    const p = m.find((x) => x.id === 'protocol-tried-vs-active')!;
    expect(p.note).toContain('araç değişimi');
  });

  it('null (bilinmiyor) çelişki ÜRETMEZ — yokluk kanıt değildir', () => {
    expect(detectMismatches(mismatchInput({
      transportConnected: null, transportReady: null,
      connectivityObdConnected: null, halObdAlive: null,
    }))).toHaveLength(0);
  });

  it('çelişki listesi bounded', () => {
    const m = detectMismatches(mismatchInput({
      transportConnected: false, transportReady: false, connectivityObdConnected: false,
      halObdAlive: false, dataFresh: true, healthIsStale: true,
      protocolTried: '6', protocolActive: '5',
    }));
    expect(m.length).toBeLessThanOrEqual(MAX_MISMATCHES);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · Sahte bayatlık yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — timestamp\'i olmayan bilgi için STALE hesabı YAPILMIYOR', () => {
  it('damgasız alan asla STALE olmaz', () => {
    const f = observed({ id: 'x', label: 'x', source: 's', note: 'n' }, 'deger');
    expect(f.updatedAt).toBeNull();
    expect(applyStaleness(f, NOW, 1_000).klass).toBe('OBSERVED');
  });

  it('eşik yoksa (<=0) STALE hesaplanmaz', () => {
    const f = observed({ id: 'x', label: 'x', source: 's', note: 'n', updatedAt: NOW - 999_999 }, 'v');
    expect(applyStaleness(f, NOW, 0).klass).toBe('OBSERVED');
    expect(applyStaleness(f, NOW, -5).klass).toBe('OBSERVED');
  });

  it('gerçek damga + gerçek eşik varsa STALE verilir', () => {
    const f = observed({ id: 'x', label: 'x', source: 's', note: 'n', updatedAt: NOW - 30_000 }, 'v');
    const st = applyStaleness(f, NOW, 12_000);
    expect(st.klass).toBe('STALE');
    expect(st.note).toContain('eski');
  });

  it('geçersiz damga (0/negatif) null sayılır', () => {
    expect(observed({ id: 'x', label: 'x', source: 's', note: 'n', updatedAt: 0 }, 'v').updatedAt).toBeNull();
    expect(observed({ id: 'x', label: 'x', source: 's', note: 'n', updatedAt: -1 }, 'v').updatedAt).toBeNull();
  });

  it('MONOTONİK worker damgası bayatlık hesabına GİRMEZ', () => {
    const cards = buildInspectorCards(snapshot());
    const mono = findField(cards, 'halSourceHealthMono')!;
    expect(mono.klass).toBe('OBSERVED');       // STALE DEĞİL
    expect(mono.updatedAt).toBeNull();          // duvar saati damgası olarak kullanılmaz
    expect(mono.note).toContain('DUVAR SAATİ DEĞİL');
  });

  it('bayat ECU frame\'i gerçek eşikle STALE işaretlenir', () => {
    const cards = buildInspectorCards(snapshot({
      obdStatus: { connectionState: 'connected', source: 'real', vehicleType: 'diesel', lastSeenMs: NOW - 60_000 },
    }));
    expect(findField(cards, 'lastSeenMs')!.klass).toBe('STALE');
  });

  it('formatAge damgasızda null döner', () => {
    expect(formatAge(null, NOW)).toBeNull();
    expect(formatAge(NOW - 5_000, NOW)).toBe('5sn önce');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12 · Fail-closed özet
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 12 — genel sağlık özeti FAIL-CLOSED', () => {
  it('connectionState okunamazsa UNKNOWN', () => {
    expect(deriveSessionHealth(healthInput({ connectionState: null })).status).toBe('UNKNOWN');
    expect(deriveSessionHealth(healthInput({ connectionState: '' })).status).toBe('UNKNOWN');
  });

  it('çelişki varsa ASLA CONNECTED olmaz → DEGRADED', () => {
    const r = deriveSessionHealth(healthInput({ mismatchCount: 1 }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons[0]).toContain('çelişki');
  });

  it('data gate kapalıyken tamamen sağlıklı GÖSTERİLMEZ', () => {
    const r = deriveSessionHealth(healthInput({ sessionReady: false }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons.join(' ')).toContain('DATA GATE');
  });

  it('yalnız bayat değer varken aktif bağlantı gibi gösterilmez', () => {
    const r = deriveSessionHealth(healthInput({ lastSeenMs: NOW - 60_000 }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons.join(' ')).toContain('eski');
  });

  it('KWP tavanı saklanmaz', () => {
    expect(deriveSessionHealth(healthInput({ kwpAtLimit: true })).status).toBe('DEGRADED');
    expect(deriveSessionHealth(healthInput({ kwpStatus: 'FAILED' })).reasons.join(' ')).toContain('FAILED');
  });

  it('simüle veri CONNECTED saydırmaz', () => {
    const r = deriveSessionHealth(healthInput({ dataSource: 'mock' }));
    expect(r.status).toBe('DEGRADED');
    expect(r.reasons.join(' ')).toContain('mock');
  });

  it('geçiş durumları (idle/scanning/connecting) UNKNOWN', () => {
    for (const st of ['idle', 'scanning', 'connecting']) {
      expect(deriveSessionHealth(healthInput({ connectionState: st })).status).toBe('UNKNOWN');
    }
  });

  it('disconnected + transport hazır değil → DISCONNECTED', () => {
    expect(deriveSessionHealth(healthInput({ connectionState: 'disconnected', transportReady: false })).status)
      .toBe('DISCONNECTED');
    expect(deriveSessionHealth(healthInput({ connectionState: 'error', transportReady: false })).status)
      .toBe('DISCONNECTED');
  });

  it('yalnız TÜM eksenler sağlamsa CONNECTED', () => {
    const r = deriveSessionHealth(healthInput());
    expect(r.status).toBe('CONNECTED');
    expect(r.reasons).toHaveLength(1);
  });

  it('eşik yoksa bayatlık gerekçesi ÜRETİLMEZ (uydurma eşik yok)', () => {
    const r = deriveSessionHealth(healthInput({ lastSeenMs: NOW - 999_999, freshWindowMs: 0 }));
    expect(r.status).toBe('CONNECTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13–14 · Regresyon + bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 13 — DebugPanel davranışı değişmiyor', () => {
  it('ObdRawView maskeleme importu yok, DebugPanel ortak hook kullanıyor', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/components/debug/ObdRawView.tsx', 'utf8')).not.toContain('obdTrafficMask');
    const dp = readFileSync('src/components/debug/DebugPanel.tsx', 'utf8');
    expect(dp).toContain('useObdTrafficCapture');
    expect(dp).not.toContain('sessionInspector');
  });
});

describe('KİLİT 14 — liste/snapshot BOUNDED', () => {
  it('kart alanları tavanla sınırlanır', () => {
    const many = Array.from({ length: MAX_FIELDS_PER_CARD + 25 }, (_, i) =>
      unavailable({ id: `f${i}`, label: `f${i}`, source: 's', note: 'n' }));
    const bounded = boundCard({ id: 'transport', title: 't', fields: many });
    expect(bounded.fields).toHaveLength(MAX_FIELDS_PER_CARD);
  });

  it('anlık görüntü ham telemetri dizisi TAŞIMAZ (yalnız sayaç)', () => {
    const cards = buildInspectorCards(snapshot());
    for (const c of cards) {
      for (const f of c.fields) {
        expect(typeof f.value).toBe('string');
        expect(f.value.length).toBeLessThan(200);
      }
    }
  });

  it('sınıf sayaçları hesaplanır', () => {
    const counts = countByClass(buildInspectorCards(snapshot()));
    expect(counts.OBSERVED).toBeGreaterThan(0);
    expect(counts.UNAVAILABLE).toBeGreaterThan(0);
    expect(counts.DERIVED).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16 · Doğrulanmamış iddia yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 16 — "çalışıyor"/"sağlıklı" gibi doğrulanmamış iddia YOK', () => {
  it('katalog metinlerinde saha iddiası yok', () => {
    const t = getCarosLabTool('session-inspector')!;
    const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
    for (const banned of ['yakında', 'sağlıklı', 'çalışıyor', 'sorunsuz', 'doğrulandı']) {
      expect(text).not.toContain(banned);
    }
  });

  it('tüm katalog hâlâ belirsiz dil içermiyor', () => {
    for (const t of CAROS_LAB_TOOLS) {
      const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
      expect(text).not.toContain('yakında');
      expect(text).not.toContain('coming soon');
    }
  });

  it('özet metni bir İDDİA değil, sinyal özeti olduğunu söyler', () => {
    const html = renderToStaticMarkup(<SessionInspectorHarness />);
    expect(html).toContain('sağlık İDDİASI değil');
    expect(html).toContain('SALT OKUNUR');
  });

  it('CONNECTED gerekçesi bile "sağlıklı" demez, eksenleri sayar', () => {
    const r = deriveSessionHealth(healthInput());
    expect(r.reasons[0]).toContain('eksen');
    expect(r.reasons[0].toLowerCase()).not.toContain('sağlıklı');
  });
});

/* Harness: ekran mount'ta YALNIZ senkron getter çağırır; jsdom'da bu getter'lar
   gerçek (boş/idle) modül durumlarını okur — hiçbir servis başlamaz. */
function SessionInspectorHarness() {
  return <SessionInspectorScreen />;
}
