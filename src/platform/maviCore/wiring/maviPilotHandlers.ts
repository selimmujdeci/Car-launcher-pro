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

/**
 * location.current.read sonucu. maviCore saf kalsın diye YAPISAL tip olarak tanımlanır —
 * `currentLocationService.CurrentLocationReadout` bunu karşılar, ama bu dosya o servisi
 * IMPORT ETMEZ (VehicleHealthReadout ile aynı desen).
 */
export interface CurrentLocationReadout {
  /** Sunulabilir bir konum cevabı üretilebildi mi (fail-closed: false → dürüst "bilmiyorum"). */
  readonly ok: boolean;
  /** Türkçe cevap cümlesi — feedback katmanı bunu okur. */
  readonly text: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timestampMs?: number | null;
  readonly accuracyM?: number | null;
  readonly ageMs?: number | null;
  readonly provider?: string | null;
  readonly address?: string | null;
}

/**
 * MÜZİK HUB PAKET A · medya komutunun DÜRÜST sonucu (SAF tip — import YOK).
 *
 * `PLAYING`      : oynatma GÖZLENDİ → "çalıyor" denebilir.
 * `REQUEST_SENT` : komut kabul edildi ama ses kanıtı YOK (uzak kaynak / iframe)
 *                  → "çalıyor" DENEMEZ; dürüst ifade sesli cevaba taşınır.
 */
export interface MediaCommandFeedback {
  readonly claim: 'PLAYING' | 'REQUEST_SENT';
  readonly message: string;
}

