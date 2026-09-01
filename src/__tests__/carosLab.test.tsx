/**
 * carosLab.test.tsx — CAROS LAB Faz A1 DAVRANIŞ KİLİTLERİ (16 kilit).
 *
 * YAKLAŞIM: @testing-library/react YOK ve jsdom'da `react-dom/client` createRoot
 * çalışmıyor (bkz. safetyContext.test.tsx notu) → ilk-render kanıtı için
 * `renderToStaticMarkup`, davranış kanıtı için SAF modeller/servis çekirdekleri
 * doğrudan test edilir. Bu yüzden navigasyon bir saf reducer'dır ve yakalama
 * yaşam döngüsü saf bir acquire/release modülüdür.
 *
 * Kilitler görevdeki §H listesiyle bire bir numaralandırılmıştır.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Native/ağır kenarlar izole ────────────────────────────────────────────── */

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

const getLiveDiscoveryCoordinatorSpy = vi.fn(() => ({
  start:  vi.fn(async () => ({ standardPids: [], stopReason: 'idle' })),
  cancel: vi.fn(),
  status: vi.fn(() => ({
    phase: 'idle', scannedDidCount: 0, totalDidCandidates: 0,
    verifiedCount: 0, unknownCount: 0, suspiciousCount: 0, rejectedCount: 0,
  })),
  applyVerified: vi.fn(() => []),
}));

vi.mock('../platform/obd/discovery/discoveryLive', () => ({
  getLiveDiscoveryCoordinator: () => getLiveDiscoveryCoordinatorSpy(),
}));

import {
  CAROS_LAB_CATEGORIES, CAROS_LAB_TOOLS, toolsByCategory, getCarosLabTool,
  isToolOpenable, resolveToolActivation,
} from '../platform/devtools/carosLabCatalog';
import {
  isCarosLabAllowed, carosLabGateReason, shouldRenderCarosLab,
} from '../platform/devtools/carosLabGate';
import { openCarosLab } from '../platform/devtools/carosLabEntry';
import {
  carosLabNavReduce, CAROS_LAB_INITIAL_NAV,
} from '../platform/devtools/carosLabNavigation';
import {
  acquireObdTrafficCapture, acquireCanCollect,
  _resetDevtoolsCaptureForTest, _devtoolsCaptureRefs,
} from '../platform/devtools/devtoolsCapture';
import {
  buildEvidenceRows, maskEvidenceText, classifyEvidenceKey,
  MAX_EVIDENCE_ROWS, MAX_PAYLOAD_CHARS,
} from '../platform/devtools/evidenceViewerModel';
import { maskObdTrafficEntry } from '../platform/devtools/obdTrafficMask';
import {
  describePidDidWiring, pidDidOverallStatus,
} from '../platform/devtools/pidDidExplorerModel';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { CarosLabShell } from '../components/devtools/CarosLabShell';
import { PidDidExplorerScreen } from '../components/devtools/screens/PidDidExplorerScreen';
import { ToolInfoScreen } from '../components/devtools/screens/ToolInfoScreen';
import { AppGrid } from '../components/apps/AppGrid';
import { useRoleStore } from '../platform/roleSystem/RoleStore';

beforeEach(() => {
  _resetDevtoolsCaptureForTest();
  getLiveDiscoveryCoordinatorSpy.mockClear();
  useRoleStore.getState().setRole('driver');
});

