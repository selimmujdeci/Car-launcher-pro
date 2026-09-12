/**
 * homeWorkNavigation.test.ts — NAVIGATION-P0-1.
 *
 * NAVIGATION-AUDIT-1'de doğrulanan kök neden: `intentEngine.ts` OPEN_NAVIGATION
 * case'i `payload.destination`'ı hiç okumadan yalnız ekran açıyordu; Ev/İş verisi
 * hiçbir tüketiciye bağlı değildi (0,0 varsayılan "kayıtlı" gibi davranıyordu).
 *
 * Bu dosya İKİ katmanı test eder:
 *   A. `homeWorkNavigation.ts` — saf çözümleme + tek merkezi dispatch (yeni modül).
 *   B. `intentEngine.routeIntent()` — OPEN_NAVIGATION'ın destination'ı KORUYUP
 *      gerçek navigasyon başlatmaya delege ettiğini doğrular. Düzeltmeden ÖNCE
 *      bu bölümdeki testler FAIL eder (routeIntent yalnızca ctx.launch çağırırdı).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/navigationService', () => ({
  startNavigation: vi.fn(),
}));
vi.mock('../platform/ttsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/ttsService')>();
  return { ...actual, speakNavigation: vi.fn() };
});

import { startNavigation } from '../platform/navigationService';
import { speakNavigation } from '../platform/ttsService';
import {
  setAddress,
  getQuickAddress,
  setQuickAddress,
  clearQuickAddress,
  isValidDestination,
} from '../platform/addressBookService';
import {
  resolveHomeWorkDestination,
  dispatchHomeWorkNavigation,
  isHomeWorkDestination,
  _resetHomeWorkDispatchGuardForTests,
} from '../platform/homeWorkNavigation';
import i18n from '../i18n/config';
import { toIntent, routeIntent, type RouterContext } from '../platform/intentEngine';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';

const startNavigationMock = vi.mocked(startNavigation);
const speakNavigationMock = vi.mocked(speakNavigation);

function makeCtx(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    launch:     vi.fn(),
    openDrawer: vi.fn(),
    setTheme:   vi.fn(),
    playMedia:  vi.fn(),
    pauseMedia: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  clearQuickAddress('home');
  clearQuickAddress('work');
  startNavigationMock.mockClear();
  speakNavigationMock.mockClear();
  _resetHomeWorkDispatchGuardForTests();
});

afterEach(() => {
  clearQuickAddress('home');
  clearQuickAddress('work');
});

/* ── isValidDestination / setQuickAddress guard ──────────────────────────── */

describe('isValidDestination — 0,0 ve sınır-dışı koordinat reddi', () => {
  it('0,0 (Null Island) geçersiz', () => {
    expect(isValidDestination({ latitude: 0, longitude: 0 })).toBe(false);
  });
  it('NaN geçersiz', () => {
    expect(isValidDestination({ latitude: NaN, longitude: 30 })).toBe(false);
  });
  it('lat sınır dışı (>90) geçersiz', () => {
    expect(isValidDestination({ latitude: 91, longitude: 30 })).toBe(false);
  });
  it('lng sınır dışı (<-180) geçersiz', () => {
    expect(isValidDestination({ latitude: 40, longitude: -181 })).toBe(false);
  });
  it('geçerli İstanbul koordinatı kabul edilir', () => {
    expect(isValidDestination({ latitude: 41.015, longitude: 28.979 })).toBe(true);
  });
});

describe('setQuickAddress — fail-closed kayıt', () => {
  it('geçerli koordinatla kayıt başarılı', () => {
    expect(setQuickAddress('home', { latitude: 41.015, longitude: 28.979, fullAddress: 'Test Mah.' })).toBe(true);
    expect(getQuickAddress('home')?.latitude).toBeCloseTo(41.015);
  });
  it('0,0 ile kayıt REDDEDİLİR — hiçbir yarı-yazılmış kayıt oluşmaz', () => {
    expect(setQuickAddress('home', { latitude: 0, longitude: 0 })).toBe(false);
    expect(getQuickAddress('home')).toBeNull();
  });
  it('geçersiz koordinatla kayıt REDDEDİLİR', () => {
    expect(setQuickAddress('work', { latitude: 999, longitude: 30 })).toBe(false);
    expect(getQuickAddress('work')).toBeNull();
  });
  it('clearQuickAddress sonrası adres tekrar "kayıtlı değil" olur', () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });
    expect(getQuickAddress('home')).not.toBeNull();
    clearQuickAddress('home');
    expect(getQuickAddress('home')).toBeNull();
  });
});

