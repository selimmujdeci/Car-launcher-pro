/**
 * transitionModel.ts — MUSIC F20 · Parça geçişi POLİTİKASI (SAF).
 *
 * ── ÖLÇÜLEN PLATFORM GERÇEĞİ (F20 denetimi) ──────────────────────────────
 * `CarosPlaybackService` TEK bir `ExoPlayer` örneği kullanır ve kuyruğu
 * `setMediaItems(...)` ile verir.
 *
 *   1. **GAPLESS — ZATEN VAR.** ExoPlayer kodlayıcı gecikme/dolgu bilgisini
 *      kendisi kullanır; CarOS `setPauseAtEndOfMediaItems` KULLANMAZ. Bu
 *      yüzden F20'nin gapless işi bir şey EKLEMEK değil, BOZMAMAKTIR.
 *   2. **GERÇEK CROSSFADE — MÜMKÜN DEĞİL.** İki akışın üst üste binmesi ikinci
 *      bir player/mikser ister; bu "ikinci playback otoritesi" demektir ve
 *      F20 tarafından açıkça yasaklanmıştır. Bu yüzden CarOS crossfade
 *      İDDİA ETMEZ ve öyle adlandırmaz.
 *   3. **SINIRDA FADE — YAPILABİLİR.** Aynı ses zincirinde, aynı sahip
 *      tarafından uygulanan bir kazanç rampasıdır (duck gibi). Üst üste binme
 *      YOKTUR; adı da bu yüzden FADE'dir.
 *   4. **BEAT MATCHING / TIME STRETCH — YOK.** Repoda ne beat grid ne de
 *      zaman esnetme altyapısı vardır. "Akıllı geçiş" bu yüzden yalnız
 *      SÜREYİ seçer; vuruş hizalama İDDİA EDİLMEZ.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { MusicTraitEvidence } from '../traits/musicTraitEvidence';

/** Geçiş yeteneğinin ÖLÇÜLEN durumu — bir niyet değil, bir kayıt. */
export type TransitionCapabilityState = 'AVAILABLE' | 'UNSUPPORTED';

export interface TransitionCapability {
  readonly id: 'GAPLESS' | 'BOUNDARY_FADE' | 'TRUE_CROSSFADE' | 'BEAT_MATCHED';
  readonly state: TransitionCapabilityState;
  /** Neden — LAB'da okunur, kullanıcıya okunmaz. */
  readonly rationale: string;
}

export const TRANSITION_CAPABILITIES: readonly TransitionCapability[] = Object.freeze([
  Object.freeze({
    id: 'GAPLESS' as const, state: 'AVAILABLE' as const,
    rationale: 'ExoPlayer kuyruğu MediaItem listesi olarak alır ve kodlayıcı '
      + 'gecikme/dolgu bilgisini kendisi uygular. CarOS bunu BOZMAZ '
      + '(setPauseAtEndOfMediaItems KULLANILMAZ).',
  }),
  Object.freeze({
    id: 'BOUNDARY_FADE' as const, state: 'AVAILABLE' as const,
    rationale: 'Aynı ses zincirinde, aynı sahip tarafından uygulanan kazanç '
      + 'rampası. Üst üste binme YOKTUR — bu bir crossfade DEĞİLDİR.',
  }),
  Object.freeze({
    id: 'TRUE_CROSSFADE' as const, state: 'UNSUPPORTED' as const,
    rationale: 'İki akışın üst üste binmesi ikinci bir player/mikser ister; '
      + 'bu ikinci playback otoritesi demektir (F20 yasağı). Yeteneği varmış '
      + 'gibi göstermek yerine dürüstçe DESTEKLENMİYOR yazılır.',
  }),
  Object.freeze({
    id: 'BEAT_MATCHED' as const, state: 'UNSUPPORTED' as const,
    rationale: 'Repoda beat grid ve zaman esnetme altyapısı YOKTUR. Ölçülmüş '
      + 'tempo yalnız fade SÜRESİNİ seçer; vuruş hizalama İDDİA EDİLMEZ.',
  }),
]);

export function capabilityState(id: TransitionCapability['id']): TransitionCapabilityState {
  return TRANSITION_CAPABILITIES.find((c) => c.id === id)?.state ?? 'UNSUPPORTED';
}

/* ── Politika ─────────────────────────────────────────────────────────────── */

/** Fade süresi sınırları — araç içinde uzun fade "kayboldu" hissi verir. */
export const MIN_FADE_MS = 300;
export const MAX_FADE_MS = 6000;
export const DEFAULT_FADE_MS = 1200;

export type TransitionKind =
  /** Hiçbir kazanç uygulanmaz — ExoPlayer'ın kendi (boşluksuz) geçişi. */
  | 'GAPLESS'
  /** Sınırda kazanç rampası. */
  | 'FADE'
  /** Geçiş politikası UYGULANMAZ (canlı içerik · duck · kanıt yok). */
  | 'NONE';

export type TransitionReason =
  | 'DISABLED'
  | 'LIVE_CONTENT'
  | 'DUCK_ACTIVE'
  | 'ALBUM_CONTINUITY'
  | 'EVIDENCE_TEMPO'
  | 'EVIDENCE_ENERGY'
  | 'DEFAULT';

export interface TransitionPreference {
  readonly fadeEnabled: boolean;
  /** Kullanıcının istediği süre; kanıt varsa bu SINIRLAR içinde ayarlanır. */
  readonly fadeMs: number;
}

