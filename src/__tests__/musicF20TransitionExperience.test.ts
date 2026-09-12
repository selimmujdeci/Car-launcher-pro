/**
 * musicF20TransitionExperience.test.ts — MUSIC F20 · Parça geçişi.
 *
 * ÖLÇÜLEN PLATFORM GERÇEĞİ:
 *   · GAPLESS zaten VAR (ExoPlayer) — F20'nin işi onu BOZMAMAKTIR.
 *   · GERÇEK CROSSFADE (üst üste binme) tek-player mimarisinde MÜMKÜN DEĞİL
 *     → dürüstçe DESTEKLENMİYOR yazılır, varmış gibi gösterilmez.
 *   · BEAT MATCHING / TIME STRETCH altyapısı YOK → iddia edilmez.
 *
 * Bu paket F20'nin sınırlarını KİLİTLER:
 *   · yetenek tablosu ÖLÇÜM kaydıdır; crossfade/beat UNSUPPORTED kalır
 *   · albüm devamlılığında fade UYGULANMAZ (gapless korunur)
 *   · canlı içerikte ve duck etkinken geçiş UYGULANMAZ
 *   · "akıllı" kısım yalnız SÜREdir ve yalnız GERÇEK ölçümden gelir
 *   · ikinci player/kuyruk otoritesi AÇILMAZ
 *   · geçiş kazancı playback TRUTH DEĞİLDİR
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  capabilityState, decideTransition, DEFAULT_FADE_MS, DEFAULT_TRANSITION_PREFERENCE,
  MAX_FADE_MS, MIN_FADE_MS, sanitizePreference, TRANSITION_CAPABILITIES,
  type TransitionContext, type TransitionPreference,
} from '../platform/media/transition/transitionModel';
import {
  _resetTransitionTelemetryForTest, getTransitionTelemetry,
} from '../platform/media/transition/transitionTelemetry';
import { makeTraitEvidence, NO_TRAIT_EVIDENCE } from '../platform/media/traits/musicTraitEvidence';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const ON: TransitionPreference = Object.freeze({ fadeEnabled: true, fadeMs: DEFAULT_FADE_MS });

function ctx(over: Partial<TransitionContext> = {}): TransitionContext {
  return {
    liveContent: false,
    duckActive: false,
    albumContinuity: false,
    evidence: null,
    ...over,
  };
}

const measured = (o: { tempoBpm?: number | null; energy?: number | null }) =>
  makeTraitEvidence({
    provenance: 'MEASURED_AUDIO', sourceId: 'sonic.analysis',
    tempoBpm: o.tempoBpm ?? null, energy: o.energy ?? null, confidence: 'HIGH',
  });

beforeEach(() => {
  _resetTransitionTelemetryForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · YETENEK TABLOSU — ölçüm kaydı, niyet değil
 * ════════════════════════════════════════════════════════════════════════ */

