/**
 * labNoFakeZero.test.ts — SAHTE SIFIR SINIFI KİLİDİ (E-10 · E-11 · E-19 · E-21 · E-22).
 *
 * ── KUSUR SINIFI ───────────────────────────────────────────────────────
 * Gözlemlenebilirlik sözleşmesi (`sessionInspectorModel`) SAĞLAMDI: `observed()`
 * `null` görünce UNAVAILABLE üretir. Kusur sözleşmede değil, **sözleşmeyi atlayan
 * kaynak katmanlarındaydı**: `Number(x) || 0` ve `?? 0` desenleri `null`ı 0'a
 * çevirip kapıyı TETİKLENEMEZ hâle getiriyordu → LAB'da "ATPC gönderim sayısı:
 * 0 · ÖLÇÜLDÜ". Teşhis aracının kendisi hata avında yanlış yöne sürüklüyordu.
 *
 * ── NE KİLİTLENİYOR ────────────────────────────────────────────────────
 * 1. Sözleşme: `observed(null)` → UNAVAILABLE (taban kural).
 * 2. Kaynak katmanları KWP/poll/lifecycle sayaçlarında `|| 0` KULLANMAZ.
 * 3. Navigasyon LAB'ı koridor/off-route/revizyon alanlarında `?? 0` KULLANMAZ
 *    ve hız bilinmiyorken kamera KARARI ÜRETMEZ.
 * 4. Model katmanı `null` sayaçtan GEREKÇE CÜMLESİ kurmaz ("0 deneme oldu"
 *    da bir iddiadır).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { observed, unavailable } from '../platform/devtools/sessionInspectorModel';
import { buildKwpSections } from '../platform/devtools/kwpMonitorModel';
import type { KwpRawSnapshot } from '../platform/devtools/kwpMonitorModel';

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Denetimde ADI GEÇEN sayaç alanları — bunlar `|| 0` ile sahte sıfıra
 * düşürülemez.
 *
 * ⚠️ KAPSAM DÜRÜSTLÜĞÜ: `sessionInspectorSources` içindeki DİĞER sayaçlar
 * (`halConf` · `canRetryCount` · `listenerCount` · `obdDropped` · `capture.*`)
 * aynı sınıftandır ama bu turda ELE ALINMADI — kütükte açık borç olarak durur.
 * Kilit yalnız gerçekten düzeltilen alanları korur; kapsamayan yeri kapsıyormuş
 * gibi göstermek kilidi yalancı yapardı.
 */
const GUARDED: readonly { path: string; fields: readonly string[] }[] = [
  {
    path: 'src/platform/devtools/kwpMonitorSources.ts',
    fields: ['coreNoDataStreak', 'maxCoreNoDataStreak', 'recoveryCount',
      'suppressedCount', 'atpcSendFailures', 'lastRecoveryAt', 'killedByDataGate',
      'threshold', 'maxPerSession'],
  },
  {
    path: 'src/platform/devtools/sessionInspectorSources.ts',
    fields: ['coreNoDataStreak', 'maxCoreNoDataStreak', 'recoveryCount',
      'suppressedCount', 'atpcSendFailures', 'killedByDataGate', 'maxPerSession'],
  },
  {
    path: 'src/platform/devtools/runtimeSchedulingSources.ts',
    fields: ['eventsReceived', 'decodeFailures', 'valuesStored', 'valuesCached',
      'recoveryCount', 'suppressedCount', 'atpcSendFailures', 'coreNoDataStreak'],
  },
  {
    path: 'src/platform/devtools/adapterDiagnosticsSources.ts',
    fields: ['reconnectAttempts', 'resetRequestedCount', 'resetCompletedCount',
      'disconnectCalledCount', 'reconnectRequestedCount', 'reconnectPressure'],
  },
];

describe('sahte sıfır — sözleşme tabanı', () => {
  it('observed(null) UNAVAILABLE üretir (kapının kendisi sağlam)', () => {
    const f = observed({ id: 'x', label: 'x', source: 's', note: '' }, null);
    expect(f.klass).toBe('UNAVAILABLE');
    expect(unavailable({ id: 'y', label: 'y', source: 's', note: '' }, 'yok').klass)
      .toBe('UNAVAILABLE');
  });
});

