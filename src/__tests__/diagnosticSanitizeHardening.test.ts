/**
 * diagnosticSanitizeHardening.test.ts — REGRESYON KASASI (Sanitize Hardening).
 *
 * Üç kanıtlı boşluk kilitlenir:
 *
 *  1. **selfTest bölümü sanitize'ı TAMAMEN atlıyordu.** `reportSelfTestSnapshot`
 *     raporu ham spread ediyordu (`{...base, selfTest}`) → deny-list, VIN/MAC/
 *     koordinat/api_key maskeleri ve derinlik tavanı UYGULANMIYORDU. Prob `detail`
 *     alanları SERBEST METİN taşır: ham `Error.message`, ham fetch hata metni,
 *     stack karesi/dosya yolu → maskesiz kanal.
 *
 *  2. **DENY_KEYS camelCase'e KÖRDÜ.** Eşleşme `key.toLowerCase()` idi; set'te
 *     `'api_key'` vardı → `apiKey`.toLowerCase() = `'apikey'` ≠ `'api_key'` →
 *     **sızıyordu**. Artık anahtar normalize edilir (alfanümerik olmayan atılır)
 *     ve TAM eşleşme yapılır.
 *
 *  3. **Cycle guard yoktu.** Özyinelemeyi sınırlayan tek şey MAX_DEPTH'ti; dairesel
 *     graf 6 kat açılıyordu ve getter/Proxy throw'u TÜM raporu düşürebiliyordu.
 *
 * ⚠️ EN KRİTİK KİLİT: cycle guard PAYLAŞILAN REFERANSI (DAG) cycle SANMAMALI.
 * Naif "görülen nesneler" seti aynı nesneyi iki KARDEŞ dalda görünce ikincisini
 * sessizce boşaltır — DTC `[null,null]` ile aynı sınıf sessiz veri kaybı.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    M.pushed.push({ type, payload });
  }),
  isDevicePaired: vi.fn(async () => true),
}));

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: () => ({
    connectionState: 'connected', source: 'ble', vehicleType: 'ice', lastSeenMs: 1765000001000,
  }),
  getOBDDataSnapshot: () => ({
    speed: 82, rpm: 3210, engineTemp: 96, fuelLevel: 42, throttle: 18,
    intakeTemp: 31, boostPressure: -1, batteryLevel: -1, range: -1, motorPower: -1,
  }),
  getTransportStats: () => ({ transport: 'ble', reconnectAttempts: 4, lastDisconnectReason: 'timeout' }),
}));

vi.mock('../platform/obd/ObdHealthMonitor', () => ({
  getObdHealth: () => ({
    connectionQuality: 41, lastPacketAgeMs: 320, reconnectPressure: 0.62,
    sensorReliability: { speed: 0.9, rpm: 0.88, engineTemp: 0.71 },
  }),
}));

vi.mock('../platform/obd/extendedPidService', () => ({
  getSupportedPids: () => new Set(['22F190', '221001', '222002']),
  getPidValue: (pid: string) => ({ def: { name: `EXT_${pid}` }, value: 42.5, updatedAt: 1765000000000 }),
}));

vi.mock('../platform/dtcService', () => ({
  getDTCStateSnapshot: () => ({
    codes: [
      { code: 'P0301', description: 'Silindir 1 tekleme', system: 'engine',   severity: 'critical', possibleCauses: ['buji'] },
      { code: 'P0420', description: 'Katalizör verimi',   system: 'emission', severity: 'warning',  possibleCauses: ['katalizör'] },
    ],
    isReading: false, isClearing: false,
    lastReadAt: 1765000000000, error: null, isStale: false,
  }),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0', overallHealth: 'healthy',
      services: [{ name: 'OBD', healthy: true, restartCount: 0, criticality: 'critical' }],
    }),
  },
}));

vi.mock('../platform/otaUpdateService', () => ({
  useOtaStore: { getState: () => ({ state: 'idle', errorCode: null, release: null, lastCheckTs: 0 }) },
  getCurrentVersionCode: vi.fn(async () => 7),
}));

/**
 * selfTestEngine mock'lanır: gerçek `runSelfTest()` gerçek fetch + 900 ms rAF
 * beklemesi + Worker kullanır → jsdom'da deterministik DEĞİL (gerçek motor
 * davranışı selfTestEngine.test.ts'in kapsamı — oraya dokunulmaz).
 *
 * `detail` alanları BİLEREK kirli: gerçek problar buraya ham Error mesajı, ham
 * fetch hatası ve stack karesi yazıyor (selfTestEngine.ts runProbe catch / probeBackend /
 * probeIdleRenderLoop). Sanitize hattı bunları maskelemeli.
 */
