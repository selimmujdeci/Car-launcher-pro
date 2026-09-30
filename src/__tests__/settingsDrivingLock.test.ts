/** Ayarlar sürüşte KİLİTLENMEZ — sahibin kararı 2026-09-30 ("sürücü yolda uğraşmaz, yanındaki yapar"). */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ayarlar sürüşte açık', () => {
  it('hareket hâlinde de seçilen sekme gösterilir; kilit ekranı yok', () => {
    const src = readFileSync(resolve('src/components/settings/SettingsPage.tsx'), 'utf8');
    expect(src).toContain('const shownTab: Tab = tab;');
    expect(src).not.toContain('data-settings-driving-lock');
    expect(src).not.toContain('useMovingLock');
    expect(existsSync(resolve('src/components/settings/useMovingLock.ts'))).toBe(false);
  });
});
