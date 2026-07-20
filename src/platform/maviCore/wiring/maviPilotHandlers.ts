/**
 * maviCore/wiring/maviPilotHandlers.ts — MAVİ ÇEKİRDEĞİ Faz-2 · PİLOT EYLEM HANDLER'LARI.
 *
 * AMAÇ: 9 pilot eylemin GERÇEK yürütmesini, resmi platform servislerine DI edilmiş fonksiyon
 * portlarıyla bağlar. maviCore'un yan-etkisiz kalması için servisleri DOĞRUDAN import ETMEZ —
 * gerçek bağlama SystemBoot wiring'inde (maviVoiceBridge) yapılır; burası saf + test edilebilir.
 *
 * KAPSAM SINIRLARI (task kuralları · CLAUDE.md):
 *  - YALNIZ resmi servis/API çağrılır (UI elementine tıklama simülasyonu YOK).
 *  - vehicle.health.read SALT-OKUMA: DTC okur, hiçbir şey yazmaz/temizlemez. ECU write/coding/
 *    actuator/adaptation bu handler'larda HİÇ YOK (zaten AiSafetyGate hard-forbidden reddeder).
 *  - "Başarısız eylem yapılmış gibi cevap verme": handler gerçek başarısızlıkta ok:false döner
 *    (servis throw → catch → ok:false); feedback katmanı bunu dürüst mesaja çevirir.
 *  - reversible eylemlerde rollback döndürülür (tema/parlaklık-benzeri geri yükleme, nav iptali).
 */

import type { ActionHandler, ActionExecResult } from '../executionEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * DI portları (gerçek servisler SystemBoot wiring'inde bağlanır)
 * ════════════════════════════════════════════════════════════════════════ */

export type PilotThemeMode = 'night' | 'day' | 'oled' | 'dark';

export interface VehicleHealthReadout {
  readonly dtcCount: number;
  readonly criticalCount: number;
  /** Sürücü-dostu kısa özet (ISO 15008 — feedback katmanı okur). */
  readonly summary: string;
}

/**
 * Pilot handler'ların ihtiyaç duyduğu resmi servis portları. Her biri SENKRON veya async olabilir;
 * handler abort sinyaline best-effort saygı gösterir (uzun okuma/navigasyon timeout'ta kesilir).
 */
