/**
 * PhoneConnectionTab — Telefon Merkezi · Bağlantı.
 *
 * ── COMPANION YOK (ürün kararı 2026-09-23) ──────────────────────────────────
 * Telefona ayrı bir uygulama kurdurulmaz; CarOS Companion/RFCOMM Phone Link
 * açılışta başlatılmaz (`SystemBoot.PHONE_LINK_COMPANION_ENABLED`). Telefon
 * bağlantısı iki GERÇEK, ölçülen eksenden oluşur:
 *
 *  1. Bluetooth telefonu — `CarLauncher.getBluetoothPhones()`: yalnız sınıfı
 *     PHONE olan eşleşmiş cihazlar. `getDeviceStatus.btConnected` HERHANGİ bir
 *     cihazı (ör. OBD adaptörü) saydığı için "telefon bağlı" kanıtı DEĞİLDİR.
 *     Bağlantı okunamazsa "bağlı" denmez. Bazı üniteler telefonu kendi
 *     Bluetooth modülüyle bağlar ve Android'e bildirmez — bu da açıkça yazılır.
 *  2. Bildirim erişimi — gelen arama/mesajın CarOS'a gelmesi, cevaplama ve
 *     hazır yanıt bu izne bağlıdır (`notificationService`).
 *
 * Bu ekran yeni bir otorite KURMAZ; ölçüm sonuçlarını gösterir.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { Bluetooth, BellRing, Settings, Smartphone } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';
import { useNotificationState } from '../../platform/notificationService';
import { NotificationAccessCard } from './NotificationAccessCard';

type PhonesResult = Awaited<ReturnType<NonNullable<typeof CarLauncher.getBluetoothPhones>>>;
/** `undefined` = okunuyor · `null` = ölçülemedi (eski sürüm / hata). */
type PhonesState = PhonesResult | null | undefined;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
      {children}
    </div>
  );
}

interface PhoneLine { title: string; detail: string | null; good: boolean }

/** Ölçümden kullanıcı cümlesi — bilinmeyen "bağlı" DENMEZ. SAF. */
export function describePhoneConnection(s: PhonesState): PhoneLine {
  if (s === undefined) return { title: 'Okunuyor…', detail: null, good: false };
  if (s === null) return { title: 'Telefon bağlantısı ölçülemedi', detail: 'Bu sürüm Bluetooth telefon durumunu okuyamıyor.', good: false };
  switch (s.state) {
    case 'NO_ADAPTER': return { title: 'Bu cihazda Bluetooth yok', detail: null, good: false };
    case 'NO_PERMISSION': return { title: 'Bluetooth izni yok', detail: 'CarOS\'a "Yakındaki cihazlar" izni verilmeli.', good: false };
    case 'OFF': return { title: 'Bluetooth kapalı', detail: 'Telefonu bağlamak için Bluetooth\'u açın.', good: false };
    default: break;
  }
  const phones = s.phones ?? [];
  const connected = phones.filter((p) => p.connected === true);
  if (connected.length > 0) {
    return { title: `Bağlı: ${connected.map((p) => p.name || 'Telefon').join(', ')}`, detail: null, good: true };
  }
  if (phones.some((p) => p.connected === undefined)) {
    return {
      title: `Eşleşmiş: ${phones.map((p) => p.name || 'Telefon').join(', ')}`,
      detail: 'Bağlantı durumu bu cihazda okunamıyor.',
      good: false,
    };
  }
  if (phones.length > 0) {
    return {
      title: 'Eşleşmiş telefon şu an bağlı değil',
      detail: phones.map((p) => p.name || 'Telefon').join(', '),
      good: false,
    };
  }
  return {
    title: 'Android\'de eşleşmiş telefon yok',
    detail: 'Bazı araç ünitelerinde telefon, ünitenin kendi Bluetooth uygulamasıyla bağlanır '
      + 've burada görünmez. Aramalar ve mesajlar yine de bildirim erişimiyle CarOS\'a gelir.',
    good: false,
  };
}

export const PhoneConnectionTab = memo(function PhoneConnectionTab() {
  const [phones, setPhones] = useState<PhonesState>(undefined);
  const { hasPermission, listenerConnected } = useNotificationState();

  const reload = useCallback(async () => {
    if (!isNative) { setPhones(null); return; }
    try {
      const res = await CarLauncher.getBluetoothPhones?.();
      setPhones(res && typeof res.state === 'string' ? res : null);
    } catch {
      setPhones(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    /* Bluetooth ayarlarından dönünce yeniden ölç — zamanlayıcı KURULMAZ. */
    const recheck = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [reload]);

  const openBtSettings = useCallback(() => {
    if (isNative) CarLauncher.launchApp({ action: 'android.settings.BLUETOOTH_SETTINGS' }).catch(() => undefined);
  }, []);

  const line = describePhoneConnection(phones);

  return (
    <div data-editable="phone.connection-tab" data-editable-type="panel" className="h-full flex flex-col overflow-y-auto no-scrollbar p-4 gap-4">

      {/* Bluetooth telefonu */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          Telefon (Bluetooth)
        </div>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: line.good ? 'var(--oem-good-soft, rgba(34,197,94,0.12))' : 'var(--oem-surface-0)', border: '1px solid var(--oem-line)' }}>
              {line.good
                ? <Smartphone className="w-5 h-5" style={{ color: 'var(--oem-good, #22c55e)' }} />
                : <Bluetooth className="w-5 h-5" style={{ color: 'var(--oem-ink-3)' }} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>{line.title}</div>
              {line.detail && (
                <div className="text-xs leading-relaxed mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>{line.detail}</div>
              )}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed mt-3" style={{ color: 'var(--oem-ink-3)' }}>
            Aramalar ve Bluetooth müzik telefonun bu üniteyle eşleşmesiyle çalışır;
            telefona ek uygulama kurmak gerekmez.
          </p>
          <div className="mt-3">
            <button
              onClick={openBtSettings}
              disabled={!isNative}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
              style={{ background: 'var(--oem-surface-0)', border: '1px solid var(--oem-line-strong)', color: 'var(--oem-ink)' }}
            >
              <Settings className="w-3.5 h-3.5" /> Bluetooth Ayarlarını Aç
            </button>
          </div>
        </Card>
      </div>

      {/* Bildirim erişimi — arama & mesaj */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          Arama ve Mesaj Bildirimleri
        </div>
        {hasPermission === true && listenerConnected !== false ? (
          <Card>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--oem-good-soft, rgba(34,197,94,0.12))', border: '1px solid var(--oem-line)' }}>
                <BellRing className="w-5 h-5" style={{ color: 'var(--oem-good, #22c55e)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Bildirim erişimi açık</div>
                <div className="text-xs leading-relaxed mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>
                  Gelen aramalar cevaplanabilir, mesajlar okunur ve hazır yanıtla yanıtlanabilir
                  (telefon uygulaması bu eylemleri sunuyorsa).
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <NotificationAccessCard hasPermission={hasPermission} listenerConnected={listenerConnected} />
        )}
      </div>
    </div>
  );
});
