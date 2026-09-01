/**
 * carosLabRuntimeScheduling.test.tsx — CAROS LAB Faz A4 KİLİTLERİ (20).
 *
 * ANA İLKE: "global queue/scheduler" YOKTUR. Kilitler ayrı runtime otoritelerinin
 * sessizce tekleştirilmediğini, bilinmeyen kuyruk derinliğinin 0 gösterilmediğini,
 * yan etkili getter'ların çağrılmadığını ve özetin fail-closed olduğunu doğrular.
 *
 * Model + kanal kurucuları TAMAMEN SAF (servis importu yok) → mock'suz test edilir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  schedObserved, schedDerived, schedUnavailable, schedUnsafe,
  schedApplyStaleness, schedFormatAge, boundChannel,
  detectSchedConflicts, deriveRuntimeSummary, summarizeChannels, countBySchedClass,
  SCHED_CHANNEL_ORDER, MAX_FIELDS_PER_CHANNEL, MAX_SCHED_CONFLICTS,
  type SchedChannel, type SchedConflictInput, type RuntimeSummaryInput,
} from '../platform/devtools/runtimeSchedulingModel';
import {
  buildSchedChannels, buildSchedConflictInput, buildRuntimeSummaryInput,
  type SchedRawSnapshot,
} from '../platform/devtools/runtimeSchedulingBuild';
import { _resetDevtoolsCaptureForTest, _devtoolsCaptureRefs } from '../platform/devtools/devtoolsCapture';
import { isCarosLabAllowed, shouldRenderCarosLab } from '../platform/devtools/carosLabGate';
import { getCarosLabTool, resolveToolActivation, CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { carosLabNavReduce, CAROS_LAB_INITIAL_NAV } from '../platform/devtools/carosLabNavigation';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { CarosLabShell } from '../components/devtools/CarosLabShell';
import { RuntimeSchedulingScreen } from '../components/devtools/screens/RuntimeSchedulingScreen';
import { useDebugStore } from '../platform/debug';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

const COUNTERS = {
  pollCycles: 120, burstCycles: 0, roundRobinCycles: 120,
  attempted: 900, success: 700, noData: 150, busy: 10,
  negativeResponse: 5, error: 3, timeoutNoBytes: 20, timeoutPartial: 12,
  parseFailure: 0, cancelled: 0, unknownFailure: 0, callbackEmitted: 690, maxBurstSizeObserved: 4,
};

function snapshot(over: Partial<SchedRawSnapshot> = {}): SchedRawSnapshot {
  return {
    readAt: NOW,
    pollEvidence: {
      present: true, evidenceComplete: true, transport: 'classic', burstEnabled: false,
      burstIntent: false, lastCycleWasBurst: false,
      configuredPidCount: 12, counters: COUNTERS,
      lastAttemptedPid: '010C', lastSuccessfulPid: null, lastOutcome: 'SUCCESS',
      lastElapsedMs: 42, lastPollAt: NOW - 800, decisionLabel: 'HAT SAĞLIKLI',
      js: { eventsReceived: 690, decodeFailures: 0, valuesStored: 690, valuesCached: 12 },
    },
    sessionHealth: { pollingActive: true, dataFresh: true, transportReady: true, sessionReady: true },
    obdStatus: { connectionState: 'connected', source: 'real', lastSeenMs: NOW - 600 },
    health: { isStale: false, lastPacketAgeMs: 600 },
    freshWindowMs: 12_000,
    handshake: {
      outcome: 'success', ranAt: NOW - 120_000, durationMs: 4200,
      timeoutStage: null, failReason: null, lastSuccessAt: NOW - 120_000,
    },
    kwp: null,
    deepScan: {
      status: 'idle', phase: null, progressPercent: 0,
      startedAt: null, updatedAt: null, completedAt: null, warningsCount: 0, errorCode: null,
    },
    canCollect: { collecting: false, bufferLen: 0, bufferMax: 500 },
    capture: { obdRefs: 0, canRefs: 0 },
    ...over,
  };
}

function conflictInput(over: Partial<SchedConflictInput> = {}): SchedConflictInput {
  return {
    pollingTimerActive: true, dataFresh: true, healthIsStale: false,
    burstIntent: false, lastCycleWasBurst: false, burstCycles: null,
    liveDataScreenOpen: false, kwpAtLimit: null, kwpStatus: null,
    ...over,
  };
}

function summaryInput(over: Partial<RuntimeSummaryInput> = {}): RuntimeSummaryInput {
  return {
    runningChannels: 0, blockedChannels: 0, unknownChannels: 0, notRunningChannels: 0,
    conflicts: 0, queueDepthKnown: false, activeJobKnown: false,
    ...over,
  };
}

function findField(channels: readonly SchedChannel[], id: string) {
  for (const c of channels) for (const f of c.fields) if (f.id === id) return f;
  return null;
}

function channel(channels: readonly SchedChannel[], id: string) {
  return channels.find((c) => c.id === id)!;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

beforeEach(() => {
  _resetDevtoolsCaptureForTest();
  useDebugStore.setState({ canRawLog: [], obdTrafficLog: [], collecting: false });
});

afterEach(() => { vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1–2 · Kapı + mount koşulu
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — developer gate korunuyor', () => {
  it('kapı fail-closed', () => {
    /* 2026-07-26: kapı ROL DEĞİL, TEK derleme bayrağıdır — fail-closed korunur. */
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true })).toBe(true);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
  });
});

