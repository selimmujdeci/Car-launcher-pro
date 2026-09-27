/** Sürüşte ayar kilidi (Google/Tesla önerisi, 2026-09-27). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextMovingLock, LOCK_KMH, UNLOCK_KMH } from '../components/settings/useMovingLock';

describe('sürüşte kilit kararı (histerezis)', () => {
  it('duran araç kilitlenmez; ≥10 km/h kilitlenir', () => {
    expect(nextMovingLock(false, 0)).toBe(false);
    expect(nextMovingLock(false, LOCK_KMH - 1)).toBe(false);
    expect(nextMovingLock(false, LOCK_KMH)).toBe(true);
  });
  it('kilitliyken 3–10 arası titreme kilidi AÇMAZ; <3 açar', () => {
    expect(nextMovingLock(true, 6)).toBe(true);
    expect(nextMovingLock(true, UNLOCK_KMH)).toBe(true);
    expect(nextMovingLock(true, UNLOCK_KMH - 0.5)).toBe(false);
  });
  it('hız bilinmiyorsa kilit KONMAZ (sinema modu ile aynı kabul)', () => {
    expect(nextMovingLock(false, null)).toBe(false);
    expect(nextMovingLock(true, undefined)).toBe(false);
    expect(nextMovingLock(true, Number.NaN)).toBe(false);
  });
  it('ayarlar sayfası: kilitteyken yalnız Ses sekmesi gösterilir', () => {
    const src = readFileSync(resolve('src/components/settings/SettingsPage.tsx'), 'utf8');
    expect(src).toContain("const shownTab: Tab | null = movingLock && tab !== 'sound' ? null : tab;");
    expect(src).not.toMatch(/\{tab === '/);        // tüm sekme blokları kilidi dinler
    expect(src).toContain('data-settings-driving-lock');
  });
});
