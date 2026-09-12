/**
 * Tema Stüdyo — GELİŞMİŞ GERİ AL / İLERİ AL kilitleri (görev §13 A–N).
 *
 * Kilitlenen davranışlar:
 *  - Geçmiş DİLİM tabanlıdır: bir kartın geri alması başka kartı DEĞİŞTİRMEZ.
 *  - Kart kapsamı = bileşen stili + (varsa) solver yerleşim kartı.
 *  - "Tüm Değişiklikleri Geri Al" tek transaction'dır ve başka temaya dokunmaz.
 *  - "Kartı Başlangıç Hâline Döndür" yalnız o kartı (stil + yerleşim) temizler.
 *  - Yeni değişiklik YALNIZ kendi diliminin yinele geçmişini temizler.
 *  - Tema düzeyi bir adımdan SONRA kart-bazlı geri al silinmişi DİRİLTMEZ.
 *  - Geçmiş oturum ömürlüdür (kalıcılığa YAZILMAZ) — mevcut mimari böyle.
 */

import { describe, it, expect } from 'vitest';
import {
  canRedo,
  canRedoScoped,
  canUndo,
  canUndoScoped,
  cardHasChanges,
  cardLayoutOf,
  cardScope,
  componentStyleOf,
  createStudioState,
  customizationCount,
  deserializeStudio,
  screenOverrideOf,
  screenScope,
  serializeStudio,
  studioReducer,
  tokensScope,
  type StudioState,
} from '@/lib/theme/themeStudioState';
import {
  manifestToCssVars,
  parseIncomingManifest,
  THEME_BASE_IDS,
} from '@/lib/theme/themeManifest';
import { layoutCardIdFor, getThemeComponent } from '@/lib/theme/themeComponentRegistry';

function run(actions: Parameters<typeof studioReducer>[1][], start?: StudioState): StudioState {
  return actions.reduce((s, a) => studioReducer(s, a), start ?? createStudioState());
}

/** Pro temasında iki gerçek kart (kayıt defterinden — uydurma yok). */
const A = 'pro.clock';
const B = 'pro.music';
const A_LAYOUT = layoutCardIdFor(getThemeComponent(A)!, 'pro');   // 'clock'
const B_LAYOUT = layoutCardIdFor(getThemeComponent(B)!, 'pro');   // 'music'
const scopeA = cardScope('pro', A, A_LAYOUT);
const scopeB = cardScope('pro', B, B_LAYOUT);

function proStart(): StudioState {
  return run([{ type: 'select-theme', themeId: 'pro' }]);
}

/* ── A / B / C / K — kart bazlı undo-redo zinciri ─────────────────── */