/* ── A. resolveHomeWorkDestination — saf çözümleme ───────────────────────── */

describe('resolveHomeWorkDestination', () => {
  it('Ev kayıtlıysa ok:true + doğru koordinat döner', () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979, fullAddress: 'Ev Mah.' });
    const r = resolveHomeWorkDestination('home');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.address.latitude).toBeCloseTo(41.015);
      expect(r.address.longitude).toBeCloseTo(28.979);
    }
  });

  it('İş kayıtlıysa ok:true + doğru koordinat döner', () => {
    setQuickAddress('work', { latitude: 39.92, longitude: 32.85 });
    const r = resolveHomeWorkDestination('work');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address.category).toBe('work');
  });

  it('Ev hiç kaydedilmemişse ok:false reason:missing', () => {
    const r = resolveHomeWorkDestination('home');
    expect(r).toEqual({ ok: false, category: 'home', reason: 'missing' });
  });

  it('İş hiç kaydedilmemişse ok:false reason:missing', () => {
    const r = resolveHomeWorkDestination('work');
    expect(r).toEqual({ ok: false, category: 'work', reason: 'missing' });
  });

  it('kayıt VAR ama koordinat geçersizse (bozuk veri) ok:false reason:invalid', () => {
    // setQuickAddress guard'ını bilerek atlayıp doğrudan setAddress ile bozuk veri yazıyoruz —
    // gerçek dünyada localStorage bozulması/manuel müdahale senaryosunu simüle eder.
    setAddress({ id: 'home', name: 'Ev', latitude: 999, longitude: 30, type: 'favorite', category: 'home', updatedAt: Date.now() });
    const r = resolveHomeWorkDestination('home');
    expect(r).toEqual({ ok: false, category: 'home', reason: 'invalid' });
  });

  it('0,0 ile hiç güncellenmemiş varsayılan → missing (invalid DEĞİL)', () => {
    // initializeAddressBook() davranışını simüle eder: updatedAt yok.
    setAddress({ id: 'work', name: 'İş', latitude: 0, longitude: 0, type: 'favorite', category: 'work' });
    const r = resolveHomeWorkDestination('work');
    expect(r).toEqual({ ok: false, category: 'work', reason: 'missing' });
  });
});

/* ── A2. dispatchHomeWorkNavigation — tek merkezi handler ────────────────── */

describe('dispatchHomeWorkNavigation', () => {
  it('Ev kayıtlıysa startNavigation TAM OLARAK BİR KEZ gerçek koordinatla çağrılır', () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979, fullAddress: 'Ev Mah.' });
    const res = dispatchHomeWorkNavigation('home');
    expect(res.ok).toBe(true);
    expect(startNavigationMock).toHaveBeenCalledTimes(1);
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 41.015, longitude: 28.979 });
    expect(speakNavigationMock).toHaveBeenCalledTimes(1);
  });

  it('İş kayıtlıysa gerçek rota başlar', () => {
    setQuickAddress('work', { latitude: 39.92, longitude: 32.85 });
    const res = dispatchHomeWorkNavigation('work');
    expect(res.ok).toBe(true);
    expect(startNavigationMock).toHaveBeenCalledTimes(1);
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 39.92, longitude: 32.85 });
  });

  it('Ev kayıtlı DEĞİLSE: startNavigation ÇAĞRILMAZ, bounded hata döner', () => {
    const res = dispatchHomeWorkNavigation('home');
    expect(res).toEqual({ ok: false, reason: 'missing' });
    expect(startNavigationMock).not.toHaveBeenCalled();
    expect(speakNavigationMock).toHaveBeenCalledWith(i18n.t('navigation.home_missing'));
  });

  it('geçersiz koordinat: fail-closed — rota isteği YOK', () => {
    setAddress({ id: 'work', name: 'İş', latitude: NaN, longitude: 32.85, type: 'favorite', category: 'work', updatedAt: Date.now() });
    const res = dispatchHomeWorkNavigation('work');
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('aynı komut kısa pencerede iki kez tetiklenirse TEK navigation start olur (double-dispatch koruması)', () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });
    const t0 = 1_000_000;
    const first  = dispatchHomeWorkNavigation('home', t0);
    const second = dispatchHomeWorkNavigation('home', t0 + 50); // 50ms sonra — aynı pencere
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'debounced' });
    expect(startNavigationMock).toHaveBeenCalledTimes(1);
  });

  it('dedupe penceresi geçince yeni komut yeniden gerçek dispatch üretir', () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });
    const t0 = 1_000_000;
    dispatchHomeWorkNavigation('home', t0);
    dispatchHomeWorkNavigation('home', t0 + 5_000); // pencere dışı
    expect(startNavigationMock).toHaveBeenCalledTimes(2);
  });
});

