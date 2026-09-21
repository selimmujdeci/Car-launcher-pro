/**
 * PhoneConnectionTab — Telefon Merkezi · Bağlantı.
 *
 * İki AYRI, GERÇEK bağlantı ekseni gösterilir — birbirine KARIŞTIRILMAZ:
 *
 *  1. Ses profili (Bluetooth A2DP/HFP) — bu cihazın kendi Bluetooth adaptörü
 *     üzerinden hangi hoparlör/hands-free ile eşleştiğini SALT OKUNUR olarak
 *     gösterir (`CarLauncher.getDeviceStatus()`). Uygulamanın bu profil
 *     üzerinde KONTROL OTORİTESİ YOKTUR (bkz. `PhoneHubHardwareProbe` —
 *     "A2DP Sink/HFP yığınını yöneten kod yok"); yalnız durum okunur.
 *
 *  2. CarOS Companion bağlantısı (Phone Link F1-F9) — AYRI, opsiyonel bir
 *     uygulama-seviyesi RFCOMM kanalı (nav hedefi, Mavi köprüsü, internet
 *     paylaşımı için). Kanonik otorite `phoneHubLink.ts`tir; bu ekran YENİ
 *     bir otorite KURMAZ, yalnız var olan tüketici projeksiyonunu
 *     (`phoneHubUserModel.buildPhoneHubUserView`) okur ve var olan eylem
 *     fonksiyonlarını (`confirmPhoneHubPairing`, `disconnectPhoneHubSession`,
 *     `forgetTrustedPhone`) çağırır.
 *
 * Rehber/arama (Kişiler, Aramalar sekmeleri) BU cihazın KENDİ
 * ContactsContract/telefoni API'sinden gelir — yukarıdaki hiçbir bağlantıya
 * bağımlı DEĞİLDİR (Companion kurulu olmasa da rehber/arama çalışır).
 */
import { memo, useCallback, useEffect, useState } from 'react';
import {
  Bluetooth, Link2, Unlink, Trash2, KeyRound, Check, X, Settings, ShieldCheck,
} from 'lucide-react';
import { CarLauncher, type NativeDeviceStatus } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';
import {
  getPhoneHubLink, refreshPhoneHubLink, subscribePhoneHubLinkState,
  confirmPhoneHubPairing, getPhoneHubPairingCode, disconnectPhoneHubSession, forgetTrustedPhone,
} from '../../platform/phoneHub/phoneHubLink';
import {
  buildPhoneHubUserView, evaluatePairingGate, classifyMotion, PAIRING_GATE_MESSAGE,
  type PhoneHubUserView,
} from '../../platform/phoneHub/phoneHubUserModel';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
      {children}
    </div>
  );
}

