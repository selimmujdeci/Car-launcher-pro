/**
 * rootCauseKb.test.ts — Diagnostics V2 · PR-3 (Kök-Neden Bilgi Tabanı).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. CI GUARD (dosya drift): KB'deki HER suspectFile diskte GERÇEKTEN var
 *     (kod taşınınca KB bayatlar → bu test kırılır, güncelleme zorunlu).
 *  2. KAPSAMA: diagnosticTriage'ın ürettiği her kod için KB kaydı var.
 *  3. buildRootCauseSnapshot, KB'den codePointer\'ı (dosya+fonksiyon+fixHint) doldurur.
 *  4. Bilinmeyen kod → lookupRootCause null (uydurma YASAK).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookupRootCause, allRootCauseKbEntries } from '../platform/rootCauseKb';
import { buildRootCauseSnapshot, type TriageSections } from '../platform/diagnosticTriage';

/* diagnosticTriage.ts RULES'un üretebildiği kod kümesi (kural eklendikçe genişletilir). */
const TRIAGE_CODES = [
  'HEALTH_CRITICAL', 'HEALTH_DEGRADED', 'BOOT_SLOW_THERMAL', 'MEM_LEAK_SUSPECT',
  'POWER_CRITICAL', 'POWER_LOW', 'FUSION_LOW_CONFIDENCE', 'TRANSPORT_RECONNECT',
  'NETAI_CIRCUIT_OPEN', 'NETAI_QUOTA_COOLDOWN', 'SELFTEST_FAIL', 'SELFTEST_WARN',
  'UI_UNTIMELY_SURFACE', 'STORAGE_DISK_WARN', 'STORAGE_QUEUE_OFFLINE',
  'STORAGE_QUEUE_BACKLOG', 'GEOFENCE_READ_ERROR', 'GPS_PERMISSION_DENIED',
  'GPS_NO_FIX', 'OBD_DTC_PRESENT',
];

describe('rootCauseKb — PR-3', () => {
  it('CI GUARD: her suspectFile diskte GERÇEKTEN var (drift koruması)', () => {
    const missing: string[] = [];
    for (const e of allRootCauseKbEntries()) {
      for (const f of e.suspectFiles) {
        if (!existsSync(resolve(process.cwd(), f))) missing.push(`${e.code} → ${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('KAPSAMA: her triage kodu için KB kaydı var', () => {
    const uncovered = TRIAGE_CODES.filter((c) => lookupRootCause(c) === null);
    expect(uncovered).toEqual([]);
  });

  it('her kayıt sözleşmeyi doldurur: suspectFiles/symbols/fixHint/requiredEvidence', () => {
    for (const e of allRootCauseKbEntries()) {
      expect(e.suspectFiles.length).toBeGreaterThan(0);
      expect(e.suspectSymbols.length).toBeGreaterThan(0);
      expect(e.fixHint.length).toBeGreaterThan(0);
      expect(Array.isArray(e.requiredEvidence)).toBe(true);
    }
  });

  it('bilinmeyen kod → null (uydurma YASAK)', () => {
    expect(lookupRootCause('NOPE_UNKNOWN')).toBeNull();
  });

  it('buildRootCauseSnapshot codePointer\'ı KB\'den doldurur', () => {
    const sections: TriageSections = {
      transport: { reconnectAttempts: 4 },
      obdDeep: { health: { connectionQuality: 41 } },
    };
    const rc = buildRootCauseSnapshot(sections);
    const h = rc.hypotheses.find((x) => x.code === 'TRANSPORT_RECONNECT');
    expect(h).toBeDefined();
    expect(h!.codePointer).toBeDefined();
    expect(h!.codePointer!.file).toBe('src/platform/obd/ObdHealthMonitor.ts');
    expect(h!.codePointer!.symbol.length).toBeGreaterThan(0);
    expect(h!.codePointer!.fixHint!.length).toBeGreaterThan(0);
  });
});
