/**
 * maviCore/appSafeActions.ts — MAVİ 4.0 · DRIVE-2 · GÜVENLİ EKRAN-İÇİ UYGULAMA EYLEMLERİ.
 *
 * AMAÇ: MAVI4-DRIVE-1'in nav Action Registry'sini, ekran-içi GÜVENLİ kullanıcı eylemleriyle
 * (yenile / bildirim kapat / uyarı kapat / ayar bölümüne odaklan / değer kopyala) AYNI registry +
 * AYNI engine üzerinden genişletir. **Yeni dispatcher/router/state-manager/event-bus YOK.**
 *
 * KOD-TÜREVLİ (uydurma YOK): her eylem, kod tabanında ZATEN var olan güvenli bir platform giriş
 * noktasına DI ile bağlanır (errorBus.dismissToastByTitle · breakReminderService.dismissBreakAlert ·
 * geofenceService.dismissGeofenceAlert · addressNavigationEngine.dismissAddressNav ·
 * deviceApi.refreshDeviceStatusNow · settingsFocusBus.focusSettingsSection · clipboard.writeText).
 * KAPSAM DIŞI (çünkü ilgili güvenli/platform giriş noktası YOK ya da veri yazar): search/filter/
 * scroll/tab/pagination (yalnız bileşen-içi React state — platform bus'ı yok), dismiss.notification
 * (native `CarLauncher.dismissNotification` — veri yazar), share.report (dış veri çıkışı).
 *
 * GÜVENLİK (task kuralları): HİÇBİRİ araç/ECU'ya dokunmaz, kritik işlem değildir, kalıcı uygulama/
 * araç verisi YAZMAZ (yalnız in-memory UI durumu + read tazeleme + OS panosu). `vehicleScope`
 * TAŞIMAZ → AiSafetyGate araç kararına çağrılmaz; düşük risk → izinli; bilinmeyen → fail-closed.
 * Hepsi tek-yön (reversible=false): "kapat/yenile/kopyala" fiilleri deterministik tersine sahip
 * değildir → dürüstçe rollback taşımaz (uydurma geri-alma YOK).
 */

import {
  validateEmpty, makeRequiredStringValidator, makeEnumValidator,
  type ActionDefinition,
} from './actionRegistry';
import type { ActionHandler, ActionExecResult } from './executionEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Güvenli platform port'u (MEVCUT servisler DI ile bağlanır — saf/testable)
 * ════════════════════════════════════════════════════════════════════════ */

/** settingsFocusBus.SettingsSection ile hizalı (odaklanılabilir ayar bölümleri). */
export const SETTINGS_SECTIONS = Object.freeze(['gemini-qr', 'assistant', 'sound', 'appearance'] as const);