vi.mock('../platform/selfTestEngine', () => ({
  runSelfTest: vi.fn(async () => ({
    version: 1,
    totalMs: 2840,
    worst: 'warn',
    summary: { pass: 8, warn: 3, fail: 0, skip: 1 },
    env: { tier: 'low', webView: 88, cores: 4, memoryMb: 512 },
    results: [
      { name: 'localStorage', category: 'storage', status: 'pass',
        detail: 'yaz/oku/sil OK', durationMs: 3 },
      // ham fetch hata metni — içine sızmış sır + koordinat (probeBackend :157 sınıfı)
      { name: 'backend', category: 'network', status: 'fail',
        detail: 'ulaşılamadı: POST https://x.supabase.co/rpc?api_key=sk-canli-9999 failed at 41.0082, 28.9784',
        metric: 3500, durationMs: 3500 },
      // stack karesi + VIN + MAC (runProbe catch :89 / probeIdleRenderLoop :246 sınıfı)
      { name: 'idle-render', category: 'render', status: 'warn',
        detail: 'kaynak≈tick@FullMapView.tsx:814 · araç WVWZZZ1JZXW000001 · adaptör AA:BB:CC:DD:EE:FF',
        metric: 42, durationMs: 900 },
      { name: 'OBD', category: 'sensors', status: 'pass', detail: 'bağlı (ble)', durationMs: 5 },
      { name: 'izinler', category: 'permissions', status: 'pass',
        detail: 'geolocation:granted · microphone:prompt', durationMs: 6 },
    ],
  })),
}));

