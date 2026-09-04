/**
 * musicPreFieldRepair.test.ts — CAROS MUSIC · SAHA ÖNCESİ ONARIM KİLİTLERİ.
 *
 * Telefon ön doğrulamasında (Redmi 23090RA98I · Android 13) ÖLÇÜLEN üç açığı
 * kilitler. Yeni özellik yoktur; her kilit bir GERÇEK kusurun bekçisidir.
 *
 *   BUG-1  F20 geçiş gözlem alanları İKİ allowlist'te düşüyordu → LAB satırı
 *          kalıcı `KAYNAK YOK` idi. Alanlar artık köprüden ve sanitize'dan
 *          GEÇMELİ; playback truth'u ETKİLEMEMELİ.
 *   BUG-2  `restoreListeningSession` üretimde HİÇ çağrılmıyordu (yaz-ama-okuma).
 *          Artık kanonik boot girişinden EXACTLY-ONCE çağrılır; ÇALMAZ,
 *          native canlıyken ATLAR, bayat uzak adres geri yüklemez.
 *   F20-K  `MIN_FADE_TRACK_MS` yalnız fade-out'ta uygulanıyordu → 9 sn'lik ses
 *          notu fade-in alıyordu. Artık iki yönde de uygulanır.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sanitizeAuthoritySnapshot } from '../platform/media/authority/nativeAuthorityBridge';
import { _resetRecoveryTelemetryForTest } from '../platform/media/recovery/recoveryTelemetry';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const SERVICE = 'android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java';
const BRIDGE = 'android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackBridge.java';

const F20_FIELDS = [
  'fadeEnabled', 'fadeOutMs', 'fadeInMs',
  'transitionGain', 'transitionActive', 'gaplessSupported',
] as const;

beforeEach(() => {
  _resetRecoveryTelemetryForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * BUG-1 · F20 GEÇİŞ GÖZLEMİ KÖPRÜ BOYUNCA KAYBOLMUYOR
 * ════════════════════════════════════════════════════════════════════════ */

