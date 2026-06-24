/**
 * safetyOverlay birim testleri — FAZ 3A
 *
 * YAKLAŞIM: renderToStaticMarkup (react-dom/server) ile SafetyOverlayView
 * test edilir — hook/store/DOM yok. Saf presentational mantığı doğrulanır.
 *
 * @testing-library/react KULLANILMAZ (yüklü değil).
 * useSafetyAlerts hook'u bu testlerde çağrılmaz.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafetyOverlayView } from '../components/safety/SafetyOverlay';
import type { SafetyAlert, SafetyQueueOutput } from '../platform/safety/types';

// ── Fixture yardımcısı ────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<SafetyAlert> & Pick<SafetyAlert, 'ruleId' | 'level' | 'screen'>): SafetyAlert {
  return {
    message:  'Test mesajı',
    icon:     'door',
    priority: overrides.level === 'critical' ? 90 : overrides.level === 'warning' ? 55 : 10,
    ts:       1000,
    ...overrides,
  };
}

function makeOutput(overrides: Partial<SafetyQueueOutput>): SafetyQueueOutput {
  return {
    visibleAlerts:         [],
    primaryBannerAlert:    null,
    voiceAnnouncementAlert: null,
    muted:                 [],
    suppressed:            [],
    ...overrides,
  };
}

// ── Boş çıktı ─────────────────────────────────────────────────────────────────

describe('SafetyOverlayView — boş çıktı', () => {
  it('hiçbir alert yoksa null döner (markup boş string)', () => {
    const output = makeOutput({});
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);
    expect(html).toBe('');
  });
});

// ── Critical banner ───────────────────────────────────────────────────────────

describe('SafetyOverlayView — critical banner', () => {
  it('critical banner + visibleAlerts → data-testid="safety-banner-critical" ve mesaj görünür', () => {
    const bannerAlert = makeAlert({
      ruleId:  'door.open',
      level:   'critical',
      screen:  'banner',
      message: 'Kapı Açık! Yavaşla.',
      icon:    'door',
    });
    const output = makeOutput({
      visibleAlerts:      [bannerAlert],
      primaryBannerAlert: bannerAlert,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    expect(html).toContain('safety-banner-critical');
    expect(html).toContain('Kapı Açık! Yavaşla.');
    // Kırmızı arka plan sınıfı
    expect(html).toContain('bg-red-600');
  });
});

// ── Warning banner ────────────────────────────────────────────────────────────

describe('SafetyOverlayView — warning banner', () => {
  it('warning seatbelt → data-testid="safety-banner-warning" + bg-amber görünür', () => {
    const bannerAlert = makeAlert({
      ruleId:  'seatbelt.off',
      level:   'warning',
      screen:  'banner',
      message: 'Emniyet kemeri takılı değil.',
      icon:    'seatbelt',
    });
    const output = makeOutput({
      visibleAlerts:      [bannerAlert],
      primaryBannerAlert: bannerAlert,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    expect(html).toContain('safety-banner-warning');
    expect(html).toContain('bg-amber-500');
    expect(html).toContain('Emniyet kemeri takılı değil.');
    // Critical banner OLMAMALI
    expect(html).not.toContain('safety-banner-critical');
  });
});

// ── Yalnızca ikon alert ───────────────────────────────────────────────────────

describe('SafetyOverlayView — icon-only alert', () => {
  it('screen=icon (low_fuel) → safety-icon-strip var; banner yok', () => {
    const fuelAlert = makeAlert({
      ruleId: 'fuel.low',
      level:  'info',
      screen: 'icon',
      icon:   'fuel',
    });
    const output = makeOutput({
      visibleAlerts:      [fuelAlert],
      primaryBannerAlert: null,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    expect(html).toContain('safety-icon-strip');
    expect(html).not.toContain('safety-banner-critical');
    expect(html).not.toContain('safety-banner-warning');
  });

  it('icon alert → data-rule ruleId etiketiyle render', () => {
    const fuelAlert = makeAlert({
      ruleId: 'fuel.low',
      level:  'info',
      screen: 'icon',
      icon:   'fuel',
    });
    const output = makeOutput({
      visibleAlerts:      [fuelAlert],
      primaryBannerAlert: null,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);
    expect(html).toContain('data-rule="fuel.low"');
  });
});

// ── Reverse overlay ───────────────────────────────────────────────────────────

describe('SafetyOverlayView — reverse (kamera ReversePriorityOverlay işidir)', () => {
  it('screen=overlay alert → SafetyOverlay HİÇBİR ŞEY render etmez (markup boş)', () => {
    const reverseAlert = makeAlert({
      ruleId: 'reverse.active',
      level:  'info',
      screen: 'overlay',
      icon:   'reverse',
    });
    const output = makeOutput({
      visibleAlerts:      [reverseAlert],
      primaryBannerAlert: null,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    // Reverse tamamen gerçek kameraya (App.tsx) bırakıldı → placeholder yok
    expect(html).toBe('');
  });

  it('reverse + başka alert birlikte gelse bile SafetyOverlay banner/ikon GÖSTERMEZ', () => {
    const reverseAlert = makeAlert({
      ruleId: 'reverse.active',
      level:  'info',
      screen: 'overlay',
      icon:   'reverse',
    });
    const doorAlert = makeAlert({
      ruleId:  'door.open',
      level:   'critical',
      screen:  'banner',
      message: 'Kapı Açık!',
      icon:    'door',
    });
    const output = makeOutput({
      visibleAlerts:      [reverseAlert, doorAlert],
      primaryBannerAlert: doorAlert,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    // Reverse aktifken hiçbir banner/ikon çizilmez
    expect(html).toBe('');
  });
});

// ── Çoklu alert ───────────────────────────────────────────────────────────────

describe('SafetyOverlayView — çoklu alert', () => {
  it('critical banner + birkaç visible ikon → hem banner hem icon strip render', () => {
    const bannerAlert = makeAlert({
      ruleId:  'door.open',
      level:   'critical',
      screen:  'banner',
      message: 'Kapı Açık!',
      icon:    'door',
    });
    const fuelAlert = makeAlert({
      ruleId: 'fuel.low',
      level:  'info',
      screen: 'icon',
      icon:   'fuel',
    });
    const tempAlert = makeAlert({
      ruleId: 'temp.high',
      level:  'warning',
      screen: 'icon',
      icon:   'temp',
    });
    const output = makeOutput({
      visibleAlerts:      [bannerAlert, fuelAlert, tempAlert],
      primaryBannerAlert: bannerAlert,
    });
    const html = renderToStaticMarkup(<SafetyOverlayView output={output} />);

    expect(html).toContain('safety-banner-critical');
    expect(html).toContain('safety-icon-strip');
    expect(html).toContain('Kapı Açık!');
    expect(html).toContain('data-rule="fuel.low"');
    expect(html).toContain('data-rule="temp.high"');
  });
});
