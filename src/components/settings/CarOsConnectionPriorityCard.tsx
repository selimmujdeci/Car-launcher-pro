/**
 * CarOsConnectionPriorityCard — PHONE LINK F6.10 · "CarOS Bağlantı Önceliği" ayarı.
 *
 * ── YENİ SETTINGS FRAMEWORK YOK ─────────────────────────────────────────────
 * Kalıcılık kanonik ayar deposundadır (`useStore` → zustand `persist`,
 * `car-launcher-storage`); ikinci bir preferences sistemi KURULMADI. Görsel
 * dil mevcut ayar yüzeyinin kendi deseni (OEM CSS değişkenleri, kart +
 * `role="switch"` düğmesi).
 *
 * ── METİNLER i18n'DEN GELİR ─────────────────────────────────────────────────
 * Başlık, açıklama ve bilgi metni `src/i18n/config.ts` kaynaklarındadır
 * (TR + EN parity). JSX'te hard-coded kullanıcı metni YOKTUR; metinlerin
 * ANLAMI değiştirilmemiştir.
 *
 * ── AYAR NE YAPMAZ ──────────────────────────────────────────────────────────
 * Bu toggle CarOS'a kullanıcı kararını aşma yetkisi VERMEZ: Bluetooth, Wi-Fi
 * veya mobil bağlantıyı açmaz (bkz. `phoneLinkConnectivityIntent.ts` —
 * `mayPhoneLinkEnableConnectivity()` koşulsuz `false`). Varsayılan KAPALI.
 *
 * ── SAHİPLİK BU KOMPONENTTEN SÜRÜLMEZ (F6.1) ────────────────────────────────
 * Bu komponent YALNIZ kanonik ayarı yazar (`updateSettings`). Sahiplik
 * politikasının hem AÇILMA hem KAPANMA tarafı `phoneIntegrationOwnership.ts`
 * içindeki kanonik `useStore` aboneliği tarafından, PRODUCTION LIFECYCLE
 * olarak sürülür — component'in kendisi `applyPhoneIntegrationOwnership()`
 * veya `releasePhoneIntegrationOwnership()` ÇAĞIRMAZ. Böylece ayar; bu kart
 * dışındaki bir yoldan (LAB, sesli komut, senkronizasyon) değişse bile
 * sahiplik AYNI şekilde reconcile edilir.
 */

import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Info } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';

export const CarOsConnectionPriorityCard = memo(function CarOsConnectionPriorityCard() {
  const { t } = useTranslation();
  const { enabled, updateSettings } = useStore(
    useShallow((state) => ({
      enabled: state.settings.carosConnectionPriorityEnabled,
      updateSettings: state.updateSettings,
    })),
  );

  /* Sahiplik reconciliation'ı BURADA çağrılmaz — production lifecycle'ın
     kanonik ayar aboneliği (`phoneIntegrationOwnership.ts`) bunu üstlenir. */
  const handleToggle = useCallback(() => {
    updateSettings({ carosConnectionPriorityEnabled: !enabled });
  }, [enabled, updateSettings]);

  return (
    <div
      data-testid="caros-connection-priority"
      className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-0)] p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--oem-info-soft)]">
          <ShieldCheck className="h-5 w-5 text-[color:var(--oem-info)]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[color:var(--oem-ink)]">
            {t('phoneLink.connectionPriority.title')}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--oem-ink-2)]">
            {t('phoneLink.connectionPriority.description')}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('phoneLink.connectionPriority.title')}
          data-testid="caros-connection-priority-toggle"
          onClick={handleToggle}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            enabled
              ? 'border-[var(--oem-info)] bg-[var(--oem-info)]'
              : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)]'
          }`}
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white transition-all ${
              enabled ? 'left-[26px]' : 'left-[3px]'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-3 py-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--oem-ink-3)]" />
        <p className="text-[10px] leading-relaxed text-[color:var(--oem-ink-2)]">
          {t('phoneLink.connectionPriority.notice')}
        </p>
      </div>
    </div>
  );
});
