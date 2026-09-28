/**
 * Tema Stüdyo — gündüz / gece ayrı düzenleme (kullanıcı isteği 2026-09-28:
 * "düzenleme hem gece hem gündüz için oluyor; gündüz ayrı gece ayrı olmalı").
 *
 * Kilitlenen sözleşme:
 *  - 'day'/'night' seçiliyken stil düzenlemeleri YALNIZ o modun katmanına yazılır;
 *    diğer mod ve ortak katman değişmez.
 *  - Yerleşim (kart yeri/boyu) iki modda ORTAKTIR.
 *  - Geri al moda göre kapsamlıdır: gündüz geri al gece dilimine dokunmaz.
 *  - 'both' bugünkü davranıştır (ortak katman).
 */
import { describe, it, expect } from 'vitest';
import {
  cardScope,
  canUndoScoped,
  createStudioState,
  customizationCount,
  deserializeStudio,
  serializeStudio,
  studioReducer,
  tokensScope,
  type StudioAction,
  type StudioState,
} from '@/lib/theme/themeStudioState';
import { parseIncomingManifest, resolveManifestForMode } from '@/lib/theme/themeManifest';

const run = (s: StudioState, ...actions: StudioAction[]) => actions.reduce(studioReducer, s);
const cur = (s: StudioState) => s.manifests[s.themeId];

