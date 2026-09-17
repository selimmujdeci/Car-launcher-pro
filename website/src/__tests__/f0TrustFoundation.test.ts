/**
 * f0TrustFoundation.test.ts — FAZ 0 GÜVEN TEMELİ REGRESYON KİLİTLERİ.
 *
 * Bu dosya, F0'da kapatılan güven kusurlarının SESSİZCE geri gelmesini
 * engeller. Her testin karşılığı somut bir saha kusurudur; "kapsama"
 * artırmak için yazılmış tek bir test YOKTUR.
 *
 * Kapsanan invariantlar (görev listesi numaralandırması):
 *   1 · istemci rolü TRUNCATE ayrıcalığı ALAMAZ           → migration 075 sözleşmesi
 *   4 · taşıma yazması UI'da "Onaylandı"/VERIFIED OLMAZ   → commandEvidence
 *   5 · unlink sunucu başarısı olmadan yerel SİLİNMEZ      → pairingService davranışı
 *   6 · başkasının aracı unlink EDİLEMEZ                   → RPC + rota sözleşmesi
 *   7 · üretimde yapılandırma yoksa pairing FAIL-CLOSED    → demoModeGuard davranışı
 *   8 · bireysel 3 araç limiti KORUNUR                     → migration 034 sözleşmesi
 *   9 · E2E komut şifrelemesi KORUNUR                      → commandService sözleşmesi
 *  10 · kritik komut PIN zorunluluğu KORUNUR               → RPC + DB trigger sözleşmesi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evidenceLevelFor, isPhysicalCommand, isPositiveEvidence,
  EVIDENCE_TITLE, EVIDENCE_DETAIL,
} from '../lib/commandEvidence';
import { isDemoFallbackAllowed, isProductionRuntime } from '../lib/demoModeGuard';

/* ── Repo kökü — koşucu kökten de website'ten de başlatılabilir ──────────── */
function repoFile(...parts: string[]): string {
  const candidates = [
    resolve(process.cwd(), '..', ...parts),
    resolve(process.cwd(), ...parts),
  ];
  const hit = candidates.find(existsSync);
  return hit ? readFileSync(hit, 'utf8') : '';
}