describe('F20 · yetenek dürüstçe raporlanır', () => {
  it('1 · gapless ve sınırda fade VAR; gerçek crossfade ve beat YOK', () => {
    expect(capabilityState('GAPLESS')).toBe('AVAILABLE');
    expect(capabilityState('BOUNDARY_FADE')).toBe('AVAILABLE');
    expect(capabilityState('TRUE_CROSSFADE'), 'olmayan crossfade VAR gösterilmiş')
      .toBe('UNSUPPORTED');
    expect(capabilityState('BEAT_MATCHED'), 'olmayan beat hizalama VAR gösterilmiş')
      .toBe('UNSUPPORTED');
    /* Her yetenek bir GEREKÇE taşır (kör tablo değil). */
    for (const c of TRANSITION_CAPABILITIES) {
      expect(c.rationale.length).toBeGreaterThan(40);
    }
  });

  it('2 · varsayılan tercih KAPALIDIR (davranış zorlanmaz)', () => {
    expect(DEFAULT_TRANSITION_PREFERENCE.fadeEnabled).toBe(false);
    expect(DEFAULT_TRANSITION_PREFERENCE.fadeMs).toBe(DEFAULT_FADE_MS);
  });

  it('3 · bozuk kalıcı tercih varsayılana düşer, süre sınırlanır', () => {
    expect(sanitizePreference(null)).toEqual(DEFAULT_TRANSITION_PREFERENCE);
    expect(sanitizePreference('x')).toEqual(DEFAULT_TRANSITION_PREFERENCE);
    expect(sanitizePreference({ fadeEnabled: true, fadeMs: 999999 }).fadeMs).toBe(MAX_FADE_MS);
    expect(sanitizePreference({ fadeEnabled: true, fadeMs: 1 }).fadeMs).toBe(MIN_FADE_MS);
    expect(sanitizePreference({ fadeEnabled: 'yes', fadeMs: 1000 }).fadeEnabled).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · POLİTİKA — ne zaman uygulanmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('F20 · geçiş yanlış yerde UYGULANMAZ', () => {
  it('4 · kapalıyken hiçbir geçiş uygulanmaz', () => {
    const p = decideTransition(DEFAULT_TRANSITION_PREFERENCE, ctx());
    expect(p.kind).toBe('NONE');
    expect(p.reason).toBe('DISABLED');
    expect(p.fadeOutMs).toBe(0);
  });

  it('5 · canlı yayında geçiş UYGULANMAZ (yanlış crossfade yok)', () => {
    const p = decideTransition(ON, ctx({ liveContent: true }));
    expect(p.kind).toBe('NONE');
    expect(p.reason).toBe('LIVE_CONTENT');
  });

  it('6 · Caros konuşurken (duck) geçiş UYGULANMAZ', () => {
    const p = decideTransition(ON, ctx({ duckActive: true }));
    expect(p.kind).toBe('NONE');
    expect(p.reason).toBe('DUCK_ACTIVE');
  });

  it('7 · albüm devamlılığında BOŞLUKSUZ kalır (fade eserin kendisini bozmaz)', () => {
    const p = decideTransition(ON, ctx({ albumContinuity: true }));
    expect(p.kind).toBe('GAPLESS');
    expect(p.reason).toBe('ALBUM_CONTINUITY');
    expect(p.fadeOutMs).toBe(0);
  });

  it('8 · sıra ANLAMLIDIR: canlı içerik albüm devamlılığından ÖNCE gelir', () => {
    const p = decideTransition(ON, ctx({ liveContent: true, albumContinuity: true }));
    expect(p.kind).toBe('NONE');
    expect(p.reason).toBe('LIVE_CONTENT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · "AKILLI" KISIM YALNIZ SÜREDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F20 · süre yalnız GERÇEK ölçümden ayarlanır', () => {
  it('9 · kanıt yoksa kullanıcının seçtiği süre AYNEN kullanılır', () => {
    const p = decideTransition(ON, ctx({ evidence: NO_TRAIT_EVIDENCE }));
    expect(p.kind).toBe('FADE');
    expect(p.reason).toBe('DEFAULT');
    expect(p.fadeOutMs).toBe(DEFAULT_FADE_MS);
    expect(p.evidenceBacked, 'kanıtsız süre "kanıtlı" sayılmış').toBe(false);
  });

  it('10 · ÖLÇÜLMÜŞ tempo süreyi ayarlar; hızlı parça KISA geçiş alır', () => {
    const fast = decideTransition(ON, ctx({ evidence: measured({ tempoBpm: 170 }) }));
    const slow = decideTransition(ON, ctx({ evidence: measured({ tempoBpm: 70 }) }));
    expect(fast.reason).toBe('EVIDENCE_TEMPO');
    expect(slow.reason).toBe('EVIDENCE_TEMPO');
    expect(fast.fadeOutMs).toBeLessThan(slow.fadeOutMs);
    expect(fast.evidenceBacked).toBe(true);
  });

  it('11 · ETİKET tempo (ölçüm değil) süreyi ayarlamaz', () => {
    const tagged = makeTraitEvidence({
      provenance: 'EMBEDDED_METADATA', sourceId: 'embedded.bpm',
      tempoBpm: 170, energy: 0.8, confidence: 'MEDIUM',
    });
    const p = decideTransition(ON, ctx({ evidence: tagged }));
    expect(p.reason, 'etiket tempo ölçüm gibi kullanılmış').toBe('DEFAULT');
    expect(p.evidenceBacked).toBe(false);
  });

  it('12 · tempo yoksa ÖLÇÜLMÜŞ enerji daha zayıf bir ayar yapar', () => {
    const hot = decideTransition(ON, ctx({ evidence: measured({ energy: 0.9 }) }));
    const calm = decideTransition(ON, ctx({ evidence: measured({ energy: 0.2 }) }));
    expect(hot.reason).toBe('EVIDENCE_ENERGY');
    expect(hot.fadeOutMs).toBeLessThan(calm.fadeOutMs);
  });

  it('13 · süre HER DURUMDA sınırlar içindedir', () => {
    for (const bpm of [50, 90, 130, 200]) {
      const p = decideTransition({ fadeEnabled: true, fadeMs: MAX_FADE_MS },
        ctx({ evidence: measured({ tempoBpm: bpm }) }));
      expect(p.fadeOutMs).toBeGreaterThanOrEqual(MIN_FADE_MS);
      expect(p.fadeOutMs).toBeLessThanOrEqual(MAX_FADE_MS);
      expect(p.fadeInMs).toBe(p.fadeOutMs);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · MİMARİ SINIRLAR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F20 · ikinci player/kuyruk otoritesi açılmaz', () => {
  it('14 · saf politika katmanı I/O · timer · global durum TAŞIMAZ', () => {
    const raw = read('src/platform/media/transition/transitionModel.ts');
    expect(raw.length, 'model okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    const src = codeOnly(raw);
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src, 'saf modelde Date.now var').not.toMatch(/Date\.now/);
    expect(src, 'saf model kalıcılığa yazmış').not.toMatch(/safeStorage|localStorage/);
  });

  it('15 · runtime kuyruğa DOKUNMAZ ve ikinci player AÇMAZ', () => {
    const src = codeOnly(read('src/platform/media/transition/transitionRuntime.ts'));
    expect(src, 'geçiş katmanı kuyruğa yazmış')
      .not.toMatch(/\b(createQueue|addToQueue|setCurrentIndex|clearQueue|advance)\s*\(/);
    expect(src, 'geçiş katmanı native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(src, 'geçiş katmanı çalma komutu vermiş')
      .not.toMatch(/\b(play|pause|stop|seek)\s*\(\s*\)/);
    expect(src, 'geçiş katmanı timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    /* TEK yazma yolu: kanonik gateway seam'i. */
    expect(src).toContain('setTransitionPolicy');
  });

  it('16 · native geçiş kazancı playback TRUTH üretmez ve YALNIZ kısar', () => {
    const raw = read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java');
    expect(raw.length, 'native okunamadı — kilit boş kümeye düştü').toBeGreaterThan(10000);
    /* Yorumlar SOYULUR: kilit KODU denetler, açıklamayı değil. */
    const java = codeOnly(raw);
    expect(java, 'geçiş kazancı ses formülüne girmemiş')
      .toMatch(/userVolume \* duck \* transitionGain/);
    /* renderingVerified geçiş kazancından ETKİLENMEZ. */
    expect(java, 'renderingVerified geçiş kazancına bağlanmış')
      .not.toMatch(/isRenderingVerified[\s\S]{0,400}transitionGain/);
    /* Gapless bozulmamalı: pauseAtEndOfMediaItems ASLA kullanılmaz. */
    expect(java, 'gapless bozulmuş (pauseAtEndOfMediaItems)')
      .not.toContain('setPauseAtEndOfMediaItems');
    /* İkinci player YOK. */
    const players = java.match(/new ExoPlayer\.Builder/g) ?? [];
    expect(players.length, 'ikinci ExoPlayer açılmış').toBe(1);
  });

  it('17 · native fade duck ile çakışmaz ve canlı içerikte çalışmaz', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java');
    expect(java, 'duck sırasında fade engeli yok')
      .toMatch(/checkFadeOut[\s\S]{0,600}getDuckVolume\(\) < 1\.0f/);
    expect(java, 'süresi bilinmeyen içerikte fade engeli yok')
      .toMatch(/checkFadeOut[\s\S]{0,900}C\.TIME_UNSET/);
    expect(java, 'sıradaki öğe yokken fade-out engeli yok')
      .toMatch(/checkFadeOut[\s\S]{0,900}hasNextMediaItem/);
    /* Kapalıyken timer YOK. */
    expect(java).toMatch(/updateFadeMonitor[\s\S]{0,400}removeCallbacks/);
  });

  it('18 · gateway seam\'i ses/kuyruk komutu DEĞİLDİR', () => {
    const gw = codeOnly(read('src/platform/media/authority/mediaCommandGateway.ts'));
    expect(gw).toContain("native.command('setTransitionPolicy'");
    /* Sahte başarı yok: kabul edilmeyen komut `false` döner. */
    expect(gw).toMatch(/setTransitionPolicy[\s\S]{0,600}return res\.accepted/);
  });

  it('19 · UI olmayan yeteneği ÇİZMEZ (crossfade kontrolü YOK)', () => {
    const rawUi = read('src/components/media/AudioExperiencePanel.tsx');
    const ui = codeOnly(rawUi);
    expect(rawUi).toContain('ax-fade-toggle');
    expect(ui, 'olmayan crossfade kontrolü çizilmiş').not.toMatch(/crossfade|Çapraz geçiş/i);
    expect(ui, 'UI kendi geçiş state\'ini tutmuş').toContain('getTransitionPreference');
  });

  it('20 · LAB kartı salt gözlemdir — politika UYGULAMAZ', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('27 · Parça Geçişi (F20)');
    const sources = codeOnly(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources, 'LAB politika uygulamış')
      .not.toMatch(/\b(applyTransitionPolicy|setTransitionPreference)\s*\(/);
    expect(sources, 'LAB parça adı taşımış').not.toMatch(/f20(Title|Artist|Uri|Track)/);
  });

  it('21 · telemetri metin/ad TAŞIMAZ', () => {
    const src = read('src/platform/media/transition/transitionTelemetry.ts');
    for (const f of ['title', 'artist', 'uri', 'query', 'utterance']) {
      expect(src.toLowerCase(), `yasaklı alan sızmış: ${f}`).not.toContain(`${f}:`);
    }
    expect(src).toContain('evidenceBacked');
    expect(getTransitionTelemetry().counters.decisions).toBe(0);
  });
});
