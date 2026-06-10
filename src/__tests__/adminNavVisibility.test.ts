/**
 * adminNavVisibility.test.ts — P0 Admin UI görünürlük sözleşmesi
 *
 * Bulgu: Incident Center /admin/sa kabuğunda yaşıyor ama normal admin
 * menüsünden oraya link yoktu + sidebar rol filtresi yalnız memberships
 * tablosuna bakıyordu (JWT claim'li süper admin hiçbir şey göremiyordu).
 *
 * Kilitlenen davranış:
 *  1. NAV'da Command Center linki (/sa/health, super_admin, Activity ikonu)
 *  2. resolveCan: JWT super_admin → true (membership olmasa bile);
 *     normal admin → super_admin maddeleri görünmez
 *  3. JWT claim tespiti: app_metadata öncelikli, user_metadata fallback
 *  4. Route sözleşmesi: /admin/sa/incidents kayıtlı + SuperAdminGuard'lı
 *  5. Sidebar render sözleşmesi: can(item.minRole) filtresi + Activity ikonu
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  accessToken: null as string | null,
}));

vi.mock('../admin/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: M.accessToken ? { access_token: M.accessToken } : null },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { NAV } from '../admin/config/navigation';
import { resolveCan } from '../admin/hooks/useRole';
import {
  isSuperAdminJwtPayload,
  hasSuperAdminClaim,
} from '../admin/components/auth/SuperAdminGuard';

/** Sahte JWT üret (header.payload.sig — imza doğrulanmaz, parse edilir). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

/* ── 1. NAV — Command Center linki ───────────────────────────── */

describe('NAV — Command Center linki', () => {
  const allItems = NAV.flatMap((g) => g.items);
  const cc = allItems.find((i) => i.path === '/sa/health');

  it('NAV path doğru: /sa/health (BrowserRouter basename=/admin → /admin/sa/health)', () => {
    expect(cc).toBeDefined();
    expect(cc!.label).toBe('Command Center');
  });

  it('minRole super_admin — normal admin için filtrede elenir', () => {
    expect(cc!.minRole).toBe('super_admin');
  });

  it('icon Activity — Sidebar ICON_MAP\'te kayıtlı', () => {
    expect(cc!.icon).toBe('Activity');
    const sidebarSrc = readFileSync(
      join(process.cwd(), 'src', 'admin', 'components', 'layout', 'Sidebar.tsx'), 'utf-8');
    expect(sidebarSrc).toMatch(/ICON_MAP[\s\S]*?Activity,[\s\S]*?\}/);
  });
});

/* ── 2. resolveCan — JWT fallback kuralı ─────────────────────── */

describe('resolveCan — rol çözümleme', () => {
  it('membership YOK ama JWT super_admin → her minRole için true', () => {
    expect(resolveCan(true, null, 'super_admin')).toBe(true);
    expect(resolveCan(true, null, 'admin')).toBe(true);
    expect(resolveCan(true, null, 'viewer')).toBe(true);
  });

  it('JWT claim yok + membership yok → false', () => {
    expect(resolveCan(false, null, 'viewer')).toBe(false);
  });

  it('normal admin (super_admin değil) → super_admin maddeleri GÖRÜNMEZ', () => {
    expect(resolveCan(false, 'admin', 'super_admin')).toBe(false);
    expect(resolveCan(false, 'operator', 'super_admin')).toBe(false);
  });

  it('membership rol sıralaması korunur (mevcut davranış bozulmadı)', () => {
    expect(resolveCan(false, 'admin', 'operator')).toBe(true);
    expect(resolveCan(false, 'viewer', 'operator')).toBe(false);
    expect(resolveCan(false, 'super_admin', 'super_admin')).toBe(true);
  });
});

/* ── 3. JWT claim tespiti ────────────────────────────────────── */

