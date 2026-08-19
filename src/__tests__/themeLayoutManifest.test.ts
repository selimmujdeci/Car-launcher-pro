/**
 * Tema Manifesti v3 — YERLEŞİM entegrasyonu kilitleri (araç tarafı).
 *
 * Kilitlenen davranışlar:
 *  - v2 paketi REDDEDİLMEZ; boş yerleşimle v3'e taşınır (geri-uyum).
 *  - Bozuk `layoutOverrides` fail-CLOSED reddedilir.
 *  - Yerleşim alanları `layoutSolver`ın GERÇEK ölçüleridir ve solver'dan geçer —
 *    İKİNCİ MOTOR YOK.
 *  - Kilitli kart yerleşimde de gizlenemez (güvenlik invaryantı korunur).
 *  - Yerleşim TEMA BAŞINA yazılır → paylaşılan kart id'leri (music/vehicle/dock)
 *    diğer temayı EZMEZ.
 *  - Solver kullanmayan tema (horizon/tesla) için yerleşim YAZILMAZ.
 *  - Tema değişince kalıntı kalmaz (CSS + yerleşim).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyIncomingThemeManifest,
  applyThemeManifest,
  clearAppliedDom,
  clearStoredManifest,
  getStoredManifest,
  getThemeRuntimeSnapshot,
  initThemeRuntime,
  __resetThemeRuntimeForTest,
} from '../platform/theme/themeRuntime';
import {
  coerceThemeManifest,
  createThemeManifest,
  layoutOverrideCount,
  manifestToLayoutIntent,
  parseIncomingManifest,
  serializeThemeManifest,
  parseThemeManifestJson,
  THEME_SCHEMA_VERSION,
  makeSolid,
} from '../platform/theme/themeManifest';
import {
  EXPEDITION_MANIFEST,
  PRO_MANIFEST,
  HORIZON_MANIFEST,
  TESLA_MANIFEST,
  ZONES,
  normalizeIntent,
  solveLayout,
} from '../platform/theme/layoutSolver';
import { useLayoutStore } from '../store/useLayoutStore';
import { useCarTheme } from '../store/useCarTheme';
import {
  isLayoutCapableTheme,
  layoutCardIdFor,
  layoutComponentsForTheme,
  getThemeComponent,
} from '../platform/theme/themeComponentRegistry';

const THEMES = ['expedition', 'horizon', 'tesla', 'pro'] as const;

beforeEach(() => {
  __resetThemeRuntimeForTest();
  clearAppliedDom();
  for (const id of THEMES) clearStoredManifest(id);
  __resetThemeRuntimeForTest();
  try { localStorage.clear(); } catch { /* ignore */ }
  document.documentElement.removeAttribute('style');
  useLayoutStore.getState().reset();
});

/* ── Şema sürümü ve geri-uyum ─────────────────────────────────────── */

