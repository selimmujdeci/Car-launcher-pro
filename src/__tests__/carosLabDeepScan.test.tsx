/**
 * carosLabDeepScan.test.tsx — CAROS LAB · Derin Tarama KİLİTLERİ.
 *
 * ANA İLKE: bu ekran TARAMA BAŞLATMAZ ve YENİ AKIŞ ÜRETMEZ. En kritik kilitler
 * (1) hiçbir tetikleyicinin çağrılmaması, (2) "idle %0" ile "gerçek ilerleme"nin
 * karıştırılmaması, (3) kontak kaynağının fail-closed kalması.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  buildRuntimeFields, buildWiringFields, resolveDeepScanAuthority,
  isActiveScanStatus, deepScanAuthorityTone, DEEP_SCAN_AUTHORITY_LABEL,
  type DeepScanFieldsInput,
} from '../platform/devtools/deepScanObservationModel';
import type { DeepScanRuntimeShape } from '../platform/devtools/deepScanObservationSources';
import { DeepScanScreen } from '../components/devtools/screens/DeepScanScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = 1_700_000_000_000;

function runtime(over: Partial<DeepScanRuntimeShape> = {}): DeepScanRuntimeShape {
  return {
    scanId: null,
    fingerprintPrefix: null,
    status: 'idle',
    mode: null,
    phase: null,
    progressPercent: 0,
    startedAtMs: null,
    updatedAtMs: null,
    completedAtMs: null,
    isFirstScan: true,
    ignitionRequired: true,
    ignitionConfirmed: null,
    ecuCount: 0, pidCount: 0, didCount: 0, newDiscoveryCount: 0,
    changedFirmware: false, changedEcu: false,
    warningCount: 0, errorCode: null,
    ...over,
  } as DeepScanRuntimeShape;
}

function input(over: Partial<DeepScanFieldsInput> = {}): DeepScanFieldsInput {
  return {
    runtime: runtime(),
    wiring: null,
    offlinePass: null,
    nowMs: NOW,
    ...over,
  };
}

const fieldOf = (fs: readonly { id: string }[], id: string) => fs.find((f) => f.id === id);

/* ══════════════════════════════════════════════════════════════════════════
 * 1) OTORİTE — iki akıştan hangisi sorumlu
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScan › otorite', () => {
  it('kablo YOKSA bu cihazda tetiklenemez — gizlenmez', () => {
    expect(resolveDeepScanAuthority({ runtimeStatus: 'idle', wiringPresent: false }))
      .toBe('NOT_WIRED');
    expect(deepScanAuthorityTone('NOT_WIRED')).toBe('warn');
  });

  it('kablo kurulu + tarama boştaysa TETİK BEKLENİYOR', () => {
    expect(resolveDeepScanAuthority({ runtimeStatus: 'idle', wiringPresent: true }))
      .toBe('WIRING_IDLE');
  });

  it('kablo kurulu + tarama yürüyorsa RUNTIME_ACTIVE', () => {
    expect(resolveDeepScanAuthority({ runtimeStatus: 'running', wiringPresent: true }))
      .toBe('RUNTIME_ACTIVE');
    expect(deepScanAuthorityTone('RUNTIME_ACTIVE')).toBe('ok');
  });

  it('her iki akış da okunamadıysa UNAVAILABLE', () => {
    expect(resolveDeepScanAuthority({ runtimeStatus: null, wiringPresent: null }))
      .toBe('UNAVAILABLE');
  });

  it('kontak bekleyen tarama AKTİF sayılır (durmuş değil)', () => {
    expect(isActiveScanStatus('waiting_for_ignition')).toBe(true);
    expect(isActiveScanStatus('idle')).toBe(false);
    expect(isActiveScanStatus(null)).toBe(false);
  });

  it('her otorite değerinin etiketi vardır', () => {
    for (const a of ['RUNTIME_ACTIVE', 'WIRING_IDLE', 'NOT_WIRED', 'UNAVAILABLE'] as const) {
      expect(DEEP_SCAN_AUTHORITY_LABEL[a]).toBeTruthy();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) "IDLE %0" ≠ "İLERLEME" — en kritik dürüstlük kilidi
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScan › ilerleme dürüstlüğü', () => {
  it('tarama yürümüyorsa %0 bir İLERLEME olarak GÖSTERİLMEZ', () => {
    const f = fieldOf(buildRuntimeFields(input()), 'ds-progress');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/hiç başlamadı/);
    expect(f?.value).not.toBe('%0');
  });

  it('tarama yürürken ilerleme GERÇEKTEN gösterilir', () => {
    const f = fieldOf(
      buildRuntimeFields(input({ runtime: runtime({ status: 'running', progressPercent: 42 }) })),
      'ds-progress');
    expect(f?.klass).toBe('OBSERVED');
    expect(f?.value).toBe('%42');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) KONTAK — fail-closed
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScan › kontak', () => {
  it('otoriter kaynak yoksa BİLİNMİYOR — "kapalı" DENMEZ', () => {
    const f = fieldOf(buildRuntimeFields(input()), 'ds-ignition');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/fail-closed BİLİNMİYOR/);
    expect(f?.value).not.toMatch(/ONAYLANMADI/);
  });

  it('kontak ölçüldüyse olduğu gibi gösterilir', () => {
    const on = fieldOf(
      buildRuntimeFields(input({ runtime: runtime({ ignitionConfirmed: true }) })), 'ds-ignition');
    expect(on?.klass).toBe('OBSERVED');
    expect(on?.value).toBe('ONAYLI');

    const off = fieldOf(
      buildRuntimeFields(input({ runtime: runtime({ ignitionConfirmed: false }) })), 'ds-ignition');
    expect(off?.value).toBe('ONAYLANMADI');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) OKUNAMADI ≠ BOŞTA · damga dürüstlüğü
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScan › kaynak ayrımı', () => {
  it('runtime okunamadıysa UNAVAILABLE ve "boşta" ile karıştırılmaz', () => {
    const fs = buildRuntimeFields(input({ runtime: null }));
    expect(fs[0].klass).toBe('UNAVAILABLE');
    expect(fs[0].note).toMatch(/KARIŞTIRILMAZ/);
  });

  it('damgasız alan yaş ÜRETMEZ', () => {
    const f = fieldOf(buildRuntimeFields(input()), 'ds-started');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/damga YOK/i);
  });

  it('kablo yoksa wiring alanı bunu AÇIKÇA yazar', () => {
    const fs = buildWiringFields(input({
      wiring: {
        present: false, started: false, runtimeState: 'idle', scanState: 'idle',
        ignitionConfirmed: null, progressPercent: 0, warningCount: 0,
        lastErrorCode: null, lastTransitionAt: null,
      },
    }));
    const f = fieldOf(fs, 'dsw-status');
    expect(f?.note).toMatch(/TETİKLENEMEZ/);
  });

  it('çevrimdışı geçiş tetik sayacı DEDUP kanıtı olarak sunulur', () => {
    const fs = buildWiringFields(input({
      offlinePass: {
        present: true, started: true, running: false, active: true, cancelled: false,
        triggerCount: 1, lastRun: NOW - 5000, lastDuration: 120,
        lastResult: 'completed', lastReason: null,
      },
    }));
    const f = fieldOf(fs, 'dso-pass');
    expect(f?.note).toMatch(/DEDUP/);
    expect(f?.value).toMatch(/1 tetik/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) KATALOG + YAN ETKİ (tetikleyici yasağı)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScan › katalog ve yan etki', () => {
  it('katalog AVAILABLE ve gerçek ekran eşlemesi var', () => {
    expect(getCarosLabTool('deep-scan')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('deep-scan')).not.toBeNull();
  });

  it('ekran render olur ve salt-okunur beyanını basar', () => {
    const html = renderToStaticMarkup(<DeepScanScreen />);
    expect(html).toContain('DERİN TARAMA');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="ds-authority"');
  });

  it('HİÇBİR katman tarama TETİKLEMEZ', () => {
    const srcs = [
      'src/platform/devtools/deepScanObservationSources.ts',
      'src/platform/devtools/deepScanObservationModel.ts',
      'src/components/devtools/screens/DeepScanScreen.tsx',
    ];
    for (const p of srcs) {
      const src = stripComments(read(p));
      expect(src, p).not.toMatch(/\.startScan\(|triggerDeepScanOfflinePass\(|startPlatformCoreDeepScanWiring\(|\.reset\(|cancelDeepScanOfflinePass\(/);
    }
  });

  it('ham liste ve metinler kaynak katmanından GEÇMEZ', () => {
    const src = stripComments(read('src/platform/devtools/deepScanObservationSources.ts'));
    // Uyarılar yalnız ADET olarak taşınır.
    expect(src).toMatch(/warningCount/);
    expect(src).not.toMatch(/warnings:\s*\[/);
    // Tam parmak izi hash'i taşınmaz.
    expect(src).toMatch(/slice\(0, 12\)/);
    expect(src).not.toMatch(/vehicleFingerprintHash:\s*s\.vehicleFingerprintHash/);
  });

  it('saf model I/O · timer · Date.now İÇERMEZ', () => {
    const src = stripComments(read('src/platform/devtools/deepScanObservationModel.ts'));
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });

  it('ekran TIMER kurmaz ve unmount sonrası setState yapmaz', () => {
    const src = read('src/components/devtools/screens/DeepScanScreen.tsx');
    expect(src).not.toMatch(/setInterval\(/);
    expect(src).toContain('mountedRef');
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });
});