describe('isHomeWorkDestination', () => {
  it('"home"/"work" kabul edilir, başka değer reddedilir', () => {
    expect(isHomeWorkDestination('home')).toBe(true);
    expect(isHomeWorkDestination('work')).toBe(true);
    expect(isHomeWorkDestination('hastane')).toBe(false);
    expect(isHomeWorkDestination(undefined)).toBe(false);
  });
});

/* ── i18n anahtarları — TR + EN ──────────────────────────────────────────── */

describe('navigation i18n anahtarları', () => {
  it('TR metinleri tanımlı', () => {
    i18n.changeLanguage('tr');
    expect(i18n.t('navigation.home_starting')).toBe('Ev için rota başlatılıyor.');
    expect(i18n.t('navigation.work_starting')).toBe('İş için rota başlatılıyor.');
    expect(i18n.t('navigation.home_missing')).toContain('Ev adresi kayıtlı değil');
    expect(i18n.t('navigation.work_missing')).toContain('İş adresi kayıtlı değil');
    expect(i18n.t('navigation.destination_invalid')).toContain('geçersiz');
  });
  it('EN metinleri tanımlı (hardcoded-TR-only DEĞİL)', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('navigation.home_starting')).toBe('Starting route to home.');
    expect(i18n.t('navigation.work_starting')).toBe('Starting route to work.');
    expect(i18n.t('navigation.home_missing')).toContain('Home address is not saved');
    i18n.changeLanguage('tr'); // diğer testleri etkilememesi için geri al
  });
});

/* ── B. intentEngine.routeIntent — OPEN_NAVIGATION destination hattı ─────── *
 * KÖK NEDEN KANITI: düzeltmeden ÖNCE bu blok FAIL eder çünkü routeIntent'in
 * eski OPEN_NAVIGATION case'i yalnızca ctx.launch(appId) çağırır, destination'ı
 * hiç okumaz → startNavigation asla tetiklenmez.
 * ────────────────────────────────────────────────────────────────────────── */

