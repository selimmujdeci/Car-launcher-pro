/**
 * Telefonun internetini Bluetooth ile kullan — Evet/Hayır.
 *
 * Tercih ve durum NATIVE'de (tek sahip: PhoneBtInternet). Açıkken telefon Bluetooth
 * ile her bağlandığında ünite telefonun internetine bağlanmayı ister. Telefonda
 * "Bluetooth ile internet paylaşımı" açık olmalıdır — bunu uygulama açamaz.
 * Durum ölçülür; ölçülemeyen "bağlı" DENMEZ.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { CarLauncher, type PhoneInternetAttempt, type PhoneInternetState } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';

/** Ölçüm/istek sonucundan kullanıcı cümlesi. SAF. */
export function describePhoneInternet(state: PhoneInternetState | null, attempt: PhoneInternetAttempt | null): string {
  if (state === 'CONNECTED') return 'Telefonun interneti kullanılıyor.';
  if (state === 'CONNECTING') return 'Telefona bağlanılıyor…';
  if (attempt === 'NO_PHONE') return 'Android\'de eşleşmiş telefon yok — telefonu bu ünitenin Bluetooth\'uyla eşleştirin.';
  if (attempt === 'OFF') return 'Bluetooth kapalı.';
  if (attempt === 'NO_PERMISSION' || state === 'NO_PERMISSION') return 'Bluetooth izni yok — Telefon → Bağlantı ekranından izin verin.';
  if (state === 'UNSUPPORTED' || attempt === 'UNSUPPORTED') return 'Bu ünite Bluetooth ile internete izin vermiyor — telefonun Wi-Fi hotspot\'unu kullanın.';
  if (attempt === 'STARTED') return 'Bağlantı istendi. Olmazsa telefonda "Bluetooth ile internet paylaşımı" açık mı bakın.';
  return 'Şu an bağlı değil. Telefon bağlandığında otomatik denenir.';
}

export const PhoneInternetToggle = memo(function PhoneInternetToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [state, setState] = useState<PhoneInternetState | null>(null);
  const [attempt, setAttempt] = useState<PhoneInternetAttempt | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await CarLauncher.getPhoneInternet?.();
      if (r) { setEnabled(r.enabled); setState(r.state); } else { setEnabled(false); setState('UNSUPPORTED'); }
    } catch { setEnabled(false); setState('UNSUPPORTED'); }
  }, []);

  useEffect(() => { if (isNative) void reload(); }, [reload]);

  const choose = useCallback(async (on: boolean) => {
    setEnabled(on); setAttempt(null);
    try {
      const r = await CarLauncher.setPhoneInternet?.({ enabled: on });
      setAttempt(r?.attempt ?? (r ? null : 'UNSUPPORTED'));
    } catch { setAttempt('UNSUPPORTED'); }
    void reload();
    if (on) window.setTimeout(() => { void reload(); }, 6000);
  }, [reload]);

  if (!isNative) return null;

  const btn = (on: boolean, label: string) => {
    const active = enabled === on;
    return (
      <button
        onClick={() => { void choose(on); }}
        className="flex-1 py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform"
        style={{
          background: active ? 'var(--oem-accent)' : 'var(--oem-surface-0)',
          color: active ? 'var(--oem-accent-ink, #fff)' : 'var(--oem-ink)',
          border: `1px solid ${active ? 'transparent' : 'var(--oem-line-strong)'}`,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mb-4">
      <p className="text-sm font-bold mb-2" style={{ color: 'var(--oem-ink)' }}>
        Telefon Bluetooth ile bağlanınca internetini kullansın mı?
      </p>
      <div className="flex gap-2">
        {btn(true, 'Evet')}
        {btn(false, 'Hayır')}
      </div>
      {enabled && (
        <p className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--oem-ink-3)' }}>
          {describePhoneInternet(state, attempt)}
          <br />
          Telefonda bir kez: Ayarlar → Kişisel erişim noktası → <b>Bluetooth ile internet paylaşımı</b> açık olmalı.
        </p>
      )}
    </div>
  );
});