describe('A–C,K — kart düzenleme geçmişi', () => {
  it('A: kart değişti → kart kapsamlı geri al YALNIZ o kartı geri aldı', () => {
    let s = run([{ type: 'patch-component', componentId: A, patch: { radius: 20 } }], proStart());
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(20);
    expect(canUndoScoped(s, scopeA)).toBe(true);
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();
  });

  it('B: ileri al kartı tekrar değiştirdi', () => {
    let s = run([{ type: 'patch-component', componentId: A, patch: { radius: 20 } }], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(canRedoScoped(s, scopeA)).toBe(true);
    s = studioReducer(s, { type: 'redo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(20);
  });

  it('C: geri al sonrası YENİ değişiklik eski yinele geçmişini temizler', () => {
    // A → B → C → D
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
      { type: 'patch-component', componentId: A, patch: { textColor: '#111111' } },
      { type: 'patch-component', componentId: A, patch: { borderWidth: 2 } },
      { type: 'patch-component', componentId: A, patch: { opacity: 80 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA }); // D geri alındı
    expect(componentStyleOf(s.manifests.pro, A).opacity).toBeNull();
    expect(canRedoScoped(s, scopeA)).toBe(true);

    // Yeni değişiklik (X)
    s = studioReducer(s, { type: 'patch-component', componentId: A, patch: { padding: 12 } });
    expect(canRedoScoped(s, scopeA)).toBe(false);      // D artık yinelenemez
    s = studioReducer(s, { type: 'redo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).opacity).toBeNull();
  });

  it('K: geri al → ileri al → yeni değişiklik zinciri doğru', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 4 } },
      { type: 'patch-component', componentId: A, patch: { padding: 8 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).padding).toBeNull();
    s = studioReducer(s, { type: 'redo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).padding).toBe(8);
    s = studioReducer(s, { type: 'patch-component', componentId: A, patch: { gap: 6 } });
    expect(componentStyleOf(s.manifests.pro, A).gap).toBe(6);
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(4);
    expect(canRedoScoped(s, scopeA)).toBe(false);
  });
});

/* ── D — kartlar arası izolasyon (EN KRİTİK) ──────────────────────── */

describe('D — kart geçmişleri birbirine karışmaz', () => {
  it('A geri alınınca B DEĞİŞMEZ', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
      { type: 'patch-component', componentId: A, patch: { padding: 4 } },
      { type: 'patch-component', componentId: B, patch: { radius: 30 } },
      { type: 'patch-component', componentId: B, patch: { opacity: 60 } },
    ], proStart());

    s = studioReducer(s, { type: 'undo', scope: scopeA });   // yalnız A'nın son adımı
    expect(componentStyleOf(s.manifests.pro, A).padding).toBeNull();
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(10);
    // B hiç etkilenmedi
    expect(componentStyleOf(s.manifests.pro, B).radius).toBe(30);
    expect(componentStyleOf(s.manifests.pro, B).opacity).toBe(60);
  });

  it('kartlar arasında gezinmek geçmişi bozmaz', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 1 } },
      { type: 'open-editor', componentId: B },
      { type: 'patch-component', componentId: B, patch: { radius: 2 } },
      { type: 'open-editor', componentId: A },
    ], proStart());
    // A'ya dönünce A'nın kendi geçmişi kullanılır
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();
    expect(componentStyleOf(s.manifests.pro, B).radius).toBe(2);
    // B'nin geri alması hâlâ mevcut
    expect(canUndoScoped(s, scopeB)).toBe(true);
    s = studioReducer(s, { type: 'undo', scope: scopeB });
    expect(s.manifests.pro.componentOverrides[B]).toBeUndefined();
  });

  it('B için yinele, A yeni değişiklik yapınca SİLİNMEZ', () => {
    let s = run([
      { type: 'patch-component', componentId: B, patch: { radius: 5 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeB });
    expect(canRedoScoped(s, scopeB)).toBe(true);
    s = studioReducer(s, { type: 'patch-component', componentId: A, patch: { radius: 7 } });
    expect(canRedoScoped(s, scopeB)).toBe(true);   // B'nin redo'su korundu
    s = studioReducer(s, { type: 'redo', scope: scopeB });
    expect(componentStyleOf(s.manifests.pro, B).radius).toBe(5);
  });

  it('yerleşim değişikliği DOĞRU kartın kapsamına yazılır', () => {
    let s = run([
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 3 } },
      { type: 'patch-layout', cardId: B_LAYOUT!, patch: { ord: 1 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.layoutOverrides[A_LAYOUT!]).toBeUndefined();
    expect(cardLayoutOf(s.manifests.pro, B_LAYOUT!).ord).toBe(1);
  });

  it('EKRAN değişikliği hiçbir kartın kapsamına GİRMEZ', () => {
    const s = run([
      { type: 'patch-screen', surface: 'home', patch: { accentPrimary: '#010101' } },
    ], proStart());
    expect(canUndoScoped(s, scopeA)).toBe(false);
    expect(canUndoScoped(s, scopeB)).toBe(false);
    expect(canUndoScoped(s, screenScope('pro', 'home'))).toBe(true);
  });

  it('TOKEN değişikliği hiçbir kartın kapsamına GİRMEZ', () => {
    const s = run([{ type: 'patch-tokens', patch: { accentPrimary: '#020202' } }], proStart());
    expect(canUndoScoped(s, scopeA)).toBe(false);
    expect(canUndoScoped(s, tokensScope('pro'))).toBe(true);
  });
});

/* ── E / H — kart sıfırlama ───────────────────────────────────────── */

describe('E,H — kartı başlangıç hâline döndür', () => {
  it('H: YALNIZ o kartın stil + yerleşimi temizlenir', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 12, textColor: '#FFFFFF' } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 2, size: 'L' } },
      { type: 'patch-component', componentId: B, patch: { radius: 20 } },
      { type: 'patch-layout', cardId: B_LAYOUT!, patch: { ord: 5 } },
      { type: 'patch-screen', surface: 'home', patch: { accentPrimary: '#030303' } },
      { type: 'patch-tokens', patch: { accentPrimary: '#040404' } },
    ], proStart());

    s = studioReducer(s, { type: 'reset-card', componentId: A, layoutCardId: A_LAYOUT });

    // A tamamen temiz
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();
    expect(s.manifests.pro.layoutOverrides[A_LAYOUT!]).toBeUndefined();
    // B ve diğer katmanlar AYNEN
    expect(componentStyleOf(s.manifests.pro, B).radius).toBe(20);
    expect(cardLayoutOf(s.manifests.pro, B_LAYOUT!).ord).toBe(5);
    expect(screenOverrideOf(s.manifests.pro, 'home').accentPrimary).toBe('#030303');
    expect(s.manifests.pro.tokens.accentPrimary).toBe('#040404');
  });

  it('kart sıfırlama TEK adımdır ve geri alınabilir', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 12 } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 2 } },
      { type: 'reset-card', componentId: A, layoutCardId: A_LAYOUT },
    ], proStart());
    expect(cardHasChanges(s.manifests.pro, A, A_LAYOUT)).toBe(false);

    s = studioReducer(s, { type: 'undo', scope: scopeA });   // TEK geri al ikisini de iade eder
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(12);
    expect(cardLayoutOf(s.manifests.pro, A_LAYOUT!).ord).toBe(2);
  });

  it('E: kart sıfırlama diğer ekranları ETKİLEMEZ', () => {
    let s = run([
      { type: 'patch-component', componentId: 'settings-page', patch: { radius: 8 } },
      { type: 'patch-component', componentId: 'dtc-panel', patch: { radius: 9 } },
      { type: 'patch-component', componentId: A, patch: { radius: 12 } },
    ], proStart());
    s = studioReducer(s, { type: 'reset-card', componentId: A, layoutCardId: A_LAYOUT });
    expect(componentStyleOf(s.manifests.pro, 'settings-page').radius).toBe(8);
    expect(componentStyleOf(s.manifests.pro, 'dtc-panel').radius).toBe(9);
  });

  it('değişikliği olmayan kartta sıfırlama düğmesi kapalıdır', () => {
    const s = proStart();
    expect(cardHasChanges(s.manifests.pro, A, A_LAYOUT)).toBe(false);
    // Boş sıfırlama geçmişe adım da YAZMAZ
    const after = studioReducer(s, { type: 'reset-card', componentId: A, layoutCardId: A_LAYOUT });
    expect(canUndo(after)).toBe(false);
  });
});

