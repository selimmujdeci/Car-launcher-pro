/**
 * carosLabSignalAuthority.test.tsx — CAROS LAB · Sinyal Otoritesi (V-04/3) KİLİTLERİ.
 *
 * NEDEN: `signalHub` "tek otoriter sinyal okuma yüzeyi" diye yazılmıştı ama üretim
 * yolunda HİÇ tüketicisi yoktu. Bu ekran onu bağlar; aşağıdaki kilitler bağlantının
 * sessizce kopmasını ve dürüstlük sözleşmesinin aşınmasını engeller.
 *
 * ANA İLKELER:
 *  (a) SALT-OKUNUR — sorgu/keşif tetiklenmez, timer/abonelik kurulmaz.
 *  (b) DÜRÜSTLÜK — değer yoksa '—' yazılır (sahte 0 YOK), damga yoksa yaş HESAPLANMAZ.
 *  (c) MOCK KANIT DEĞİL — mock kaynak asla "CANLI" hükmü üretmez.
 *  (d) PARALEL OTORİTE YOK — sınıflandırma `sessionInspectorModel` sözleşmesini kullanır.
 *  (e) SESSİZ KIRPMA YOK — ekrana sığmayan PID sayısı GÖRÜNÜR taşınır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import signalAuthorityModelSrc from '../platform/devtools/signalAuthorityModel.ts?raw';
import signalAuthoritySourcesSrc from '../platform/devtools/signalAuthoritySources.ts?raw';
import signalAuthorityScreenSrc from '../components/devtools/screens/SignalAuthorityScreen.tsx?raw';

/* ── Hub ve PID kaynakları mock'lanır: gerçek OBD zinciri YÜKLENMEZ ───────── */
const hub = vi.hoisted(() => ({
  core: ['speed', 'rpm', 'coolant'] as string[],
  envelopes: new Map<string, unknown>(),
  throwOn: null as string | null,
}));

const pids = vi.hoisted(() => ({
  supported: new Set<string>(),
  defs: [] as Array<{ pid: string; name: string }>,
}));

vi.mock('../platform/obd/signalHub', () => ({
  coreSignalIds: () => {
    if (hub.throwOn === 'core') throw new Error('hub çöktü');
    return [...hub.core];
  },
  readSignal: (id: string) => {
    if (hub.throwOn === id) throw new Error(`okuma hatası: ${id}`);
    return hub.envelopes.get(id) ?? null;
  },
}));

vi.mock('../platform/obd/extendedPidService', () => ({
  isPidSupported: (pid: string) => pids.supported.has(pid),
}));

vi.mock('../platform/obd/StandardPidRegistry', () => ({
  get STANDARD_PIDS() { return pids.defs; },
  STANDARD_PID_MAP: new Map(),
}));

import {
  readSignalAuthoritySnapshot, PID_ROW_CAP,
  type SignalAuthoritySnapshot,
} from '../platform/devtools/signalAuthoritySources';
import {
  buildSignalFields, classifySignal, confidencePct, countBySignalClass,
  deriveSignalVerdict, formatSignalValue,
  SIGNAL_STATE_LABEL, SIGNAL_VERDICT_LABEL,
  type SignalFieldRow,
} from '../platform/devtools/signalAuthorityModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { SignalAuthorityScreen } from '../components/devtools/screens/SignalAuthorityScreen';
import type { SignalEnvelope, SignalSource, SignalState } from '../platform/obd/signalEnvelope';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function env(over: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    value: 42, state: 'valid', confidence: 0.9, source: 'obd',
    updatedAt: NOW - 500, ageMs: 500, unit: 'km/h',
    ...over,
  };
}

function snapshot(over: Partial<SignalAuthoritySnapshot> = {}): SignalAuthoritySnapshot {
  return {
    readAt: NOW, rows: [], supportedPidCount: 0, trimmedPidCount: 0, error: null,
    ...over,
  };
}

function rowOf(id: string, e: SignalEnvelope, kind: 'core' | 'pid' = 'core') {
  return { id, kind, name: id, env: e } as const;
}