describe('BUG-1 · F20 geçiş alanları native→JS yolunda düşmüyor', () => {
  it('1 · native servis alanları ÜRETİYOR (kaynak kanıtı)', () => {
    const java = read(SERVICE);
    expect(java.length, 'servis okunamadı — kilit boş kümeye düştü').toBeGreaterThan(10000);
    for (const f of F20_FIELDS) {
      expect(java, `servis ${f} alanını üretmiyor`).toMatch(
        new RegExp(`b\\.put(Boolean|Int|Float|String)?\\("${f}"`),
      );
    }
  });

  it('2 · Java köprü allowlist\'i alanları TAŞIYOR (ölçülen kusur)', () => {
    const code = codeOnly(read(BRIDGE));
    /* Bu kilit gövdeyi denetler: yorumda geçmesi YETMEZ. */
    for (const f of F20_FIELDS) {
      expect(code, `köprü ${f} alanını JS'e taşımıyor`).toMatch(
        new RegExp(`o\\.put\\("${f}"`),
      );
    }
  });

  it('3 · TS sanitize allowlist\'i alanları KORUYOR', () => {
    const snap = sanitizeAuthoritySnapshot({
      authorityAvailable: true, playing: false, renderingVerified: false,
      fadeEnabled: true, fadeOutMs: 1200, fadeInMs: 1200,
      transitionGain: 0.35, transitionActive: true, gaplessSupported: true,
    });
    expect(snap.fadeEnabled).toBe(true);
    expect(snap.fadeOutMs).toBe(1200);
    expect(snap.fadeInMs).toBe(1200);
    expect(snap.transitionGain).toBeCloseTo(0.35, 6);
    expect(snap.transitionActive).toBe(true);
    expect(snap.gaplessSupported).toBe(true);
  });

  it('4 · bozuk/eksik geçiş alanı UYDURULMAZ (undefined kalır)', () => {
    const snap = sanitizeAuthoritySnapshot({
      authorityAvailable: true, playing: false, renderingVerified: false,
      transitionGain: 'çok', transitionActive: 1, gaplessSupported: 'evet',
    });
    expect(snap.transitionGain, 'sayı olmayan kazanç sayıya çevrilmiş').toBeUndefined();
    expect(snap.transitionActive).toBeUndefined();
    expect(snap.gaplessSupported).toBeUndefined();
    /* Alan hiç yokken de sahte varsayılan ÜRETİLMEZ. */
    const bare = sanitizeAuthoritySnapshot({
      authorityAvailable: true, playing: false, renderingVerified: false,
    });
    expect(bare.transitionGain).toBeUndefined();
    expect(bare.fadeEnabled).toBeUndefined();
  });

  it('5 · geçiş alanları PLAYBACK TRUTH üretmiyor', () => {
    /* Fade tam kısılmışken bile playing/renderingVerified BAĞIMSIZ okunur. */
    const snap = sanitizeAuthoritySnapshot({
      authorityAvailable: true, playing: true, renderingVerified: true,
      transitionGain: 0, transitionActive: true,
    });
    expect(snap.playing, 'geçiş kazancı playing\'i ezmiş').toBe(true);
    expect(snap.renderingVerified, 'geçiş kazancı ses kanıtını ezmiş').toBe(true);
  });

  it('6 · LAB gerçek native alanları OKUYOR (sabit değil)', () => {
    const sources = codeOnly(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources).toMatch(/s\.transitionGain/);
    expect(sources).toMatch(/s\.transitionActive/);
    expect(sources).toMatch(/s\.gaplessSupported/);
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('f20NativeGain');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BUG-2 · ÜRETİM AÇILIŞ RESTORE GİRİŞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('BUG-2 · açılış geri yüklemesi üretimde ve EXACTLY-ONCE', () => {
  it('7 · kanonik boot sahibi (SystemBoot) girişi ÇAĞIRIYOR', () => {
    const boot = codeOnly(read('src/platform/system/SystemBoot.ts'));
    expect(boot.length, 'SystemBoot okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(5000);
    expect(boot, 'üretimde açılış geri yükleme çağrısı YOK (ölçülen kusur)')
      .toMatch(/await bootRestoreListeningSession\(\)/);
    /* Sıra ZORUNLU: medya otoritesi kurulduktan SONRA çağrılmalı. */
    const iAuth = boot.indexOf('startMediaAuthority()');
    const iRestore = boot.indexOf('bootRestoreListeningSession()');
    expect(iAuth).toBeGreaterThan(0);
    expect(iRestore, 'geri yükleme medya otoritesinden ÖNCE çağrılmış')
      .toBeGreaterThan(iAuth);
    /* Müzik zekâ katmanlarından ÖNCE gelmeli (abonelikler bağlamı görsün). */
    const iIntel = boot.indexOf('startMusicIntelligence()');
    expect(iIntel).toBeGreaterThan(0);
    expect(iRestore).toBeLessThan(iIntel);
  });

  it('8 · giriş EXACTLY-ONCE koşar (ikinci çağrı ATLAR)', async () => {
    vi.resetModules();
    const restore = vi.fn(() => ({
      restored: true, reason: 'ok', rejection: null,
      playbackClaim: 'NONE' as const, droppedEntryIds: [],
    }));
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => ({
      getSnapshot: () => ({ authorityAvailable: false, queueLength: 0 }),
    }));
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    rt._resetBootRestoreForTest();
    const tel = await import('../platform/media/recovery/recoveryTelemetry');
    tel._resetRecoveryTelemetryForTest();

    const a = await rt.bootRestoreListeningSession();
    const b = await rt.bootRestoreListeningSession();
    const c = await rt.bootRestoreListeningSession();

    expect(a.attempted).toBe(true);
    expect(b.attempted).toBe(false);
    expect(b.skipped).toBe('ALREADY_RUN');
    expect(c.skipped).toBe('ALREADY_RUN');
    expect(tel.getRecoveryTelemetry().counters.bootRestoreRuns,
      'exactly-once ihlali: giriş birden fazla koştu').toBe(1);
    expect(restore).not.toHaveBeenCalled();  // doğrudan değil, kanonik yoldan
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('9 · giriş ASLA çalma iddiası üretmez (playbackClaim NONE)', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => ({
      getSnapshot: () => ({ authorityAvailable: false, queueLength: 0 }),
    }));
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    rt._resetBootRestoreForTest();
    const out = await rt.bootRestoreListeningSession();
    expect(out.playbackClaim).toBe('NONE');
    if (out.outcome) expect(out.outcome.playbackClaim).toBe('NONE');
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('10 · NATIVE OTURUM CANLIYKEN geri yükleme ATLANIR (duplicate yok)', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => ({
      getSnapshot: () => ({ authorityAvailable: true, queueLength: 8 }),
    }));
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    const tel = await import('../platform/media/recovery/recoveryTelemetry');
    rt._resetBootRestoreForTest();
    tel._resetRecoveryTelemetryForTest();

    const out = await rt.bootRestoreListeningSession();
    expect(out.attempted, 'native canlıyken ikinci kuyruk kurulmuş').toBe(false);
    expect(out.skipped).toBe('NATIVE_SESSION_LIVE');
    expect(out.outcome).toBeNull();
    const c = tel.getRecoveryTelemetry().counters;
    expect(c.bootRestoreSkippedNativeLive).toBe(1);
    /* Atlama bir geri yükleme DENEMESİ değildir. */
    expect(c.restoreAttempts).toBe(0);
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('11 · native kuyruğu BOŞSA geri yükleme yapılır (atlama koşulu dar)', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => ({
      getSnapshot: () => ({ authorityAvailable: true, queueLength: 0 }),
    }));
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    rt._resetBootRestoreForTest();
    const out = await rt.bootRestoreListeningSession();
    expect(out.attempted).toBe(true);
    expect(out.skipped).toBeNull();
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('12 · köprü okunamazsa giriş ÇÖKMEZ ve yine çalma başlatmaz', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => {
      throw new Error('bridge yok');
    });
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    rt._resetBootRestoreForTest();
    const out = await rt.bootRestoreListeningSession();
    expect(out.playbackClaim).toBe('NONE');
    expect(out.attempted).toBe(true);
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('13 · bozuk kalıcı kayıtta FAIL-CLOSED (sahte oturum kurulmaz)', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/nativeAuthorityBridge', () => ({
      getSnapshot: () => ({ authorityAvailable: false, queueLength: 0 }),
    }));
    vi.doMock('../platform/media/session/sessionPersistence', async (orig) => {
      const real = await (orig() as Promise<Record<string, unknown>>);
      return {
        ...real,
        readPersistedListeningSessionRaw: () => '{bozuk',
      };
    });
    const rt = await import('../platform/media/session/listeningSessionRuntime');
    const tel = await import('../platform/media/recovery/recoveryTelemetry');
    rt._resetBootRestoreForTest();
    tel._resetRecoveryTelemetryForTest();

    const out = await rt.bootRestoreListeningSession();
    expect(out.attempted).toBe(true);
    expect(out.outcome?.restored, 'bozuk kayıttan oturum kurulmuş').toBe(false);
    expect(out.outcome?.rejection).toBe('corrupt');
    expect(tel.getRecoveryTelemetry().counters.restoreRejected).toBe(1);
    vi.doUnmock('../platform/media/session/sessionPersistence');
    vi.doUnmock('../platform/media/authority/nativeAuthorityBridge');
  });

  it('14 · giriş oynatma komutu GÖNDERMEZ (kaynak kilidi)', () => {
    const src = codeOnly(read('src/platform/media/session/listeningSessionRuntime.ts'));
    const i = src.indexOf('export async function bootRestoreListeningSession');
    expect(i, 'giriş bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    const body = src.slice(i, i + 2200);
    expect(body, 'açılış girişi çalma/dispatch yapmış')
      .not.toMatch(/dispatch\(|playSource|setPlayWhenReady|autoPlay:\s*true/);
    expect(body, 'exactly-once kapısı await SONRASINA konmuş (yarış riski)')
      .toMatch(/_bootRestoreRan = true;[\s\S]{0,200}noteBootRestoreRun\(\)/);
  });

  it('15 · bayat uzak adres süzgeci geri yükleme yolunda KALIYOR', () => {
    const src = codeOnly(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(src).toMatch(/restoreListeningSession[\s\S]{0,3000}classifyEntryFreshness/);
    expect(src).toContain('shouldDropOnRestore');
    /* Yarım kalan devir restart sonrası commit EDEMEZ. */
    expect(src).toMatch(/restoreListeningSession[\s\S]{0,400}_activeTicket = null/);
    expect(src).toMatch(/restoreListeningSession[\s\S]{0,500}_committedTokens\.length = 0/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F20-K · KISA PARÇADA FADE YOK (iki yönde de)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F20 · kısa parçada ne fade-out ne fade-in uygulanır', () => {
  it('16 · minimum süre kapısı HER İKİ yönde de var', () => {
    const java = codeOnly(read(SERVICE));
    expect(java.length, 'servis okunamadı — kilit boş kümeye düştü').toBeGreaterThan(8000);
    const uses = java.match(/MIN_FADE_TRACK_MS/g) ?? [];
    /* 1 tanım + fade-out kapısı + fade-in kapısı = en az 3. */
    expect(uses.length, 'minimum süre kapısı yalnız tek yönde uygulanıyor')
      .toBeGreaterThanOrEqual(3);

    const outIdx = java.indexOf('private void checkFadeOut');
    const inIdx = java.indexOf('private void onTransitionToNewItem');
    expect(outIdx).toBeGreaterThan(0);
    expect(inIdx).toBeGreaterThan(0);
    const outBody = java.slice(outIdx, outIdx + 1400);
    const inBody = java.slice(inIdx, inIdx + 1400);
    expect(outBody, 'fade-out kapısı kaybolmuş').toContain('MIN_FADE_TRACK_MS');
    expect(inBody, 'fade-in kısa parçayı hâlâ bozuyor (ölçülen kusur)')
      .toContain('MIN_FADE_TRACK_MS');
  });

  it('17 · süre bilinmiyorsa fade-in FAIL-CLOSED (canlı içerik korunur)', () => {
    const java = codeOnly(read(SERVICE));
    const inIdx = java.indexOf('private void onTransitionToNewItem');
    const inBody = java.slice(inIdx, inIdx + 1400);
    expect(inBody, 'süre bilinmiyorken fade-in uygulanıyor').toContain('C.TIME_UNSET');
    /* Reddedilen dalda kazanç NÖTRE çekilmeli (sızıntı yok). */
    expect(inBody).toMatch(/C\.TIME_UNSET[\s\S]{0,200}resetTransitionGain\(\)/);
  });

  it('18 · uzun parçada mevcut F20 davranışı DEĞİŞMEDİ', () => {
    const java = codeOnly(read(SERVICE));
    /* Rampa, duck kapısı, sıradaki öğe kapısı ve ses formülü korunur. */
    expect(java).toMatch(/userVolume \* duck \* transitionGain/);
    expect(java).toMatch(/checkFadeOut[\s\S]{0,600}getDuckVolume\(\) < 1\.0f/);
    expect(java).toMatch(/checkFadeOut[\s\S]{0,900}hasNextMediaItem/);
    expect(java).toContain('startRamp(true');
    expect(java).toContain('startRamp(false');
    /* Eşik değeri DEĞİŞMEDİ. */
    const m = /MIN_FADE_TRACK_MS = (\d+)_?(\d*)L/.exec(read(SERVICE));
    expect(m, 'eşik sabiti bulunamadı').not.toBeNull();
    expect(`${m?.[1] ?? ''}${m?.[2] ?? ''}`).toBe('20000');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ORTAK · OTORİTE SINIRI KORUNUYOR
 * ════════════════════════════════════════════════════════════════════════ */

describe('Onarım turu yeni otorite/telemetri kurmadı', () => {
  it('19 · yeni telemetri modülü EKLENMEDİ — mevcut depo genişletildi', () => {
    const tel = read('src/platform/media/recovery/recoveryTelemetry.ts');
    expect(tel).toContain('bootRestoreRuns');
    expect(tel).toContain('bootRestoreSkippedNativeLive');
    /* Sayaçlar hiçbir karara geri beslenmez (salt gözlem sözleşmesi). */
    const rt = codeOnly(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(rt, 'karar telemetriden okunuyor (geri besleme)')
      .not.toMatch(/getRecoveryTelemetry\(\)/);
  });

  it('20 · LAB yeni KART açmadı — mevcut satır genişletildi', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    const cards = model.match(/\{ id: '[a-z-]+', title: '\d+ · /g) ?? [];
    expect(cards.length, 'LAB kart sayısı değişmiş').toBe(28);
    expect(model).toContain('f21-restore');
    expect(model).toContain('native canlı (atlandı)');
  });
});
