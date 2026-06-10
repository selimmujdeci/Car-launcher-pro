/**
 * websiteSidebarCommandCenter.test.ts — carospro.com dashboard sidebar'ı
 * Command Center giriş noktası sözleşmesi.
 *
 * UX kararı: Command Center'ın TEK girişi sol sidebar'daki madde
 * (footer'daki "Admin / Süper Admin" alanının hemen üstü). Yalnız
 * JWT app_metadata.role === 'super_admin' görür. Admin SPA ayrı projede
 * (car-launcher-pro.vercel.app) yaşadığı için hedef mutlak URL'dir;
 * path sözleşmesi /admin/sa/health.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeJwtPayload,
  isSuperAdminJwtPayload,
  isSuperAdminToken,
} from '../../website/src/lib/superAdminClaim';

/** Sahte JWT üret (imza doğrulanmaz — parse edilir). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

/* ── 1. Claim zinciri — admin SPA ile aynı kurallar ──────────── */

describe('superAdminClaim — JWT rol tespiti (admin zinciri aynası)', () => {
  it('app_metadata.role=super_admin → görünür', () => {
    expect(isSuperAdminJwtPayload({ app_metadata: { role: 'super_admin' } })).toBe(true);
    expect(isSuperAdminToken(fakeJwt({ app_metadata: { role: 'super_admin' } }))).toBe(true);
  });

  it('normal admin / claim yok → GÖRÜNMEZ', () => {
    expect(isSuperAdminJwtPayload({ app_metadata: { role: 'admin' } })).toBe(false);
    expect(isSuperAdminJwtPayload({})).toBe(false);
    expect(isSuperAdminToken(null)).toBe(false);
    expect(isSuperAdminToken(undefined)).toBe(false);
    expect(isSuperAdminToken('bozuk-token')).toBe(false);
  });

  it('app_metadata öncelikli — user_metadata ile yükseltme yapılamaz', () => {
    expect(isSuperAdminJwtPayload({
      app_metadata:  { role: 'operator' },
      user_metadata: { role: 'super_admin' },
    })).toBe(false);
    // geçiş dönemi: yalnız user_metadata varsa fallback çalışır
    expect(isSuperAdminJwtPayload({ user_metadata: { role: 'super_admin' } })).toBe(true);
  });

  it('decodeJwtPayload: bozuk girişte boş nesne, exception yok', () => {
    expect(decodeJwtPayload('')).toEqual({});
    expect(decodeJwtPayload('a.b.c')).toEqual({});
  });
});

/* ── 2. Sidebar render sözleşmesi ────────────────────────────── */

describe('website Sidebar — Command Center maddesi', () => {
  const src = readFileSync(
    join(process.cwd(), 'website', 'src', 'components', 'layout', 'Sidebar.tsx'), 'utf-8');

  it('madde isSuperAdmin state\'iyle gate\'li (claim zinciri kullanılır)', () => {
    expect(src).toMatch(/\{isSuperAdmin && \(/);
    expect(src).toContain("from '@/lib/superAdminClaim'");
    expect(src).toContain('isSuperAdminToken(');
  });

  it('tıklama hedefi /admin/sa/health (mutlak admin SPA origin\'i ile)', () => {
    expect(src).toContain('/admin/sa/health');
    expect(src).toContain('car-launcher-pro.vercel.app');
    expect(src).toContain('data-testid="command-center-nav"');
  });

  it('konum: nav\'dan sonra, footer (border-t\'li Admin/Süper Admin alanı) öncesi', () => {
    const ccIdx     = src.indexOf('data-testid="command-center-nav"');
    const footerIdx = src.indexOf('User + Logout');
    const navEndIdx = src.indexOf('</nav>');
    expect(ccIdx).toBeGreaterThan(navEndIdx);
    expect(ccIdx).toBeLessThan(footerIdx);
  });

  it('auth aboneliği temizleniyor (zero-leak)', () => {
    expect(src).toContain('onAuthStateChange');
    expect(src).toContain('sub.subscription.unsubscribe()');
  });

  it('mevcut sidebar davranışları bozulmadı: 6 menü maddesi + çıkış duruyor', () => {
    for (const label of ['Dashboard', 'Araçlarım', 'Harita', 'Bildirimler', 'Diagnostic', 'Ayarlar']) {
      expect(src).toContain(`label: '${label}'`);
    }
    expect(src).toContain('Çıkış Yap');
    expect(src).toContain('unreadCount'); // bildirim rozeti
  });
});