describe('JWT claim — guard ve sidebar AYNI kaynak', () => {
  it('app_metadata.role=super_admin → true', () => {
    expect(isSuperAdminJwtPayload({ app_metadata: { role: 'super_admin' } })).toBe(true);
  });

  it('user_metadata fallback (geçiş dönemi) → true; app_metadata öncelikli', () => {
    expect(isSuperAdminJwtPayload({ user_metadata: { role: 'super_admin' } })).toBe(true);
    expect(isSuperAdminJwtPayload({
      app_metadata: { role: 'operator' },
      user_metadata: { role: 'super_admin' },
    })).toBe(false); // app_metadata kullanıcı tarafından değiştirilemez → o kazanır
  });

  it('claim yok / farklı rol → false', () => {
    expect(isSuperAdminJwtPayload({})).toBe(false);
    expect(isSuperAdminJwtPayload({ app_metadata: { role: 'admin' } })).toBe(false);
  });

  it('hasSuperAdminClaim: oturum token\'ından uçtan uca çözümler', async () => {
    M.accessToken = fakeJwt({ app_metadata: { role: 'super_admin' } });
    expect(await hasSuperAdminClaim()).toBe(true);

    M.accessToken = fakeJwt({ app_metadata: { role: 'viewer' } });
    expect(await hasSuperAdminClaim()).toBe(false);

    M.accessToken = null; // oturum yok
    expect(await hasSuperAdminClaim()).toBe(false);
  });
});

/* ── 4. Route sözleşmesi ─────────────────────────────────────── */

describe('route — /admin/sa/incidents', () => {
  const appSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'App.tsx'), 'utf-8');

  it('sa route\'u SuperAdminGuard + SuperAdminShell ile sarılı', () => {
    expect(appSrc).toMatch(/path="sa"\s+element=\{<SuperAdminGuard><SuperAdminShell \/><\/SuperAdminGuard>\}/);
  });

  it('incidents alt route\'u kayıtlı → IncidentCenter', () => {
    expect(appSrc).toMatch(/<Route path="incidents"\s+element=\{<IncidentCenter \/>\}/);
  });

  it('SuperAdminShell sidebar\'ında incidents modülü var', () => {
    const shellSrc = readFileSync(
      join(process.cwd(), 'src', 'admin', 'layouts', 'SuperAdminShell.tsx'), 'utf-8');
    expect(shellSrc).toMatch(/path:\s*'incidents'/);
  });
});

/* ── 5. Dashboard — kart YOK; tek giriş noktası sidebar (UX kararı) ── */

describe('Dashboard — Süper Admin Paneli kartı kaldırıldı', () => {
  const dashSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'pages', 'Dashboard.tsx'), 'utf-8');

  it('Dashboard içinde Command Center/SA kartı yok — giriş yalnız sidebar NAV', () => {
    expect(dashSrc).not.toContain('Süper Admin Paneli');
    expect(dashSrc).not.toContain('super-admin-panel-card');
    expect(dashSrc).not.toMatch(/to="\/sa/);
  });

  it('yanlış route üretilmez: /dashboard/admin veya mutlak /admin prefix yok', () => {
    expect(dashSrc).not.toContain('/dashboard/admin');
    expect(dashSrc).not.toMatch(/to="\/admin\/sa/);
  });
});

/* ── 6. Sidebar render sözleşmesi ────────────────────────────── */

describe('Sidebar — rol filtreli render', () => {
  const sidebarSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'components', 'layout', 'Sidebar.tsx'), 'utf-8');
  const useRoleSrc = readFileSync(
    join(process.cwd(), 'src', 'admin', 'hooks', 'useRole.tsx'), 'utf-8');

  it('görünürlük can(item.minRole) ile filtrelenir (NAV verisinden)', () => {
    expect(sidebarSrc).toContain('group.items.filter((item) => can(item.minRole))');
    expect(sidebarSrc).toContain("import { NAV } from '../../config/navigation'");
  });

  it('useRole.can() resolveCan + JWT claim fallback kullanır', () => {
    expect(useRoleSrc).toContain('hasSuperAdminClaim');
    expect(useRoleSrc).toMatch(/return resolveCan\(jwtSuperAdmin, active\?\.role \?\? null, minRole\)/);
  });
});