afterEach(() => {
  useRoleStore.getState().setRole('driver');
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–3 · Geliştirici erişim kapısı (fail-closed)
 * ════════════════════════════════════════════════════════════════════════ */

/* ÜRÜN KURALI DEĞİŞTİ (2026-07-26): kapı ROL tabanlıydı (`DEBUG_ENABLED && canDebug`),
   artık YALNIZ derleme bayrağıdır (`DEVELOPER_FEATURES_ENABLED`). Gerekçe: CAROS PRO
   hâlâ aile içi saha testi aşamasında; test APK'sını kuran her cihaz varsayılan
   `driver` rolüyle açılıyordu ve geliştirici yüzeyleri görünmüyordu.
   KİLİT GEVŞETİLMEDİ, YENİ KURALA GÖRE GÜNCELLENDİ: fail-closed davranış (bozuk
   girdi · null · bayrak kapalı) aynen korunur ve AYRICA doğrulanır. */
describe('KİLİT 1 — kapı ROL DEĞİL, derleme bayrağıdır', () => {
  it('driver rolünde bile (test build\'i) AppGrid CAROS LAB kartını BASAR', () => {
    useRoleStore.getState().setRole('driver');   // canDebug YOK — artık önemsiz
    const html = renderToStaticMarkup(
      <AppGrid apps={[]} favorites={[]} onToggleFavorite={() => {}} onLaunch={() => {}} />,
    );
    expect(html).toContain('caros-lab-entry');
    expect(html).toContain('CAROS LAB');
  });

  it('teknisyen rolünde de görünür — rol SONUCU DEĞİŞTİRMEZ', () => {
    useRoleStore.getState().setRole('technician');
    const html = renderToStaticMarkup(
      <AppGrid apps={[]} favorites={[]} onToggleFavorite={() => {}} onLaunch={() => {}} />,
    );
    expect(html).toContain('caros-lab-entry');
    expect(html).toContain('CAROS LAB');
  });

  it('kapı saf kuralı: TEK koşul (derleme bayrağı), aksi hâlde FAIL-CLOSED', () => {
    expect(isCarosLabAllowed({ developerFeaturesEnabled: true  })).toBe(true);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(isCarosLabAllowed(null)).toBe(false);
    expect(isCarosLabAllowed(undefined)).toBe(false);
    // Bozuk/eksik girdi de reddedilir (truthy kaçağı yok)
    expect(isCarosLabAllowed({ developerFeaturesEnabled: 1 } as unknown as never)).toBe(false);
    expect(isCarosLabAllowed({} as unknown as never)).toBe(false);
    expect(carosLabGateReason({ developerFeaturesEnabled: false })).toBe('build-flag-off');
    expect(carosLabGateReason({ developerFeaturesEnabled: true })).toBe('ok');
    expect(carosLabGateReason(null)).toBe('build-flag-off');
  });
});

describe('KİLİT 2 — doğrudan route erişimi gate kapalıyken REDDEDİLİR', () => {
  it('shouldRenderCarosLab: kapı kapalıyken drawer caros-lab olsa bile render EDİLMEZ', () => {
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
    expect(shouldRenderCarosLab('settings', true)).toBe(false);
  });

  it('openCarosLab: kapı kapalıyken false döner ve openDrawer HİÇ çağrılmaz', () => {
    const open = vi.fn();
    const ok = openCarosLab({ allowed: () => false, open });
    expect(ok).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('KİLİT 3 — gate açıkken shell açılır', () => {
  it('openCarosLab kapı açıkken caros-lab çekmecesini açar', () => {
    const open = vi.fn();
    const ok = openCarosLab({ allowed: () => true, open });
    expect(ok).toBe(true);
    expect(open).toHaveBeenCalledWith('caros-lab');
  });

  it('shell çökmeden render olur ve katalog görünümüyle açılır', () => {
    let html = '';
    expect(() => { html = renderToStaticMarkup(<CarosLabShell onClose={() => {}} />); }).not.toThrow();
    expect(html).toContain('CAROS LAB');
    expect(html).toContain('lab-category-vehicle');
    // Açılışta hiçbir araç ekranı aktif değil → breadcrumb ve GERİ yok
    expect(html).not.toContain('lab-breadcrumb');
    expect(html).not.toContain('lab-back');
  });

  /* ── YERLEŞİM KİLİTLERİ (SAHA 2026-08-25, gerçek cihaz) ──────────────────
     ÖLÇÜLEN KUSUR: araç gövdesinin sarmalayıcısı `overflow-hidden` idi. Kendi
     iç kaydırmasını KURMAYAN 24 ekranda (DTC Kapsamı & ECU Adreslenebilirlik
     dâhil) katlanın altındaki içeriğe ULAŞMANIN YOLU YOKTU — "o bölüm LAB'da
     yok" gözleminin gerçek nedeni buydu. İkinci kusur: başlık · yenileme
     çubuğu · araç künyesi üç ayrı şeritti ve ~4 satır yiyordu.
     Bu iki kilit ikisinin de sessizce geri gelmesini engeller. */
  it('🔒 KİLİT: araç gövdesi KAYDIRILABİLİR (overflow-hidden geri gelmedi)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/devtools/CarosLabShell.tsx'), 'utf8',
    );
    expect(src, 'araç gövdesi kaydırılamıyor — kendi kaydirmasi olmayan ekranlar kırpılır')
      .toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain p-3');
    expect(src, 'gövde yine overflow-hidden ile kilitlenmiş')
      .not.toContain('min-h-0 flex-1 overflow-hidden p-3');
  });

  it('🔒 KİLİT: araç künyesi SABİT şeride katlı — ayrı bir satır açmıyor', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/devtools/CarosLabShell.tsx'), 'utf8',
    );
    /* GERİ · breadcrumb · durum çipi başlık şeridinde YAŞAR; ikinci bir künye
       şeridi açmak kazanılan satırı geri verir. */
    const backIdx  = src.indexOf('data-testid="lab-back"');
    const copyIdx  = src.indexOf('data-testid="lab-copy-all"');
    const hostIdx  = src.indexOf('<CarosLabToolHost');
    expect(backIdx, 'GERİ düğmesi kaybolmuş').toBeGreaterThan(0);
    expect(backIdx, 'GERİ hâlâ ayrı bir künye şeridinde (başlıktan sonra)').toBeLessThan(copyIdx);
    expect(copyIdx, 'kopyala düğmesi gövdeden sonra kalmış').toBeLessThan(hostIdx);
  });

  it('🔒 KİLİT: KAPSAM cümlesi GİZLENMEDİ (yesil rozet LAB genelini kapsamaz)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/devtools/CarosLabRefreshBar.tsx'), 'utf8',
    );
    /* Yer kazanmak için kaldırılması EN KOLAY şey buydu; kaldırılmadı — yalnız
       kendi paragrafından çıkıp sarmalanan şeride katıldı ve KOŞULSUZ basılır. */
    expect(src).toContain('data-testid="lab-refresh-scope"');
    expect(src).toContain('{CAROS_LAB_REFRESH_SCOPE_NOTE}');
    const scopeIdx = src.indexOf('data-testid="lab-refresh-scope"');
    const openIdx  = src.indexOf('{open && (');
    expect(scopeIdx, 'KAPSAM cümlesi AYRINTI kapısının ARDINA saklanmış').toBeLessThan(openIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4–7 · Katalog + kart davranışı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — beş kategori doğru oluşturulur', () => {
  it('tam olarak 5 kategori vardır ve her biri en az bir araç içerir', () => {
    expect(CAROS_LAB_CATEGORIES).toHaveLength(5);
    expect([...CAROS_LAB_CATEGORIES]).toEqual(
      ['vehicle', 'communication', 'runtime', 'ai', 'developer'],
    );
    for (const c of CAROS_LAB_CATEGORIES) {
      expect(toolsByCategory(c).length).toBeGreaterThan(0);
    }
  });

  it('görevdeki minimum araç kataloğu eksiksiz kayıtlıdır', () => {
    const required = [
      'live-data', 'pid-did-explorer', 'deep-scan', 'vehicle-fingerprint',
      'raw-obd-traffic', 'can-monitor', 'kwp-monitor', 'uds-explorer',
      'session-inspector', 'adapter-diagnostics',
      'queue-monitor', 'poll-scheduler', 'recovery-monitor', 'evidence-viewer', 'performance',
      'mavi-console', 'action-registry', 'tool-calling', 'memory-explorer', 'knowledge-explorer',
      'decoder-registry', 'discovery-database', 'raw-command-console',
      'replay-log', 'benchmark', 'stress-test',
    ];
    for (const id of required) expect(getCarosLabTool(id)).not.toBeNull();
  });

  it('her araç geçerli bir duruma sahiptir; belirsiz ifade ("yakında") YASAK', () => {
    for (const t of CAROS_LAB_TOOLS) {
      expect(['AVAILABLE', 'PLACEHOLDER', 'DISABLED']).toContain(t.status);
      const text = `${t.desc} ${t.note ?? ''}`.toLowerCase();
      expect(text).not.toContain('yakında');
      expect(text).not.toContain('yakinda');
      expect(text).not.toContain('coming soon');
      // AVAILABLE olmayan araç NEDEN'ini beyan etmek zorunda
      if (t.status !== 'AVAILABLE') expect(typeof t.note).toBe('string');
    }
  });
});

describe('KİLİT 5 — AVAILABLE kart gerçek ekrana gider', () => {
  it('her AVAILABLE araç için gerçek bir ekran eşlemesi vardır', () => {
    const available = CAROS_LAB_TOOLS.filter((t) => t.status === 'AVAILABLE');
    expect(available.length).toBeGreaterThan(0);
    for (const t of available) {
      expect(isToolOpenable(t)).toBe(true);
      expect(resolveToolActivation(t)).toBe(t.id);
      expect(renderAvailableTool(t.id)).not.toBeNull();   // sahte AVAILABLE yok
    }
  });

  it('reducer AVAILABLE kartı aktifleştirir', () => {
    const next = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: 'raw-obd-traffic' });
    expect(next.activeId).toBe('raw-obd-traffic');
  });
});

