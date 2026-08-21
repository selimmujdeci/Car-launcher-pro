/**
 * carosLabBackgroundPower.test.tsx — CAROS LAB · Arka Plan Gücü KİLİTLERİ (kütük #667 borcu).
 *
 * NEDEN: güç politikası sahada ölçülen 612 mAh/h sızıntıyı kapatmak için yazıldı ama
 * gözlem yüzeyi yoktu — "kısma gerçekten uygulandı mı" sorusu cihazda yanıtsızdı.
 *
 * ANA İLKELER:
 *  (a) SALT-OKUNUR — ekran karar TETİKLEMEZ, donanım modunu DEĞİŞTİRMEZ.
 *  (b) `null` ≠ `false` — okunamayan alan KAYNAK YOK olur, "hayır" DEĞİL.
 *  (c) KARAR ≠ GERÇEK — ikisi ayrı okunur, çeliştiklerinde İKİSİ DE gösterilir.
 *  (d) SAHTE TARİH YOK — damga yoksa `updatedAt` null kalır, yaş hesaplanmaz.
 *  (e) ÇELİŞKİ, "kısma aktif"i EZER — uygulanmamış kararı aktif saymak yalandır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import bgLabModelSrc from '../platform/devtools/backgroundPowerLabModel.ts?raw';
import bgLabSourcesSrc from '../platform/devtools/backgroundPowerLabSources.ts?raw';
import bgScreenSrc from '../components/devtools/screens/BackgroundPowerScreen.tsx?raw';

/* ── Servis uçları mock: gerçek GPS/wake/Capacitor zinciri YÜKLENMEZ ──────── */
const rig = vi.hoisted(() => ({
  gate: null as unknown,
  gateThrows: false,
  gpsMode: 'high' as 'high' | 'low',
  micPaused: false,
  wakeEnabled: true,
  navSent: null as boolean | null,
}));

vi.mock('../platform/power/backgroundPowerGate', () => ({
  getBackgroundPowerSnapshot: () => {
    if (rig.gateThrows) throw new Error('kapı okunamadı');
    return rig.gate;
  },
}));
vi.mock('../platform/gpsService', () => ({ getGpsPowerMode: () => rig.gpsMode }));
vi.mock('../platform/wakeWordService', () => ({
  isWakeWordPowerPaused: () => rig.micPaused,
  getWakeWordState: () => ({ enabled: rig.wakeEnabled }),
}));
vi.mock('../platform/navigation/navGpsPowerBridge', () => ({
  getNavGpsPowerLastSent: () => rig.navSent,
}));

import { readBackgroundPowerSnapshot } from '../platform/devtools/backgroundPowerLabSources';
import {
  buildBgPowerFields, buildBgPowerSections, detectBgPowerMismatches, deriveBgPowerVerdict,
  BG_REASON_LABEL, BG_VERDICT_LABEL,
} from '../platform/devtools/backgroundPowerLabModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { BackgroundPowerScreen } from '../components/devtools/screens/BackgroundPowerScreen';
import type { InspectorField } from '../platform/devtools/sessionInspectorModel';
import type { BackgroundPowerReason } from '../platform/power/backgroundPowerModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

function gateSnap(over: Record<string, unknown> = {}) {
  return {
    started: true,
    inputs: {
      appActive: true, navigationActive: false, externalPower: true, wakeWordEnabled: true,
      ...(over.inputs as object ?? {}),
    },
    lastApplied: { gps: 'high', mic: 'on', reason: 'external_power' },
    lastAppliedAt: NOW - 5_000,
    appliedCount: 2,
    ...over,
  };
}

function field(fields: readonly InspectorField[], id: string): InspectorField {
  const f = fields.find((x) => x.id === id);
  expect(f, `alan bulunamadı: ${id}`).toBeDefined();
  return f!;
}

