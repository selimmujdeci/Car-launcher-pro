/**
 * inspectorDiagnosticSend.test.ts — Dev Inspector "Tanı Gönder" akışı.
 *
 * Araç ekranında pano kullanışsız (Claude'a yapıştıracak yer yok) → inspector
 * payload'ı doğrudan remote log sistemine gider:
 *   InspectorPanel "Tanı Gönder" → triggerDiagnosticSnapshot →
 *   reportDiagnosticSnapshot → pushVehicleEvent('support_snapshot', …)
 *
 * Kapsam: doğru fonksiyon + event tipi · payload güvenliği (deny + maske) ·
 * cooldown (triggerSupportSnapshot ile paylaşımlı) · offline queue · enqueue
 * hatasında cooldown yanmaz · Copy for Claude bozulmaz (UI kaynak-sözleşmesi) ·
 * Admin Incident Center'da görünürlük (tip + INSPECTOR detay bölümü).
 *
 * Mock deseni: supportSnapshot.test.ts ile birebir aynı (render YOK —
 * react-dom/client bu jsdom setup'ında çöker; repo deseni otaTelemetry.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  pushError: null as Error | null,
  paired: true,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    if (M.pushError) throw M.pushError;
    M.pushed.push({ type, payload });
  }),
  isDevicePaired: vi.fn(async () => M.paired),
}));

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: () => ({
    connectionState: 'connected',
    source: 'ble',
    vehicleType: 'ice',
    lastSeenMs: 1765000001000,
  }),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0',
      overallHealth: 'healthy',
      services: [{ name: 'OBD', healthy: true, restartCount: 0, criticality: 'critical' }],
    }),
  },
}));

vi.mock('../platform/otaUpdateService', () => ({
  useOtaStore: { getState: () => ({ state: 'idle', errorCode: null, release: null, lastCheckTs: 0 }) },
  getCurrentVersionCode: vi.fn(async () => 7),
}));

import {
  reportDiagnosticSnapshot,
  triggerDiagnosticSnapshot,
  triggerSupportSnapshot,
  SNAPSHOT_COOLDOWN_MS,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { clearErrorLog } from '../platform/crashLogger';

/** InspectorPanel.buildExportPayload ile aynı şekilli örnek payload */
function sampleInspector(): Record<string, unknown> {
  return {
    _meta:   { sanitized: true, noPII: true, exportedAt: '2026-06-10T12:00:00.000Z' },
    runtime: {
      mode: 'NORMAL', fps: 58, tier: 'low', ramMb: 142, blur: 'OFF',
      webgl: true, weakGpu: true, renderer: 'Mali-400 MP',
      workers: [{ key: 'obd', criticality: 'CRITICAL', status: 'alive' }],
    },
    timeline: [{ ts: 1765000000000, signals: { spd: 42, rpm: 2100 }, env: { therm: 1, mem: 'OK' } }],
    network:  [{ method: 'GET', url: 'https://api.example.com/tiles', status: 200, durationMs: 120 }],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  _resetRemoteLogServiceForTest();
  clearErrorLog();
  M.pushed = [];
  M.pushError = null;
  M.paired = true;
});

afterEach(() => {
  clearErrorLog();
  vi.useRealTimers();
});

/* ── Doğru fonksiyon + event tipi ────────────────────────────── */

describe('reportDiagnosticSnapshot — event tipi ve payload yapısı', () => {
  it("vehicle_events'e 'support_snapshot' tipiyle düşer (Admin INCIDENT_TYPES kapsamında)", async () => {
    await reportDiagnosticSnapshot(sampleInspector());
    expect(M.pushed).toHaveLength(1);
    expect(M.pushed[0]!.type).toBe('support_snapshot');
  });

  it("source='dev_inspector' işareti + inspector bölümü + support snapshot gövdesi", async () => {
    const payload = await reportDiagnosticSnapshot(sampleInspector());

    expect(payload.source).toBe('dev_inspector');
    expect(payload.appVersion).toBe('2.4.0');          // ortak snapshot gövdesi
    expect(payload.versionCode).toBe(7);
    expect(payload).toHaveProperty('obd');
    expect(payload).toHaveProperty('health');

    const inspector = payload.inspector as Record<string, unknown>;
    const runtime   = inspector.runtime as Record<string, unknown>;
    expect(runtime.fps).toBe(58);
    expect(runtime.tier).toBe('low');
    expect(inspector.timeline as unknown[]).toHaveLength(1);
  });
});