export const DEFAULT_TRANSITION_PREFERENCE: TransitionPreference = Object.freeze({
  /* Varsayılan KAPALI: duyulur bir davranış değişikliği kullanıcının
     kararıdır ve saha doğrulaması yapılmadan zorlanmaz. */
  fadeEnabled: false,
  fadeMs: DEFAULT_FADE_MS,
});

export interface TransitionContext {
  /** Kaynak canlı/süresi bilinmeyen mi (radyo · yayın). */
  readonly liveContent: boolean;
  /** Şu an duck etkin mi (konuşma/navigasyon). */
  readonly duckActive: boolean;
  /** Sıradaki öğe AYNI albümün devamı mı (boşluksuz kalması gereken durum). */
  readonly albumContinuity: boolean;
  /** Çalan parçanın karakter kanıtı (F10/F17) — yoksa `null`. */
  readonly evidence: MusicTraitEvidence | null;
}

export interface TransitionPolicy {
  readonly kind: TransitionKind;
  readonly reason: TransitionReason;
  /** Native'e gidecek fade süreleri (kind !== 'FADE' ise 0). */
  readonly fadeOutMs: number;
  readonly fadeInMs: number;
  /** Süre GERÇEK ölçüme dayanarak mı seçildi (LAB dürüstlüğü). */
  readonly evidenceBacked: boolean;
}

const NO_TRANSITION = (reason: TransitionReason): TransitionPolicy => Object.freeze({
  kind: 'NONE' as const, reason, fadeOutMs: 0, fadeInMs: 0, evidenceBacked: false,
});

const clampFade = (ms: number): number =>
  Math.max(MIN_FADE_MS, Math.min(MAX_FADE_MS, Math.round(ms)));

/**
 * Bir parça sınırı için geçiş politikası üretir.
 *
 * Sıra ANLAMLIDIR: önce "yapılmamalı mı", sonra "boşluksuz kalmalı mı",
 * en son "ne kadar".
 *
 * **Akıllı kısım yalnız SÜREdir.** Ölçülmüş tempo varsa hızlı parçada kısa,
 * yavaş parçada uzun fade seçilir — vuruş hizalama İDDİA EDİLMEZ (yok).
 * Kanıt yoksa kullanıcının seçtiği süre AYNEN kullanılır (uydurma yok).
 */
export function decideTransition(
  pref: TransitionPreference, ctx: TransitionContext,
): TransitionPolicy {
  if (!pref.fadeEnabled) return NO_TRANSITION('DISABLED');
  /* Canlı yayında "parça sonu" kavramı yoktur — fade YANLIŞ olurdu. */
  if (ctx.liveContent) return NO_TRANSITION('LIVE_CONTENT');
  /* Konuşma sırasında ikinci bir kazanç rampası duck'la çakışır. */
  if (ctx.duckActive) return NO_TRANSITION('DUCK_ACTIVE');

  /* Albüm devamlılığı fade'den ÜSTÜNDÜR: art arda çalması amaçlanmış iki
     parçanın arasına rampa koymak eserin kendisini bozar. */
  if (ctx.albumContinuity) {
    return Object.freeze({
      kind: 'GAPLESS' as const, reason: 'ALBUM_CONTINUITY' as const,
      fadeOutMs: 0, fadeInMs: 0, evidenceBacked: false,
    });
  }

  const base = clampFade(pref.fadeMs);
  const e = ctx.evidence;

  /* Ölçülmüş TEMPO varsa süre ondan seçilir (yalnız GERÇEK ölçüm). */
  if (e !== null && e.tempoBpm !== null && e.provenance === 'MEASURED_AUDIO') {
    /* Hızlı parça → kısa geçiş; yavaş parça → uzun geçiş. Katsayı KABADIR:
       elimizdeki kanıttan daha ince bir ayrım iddia etmek uydurma olurdu. */
    const scaled = e.tempoBpm >= 140 ? base * 0.6
      : e.tempoBpm >= 100 ? base * 0.85
        : base * 1.2;
    const ms = clampFade(scaled);
    return Object.freeze({
      kind: 'FADE' as const, reason: 'EVIDENCE_TEMPO' as const,
      fadeOutMs: ms, fadeInMs: ms, evidenceBacked: true,
    });
  }

  /* Ölçülmüş ENERJİ varsa daha zayıf bir ayar yapılır. */
  if (e !== null && e.energy !== null && e.provenance === 'MEASURED_AUDIO') {
    const ms = clampFade(base * (e.energy >= 0.7 ? 0.75 : 1.1));
    return Object.freeze({
      kind: 'FADE' as const, reason: 'EVIDENCE_ENERGY' as const,
      fadeOutMs: ms, fadeInMs: ms, evidenceBacked: true,
    });
  }

  /* Kanıt yok → kullanıcının seçtiği süre AYNEN. */
  return Object.freeze({
    kind: 'FADE' as const, reason: 'DEFAULT' as const,
    fadeOutMs: base, fadeInMs: base, evidenceBacked: false,
  });
}

/** Kalıcı tercihi doğrular — bozuk kayıt varsayılana düşer (fail-closed). */
export function sanitizePreference(raw: unknown): TransitionPreference {
  if (raw === null || typeof raw !== 'object') return DEFAULT_TRANSITION_PREFERENCE;
  const r = raw as Record<string, unknown>;
  const ms = typeof r.fadeMs === 'number' && Number.isFinite(r.fadeMs)
    ? clampFade(r.fadeMs) : DEFAULT_FADE_MS;
  return Object.freeze({ fadeEnabled: r.fadeEnabled === true, fadeMs: ms });
}