describe('KİLİT 6 — PLACEHOLDER kart yeni ağır servis BAŞLATMAZ', () => {
  it('PLACEHOLDER araçların gerçek ekran eşlemesi yoktur (bilgi ekranına düşer)', () => {
    const placeholders = CAROS_LAB_TOOLS.filter((t) => t.status === 'PLACEHOLDER');
    expect(placeholders.length).toBeGreaterThan(0);
    for (const t of placeholders) {
      expect(isToolOpenable(t)).toBe(false);
      expect(renderAvailableTool(t.id)).toBeNull();
    }
  });

  it('bilgi ekranı render edilince hiçbir yakalama/keşif başlamaz', () => {
    /* Fixture 'kwp-monitor' iken bu araç Faz A4'te AVAILABLE oldu; kilit ZAYIFLATILMADI,
       hâlâ PLACEHOLDER olan bir araca (uds-explorer, aynı kategori) taşındı. Kilidin
       amacı sabit: PLACEHOLDER kart yeni ağır servis/yakalama BAŞLATMAZ. */
    const tool = getCarosLabTool('uds-explorer')!;
    expect(tool.status, 'fixture artık PLACEHOLDER değil — kilit boşa çalışır').toBe('PLACEHOLDER');
    const html = renderToStaticMarkup(<ToolInfoScreen tool={tool} />);
    expect(html).toContain('tool-info-screen');
    /* Arayüz Türkçeleştirildi (2026-07-25): görünen metin 'EKRAN YOK'. Ham enum
       makine sözleşmesi olarak `data-status`ta AYNEN durur — dürüstlük kilidi
       dile bağımlı olmamalı, o yüzden İKİSİ de doğrulanır. */
    expect(html).toContain('data-status="PLACEHOLDER"');
    expect(html).toContain('EKRAN YOK');
    expect(getLiveDiscoveryCoordinatorSpy).not.toHaveBeenCalled();
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
  });
});