/* ── F / G / L — tema sıfırlama ve tema izolasyonu ────────────────── */

describe('F,G,L — tüm değişiklikleri geri al', () => {
  it('G: token + bileşen + ekran + yerleşim → tema sıfırlama HEPSİNİ temizler', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#050505', fontWeight: 700 } },
      { type: 'patch-component', componentId: A, patch: { radius: 12 } },
      { type: 'patch-screen', surface: 'home', patch: { accentPrimary: '#060606' } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 2 } },
    ], proStart());
    expect(customizationCount(s.manifests.pro)).toBe(5);

    s = studioReducer(s, { type: 'reset-theme' });
    expect(customizationCount(s.manifests.pro)).toBe(0);
    expect(s.manifests.pro.tokens.accentPrimary).toBeNull();
    expect(s.manifests.pro.componentOverrides).toEqual({});
    expect(s.manifests.pro.screenOverrides).toEqual({});
    expect(s.manifests.pro.layoutOverrides).toEqual({});
  });

  it('tema sıfırlama TEK transaction — bir geri al hepsini iade eder', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#070707' } },
      { type: 'patch-component', componentId: A, patch: { radius: 12 } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 2 } },
      { type: 'reset-theme' },
    ], proStart());
    s = studioReducer(s, { type: 'undo' });
    expect(s.manifests.pro.tokens.accentPrimary).toBe('#070707');
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(12);
    expect(cardLayoutOf(s.manifests.pro, A_LAYOUT!).ord).toBe(2);
  });

  it('F/L: tema sıfırlama diğer 3 temaya DOKUNMAZ', () => {
    let s = createStudioState();
    for (const t of THEME_BASE_IDS) {
      s = run([
        { type: 'select-theme', themeId: t },
        { type: 'patch-tokens', patch: { accentPrimary: '#ABCDEF' } },
      ], s);
    }
    s = run([{ type: 'select-theme', themeId: 'pro' }, { type: 'reset-theme' }], s);
    expect(s.manifests.pro.tokens.accentPrimary).toBeNull();
    for (const t of THEME_BASE_IDS.filter((x) => x !== 'pro')) {
      expect(s.manifests[t].tokens.accentPrimary).toBe('#ABCDEF');
    }
  });

  it('L: temalar birbirinin GEÇMİŞİNİ etkilemez', () => {
    let s = run([
      { type: 'select-theme', themeId: 'pro' },
      { type: 'patch-component', componentId: A, patch: { radius: 3 } },
      { type: 'select-theme', themeId: 'tesla' },
      { type: 'patch-component', componentId: 'tesla.clock', patch: { radius: 9 } },
    ]);
    // Tesla'da pro kartının kapsamı geri alınamaz (tema uyuşmuyor)
    expect(canUndoScoped(s, scopeA)).toBe(true);          // scope themeId='pro' olduğu için bulunur
    s = studioReducer(s, { type: 'undo', scope: cardScope('tesla', 'tesla.clock', null) });
    expect(s.manifests.tesla.componentOverrides['tesla.clock']).toBeUndefined();
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(3);
  });

  it('GÜVENLİK: tema sıfırlamadan SONRA kart geri alması silinmişi DİRİLTMEZ', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 12 } },
      { type: 'reset-theme' },
    ], proStart());
    expect(canUndoScoped(s, scopeA)).toBe(false);   // kart kapsamı tema adımını aşamaz
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();
    // Global geri al ise tema adımını iade eder
    s = studioReducer(s, { type: 'undo' });
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(12);
  });
});