function ActionBtn({ label, icon: Icon, onClick, disabled, tone = 'default' }: {
  label: string; icon: typeof Link2; onClick: () => void; disabled?: boolean;
  tone?: 'default' | 'danger' | 'good';
}) {
  const colors = tone === 'danger'
    ? { bg: 'var(--oem-danger-soft, rgba(239,68,68,0.12))', border: 'var(--oem-danger, #ef4444)', text: 'var(--oem-danger, #ef4444)' }
    : tone === 'good'
      ? { bg: 'var(--oem-good, #22c55e)', border: 'var(--oem-good, #22c55e)', text: '#0B0F14' }
      : { bg: 'var(--oem-surface-0)', border: 'var(--oem-line-strong)', text: 'var(--oem-ink)' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

export const PhoneConnectionTab = memo(function PhoneConnectionTab() {
  const [view, setView] = useState<PhoneHubUserView>(() => buildPhoneHubUserView(getPhoneHubLink()));
  const [btStatus, setBtStatus] = useState<NativeDeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const speedKmh = useUnifiedVehicleStore((s) => s.speed);
  const motion = classifyMotion(speedKmh ?? null);
  const gate = evaluatePairingGate(motion);

  const reload = useCallback(async () => {
    await refreshPhoneHubLink();
    setView(buildPhoneHubUserView(getPhoneHubLink()));
  }, []);

  useEffect(() => {
    let mounted = true;
    void reload();
    if (isNative) {
      CarLauncher.getDeviceStatus().then((s) => { if (mounted) setBtStatus(s); }).catch(() => undefined);
    }
    // Native `linkState` olayı gerçekten yayınlanıyor (product boot'ta
    // `initPhoneHubLinkStateBridge()` ile bağlı) — her olayda tam anlık
    // görüntü tazelenir; ikinci bir zamanlayıcı KURULMAZ.
    const unsub = subscribePhoneHubLinkState(() => { void reload(); });
    return () => { mounted = false; unsub(); setPairingCode(null); };
  }, [reload]);

  const revealCode = useCallback(async () => {
    setBusy(true);
    try {
      const code = await getPhoneHubPairingCode();
      setPairingCode(code);
      if (code === null) { setNotice('Kod yok — onay penceresi kapanmış olabilir.'); await reload(); }
    } finally { setBusy(false); }
  }, [reload]);

  const decide = useCallback(async (accepted: boolean) => {
    setPairingCode(null);
    setBusy(true);
    try {
      const result = await confirmPhoneHubPairing(accepted);
      setNotice(result.ok
        ? (accepted ? 'Eşleştirme onaylandı' : 'Eşleştirme reddedildi')
        : `İşlem başarısız${result.userMessage ? ` — ${result.userMessage}` : ''}`);
      await reload();
    } finally { setBusy(false); }
  }, [reload]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    try {
      const result = await disconnectPhoneHubSession();
      setNotice(result.ok ? 'Bağlantı kesildi' : 'Bağlantı kesilemedi');
      await reload();
    } finally { setBusy(false); }
  }, [reload]);

  const forget = useCallback(async () => {
    setBusy(true);
    try {
      const result = await forgetTrustedPhone();
      setNotice(result.ok ? 'Cihaz unutuldu' : 'Cihaz unutulamadı');
      await reload();
    } finally { setBusy(false); }
  }, [reload]);

  const openBtSettings = useCallback(() => {
    if (isNative) CarLauncher.launchApp({ action: 'android.settings.BLUETOOTH_SETTINGS' }).catch(() => undefined);
  }, []);

  return (
    <div data-editable="phone.connection-tab" data-editable-type="panel" className="h-full flex flex-col overflow-y-auto no-scrollbar p-4 gap-4">

      {/* Ses profili — salt okunur */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          Ses Profili (Bluetooth)
        </div>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: btStatus?.btConnected ? 'var(--oem-good-soft, rgba(34,197,94,0.12))' : 'var(--oem-surface-0)', border: '1px solid var(--oem-line)' }}>
              <Bluetooth className="w-5 h-5" style={{ color: btStatus?.btConnected ? 'var(--oem-good, #22c55e)' : 'var(--oem-ink-3)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>
                {!isNative ? 'Yalnız native cihazda ölçülür' : btStatus === null ? 'Okunuyor…' : btStatus.btConnected ? 'Bağlı' : 'Bağlı değil'}
              </div>
              {btStatus?.btConnected && btStatus.btDevice && (
                <div className="text-xs truncate" style={{ color: 'var(--oem-ink-3)' }}>{btStatus.btDevice}</div>
              )}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed mt-3" style={{ color: 'var(--oem-ink-3)' }}>
            Bu, yalnız ses (hoparlör/hands-free) eşleşmesidir — rehber/arama bu cihazın
            kendi verisinden gelir, bu bağlantıya bağımlı değildir.
          </p>
          <div className="mt-3">
            <ActionBtn label="Sistem Bluetooth Ayarlarını Aç" icon={Settings} onClick={openBtSettings} disabled={!isNative} />
          </div>
        </Card>
      </div>

      {/* CarOS Companion (Phone Link F1-F9) */}
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>
          CarOS Companion Bağlantısı (opsiyonel)
        </div>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: view.state === 'CONNECTED' ? 'var(--oem-good-soft, rgba(34,197,94,0.12))' : 'var(--oem-surface-0)', border: '1px solid var(--oem-line)' }}>
              {view.trust === 'TRUSTED'
                ? <ShieldCheck className="w-5 h-5" style={{ color: 'var(--oem-good, #22c55e)' }} />
                : <Link2 className="w-5 h-5" style={{ color: 'var(--oem-ink-3)' }} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>{view.stateLabel}</div>
              <div className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>{view.trustLabel}</div>
            </div>
          </div>

          {/* Eşleştirme onayı */}
          {view.awaitingCodeConfirmation && (
            <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn)' }}>
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--oem-warn, #f59e0b)' }}>
                {PAIRING_GATE_MESSAGE[gate]}
              </div>
              {gate !== 'BLOCKED_MOVING' && (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="rounded-lg px-3 py-1.5 font-mono text-sm tracking-[0.3em]"
                      style={{ background: 'var(--oem-surface-0)', border: '1px solid var(--oem-line-strong)', color: 'var(--oem-ink)' }}>
                      {pairingCode ?? '••••••'}
                    </span>
                    <ActionBtn label="Kodu Göster" icon={KeyRound} onClick={() => void revealCode()} disabled={busy} />
                  </div>
                  <div className="flex gap-2">
                    <ActionBtn label="Onayla" icon={Check} tone="good" onClick={() => void decide(true)} disabled={busy || pairingCode === null} />
                    <ActionBtn label="Reddet" icon={X} tone="danger" onClick={() => void decide(false)} disabled={busy} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Bağlı cihaz yönetimi */}
          {(view.canDisconnect || view.canForgetTrustedPhone) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {view.canDisconnect && (
                <ActionBtn label="Bağlantıyı Kes" icon={Unlink} onClick={() => void disconnect()} disabled={busy} />
              )}
              {view.canForgetTrustedPhone && (
                <ActionBtn label="Cihazı Unut" icon={Trash2} tone="danger" onClick={() => void forget()} disabled={busy} />
              )}
            </div>
          )}

          {!view.present && (
            <p className="text-[11px] leading-relaxed mt-3" style={{ color: 'var(--oem-ink-3)' }}>
              Companion, navigasyon hedefi gönderme, Mavi'ye telefon üzerinden sorma ve
              internet paylaşımı gibi ek özellikler için opsiyoneldir — telefonun CarOS
              Companion uygulamasını kurup eşleştirmesi gerekir. Rehber ve arama için
              GEREKMEZ.
            </p>
          )}
        </Card>
      </div>

      {notice && (
        <div className="text-xs px-3 py-2 rounded-xl" style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }}>
          {notice}
        </div>
      )}
    </div>
  );
});