/* ── Payload güvenliği ───────────────────────────────────────── */

describe('payload güvenliği — inspector verisi de sanitize edilir', () => {
  it('deny anahtarları (lat/lng/vin/token/mac) inspector içinden düşer', async () => {
    const dirty = {
      ...sampleInspector(),
      runtime: {
        mode: 'NORMAL',
        lat: 41.0082, lng: 28.9784,           // konum → düşmeli
        vin: 'WVWZZZ1JZXW000001',             // kimlik → düşmeli
        token: 'secret-token',                 // kimlik bilgisi → düşmeli
        mac: 'AA:BB:CC:DD:EE:FF',              // ağ kimliği → düşmeli
      },
    };
    const payload = await reportDiagnosticSnapshot(dirty);
    const flat = JSON.stringify(payload).toLowerCase();
    for (const key of ['"lat"', '"lng"', '"vin"', '"token"', '"mac"']) {
      expect(flat, `hassas anahtar sızdı: ${key}`).not.toContain(key);
    }
    expect(JSON.stringify(payload)).not.toContain('WVWZZZ1JZXW000001');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('string değerlerdeki VIN/MAC/koordinat/token= maskelenir', async () => {
    const dirty = {
      ...sampleInspector(),
      network: [{
        method: 'GET',
        url: 'https://api.example.com/x?token=abc123&vin=WVWZZZ1JZXW000001 pos 41.00821, 28.97842 mac AA:BB:CC:DD:EE:FF',
        status: 200, durationMs: 50,
      }],
    };
    const payload = await reportDiagnosticSnapshot(dirty);
    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('token=abc123');
    expect(flat).not.toContain('WVWZZZ1JZXW000001');
    expect(flat).not.toContain('41.00821');
    expect(flat).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(flat).toContain('token=[MASKED]');
    expect(flat).toContain('[VIN]');
    expect(flat).toContain('[COORD]');
    expect(flat).toContain('[MAC]');
  });
});

/* ── Cooldown ────────────────────────────────────────────────── */

describe('cooldown — spam koruması', () => {
  it('ilk basış sent; pencere içinde ikinci basış cooldown (push üretmez)', async () => {
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('sent');
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('cooldown');
    expect(M.pushed).toHaveLength(1);

    vi.advanceTimersByTime(SNAPSHOT_COOLDOWN_MS + 1);
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('sent');
    expect(M.pushed).toHaveLength(2);
  });

  it('triggerSupportSnapshot ile AYNI pencereyi paylaşır (iki buton tek bütçe)', async () => {
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('sent');
    expect(await triggerSupportSnapshot()).toBe('cooldown');

    vi.advanceTimersByTime(SNAPSHOT_COOLDOWN_MS + 1);
    expect(await triggerSupportSnapshot()).toBe('sent');
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('cooldown');
  });
});

/* ── Offline queue ───────────────────────────────────────────── */

describe('offline queue davranışı', () => {
  it('çevrimdışı → queued_offline; event yine kuyruğa girer (at-least-once)', async () => {
    const nav = window.navigator as unknown as { onLine?: boolean };
    nav.onLine = false;
    try {
      expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('queued_offline');
      expect(M.pushed).toHaveLength(1); // pushVehicleEvent kuyruğu yine çağrıldı
    } finally {
      delete nav.onLine;
    }
  });
});

/* ── Hata durumu ─────────────────────────────────────────────── */

describe('hata durumunda', () => {
  it('enqueue hatası → error; cooldown YANMAZ, düzeltilince hemen sent', async () => {
    M.pushError = new Error('queue write failed');
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('error');
    expect(M.pushed).toHaveLength(0);

    M.pushError = null;
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('sent');
    expect(M.pushed).toHaveLength(1);
  });
});

/* ── UI kaynak-sözleşmesi — InspectorPanel ───────────────────── */

describe('InspectorPanel — UI sözleşmesi', () => {
  const panel = readFileSync(join(process.cwd(),
    'src/components/debug/devInspector/InspectorPanel.tsx'), 'utf-8');

  it('"Tanı Gönder" butonu triggerDiagnosticSnapshot çağırır', () => {
    expect(panel).toContain("from '../../../platform/remoteLogService'");
    expect(panel).toMatch(/triggerDiagnosticSnapshot\(buildExportPayload\(\)\)/);
    expect(panel).toContain('Tanı Gönder');
  });

  it('Copy for Claude davranışı korunur (buton + pano + overlay fallback)', () => {
    expect(panel).toContain('Copy for Claude');
    expect(panel).toMatch(/function handleCopy\(\)/);
    expect(panel).toMatch(/navigator\.clipboard\?\.writeText/);
    expect(panel).toContain('Kopyalandı!');
    expect(panel).toContain('Tümünü seç + kopyala'); // K24 overlay fallback
  });

  it('iki buton da AYNI sanitize payload kaynağını kullanır (buildExportPayload)', () => {
    expect(panel).toMatch(/function buildExportPayload\(\)/);
    expect(panel).toMatch(/JSON\.stringify\(buildExportPayload\(\), null, 2\)/); // copy yolu
  });

  it('dört kullanıcı durumu da gösteriliyor (sent/queued/cooldown/error)', () => {
    expect(panel).toContain('Gönderildi ✓');
    expect(panel).toContain('İnternet gelince gönderilecek');
    expect(panel).toContain('Az önce gönderildi — bekleyin');
    expect(panel).toContain('Gönderilemedi');
  });

  it('gönderim sırasında buton kilitli (çift tıklama koruması)', () => {
    expect(panel).toMatch(/disabled=\{sendState === 'sending'\}/);
    expect(panel).toMatch(/if \(sendState === 'sending'\) return/);
  });
});

/* ── Admin görünürlüğü — Incident Center ─────────────────────── */

describe('Admin Incident Center — görünürlük sözleşmesi', () => {
  const svc  = readFileSync(join(process.cwd(),
    'src/admin/services/superadmin.service.ts'), 'utf-8');
  const page = readFileSync(join(process.cwd(),
    'src/admin/pages/superadmin/IncidentCenter.tsx'), 'utf-8');

  it("event tipi 'support_snapshot' INCIDENT_TYPES sorgu kapsamında", () => {
    expect(svc).toMatch(/INCIDENT_TYPES = \[[^\]]*'support_snapshot'/);
  });

  it('detay panelinde INSPECTOR bölümü render edilir', () => {
    expect(page).toMatch(/md\['inspector'\] != null/);
    expect(page).toContain('title="INSPECTOR"');
  });

  it('listede dev_inspector kaynağı işaretlenir', () => {
    expect(page).toContain("md['source'] === 'dev_inspector'");
  });
});

/* ── Eşlenmemiş cihaz: yalancı "sent" yok (saha hatası 2026-06-11) ── */

describe('not_paired — eşlenmemiş cihazda dürüst sonuç', () => {
  it("cihaz eşlenmemişse 'not_paired' döner, snapshot ÜRETİLMEZ", async () => {
    M.paired = false;
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('not_paired');
    expect(M.pushed).toHaveLength(0);
    expect(await triggerSupportSnapshot()).toBe('not_paired');
    expect(M.pushed).toHaveLength(0);
  });

  it("not_paired cooldown YAKMAZ — eşleme sonrası ilk deneme 'sent'", async () => {
    M.paired = false;
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('not_paired');
    M.paired = true;
    expect(await triggerDiagnosticSnapshot(sampleInspector())).toBe('sent');
    expect(M.pushed).toHaveLength(1);
  });
});
