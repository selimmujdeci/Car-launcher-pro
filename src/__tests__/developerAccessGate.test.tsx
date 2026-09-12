/**
 * developerAccessGate.test.tsx — GELİŞTİRİCİ ERİŞİM KAPISI KİLİTLERİ (2026-07-26).
 *
 * ÜRÜN GERÇEĞİ: CAROS PRO hâlâ geliştirme + aile içi saha testi aşamasında.
 * Test APK'sını kuran HER cihazda geliştirici yüzeyleri açık olmalı — rol,
 * `canDebug`, localStorage veya gizli mühendislik girişi GEREKMEDEN.
 *
 * BU KİLİTLER İKİ YÖNÜ BİRDEN KORUR:
 *  (A) test build'inde erişim SESSİZCE KAPANMASIN (bugünkü gerçek ihtiyaç),
 *  (B) satış build'inde geliştirici yüzeyi SESSİZCE AÇILMASIN (fail-closed).
 *
 * NOT: `import.meta.env.DEV` vitest'te true'dur; bu yüzden (B) yönü doğrudan
 * SAF KAPI FONKSİYONU üzerinden, bayrak `false` verilerek kanıtlanır — üretim
 * davranışını taklit etmek için sahte bir "production" ortamı KURULMAZ.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  isCarosLabAllowed, carosLabGateReason, shouldRenderCarosLab, isCarosLabAllowedFromEnv,
} from '../platform/devtools/carosLabGate';
import { openCarosLab } from '../platform/devtools/carosLabEntry';
import { DEVELOPER_FEATURES_ENABLED } from '../platform/debug/developerFeatures';
import { DEBUG_ENABLED } from '../platform/debug';
import { useCarosLabAllowed } from '../hooks/useCarosLabAllowed';
import { useRoleStore } from '../platform/roleSystem/RoleStore';
import { ROLE_PERMISSIONS } from '../platform/roleSystem/types';
import { AppGrid } from '../components/apps/AppGrid';
import type { UserRole } from '../platform/roleSystem/types';

const ALL_ROLES: UserRole[] = ['driver', 'technician', 'admin', 'super_admin'];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function renderAppGrid(): string {
  return renderToStaticMarkup(
    <AppGrid apps={[]} favorites={[]} onToggleFavorite={() => {}} onLaunch={() => {}} />,
  );
}

afterEach(() => {
  useRoleStore.getState().setRole('driver');
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 1 — TEK OTORİTE
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 1 — build kararı TEK yerde hesaplanır', () => {
  it('DEVELOPER_FEATURES_ENABLED bir boolean sabittir', () => {
    expect(typeof DEVELOPER_FEATURES_ENABLED).toBe('boolean');
  });

  it('DEBUG_ENABLED geriye uyumlu TAKMA ADdır — ayrı bir karar DEĞİL', () => {
    expect(DEBUG_ENABLED).toBe(DEVELOPER_FEATURES_ENABLED);
  });

  it('karar ifadesi YALNIZ developerFeatures.ts içinde yazılıdır', async () => {
    const { readFileSync } = await import('node:fs');
    const { globSync } = await import('node:fs');
    const files = globSync('src/**/*.{ts,tsx}').filter(
      (f: string) => !f.includes('__tests__') && !f.includes('admin'),
    );
    const EXPR = /VITE_ENABLE_DEBUG_PANEL/;
    const owners = files.filter((f: string) => EXPR.test(stripComments(readFileSync(f, 'utf8'))));
    // Kararı YAZAN tek dosya: developerFeatures.ts
    expect(owners.map((f: string) => f.replace(/\\/g, '/'))).toEqual([
      'src/platform/debug/developerFeatures.ts',
    ]);
  });

  it('menü kapısı ile route kapısı AYNI kararı kullanır', () => {
    // Hook (menü) ve saf kapı (route) aynı sonucu verir
    expect(useCarosLabAllowed()).toBe(isCarosLabAllowedFromEnv());
    expect(isCarosLabAllowedFromEnv()).toBe(DEVELOPER_FEATURES_ENABLED === true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 2 — TEST BUILD'İNDE HER ROLDE AÇIK
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 2 — geliştirme/test build\'inde CAROS LAB her rolde açık', () => {
  it('DEV=true ortamında kapı AÇIK', () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(DEVELOPER_FEATURES_ENABLED).toBe(true);
    expect(isCarosLabAllowedFromEnv()).toBe(true);
  });

  it('DÖRT rolün HEPSİNDE AppGrid kartı basılır (driver dâhil)', () => {
    for (const role of ALL_ROLES) {
      useRoleStore.getState().setRole(role);
      const html = renderAppGrid();
      expect(html).toContain('caros-lab-entry');
    }
  });

  it('rol değişimi developer visibility sonucunu DEĞİŞTİRMEZ', () => {
    const results = ALL_ROLES.map((role) => {
      useRoleStore.getState().setRole(role);
      return useCarosLabAllowed();
    });
    expect(new Set(results).size).toBe(1);           // hepsi aynı
    expect(results[0]).toBe(true);
  });

  it('driver rolünde openCarosLab GERÇEKTEN açar (rol engellemez)', () => {
    useRoleStore.getState().setRole('driver');
    const open = vi.fn();
    expect(openCarosLab({ open })).toBe(true);
    expect(open).toHaveBeenCalledWith('caros-lab');
  });

  it('TEMİZ localStorage ile de açık — cihazlar arası taşıma GEREKMEZ', () => {
    localStorage.clear();
    useRoleStore.getState().setRole('driver');
    expect(useCarosLabAllowed()).toBe(true);
    expect(renderAppGrid()).toContain('caros-lab-entry');
  });

  it('kapı hiçbir yerde localStorage/rol okumaz', async () => {
    const { readFileSync } = await import('node:fs');
    for (const p of [
      'src/platform/devtools/carosLabGate.ts',
      'src/platform/devtools/carosLabEntry.ts',
      'src/hooks/useCarosLabAllowed.ts',
    ]) {
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const banned of ['localStorage', 'canDebug', 'usePermission', 'useRoleStore', 'RoleStore']) {
        expect(src).not.toContain(banned);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 3 — DEBUG PANEL de aynı kapıda
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 3 — Debug Panel kapısı da rolden ayrıldı', () => {
  it('App.tsx yalnız merkezi bayrağı kullanır; canDebug ŞARTI KALDIRILDI', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/App.tsx', 'utf8'));
    expect(src).toContain('DEVELOPER_FEATURES_ENABLED');
    expect(src).not.toContain('canDebug');
    expect(src).not.toContain("usePermission");
    // Kapı SİLİNMEDİ: DebugPanel hâlâ bayrağın arkasında
    expect(src).toMatch(/debugOpen && DEVELOPER_FEATURES_ENABLED/);
  });

  it('debug altyapısı da kararı yeniden hesaplamaz', async () => {
    const { readFileSync } = await import('node:fs');
    for (const p of [
      'src/platform/debug/debugStore.ts',
      'src/core/storage/CacheLRUManager.ts',
    ]) {
      const src = stripComments(readFileSync(p, 'utf8'));
      expect(src).toContain('DEVELOPER_FEATURES_ENABLED');
      expect(src).not.toContain('VITE_ENABLE_DEBUG_PANEL');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 4 — PRODUCTION FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 4 — satış build\'inde her şey FAIL-CLOSED', () => {
  it('bayrak false iken kapı KAPALI', () => {
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
    expect(carosLabGateReason({ developerFeaturesEnabled: false })).toBe('build-flag-off');
  });

  it('bozuk/eksik girdi de REDDEDİLİR (truthy kaçağı yok)', () => {
    expect(isCarosLabAllowed(null)).toBe(false);
    expect(isCarosLabAllowed(undefined)).toBe(false);
    expect(isCarosLabAllowed({} as unknown as never)).toBe(false);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: 1 } as unknown as never)).toBe(false);
    expect(isCarosLabAllowed({ developerFeaturesEnabled: 'true' } as unknown as never)).toBe(false);
  });

  it('kapı kapalıyken DOĞRUDAN route/drawer render EDİLMEZ', () => {
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
    expect(shouldRenderCarosLab('settings', true)).toBe(false);
  });

  it('kapı kapalıyken openCarosLab openDrawer\'ı HİÇ çağırmaz', () => {
    const open = vi.fn();
    expect(openCarosLab({ allowed: () => false, open })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('en yetkili rol (super_admin) bile kapalı kapıyı AÇAMAZ', () => {
    useRoleStore.getState().setRole('super_admin');
    const open = vi.fn();
    expect(openCarosLab({ allowed: () => false, open })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(isCarosLabAllowed({ developerFeaturesEnabled: false })).toBe(false);
  });

  it('varsayılan KAPALIDIR: açmak için bilinçli env bayrağı gerekir', async () => {
    const { readFileSync } = await import('node:fs');
    // Yorumlar SIYRILIR: kural KODU bağlar (başlık açıklaması localStorage'dan
    // "bağlı olmamalı" diye söz eder — bu bir ihlal değildir).
    const src = stripComments(readFileSync('src/platform/debug/developerFeatures.ts', 'utf8'));
    // Sabit ifade: DEV veya AÇIKÇA 'true' verilen bayrak. Başka kaçak yol yok.
    expect(src).toContain("import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true'");
    expect(src).not.toContain('!==');
    expect(src).not.toContain('localStorage');
    // Derleme-zamanı katlanabilirliği: fonksiyona/getter'a çevrilmemiş olmalı
    expect(src).toContain('export const DEVELOPER_FEATURES_ENABLED');
    expect(src).not.toMatch(/export function DEVELOPER_FEATURES_ENABLED/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 5 — ROL SİSTEMİ KORUNDU
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 5 — rol sistemi ve normal izinler DEĞİŞMEDİ', () => {
  it('canDebug izni rol modelinden SİLİNMEDİ (gelecek mühendis modu)', () => {
    expect(ROLE_PERMISSIONS.technician).toContain('canDebug');
    expect(ROLE_PERMISSIONS.admin).toContain('canDebug');
    expect(ROLE_PERMISSIONS.super_admin).toContain('canDebug');
    expect(ROLE_PERMISSIONS.driver).not.toContain('canDebug');
  });

  it('normal uygulama izinleri aynen korunur', () => {
    expect(ROLE_PERMISSIONS.driver).toEqual(['reverseCamera', 'obdData']);
    expect(ROLE_PERMISSIONS.admin).toContain('settingsFull');
    expect(ROLE_PERMISSIONS.super_admin).toContain('accessAdminPanel');
    expect(ROLE_PERMISSIONS.driver).not.toContain('accessAdminPanel');
    expect(ROLE_PERMISSIONS.technician).not.toContain('settingsFull');
  });

  it('rol tabanlı DİĞER yüzeyler hâlâ role bağlıdır (admin kartı)', () => {
    useRoleStore.getState().setRole('driver');
    expect(useRoleStore.getState().can('accessAdminPanel')).toBe(false);
    useRoleStore.getState().setRole('super_admin');
    expect(useRoleStore.getState().can('accessAdminPanel')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 6 — CAROS LAB içeriği (A4/A5/A6/UX-F1) bozulmadı
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT 6 — CAROS LAB katalog/ekran kilitleri korunur', () => {
  it('A4/A5/A6/A7 araçları AVAILABLE ve ekranlarına eşlenir', async () => {
    const { getCarosLabTool } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');
    for (const id of [
      'kwp-monitor', 'vehicle-fingerprint', 'adapter-diagnostics', 'mavi-console',
    ] as const) {
      expect(getCarosLabTool(id)!.status).toBe('AVAILABLE');
      expect(renderAvailableTool(id)).not.toBeNull();
    }
  });

  it('UX-F1 giriş odağı korunur', async () => {
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');
    const q = renderAvailableTool('queue-monitor') as unknown as { type: unknown; props: { focus?: string } };
    const p = renderAvailableTool('poll-scheduler') as unknown as { type: unknown; props: { focus?: string } };
    expect(q.type).toBe(p.type);
    expect(q.props.focus).toBe('queue-monitor');
    expect(p.props.focus).toBe('poll-scheduler');
  });

  it('OBD/native davranışına dokunan bir değişiklik yok (kapı saf ve I/O\'suz)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = stripComments(readFileSync('src/platform/devtools/carosLabGate.ts', 'utf8'));
    for (const f of [
      'obdService', 'sendCommand', 'connectOBD', 'reconnect', 'CarLauncher',
      'setInterval', 'setTimeout', 'fetch(', 'await ',
    ]) expect(src).not.toContain(f);
  });
});