describe('KİLİT 2 + 18 — seçilmeden mount olmuyor; lazy chunk korunuyor', () => {
  it('shell katalog görünümünde runtime scheduling markup\'ı basılmaz', () => {
    const html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(html).not.toContain('runtime-scheduling');
    expect(html).not.toContain('RUNTIME:');
  });

  it('Queue Monitor ve Poll Scheduler AYNI ekrana çözülür ve ikisi de lazy', () => {
    for (const id of ['queue-monitor', 'poll-scheduler'] as const) {
      const tool = getCarosLabTool(id)!;
      expect(tool.status).toBe('AVAILABLE');
      expect(resolveToolActivation(tool)).toBe(id);
      const el = renderAvailableTool(id);
      expect(el).not.toBeNull();
      const type = (el as { type?: unknown }).type as { $$typeof?: symbol } | undefined;
      expect(type?.$$typeof).toBe(Symbol.for('react.lazy'));
    }
    const nav = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: 'queue-monitor' });
    expect(nav.activeId).toBe('queue-monitor');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3–6 · Yaşam döngüsü + müdahale yüzeyi
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 + 10 — mount motor başlatmıyor; YAN ETKİLİ getter\'lar çağrılmıyor', () => {
  it('kaynak okuyucu yan etkili/async yolları İÇERMEZ', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/runtimeSchedulingSources.ts', 'utf8'));

    const FORBIDDEN = [
      // TEMBEL SİNGLETON OLUŞTURAN getter — import bile edilmemeli
      'getLiveDiscoveryCoordinator', 'discoveryLive',
      // ASYNC native pull
      'refreshExtendedPollEvidence', 'refreshKwpRecoveryEvidence', 'await ',
      // motor başlatma / müdahale
      'startDeepScan', 'startScan', 'connectOBD', 'disconnectOBD', 'reconnect(',
      'setDiagnosticBurst', 'sendCommand', 'clearDTC', 'setCollecting',
      // zamanlayıcı
      'setInterval', 'setTimeout',
    ];
    for (const f of FORBIDDEN) expect(src).not.toContain(f);

    for (const g of [
      'getObdSessionHealth', 'getExtendedPollEvidence', 'getKwpRecoveryEvidence',
      'deepScanRuntimeService.getSnapshot', 'getDevtoolsCaptureStatus',
    ]) expect(src).toContain(g);
  });

  /* SAHA (snapshot 2026-07-25): bu kilit `useEffect`i TÜMDEN yasaklıyordu. Sonuç körlük
     oldu — native kanıt önbelleğini yalnız tanı raporu yolu dolduruyordu, bu yüzden LAB'da
     alan cihazda poll ÇALIŞIRKEN bile hep "Kanıt mevcut değil (eski APK…)" gösteriyordu.
     Kilit KALDIRILMADI, gerçek değişmeze DARALTILDI: timer/abonelik/polling YASAK, komut
     ve motor yüzeyi YASAK, unmount sonrası setState YASAK — tek atış salt-okunur SAYAÇ
     tazelemesi serbest. */
  it('ekran bileşeni timer/abonelik/polling kurmaz (tek atış sayaç tazelemesi hariç)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(
      readFileSync('src/components/devtools/screens/RuntimeSchedulingScreen.tsx', 'utf8'));
    for (const f of ['setInterval', 'setTimeout', 'subscribe', 'addListener']) {
      expect(src).not.toContain(f);
    }
    // Komut / motor / müdahale yüzeyi hâlâ YASAK
    for (const f of [
      'sendCommand', 'connectOBD', 'disconnectOBD', 'reconnect(', 'startDeepScan',
      'setDiagnosticBurst', 'clearDTC', 'setCollecting',
    ]) expect(src).not.toContain(f);
    // İzin verilen TEK async çağrı: salt-okunur native sayaç kanıtı
    expect(src).toContain('refreshExtendedPollEvidence');
    // Açılış efekti TEK ATIŞ olmalı — polling'e dönüşmesin (bağımlılık: kararlı refresh)
    expect(src).toMatch(/useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\)/);
    // Zero-leak: unmount sonrası setState yapılmamalı
    expect(src).toContain('mountedRef.current = false');
    expect(src).toMatch(/if \(mountedRef\.current\) setSnap/);
  });

  it('shell render edilince yakalama referansı 0 kalır', () => {
    renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
  });
});

describe('KİLİT 4 — yeni timer/polling YOK', () => {
  it('saf kurucular hiçbir zamanlayıcı kurmaz', () => {
    const iv = vi.spyOn(globalThis, 'setInterval');
    const to = vi.spyOn(globalThis, 'setTimeout');
    const s = snapshot();
    const ch = buildSchedChannels(s);
    detectSchedConflicts(buildSchedConflictInput(s));
    deriveRuntimeSummary(buildRuntimeSummaryInput(ch, 0, summarizeChannels(ch)));
    expect(iv).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });
});