import {
  reportSupportSnapshot,
  reportDiagnosticSnapshot,
  reportSelfTestSnapshot,
  sanitizeForRemote,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { clearErrorLog } from '../platform/crashLogger';

/* ── Yardımcılar ─────────────────────────────────────────────── */

type Rec = Record<string, unknown>;

function payloadBytes(payload: Rec): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function sampleInspector(): Rec {
  return {
    _meta:   { sanitized: true, noPII: true, exportedAt: '2026-06-10T12:00:00.000Z' },
    runtime: {
      mode: 'NORMAL', fps: 58, tier: 'low', ramMb: 142, blur: 'OFF',
      webgl: true, weakGpu: true, renderer: 'Mali-400 MP',
      workers: [{ key: 'obd', criticality: 'CRITICAL', status: 'alive' }],
    },
    timeline: Array.from({ length: 10 }, (_, i) => ({
      ts: 1765000000000 + i * 1000,
      signals: { spd: 40 + i, rpm: 2100 + i * 10, gear: 3, fuel: 42 },
      env: { therm: 1, mem: 'OK' },
    })),
    network: [{ method: 'GET', url: 'https://api.example.com/tiles', status: 200, durationMs: 120 }],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(1765000002000);
  _resetRemoteLogServiceForTest();
  clearErrorLog();
  M.pushed = [];
});

afterEach(() => {
  clearErrorLog();
  vi.useRealTimers();
});

/* ── KİLİT 1: selfTest ortak sanitize hattından geçer ─────────── */

describe('KİLİT — selfTest bölümü ZORUNLU sanitize hattından geçer', () => {
  it('prob detail\'indeki ham fetch hatası: api_key + koordinat MASKELENİR', async () => {
    const payload = await reportSelfTestSnapshot();
    const json = JSON.stringify(payload);

    expect(json).not.toContain('sk-canli-9999');   // ← eskiden HAM gidiyordu
    expect(json).not.toContain('41.0082');
    expect(json).not.toContain('28.9784');
    expect(json).toContain('api_key=[MASKED]');
    expect(json).toContain('[COORD]');
  });

  it('prob detail\'indeki stack karesi + VIN + MAC maskelenir; teşhis metni KORUNUR', async () => {
    const payload = await reportSelfTestSnapshot();
    const selfTest = payload.selfTest as { results: Array<{ name: string; detail: string }> };
    const idle = selfTest.results.find((r) => r.name === 'idle-render')!;

    expect(idle.detail).not.toContain('WVWZZZ1JZXW000001');
    expect(idle.detail).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(idle.detail).toContain('[VIN]');
    expect(idle.detail).toContain('[MAC]');
    // Teşhis değeri KAYBOLMAZ — stack karesi (kök-neden ipucu) hâlâ okunur.
    expect(idle.detail).toContain('FullMapView.tsx:814');
  });

  it('selfTest yapısı sanitize sonrası BOZULMAZ (worst/summary/env/results)', async () => {
    const payload = await reportSelfTestSnapshot();
    const st = payload.selfTest as {
      version: number; worst: string;
      summary: Record<string, number>; env: Rec;
      results: Array<Rec>;
    };

    expect(st.version).toBe(1);
    expect(st.worst).toBe('warn');
    expect(st.summary).toEqual({ pass: 8, warn: 3, fail: 0, skip: 1 });
    expect(st.env.tier).toBe('low');
    expect(st.results).toHaveLength(5);           // MAX_ARRAY_LEN=20 kırpmadı
    expect(st.results[0]!.name).toBe('localStorage');
    expect(st.results[1]!.metric).toBe(3500);     // sayısal metrik korunur
    // Triyaj selfTest'i okur (worst + summary) → bulgu üretebilmeli
    expect(payload.triage).toBeDefined();
  });
});

/* ── KİLİT 2: DENY_KEYS anahtar varyasyonlarını yakalar ───────── */

describe('KİLİT — deny-list camelCase/snake_case/case varyasyonlarını yakalar', () => {
  it('iç içe apiKey / accessToken / authorization REDAKTE edilir', async () => {
    const dirty = {
      ...sampleInspector(),
      runtime: {
        mode: 'NORMAL',
        auth: {
          apiKey:        'sk-camel-1111',
          api_key:       'sk-snake-2222',
          accessToken:   'at-camel-3333',
          access_token:  'at-snake-4444',
          authorization: 'Bearer zzz-5555',
          bearer:        'bb-6666',
          secret:        'ss-7777',
          password:      'pp-8888',
          jwt:           'jj-9999',
          email:         'kisi@ornek.com',
          token:         'tt-0000',
          refreshToken:  'rt-1234',
          // redakte EDİLMEMESİ gereken meşru komşu alan:
          tokenCount: 42,
        },
      },
    };

    const payload = await reportDiagnosticSnapshot(dirty);
    const json = JSON.stringify(payload);

    for (const leak of [
      'sk-camel-1111', 'sk-snake-2222', 'at-camel-3333', 'at-snake-4444',
      'zzz-5555', 'bb-6666', 'ss-7777', 'pp-8888', 'jj-9999',
      'kisi@ornek.com', 'tt-0000', 'rt-1234',
    ]) {
      expect(json, `sızdı: ${leak}`).not.toContain(leak);
    }

    // FALSE-POSITIVE OLMAMALI: tam eşleşme → `tokenCount` meşru alan, DÜŞMEZ.
    const inspector = payload.inspector as Rec;
    const auth = (inspector.runtime as Rec).auth as Rec;
    expect(auth.tokenCount).toBe(42);
  });

  it('anahtar CASE varyasyonları (API_KEY / Api-Key / ACCESS_TOKEN) da düşer', () => {
    const out = sanitizeForRemote({
      ctx: 'test',
      transport: {
        'API_KEY':      'v1',
        'Api-Key':      'v2',
        'ACCESS_TOKEN': 'v3',
        'Authorization':'v4',
        'PASSWORD':     'v5',
        protocol: 'ISO15765',   // meşru — kalmalı
      },
    });

    const json = JSON.stringify(out);
    for (const leak of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      expect(json, `sızdı: ${leak}`).not.toContain(leak);
    }
    expect((out.transport as Rec).protocol).toBe('ISO15765');
  });

  it('TAM EŞLEŞME: substring benzeri meşru alanlar (platform / vinMasked) KORUNUR', () => {
    // `lat` substring eşleşseydi p·lat·form düşerdi; `vin` prefix olsaydı vinMasked.
    const out = sanitizeForRemote({
      ctx: 'test',
      transport: {
        platform:         'android',
        detectedPlatform: 'headunit',
        vinMasked:        'WVW**************',
        latency:          12,
        lat:              41.0082,   // ← GERÇEK deny → düşmeli
      },
    });

    const t = out.transport as Rec;
    expect(t.platform).toBe('android');
    expect(t.detectedPlatform).toBe('headunit');
    expect(t.vinMasked).toBe('WVW**************');
    expect(t.latency).toBe(12);
    expect(t.lat).toBeUndefined();
  });
});

/* ── KİLİT 3: dairesel referans güvenliği ────────────────────── */

describe('KİLİT — circular reference güvenli (public API THROW ETMEZ)', () => {
  it('circular OBJECT → throw yok, [CYCLE] işareti, kardeş alanlar akar', () => {
    const node: Rec = { name: 'kok', depth: 1 };
    node.self = node;                                  // dairesel

    let out!: Rec;
    expect(() => { out = sanitizeForRemote({ ctx: 'test', transport: node }); }).not.toThrow();

    const t = out.transport as Rec;
    expect(t.name).toBe('kok');                        // kardeş alanlar KAYBOLMAZ
    expect(t.depth).toBe(1);
    expect(t.self).toBe('[CYCLE]');                    // sessiz kayıp değil, görünür işaret
  });

  it('circular ARRAY → throw yok', () => {
    const arr: unknown[] = ['a', 'b'];
    arr.push(arr);                                     // dairesel dizi

    let out!: Rec;
    expect(() => { out = sanitizeForRemote({ ctx: 'test', transport: { items: arr } }); }).not.toThrow();

    const items = (out.transport as Rec).items as unknown[];
    expect(items[0]).toBe('a');
    expect(items[1]).toBe('b');
    expect(items[2]).toBe('[CYCLE]');                  // eleman ELENMEZ → uzunluk korunur
    expect(items).toHaveLength(3);
  });

  it('KRİTİK: paylaşılan referans (DAG) cycle SANILMAZ — her iki dal da korunur', () => {
    // Naif "görülen nesneler" seti bu testi DÜŞÜRÜR (ikinci dalı boşaltır).
    const shared = { pid: '22F190', value: 42 };
    const out = sanitizeForRemote({
      ctx: 'test',
      transport: { dalA: { s: shared }, dalB: { s: shared } },
    });

    const t = out.transport as Rec;
    expect((t.dalA as Rec).s).toEqual({ pid: '22F190', value: 42 });
    expect((t.dalB as Rec).s).toEqual({ pid: '22F190', value: 42 }); // ← ikinci dal SAĞ
  });

  it('aynı nesne KARDEŞ dizide iki kez geçerse ikisi de korunur', () => {
    const shared = { code: 'P0301' };
    const out = sanitizeForRemote({ ctx: 'test', transport: { codes: [shared, shared] } });

    const codes = (out.transport as Rec).codes as Rec[];
    expect(codes).toHaveLength(2);
    expect(codes[0]!.code).toBe('P0301');
    expect(codes[1]!.code).toBe('P0301');   // cycle SANILMADI
  });

  it('patlayan getter TÜM raporu öldürmez — yalnız o alan [UNREADABLE]', () => {
    const bomb: Rec = { saglam: 'deger' };
    Object.defineProperty(bomb, 'zehirli', {
      enumerable: true,
      get() { throw new Error('getter patladi'); },
    });

    let out!: Rec;
    expect(() => { out = sanitizeForRemote({ ctx: 'test', transport: bomb }); }).not.toThrow();

    const t = out.transport as Rec;
    expect(t.saglam).toBe('deger');            // kardeş alan AKAR
    expect(t.zehirli).toBe('[UNREADABLE]');    // yalnız zehirli düğüm işaretlenir
  });

  it('dairesel nesne raporun içindeyken bile snapshot gönderilir', async () => {
    const cyc: Rec = { mode: 'NORMAL' };
    cyc.back = cyc;

    // throw ederse bu await zaten testi düşürür (sahte yeşil yok)
    const payload = await reportDiagnosticSnapshot({ ...sampleInspector(), runtime: cyc });

    expect(M.pushed).toHaveLength(1);                        // gönderim GERÇEKLEŞTİ
    expect(payload.appVersion).toBe('2.4.0');                // gövde eksiksiz
    expect(((payload.inspector as Rec).runtime as Rec).back).toBe('[CYCLE]');
  });
});

/* ── KİLİT 4: PR-1 kazanımları korunuyor ─────────────────────── */

describe('KİLİT — PR-1 kazanımları bozulmadı (DTC + triyaj)', () => {
  it('obdDeep.dtc.codes[0] hâlâ dolu (null değil)', async () => {
    const payload = await reportSupportSnapshot();
    const dtc = (payload.obdDeep as Rec).dtc as { codes: Array<Rec | null> };

    expect(dtc.codes[0]).not.toBeNull();
    expect(dtc.codes[0]!.code).toBe('P0301');
    expect(dtc.codes[0]!.severity).toBe('critical');
    expect(dtc.codes[0]!.system).toBe('engine');
  });

  it('triyaj hâlâ mevcut ve OBD_DTC_PRESENT üretiliyor', async () => {
    const payload = await reportSupportSnapshot();
    const triage = payload.triage as { findings: Array<{ code: string }>; ruleErrors: number };

    expect(triage).toBeDefined();
    expect(triage.findings.some((f) => f.code === 'OBD_DTC_PRESENT')).toBe(true);
    expect(triage.ruleErrors).toBe(0);
  });

  it('inspector timeline signal nesneleri hâlâ korunuyor', async () => {
    const payload = await reportDiagnosticSnapshot(sampleInspector());
    const timeline = (payload.inspector as Rec).timeline as Array<Rec>;

    expect(timeline).toHaveLength(10);
    expect((timeline[0]!.signals as Rec).spd).toBe(40);
  });
});

/* ── ÖLÇÜM: en zengin fixture (selfTest DAHİL) ───────────────── */

describe('ÖLÇÜM — en zengin fixture payload byte bütçesi', () => {
  const SERVER_CAP_BYTES = 64 * 1024;   // canlı tavan (migration 027)

  it('self_test snapshot (DTC + extended + selfTest) < 64 KB', async () => {
    const payload = await reportSelfTestSnapshot();
    const bytes = payloadBytes(payload);
    console.info(`[ÖLÇÜM] self_test payload     = ${bytes} B (${(bytes / 1024).toFixed(2)} KB)`);
    expect(bytes).toBeLessThan(SERVER_CAP_BYTES);
  });

  it('EN ZENGİN: dev_inspector snapshot < 64 KB', async () => {
    const payload = await reportDiagnosticSnapshot(sampleInspector());
    const bytes = payloadBytes(payload);
    console.info(`[ÖLÇÜM] dev_inspector payload = ${bytes} B (${(bytes / 1024).toFixed(2)} KB)`);
    expect(bytes).toBeLessThan(SERVER_CAP_BYTES);
  });
});