export interface PilotHandlerDeps {
  /** ui.theme.set — görsel tema motoru (useCarTheme.setTheme mantığı). */
  readonly setTheme: (mode: PilotThemeMode) => void;
  /** ui.theme.set rollback için mevcut görsel modu okur (yoksa rollback verilmez). */
  readonly getThemeMode?: () => PilotThemeMode | undefined;
  /** ui.page.open — screenRegistry ile iç ekran aç; bulunamazsa false. */
  readonly openScreen: (screenId: string) => boolean;
  /** media.play */
  readonly mediaPlay: () => void;
  /** media.pause (çalıyorsa duraklat — wiring guard'lı sürümü sağlar). */
  readonly mediaPause: () => void;
  /** media.next */
  readonly mediaNext: () => void;
  /** media.volume.set — 0..100 (systemSettingsService.setVolume). */
  readonly setVolume: (percent: number) => void;
  /** media.volume.set rollback için mevcut ses seviyesi (yoksa rollback verilmez). */
  readonly getVolume?: () => number | undefined;
  /** navigation.open — hedefe uygulama-içi rota (resolveAndNavigate). */
  readonly navigateTo: (destination: string) => void | Promise<void>;
  /** navigation.open — hedef verilmediyse navigasyon ekranını aç; bulunamazsa false. */
  readonly openNavScreen: () => boolean;
  /** navigation.cancel — aktif rotayı durdur (stopNavigation). */
  readonly cancelNavigation: () => void;
  /** vehicle.health.read — SALT-OKUMA DTC okuması (readDTCCodes + snapshot). */
  readonly readHealth: () => Promise<VehicleHealthReadout> | VehicleHealthReadout;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Handler yardımcıları
 * ════════════════════════════════════════════════════════════════════════ */

function ok(value?: unknown, rollback?: () => void | Promise<void>): ActionExecResult {
  return rollback ? { ok: true, value, rollback } : { ok: true, value };
}

function fail(error: string): ActionExecResult {
  return { ok: false, error };
}

/** Servis çağrısını güvenli sarar: throw → ok:false (yapılmış gibi cevap verme). */
async function guard(fn: () => void | Promise<void>, label: string): Promise<ActionExecResult | null> {
  try {
    await fn();
    return null; // başarılı — çağıran ok() üretir
  } catch (e) {
    return fail(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Fabrika — pilot actionId → gerçek ActionHandler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 9 pilot eylemin gerçek handler haritasını üretir. executionEngine'e `handlers` olarak verilir.
 * Payload'lar zaten actionRegistry.validate'ten geçmiştir (motor doğrular) — handler yine de
 * savunmacı okur (fail-soft).
 */
export function createPilotHandlers(deps: PilotHandlerDeps): Record<string, ActionHandler> {
  return {
    /* ── UI ─────────────────────────────────────────────────── */
    'ui.theme.set': async (payload): Promise<ActionExecResult> => {
      const mode = (payload as { theme?: PilotThemeMode }).theme;
      if (mode !== 'night' && mode !== 'day' && mode !== 'oled' && mode !== 'dark') {
        return fail('geçersiz tema');
      }
      const prev = deps.getThemeMode?.();
      const err = await guard(() => deps.setTheme(mode), 'tema');
      if (err) return err;
      // reversible: önceki mod biliniyorsa geri yükle.
      const rollback = prev ? (): void => deps.setTheme(prev) : undefined;
      return ok(undefined, rollback);
    },

    'ui.page.open': async (payload): Promise<ActionExecResult> => {
      const page = (payload as { page?: string }).page;
      if (typeof page !== 'string' || page.length === 0) return fail('ekran adı yok');
      let found = false;
      const err = await guard(() => { found = deps.openScreen(page); }, 'ekran');
      if (err) return err;
      if (!found) return fail(`ekran bulunamadı: ${page}`);
      return ok();
    },

    /* ── Medya ──────────────────────────────────────────────── */
    'media.play': async (): Promise<ActionExecResult> => {
      const err = await guard(() => deps.mediaPlay(), 'oynat');
      // reversible: play → pause geri alır.
      return err ?? ok(undefined, () => deps.mediaPause());
    },

    'media.pause': async (): Promise<ActionExecResult> => {
      const err = await guard(() => deps.mediaPause(), 'duraklat');
      return err ?? ok(undefined, () => deps.mediaPlay());
    },

    'media.next': async (): Promise<ActionExecResult> => {
      // Tek-yön (reversible=false registry'de) → rollback verilmez.
      const err = await guard(() => deps.mediaNext(), 'sonraki');
      return err ?? ok();
    },

    'media.volume.set': async (payload): Promise<ActionExecResult> => {
      const value = (payload as { value?: number }).value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        return fail('geçersiz ses seviyesi');
      }
      const prev = deps.getVolume?.();
      const err = await guard(() => deps.setVolume(value), 'ses');
      if (err) return err;
      const rollback = typeof prev === 'number' ? (): void => deps.setVolume(prev) : undefined;
      return ok(undefined, rollback);
    },

    /* ── Navigasyon ─────────────────────────────────────────── */
    'navigation.open': async (payload, signal): Promise<ActionExecResult> => {
      const dest = (payload as { destination?: string }).destination;
      if (typeof dest === 'string' && dest.length > 0) {
        const err = await guard(() => deps.navigateTo(dest), 'navigasyon');
        if (err) return err;
        if (signal.aborted) return fail('navigasyon iptal edildi');
        // reversible: başlatılan rota iptal edilebilir.
        return ok(undefined, () => deps.cancelNavigation());
      }
      // Hedef yok → navigasyon ekranını aç.
      let found = false;
      const err = await guard(() => { found = deps.openNavScreen(); }, 'navigasyon');
      if (err) return err;
      if (!found) return fail('navigasyon ekranı bulunamadı');
      return ok();
    },

    'navigation.cancel': async (): Promise<ActionExecResult> => {
      // Tek-yön (reversible=false).
      const err = await guard(() => deps.cancelNavigation(), 'navigasyon iptali');
      return err ?? ok();
    },

    /* ── Araç sağlığı (SALT-OKUMA) ──────────────────────────── */
    'vehicle.health.read': async (_payload, signal): Promise<ActionExecResult> => {
      try {
        const readout = await deps.readHealth();
        if (signal.aborted) return fail('okuma iptal edildi');
        if (!readout || typeof readout.dtcCount !== 'number') return fail('araç verisi alınamadı');
        // Salt-okuma → rollback yok.
        return ok(readout);
      } catch (e) {
        return fail(`sağlık okuma: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * Shadow (gölge) handler'ları — pilot actionId'lerin HİÇBİR gerçek servisi çağırmayan no-op
 * karşılıkları. Model A (shadow-first): köprü, orchestrator akışını (lifecycle/güvenlik/telemetry/
 * context/feedback) gerçek trafikte çalıştırır ama GERÇEK eylemi eski hat yapar → çifte yürütme
 * YOK. Takeover moduna geçince gerçek `createPilotHandlers` kullanılır. Handler'lar `ok:true` döner
 * ki akış "başarılı" ilerlesin; gerçek servis dokunuşu YOK.
 */
export function createShadowHandlers(): Record<string, ActionHandler> {
  const noop: ActionHandler = () => ({ ok: true });
  return {
    'ui.theme.set': noop,
    'ui.page.open': noop,
    'media.play': noop,
    'media.pause': noop,
    'media.next': noop,
    'media.volume.set': noop,
    'navigation.open': noop,
    'navigation.cancel': noop,
    'vehicle.health.read': () => ({ ok: true, value: { dtcCount: 0, criticalCount: 0, summary: 'gölge' } }),
  };
}