/** Yorum satırlarını atar — sözleşme kilitleri YALNIZ çalıştırılabilir SQL'e bakar. */
function executableSql(sql: string): string {
  return sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   INVARIANT 1 — İSTEMCİ ROLÜ TRUNCATE ALAMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F0.1 · TRUNCATE ayrıcalığı (migration 075 sözleşmesi)', () => {
  const SQL = repoFile('supabase', 'migrations', '20260917000075_client_role_truncate_revoke_p0.sql');
  const EXEC = executableSql(SQL);

  it('migration dosyası VAR — boş sözleşme test edilmez', () => {
    expect(SQL.length).toBeGreaterThan(1000);
  });

  it('anon ve authenticated rollerinden TRUNCATE geri alınır', () => {
    expect(EXEC).toMatch(/REVOKE TRUNCATE[^']*FROM anon, authenticated/);
  });

  it('🔴 SELECT/INSERT/UPDATE/DELETE GERİ ALINMAZ — head unit erişimi korunur', () => {
    /* Bu dosya yalnız TRUNCATE sınıfını daraltır. Okuma/yazma ayrıcalığı
       geri alınırsa araç komut almayı bırakır (bkz. migration 037 "FAZ 2"). */
    expect(EXEC).not.toMatch(/REVOKE[^;]*\bSELECT\b/i);
    expect(EXEC).not.toMatch(/REVOKE[^;]*\bINSERT\b/i);
    expect(EXEC).not.toMatch(/REVOKE[^;]*\bUPDATE\b/i);
    expect(EXEC).not.toMatch(/REVOKE[^;]*\bDELETE\b/i);
  });

  it('service_role ayrıcalıklarına DOKUNULMAZ', () => {
    expect(EXEC).not.toMatch(/REVOKE[^;]*FROM[^;]*service_role/i);
  });

  it('RLS politikalarına DOKUNULMAZ (grant daraltma ≠ politika değişimi)', () => {
    expect(EXEC).not.toMatch(/CREATE POLICY/i);
    expect(EXEC).not.toMatch(/DROP POLICY/i);
    expect(EXEC).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });

  it('fail-closed doğrulama içerir — sessizce yarım uygulanamaz', () => {
    expect(EXEC).toMatch(/RAISE EXCEPTION[^;]*DOĞRULAMA A/);
    expect(EXEC).toMatch(/RAISE EXCEPTION[^;]*DOĞRULAMA B/);
  });

  it('güvenlik matrisi artık TRUNCATE de prob\'lar (063 oracle)', () => {
    const matrix = repoFile('supabase', 'tests', '063_rls_exposure_matrix.sql');
    expect(matrix.length).toBeGreaterThan(500);
    expect(matrix).toMatch(/TRUNCATE/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   INVARIANT 4 — TAŞIMA YAZMASI "ONAYLANDI"/VERIFIED OLMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F0.3 · komut kanıt seviyesi', () => {
  it('DB `completed` → DELIVERED (asla VERIFIED değil)', () => {
    for (const type of ['lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on'] as const) {
      expect(evidenceLevelFor('completed', type)).toBe('DELIVERED');
      expect(evidenceLevelFor('completed', type)).not.toBe('VERIFIED');
    }
  });

  it('fiziksel OLMAYAN komutlarda da `completed` VERIFIED üretmez', () => {
    /* Bugün hiçbir komutun geri okuma kanıtı UI\'ya ULAŞMIYOR (DTC sonucu
       uç 410 kapalı). Dolayısıyla VERIFIED hiçbir yoldan doğmamalıdır. */
    for (const type of ['read_dtc', 'clear_dtc', 'read_voltage', 'route_send', 'theme_change'] as const) {
      expect(evidenceLevelFor('completed', type)).not.toBe('VERIFIED');
    }
  });

  it('VERIFIED seviyesi bugün HİÇBİR durumdan üretilemez (rezerve)', () => {
    const statuses = ['pending', 'accepted', 'executing', 'completed', 'failed', 'expired', 'rejected'] as const;
    const types    = ['lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on',
                      'route_send', 'navigation_start', 'theme_change', 'layout_change',
                      'read_dtc', 'clear_dtc', 'read_voltage', 'set_speed_alert'] as const;
    for (const s of statuses) {
      for (const t of types) {
        for (const q of [true, false]) {
          expect(evidenceLevelFor(s, t, q)).not.toBe('VERIFIED');
        }
      }
    }
  });

  it('terminal olmayan/olumsuz durumlar doğru sınıflanır', () => {
    expect(evidenceLevelFor('pending',   'lock', true)).toBe('QUEUED');
    expect(evidenceLevelFor('accepted',  'lock')).toBe('RECEIVED');
    expect(evidenceLevelFor('executing', 'lock')).toBe('RECEIVED');
    expect(evidenceLevelFor('rejected',  'lock')).toBe('REJECTED');
    expect(evidenceLevelFor('expired',   'lock')).toBe('EXPIRED');
    expect(evidenceLevelFor('failed',    'lock')).toBe('FAILED');
  });

  it('kullanıcıya gösterilen metinler fiziksel doğrulama İDDİA ETMEZ', () => {
    /* "onaylandı" kelimesi YALNIZ rezerve VERIFIED metninde geçebilir. */
    for (const [level, text] of Object.entries(EVIDENCE_TITLE)) {
      if (level === 'VERIFIED') continue;
      expect(text.toLowerCase()).not.toContain('onayland');
    }
    for (const [level, text] of Object.entries(EVIDENCE_DETAIL)) {
      if (level === 'VERIFIED') continue;
      expect(text.toLowerCase()).not.toContain('onayland');
    }
    expect(EVIDENCE_DETAIL.DELIVERED.toLowerCase()).toContain('kontrol');
  });

  it('DELIVERED olumlu sayılır ama fiziksel kanıt İDDİA ETMEZ', () => {
    expect(isPositiveEvidence('DELIVERED')).toBe(true);
    expect(isPositiveEvidence('FAILED')).toBe(false);
    expect(isPhysicalCommand('lock')).toBe(true);
    expect(isPhysicalCommand('theme_change')).toBe(false);
  });

  it('UI yüzeylerinde "Onaylandı ✓" / "Araçta onaylandı" metinleri KALMADI', () => {
    const control = repoFile('website', 'src', 'components', 'dashboard', 'MobileCarControl.tsx');
    const tracker = repoFile('website', 'src', 'hooks', 'useCommandTracker.ts');
    expect(control.length).toBeGreaterThan(1000);
    expect(tracker.length).toBeGreaterThan(500);

    const executable = (src: string) =>
      src.split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
        .join('\n');

    expect(executable(control)).not.toContain('Onaylandı ✓');
    expect(executable(control)).not.toContain('Araçta onaylandı');
    /* Komut etiketleri geçmiş zaman kipinde "oldu" demiyor. */
    expect(executable(tracker)).not.toContain('Kapılar Kilitlendi');
    expect(executable(tracker)).not.toContain('Korna Çalındı');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   INVARIANT 7 — ÜRETİMDE DEMO FALLBACK KAPALI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F0.6 · demo fallback fail-closed', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('production → demo fallback KAPALI', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isProductionRuntime()).toBe(true);
    expect(isDemoFallbackAllowed()).toBe(false);
  });

  it('development/test → demo fallback açık (ergonomi korunur)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isDemoFallbackAllowed()).toBe(true);
    vi.stubEnv('NODE_ENV', 'test');
    expect(isDemoFallbackAllowed()).toBe(true);
  });

  it('link rotası yapılandırma eksikken üretimde sahte kullanıcı ÜRETMEZ', () => {
    const route = repoFile('website', 'src', 'app', 'api', 'vehicle', 'link', 'route.ts');
    expect(route.length).toBeGreaterThan(500);
    /* Koşulsuz `return 'mock-user'` KALMADI; demo kapısına bağlandı. */
    expect(route).not.toMatch(/if \(!isSupabaseConfigured\) return 'mock-user';/);
    expect(route).toMatch(/isDemoFallbackAllowed\(\)/);
    expect(route).toMatch(/MISCONFIGURED_STATUS/);
  });

  it('unlink rotası da aynı kapıyı kullanır (sahte başarı YOK)', () => {
    const route = repoFile('website', 'src', 'app', 'api', 'vehicle', 'unlink', 'route.ts');
    expect(route.length).toBeGreaterThan(500);
    expect(route).toMatch(/isDemoFallbackAllowed\(\)/);
    expect(route).toMatch(/MISCONFIGURED_STATUS/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   INVARIANT 5 + 6 — UNLINK: SUNUCU ÖNCE, BAŞKASININ ARACI DOKUNULAMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

const pairingMocks = vi.hoisted(() => ({
  ensurePwaSession: vi.fn<() => Promise<string | null>>(async () => 'tok'),
  authorizePairingContinuation: vi.fn(async () => ({ allowed: true as const })),
}));

vi.mock('../lib/supabase', () => ({
  ensurePwaSession:     pairingMocks.ensurePwaSession,
  supabaseBrowser:      null,
  isSupabaseConfigured: true,
}));

vi.mock('../security/accountCleanup/accountCleanupRuntime', () => ({
  authorizePairingContinuation: pairingMocks.authorizePairingContinuation,
  evaluateAccountScopedCapability: vi.fn(() => ({ allowed: true, generation: 1 })),
}));

describe('F0.4 · sunucu-otoriteli unlink', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    pairingMocks.ensurePwaSession.mockResolvedValue('tok');
    pairingMocks.authorizePairingContinuation.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function loadService() {
    return await import('../lib/pairingService');
  }

  it('sunucu başarısızsa BAŞARI DÖNMEZ — çağıran yereli silmemelidir', async () => {
    const { unpairVehicle } = await loadService();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404,
      json: async () => ({ error: 'Bu araç hesabınıza bağlı değil.', code: 'vehicle_not_paired' }),
    })));

    const res = await unpairVehicle('11111111-1111-4111-8111-111111111111');
    expect(res.success).toBe(false);
    expect(res.code).toBe('vehicle_not_paired');
    /* 4xx kalıcı reddir → tekrar denemeye çağırmaz. */
    expect(res.retryable).toBe(false);
  });

  it('ağ hatasında da BAŞARI DÖNMEZ ve "kesilmedi" der (sessiz kayıp yok)', async () => {
    const { unpairVehicle } = await loadService();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));

    const res = await unpairVehicle('11111111-1111-4111-8111-111111111111');
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(true);
    expect(res.message).toMatch(/KESİLMEDİ/i);
  });

  it('sunucu başarılıysa başarı ve ownerCleared kanıtı döner', async () => {
    const { unpairVehicle } = await loadService();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ vehicleId: 'v1', ownerCleared: true }),
    })));

    const res = await unpairVehicle('11111111-1111-4111-8111-111111111111');
    expect(res.success).toBe(true);
    expect(res.ownerCleared).toBe(true);
  });

  it('unpairVehicle YEREL KAYDA DOKUNMAZ — temizlik çağıranın işidir', async () => {
    const { unpairVehicle } = await loadService();
    store['caros_pair_vehicle_id'] = 'v1';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ vehicleId: 'v1', ownerCleared: true }),
    })));

    await unpairVehicle('11111111-1111-4111-8111-111111111111');
    /* Servis yerel kaydı SİLMEZ; sıra ekranda (sunucu kanıtı → yerel temizlik). */
    expect(store['caros_pair_vehicle_id']).toBe('v1');
  });

  it('oturum yoksa sunucuya GİTMEZ (fail-closed)', async () => {
    const { unpairVehicle } = await loadService();
    pairingMocks.ensurePwaSession.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await unpairVehicle('11111111-1111-4111-8111-111111111111');
    expect(res.success).toBe(false);
    expect(res.code).toBe('AUTH_REQUIRED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('kumanda ekranı yerel temizliği YALNIZ sunucu başarısından SONRA yapar', () => {
    const page = repoFile('website', 'src', 'app', '(pwa)', 'kumanda', 'page.tsx');
    expect(page.length).toBeGreaterThan(1000);
    const unpairIdx  = page.indexOf('await unpairVehicle(');
    const guardIdx   = page.indexOf('if (!res.success)');
    const clearIdx   = page.indexOf('clearLocalVehicle()', unpairIdx);
    const removeIdx  = page.indexOf('removeVehicle(vehicle.id)', unpairIdx);
    expect(unpairIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(unpairIdx);
    expect(clearIdx).toBeGreaterThan(guardIdx);
    expect(removeIdx).toBeGreaterThan(guardIdx);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   INVARIANT 6 + 8 + 10 — RPC SÖZLEŞMELERİ (sahiplik · limit · PIN)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F0.4 · unpair RPC sözleşmesi (migration 076)', () => {
  const SQL  = repoFile('supabase', 'migrations', '20260917000076_unpair_vehicle_from_user_p0.sql');
  const EXEC = executableSql(SQL);

  it('migration dosyası VAR', () => {
    expect(SQL.length).toBeGreaterThan(1000);
  });

  it('🔴 yalnız ÇAĞIRANIN kendi eşleşme satırı silinir', () => {
    expect(EXEC).toMatch(/DELETE FROM public\.vehicle_pairings[\s\S]{0,120}WHERE user_id = p_user_id AND vehicle_id = p_vehicle_id/);
  });

  it('🔴 bağı olmayan çağıran REDDEDİLİR (başkasının aracına dokunulamaz)', () => {
    expect(EXEC).toMatch(/IF NOT v_was_owner AND NOT v_had_pairing THEN[\s\S]{0,160}vehicle_not_paired/);
  });

  it('sahiplik YALNIZ bireysel araçta ve YALNIZ sahibi için temizlenir', () => {
    expect(EXEC).toMatch(/IF v_was_owner AND v_vehicle\.company_id IS NULL THEN/);
    expect(EXEC).toMatch(/SET owner_id = NULL/);
  });

  it('şirket aracının company_id\'sine DOKUNULMAZ (filo yapısı korunur)', () => {
    expect(EXEC).not.toMatch(/SET\s+company_id\s*=\s*NULL/i);
  });

  it('bakım/yakıt/telemetri kayıtları SİLİNMEZ', () => {
    for (const t of ['vehicle_fuel_logs', 'vehicle_service_records', 'vehicle_telemetry', 'vehicle_locations']) {
      expect(EXEC).not.toMatch(new RegExp(`DELETE FROM public\\.${t}`, 'i'));
    }
  });

  it('istemci rolleri RPC\'yi çağıramaz (p_user_id sahteciliği kapalı)', () => {
    expect(EXEC).toMatch(/REVOKE ALL ON FUNCTION public\.unpair_vehicle_from_user\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
    expect(EXEC).toMatch(/GRANT EXECUTE ON FUNCTION public\.unpair_vehicle_from_user\(uuid, uuid\) TO service_role/);
  });

  it('eşleştirmeyle AYNI advisory kilidi kullanır (3 araç sayımı yarışmaz)', () => {
    expect(EXEC).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
  });
});

describe('F0 · mevcut güvenlik sözleşmeleri KORUNDU', () => {
  it('bireysel 3 araç limiti yerinde (migration 034)', () => {
    const SQL = executableSql(
      repoFile('supabase', 'migrations', '20260729000034_pairing_company_and_owner_gps.sql'),
    );
    expect(SQL).toMatch(/c_individual_max\s+constant\s+integer\s*:=\s*3/);
    expect(SQL).toMatch(/individual_vehicle_limit_reached/);
    expect(SQL).toMatch(/vehicle_owned_by_another_user/);
  });

  it('kritik komut PIN zorlaması yerinde (DB trigger + RPC)', () => {
    const baseline = repoFile('supabase', 'migrations', '00000000000000_prod_baseline.sql');
    expect(baseline).toMatch(/CREATE TRIGGER trigger_enforce_critical_pin BEFORE INSERT ON public\.vehicle_commands/);
    expect(baseline).toMatch(/critical_pin_required/);

    const svc = repoFile('website', 'src', 'lib', 'commandService.ts');
    expect(svc).toMatch(/verify_and_send_critical_command/);
    expect(svc).toMatch(/isCriticalCommand/);
  });

  it('fiziksel komutlarda E2E şifreleme zorunluluğu yerinde', () => {
    const svc = repoFile('website', 'src', 'lib', 'commandService.ts');
    expect(svc).toMatch(/requiresE2E\(type\)/);
    /* Şifreleme başarısızsa komut GÖNDERİLMEZ — sessiz düz metin düşüşü YOK. */
    expect(svc).toMatch(/Komut şifrelenemedi; güvenlik gereği gönderilmedi\./);
  });
});
