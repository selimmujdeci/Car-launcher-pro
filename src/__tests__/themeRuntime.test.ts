/**
 * themeRuntime + CAROS LAB gözlem modeli — davranış kilitleri.
 *
 * Kilitlenen davranışlar:
 *  - Gelen paket şema kapısında REDDEDİLİRSE hiçbir DOM değişikliği OLMAZ ve
 *    red sayacı artar (fail-closed kanıtı gözlemlenebilir).
 *  - Geçerli paket CSS değişkenlerini ve bileşen CSS'ini uygular.
 *  - İkinci uygulama, birincinin bıraktığı BAYAT değişkenleri temizler.
 *  - Manifest tema BAŞINA saklanır (temalar birbirini ezmez).
 *  - LAB modeli "hiç uygulanmadı" · "reddedildi" · "uygulandı ama boş" ·
 *    "uygulandı ve etkin" hükümlerini AYIRIR (sahte "sağlıklı" yok).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyIncomingThemeManifest,
  applyThemeManifest,
  clearAppliedDom,
  clearStoredManifest,
  getStoredManifest,
  getThemeRuntimeSnapshot,
  storeManifest,
  __resetThemeRuntimeForTest,
} from '../platform/theme/themeRuntime';
import { createThemeManifest, makeSolid } from '../platform/theme/themeManifest';
import {
  buildThemeRuntimeCards,
  deriveThemeRuntimeVerdict,
  countByThemeClass,
} from '../platform/devtools/themeRuntimeModel';
import { readThemeRuntimeSnapshot } from '../platform/devtools/themeRuntimeSources';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    themeId: 'pro',
    themeVersion: 3,
    tokens: { accentPrimary: '#5B8DFF' },
    componentOverrides: { 'pro.clock': { radius: 24 } },
    screenOverrides: {},
    metadata: { name: 'Glass Pro', origin: 'pwa-studio', updatedAt: '2026-08-15T10:00:00.000Z' },
    ...overrides,
  };
}

beforeEach(() => {
  __resetThemeRuntimeForTest();
  clearAppliedDom();
  // safeStorage'ın kendi belleği localStorage.clear() ile boşalmaz → depoyu
  // açık API üzerinden temizle (testler birbirinin manifest'ini görmesin).
  for (const id of ['expedition', 'horizon', 'tesla', 'pro'] as const) clearStoredManifest(id);
  __resetThemeRuntimeForTest();
  try { localStorage.clear(); } catch { /* ignore */ }
  document.documentElement.removeAttribute('style');
});

describe('themeManifest — JSON round-trip null koruması', () => {
  it('null alanlar kaydet/yükle sonrası null KALIR (0\'a düşmez)', () => {
    const m = createThemeManifest('pro');
    m.tokens.accentPrimary = '#123456';
    storeManifest(m);
    const back = getStoredManifest('pro');
    expect(back?.tokens.accentPrimary).toBe('#123456');
    expect(back?.tokens.radiusCard).toBeNull();
    expect(back?.tokens.cardBlurPx).toBeNull();
    expect(back?.tokens.fontWeight).toBeNull();
    expect(back?.tokens.lineHeight).toBeNull();
  });
});

describe('themeRuntime — fail-closed uygulama', () => {
  it('bozuk paket UYGULANMAZ ve sebep döner', () => {
    const r = applyIncomingThemeManifest({ schemaVersion: 2, themeId: 'dark' }, 'command');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
    expect(getThemeRuntimeSnapshot().rejectCount).toBe(1);
    expect(getThemeRuntimeSnapshot().applyCount).toBe(0);
  });

  it('geçerli paket CSS değişkeni + bileşen CSS\'i uygular', () => {
    const r = applyIncomingThemeManifest(validPayload(), 'command');
    expect(r.ok).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#5B8DFF');
    expect(document.documentElement.style.getPropertyValue('--accent-rgb')).toBe('91, 141, 255');
    const tag = document.getElementById('caros-theme-manifest-css');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toContain('[data-editable="pro.clock"]');
    expect(tag?.textContent).toContain('border-radius: 24px');
  });

  it('ikinci uygulama bayat değişkeni TEMİZLER', () => {
    applyIncomingThemeManifest(validPayload(), 'command');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#5B8DFF');
    // İkinci manifest accent taşımıyor → eski değer kalmamalı.
    applyIncomingThemeManifest(validPayload({
      tokens: { textPrimary: '#FFFFFF' },
      componentOverrides: {},
    }), 'command');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('#FFFFFF');
  });

  it('önizleme kaynağı KALICI YAZMAZ', () => {
    applyIncomingThemeManifest(validPayload(), 'preview');
    expect(getStoredManifest('pro')).toBeNull();
    expect(getThemeRuntimeSnapshot().lastSource).toBe('preview');
  });

  it('komut kaynağı kalıcı yazar', () => {
    applyIncomingThemeManifest(validPayload(), 'command');
    expect(getStoredManifest('pro')?.themeVersion).toBe(3);
  });
});

describe('themeRuntime — tema başına depo', () => {
  it('farklı temaların manifestleri birbirini EZMEZ', () => {
    const a = createThemeManifest('pro');
    a.tokens.accentPrimary = '#111111';
    const b = createThemeManifest('tesla');
    b.tokens.accentPrimary = '#222222';
    storeManifest(a);
    storeManifest(b);
    expect(getStoredManifest('pro')?.tokens.accentPrimary).toBe('#111111');
    expect(getStoredManifest('tesla')?.tokens.accentPrimary).toBe('#222222');
    clearStoredManifest('pro');
    expect(getStoredManifest('pro')).toBeNull();
    expect(getStoredManifest('tesla')?.tokens.accentPrimary).toBe('#222222');
  });
});