/* ── §5 — atomiklik (tek UI işlemi = tek adım) ────────────────────── */

describe('§5 — atomik düzenleme', () => {
  it('aynı alanın ardışık sürüklenmesi TEK geri al adımına iner', () => {
    let s = proStart();
    for (const r of [10, 11, 12, 13, 14]) {
      s = studioReducer(s, { type: 'patch-component', componentId: A, patch: { radius: r } });
    }
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(14);
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();   // tamamı tek adımdı
  });

  it('farklı alanlar AYRI adımdır', () => {
    let s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
      { type: 'patch-component', componentId: A, patch: { padding: 6 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(10);
    expect(componentStyleOf(s.manifests.pro, A).padding).toBeNull();
  });

  it('editörü kapatıp açmak birleştirmeyi KIRAR', () => {
    let s = run([
      { type: 'open-editor', componentId: A },
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
      { type: 'close-editor' },
      { type: 'open-editor', componentId: A },
      { type: 'patch-component', componentId: A, patch: { radius: 20 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(componentStyleOf(s.manifests.pro, A).radius).toBe(10);   // ilk adım kaldı
  });

  it('gradient (tek UI işlemi) tek adımdır', () => {
    let s = studioReducer(proStart(), {
      type: 'patch-component',
      componentId: A,
      patch: { bg: { kind: 'linear', from: '#000000', to: '#ffffff', angle: 90, stopA: 0, stopB: 100, alpha: 100 } },
    });
    expect(componentStyleOf(s.manifests.pro, A).bg?.kind).toBe('linear');
    s = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s.manifests.pro.componentOverrides[A]).toBeUndefined();
  });

  it('değer DEĞİŞMEDİYSE geçmişe adım yazılmaz', () => {
    const s = run([
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
      { type: 'patch-component', componentId: A, patch: { radius: 10 } },
    ], proStart());
    expect(s.past).toHaveLength(1);
  });
});

/* ── I / J — önizleme ve araç yükü senkronu ───────────────────────── */

describe('I,J — manifest / önizleme / theme_change senkronu', () => {
  it('I: geri al/ileri al sonrası önizlemeye giden manifest TEK kaynaktan gelir', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#0A0B0C' } },
      { type: 'patch-component', componentId: A, patch: { radius: 14 } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 2 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });

    // Stüdyo önizlemeye `state.manifests[themeId]` yollar → tek kaynak.
    // Kartın kapsamı stil + yerleşimi birlikte kapsar; SON adım yerleşimdi →
    // geri alınan da yerleşimdir. Stil ve token OLDUĞU GİBİ kalır.
    const previewManifest = s.manifests[s.themeId];
    expect(previewManifest.layoutOverrides[A_LAYOUT!]).toBeUndefined();
    expect(previewManifest.componentOverrides[A].radius).toBe(14);
    expect(previewManifest.tokens.accentPrimary).toBe('#0A0B0C');

    // İkinci geri al → şimdi stil adımı iade edilir
    const s2 = studioReducer(s, { type: 'undo', scope: scopeA });
    expect(s2.manifests[s2.themeId].componentOverrides[A]).toBeUndefined();
    expect(s2.manifests[s2.themeId].tokens.accentPrimary).toBe('#0A0B0C');
  });

  it('J: theme_change yükü geri al SONRASI durumu taşır ve araç kapısından geçer', () => {
    let s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#0D0E0F' } },
      { type: 'patch-component', componentId: A, patch: { radius: 16 } },
    ], proStart());
    s = studioReducer(s, { type: 'undo', scope: scopeA });

    // ThemeStudio.sendToVehicle ile AYNI yük kurulumu
    const m = s.manifests[s.themeId];
    const outgoing = {
      ...m,
      themeVersion: m.themeVersion + 1,
      metadata: { ...m.metadata, updatedAt: '2026-08-15T00:00:00.000Z', origin: 'pwa-studio' as const },
    };
    const payload = { manifest: outgoing, theme: outgoing.themeId, themeVars: manifestToCssVars(outgoing) };

    const r = parseIncomingManifest(payload.manifest);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.tokens.accentPrimary).toBe('#0D0E0F');
      expect(r.manifest.componentOverrides[A]).toBeUndefined();   // geri alınan gitmedi
    }
    expect(payload.themeVars['--accent-primary']).toBe('#0D0E0F');
    expect(payload.theme).toBe('pro');
  });

  it('J: tema sıfırlama sonrası yük BOŞ manifesttir (araç görünümü fabrikaya döner)', () => {
    const s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#101112' } },
      { type: 'reset-theme' },
    ], proStart());
    const m = s.manifests.pro;
    expect(Object.keys(manifestToCssVars(m))).toHaveLength(0);
    expect(parseIncomingManifest(m).ok).toBe(true);
  });
});