describe('manifest v3 — sürüm ve geri-uyum', () => {
  it('şema sürümü 3\'tür', () => {
    expect(THEME_SCHEMA_VERSION).toBe(3);
    expect(createThemeManifest('pro').layoutOverrides).toEqual({});
  });

  it('v2 paketi REDDEDİLMEZ — boş yerleşimle taşınır', () => {
    const r = parseIncomingManifest({
      schemaVersion: 2,
      themeId: 'pro',
      themeVersion: 4,
      tokens: { accentPrimary: '#123456' },
      componentOverrides: { 'pro.clock': { radius: 12 } },
      screenOverrides: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migratedFrom).toBe(2);
      expect(r.manifest.schemaVersion).toBe(3);
      expect(r.manifest.layoutOverrides).toEqual({});
      expect(r.manifest.tokens.accentPrimary).toBe('#123456');
      expect(r.manifest.componentOverrides['pro.clock'].radius).toBe(12);
    }
  });

  it('v1 paketi de tanınır (eski PWA)', () => {
    const r = parseIncomingManifest({ schemaVersion: 1, themeId: 'tesla' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.migratedFrom).toBe(1);
  });

  it('ileri sürüm (v4) hâlâ REDDEDİLİR', () => {
    const r = parseIncomingManifest({ schemaVersion: 4, themeId: 'pro' });
    expect(r.ok).toBe(false);
  });
});

/* ── Yerleşim doğrulama (fail-closed + clamp) ─────────────────────── */

describe('yerleşim — doğrulama', () => {
  it('layoutOverrides nesne değilse paket REDDEDİLİR', () => {
    const r = parseIncomingManifest({
      schemaVersion: 3, themeId: 'pro', layoutOverrides: 'clock',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('layoutOverrides');
  });

  it('dizi de nesne sayılmaz — REDDEDİLİR', () => {
    const r = parseIncomingManifest({ schemaVersion: 3, themeId: 'pro', layoutOverrides: [] });
    expect(r.ok).toBe(false);
  });

  it('aralık dışı değerler clamp\'lenir', () => {
    const m = coerceThemeManifest({
      themeId: 'pro',
      layoutOverrides: { clock: { ord: 9999, grow: 99, size: 'XL', visible: 'evet' } },
    });
    expect(m.layoutOverrides.clock.ord).toBe(31);
    expect(m.layoutOverrides.clock.grow).toBe(5);
    expect(m.layoutOverrides.clock.size).toBeNull();   // geçersiz sınıf düşer
    expect(m.layoutOverrides.clock.visible).toBeNull(); // string boolean DEĞİL
  });

  it('güvensiz kart id\'si düşürülür (seçici/anahtar kaçışı yok)', () => {
    const m = coerceThemeManifest({
      themeId: 'pro',
      layoutOverrides: { 'a"]{}': { ord: 1 }, clock: { ord: 2 } },
    });
    expect(Object.keys(m.layoutOverrides)).toEqual(['clock']);
  });

  it('boş yerleşim override\'ı manifest\'e yazılmaz', () => {
    const m = coerceThemeManifest({ themeId: 'pro', layoutOverrides: { clock: {} } });
    expect(m.layoutOverrides.clock).toBeUndefined();
  });

  it('null alanlar JSON round-trip\'inde null KALIR', () => {
    const m = createThemeManifest('pro');
    m.layoutOverrides.clock = { visible: null, size: 'S', ord: null, grow: null };
    const r = parseThemeManifestJson(serializeThemeManifest(m));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.layoutOverrides.clock.size).toBe('S');
      expect(r.manifest.layoutOverrides.clock.ord).toBeNull();
      expect(r.manifest.layoutOverrides.clock.grow).toBeNull();
    }
  });
});

/* ── Solver uyumu (ikinci motor yok) ──────────────────────────────── */

describe('yerleşim — mevcut layoutSolver ile uyum', () => {
  it('manifest → HAM niyet: yalnız dokunulan alanlar taşınır', () => {
    const m = createThemeManifest('pro');
    m.layoutOverrides.clock = { visible: false, size: null, ord: 3, grow: null };
    const intent = manifestToLayoutIntent(m);
    expect(intent.clock).toEqual({ visible: false, ord: 3 });
    expect(intent.gauge).toBeUndefined();
  });

  it('ham niyet solver\'dan geçer ve GERÇEK sıralamayı üretir', () => {
    const m = createThemeManifest('pro');
    // Saat en sona, ayarlar en öne.
    m.layoutOverrides.clock = { visible: null, size: null, ord: 9, grow: null };
    m.layoutOverrides.settings = { visible: null, size: null, ord: 0, grow: null };
    const intent = normalizeIntent(manifestToLayoutIntent(m), PRO_MANIFEST);
    const solved = solveLayout(intent, PRO_MANIFEST);
    const left = solved['left-rail'].items.map((i) => i.id);
    expect(left[0]).toBe('settings');
    expect(left[left.length - 1]).toBe('clock');
  });

  it('gizlenen kart solver çıktısından DÜŞER', () => {
    const m = createThemeManifest('pro');
    m.layoutOverrides.clock = { visible: false, size: null, ord: null, grow: null };
    const solved = solveLayout(normalizeIntent(manifestToLayoutIntent(m), PRO_MANIFEST), PRO_MANIFEST);
    expect(solved['left-rail'].items.map((i) => i.id)).not.toContain('clock');
  });

  it('KİLİTLİ kart yerleşimde de gizlenemez (güvenlik invaryantı)', () => {
    const m = createThemeManifest('pro');
    m.layoutOverrides.gauge = { visible: false, size: null, ord: null, grow: null }; // hız göstergesi
    m.layoutOverrides.nav = { visible: false, size: null, ord: null, grow: null };   // harita
    const solved = solveLayout(normalizeIntent(manifestToLayoutIntent(m), PRO_MANIFEST), PRO_MANIFEST);
    expect(solved['left-rail'].items.map((i) => i.id)).toContain('gauge');
    expect(solved['center-stage'].items.map((i) => i.id)).toContain('nav');
  });

  it('elle boyut (grow) solver ağırlığına birebir geçer', () => {
    const m = createThemeManifest('expedition');
    m.layoutOverrides.music = { visible: null, size: null, ord: null, grow: 4.5 };
    const solved = solveLayout(
      normalizeIntent(manifestToLayoutIntent(m), EXPEDITION_MANIFEST), EXPEDITION_MANIFEST,
    );
    const music = solved['right-rail'].items.find((i) => i.id === 'music');
    expect(music?.grow).toBe(4.5);
  });

  it('hiç yerleşim override\'ı yoksa çıktı FABRİKA sırasıyla aynıdır', () => {
    const m = createThemeManifest('pro');
    const withManifest = solveLayout(normalizeIntent(manifestToLayoutIntent(m), PRO_MANIFEST), PRO_MANIFEST);
    const factory = solveLayout(normalizeIntent({}, PRO_MANIFEST), PRO_MANIFEST);
    expect(withManifest).toEqual(factory);
  });
});

/* ── Kayıt defteri eşlemesi ───────────────────────────────────────── */

describe('yerleşim — kimlik eşlemesi (uydurma yok)', () => {
  /* #660 ile GÜNCELLENDİ (kaldırılmadı): eski kilit "yalnız pro ve expedition
     solver kullanır" diyordu ve o gün DOĞRUYDU — Horizon/Tesla sabit grid ile
     çiziliyor, Stüdyo o temalarda yerleşim bölümünü hiç göstermiyordu. #660 ile
     iki tema da motora bağlandı; kilit yeni doğru davranışı korur. */
  it('DÖRT temanın DÖRDÜ de solver kullanır (#660)', () => {
    for (const t of ['pro', 'expedition', 'horizon', 'tesla'] as const) {
      expect(isLayoutCapableTheme(t), `${t} yerleşim yeteneksiz işaretlenmiş`).toBe(true);
    }
  });

  it('horizon/tesla bileşenleri artık yerleşim kartına eşlenir (#660)', () => {
    for (const t of ['horizon', 'tesla'] as const) {
      const list = layoutComponentsForTheme(t);
      expect(list.length, `${t} için yerleşim kartı eşlemesi yok — bölüm boş kalır`)
        .toBeGreaterThan(0);
      /* Her eşleme GERÇEK bir manifest kartına gitmeli (uydurma id yok). */
      const man = t === 'horizon' ? HORIZON_MANIFEST : TESLA_MANIFEST;
      const ids = man.map((e) => e.id);
      for (const c of list) {
        const cardId = layoutCardIdFor(c, t);
        expect(cardId, `${c.id} için kart id çözülemedi`).not.toBeNull();
        expect(ids, `${c.id} → ${cardId} manifestte YOK (uydurma eşleme)`).toContain(cardId);
      }
    }
  });

  it('pro/expedition bileşenleri gerçek solver kart id\'lerine eşlenir', () => {
    const proIds = layoutComponentsForTheme('pro')
      .map((c) => layoutCardIdFor(c, 'pro'))
      .filter((x): x is string => x !== null);
    const proManifestIds = PRO_MANIFEST.map((e) => e.id);
    for (const id of proIds) expect(proManifestIds).toContain(id);

    const expIds = layoutComponentsForTheme('expedition')
      .map((c) => layoutCardIdFor(c, 'expedition'))
      .filter((x): x is string => x !== null);
    const expManifestIds = EXPEDITION_MANIFEST.map((e) => e.id);
    for (const id of expIds) expect(expManifestIds).toContain(id);
  });

  it('harita bileşeni doğru solver kartına bağlanır (pro: nav, expedition: map)', () => {
    expect(layoutCardIdFor(getThemeComponent('pro.map')!, 'pro')).toBe('nav');
    expect(layoutCardIdFor(getThemeComponent('expedition.map')!, 'expedition')).toBe('map');
  });

  it('yanlış tema için eşleme null döner (tema karışması yok)', () => {
    /* #660 ile GÜNCELLENDİ: ikinci satır eskiden `horizon.map`in HİÇBİR temada
       çözülmediğini kilitliyordu (Horizon solver kullanmıyordu). Artık Horizon
       da motora bağlı → kendi temasında ÇÖZÜLMELİ, YABANCI temada null kalmalı.
       Kilidin koruduğu asıl şey (tema karışmaması) aynen sürüyor. */
    expect(layoutCardIdFor(getThemeComponent('pro.map')!, 'expedition')).toBeNull();
    expect(layoutCardIdFor(getThemeComponent('horizon.map')!, 'pro')).toBeNull();
    expect(layoutCardIdFor(getThemeComponent('horizon.map')!, 'horizon')).toBe('map');
    expect(layoutCardIdFor(getThemeComponent('tesla.clock')!, 'expedition')).toBeNull();
    expect(layoutCardIdFor(getThemeComponent('tesla.clock')!, 'tesla')).toBe('clock');
  });
});

/* ── Çalışma zamanı uygulaması ────────────────────────────────────── */

describe('yerleşim — araç çalışma zamanı', () => {
  it('manifest yerleşimi tema-başına store\'a yazılır', () => {
    const m = createThemeManifest('pro');
    m.layoutOverrides.clock = { visible: false, size: null, ord: null, grow: null };
    applyThemeManifest(m, 'command', { setBaseTheme: false, persist: false });
    const st = useLayoutStore.getState();
    expect(st.byTheme.pro).toBeDefined();
    expect((st.byTheme.pro as Record<string, { visible?: boolean }>).clock.visible).toBe(false);
    expect(getThemeRuntimeSnapshot().appliedLayoutCount).toBe(1);
    expect(getThemeRuntimeSnapshot().layoutCapable).toBe(true);
  });

  /* #660 ile GÜNCELLENDİ: Horizon artık solver kullanıyor, dolayısıyla yerleşim
     YAZILIR ve bu ölü veri DEĞİLDİR. Kilidin koruduğu asıl kural değişmedi —
     "solver kullanmayan temaya yazma" — ama bugün öyle bir tema kalmadı, o
     yüzden kural manifestte OLMAYAN karta yazılmaması üzerinden korunur. */
  it('solver kartı OLMAYAN id ölü veri üretmez (#660 ile güncellendi)', () => {
    const m = createThemeManifest('horizon');
    m.layoutOverrides.media = { visible: false, size: null, ord: null, grow: null, merge: null };
    applyThemeManifest(m, 'command', { setBaseTheme: false, persist: false });
    expect(useLayoutStore.getState().byTheme.horizon,
      'Horizon artık solver kullanıyor — yerleşim niyeti yazılmalı').toBeDefined();
    expect(getThemeRuntimeSnapshot().layoutCapable).toBe(true);

    /* Horizon manifestinde `clock` YOKTUR (o Tesla/Pro kartıdır). Niyet ham
       saklanır ama ÇÖZÜM sırasında elenir → ekrana uydurma kart çıkmaz. */
    const yabanci = createThemeManifest('horizon');
    yabanci.layoutOverrides.clock = { visible: false, size: null, ord: null, grow: null, merge: null };
    applyThemeManifest(yabanci, 'command', { setBaseTheme: false, persist: false });
    const c = solveLayout(
      normalizeIntent(useLayoutStore.getState().byTheme.horizon, HORIZON_MANIFEST),
      HORIZON_MANIFEST,
    );
    const hepsi = ZONES.flatMap((z) => c[z].items.map((x) => x.id));
    expect(hepsi, 'yabancı kart id ekrana sızmış').not.toContain('clock');
  });

  it('paylaşılan kart id\'leri temalar arasında SIZMAZ', () => {
    const pro = createThemeManifest('pro');
    pro.layoutOverrides.music = { visible: false, size: null, ord: null, grow: null };
    applyThemeManifest(pro, 'command', { setBaseTheme: false, persist: false });

    const exp = createThemeManifest('expedition');
    applyThemeManifest(exp, 'command', { setBaseTheme: false, persist: false });

    const st = useLayoutStore.getState();
    // Pro'da müzik gizli, Expedition'da GÖRÜNÜR olmalı.
    const proIntent = normalizeIntent(st.intentFor('pro'), PRO_MANIFEST);
    const expIntent = normalizeIntent(st.intentFor('expedition'), EXPEDITION_MANIFEST);
    expect(proIntent.music.visible).toBe(false);
    expect(expIntent.music.visible).toBe(true);
  });

  it('eski `layout_change` yolu (themeId\'siz) PAYLAŞILAN niyete yazar — davranış korunur', () => {
    useLayoutStore.getState().applyIntent({ clock: { visible: false } });
    expect(useLayoutStore.getState().intent).toEqual({ clock: { visible: false } });
    expect(Object.keys(useLayoutStore.getState().byTheme)).toHaveLength(0);
    // Tema-başına kayıt yoksa okuma paylaşılana düşer (geri-uyum).
    expect(useLayoutStore.getState().intentFor('pro')).toEqual({ clock: { visible: false } });
  });

  it('araca gelen paket yerleşimiyle birlikte uygulanır (uçtan uca)', () => {
    const r = applyIncomingThemeManifest({
      schemaVersion: 3,
      themeId: 'expedition',
      themeVersion: 2,
      tokens: { accentPrimary: '#00FF00' },
      componentOverrides: { 'expedition.range': { radius: 6 } },
      screenOverrides: { home: { accentPrimary: '#00FF00' } },
      layoutOverrides: { range: { ord: 0 } },
    }, 'command');
    expect(r.ok).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#00FF00');
    const tag = document.getElementById('caros-theme-manifest-css');
    expect(tag?.textContent).toContain('[data-editable="expedition.range"]');
    expect(tag?.textContent).toContain('[data-theme-surface="home"]');
    const intent = normalizeIntent(useLayoutStore.getState().intentFor('expedition'), EXPEDITION_MANIFEST);
    expect(intent.range.ord).toBe(0);
    // Kalıcı: yeniden açılışta geri yüklenecek
    expect(layoutOverrideCount(getStoredManifest('expedition')!)).toBe(1);
  });
});

/* ── Yeniden açılış (reboot/reload) ───────────────────────────────── */

describe('yeniden açılış — tema korunur', () => {
  it('kapat/aç sonrası saklanmış manifest geri yüklenir (CSS + bileşen + yerleşim)', () => {
    // 1) Kullanıcı telefondan gönderdi (kalıcı yazıldı)
    applyIncomingThemeManifest({
      schemaVersion: 3,
      themeId: 'pro',
      themeVersion: 6,
      tokens: { accentPrimary: '#5B8DFF' },
      componentOverrides: { 'pro.music': { radius: 26 } },
      layoutOverrides: { clock: { ord: 6 } },
    }, 'command');
    expect(getStoredManifest('pro')?.themeVersion).toBe(6);

    // 2) UYGULAMA KAPANDI: çalışma zamanı durumu ve DOM sıfırlanır,
    //    KALICI DEPO korunur (safeStorage'ı temizlemiyoruz).
    __resetThemeRuntimeForTest();
    clearAppliedDom();
    useLayoutStore.getState().reset();
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');

    // 3) AÇILDI: araçtaki aktif tema 'pro' → boot geri yüklemesi
    useCarTheme.getState().setTheme('pro');
    initThemeRuntime();

    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#5B8DFF');
    expect(document.getElementById('caros-theme-manifest-css')?.textContent)
      .toContain('[data-editable="pro.music"]');
    const intent = normalizeIntent(useLayoutStore.getState().intentFor('pro'), PRO_MANIFEST);
    expect(intent.clock.ord).toBe(6);
    const snap = getThemeRuntimeSnapshot();
    expect(snap.lastSource).toBe('restore');
    expect(snap.lastThemeVersion).toBe(6);
  });

  it('boot geri yüklemesi baz temayı ZORLAMAZ (araçtaki seçim otorite)', () => {
    applyIncomingThemeManifest({
      schemaVersion: 3, themeId: 'pro', tokens: { accentPrimary: '#111111' },
    }, 'command');
    __resetThemeRuntimeForTest();
    clearAppliedDom();
    // Kullanıcı araçta temayı elle değiştirdi
    useCarTheme.getState().setTheme('tesla');
    initThemeRuntime();
    expect(useCarTheme.getState().theme).toBe('tesla');
    // Pro'nun rengi SIZMAZ
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
  });
});

/* ── Komut yolu kaynak kilidi (yakalanmış kusur geri gelmesin) ─────── */

describe('theme_change komut dalı — fail-closed ve `dark` kusuru kapalı', () => {
  it('kaynakta `data-theme` doğrudan yazımı ve "dark" varsayılanı YOK', async () => {
    const src = (await import('../platform/commandListener.ts?raw')).default as string;
    const branch = src.slice(src.indexOf("case 'theme_change'"), src.indexOf("case 'layout_change'"));
    expect(branch.length).toBeGreaterThan(200);
    // Eski kusur: setAttribute('data-theme', payload.theme ?? 'dark')
    expect(branch).not.toContain("?? 'dark'");
    expect(branch).not.toContain("setAttribute('data-theme'");
    // Fail-closed kapı + geri-uyum taşıması kullanılıyor
    expect(branch).toContain('applyIncomingThemeManifest');
    expect(branch).toContain('migrateLegacyThemeVars');
    expect(branch).toContain("outcome: 'failed'");
  });
});

/* ── Tema geçişinde kalıntı ───────────────────────────────────────── */

describe('tema geçişi — kalıntı YOK', () => {
  it('manifesti olmayan temaya geçince CSS ve yerleşim temizlenir', () => {
    // Pro için dolu manifest uygula + sakla
    applyIncomingThemeManifest({
      schemaVersion: 3, themeId: 'pro',
      tokens: { accentPrimary: '#ABCDEF' },
      layoutOverrides: { clock: { visible: false } },
    }, 'command');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#ABCDEF');
    expect(useLayoutStore.getState().byTheme.pro).toBeDefined();

    // Boot izleyicisini kur ve expedition'a geç (expedition'ın manifesti YOK)
    initThemeRuntime();
    useCarTheme.getState().setTheme('expedition');

    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
    expect(document.getElementById('caros-theme-manifest-css')?.textContent).toBe('');
    expect(useLayoutStore.getState().byTheme.expedition).toBeUndefined();
    // Pro'nun kendi kaydı SİLİNMEZ (geri dönünce geri gelmeli)
    expect(useLayoutStore.getState().byTheme.pro).toBeDefined();
    expect(getStoredManifest('pro')).not.toBeNull();
  });

  it('geri dönünce o temanın manifesti yeniden uygulanır', () => {
    applyIncomingThemeManifest({
      schemaVersion: 3, themeId: 'pro', tokens: { bgCard: makeSolid('#123123') },
    }, 'command');
    initThemeRuntime();
    useCarTheme.getState().setTheme('expedition');
    expect(document.documentElement.style.getPropertyValue('--bg-card')).toBe('');
    useCarTheme.getState().setTheme('pro');
    expect(document.documentElement.style.getPropertyValue('--bg-card')).toBe('#123123');
  });
});