describe('Tema Stüdyo: gündüz / gece katmanı', () => {
  it("'both' bugünkü davranış: ortak katmana yazar", () => {
    const s = run(createStudioState(), { type: 'patch-tokens', patch: { accentPrimary: '#111111' } });
    expect(cur(s).tokens.accentPrimary).toBe('#111111');
    expect(cur(s).modeOverrides).toEqual({});
  });

  it('gündüz düzenlemesi yalnız gündüze yazılır; gece ve ortak değişmez', () => {
    const s = run(createStudioState(),
      { type: 'patch-tokens', patch: { accentPrimary: '#111111' } },            // ortak
      { type: 'select-mode', mode: 'day' },
      { type: 'patch-tokens', patch: { accentPrimary: '#FFAA00' } },
      { type: 'patch-component', componentId: 'expedition.clock', patch: { textColor: '#222222' } },
      { type: 'select-mode', mode: 'night' },
      { type: 'patch-tokens', patch: { accentPrimary: '#0055FF' } },
    );
    const m = cur(s);
    expect(m.tokens.accentPrimary).toBe('#111111');
    expect(m.componentOverrides['expedition.clock']).toBeUndefined();
    expect(m.modeOverrides.day?.tokens.accentPrimary).toBe('#FFAA00');
    expect(m.modeOverrides.day?.componentOverrides['expedition.clock']?.textColor).toBe('#222222');
    expect(m.modeOverrides.night?.tokens.accentPrimary).toBe('#0055FF');
    expect(m.modeOverrides.night?.componentOverrides['expedition.clock']).toBeUndefined();
    expect(resolveManifestForMode(m, 'day').tokens.accentPrimary).toBe('#FFAA00');
    expect(resolveManifestForMode(m, 'night').tokens.accentPrimary).toBe('#0055FF');
  });

  it('yerleşim iki modda ORTAK kalır', () => {
    const s = run(createStudioState(),
      { type: 'select-mode', mode: 'night' },
      { type: 'patch-layout', cardId: 'clock', patch: { size: 'L' } },
    );
    expect(cur(s).layoutOverrides.clock?.size).toBe('L');
    expect(cur(s).modeOverrides).toEqual({});
  });

  it('geri al moda göre kapsamlı; global geri al da çalışır', () => {
    let s = run(createStudioState(),
      { type: 'select-mode', mode: 'day' },
      { type: 'patch-tokens', patch: { accentPrimary: '#FFAA00' } },
      { type: 'select-mode', mode: 'night' },
      { type: 'patch-tokens', patch: { accentPrimary: '#0055FF' } },
    );
    const t = s.themeId;
    expect(canUndoScoped(s, tokensScope(t, 'day'))).toBe(true);
    expect(canUndoScoped(s, tokensScope(t, 'both'))).toBe(false);          // ortakta adım yok
    s = run(s, { type: 'undo', scope: tokensScope(t, 'day') });
    expect(cur(s).modeOverrides.day).toBeUndefined();                       // boşalan katman düşer
    expect(cur(s).modeOverrides.night?.tokens.accentPrimary).toBe('#0055FF');
    s = run(s, { type: 'redo', scope: tokensScope(t, 'day') });
    expect(cur(s).modeOverrides.day?.tokens.accentPrimary).toBe('#FFAA00');
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(cur(s).modeOverrides).toEqual({});
  });

  it('kaydırıcı sürüklemesi aynı modda tek adıma birleşir, modlar arası birleşmez', () => {
    const s = run(createStudioState(),
      { type: 'select-mode', mode: 'day' },
      { type: 'patch-tokens', patch: { radiusCard: 10 } },
      { type: 'patch-tokens', patch: { radiusCard: 12 } },
      { type: 'patch-tokens', patch: { radiusCard: 14 } },
    );
    expect(s.past).toHaveLength(1);
    const s2 = run(s, { type: 'select-mode', mode: 'night' }, { type: 'patch-tokens', patch: { radiusCard: 20 } });
    expect(s2.past).toHaveLength(2);
  });

  it('kartı sıfırla: o modun stili + ortak yerleşim; ortak stil korunur', () => {
    const s = run(createStudioState(),
      { type: 'patch-component', componentId: 'expedition.clock', patch: { radius: 30 } }, // ortak
      { type: 'patch-layout', cardId: 'clock', patch: { size: 'L' } },
      { type: 'select-mode', mode: 'day' },
      { type: 'patch-component', componentId: 'expedition.clock', patch: { textColor: '#222222' } },
      { type: 'reset-card', componentId: 'expedition.clock', layoutCardId: 'clock' },
    );
    expect(cur(s).componentOverrides['expedition.clock']?.radius).toBe(30);
    expect(cur(s).modeOverrides.day).toBeUndefined();
    expect(cur(s).layoutOverrides.clock).toBeUndefined();
    expect(canUndoScoped(s, cardScope(s.themeId, 'expedition.clock', 'clock', 'day'))).toBe(true);
  });

  it('hazır taslak seçili moda uygulanır', () => {
    const s = run(createStudioState(),
      { type: 'select-mode', mode: 'night' },
      { type: 'apply-preset', kind: 'color', tokens: { accentPrimary: '#00FFAA', textPrimary: '#EEEEEE' } },
    );
    expect(cur(s).tokens.accentPrimary).toBeNull();
    expect(cur(s).modeOverrides.night?.tokens.accentPrimary).toBe('#00FFAA');
  });

  it('gündüzü geceye kopyala (tek adım, geri alınabilir)', () => {
    let s = run(createStudioState(),
      { type: 'select-mode', mode: 'day' },
      { type: 'patch-tokens', patch: { accentPrimary: '#FFAA00' } },
      { type: 'copy-mode', from: 'day', to: 'night' },
    );
    expect(cur(s).modeOverrides.night?.tokens.accentPrimary).toBe('#FFAA00');
    s = run(s, { type: 'undo' });
    expect(cur(s).modeOverrides.night).toBeUndefined();
  });

  it('özelleştirme sayısı mod katmanlarını da sayar; kalıcılık ve araca gönderim katmanı korur', () => {
    const s = run(createStudioState(),
      { type: 'select-mode', mode: 'night' },
      { type: 'patch-tokens', patch: { accentPrimary: '#0055FF' } },
    );
    expect(customizationCount(cur(s))).toBe(1);
    const back = deserializeStudio(serializeStudio(s));
    expect(back.manifests[s.themeId].modeOverrides.night?.tokens.accentPrimary).toBe('#0055FF');
    const sent = parseIncomingManifest(JSON.parse(JSON.stringify(cur(s))));
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(resolveManifestForMode(sent.manifest, 'night').tokens.accentPrimary).toBe('#0055FF');
  });

  it('bilinmeyen mod seçimi yok sayılır', () => {
    const s0 = createStudioState();
    expect(run(s0, { type: 'select-mode', mode: 'evening' as never })).toBe(s0);
  });
});
