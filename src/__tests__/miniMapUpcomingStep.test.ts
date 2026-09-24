/**
 * miniMapUpcomingStep.test — mini harita YAKLAŞAN manevrayı gösterir, geçileni değil.
 *
 * Saha 2026-09-24 (telefon, sahte sürüş): ses "şimdi sola dönün, Mavi Bulvarı"
 * derken mini harita başlığı hâlâ geçilmiş "56 m Sağa dönün (Gazi Paşa Bulvarı)"
 * gösteriyordu. steps[i] = az önce geçilen manevra (NavigationHUD, 2026-07-05).
 */
import { describe, it, expect } from 'vitest';
import src from '../components/map/MiniMapWidget.tsx?raw';

describe('mini harita adım semantiği', () => {
  it('🔒 levha/metin steps[i+1] (tam ekranla aynı), ARDINDAN steps[i+2]', () => {
    expect(src).toContain('const step = route.steps[route.currentStepIndex + 1] ?? route.steps[route.currentStepIndex];');
    expect(src).toContain('const next = route.steps[route.currentStepIndex + 2] ?? null;');
    expect(src).not.toMatch(/const step = route\.steps\[route\.currentStepIndex\];/);
  });
});