export interface SafeAppPort {
  /** deviceApi.refreshDeviceStatusNow — cihaz durumunu anında tazele (READ). */
  readonly refreshDeviceStatus: () => void;
  /** errorBus.dismissToastByTitle — başlığa göre toast/banner kapat (in-memory UI). */
  readonly dismissToast: (title: string) => void;
  /** breakReminderService.dismissBreakAlert — mola uyarısını kapat (in-memory UI). */
  readonly dismissBreakAlert: () => void;
  /** geofenceService.dismissGeofenceAlert — güvenli bölge uyarısını kapat (in-memory UI). */
  readonly dismissGeofenceAlert: () => void;
  /** addressNavigationEngine.dismissAddressNav — navigasyon önerisi kartını kapat (in-memory UI). */
  readonly dismissNavPrompt: () => void;
  /** settingsFocusBus.focusSettingsSection — ayar bölümüne odaklan (in-memory UI). */
  readonly focusSettingsSection: (section: string) => void;
  /** clipboard.writeText — değeri OS panosuna kopyala (kullanıcı eylemi; uygulama/araç verisi YAZMAZ). */
  readonly copyValue: (value: string) => void | Promise<void>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem kimlikleri (kararlı)
 * ════════════════════════════════════════════════════════════════════════ */

export const SAFE_ACTION_REFRESH_DEVICE = 'refresh.device';
export const SAFE_ACTION_DISMISS_TOAST = 'dismiss.toast';
export const SAFE_ACTION_DISMISS_BREAK = 'dismiss.break_alert';
export const SAFE_ACTION_DISMISS_GEOFENCE = 'dismiss.geofence_alert';
export const SAFE_ACTION_DISMISS_NAV_PROMPT = 'dismiss.nav_prompt';
export const SAFE_ACTION_FOCUS_SETTINGS = 'focus.settings_section';
export const SAFE_ACTION_COPY_VALUE = 'copy.value';

/* ══════════════════════════════════════════════════════════════════════════
 * Tanımlar (SAF metadata — typed input/output; hiçbiri araç kapsamı taşımaz)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Güvenli uygulama eylemi tanımları. Hepsi düşük risk · tek-yön (reversible=false) · UI/read.
 * `copy.value` typed OUTPUT taşır (resultContract:'value' → kopyalanan uzunluk); gerisi 'ack'.
 */
export function buildSafeAppActionDefinitions(): ActionDefinition[] {
  return [
    {
      id: SAFE_ACTION_REFRESH_DEVICE, title: 'Cihaz durumunu yenile', risk: 'low', reversible: false,
      timeoutMs: 3_000, resultContract: 'ack', validate: validateEmpty,
    },
    {
      id: SAFE_ACTION_DISMISS_TOAST, title: 'Bildirimi kapat', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', validate: makeRequiredStringValidator('title'),
    },
    {
      id: SAFE_ACTION_DISMISS_BREAK, title: 'Mola uyarısını kapat', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
    },
    {
      id: SAFE_ACTION_DISMISS_GEOFENCE, title: 'Güvenli bölge uyarısını kapat', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
    },
    {
      id: SAFE_ACTION_DISMISS_NAV_PROMPT, title: 'Navigasyon kartını kapat', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', validate: validateEmpty,
    },
    {
      id: SAFE_ACTION_FOCUS_SETTINGS, title: 'Ayar bölümüne odaklan', risk: 'low', reversible: false,
      timeoutMs: 2_000, resultContract: 'ack', validate: makeEnumValidator('section', SETTINGS_SECTIONS),
    },
    {
      id: SAFE_ACTION_COPY_VALUE, title: 'Değeri kopyala', risk: 'low', reversible: false,
      timeoutMs: 4_000, resultContract: 'value', validate: makeRequiredStringValidator('value'),
    },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Handler'lar (MEVCUT servislere bağlar — yeni davranış YOK; fail-soft)
 * ════════════════════════════════════════════════════════════════════════ */

function ok(value?: unknown): ActionExecResult {
  return value === undefined ? { ok: true } : { ok: true, value };
}
function fail(error: string): ActionExecResult {
  return { ok: false, error };
}

/** Senkron servis çağrısını güvenli sarar (throw → ok:false; yapılmış gibi cevap verme). */
function guardSync(fn: () => void, label: string): ActionExecResult {
  try { fn(); return ok(); }
  catch (e) { return fail(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
}

/**
 * Güvenli uygulama actionId → gerçek handler. Payload'lar zaten registry.validate'ten geçmiştir;
 * handler yine savunmacı okur. Hepsi fail-soft (servis throw → ok:false).
 */
export function createSafeAppHandlers(port: SafeAppPort): Record<string, ActionHandler> {
  return {
    [SAFE_ACTION_REFRESH_DEVICE]: (): ActionExecResult => guardSync(() => port.refreshDeviceStatus(), 'yenile'),

    [SAFE_ACTION_DISMISS_TOAST]: (payload): ActionExecResult => {
      const title = (payload as { title?: string }).title;
      if (typeof title !== 'string' || title.length === 0) return fail('başlık yok');
      return guardSync(() => port.dismissToast(title), 'bildirim');
    },

    [SAFE_ACTION_DISMISS_BREAK]: (): ActionExecResult => guardSync(() => port.dismissBreakAlert(), 'mola'),
    [SAFE_ACTION_DISMISS_GEOFENCE]: (): ActionExecResult => guardSync(() => port.dismissGeofenceAlert(), 'bölge'),
    [SAFE_ACTION_DISMISS_NAV_PROMPT]: (): ActionExecResult => guardSync(() => port.dismissNavPrompt(), 'navigasyon kartı'),

    [SAFE_ACTION_FOCUS_SETTINGS]: (payload): ActionExecResult => {
      const section = (payload as { section?: string }).section;
      if (typeof section !== 'string' || !(SETTINGS_SECTIONS as readonly string[]).includes(section)) {
        return fail('geçersiz bölüm');
      }
      return guardSync(() => port.focusSettingsSection(section), 'ayar bölümü');
    },

    [SAFE_ACTION_COPY_VALUE]: async (payload, signal): Promise<ActionExecResult> => {
      const value = (payload as { value?: string }).value;
      if (typeof value !== 'string' || value.length === 0) return fail('kopyalanacak değer yok');
      try {
        await port.copyValue(value);
        if (signal.aborted) return fail('kopyalama iptal edildi');
        // typed OUTPUT: yalnız uzunluk (ham değer/PII taşınmaz).
        return ok({ length: value.length });
      } catch (e) {
        return fail(`kopyala: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