beforeEach(() => {
  rig.gate = gateSnap();
  rig.gateThrows = false;
  rig.gpsMode = 'high';
  rig.micPaused = false;
  rig.wakeEnabled = true;
  rig.navSent = null;
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. KATALOG + SCREEN-MAP — borç kapandı mı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — background-power kataloğa ve ekrana BAĞLI', () => {
  it('katalog girdisi AVAILABLE (çalışma zamanı)', () => {
    const tool = getCarosLabTool('background-power');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('runtime');
  });

  it('screen-map gerçek bir ekrana çözer', () => {
    expect(renderAvailableTool('background-power')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. SALT-OKUNUR + SAFLIK
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yorum satırlarını eler. Sözleşme metinleri yasaklı adı ANMAK ZORUNDA
 * ("`reevaluateBackgroundPower()` ÇAĞRILMAZ") — kilit yalnız gerçek ÇAĞRIYI
 * yasaklar, yoksa dosya kendi belgesine takılırdı.
 */
function codeOnly(src: string): string {
  return src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
}

describe('KİLİT 2 — ekran gözlemler, KARAR TETİKLEMEZ', () => {
  it('kaynak katmanı reevaluate/apply çağırmaz', () => {
    const code = codeOnly(bgLabSourcesSrc);
    for (const forbidden of ['reevaluateBackgroundPower', 'applyGpsPowerMode',
      'pauseWakeWordForPower', 'resumeWakeWordForPower', 'startBackgroundPowerGate']) {
      expect(code.includes(forbidden),
        `kaynak katmanı ${forbidden} çağırıyor — salt-okunur ihlali`).toBe(false);
    }
  });

  it('ekran donanım servislerini DOĞRUDAN çağırmaz', () => {
    const bgScreenCode = codeOnly(bgScreenSrc);
    expect(bgScreenCode.includes('applyGpsPowerMode'),
      'ekran GPS modunu değiştiriyor — salt-okunur ihlali').toBe(false);
    expect(bgScreenCode.includes('setInterval'),
      'ekran polling kuruyor — LAB deseni ihlali').toBe(false);
    expect(bgScreenSrc, 'mountedRef koruması kaldırılmış — zero-leak ihlali').toMatch(/mountedRef/);
  });

  it('model saf: Date.now / timer / React / modül durumu YOK', () => {
    const code = codeOnly(bgLabModelSrc);
    expect(code.includes('Date.now'), 'model Date.now kullanıyor').toBe(false);
    expect(code.includes('setTimeout'), 'model timer kuruyor').toBe(false);
    expect(/from 'react'/.test(code), 'model React import ediyor').toBe(false);
    expect(/^(let|var) /m.test(code), 'model modül durumu tutuyor').toBe(false);
  });

  it('politika model içinde YENİDEN hesaplanmaz (ikinci otorite yok)', () => {
    /* Politika modülünden YALNIZ TİP alınır. Değer importu olsaydı LAB kendi
       kararını üretebilirdi → sahada hangisinin doğru olduğu asla bilinemezdi.
       NOT: `decideBackgroundPower` adı METİN olarak geçer (satırın kaynak/provenance
       etiketi) — kilit adı değil, GERÇEK ÇAĞRIYI arar. */
    const code = codeOnly(bgLabModelSrc);
    const policyImports = code.match(/^import[\s\S]*?from '\.\.\/power\/backgroundPowerModel';/m);
    expect(policyImports, 'politika modülü importu bulunamadı').not.toBeNull();
    expect(policyImports![0].startsWith('import type'),
      'LAB modeli politika modülünden DEĞER import ediyor — paralel otorite riski').toBe(true);
    expect(/[^.'`]decideBackgroundPower\(/.test(code),
      'LAB modeli kararı yeniden üretiyor — paralel politika').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. null ≠ false
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — okunamayan alan "hayır" DEĞİLDİR', () => {
  it('appActive null → KAYNAK YOK ve "—"', () => {
    const fields = buildBgPowerFields(readBackgroundPowerSnapshotWith({ inputs: { appActive: null } }));
    const f = field(fields, 'app-active');
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.value).toBe('—');
    expect(f.note).toMatch(/ÖN PLAN varsayar/);
  });

  it('appActive false → ÖLÇÜLDÜ ve HAYIR (kaynak yok ile karışmaz)', () => {
    const fields = buildBgPowerFields(readBackgroundPowerSnapshotWith({ inputs: { appActive: false } }));
    const f = field(fields, 'app-active');
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('HAYIR');
  });

  it('harici güç null → mikrofona dokunulmadığı NOTTA yazar', () => {
    const fields = buildBgPowerFields(readBackgroundPowerSnapshotWith({ inputs: { externalPower: null } }));
    expect(field(fields, 'external-power').klass).toBe('UNAVAILABLE');
    expect(field(fields, 'external-power').note).toMatch(/DOKUNULMAZ/);
  });

  it('kapı hiç okunamazsa tüm kapı alanları KAYNAK YOK olur', () => {
    rig.gateThrows = true;
    const snap = readBackgroundPowerSnapshot();
    expect(snap.gate).toBeNull();
    expect(snap.error).not.toBeNull();
    const fields = buildBgPowerFields(snap);
    expect(field(fields, 'gate-started').klass).toBe('UNAVAILABLE');
    expect(field(fields, 'decision-gps').value).toBe('—');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. SAHTE TARİH YOK · KARAR TÜRETİLMİŞTİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — damga ve sınıflandırma dürüstlüğü', () => {
  it('kararın damgası GERÇEK kaynaktan gelir (uydurulmaz)', () => {
    const fields = buildBgPowerFields(readBackgroundPowerSnapshotWith({}));
    expect(field(fields, 'decision-reason').updatedAt).toBe(NOW - 5_000);
  });

  it('hiç karar uygulanmadıysa damga null kalır — yaş HESAPLANMAZ', () => {
    const fields = buildBgPowerFields(
      readBackgroundPowerSnapshotWith({ lastApplied: null, lastAppliedAt: null, appliedCount: 0 }),
    );
    const f = field(fields, 'decision-reason');
    expect(f.updatedAt).toBeNull();
    expect(f.value).toBe('—');
    expect(f.note).toMatch(/kapı kımıldamadı/);
  });

  it('karar TÜRETİLDİ, girdi ÖLÇÜLDÜ olarak sınıflanır', () => {
    const fields = buildBgPowerFields(readBackgroundPowerSnapshotWith({}));
    expect(field(fields, 'decision-gps').klass).toBe('DERIVED');
    expect(field(fields, 'navigation-active').klass).toBe('OBSERVED');
    expect(field(fields, 'gps-actual').klass).toBe('OBSERVED');
  });

  it('bölümleme SIRAYA değil KİMLİĞE bağlıdır', () => {
    const fields   = buildBgPowerFields(readBackgroundPowerSnapshotWith({}));
    const sections = buildBgPowerSections(fields);
    expect(sections.map((s) => s.id)).toEqual(['inputs', 'decision', 'actual']);
    expect(sections[1].fields.map((f) => f.id)).toContain('decision-gps');
    expect(sections[2].fields.map((f) => f.id)).toContain('gps-actual');
    /* Hiçbir satır kaybolmaz. */
    const total = sections.reduce((n, s) => n + s.fields.length, 0);
    expect(total).toBe(fields.length);
  });

  it('her gerekçenin Türkçe etiketi vardır', () => {
    (['navigation_active', 'foreground', 'external_power',
      'background_battery', 'background_power_unknown'] as BackgroundPowerReason[])
      .forEach((r) => expect(BG_REASON_LABEL[r].length).toBeGreaterThan(0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. KARAR ↔ GERÇEK ÇELİŞKİSİ — ekranın asıl değeri
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — çelişki tespiti', () => {
  it('karar KISIK ama servis TAM GÜÇ ise çelişki listelenir', () => {
    const snap = readBackgroundPowerSnapshotWith({
      lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' },
    }, { gpsMode: 'high', micPaused: true });
    const ms = detectBgPowerMismatches(snap);
    expect(ms.map((m) => m.id)).toContain('gps-decision-vs-actual');
  });

  it('karar SUSTUR ama mikrofon askıda değilse çelişki listelenir', () => {
    const snap = readBackgroundPowerSnapshotWith({
      lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' },
    }, { gpsMode: 'low', micPaused: false });
    expect(detectBgPowerMismatches(snap).map((m) => m.id)).toContain('mic-decision-vs-actual');
  });

  it('wake ayarı KAPALIYKEN askı beklenmez — sahte çelişki üretilmez', () => {
    const snap = readBackgroundPowerSnapshotWith({
      lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' },
    }, { gpsMode: 'low', micPaused: false, wakeEnabled: false });
    expect(detectBgPowerMismatches(snap).map((m) => m.id)).not.toContain('mic-decision-vs-actual');
  });

  it('navigasyon sürerken kısma varsa istisna DELİNMİŞ sayılır', () => {
    const snap = readBackgroundPowerSnapshotWith({
      inputs: { navigationActive: true },
      lastApplied: { gps: 'low', mic: 'on', reason: 'background_battery' },
    }, { gpsMode: 'low' });
    expect(detectBgPowerMismatches(snap).map((m) => m.id)).toContain('nav-vs-throttle');
  });

  it('uyumlu durumda çelişki ÜRETİLMEZ', () => {
    const snap = readBackgroundPowerSnapshotWith({
      lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' },
    }, { gpsMode: 'low', micPaused: true });
    expect(detectBgPowerMismatches(snap)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. HÜKÜM SIRASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — politika hükmü', () => {
  function verdictOf(gateOver: Record<string, unknown>, rigOver: Partial<typeof rig> = {}) {
    const snap = readBackgroundPowerSnapshotWith(gateOver, rigOver);
    return deriveBgPowerVerdict(snap, detectBgPowerMismatches(snap));
  }

  it('kapı kurulu değilse her şeyden ÖNCE bunu söyler', () => {
    expect(verdictOf({ started: false }).status).toBe('NOT_STARTED');
  });

  it('ÇELİŞKİ "kısma aktif"i EZER (uygulanmamış karar aktif sayılmaz)', () => {
    const v = verdictOf(
      { lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' } },
      { gpsMode: 'high', micPaused: true },
    );
    expect(v.status).toBe('DRIFT');
    expect(v.status).not.toBe('THROTTLED');
  });

  it('hiç karar uygulanmadıysa KARAR UYGULANMADI (kısma yok DEĞİL)', () => {
    expect(verdictOf({ lastApplied: null, lastAppliedAt: null, appliedCount: 0 }).status).toBe('IDLE');
  });

  it('arka plan + pil → KISMA AKTİF', () => {
    expect(verdictOf(
      { lastApplied: { gps: 'low', mic: 'off', reason: 'background_battery' } },
      { gpsMode: 'low', micPaused: true },
    ).status).toBe('THROTTLED');
  });

  it('harici güç → TAM GÜÇ (head unit davranışı korunur)', () => {
    expect(verdictOf({}).status).toBe('FULL_POWER');
  });

  it('her hükmün Türkçe etiketi vardır', () => {
    Object.values(BG_VERDICT_LABEL).forEach((l) => expect(l.length).toBeGreaterThan(0));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. EKRAN
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 7 — ekran çizimi', () => {
  it('ekran patlamadan çizilir ve salt-okunur beyanını taşır', () => {
    const html = renderToStaticMarkup(<BackgroundPowerScreen />);
    expect(html).toContain('ARKA PLAN GÜCÜ');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="bgp-refresh"');
  });

  it('çelişki varsa ekranda AYRI blok olarak görünür', () => {
    rig.gate = gateSnap({ lastApplied: { gps: 'low', mic: 'on', reason: 'background_battery' } });
    rig.gpsMode = 'high';
    const html = renderToStaticMarkup(<BackgroundPowerScreen />);
    expect(html).toContain('data-testid="bgp-mismatches"');
    expect(html).toContain('data-verdict="DRIFT"');
  });

  it('çelişki yoksa çelişki bloğu ÇİZİLMEZ', () => {
    const html = renderToStaticMarkup(<BackgroundPowerScreen />);
    expect(html).not.toContain('data-testid="bgp-mismatches"');
  });
});

/* ── Yardımcı: rig'i ayarlayıp GERÇEK kaynak katmanından okur ─────────────── */
function readBackgroundPowerSnapshotWith(
  gateOver: Record<string, unknown>,
  rigOver: Partial<typeof rig> = {},
) {
  rig.gate = gateSnap(gateOver);
  if (rigOver.gpsMode     !== undefined) rig.gpsMode     = rigOver.gpsMode;
  if (rigOver.micPaused   !== undefined) rig.micPaused   = rigOver.micPaused;
  if (rigOver.wakeEnabled !== undefined) rig.wakeEnabled = rigOver.wakeEnabled;
  if (rigOver.navSent     !== undefined) rig.navSent     = rigOver.navSent;
  return readBackgroundPowerSnapshot();
}
