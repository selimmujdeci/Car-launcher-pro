/**
 * inAppBrowser.test.ts — KİLİT (2026-06-21).
 *
 * Bug: API key konsolları (groq/anthropic/google) X-Frame-Options ile iframe'i
 * reddeder. BLOCKED_HOSTS'ta olmazlarsa uygulama-içi iframe'de BOŞ açılır →
 * kullanıcıya "link çalışmıyor" gibi görünür. Bu host'lar window.open (yeni sekme)
 * ile açılMALI. Groq listede unutulmuştu (#fix).
 *
 * Bu kilidi zayıflatma — yeni bir key-konsolu eklenince BLOCKED_HOSTS'a da ekle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openInApp, subscribeInApp } from '../platform/inAppBrowser';

describe('inAppBrowser — API konsol host\'ları yeni sekmede açılır', () => {
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openSpy = vi.fn();
    vi.stubGlobal('window', { ...globalThis.window, open: openSpy });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const consoleHosts = [
    'https://console.groq.com/keys',
    'https://console.anthropic.com/settings/keys',
    'https://aistudio.google.com/apikey',
    'https://app.tavily.com',
  ];

  consoleHosts.forEach((url) => {
    it(`${new URL(url).hostname} → window.open (iframe değil)`, () => {
      openInApp(url);
      expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    });
  });

  it('normal (engelsiz) URL → iframe overlay (window.open ÇAĞRILMAZ)', () => {
    let current: string | null = null;
    const unsub = subscribeInApp((u) => { current = u; });
    openInApp('https://example.com/page');
    expect(openSpy).not.toHaveBeenCalled();
    expect(current).toBe('https://example.com/page');
    unsub();
  });
});