describe('KİLİT 7 — DISABLED kart İŞLEM ÇALIŞTIRMAZ', () => {
  it('DISABLED araçlar açılamaz; reducer NO-OP döner (aynı referans)', () => {
    const disabled = CAROS_LAB_TOOLS.filter((t) => t.status === 'DISABLED');
    expect(disabled.map((t) => t.id)).toContain('raw-command-console');
    for (const t of disabled) {
      expect(isToolOpenable(t)).toBe(false);
      expect(resolveToolActivation(t)).toBeNull();
      const next = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: t.id });
      expect(next).toBe(CAROS_LAB_INITIAL_NAV);   // referans dahi değişmez
      expect(next.activeId).toBeNull();
    }
  });

  it('bilinmeyen id de NO-OP (fail-soft)', () => {
    const next = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: 'yok-boyle-bir-arac' });
    expect(next).toBe(CAROS_LAB_INITIAL_NAV);
  });

  it('Raw Command Console güvenlik gerekçesiyle kapalıdır (ham yazma yüzeyi yok)', () => {
    const t = getCarosLabTool('raw-command-console')!;
    expect(t.status).toBe('DISABLED');
    expect(t.note).toContain('GÜVENLİK POLİTİKASI');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · Raw OBD — mevcut store, ikinci polling yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 8 — Raw OBD ekranı mevcut kanalı kullanır, İKİNCİ POLLING başlatmaz', () => {
  it('acquire yalnız mevcut yakalama bayrağını açar; timer/interval kurmaz', async () => {
    const setCapture = vi.fn();
    const remove = vi.fn();
    const addListener = vi.fn(async () => ({ remove }));
    const onEntry = vi.fn();
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const release = acquireObdTrafficCapture({
      isNative: () => true, setCapture, addListener, onEntry,
    });
    await Promise.resolve();

    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenCalledWith(true);
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(intervalSpy).not.toHaveBeenCalled();   // ikinci polling motoru YOK

    // Native olay → mevcut debug store köprüsüne akar (yeni depo kurulmaz)
    const cb = addListener.mock.calls[0][0] as (e: { ts: number; cmd: string; resp: string; ms: number }) => void;
    cb({ ts: 111, cmd: '0100', resp: '41 00 BE', ms: 12 });
    expect(onEntry).toHaveBeenCalledWith({ ts: 111, cmd: '0100', resp: '41 00 BE', ms: 12 });

    release();
  });

  it('iki tüketici (DebugPanel + CAROS LAB) yakalamayı bir kez açar, ref-count korur', async () => {
    const setCapture = vi.fn();
    const addListener = vi.fn(async () => ({ remove: vi.fn() }));
    const r1 = acquireObdTrafficCapture({ isNative: () => true, setCapture, addListener, onEntry: vi.fn() });
    const r2 = acquireObdTrafficCapture();
    await Promise.resolve();

    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(_devtoolsCaptureRefs().obd).toBe(2);

    r1();  // biri kapandı → yakalama KAPANMAZ
    expect(setCapture).toHaveBeenCalledTimes(1);
    expect(_devtoolsCaptureRefs().obd).toBe(1);

    r2();
    expect(setCapture).toHaveBeenLastCalledWith(false);
    expect(_devtoolsCaptureRefs().obd).toBe(0);
  });

  it('ham trafik görünümünde VIN yükü maskelenir (görev §F)', () => {
    const vinReq = maskObdTrafficEntry('0902', '49 02 01 57 46 30');
    expect(vinReq.masked).toBe(true);
    expect(vinReq.resp).not.toContain('49 02 01 57 46 30');

    const secret = maskObdTrafficEntry('ATZ', 'token_abcdef1234567890');
    expect(secret.resp).toContain('[redacted]');

    // Normal PID trafiği DOKUNULMADAN kalır (ham hex geliştiricinin verisi)
    const normal = maskObdTrafficEntry('010C', '41 0C 1A F8');
    expect(normal.masked).toBe(false);
    expect(normal.resp).toBe('41 0C 1A F8');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–10 · PID/DID Explorer dürüstlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 9 — PID/DID ekranı foundation durumunu DÜRÜST gösterir', () => {
  it('bağlı olmayan wiring NOT_WIRED olarak beyan edilir; genel durum FOUNDATION_ONLY', () => {
    const rows = describePidDidWiring({ nativeDidChannel: true });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['apply-verified-consumer'].state).toBe('NOT_WIRED');
    expect(byId['mavi-action-wiring'].state).toBe('NOT_WIRED');
    expect(byId['did-read-channel'].state).toBe('WIRED');
    expect(pidDidOverallStatus(rows)).toBe('FOUNDATION_ONLY');
  });

  it('native köprü yoksa DID okuma kanalı UNAVAILABLE (varsayılmaz, ölçülür)', () => {
    const rows = describePidDidWiring({ nativeDidChannel: false });
    const row = rows.find((r) => r.id === 'did-read-channel')!;
    expect(row.state).toBe('UNAVAILABLE');
  });

  it('ekran markup\'ı FOUNDATION_ONLY ve NOT_WIRED rozetlerini gerçekten basar', () => {
    const html = renderToStaticMarkup(<PidDidExplorerScreen />);
    /* Ham enum `data-*` içinde (dile bağımsız makine sözleşmesi) + Türkçe etiket
       görünür metinde. Çeviri turu bu dürüstlük beyanını zayıflatamaz. */
    expect(html).toContain('data-status="FOUNDATION_ONLY"');
    expect(html).toContain('data-state="NOT_WIRED"');
    expect(html).toContain('YALNIZ ALTYAPI');
    expect(html).toContain('BAĞLI DEĞİL');
    expect(html).toContain('piddid-wiring-apply-verified-consumer');
  });
});

describe('KİLİT 10 — PID/DID ekranını AÇMAK otomatik discovery BAŞLATMAZ', () => {
  it('ilk render keşif koordinatörüne dokunmaz', () => {
    renderToStaticMarkup(<PidDidExplorerScreen />);
    expect(getLiveDiscoveryCoordinatorSpy).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · Evidence Viewer maskeleme
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 11 — Evidence Viewer hassas alanları MASKELER', () => {
  it('VIN · token · MAC · e-posta · koordinat çıktıya sızmaz', () => {
    const rows = buildEvidenceRows({
      trail: [
        { ts: 1000, kind: 'obd', label: 'VIN okundu', detail: 'WF0AXXTTRA5R12345' },
        { ts: 1001, kind: 'error', label: '[critical] auth', detail: 'bearer_abcdef1234567890xyz' },
        { ts: 1002, kind: 'obd', label: 'adapter', detail: 'MAC 00:1D:A5:68:98:8B' },
        { ts: 1003, kind: 'action', label: 'konum', detail: '41.015137, 28.979530' },
        { ts: 1004, kind: 'action', label: 'kullanici', detail: 'surucu@example.com' },
      ],
      aiResult: null,
      validation: null,
    });

    const all = rows.map((r) => r.payload).join(' | ');
    expect(all).not.toContain('WF0AXXTTRA5R12345');
    expect(all).not.toContain('bearer_abcdef1234567890xyz');
    expect(all).not.toContain('00:1D:A5:68:98:8B');
    expect(all).not.toContain('41.015137, 28.979530');
    expect(all).not.toContain('surucu@example.com');
    expect(all).toContain('[redacted]');
  });

  it('maskeleme fonksiyonu bozuk girdide çökmez', () => {
    expect(maskEvidenceText(null)).toBe('');
    expect(maskEvidenceText(42)).toBe('');
    expect(maskEvidenceText('normal metin')).toBe('normal metin');
  });

  it('kanal sınıflandırması gerçek anahtar öneklerinden türer', () => {
    expect(classifyEvidenceKey('recovery.kwp')).toBe('kwp-recovery');
    expect(classifyEvidenceKey('handshake.outcome')).toBe('obd');
    expect(classifyEvidenceKey('transport.quality')).toBe('obd');
    expect(classifyEvidenceKey('dtc.P0128')).toBe('obd');
    expect(classifyEvidenceKey('capability.unavailable_pids')).toBe('discovery');
    expect(classifyEvidenceKey('fingerprint.identity')).toBe('discovery');
    expect(classifyEvidenceKey('memory.brand')).toBe('ai');
  });

  it('kaynak bozuksa görünüm çökmez (fail-soft)', () => {
    expect(() => buildEvidenceRows({
      trail: [null, undefined, { ts: 'x' }] as never,
      aiResult: { reports: 'bozuk' } as never,
      validation: { log: 5 } as never,
    })).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12–13 · Yaşam döngüsü + geri navigasyon
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 12 — ekran kapanınca abonelik TEMİZLENİR (zero-leak)', () => {
  it('release: listener kaldırılır + yakalama kapatılır + ref sıfırlanır', async () => {
    const setCapture = vi.fn();
    const remove = vi.fn();
    const release = acquireObdTrafficCapture({
      isNative: () => true, setCapture, addListener: async () => ({ remove }), onEntry: vi.fn(),
    });
    await Promise.resolve();

    release();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(setCapture).toHaveBeenLastCalledWith(false);
    expect(_devtoolsCaptureRefs().obd).toBe(0);

    // Çift cleanup (StrictMode/çift unmount) ref sayacını BOZMAZ
    release();
    expect(_devtoolsCaptureRefs().obd).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('CAN toplama da aç/kapa simetriktir', () => {
    const setCollecting = vi.fn();
    const release = acquireCanCollect({ setCollecting });
    expect(setCollecting).toHaveBeenCalledWith(true);
    expect(_devtoolsCaptureRefs().can).toBe(1);
    release();
    expect(setCollecting).toHaveBeenLastCalledWith(false);
    expect(_devtoolsCaptureRefs().can).toBe(0);
  });
});

describe('KİLİT 13 — geri navigasyon shell (katalog) görünümüne döner', () => {
  it('open → back: aktif araç kapanır, kategori korunur', () => {
    const opened = carosLabNavReduce(
      { category: 'communication', activeId: null },
      { type: 'open', id: 'can-monitor' },
    );
    expect(opened.activeId).toBe('can-monitor');

    const back = carosLabNavReduce(opened, { type: 'back' });
    expect(back.activeId).toBeNull();
    expect(back.category).toBe('communication');
  });

  it('kategori değişimi açık aracı kapatır (katalog\'a döner)', () => {
    const opened = carosLabNavReduce(CAROS_LAB_INITIAL_NAV, { type: 'open', id: 'live-data' });
    const switched = carosLabNavReduce(opened, { type: 'category', category: 'runtime' });
    expect(switched.activeId).toBeNull();
    expect(switched.category).toBe('runtime');
  });

  it('katalogdayken back NO-OP (aynı referans → gereksiz render yok)', () => {
    const s = CAROS_LAB_INITIAL_NAV;
    expect(carosLabNavReduce(s, { type: 'back' })).toBe(s);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–15 · Mevcut akışa dokunmama + bounded render
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 14 — CAROS LAB mount edilmesi OBD/KWP akışını DEĞİŞTİRMEZ', () => {
  it('shell render edilince hiçbir yakalama açılmaz, keşif başlamaz', () => {
    renderToStaticMarkup(<CarosLabShell onClose={() => {}} />);
    expect(_devtoolsCaptureRefs()).toEqual({ obd: 0, can: 0 });
    expect(getLiveDiscoveryCoordinatorSpy).not.toHaveBeenCalled();
  });

  it('katalog modülü saftır: import edilmesi yan etki üretmez', async () => {
    const before = _devtoolsCaptureRefs();
    const mod = await import('../platform/devtools/carosLabCatalog');
    expect(mod.CAROS_LAB_TOOLS.length).toBeGreaterThan(0);
    expect(_devtoolsCaptureRefs()).toEqual(before);
  });

  it('native olmayan ortamda acquire yakalama açmaya ÇALIŞMAZ (ECU trafiği üretmez)', () => {
    const setCapture = vi.fn();
    const release = acquireObdTrafficCapture({
      isNative: () => false, setCapture, addListener: async () => ({ remove: vi.fn() }), onEntry: vi.fn(),
    });
    expect(setCapture).not.toHaveBeenCalled();
    release();
  });
});

describe('KİLİT 15 — low-end render listesi BOUNDED kalır', () => {
  it('1000 olay verilse bile satır sayısı MAX_EVIDENCE_ROWS ile sınırlıdır', () => {
    const trail = Array.from({ length: 1000 }, (_, i) => ({
      ts: 1_000 + i, kind: 'obd' as const, label: `olay-${i}`,
    }));
    const rows = buildEvidenceRows({ trail, aiResult: null, validation: null });
    expect(rows.length).toBe(MAX_EVIDENCE_ROWS);
    // En YENİ olaylar tutulur (zaman çizgisi tersten)
    expect(rows[0].ts).toBe(1_999);
  });

  it('tek satır ham yükü kırpılır (sınırsız payload render edilmez)', () => {
    const rows = buildEvidenceRows({
      trail: [{ ts: 1, kind: 'obd', label: 'x'.repeat(5_000) }],
      aiResult: null, validation: null,
    });
    expect(rows[0].payload.length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS + 1);
  });

  it('maxRows enjekte edilebilir (bütçe uyarlanabilir)', () => {
    const trail = Array.from({ length: 50 }, (_, i) => ({ ts: i, kind: 'obd' as const, label: 'x' }));
    expect(buildEvidenceRows({ trail, maxRows: 10 }).length).toBe(10);
  });
});