beforeEach(() => {
  hub.core = ['speed', 'rpm', 'coolant'];
  hub.envelopes = new Map<string, unknown>([
    ['speed',   env({ value: 0,  unit: 'km/h' })],
    ['rpm',     env({ value: 850, unit: 'rpm' })],
    ['coolant', env({ value: null, state: 'no_data', confidence: 0, unit: '°C', updatedAt: 0, ageMs: 0 })],
  ]);
  hub.throwOn = null;
  pids.supported = new Set<string>();
  pids.defs = [];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. KATALOG + SCREEN-MAP (V-04 kabul ölçütü: bağlandı, ölü değil)
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — signal-authority kataloğa ve ekrana BAĞLI', () => {
  it('katalog girdisi AVAILABLE', () => {
    const tool = getCarosLabTool('signal-authority');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
  });

  it('screen-map gerçek bir ekrana çözer (sahte AVAILABLE yok)', () => {
    expect(renderAvailableTool('signal-authority')).not.toBeNull();
  });

  it('signalHub artık ÜRETİM yolundan okunuyor (ölü modül değil)', () => {
    expect(signalAuthoritySourcesSrc).toMatch(/from '\.\.\/obd\/signalHub'/);
    expect(signalAuthorityScreenSrc).toMatch(/signalAuthoritySources/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. SAFLIK — model I/O yapmaz, ekran timer kurmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — saflık ve ikinci motor yasağı', () => {
  it('model saf: Date.now / timer / React / global durum YOK', () => {
    /* Yorumlar ELENİR: sözleşme metni "Date.now YOK" demek zorunda; kilit yalnız
       gerçek ÇAĞRIYI yasaklar (aksi hâlde kendi belgesine takılırdı). */
    const code = signalAuthorityModelSrc
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code.includes('Date.now'),
      'model Date.now kullanıyor — saflık ihlali').toBe(false);
    expect(code.includes('setInterval'),
      'model timer kuruyor — ikinci motor').toBe(false);
    expect(code.includes('setTimeout'),
      'model timer kuruyor — ikinci motor').toBe(false);
    expect(/from 'react'/.test(code),
      'model React import ediyor — saflık ihlali').toBe(false);
    expect(/^(let|var) /m.test(code),
      'model modül-durumu tutuyor — saflık ihlali').toBe(false);
  });

  it('ekran periyodik yenileme KURMAZ (açılışta tek okuma + elle YENİLE)', () => {
    expect(signalAuthorityScreenSrc.includes('setInterval'),
      'ekran polling kuruyor — LAB deseni ihlali').toBe(false);
    expect(signalAuthorityScreenSrc.includes('subscribe'),
      'ekran abonelik kuruyor — LAB deseni ihlali').toBe(false);
    expect(signalAuthorityScreenSrc, 'mountedRef koruması kaldırılmış — zero-leak ihlali')
      .toMatch(/mountedRef/);
  });

  it('kaynak katmanı yalnız OKUR: komut/keşif tetikleyen çağrı YOK', () => {
    for (const forbidden of ['sendCommand', 'startDiscovery', 'connect(', 'writeP']) {
      expect(signalAuthoritySourcesSrc.includes(forbidden),
        `kaynak katmanı ${forbidden} çağırıyor — salt-okunur ihlali`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. SINIFLANDIRMA — sessionInspectorModel sözleşmesi, paralel otorite YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — durum → gözlemlenebilirlik eşlemesi', () => {
  const CASES: Array<[SignalState, string]> = [
    ['valid',       'OBSERVED'],
    ['suspect',     'OBSERVED'],   // ölçüm GELDİ — "kaynak yok" demek yalan olurdu
    ['stale',       'STALE'],
    ['no_data',     'UNAVAILABLE'],
    ['unsupported', 'UNAVAILABLE'],
  ];

  CASES.forEach(([state, klass]) => {
    it(`${state} → ${klass}`, () => {
      expect(classifySignal(env({ state }))).toBe(klass);
    });
  });

  it('mock kaynak durumu ne olursa olsun ÖLÇÜLDÜ sayılmaz', () => {
    const mockSource: SignalSource = 'mock';
    expect(classifySignal(env({ state: 'valid', source: mockSource }))).toBe('UNAVAILABLE');
  });

  it('DERIVED hiç üretilmez (hub türetmez, okur)', () => {
    const all = (['valid', 'suspect', 'stale', 'no_data', 'unsupported'] as SignalState[])
      .map((state) => classifySignal(env({ state })));
    expect(all).not.toContain('DERIVED');
  });

  it('sayaç dört sınıfı da taşır (eksik anahtar sessiz sıfır üretmez)', () => {
    const counts = countBySignalClass([]);
    expect(Object.keys(counts).sort()).toEqual(['DERIVED', 'OBSERVED', 'STALE', 'UNAVAILABLE']);
  });

  it('her ham durumun Türkçe etiketi vardır', () => {
    (['valid', 'stale', 'suspect', 'no_data', 'unsupported'] as SignalState[])
      .forEach((s) => expect(SIGNAL_STATE_LABEL[s].length).toBeGreaterThan(0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. DÜRÜSTLÜK — sahte 0 / sahte tarih yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — "0" ile "veri yok" ASLA karışmaz', () => {
  it('değer null → "—" (sahte 0 yazılmaz)', () => {
    expect(formatSignalValue(env({ value: null, state: 'no_data' }))).toBe('—');
  });

  it('değer 0 → gerçek ölçüm olarak basılır', () => {
    expect(formatSignalValue(env({ value: 0, unit: 'km/h' }))).toBe('0.0 km/h');
  });

  it('NaN değer "—" olur (sayı gibi basılmaz)', () => {
    expect(formatSignalValue(env({ value: Number.NaN }))).toBe('—');
  });

  it('damga yoksa updatedAt null kalır — yaş HESAPLANMAZ', () => {
    const fields = buildSignalFields(snapshot({
      rows: [rowOf('coolant', env({ updatedAt: 0, state: 'no_data', value: null }))],
    }));
    expect(fields[0].updatedAt).toBeNull();
  });

  it('güven yüzdesi kanıttan gelir; bozuk değer 0 olur (uydurulmaz)', () => {
    expect(confidencePct(env({ confidence: 0.87 }))).toBe(87);
    expect(confidencePct(env({ confidence: Number.NaN }))).toBe(0);
    expect(confidencePct(env({ confidence: 5 }))).toBe(100);
  });

  it('desteklenmeyen sinyal ARIZA gibi sunulmaz (notta araç sınırı yazar)', () => {
    const fields = buildSignalFields(snapshot({
      rows: [rowOf('boost', env({ state: 'unsupported', value: null }))],
    }));
    expect(fields[0].note).toMatch(/ARIZA DEĞİL/);
  });

  it('mock satır notu MOCK olduğunu AÇIKÇA söyler', () => {
    const fields = buildSignalFields(snapshot({
      rows: [rowOf('speed', env({ source: 'mock' }))],
    }));
    expect(fields[0].note).toMatch(/MOCK/);
    expect(fields[0].envSource).toBe('mock');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. HÜKÜM — mock asla CANLI değildir
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — okuma yüzeyi hükmü', () => {
  function verdictOf(snap: SignalAuthoritySnapshot) {
    const fields: readonly SignalFieldRow[] = buildSignalFields(snap);
    return deriveSignalVerdict(snap, fields);
  }

  it('okuma hatası her şeyi EZER — sessizce "veri yok" denmez', () => {
    expect(verdictOf(snapshot({ error: 'hub çöktü' })).status).toBe('READ_FAILED');
  });

  it('mock kaynak CANLI hükmünü EZER (sahte güven yasağı)', () => {
    const v = verdictOf(snapshot({
      rows: [rowOf('speed', env({ source: 'mock', state: 'valid' }))],
    }));
    expect(v.status).toBe('MOCK_SOURCE');
    expect(v.status).not.toBe('LIVE');
  });

  it('en az bir geçerli gerçek sinyal → CANLI', () => {
    expect(verdictOf(snapshot({ rows: [rowOf('speed', env())] })).status).toBe('LIVE');
  });

  it('hepsi bayatsa CANLI DEĞİL', () => {
    expect(verdictOf(snapshot({
      rows: [rowOf('speed', env({ state: 'stale' }))],
    })).status).toBe('STALE_ONLY');
  });

  it('değersiz satırlar → VERİ YOK', () => {
    expect(verdictOf(snapshot({
      rows: [rowOf('speed', env({ state: 'no_data', value: null }))],
    })).status).toBe('NO_DATA');
  });

  it('hiç satır yoksa CANLI iddia edilmez', () => {
    expect(verdictOf(snapshot()).status).toBe('NO_DATA');
  });

  it('kırpma SESSİZ değildir — gerekçede sayı ile yazar', () => {
    const v = verdictOf(snapshot({ supportedPidCount: 40, trimmedPidCount: 16 }));
    expect(v.reasons.join(' ')).toMatch(/16/);
  });

  it('her hükmün Türkçe etiketi vardır', () => {
    Object.values(SIGNAL_VERDICT_LABEL).forEach((l) => expect(l.length).toBeGreaterThan(0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. KAYNAK KATMANI — fail-soft ve görünür kırpma
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — kaynak katmanı', () => {
  it('core sinyalleri hub sırasıyla okur', () => {
    const snap = readSignalAuthoritySnapshot();
    expect(snap.rows.map((r) => r.id)).toEqual(['speed', 'rpm', 'coolant']);
    expect(snap.error).toBeNull();
  });

  it('tek sinyal patlarsa DİĞERLERİ okunur (fail-soft)', () => {
    hub.throwOn = 'rpm';
    const snap = readSignalAuthoritySnapshot();
    expect(snap.rows.map((r) => r.id)).toEqual(['speed', 'coolant']);
    expect(snap.error).toBeNull();     // tek satır kaybı ekranı kırmaz
  });

  it('hub tamamen çökerse hata SESSİZCE yutulmaz', () => {
    hub.throwOn = 'core';
    const snap = readSignalAuthoritySnapshot();
    expect(snap.error).not.toBeNull();
    expect(snap.rows).toHaveLength(0);
  });

  it('yalnız desteği KANITLANMIŞ PID listelenir', () => {
    pids.defs = [{ pid: '0C', name: 'RPM' }, { pid: '5C', name: 'Yağ sıcaklığı' }];
    pids.supported = new Set(['5C']);
    hub.envelopes.set('pid:5C', env({ value: 90, unit: '°C' }));
    const snap = readSignalAuthoritySnapshot();
    expect(snap.rows.filter((r) => r.kind === 'pid').map((r) => r.id)).toEqual(['pid:5C']);
    expect(snap.supportedPidCount).toBe(1);
    expect(snap.trimmedPidCount).toBe(0);
  });

  it('tavanı aşan PID sayısı GÖRÜNÜR taşınır (sessiz kırpma yok)', () => {
    const many = Array.from({ length: PID_ROW_CAP + 7 }, (_, i) => ({
      pid: i.toString(16).padStart(2, '0').toUpperCase(), name: `PID ${i}`,
    }));
    pids.defs = many;
    pids.supported = new Set(many.map((d) => d.pid));
    many.forEach((d) => hub.envelopes.set(`pid:${d.pid}`, env()));

    const snap = readSignalAuthoritySnapshot();
    expect(snap.supportedPidCount).toBe(PID_ROW_CAP + 7);
    expect(snap.trimmedPidCount).toBe(7);
    expect(snap.rows.filter((r) => r.kind === 'pid')).toHaveLength(PID_ROW_CAP);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. EKRAN — çizilir, dürüstlük metinleri görünür
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — ekran çizimi', () => {
  it('ekran patlamadan çizilir ve salt-okunur beyanını taşır', () => {
    const html = renderToStaticMarkup(<SignalAuthorityScreen />);
    expect(html).toContain('SİNYAL OTORİTESİ');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="sig-refresh"');
  });

  it('değeri olmayan sinyal ekranda "—" ile görünür (sahte 0 yok)', () => {
    const html = renderToStaticMarkup(<SignalAuthorityScreen />);
    expect(html).toContain('—');
    expect(html).toContain('VERİ YOK');
  });

  it('hüküm rozeti makine sözleşmesini (data-verdict) taşır', () => {
    const html = renderToStaticMarkup(<SignalAuthorityScreen />);
    expect(html).toMatch(/data-verdict="(LIVE|STALE_ONLY|MOCK_SOURCE|NO_DATA|READ_FAILED)"/);
  });

  it('kırpma varsa ekranda rozet olarak yazar', () => {
    const many = Array.from({ length: PID_ROW_CAP + 3 }, (_, i) => ({
      pid: (100 + i).toString(16).toUpperCase(), name: `PID ${i}`,
    }));
    pids.defs = many;
    pids.supported = new Set(many.map((d) => d.pid));
    many.forEach((d) => hub.envelopes.set(`pid:${d.pid}`, env()));

    const html = renderToStaticMarkup(<SignalAuthorityScreen />);
    expect(html).toContain('data-testid="sig-trim"');
    expect(html).toContain('KIRPILDI');
  });
});