describe('E-19/E-21/E-22 — kaynak katmanları kapıyı atlamaz', () => {
  it.each(GUARDED)('$path — korunan sayaçlar `|| 0` / `?? 0` ile yazılmaz', ({ path, fields }) => {
    const src = stripComments(read(path));
    for (const f of fields) {
      const line = new RegExp(`${f}:[^\\n]*(\\|\\|\\s*0|\\?\\?\\s*0)`);
      expect(src, `${f} sahte sıfıra düşürülmüş`).not.toMatch(line);
    }
  });

  it('KWP sayaçları null iken ekran "0 · ÖLÇÜLDÜ" DEMEZ', () => {
    const snap: KwpRawSnapshot = {
      readAt: 1_000,
      protocolActive: '4', protocolTried: null, protocolClass: 'kwp2000',
      slowSerial: true, transportConnected: true, connectionState: 'connected',
      dataFresh: true, lastRxAt: 900, freshWindowMs: 4_000, pollingActive: true,
      recovery: {
        status: 'NOT_ATTEMPTED',
        coreNoDataStreak: null, maxCoreNoDataStreak: null, recoveryCount: null,
        suppressedCount: null, atpcSendFailures: null, lastRecoveryAt: null,
        lastRecoveryToFirstPidMs: null, killedByDataGate: null,
        protocolAtRecovery: null, threshold: null, maxPerSession: null,
      },
    };
    const sections = buildKwpSections(snap, 1_000);
    const fields = sections.flatMap((s) => s.fields);
    const byId = (id: string) => fields.find((f) => f.id === id);

    for (const id of ['recoveryCount', 'suppressedCount', 'atpcSendFailures',
      'killedByDataGate', 'threshold', 'maxPerSession']) {
      const f = byId(id);
      expect(f, `alan yok: ${id}`).toBeTruthy();
      expect(f!.klass, `${id} UNAVAILABLE olmalı`).toBe('UNAVAILABLE');
      expect(f!.value).not.toBe('0');
    }
  });

  it('KONTROL — sayaç GERÇEKTEN 0 ise ÖLÇÜLDÜ olarak gösterilir', () => {
    const snap: KwpRawSnapshot = {
      readAt: 1_000,
      protocolActive: '4', protocolTried: null, protocolClass: 'kwp2000',
      slowSerial: true, transportConnected: true, connectionState: 'connected',
      dataFresh: true, lastRxAt: 900, freshWindowMs: 4_000, pollingActive: true,
      recovery: {
        status: 'NOT_ATTEMPTED',
        coreNoDataStreak: 0, maxCoreNoDataStreak: 0, recoveryCount: 0,
        suppressedCount: 0, atpcSendFailures: 0, lastRecoveryAt: 0,
        lastRecoveryToFirstPidMs: -1, killedByDataGate: 0,
        protocolAtRecovery: null, threshold: 3, maxPerSession: 2,
      },
    };
    const fields = buildKwpSections(snap, 1_000).flatMap((s) => s.fields);
    const rc = fields.find((f) => f.id === 'recoveryCount');
    expect(rc!.klass).toBe('OBSERVED');
    expect(rc!.value).toBe('0');
  });
});

describe('E-10/E-11 — navigasyon LAB kaynağı', () => {
  const NAV = stripComments(read('src/platform/devtools/navigationCoreSources.ts'));

  it('koridor · off-route · revizyon alanlarında `?? 0` / `?? -1` yok', () => {
    expect(NAV).not.toMatch(/corridorM:\s*core\?\.corridorM \?\? 0/);
    expect(NAV).not.toMatch(/offRoute\.evidenceCount \?\? 0/);
    expect(NAV).not.toMatch(/routeRevision \?\? 0/);
    expect(NAV).not.toMatch(/durationRevision \?\? -1/);
  });

  it('hız bilinmiyorken kamera KARARI ÜRETİLMEZ', () => {
    expect(NAV).not.toMatch(/speedKmh:\s*useUnifiedVehicleStore\.getState\(\)\.speed \?\? 0/);
    expect(NAV).toContain("_speedForCamera === null");
    expect(NAV).toContain('hız bilinmiyor — karar üretilmedi');
  });
});

describe('E-21 — null sayaçtan gerekçe cümlesi kurulmaz', () => {
  it('adapterDiagnosticsModel reconnect cümlesini null kapısıyla korur', () => {
    const src = stripComments(read('src/platform/devtools/adapterDiagnosticsModel.ts'));
    expect(src).toContain('t.reconnectAttempts !== null');
    expect(src).toContain('s.health.reconnectPressure !== null');
  });
});