describe('themeRuntime — gradient uygulaması', () => {
  it('yapısal boya CSS metnine çevrilerek uygulanır', () => {
    const m = createThemeManifest('horizon');
    m.tokens.bgPrimary = { kind: 'linear', from: '#000000', to: '#111111', angle: 45, stopA: 0, stopB: 100, alpha: 100 };
    applyThemeManifest(m, 'command', { setBaseTheme: false, persist: false });
    expect(document.documentElement.style.getPropertyValue('--bg-primary'))
      .toBe('linear-gradient(45deg, #000000 0%, #111111 100%)');
  });
});

describe('themePreviewBridge — gerçek araçta dokunuş YUTULMAZ', () => {
  it('köprü kurulunca bile seçim yakalayıcısı takılı DEĞİLDİR (iframe dışı)', async () => {
    const { initThemePreviewBridge } = await import('../platform/themePreviewBridge');
    // jsdom'da window.parent === window → iframe DEĞİL → seçim modu açılamaz.
    initThemePreviewBridge();

    const el = document.createElement('button');
    el.setAttribute('data-editable', 'pro.clock');
    document.body.appendChild(el);

    let clicked = false;
    el.addEventListener('click', () => { clicked = true; });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);

    expect(clicked).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    el.remove();
  });
});

describe('themePreviewBridge — geometri ölçümü (Stüdyo overlay kaynağı)', () => {
  function mount(id: string, rect: { x: number; y: number; w: number; h: number }): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-editable', id);
    el.getBoundingClientRect = () => ({
      left: rect.x, top: rect.y, width: rect.w, height: rect.h,
      right: rect.x + rect.w, bottom: rect.y + rect.h, x: rect.x, y: rect.y,
      toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }

  it('yalnız kayıt defterindeki ve GÖRÜNÜR bileşenleri ölçer', async () => {
    const { probeEditableGeometry } = await import('../platform/themePreviewBridge');
    const a = mount('pro.clock', { x: 10, y: 20, w: 100, h: 50 });
    const b = mount('pro.gauge', { x: 0, y: 0, w: 0, h: 0 });      // sıfır boyut → düşer
    const c = mount('uydurma.kimlik', { x: 5, y: 5, w: 30, h: 30 }); // defterde yok → düşer

    const items = probeEditableGeometry();
    const ids = items.map((i) => i.id);
    expect(ids).toContain('pro.clock');
    expect(ids).not.toContain('pro.gauge');
    expect(ids).not.toContain('uydurma.kimlik');
    const clock = items.find((i) => i.id === 'pro.clock')!;
    expect(clock).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });

    a.remove(); b.remove(); c.remove();
  });

  it('ölçüm SALT-OKUMADIR — DOM\'a hiçbir öznitelik yazılmaz', async () => {
    const { probeEditableGeometry } = await import('../platform/themePreviewBridge');
    const el = mount('pro.clock', { x: 0, y: 0, w: 10, h: 10 });
    const before = el.outerHTML;
    probeEditableGeometry();
    expect(el.outerHTML).toBe(before);
    expect(document.documentElement.getAttribute('data-caros-preview-select')).toBeNull();
    el.remove();
  });
});

describe('CAROS LAB — Tema Manifesti ekranı modeli', () => {
  it('hiç uygulanmamışken NEVER_APPLIED der (sahte "sağlıklı" yok)', () => {
    const snap = readThemeRuntimeSnapshot();
    const v = deriveThemeRuntimeVerdict(snap);
    expect(v.status).toBe('NEVER_APPLIED');
  });

  it('yalnız red varsa REJECTED_LAST der', () => {
    applyIncomingThemeManifest({ schemaVersion: 5, themeId: 'pro' }, 'command');
    const v = deriveThemeRuntimeVerdict(readThemeRuntimeSnapshot());
    expect(v.status).toBe('REJECTED_LAST');
    expect(v.reasons.join(' ')).toContain('REDDEDİLDİ');
  });

  it('içi boş manifest APPLIED_EMPTY der (uygulandı ≠ görünüm değişti)', () => {
    applyThemeManifest(createThemeManifest('pro'), 'command', { setBaseTheme: false, persist: false });
    const v = deriveThemeRuntimeVerdict(readThemeRuntimeSnapshot());
    expect(v.status).toBe('APPLIED_EMPTY');
  });

  it('dolu manifest APPLIED_ACTIVE der', () => {
    const m = createThemeManifest('pro');
    m.tokens.bgCard = makeSolid('#202020');
    applyThemeManifest(m, 'command', { setBaseTheme: false, persist: false });
    const v = deriveThemeRuntimeVerdict(readThemeRuntimeSnapshot());
    expect(v.status).toBe('APPLIED_ACTIVE');
  });

  it('bilinmeyen alan UNAVAILABLE olarak sınıflanır, sahte 0 üretmez', () => {
    const cards = buildThemeRuntimeCards(readThemeRuntimeSnapshot());
    const themeField = cards[0].fields.find((f) => f.id === 'theme-id');
    expect(themeField?.klass).toBe('UNAVAILABLE');
    expect(themeField?.value).toBe('—');
    const counts = countByThemeClass(cards);
    expect(counts.UNAVAILABLE).toBeGreaterThan(0);
  });

  it('ekran modeli manifest İÇERİĞİNİ taşımaz (yalnız sayı/durum/zaman)', () => {
    applyIncomingThemeManifest(validPayload(), 'command');
    const cards = buildThemeRuntimeCards(readThemeRuntimeSnapshot());
    const blob = JSON.stringify(cards);
    expect(blob).not.toContain('#5B8DFF');
    expect(blob).not.toContain('Glass Pro');
    expect(blob).not.toContain('border-radius');
  });
});
