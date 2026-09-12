/**
 * providerReadinessBoot.test.ts — SAĞLAYICI HAZIRLIĞI KİLİTLERİ (P0 COMPLETION).
 *
 * Kilitlenen ilke: **"anahtar var" ≠ "hazır"**. Yalnız `READY` sistemi hazır
 * sayar; erişim doğrulanmadıysa `CONFIGURED`de kalınır ve `ready=false` olur.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveReadiness, measureProviderReadiness, PROVIDER_PROBE_TIMEOUT_MS,
  _resetProviderReadinessServiceForTest,
} from '../platform/ai/gateway/aiProviderReadinessService';
import {
  getProviderReadinessInfo, _resetGatewayAccessForTest, getGatewayStatus,
} from '../platform/ai/gateway/aiGatewayAccessRuntime';
import {
  deriveGatewayStatus, isProviderUsable, providerReadinessLabel,
} from '../platform/ai/gateway/aiGatewayAccess';

beforeEach(() => {
  _resetProviderReadinessServiceForTest();
  _resetGatewayAccessForTest();
});

/* ══════════════════════════════════════════════════════════════════════
   A · SAF KARAR TABLOSU — ALTI DURUM
   ════════════════════════════════════════════════════════════════════ */

describe('A · hazırlık durumu türetimi', () => {
  it('yapılandırma OKUNAMADIYSA hiçbir iddia kurulmaz → UNKNOWN', () => {
    const m = deriveReadiness({ configured: null, probe: null });
    expect(m.state).toBe('UNKNOWN');
    expect(m.source).toBe('NOT_MEASURED');
  });

  it('anahtar yoksa NOT_CONFIGURED', () => {
    const m = deriveReadiness({ configured: false, probe: null });
    expect(m.state).toBe('NOT_CONFIGURED');
    expect(m.lastFailure).toBe('NO_KEY');
  });

  it('anahtar VAR ama sonda YOKSA → CONFIGURED (READY DEĞİL)', () => {
    const m = deriveReadiness({ configured: true, probe: 'SKIPPED' });
    expect(m.state).toBe('CONFIGURED');
    expect(m.source).toBe('CONFIG_ONLY');
    // Kritik: anahtarın varlığı erişilebilirlik KANITI değildir.
    expect(isProviderUsable(m.state)).toBe(false);
  });

  it('sonda başarılıysa READY', () => {
    expect(deriveReadiness({ configured: true, probe: 'OK' }).state).toBe('READY');
  });

  it('sonda kısıtlıysa DEGRADED', () => {
    expect(deriveReadiness({ configured: true, probe: 'LIMITED' }).state).toBe('DEGRADED');
  });

  it('erişilemiyorsa / reddedildiyse / zaman aşımıysa FAILED + bounded sınıf', () => {
    expect(deriveReadiness({ configured: true, probe: 'UNREACHABLE' }))
      .toMatchObject({ state: 'FAILED', lastFailure: 'UNREACHABLE' });
    expect(deriveReadiness({ configured: true, probe: 'REJECTED' }))
      .toMatchObject({ state: 'FAILED', lastFailure: 'REJECTED' });
    expect(deriveReadiness({ configured: true, probe: 'TIMEOUT' }))
      .toMatchObject({ state: 'FAILED', lastFailure: 'TIMEOUT' });
  });

  it('YALNIZ READY kullanılabilir sayılır', () => {
    expect(isProviderUsable('READY')).toBe(true);
    for (const s of ['UNKNOWN', 'NOT_CONFIGURED', 'CONFIGURED', 'DEGRADED', 'FAILED'] as const) {
      expect(isProviderUsable(s), s).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   B · ÖLÇÜM RUNTIME'A YAZILIR
   ════════════════════════════════════════════════════════════════════ */

describe('B · ölçüm boot zincirine yazılır', () => {
  it('config-only ölçüm CONFIGURED yazar ve künye dolar', async () => {
    await measureProviderReadiness(async () => ({ configured: true }), null, 5_000);
    const info = getProviderReadinessInfo();
    expect(info.state).toBe('CONFIGURED');
    expect(info.source).toBe('CONFIG_ONLY');
    expect(info.measuredAt).toBe(5_000);
  });

  it('sonda başarılıysa READY yazar, kaynak PROBE olur', async () => {
    await measureProviderReadiness(
      async () => ({ configured: true }), async () => 'OK', 7_000);
    const info = getProviderReadinessInfo();
    expect(info.state).toBe('READY');
    expect(info.source).toBe('PROBE');
  });

  it('config okuması PATLARSA UNKNOWN kalır (uydurma yok)', async () => {
    await measureProviderReadiness(
      async () => { throw new Error('boom'); }, null, 1_000);
    expect(getProviderReadinessInfo().state).toBe('UNKNOWN');
  });

  it('sonda PATLARSA FAILED/UNREACHABLE — hata yutulmaz, sınıflandırılır', async () => {
    await measureProviderReadiness(
      async () => ({ configured: true }),
      async () => { throw new Error('net'); },
      1_000);
    const info = getProviderReadinessInfo();
    expect(info.state).toBe('FAILED');
    expect(info.lastFailure).toBe('UNREACHABLE');
  });

  it('sonda ASILI KALIRSA bounded timeout ile FAILED olur', async () => {
    const m = await measureProviderReadiness(
      async () => ({ configured: true }),
      () => new Promise(() => { /* asla çözülmez */ }),
      1_000);
    expect(m.state).toBe('FAILED');
    expect(m.lastFailure).toBe('TIMEOUT');
    expect(PROVIDER_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  }, 20_000);

  it('sağlayıcı DEĞİŞİMİNDE yeniden ölçülür', async () => {
    await measureProviderReadiness(async () => ({ configured: false }), null, 1_000);
    expect(getProviderReadinessInfo().state).toBe('NOT_CONFIGURED');
    await measureProviderReadiness(async () => ({ configured: true }), async () => 'OK', 2_000);
    expect(getProviderReadinessInfo().state).toBe('READY');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   C · İZİN + HAZIRLIK BİRLİKTE
   ════════════════════════════════════════════════════════════════════ */

describe('C · erişim ve hazırlık birlikte etkin durumu üretir', () => {
  const granted = { killSwitchOn: true, companyGranted: true, vehicleGrantCount: 0, effective: true };

  it('izin VAR + sağlayıcı READY DEĞİL → ready=false', () => {
    for (const p of ['UNKNOWN', 'NOT_CONFIGURED', 'CONFIGURED', 'DEGRADED', 'FAILED'] as const) {
      const s = deriveGatewayStatus({ snapshot: granted, localOverride: false, provider: p });
      expect(s.accessGranted, p).toBe(true);
      expect(s.ready, p).toBe(false);
    }
  });

  it('izin VAR + READY → ready=true', () => {
    const s = deriveGatewayStatus({ snapshot: granted, localOverride: false, provider: 'READY' });
    expect(s.ready).toBe(true);
  });

  it('YEREL KALDIRAÇ sağlayıcı hazırlığını BYPASS EDEMEZ', () => {
    // Kaldıraç izin verebilir ama sağlayıcıyı hazır YAPAMAZ.
    const s = deriveGatewayStatus({ snapshot: null, localOverride: true, provider: 'CONFIGURED' });
    expect(s.accessGranted).toBe(true);
    expect(s.ready).toBe(false);
  });

  it('runtime birleşik durumu aynı kuralı uygular', async () => {
    await measureProviderReadiness(async () => ({ configured: true }), null, 1_000);
    const s = getGatewayStatus();
    // İzin beslenmedi → erişim yok; sağlayıcı da yalnız CONFIGURED.
    expect(s.accessGranted).toBe(false);
    expect(s.ready).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   D · SECRET SIZINTISI YOK
   ════════════════════════════════════════════════════════════════════ */

describe('D · secret sızıntısı yok', () => {
  it('künye yalnız bounded alan taşır — anahtar/endpoint YOK', async () => {
    await measureProviderReadiness(
      async () => ({ configured: true }),
      async () => 'REJECTED',
      1_000);
    const info = getProviderReadinessInfo();
    expect(Object.keys(info).sort()).toEqual(
      ['lastFailure', 'measuredAt', 'source', 'state']);
    const json = JSON.stringify(info);
    expect(json).not.toMatch(/sk-|Bearer|http|api[_-]?key/i);
  });

  it('etiketler bounded ve ayırt edici', () => {
    expect(providerReadinessLabel('NOT_CONFIGURED')).toBe('YAPILANDIRILMAMIŞ');
    expect(providerReadinessLabel('CONFIGURED')).toMatch(/doğrulanmadı/);
    expect(providerReadinessLabel('READY')).toBe('HAZIR');
    expect(providerReadinessLabel('FAILED')).toBe('ERİŞİLEMİYOR');
  });
});
