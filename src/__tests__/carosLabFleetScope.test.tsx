/**
 * carosLabFleetScope.test.tsx — filo yüzeylerinin YETKİ KAPSAMI + geri-okuma
 * köprüsünün KİLİTLERİ.
 *
 * ANA İLKE: "boş ekran" ile "yetki dışı ekran" AYRI şeylerdir. Bu dosya iki şeyi
 * kilitler: (1) kapsam tablosu migration'daki GERÇEK GRANT'lerle uyuşuyor mu,
 * (2) köprü trip başına TEK çağrı yapıyor ve eşleşmemiş cihazda ağa ÇIKMIYOR mu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

import { stripComments } from './helpers';

import {
  FLEET_SCOPE_FACTS, getFleetScope, isEmptinessExpected,
  fleetScopeTone, FLEET_SCOPE_VERDICT_LABEL,
} from '../platform/devtools/fleetScopeModel';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Tüm migration SQL'ini tek metin olarak okur (GRANT gerçeğinin kaynağı). */
function allMigrations(): string {
  const dir = 'supabase/migrations';
  if (!existsSync(resolve(process.cwd(), dir))) return '';
  const files = globSync(`${dir}/*.sql`, { cwd: process.cwd() });
  return files.map((f) => read(f)).join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) KAPSAM TABLOSU ↔ MİGRATION GERÇEĞİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('fleetScope › tablo ölçülmüş GRANT ile uyuşur', () => {
  const sql = allMigrations();

  it('migration dosyaları okunabildi (kilit boşa koşmasın)', () => {
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('SADECE get_active_driver_assignment cihazda okunabilir işaretlidir', () => {
    const readable = FLEET_SCOPE_FACTS.filter((f) => f.verdict === 'DEVICE_READABLE');
    expect(readable).toHaveLength(1);
    expect(readable[0].surface).toBe('fleet-driver-identity');
  });

  it('cihazda okunabilir sayılan uç GERÇEKTEN anon GRANT taşır', () => {
    // Tablo "okunabilir" diyorsa sunucu da anon'a izin vermiş OLMALI.
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_active_driver_assignment\([^)]*\)\s*\n?\s*TO[^;]*anon/i,
    );
  });

  it('kullanıcı-oturumu gerektiren uçlar anon GRANT taşımaz', () => {
    const fns = ['get_driver_dna', 'get_fleet_intelligence', 'get_evidence_coverage'];
    for (const fn of fns) {
      const m = sql.match(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO([^;]*);`, 'i'),
      );
      expect(m, `${fn} için GRANT bulunamadı`).not.toBeNull();
      expect(m![1], `${fn} anon'a açılmış — kapsam tablosu YANLIŞ`).not.toMatch(/anon/i);
    }
  });

  it('presence history anon için AÇIKÇA REVOKE edilmiştir', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.list_vehicle_presence_history\([^)]*\) FROM[^;]*anon/i,
    );
    expect(getFleetScope('fleet-presence-history')?.verdict).toBe('ANON_REVOKED');
  });

  it('sürücü doğrulama için public okuma RPC\'si YOKTUR', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.get_driver_authentication\b/i);
    expect(getFleetScope('fleet-driver-authentication')?.endpoint).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) MODELİN KENDİSİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('fleetScope › model', () => {
  it('bilinmeyen yüzey null döner (fail-soft, throw YOK)', () => {
    expect(getFleetScope('bilinmeyen-yuzey')).toBeNull();
    expect(isEmptinessExpected(null)).toBe(false);
  });

  it('yalnız cihazda okunabilir yüzeyde boşluk BEKLENMEZ', () => {
    for (const f of FLEET_SCOPE_FACTS) {
      expect(isEmptinessExpected(f)).toBe(f.verdict !== 'DEVICE_READABLE');
    }
  });

  it('her olgunun gerekçesi ve hedef kitlesi BOŞ DEĞİLDİR', () => {
    for (const f of FLEET_SCOPE_FACTS) {
      expect(f.note.length, f.surface).toBeGreaterThan(40);
      expect(f.audience.length, f.surface).toBeGreaterThan(3);
      expect(FLEET_SCOPE_VERDICT_LABEL[f.verdict]).toBeTruthy();
    }
  });

  it('yalnız okunabilir yüzey "ok" tonu alır (yeşil = gerçekten çalışmalı)', () => {
    expect(fleetScopeTone('DEVICE_READABLE')).toBe('ok');
    for (const v of ['REQUIRES_USER_SESSION', 'ANON_REVOKED', 'NO_PRODUCER'] as const) {
      expect(fleetScopeTone(v)).not.toBe('ok');
    }
  });

  it('kapsam beyanı KATALOG araç kimlikleriyle birebir eşleşir', async () => {
    const { getCarosLabTool } = await import('../platform/devtools/carosLabCatalog');
    for (const f of FLEET_SCOPE_FACTS) {
      expect(getCarosLabTool(f.surface), `${f.surface} katalogda yok`).not.toBeNull();
    }
  });

  it('saf model: I/O · timer · Date.now İÇERMEZ', () => {
    /* Kilit KODU hedefler, BELGEYİ değil: saflık sözleşmesini ANLATAN başlık
       satırı ("`Date.now()` YOK") yasağın ihlali sayılamaz. */
    const src = stripComments(read('src/platform/devtools/fleetScopeModel.ts'));
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) GERİ-OKUMA KÖPRÜSÜ
 * ═════════════════════════════════════════════════════════════════════════ */
vi.mock('../platform/tripLogService', () => {
  return {
    onTripState: (fn: (s: { active: boolean }) => void) => {
      _emit = fn;
      return () => { _emit = null; };
    },
  };
});

const captureMock = vi.fn();
vi.mock('../platform/fleet/driverAssignmentSnapshot', () => ({
  driverSnapshotRuntime: {
    capture: (...a: unknown[]) => captureMock(...a),
  },
}));

const bindMock = vi.fn();
vi.mock('../platform/fleet/driverAuthentication', () => ({
  bindAuthenticationVehicle: (...a: unknown[]) => bindMock(...a),
}));

const identityMock = vi.fn();
vi.mock('../platform/vehicleIdentityService', () => ({
  getVehicleIdentity: () => identityMock(),
}));

let _emit: ((s: { active: boolean }) => void) | null = null;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fleetReadback › köprü', () => {
  beforeEach(async () => {
    const m = await import('../platform/fleet/fleetReadbackService');
    m._resetFleetReadbackForTest();
    captureMock.mockReset();
    bindMock.mockReset();
    identityMock.mockReset();
    _emit = null;
  });

  it('trip BAŞLANGICINDA (false→true) tam BİR kez okur', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'ACTIVE', reason: null });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(m.getFleetReadbackEvidence().lastOutcome).toBe('ASSIGNED');
  });

  it('trip SÜRERKEN tekrar okumaz — snapshot bilinçli olarak DONDURULUR', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'ACTIVE', reason: null });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    _emit!({ active: true });
    _emit!({ active: true });
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('yeni trip yeni okuma tetikler (kenar tekrar oluşur)', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'ACTIVE', reason: null });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    _emit!({ active: false });
    _emit!({ active: true });
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(2);
    expect(m.getFleetReadbackEvidence().tripStartCount).toBe(2);
  });

  it('EŞLEŞMEMİŞ cihazda ağa HİÇ ÇIKMAZ (NOT_PAIRED)', async () => {
    identityMock.mockResolvedValue(null);

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    await flush();

    expect(captureMock).not.toHaveBeenCalled();
    expect(m.getFleetReadbackEvidence().lastOutcome).toBe('NOT_PAIRED');
    // Araç bağı da kurulmaz — yanlış araca sürücü bağlanmaz.
    expect(bindMock).toHaveBeenCalledWith(null);
  });

  it('araç bağı YALNIZ kimlik okunduktan sonra kurulur', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-42', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'UNKNOWN', reason: 'NO_ACTIVE_ASSIGNMENT' });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    await flush();

    expect(bindMock).toHaveBeenCalledWith('veh-42');
    expect(m.getFleetReadbackEvidence().lastOutcome).toBe('NO_ASSIGNMENT');
  });

  it('ağ düşerse sürücü UYDURULMAZ — TRANSPORT olarak raporlanır', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'UNKNOWN', reason: 'TRANSPORT' });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    _emit!({ active: true });
    await flush();

    expect(m.getFleetReadbackEvidence().lastOutcome).toBe('TRANSPORT');
  });

  it('kimlik okuması PATLARSA yolculuk akışı etkilenmez (fail-soft)', async () => {
    identityMock.mockRejectedValue(new Error('boom'));

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();

    expect(() => _emit!({ active: true })).not.toThrow();
    await flush();
    expect(m.getFleetReadbackEvidence().lastOutcome).toBe('TRANSPORT');
  });

  it('İDEMPOTENT: ikinci start ikinci abonelik açmaz', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'ACTIVE', reason: null });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();
    m.startFleetReadback();

    _emit!({ active: true });
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('stop aboneliği söker — sökülmüş köprü okumaz (zero-leak)', async () => {
    identityMock.mockResolvedValue({ vehicleId: 'veh-1', deviceId: 'dev-1' });
    captureMock.mockResolvedValue({ status: 'ACTIVE', reason: null });

    const m = await import('../platform/fleet/fleetReadbackService');
    m.startFleetReadback();
    const emit = _emit!;
    m.stopFleetReadback();

    emit({ active: true });
    await flush();

    expect(captureMock).not.toHaveBeenCalled();
    expect(m.getFleetReadbackEvidence().wired).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) KABLO + YAN ETKİ KİLİTLERİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('fleetReadback › kablo ve yan etki', () => {
  it('SystemBoot köprüyü BAŞLATIR ve temizliğini KAYDEDER', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toContain("import { startFleetReadback } from '../fleet/fleetReadbackService'");
    expect(boot).toMatch(/this\._reg\(startFleetReadback\(\)\)/);
  });

  it('köprü TIMER kurmaz (trip kenarı dışında ağa çıkmaz)', () => {
    const src = read('src/platform/fleet/fleetReadbackService.ts');
    expect(src).not.toMatch(/setInterval\(/);
  });

  it('LAB ekranları köprüyü ÇAĞIRMAZ — ekran ağ isteği başlatamaz', () => {
    for (const f of ['FleetDriverIdentityScreen', 'FleetDriverDnaScreen',
                     'FleetIntelligenceScreen', 'AiEvidenceEngineScreen']) {
      const src = read(`src/components/devtools/screens/${f}.tsx`);
      expect(src, f).not.toMatch(/startFleetReadback|driverSnapshotRuntime\.capture|callVehicleRpc/);
    }
  });

  it('altı filo ekranı da kapsam bildirimini GÖSTERİR', () => {
    const pairs: [string, string][] = [
      ['FleetDriverIdentityScreen', 'fleet-driver-identity'],
      ['FleetPresenceHistoryScreen', 'fleet-presence-history'],
      ['FleetDriverAuthenticationScreen', 'fleet-driver-authentication'],
      ['FleetDriverDnaScreen', 'fleet-driver-dna'],
      ['FleetIntelligenceScreen', 'fleet-intelligence'],
      ['AiEvidenceEngineScreen', 'ai-evidence-engine'],
    ];
    for (const [comp, surface] of pairs) {
      const src = read(`src/components/devtools/screens/${comp}.tsx`);
      expect(src, comp).toContain(`<FleetScopeNotice surface="${surface}" />`);
    }
  });
});