describe('intentEngine.routeIntent — OPEN_NAVIGATION Ev/İş destination hattı', () => {
  it('"navigate_home" komutu → OPEN_NAVIGATION → Ev kayıtlıysa GERÇEK navigasyon başlatır (ekran açmakla YETİNMEZ)', async () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979, fullAddress: 'Ev Mah.' });
    const intent = toIntent(
      { type: 'navigate_home', raw: 'eve git', confidence: 0.95, feedback: 'Eve gidiliyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    expect(intent.type).toBe('OPEN_NAVIGATION');
    expect(intent.payload.destination).toBe('home'); // destination toIntent aşamasında kaybolmamalı

    const ctx = makeCtx();
    await routeIntent(intent, ctx);

    expect(startNavigationMock).toHaveBeenCalledTimes(1);
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 41.015, longitude: 28.979 });
  });

  it('"navigate_work" komutu → İş kayıtlıysa gerçek navigasyon başlatır', async () => {
    setQuickAddress('work', { latitude: 39.92, longitude: 32.85 });
    const intent = toIntent(
      { type: 'navigate_work', raw: 'işe git', confidence: 0.95, feedback: 'İşe gidiliyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    const ctx = makeCtx();
    await routeIntent(intent, ctx);

    expect(startNavigationMock).toHaveBeenCalledTimes(1);
    expect(startNavigationMock.mock.calls[0][0]).toMatchObject({ latitude: 39.92, longitude: 32.85 });
  });

  it('Ev kayıtlı DEĞİLKEN "eve git": navigasyon BAŞLAMAZ, ekran da açılmaz (fail-closed, sessiz ekran-açma YOK)', async () => {
    const intent = toIntent(
      { type: 'navigate_home', raw: 'eve git', confidence: 0.95, feedback: 'Eve gidiliyor', priority: 'critical' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    const ctx = makeCtx();
    await routeIntent(intent, ctx);

    expect(startNavigationMock).not.toHaveBeenCalled();
    expect(ctx.launch).not.toHaveBeenCalled();
  });

  it('destination YOKKEN (ör. "haritayı aç") ESKİ davranış korunur — ctx.launch(defaultNav) çağrılır', async () => {
    const intent = toIntent(
      { type: 'open_maps', raw: 'haritayı aç', confidence: 0.9, feedback: 'Harita açılıyor', priority: 'normal' },
      { defaultNav: 'maps', defaultMusic: 'spotify' },
    );
    const ctx = makeCtx();
    await routeIntent(intent, ctx);

    expect(ctx.launch).toHaveBeenCalledWith('maps');
    expect(startNavigationMock).not.toHaveBeenCalled();
  });
});

/* ── C. commandExecutor.executeIntent — AI/Mavi beyin hattı (aynı kök) ───── *
 * intentEngine.routeIntent (yerel commandParser) ile commandExecutor.dispatchIntent
 * (AI-brain / semanticAiService JSON çıktısı) PARALEL iki yürütücüdür; ikisi de
 * OPEN_NAVIGATION'ı işler. NAVIGATION-P0-1 ikisini de AYNI dispatchHomeWorkNavigation()
 * fonksiyonuna bağlar — tek kaynak, çift bakım/çift mesaj metni YOK.
 * ────────────────────────────────────────────────────────────────────────── */

function makeCmdCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: { speedKmh: 0, drivingMode: 'idle', isDriving: false },
    defaultNav: 'maps',
    defaultMusic: 'spotify',
    launch: vi.fn(),
    ...overrides,
  };
}

describe('commandExecutor.executeIntent — OPEN_NAVIGATION Ev/İş destination hattı', () => {
  it('Ev kayıtlıysa gerçek navigasyon başlatır (yalnız ekran açmaz)', async () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });
    const ctx = makeCmdCtx();
    await executeIntent({ type: 'OPEN_NAVIGATION', payload: { destination: 'home' }, priority: 'high' }, ctx);

    expect(startNavigationMock).toHaveBeenCalledTimes(1);
    expect(ctx.launch).not.toHaveBeenCalled();
  });

  it('destination YOKKEN eski davranış korunur (ctx.launch(defaultNav))', async () => {
    const ctx = makeCmdCtx();
    await executeIntent({ type: 'OPEN_NAVIGATION', payload: {}, priority: 'high' }, ctx);

    expect(ctx.launch).toHaveBeenCalledWith('maps');
    expect(startNavigationMock).not.toHaveBeenCalled();
  });

  it('AYNI "eve git" hem routeIntent hem executeIntent üzerinden art arda gelirse TEK navigation start olur (çift-yol koruması)', async () => {
    setQuickAddress('home', { latitude: 41.015, longitude: 28.979 });
    const intent = { type: 'OPEN_NAVIGATION' as const, payload: { destination: 'home' }, priority: 'high' as const };

    await routeIntent(intent, makeCtx());       // yerel yol
    await executeIntent(intent, makeCmdCtx());  // AI/Mavi yolu — aynı anda tetiklendi varsayımı

    expect(startNavigationMock).toHaveBeenCalledTimes(1); // ikinci çağrı dedupe guard'a takılır
  });
});