describe('KİLİT 5 + 6 — kontrol düğmesi ve ham komut/ECU write/DTC clear YOK', () => {
  it('ekranda yalnız YENİLE var', () => {
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen />);
    expect(html).toContain('sched-refresh');
    for (const banned of [
      'KUYRUĞU TEMİZLE', 'DURDUR', 'BAŞLAT', 'DURAKLAT', 'HIZI DEĞİŞTİR',
      'RECONNECT', 'KURTAR', 'GÖNDER', 'DTC SİL', 'TARAMA BAŞLAT',
    ]) expect(html).not.toContain(banned);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toContain('type="submit"');
  });

  it('modüller müdahale API\'si dışa vermez', async () => {
    const model = await import('../platform/devtools/runtimeSchedulingModel');
    const build = await import('../platform/devtools/runtimeSchedulingBuild');
    const src   = await import('../platform/devtools/runtimeSchedulingSources');
    const names = [...Object.keys(model), ...Object.keys(build), ...Object.keys(src)]
      .map((n) => n.toLowerCase());
    for (const f of [
      'drainqueue', 'clearqueue', 'pausequeue', 'resumequeue', 'setpollrate',
      'setpriority', 'reconnect', 'recover', 'sendcommand', 'cleardtc', 'startscan',
    ]) expect(names).not.toContain(f);
    expect(names).toContain('readschedrawsnapshot');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Otoriteler tekleştirilmiyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — birden fazla runtime otoritesi sessizce TEKLEŞTİRİLMİYOR', () => {
  it('altı kanal ayrı ayrı üretilir ve her birinin AYRI otorite adı vardır', () => {
    const ch = buildSchedChannels(snapshot());
    expect(ch.map((c) => c.id)).toEqual([...SCHED_CHANNEL_ORDER]);
    const authorities = ch.map((c) => c.authority);
    expect(new Set(authorities).size).toBe(authorities.length);   // hepsi farklı
  });

  it('native ve JS otoriteleri açıkça ayrılır', () => {
    const ch = buildSchedChannels(snapshot());
    expect(channel(ch, 'command-exec').authority).toContain('NATIVE');
    expect(channel(ch, 'live-polling').authority).toContain('JS');
    expect(channel(ch, 'kwp').authority).toContain('NATIVE');
    expect(channel(ch, 'can-collect').authority).toContain('JS');
  });

  it('discovery ve deep scan AYNI kanalda ama İKİ AYRI motor olarak beyan edilir', () => {
    const ch = buildSchedChannels(snapshot());
    expect(channel(ch, 'discovery-deepscan').authority).toContain('İKİ AYRI motor');
  });

  it('her kanalın kendi aktivite kararı ve gerekçesi vardır', () => {
    for (const c of buildSchedChannels(snapshot())) {
      expect(['RUNNING', 'NOT_RUNNING', 'BLOCKED', 'UNKNOWN']).toContain(c.activity);
      expect(c.activityNote.length).toBeGreaterThan(10);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8–9 · Bilinmeyen alan sahte değerle doldurulmuyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — bilinmeyen queue depth 0 GÖSTERİLMİYOR', () => {
  it('komut kuyruğu derinliği her koşulda UNAVAILABLE ve değeri "—"', () => {
    for (const s of [snapshot(), snapshot({ pollEvidence: null })]) {
      const f = findField(buildSchedChannels(s), 'cmdQueueDepth')!;
      expect(f.klass).toBe('UNAVAILABLE');
      expect(f.value).toBe('—');
      expect(f.value).not.toBe('0');
      expect(f.note).toContain('VARSAYILMAZ');
    }
  });

  it('discovery aday kuyruğu da boş varsayılmaz', () => {
    const f = findField(buildSchedChannels(snapshot()), 'discoveryQueueDepth')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
  });

  it('kanıt önbelleği boşken sayaçlar 0 olarak BASILMAZ', () => {
    const ch = buildSchedChannels(snapshot({ pollEvidence: null }));
    expect(findField(ch, 'cmdPollCycles')).toBeNull();          // alan hiç üretilmez
    const ev = findField(ch, 'cmdEvidence')!;
    expect(ev.klass).toBe('UNAVAILABLE');
    expect(ev.note).toContain('0 olarak GÖSTERİLMEZ');
    expect(channel(ch, 'command-exec').activity).toBe('UNKNOWN');
  });

  it('present=false gelen kanıt da UNAVAILABLE sayılır (sahte sıfır yok)', () => {
    const ch = buildSchedChannels(snapshot({
      pollEvidence: { ...snapshot().pollEvidence!, present: false, counters: null },
    }));
    expect(findField(ch, 'cmdEvidence')!.klass).toBe('UNAVAILABLE');
  });
});

describe('KİLİT 9 — bilinmeyen poll cadence sahte değerle DOLDURULMUYOR', () => {
  it('aktif poll kadansı UNAVAILABLE ve gerekçesi yazılı', () => {
    const f = findField(buildSchedChannels(snapshot()), 'pollCadence')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(f.note).toContain('SAKLAMAZ');
    expect(f.source).toBe('YOK');
  });

  it('fast/slow grup dağılımı da UNAVAILABLE', () => {
    expect(findField(buildSchedChannels(snapshot()), 'pollFastSlowGroups')!.klass).toBe('UNAVAILABLE');
  });

  it('keep-alive zamanlaması UNAVAILABLE', () => {
    expect(findField(buildSchedChannels(snapshot()), 'kwpKeepAlive')!.klass).toBe('UNAVAILABLE');
  });

  it('CAN frame hızı UNAVAILABLE (yazan kod yok)', () => {
    const f = findField(buildSchedChannels(snapshot()), 'canFrameRate')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('YAZAN kod YOK');
  });

  /* SAHA (2026-07-25): bu kilit eskiden "senkron kanıt lastPollAt TAŞIMAZ" sınırlamasını
     değişmez sanıyordu. Sınırlama giderildi (alan artık anlık görüntüye taşınıyor ve ekran
     kanıtı tazeliyor). Kilit KALDIRILMADI: asıl değişmez "damga UYDURULMAZ"dır — hem
     yokluk hem varlık yönü kilitlenir. */
  it('lastPollAt yoksa UNAVAILABLE — damga UYDURULMAZ', () => {
    const ch = buildSchedChannels(snapshot({
      pollEvidence: { ...snapshot().pollEvidence!, lastPollAt: null },
    }));
    const f = findField(ch, 'cmdLastPollAt')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(f.updatedAt).toBeNull();
    expect(f.note).not.toContain('ASYNC pull');   // artık geçerli mazeret DEĞİL
  });

  it('lastPollAt VARSA gösterilir — alan kalıcı KÖR değildir', () => {
    const f = findField(buildSchedChannels(snapshot()), 'cmdLastPollAt')!;
    expect(f.klass).not.toBe('UNAVAILABLE');
    expect(f.updatedAt).toBe(NOW - 800);
    expect(f.value).toBe(new Date(NOW - 800).toISOString());
  });

  it('son BAŞARILI PID: yoksa UNAVAILABLE, varsa ÖLÇÜLDÜ ("denendi" ile karıştırılmaz)', () => {
    const blind = findField(buildSchedChannels(snapshot()), 'cmdLastSuccessPid')!;
    expect(blind.klass).toBe('UNAVAILABLE');   // fixture: lastSuccessfulPid = null
    const ch = buildSchedChannels(snapshot({
      pollEvidence: { ...snapshot().pollEvidence!, lastSuccessfulPid: '0105' },
    }));
    const f = findField(ch, 'cmdLastSuccessPid')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('0105');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10b · UNSAFE_TO_OBSERVE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 10 — yan etkili getter UNSAFE_TO_OBSERVE olarak işaretlenir', () => {
  it('discovery koordinatör durumu okunmaz, gerekçesi yazılır', () => {
    const f = findField(buildSchedChannels(snapshot()), 'discoveryStatus')!;
    expect(f.klass).toBe('UNSAFE_TO_OBSERVE');
    expect(f.value).toBe('—');
    expect(f.note).toContain('YOKSA OLUŞTURUR');
  });

  it('UNSAFE kanal NOT_RUNNING ilan edilmez (fail-closed)', () => {
    const ch = buildSchedChannels(snapshot());
    const c = channel(ch, 'discovery-deepscan');
    expect(c.activity).not.toBe('NOT_RUNNING');
    expect(c.activityNote).toContain('okunmadı');
  });

  it('schedUnsafe kurucusu değer taşımaz', () => {
    const f = schedUnsafe({ id: 'x', label: 'x', source: 's', note: '' }, 'yan etki');
    expect(f.klass).toBe('UNSAFE_TO_OBSERVE');
    expect(f.value).toBe('—');
    expect(f.updatedAt).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–13 · Sınıflandırma dürüstlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — OBSERVED alanlar gerçek snapshot kaynağına bağlı', () => {
  it('her OBSERVED/DERIVED/STALE alanın gerçek kaynak etiketi var', () => {
    for (const c of buildSchedChannels(snapshot())) {
      for (const f of c.fields) {
        expect(f.source.length).toBeGreaterThan(0);
        if (f.klass === 'OBSERVED' || f.klass === 'DERIVED' || f.klass === 'STALE') {
          expect(f.source).not.toBe('YOK');
        }
      }
    }
  });

  it('gerçek sayaçlar doğru okunur', () => {
    const ch = buildSchedChannels(snapshot());
    expect(findField(ch, 'cmdPollCycles')!.value).toBe('120');
    expect(findField(ch, 'cmdAttempted')!.value).toBe('900 / 700');
    expect(findField(ch, 'cmdFailures')!.value).toBe('150 / 32 / 3');   // timeoutNoBytes+Partial
    expect(findField(ch, 'pollTimerActive')!.klass).toBe('OBSERVED');
  });

  it('değer yoksa OBSERVED değil UNAVAILABLE olur', () => {
    expect(schedObserved({ id: 'x', label: 'x', source: 's', note: 'n' }, null).klass).toBe('UNAVAILABLE');
    expect(schedObserved({ id: 'x', label: 'x', source: 's', note: 'n' }, '').klass).toBe('UNAVAILABLE');
  });
});

describe('KİLİT 12 — DERIVED kurallar SAF ve test edilebilir', () => {
  it('mock motoru kuralı: source === "mock"', () => {
    expect(findField(buildSchedChannels(snapshot()), 'pollMockEngine')!.value).toBe('HAYIR');
    const mock = buildSchedChannels(snapshot({
      obdStatus: { connectionState: 'connected', source: 'mock', lastSeenMs: NOW - 100 },
    }));
    const f = findField(mock, 'pollMockEngine')!;
    expect(f.value).toBe('ÇALIŞIYOR');
    expect(f.klass).toBe('DERIVED');
    expect(f.note).toContain('KURAL:');
  });

  it('kanıt bütünlüğü kuralı: present && coherent', () => {
    expect(findField(buildSchedChannels(snapshot()), 'cmdEvidenceFreshness')!.value).toBe('TAM');
    const incomplete = buildSchedChannels(snapshot({
      pollEvidence: { ...snapshot().pollEvidence!, evidenceComplete: false },
    }));
    expect(findField(incomplete, 'cmdEvidenceFreshness')!.value).toBe('EKSİK');
  });

  /* #642 GÜNCELLEMESİ (saha 2026-08-19): tavan kararı ARDIŞIK BAŞARISIZ sayaca
     bakar; `recoveryCount` oturum TOPLAMIDIR ve tavanla ilgisi yoktur. Eski kilit
     yanlış kuralı koruyordu. Kaldırılmadı, GÜNCELLENDİ. */
  it('KWP tavan kuralı: ardışık BAŞARISIZ sayaç', () => {
    const base = {
      status: 'IN_PROGRESS', maxPerSession: 3, suppressedCount: 1,
      atpcSendFailures: 0, lastRecoveryAt: NOW - 4_000, coreNoDataStreak: 4, threshold: 4,
    };
    const ch = buildSchedChannels(snapshot({
      kwp: { ...base, recoveryCount: 3, consecutiveFailedRecoveries: 3 },
    }));
    const f = findField(ch, 'kwpAtLimit')!;
    expect(f.klass).toBe('DERIVED');
    expect(f.value).toBe('EVET');
    expect(f.note).toContain('KURAL');

    // Saha senaryosu: 4 tetik ama hepsi başarılı → seri 0 → tavan DOLU DEĞİL.
    const ok = buildSchedChannels(snapshot({
      kwp: { ...base, status: 'RECOVERED', recoveryCount: 4, consecutiveFailedRecoveries: 0 },
    }));
    expect(findField(ok, 'kwpAtLimit')!.value,
      'oturum toplamından tavan türetiliyor — sahadaki yalan geri geldi').toBe('HAYIR');

    // Sayaç yoksa BİLİNMİYOR.
    const unknown = buildSchedChannels(snapshot({
      kwp: { ...base, recoveryCount: 9, consecutiveFailedRecoveries: null },
    }));
    expect(findField(unknown, 'kwpAtLimit')!.klass).toBe('UNAVAILABLE');
  });

  it('türetme girdisi yoksa DERIVED üretilmez', () => {
    expect(schedDerived({ id: 'x', label: 'x', source: 's', note: 'n' }, null).klass).toBe('UNAVAILABLE');
  });
});

describe('KİLİT 13 — timestamp olmayan bilgi için STALE ÜRETİLMİYOR', () => {
  it('damgasız alan STALE olmaz', () => {
    const f = schedObserved({ id: 'x', label: 'x', source: 's', note: 'n' }, 'v');
    expect(f.updatedAt).toBeNull();
    expect(schedApplyStaleness(f, NOW, 1_000).klass).toBe('OBSERVED');
  });

  it('eşik yoksa STALE hesaplanmaz', () => {
    const f = schedObserved({ id: 'x', label: 'x', source: 's', note: 'n', updatedAt: NOW - 999_999 }, 'v');
    expect(schedApplyStaleness(f, NOW, 0).klass).toBe('OBSERVED');
  });

  it('gerçek damga + meşru eşik varsa STALE verilir', () => {
    const ch = buildSchedChannels(snapshot({
      obdStatus: { connectionState: 'connected', source: 'real', lastSeenMs: NOW - 60_000 },
    }));
    expect(findField(ch, 'pollLastSeen')!.klass).toBe('STALE');
  });

  it('handshake/deep scan gibi TANIMLI eşiği olmayan damgalar STALE OLMAZ', () => {
    const ch = buildSchedChannels(snapshot({
      handshake: { ...snapshot().handshake!, ranAt: NOW - 10_000_000 },
      deepScan: { ...snapshot().deepScan!, startedAt: NOW - 10_000_000, status: 'completed' },
    }));
    expect(findField(ch, 'hsRanAt')!.klass).toBe('OBSERVED');
    expect(findField(ch, 'deepStartedAt')!.klass).toBe('OBSERVED');
  });

  it('UNAVAILABLE/UNSAFE alanlar STALE\'e yükseltilemez', () => {
    const u = schedUnavailable({ id: 'x', label: 'x', source: 's', note: 'n' });
    expect(schedApplyStaleness(u, NOW, 1).klass).toBe('UNAVAILABLE');
    const s = schedUnsafe({ id: 'y', label: 'y', source: 's', note: '' }, 'r');
    expect(schedApplyStaleness(s, NOW, 1).klass).toBe('UNSAFE_TO_OBSERVE');
  });

  it('schedFormatAge damgasızda null', () => {
    expect(schedFormatAge(null, NOW)).toBeNull();
    expect(schedFormatAge(NOW - 5_000, NOW)).toBe('5sn önce');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14 · Çelişkiler görünür
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 14 — çelişkiler GÖRÜNÜR', () => {
  it('timer aktif ama dataFresh=false → çelişki (görevin ana kilidi)', () => {
    const c = detectSchedConflicts(conflictInput({ dataFresh: false }));
    expect(c.map((x) => x.id)).toContain('timer-vs-datafresh');
    expect(c[0].note).toContain('GELMEZ');
  });

  it('bu durumda kanal RUNNING ilan EDİLMEZ', () => {
    const ch = buildSchedChannels(snapshot({
      sessionHealth: { pollingActive: true, dataFresh: false, transportReady: true, sessionReady: true },
    }));
    const lp = channel(ch, 'live-polling');
    expect(lp.activity).toBe('UNKNOWN');
    expect(lp.activityNote).toContain('DENMEZ');
  });

  it('burst NİYETİ açık ama tüketici kapalı → çelişki', () => {
    const c = detectSchedConflicts(conflictInput({ burstIntent: true, liveDataScreenOpen: false }));
    expect(c.map((x) => x.id)).toContain('burst-vs-consumer');
  });

  /* B2 KİLİDİ — KAÇIRILAN UYARI (saha 2026-08-30 · CAROS LAB TAM KOPYA).
     Tek alan hem niyeti hem son turu taşırken, son tur round-robin olduğu an
     niyet siliniyor ve bu uyarı HİÇ üretilmiyordu. Niyet artık ezilemez. */
  it('🔒 son tur round-robin OLSA BİLE burst niyeti uyarısı üretilir', () => {
    const c = detectSchedConflicts(conflictInput({
      burstIntent: true, lastCycleWasBurst: false, burstCycles: 135, liveDataScreenOpen: false,
    }));
    expect(c.map((x) => x.id)).toContain('burst-vs-consumer');
  });

  it('🔒 niyet kapalı + tarihsel burst turları → "burst hiç çalışmadı" hükmü çürütülür', () => {
    const c = detectSchedConflicts(conflictInput({
      burstIntent: false, lastCycleWasBurst: false, burstCycles: 135,
    }));
    const hit = c.find((x) => x.id === 'burst-intent-vs-history');
    expect(hit).toBeDefined();
    expect(hit!.bValue).toContain('135');
  });

  it('🔒 son tur GÖZLEMİ tek başına çelişki üretmez (niyet yerine geçmez)', () => {
    const c = detectSchedConflicts(conflictInput({
      burstIntent: false, lastCycleWasBurst: true, burstCycles: 0, liveDataScreenOpen: false,
    }));
    expect(c.map((x) => x.id)).not.toContain('burst-vs-consumer');
  });

  it('null (bilinmiyor) çelişki üretmez', () => {
    expect(detectSchedConflicts(conflictInput({
      pollingTimerActive: null, dataFresh: null, healthIsStale: null,
      burstIntent: null, lastCycleWasBurst: null, burstCycles: null, liveDataScreenOpen: null,
    }))).toHaveLength(0);
  });

  it('çelişki listesi bounded', () => {
    const c = detectSchedConflicts(conflictInput({
      dataFresh: false, healthIsStale: true, burstIntent: true, liveDataScreenOpen: false,
      kwpAtLimit: true, kwpStatus: 'IN_PROGRESS',
    }));
    expect(c.length).toBeLessThanOrEqual(MAX_SCHED_CONFLICTS);
    expect(c.length).toBeGreaterThan(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15 · Fail-closed özet
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 15 — genel runtime özeti FAIL-CLOSED', () => {
  it('BLOKE kanal varsa BLOCKED', () => {
    expect(deriveRuntimeSummary(summaryInput({ blockedChannels: 1, runningChannels: 3 })).status).toBe('BLOCKED');
  });

  it('çelişki varsa ASLA ACTIVE olmaz', () => {
    const r = deriveRuntimeSummary(summaryInput({ conflicts: 1, runningChannels: 5, unknownChannels: 0 }));
    expect(r.status).toBe('PARTIAL');
  });

  it('çalışan kanal + bilinmeyen kanal varsa PARTIAL', () => {
    expect(deriveRuntimeSummary(summaryInput({ runningChannels: 2, unknownChannels: 3 })).status).toBe('PARTIAL');
  });

  it('ACTIVE yalnız bilinmeyen kanal YOKKEN verilir', () => {
    expect(deriveRuntimeSummary(summaryInput({ runningChannels: 2, unknownChannels: 0 })).status).toBe('ACTIVE');
  });

  it('IDLE yalnız kuyruk VE aktif iş biliniyorsa — bugün ulaşılamaz', () => {
    expect(deriveRuntimeSummary(summaryInput({ notRunningChannels: 6 })).status).toBe('UNKNOWN');
    expect(deriveRuntimeSummary(summaryInput({
      notRunningChannels: 6, queueDepthKnown: true, activeJobKnown: true,
    })).status).toBe('IDLE');
    // Üretim girdisi kuyruğu ASLA bilinir işaretlemez
    const ch = buildSchedChannels(snapshot());
    const inp = buildRuntimeSummaryInput(ch, 0, summarizeChannels(ch));
    expect(inp.queueDepthKnown).toBe(false);
    expect(inp.activeJobKnown).toBe(false);
  });

  it('hiçbir şey bilinmiyorsa UNKNOWN ve "boş kuyruk varsayılmaz" gerekçesi', () => {
    const r = deriveRuntimeSummary(summaryInput());
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.join(' ')).toContain('VARSAYILMAZ');
  });

  it('araç bağlantısı terimleri (CONNECTED/HEALTHY) KULLANILMAZ', () => {
    const all: string[] = [];
    for (const inp of [
      summaryInput({ runningChannels: 2 }), summaryInput({ blockedChannels: 1 }),
      summaryInput({ conflicts: 2 }), summaryInput(),
    ]) {
      const r = deriveRuntimeSummary(inp);
      all.push(r.status, ...r.reasons);
    }
    const joined = all.join(' ').toUpperCase();
    expect(joined).not.toContain('CONNECTED');
    expect(joined).not.toContain('HEALTHY');
    expect(joined).not.toContain('SAĞLIKLI');
  });

  it('gerçek fixture ile üretim yolu PARTIAL/UNKNOWN döner (ACTIVE değil)', () => {
    const ch = buildSchedChannels(snapshot());
    const counts = summarizeChannels(ch);
    const r = deriveRuntimeSummary(buildRuntimeSummaryInput(ch, 0, counts));
    expect(['PARTIAL', 'UNKNOWN']).toContain(r.status);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16–17 · Bounded + DebugPanel regresyonu
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 16 — liste/snapshot BOUNDED', () => {
  it('kanal alanları tavanla sınırlanır', () => {
    const many = Array.from({ length: MAX_FIELDS_PER_CHANNEL + 20 }, (_, i) =>
      schedUnavailable({ id: `f${i}`, label: `f${i}`, source: 's', note: 'n' }));
    const b = boundChannel({
      id: 'command-exec', authority: 'a', title: 't',
      activity: 'UNKNOWN', activityNote: 'n', fields: many,
    });
    expect(b.fields).toHaveLength(MAX_FIELDS_PER_CHANNEL);
  });

  it('alan değerleri kısa kalır (ham telemetri dökülmez)', () => {
    for (const c of buildSchedChannels(snapshot())) {
      for (const f of c.fields) expect(f.value.length).toBeLessThan(200);
    }
  });

  it('sınıf sayaçları hesaplanır', () => {
    const counts = countBySchedClass(buildSchedChannels(snapshot()));
    expect(counts.OBSERVED).toBeGreaterThan(0);
    expect(counts.UNAVAILABLE).toBeGreaterThan(0);
    expect(counts.UNSAFE_TO_OBSERVE).toBeGreaterThan(0);
  });
});

describe('KİLİT 17 — DebugPanel davranışı değişmiyor', () => {
  it('ObdRawView maskesiz kalır; DebugPanel ortak hook kullanır', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/components/debug/ObdRawView.tsx', 'utf8')).not.toContain('obdTrafficMask');
    const dp = readFileSync('src/components/debug/DebugPanel.tsx', 'utf8');
    expect(dp).toContain('useObdTrafficCapture');
    expect(dp).not.toContain('runtimeScheduling');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20 · Doğrulanmamış iddia yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 20 — saha doğrulaması olmadan "çalışıyor" iddiası YOK', () => {
  it('katalog metinleri iddia içermez', () => {
    for (const id of ['queue-monitor', 'poll-scheduler'] as const) {
      const t = getCarosLabTool(id)!;
      const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
      for (const banned of ['yakında', 'sağlıklı', 'sorunsuz', 'doğrulandı']) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it('tüm katalog belirsiz dil içermez', () => {
    for (const t of CAROS_LAB_TOOLS) {
      const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
      expect(text).not.toContain('yakında');
      expect(text).not.toContain('coming soon');
    }
  });

  /* Arayüz Türkçeleştirildi (2026-07-25): görünen metin artık Türkçe etiket kullanır
     (ACTIVE→ETKİN · IDLE→BOŞTA). Kilidin AMACI değişmedi — ekran "zamanlayıcı var =
     çalışıyor" iddiasını hâlâ AÇIKÇA reddetmeli. Ham enum `data-summary` özniteliğinde
     durduğu için makine sözleşmesi de ayrıca doğrulanır. */
  it('ekran metni "timer var = çalışıyor" iddiasını açıkça reddeder', () => {
    const html = renderToStaticMarkup(<RuntimeSchedulingScreen />);
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('tek başına ETKİN kanıtı sayılmaz');
    expect(html).toContain('BOŞTA varsayılmaz');
    // Ham enum sunumdan bağımsız olarak DOM'da beyan edilir (dile bağımlı değil).
    expect(html).toMatch(/data-summary="(ACTIVE|PARTIAL|IDLE|BLOCKED|UNKNOWN)"/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 21 (#506) — #503'ün ürettiği SESSİZLİĞİN SEBEBİ okunabilir olmalı
 *
 * #503 gürültüyü (NO-DATA fırtınası) sessizlikle takas etti: destek kanıtı yokken
 * hiçbir izlenen PID native'e gitmez. Doğru davranış, ama dışarıdan "poll ölü" ile
 * ayırt edilemezse Tarsus'ta teşhis EDİLEMEZ. Kapı alanları bu yüzden native kanıt
 * önbelleği BOŞKEN DE görünmelidir (JS modül durumundan okunur).
 * ════════════════════════════════════════════════════════════════════════ */

const GATE_OPEN = {
  supportedKnown: true, supportedCount: 15, watchedCount: 6, gatedCount: 0,
  gatedPids: [] as string[], discoveryPending: 0, nativeListCount: 6, burst: false,
  /* P0-OBD-CORE-06: kanıt TAM (continuation CLEAR ile bitmiş zincir). */
  discoveryCompleteness: 'complete',
};
const GATE_CLOSED = {
  supportedKnown: false, supportedCount: 0, watchedCount: 16, gatedCount: 16,
  gatedPids: ['04', '10', '33'], discoveryPending: 1, nativeListCount: 1, burst: false,
  discoveryCompleteness: 'not_run',
};

describe('KİLİT 21 — sessizliğin sebebi görünür (#503 gözlem borcu)', () => {
  it('kanıt yokken "DESTEK KANITI YOK → N PID BEKLEMEDE" yazar', () => {
    const ch = buildSchedChannels(snapshot({ extGate: GATE_CLOSED }));
    const gate = findField(ch, 'cmdGate')!;
    expect(gate.klass).toBe('OBSERVED');
    expect(String(gate.value)).toContain('DESTEK KANITI YOK');
    expect(String(gate.value)).toContain('16 PID BEKLEMEDE');
  });

  it('bekleyen PID\'ler ve kapıyı açacak keşif sorgusu ayrı okunur', () => {
    const ch = buildSchedChannels(snapshot({ extGate: GATE_CLOSED }));
    expect(String(findField(ch, 'cmdGatePids')!.value)).toContain('04');
    expect(findField(ch, 'cmdGateDiscovery')!.value).toBe('1');
    expect(String(findField(ch, 'cmdGateWatchers')!.value)).toBe('16 / 16 / 1');
  });

  it('kanıt yokken "0 destekli PID" İDDİA EDİLMEZ (UNAVAILABLE)', () => {
    const ch = buildSchedChannels(snapshot({ extGate: GATE_CLOSED }));
    const f = findField(ch, 'cmdGateSupported')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).not.toBe('0');   // sahte "0 destekli" YASAK
  });

  it('NATIVE KANIT ÖNBELLEĞİ BOŞKEN DE kapı görünür (asıl saha senaryosu)', () => {
    const ch = buildSchedChannels(snapshot({ pollEvidence: null, extGate: GATE_CLOSED }));
    const gate = findField(ch, 'cmdGate');
    expect(gate, 'kapı alanı present=false erken dönüşünde kayboluyor — sessizlik teşhis edilemez')
      .not.toBeNull();
    expect(String(gate!.value)).toContain('BEKLEMEDE');
  });

  it('kanıt varken kapı AÇIK okunur (sahte alarm üretmez)', () => {
    const ch = buildSchedChannels(snapshot({ extGate: GATE_OPEN }));
    const gate = findField(ch, 'cmdGate')!;
    /* P0-OBD-CORE-06 — KİLİT YENİ DOĞRU DAVRANIŞA GÜNCELLENDİ (kaldırılmadı):
       "kanıt VAR" iki farklı gerçeği aynı gösteriyordu. Zincir kesin bittiyse
       (continuation CLEAR) hüküm "kanıt TAM"dır; kırıldıysa hüküm VERİLEMEZ. */
    expect(String(gate.value)).toContain('kanıt TAM');
    expect(findField(ch, 'cmdGateSupported')!.value).toBe('15');
  });

  it('keşif KIRILDIYSA kapı "araç desteklemiyor" HÜKMÜ VERMEZ', () => {
    const ch = buildSchedChannels(snapshot({
      extGate: { ...GATE_OPEN, gatedCount: 86, discoveryCompleteness: 'incomplete' },
    }));
    const v = String(findField(ch, 'cmdGate')!.value);
    expect(v).toContain('KEŞİF EKSİK');
    expect(v).not.toContain('desteklemediği için');
  });

  it('bütünlük ÖLÇÜLMEDİYSE de "desteklemiyor" denmez (eski APK / eksik alan)', () => {
    const ch = buildSchedChannels(snapshot({
      extGate: { ...GATE_OPEN, gatedCount: 5, discoveryCompleteness: 'not_run' },
    }));
    const v = String(findField(ch, 'cmdGate')!.value);
    expect(v).toContain('ÖLÇÜLMEDİ');
    expect(v).not.toContain('desteklemediği için');
  });

  it('kapı durumu OKUNAMAZSA "açık" VARSAYILMAZ', () => {
    const ch = buildSchedChannels(snapshot({ extGate: null }));
    const f = findField(ch, 'cmdGate')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('BİLİNMİYOR');
  });
});