/* ── M / N — kalıcılık ve fail-closed ─────────────────────────────── */

describe('M,N — kalıcılık ve güvenlik değişmedi', () => {
  it('M: yeniden açılışta tema durumu bozulmaz', () => {
    const s = run([
      { type: 'patch-tokens', patch: { accentPrimary: '#131415' } },
      { type: 'patch-component', componentId: A, patch: { radius: 18 } },
      { type: 'patch-layout', cardId: A_LAYOUT!, patch: { ord: 1 } },
    ], proStart());
    const back = deserializeStudio(serializeStudio(s));
    expect(back.manifests.pro.tokens.accentPrimary).toBe('#131415');
    expect(back.manifests.pro.componentOverrides[A].radius).toBe(18);
    expect(back.manifests.pro.layoutOverrides[A_LAYOUT!].ord).toBe(1);
  });

  it('M: GEÇMİŞ kalıcı DEĞİLDİR (oturum ömürlü) — depoya yazılmaz', () => {
    const s = run([{ type: 'patch-component', componentId: A, patch: { radius: 5 } }], proStart());
    expect(canUndo(s)).toBe(true);
    const raw = serializeStudio(s);
    expect(raw).not.toContain('"past"');
    expect(raw).not.toContain('"future"');
    expect(raw).not.toContain('lastMergeKey');
  });

  it('N: fail-closed davranışı DEĞİŞMEDİ', () => {
    expect(parseIncomingManifest({ schemaVersion: 99, themeId: 'pro' }).ok).toBe(false);
    expect(parseIncomingManifest({ schemaVersion: 3, themeId: 'dark' }).ok).toBe(false);
    expect(parseIncomingManifest({ schemaVersion: 3, themeId: 'pro', layoutOverrides: 'x' }).ok).toBe(false);
    expect(parseIncomingManifest(null).ok).toBe(false);
  });

  it('boş geçmişte geri al/ileri al durumu BOZMAZ (global ve kapsamlı)', () => {
    const s = proStart();
    expect(studioReducer(s, { type: 'undo' })).toEqual(s);
    expect(studioReducer(s, { type: 'redo' })).toEqual(s);
    expect(studioReducer(s, { type: 'undo', scope: scopeA })).toEqual(s);
    expect(studioReducer(s, { type: 'redo', scope: scopeA })).toEqual(s);
    expect(canRedo(s)).toBe(false);
  });
});