/** Değer bir medya geri bildirimi mi (feedback katmanı için tip daraltma). */
export function isMediaCommandFeedback(v: unknown): v is MediaCommandFeedback {
  if (!v || typeof v !== 'object') return false;
  const c = (v as { claim?: unknown }).claim;
  const m = (v as { message?: unknown }).message;
  return (c === 'PLAYING' || c === 'REQUEST_SENT') && typeof m === 'string' && m.length > 0;
}

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
  /**
   * media.play — MÜZİK HUB PAKET A: port `MediaCommandFeedback` DÖNEBİLİR.
   * Dönerse iddia sınıfı sesli cevaba taşınır ("çalıyor" ≠ "istek gönderildi").
   * Başarısızlıkta port THROW eder → handler ok:false üretir (yapılmış gibi cevap yok).
   */
  readonly mediaPlay: () => void | Promise<void | MediaCommandFeedback>;
  /** media.pause (çalıyorsa duraklat — wiring guard'lı sürümü sağlar). */
  readonly mediaPause: () => void | Promise<void | MediaCommandFeedback>;
  /** media.next */
  readonly mediaNext: () => void | Promise<void | MediaCommandFeedback>;
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
  /**
   * location.current.read — SALT-OKUMA mevcut konum sorgusu ("Neredeyim?").
   * Wiring `currentLocationService.readCurrentLocation`'ı bağlar; navigasyon BAŞLATMAZ.
   */
  readonly readCurrentLocation: () => Promise<CurrentLocationReadout> | CurrentLocationReadout;
  /**
   * phone.* — Phone Hub oturumunun GERÇEKTEN kurulu olup olmadığını okur.
   *
   * ⚠️ OPSİYONEL ve FAIL-CLOSED: port VERİLMEZSE telefon BAĞLI DEĞİL sayılır.
   * Bugün repoda telefona komut iletecek native uç (RFCOMM komut kanalı) YOKTUR;
   * bu yüzden port bağlanmadığı sürece phone.* eylemleri dürüstçe reddedilir.
   * "Bağlı" diye varsaymak, yapılmamış bir aramayı yapılmış göstermek olurdu.
   */
  readonly isPhoneLinkReady?: () => boolean;
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
    /* MÜZİK HUB PAKET A: port dürüst sonuç dönerse `value` olarak taşınır —
       feedback katmanı "çalıyor" ile "istek gönderildi"yi AYIRIR. Rollback'ler
       `void` sarmalanır: geri alma sonucu iddia üretmez. */
    'media.play': async (): Promise<ActionExecResult> => {
      let feedback: unknown;
      const err = await guard(async () => { feedback = await deps.mediaPlay(); }, 'oynat');
      // reversible: play → pause geri alır.
      return err ?? ok(feedback, () => { void deps.mediaPause(); });
    },

    'media.pause': async (): Promise<ActionExecResult> => {
      let feedback: unknown;
      const err = await guard(async () => { feedback = await deps.mediaPause(); }, 'duraklat');
      return err ?? ok(feedback, () => { void deps.mediaPlay(); });
    },

    'media.next': async (): Promise<ActionExecResult> => {
      // Tek-yön (reversible=false registry'de) → rollback verilmez.
      let feedback: unknown;
      const err = await guard(async () => { feedback = await deps.mediaNext(); }, 'sonraki');
      return err ?? ok(feedback);
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

    /* ── Mevcut konum (SALT-OKUMA · "Neredeyim?") ───────────── */
    'location.current.read': async (_payload, signal): Promise<ActionExecResult> => {
      try {
        const readout = await deps.readCurrentLocation();
        if (signal.aborted) return fail('konum okuma iptal edildi');
        if (!readout || typeof readout.text !== 'string') return fail('konum verisi alınamadı');
        /* Fix yoksa/bayatsa `ok:false` gelir — bu bir HATA değil, DÜRÜST cevaptır. Eylemi
           "başarısız" saymak yanlış olur (servis çalıştı, cevabı üretti); ok:true döner ve
           dürüst metin `value` ile feedback katmanına taşınır. Salt-okuma → rollback yok. */
        return ok(readout);
      } catch (e) {
        return fail(`konum okuma: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    /* ── PHONE HUB (FAIL-SOFT · native uç HENÜZ YOK) ─────────
       Repoda telefona komut iletecek RFCOMM komut kanalı YOKTUR (`PhoneHubLink`
       yalnız oturum/eşleştirme yönetir: startServer/confirmPairing/getSnapshot —
       call/sms/media komutu YOK). Bu yüzden burada SAHTE yürütme yazılmaz:
       handler dürüstçe `PHONE_NOT_CONNECTED` döner.

       ⚠️ Bu satırlar yürütme motorunun `no_handler` sonucunu DEĞİŞTİRMEZ, ona
       ANLAM katar: `no_handler` "Mavi bu eylemi tanımıyor" der; `PHONE_NOT_CONNECTED`
       "eylem tanımlı ama telefon bağlı değil" der — sürücüye söylenecek doğru cümle
       budur. Native uç geldiğinde YALNIZ bu üç gövde değişir. */
    'phone.media.play':  phoneNotConnected(deps, 'phone.media.play'),
    'phone.call.start':  phoneNotConnected(deps, 'phone.call.start'),
    'phone.sms.draft':   phoneNotConnected(deps, 'phone.sms.draft'),
  };
}

/** phone.* eylemleri için dürüst fail-soft handler üretir (sahte başarı YASAK). */
function phoneNotConnected(deps: PilotHandlerDeps, actionId: string): ActionHandler {
  return (): ActionExecResult => {
    let ready = false;
    // Port yoksa VEYA okuma patlarsa → bağlı DEĞİL (fail-closed).
    try { ready = deps.isPhoneLinkReady?.() === true; } catch { ready = false; }
    if (!ready) return fail(PHONE_NOT_CONNECTED);
    /* Telefon bağlı görünüyor AMA komut kanalı hâlâ YOK: "bağlandı" bilgisi tek başına
       aramayı/SMS'i YAPTIRMAZ. Sahte `ok:true` dönmek, yapılmamış bir aramayı yapılmış
       göstermek olurdu → yine dürüst reddedilir, gerekçe AYRIŞTIRILIR. */
    return fail(`${PHONE_TRANSPORT_MISSING} (${actionId})`);
  };
}

/** Telefon oturumu kurulmadı — sürücüye "Telefon bağlantısı henüz kurulmadı" denir. */
export const PHONE_NOT_CONNECTED = 'PHONE_NOT_CONNECTED';
/** Oturum var ama komut kanalı (RFCOMM call/sms/media) native tarafta HENÜZ YOK. */
export const PHONE_TRANSPORT_MISSING = 'PHONE_TRANSPORT_MISSING';

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
    // Gölgede GERÇEK konum OKUNMAZ (PII'ye dokunulmaz) ve uydurma koordinat üretilmez.
    'location.current.read': () => ({ ok: true, value: { ok: false, text: 'gölge' } }),
    /* phone.* GÖLGEDE DE `ok:true` DÖNMEZ: diğer eylemlerde gölge no-op'un `ok:true`
       dönmesi zararsızdır (gerçek işi eski hat yapar), ama telefonda ESKİ HAT DA YOKTUR.
       `ok:true` demek "arama yapıldı" demek olurdu → gölgede bile dürüst reddedilir. */
    'phone.media.play': () => ({ ok: false, error: PHONE_NOT_CONNECTED }),
    'phone.call.start': () => ({ ok: false, error: PHONE_NOT_CONNECTED }),
    'phone.sms.draft':  () => ({ ok: false, error: PHONE_NOT_CONNECTED }),
  };
}
