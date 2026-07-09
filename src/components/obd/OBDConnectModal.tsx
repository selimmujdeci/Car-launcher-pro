/**
 * OBDConnectModal — Uygulama içi OBD cihaz tarama ve bağlantı.
 *
 * Android sistem BT ayarlarına girmeden doğrudan uygulama içinden
 * yakındaki Bluetooth cihazlarını tarar, listeler, seçilen cihaza bağlanır.
 * Pair gerektirmez — insecure RFCOMM ile direkt bağlantı dener.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bluetooth, BluetoothSearching, Wifi, X, CheckCircle, AlertCircle, Loader2, RefreshCw, Settings, KeyRound, Trash2, Stethoscope, ChevronDown } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { startOBD, stopOBD, useOBDConnectionState, useOBDState } from '../../platform/obdService';
import { looksLikeObd } from '../../platform/obdDiscovery';
import { saveObdAddress, saveObdTransport, isValidTcpAddress } from '../../platform/obdStorage';
import { OBDDiagnosticTimeline } from './OBDDiagnosticTimeline';
import { startSession, setSessionDevice, endSession, recordDiag } from '../../platform/obdDiagnosticRecorder';

type DeviceSource = 'live' | 'bonded' | 'cached';

interface DiscoveredDevice {
  name:    string;
  address: string;
  bonded:  boolean;
  // Opsiyonel taşıma katmanı — native taraf "classic" veya "ble" gönderir.
  // Eski Classic akışı transport olmadan da çalışır (geriye dönük uyumlu).
  transport?: 'classic' | 'ble';
  // Cihazın listeye geliş kaynağı:
  //  • live   → canlı taramada (ACTION_FOUND / BLE advertise) GERÇEKTEN menzilde.
  //  • bonded → yalnızca getBondedDevices() dökümü; menzilde OLMAYABİLİR.
  //  • cached → kalıcı kayıt (şu an kullanılmıyor; ileride direct-reconnect için).
  // Native eski sürümü 'source' göndermezse: bonded=true→'bonded', değilse 'live'.
  source:  DeviceSource;
}

/** Native event payload'ından güvenli kaynak türetimi (geriye dönük uyumlu). */
function resolveSource(raw: unknown, bonded: boolean): DeviceSource {
  if (raw === 'live' || raw === 'bonded' || raw === 'cached') return raw;
  return bonded ? 'bonded' : 'live';
}

interface Props {
  open:    boolean;
  onClose: () => void;
}

export function OBDConnectModal({ open, onClose }: Props) {
  const [devices,     setDevices]     = useState<DiscoveredDevice[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [connecting,  setConnecting]  = useState<string | null>(null);
  const [connected,   setConnected]   = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [pinTarget,   setPinTarget]   = useState<DiscoveredDevice | null>(null);
  const [pinValue,    setPinValue]    = useState('');
  const [showAll,     setShowAll]     = useState(false);
  const [showDiag,    setShowDiag]    = useState(false);   // teşhis timeline — varsayılan KAPALI
  // Patch 10: WiFi ELM327 (AP modu) manuel adres girişi — K24 gibi standart BT'si
  // OEM tarafından kilitli head unit'lerde OBD'ye ulaşmanın TEK yolu.
  const [wifiAddress, setWifiAddress] = useState('');
  const [wifiError,   setWifiError]   = useState<string | null>(null);

  // Teşhis: bu oturumda "cihaz bulundu" event'i kaydedilen adres → kaynak eşlemesi.
  // (Yalnız spam önleme değil; 'bonded' kaydedilmiş bir adres sonradan canlı gelirse
  //  bir kez daha 'live' milestone'u yazmak için kaynağı da tutar.)
  const diagSeenRef = useRef<Map<string, DeviceSource>>(new Map());

  const obdConnectionState = useOBDConnectionState();
  const obdState = useOBDState();
  const obdStateRef = useRef(obdState);
  obdStateRef.current = obdState;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Tüm discovery listener handle'larını temizlemek için ref
  const discoveryHandleRef = useRef<{ remove: () => void } | null>(null);
  const discoveryFinishedRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!connecting) return;
    if (obdConnectionState === 'connected') {
      setConnected(connecting);
      setConnecting(null);
      endSession('connected');     // teşhis oturumunu kalıcı yaz
      const t = setTimeout(() => onCloseRef.current(), 1500);
      return () => clearTimeout(t);
    }
    if (obdConnectionState === 'error') {
      const failedDev = devices.find((d) => d.address === connecting) ?? null;
      setConnecting(null);
      setError(null);
      setPinTarget(failedDev);
      setPinValue('');
      endSession('failed');        // teşhis oturumunu kalıcı yaz
    }
  }, [obdConnectionState, connecting]);

  useEffect(() => {
    if (!connecting) return;
    // OBD servisi önce bir transport'u (≤30s), başarısızsa diğerini (≤30s) dener
    // (classic↔BLE otomatik fallback). UI zaman aşımı bunların İKİSİNE birden
    // yetmeli; aksi halde BLE adaptör klasik denenirken UI erken "bağlanamadı" derdi.
    const t = setTimeout(() => {
      setConnecting(null);
      recordDiag({ stage: 'disconnect', status: 'fail', userMessage: 'Bağlantı zaman aşımına uğradı.', technicalMessage: 'UI 75s timeout' });
      endSession('failed');
      setError('Bağlantı zaman aşımına uğradı. Adaptörün açık, takılı ve yakında olduğundan emin olun.');
    }, 75_000);
    return () => clearTimeout(t);
  }, [connecting]);

  const stopDiscovery = useCallback(() => {
    discoveryHandleRef.current?.remove();
    discoveryHandleRef.current = null;
    discoveryFinishedRef.current?.remove();
    discoveryFinishedRef.current = null;
    if (Capacitor.isNativePlatform()) {
      CarLauncher.stopOBDDiscovery().catch(() => {});
    }
  }, []);

  const startScan = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      // Native değil (tarayıcı/dev): gerçek Bluetooth taraması yok.
      // Sahte/demo cihaz GÖSTERİLMEZ — yalnızca gerçek cihazlar listelenir.
      setDevices([]);
      setScanning(false);
      return;
    }

    setDevices([]);
    setError(null);
    setConnecting(null);
    setPinTarget(null);
    setPinValue('');
    setShowAll(false);
    setScanning(true);
    stopDiscovery();

    // Teşhis: yeni oturum + tarama başladı milestone'u (pasif gözlemci).
    startSession();
    diagSeenRef.current.clear();
    recordDiag({ stage: 'scan', status: 'pending', userMessage: 'Cihaz taraması başladı.' });

    try {
      await CarLauncher.requestAndroid13Permissions();
      recordDiag({ stage: 'permission', status: 'success', userMessage: 'Bluetooth/konum izni verildi.' });
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (/denied|permission|bluetooth/i.test(msg)) {
        // Bluetooth kapalı mı yoksa izin mi reddedildi — mevcut hata mesajından türet.
        if (/bluetooth.*(off|kapal|disable)|disable.*bluetooth/i.test(msg)) {
          recordDiag({ stage: 'bluetooth', status: 'fail', reason: 'BT_OFF', technicalMessage: msg });
        } else {
          recordDiag({ stage: 'permission', status: 'fail', reason: 'NO_PERMISSION', technicalMessage: msg });
        }
        endSession('failed');
        setError('Bluetooth izni reddedildi. Ayarlar > Uygulama İzinleri bölümünden Yakındaki Cihazlar iznini verin.');
        setScanning(false);
        return;
      }
    }

    // obdDeviceFound — her bulunan cihazda tetiklenir (canlı tarama + bonded döküm)
    const handle = await CarLauncher.addListener('obdDeviceFound', (data) => {
      // Kaynak: native 'source' alanı; eski sürüm göndermezse bonded'dan türet.
      const src = resolveSource((data as { source?: unknown }).source, !!data.bonded);

      // Teşhis (setDevices güncelleyicisinin DIŞINDA — yan etkisiz reducer):
      // adres ilk kez geldiğinde, VEYA 'bonded' kaydedilmiş bir adres sonradan
      // CANLI gelince bir kez daha 'live' milestone'u yaz.
      const prevSrc = diagSeenRef.current.get(data.address);
      if (prevSrc === undefined || (src === 'live' && prevSrc !== 'live')) {
        diagSeenRef.current.set(data.address, src === 'live' ? 'live' : (prevSrc ?? src));
        recordDiag({
          stage: 'deviceFound', status: 'info',
          transport: data.transport === 'ble' ? 'ble' : data.transport === 'classic' ? 'classic' : 'unknown',
          userMessage: src === 'live'
            ? `OBD cihazı canlı bulundu: ${data.name || data.address}`
            : `Daha önce eşleşmiş OBD cihazı listelendi: ${data.name || data.address}`,
          technicalMessage: `${data.address} source=${src} bonded=${data.bonded}`,
        });
      }

      setDevices((prev) => {
        const existing = prev.find((d) => d.address === data.address);
        if (existing) {
          // Aynı adres İKİ taramadan da gelebilir: eşli (bonded → transport='classic')
          // ve BLE taraması (transport='ble'). V-LINK / vLinker gibi BLE adaptörler eşli
          // listede 'classic' görünür ama GERÇEKTE GATT ile bağlanır. Bilgileri BİRLEŞTİR:
          // BLE tespit edildiyse transport'u 'ble'ye yükselt (yoksa önce klasik RFCOMM
          // denenip takılır, BLE'ye düşene kadar zaman aşımına uğranır → "bağlanamadı").
          const mergedTransport: 'classic' | 'ble' | undefined =
            existing.transport === 'ble' || data.transport === 'ble'
              ? 'ble'
              : (existing.transport ?? data.transport);
          const mergedBonded = existing.bonded || data.bonded;
          // İsim: MAC olmayan (gerçek) ismi koru.
          const mergedName =
            existing.name && existing.name !== existing.address ? existing.name : data.name;
          // Kaynak: CANLI her zaman kazanır (bir kez canlı görülen cihaz canlıdır).
          const mergedSource: DeviceSource =
            existing.source === 'live' || src === 'live' ? 'live' : existing.source;
          if (
            mergedTransport === existing.transport &&
            mergedBonded === existing.bonded &&
            mergedName === existing.name &&
            mergedSource === existing.source
          ) {
            return prev;
          }
          return prev.map((d) =>
            d.address === data.address
              ? { ...d, name: mergedName, bonded: mergedBonded, transport: mergedTransport, source: mergedSource }
              : d,
          );
        }
        return [...prev, { name: data.name, address: data.address, bonded: data.bonded, transport: data.transport, source: src }];
      });
    });
    discoveryHandleRef.current = handle;

    // obdDiscoveryFinished — aktif tarama tamamlandı
    const finHandle = await CarLauncher.addListener('obdDiscoveryFinished', () => {
      setScanning(false);
    });
    discoveryFinishedRef.current = finHandle;

    try {
      await CarLauncher.startOBDDiscovery();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // BT kapalıysa: taramaya basınca Bluetooth'u otomatik aç, kısa bekle, bir kez daha dene.
      // (ELM327 klasik BT adaptörü BT kapalıyken hiç bağlanamaz — kullanıcı isteği.)
      const btOff = /BT_DISABLED|Bluetooth kapal/i.test(msg);
      if (btOff && CarLauncher.setBluetooth) {
        try {
          await CarLauncher.setBluetooth({ enabled: true });
          // BT donanımının açılıp hazır olması için kısa bekleme (enable() asenkron).
          await new Promise<void>((r) => setTimeout(r, 2500));
          await CarLauncher.startOBDDiscovery();
        } catch (e2) {
          setError((e2 as Error).message ?? 'Bluetooth açılamadı — ayarlardan elle açın');
          setScanning(false);
          stopDiscovery();
        }
      } else {
        setError(msg || 'Tarama başlatılamadı');
        setScanning(false);
        stopDiscovery();
      }
    }

    // 30 saniye sonra taramayı otomatik durdur
    setTimeout(() => setScanning(false), 30_000);
  }, [stopDiscovery]);

  useEffect(() => {
    if (open) {
      void startScan();
      const svc = obdStateRef.current;
      if (svc.connectionState === 'connected' && svc.deviceName) {
        setConnected(svc.deviceName);
      }
    } else {
      stopDiscovery();
      setDevices([]);
      setScanning(false);
      setConnecting(null);
      setConnected(null);
      setError(null);
      setPinTarget(null);
      setPinValue('');
      setShowAll(false);
    }
  }, [open, startScan, stopDiscovery]);

  const handleConnect = (dev: DiscoveredDevice, pin?: string) => {
    setConnecting(dev.address);
    setError(null);
    setPinTarget(null);

    // Teşhis (pasif): seçim + bond durumu + bağlantı başlatıldı (transport ile).
    const tr = dev.transport === 'ble' ? 'ble' : dev.transport === 'classic' ? 'classic' : 'unknown';
    setSessionDevice({ name: dev.name, address: dev.address, transport: tr });
    recordDiag({ stage: 'select', status: 'info', transport: tr, userMessage: `Cihaz seçildi: ${dev.name || dev.address}` });
    recordDiag({ stage: 'bond', status: 'info', userMessage: dev.bonded ? 'Cihaz eşli (bonded).' : 'Cihaz eşli değil — direkt bağlantı denenecek.' });
    recordDiag({
      stage: tr === 'ble' ? 'connectBle' : 'connectClassic', status: 'pending', transport: tr,
      userMessage: 'Cihaza bağlanılıyor…',
    });

    stopOBD();
    startOBD(dev.address, pin, dev.transport);
  };

  /**
   * Patch 10 — WiFi ELM327 (AP modu) manuel bağlantı. BLE/classic tarama seçimi bir
   * TAHMİNdir (dual-mod adaptör 'classic' raporlayabilir); burada ise kullanıcı adresi
   * ELLE ve AÇIKÇA giriyor — belirsizlik yok. Bu yüzden BT tarama akışının aksine adres +
   * transport BURADA hemen kalıcılaştırılır (startOBD zaten adresi kaydeder; transport'u
   * yalnız BAŞARILI bağlantı sonrası kaydeder — TCP'de "doğrulanmamış tahmin" kavramı
   * anlamsız, kullanıcı seçimi zaten kesin).
   */
  const handleConnectWifi = () => {
    const addr = wifiAddress.trim();
    if (!isValidTcpAddress(addr)) {
      setWifiError('Geçersiz adres — "ip:port" biçiminde girin (ör. 192.168.0.10:35000).');
      return;
    }
    setWifiError(null);
    setConnecting(addr);
    setError(null);
    setPinTarget(null);

    setSessionDevice({ name: 'WiFi ELM327', address: addr, transport: 'tcp' });
    recordDiag({ stage: 'select', status: 'info', transport: 'tcp', userMessage: `WiFi adaptör seçildi: ${addr}` });
    recordDiag({ stage: 'connectClassic', status: 'pending', transport: 'tcp', userMessage: 'WiFi (TCP) adaptörüne bağlanılıyor…' });

    saveObdAddress(addr);
    saveObdTransport('tcp');

    stopOBD();
    startOBD(addr, undefined, 'tcp');
  };

  // Eski/erişilemez "Eşli" cihazı kaldır (unpair) → listeden çıkar.
  // removeBond (gizli API) bazı Android sürümlerinde ENGELLİDİR → o zaman
  // başarısız olur ve cihaz Android'de eşli kalmaya devam eder. Bu durumda
  // kullanıcıyı Android BT Ayarları'na yönlendir (tek kesin kaldırma yolu).
  const handleForget = async (dev: DiscoveredDevice) => {
    if (!Capacitor.isNativePlatform()) {
      setDevices((prev) => prev.filter((d) => d.address !== dev.address));
      return;
    }
    let removed = false;
    try {
      const res = await CarLauncher.forgetOBDDevice({ address: dev.address });
      removed = !!(res && (res as { success?: boolean }).success);
    } catch { /* removeBond engelli / hata */ }
    setDevices((prev) => prev.filter((d) => d.address !== dev.address));
    if (!removed) {
      // Uygulama kaldıramadı → Android BT Ayarları'ndan manuel "Eşleştirmeyi kaldır".
      setError('Bu cihaz Android tarafında eşli kaldı. Açılan BT Ayarları\'ndan "Eşleştirmeyi kaldır" deyin.');
      CarLauncher.launchApp({ action: 'android.settings.BLUETOOTH_SETTINGS' }).catch(() => {});
    }
  };

  if (!open) return null;

  /* ── Ortak CSS değişken tabanlı ölçüler ── */
  const iconSm   = 'var(--lp-icon-sm, 16px)';
  const icon     = 'var(--lp-icon, 22px)';
  const fxs      = 'var(--lp-font-xs, 10px)';
  const fsm      = 'var(--lp-font-sm, 12px)';
  const fbase    = 'var(--lp-font-base, 14px)';
  const rSm      = 'var(--lp-radius-sm, 6px)';
  const rMd      = 'var(--lp-radius-md, 10px)';
  const rLg      = 'var(--lp-radius-lg, 16px)';
  const spSm     = 'var(--lp-space-sm, 6px)';
  const spMd     = 'var(--lp-space-md, 10px)';
  const spLg     = 'var(--lp-space-lg, 16px)';
  const spXl     = 'var(--lp-space-xl, 24px)';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          /* Telefon: ~320px, araç 10": ~560px, araç 12-14": ~620px */
          width: `min(calc(100vw - 2*${spXl}), clamp(320px, 55vw, 620px))`,
          maxHeight: 'min(88vh, 580px)',
          background: 'var(--oem-surface-0)',
          border: '1px solid var(--oem-info)',
          borderRadius: rLg,
          boxShadow: 'var(--oem-shadow-pop), inset 0 1px 0 var(--oem-line)',
        }}
      >
        {/* ── Başlık ── */}
        <div
          className="flex items-center gap-3 shrink-0 border-b"
          style={{
            padding: `${spLg} ${spXl}`,
            borderColor: 'var(--oem-line)',
          }}
        >
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: `calc(${icon} + 18px)`,
              height: `calc(${icon} + 18px)`,
              background: 'var(--oem-info-soft)',
              border: '1px solid var(--oem-info)',
              borderRadius: rMd,
            }}
          >
            <BluetoothSearching style={{ width: icon, height: icon }} className="text-[color:var(--oem-info)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[color:var(--oem-ink)]" style={{ fontSize: fbase }}>
              OBD Cihaz Bağlantısı
            </div>
            <div className="text-[color:var(--oem-ink-3)] uppercase tracking-wider mt-0.5" style={{ fontSize: fxs }}>
              {scanning
                ? 'Canlı taranıyor…'
                : devices.length === 0
                  ? 'Cihaz yok · OBD takılı + Konum açık mı?'
                  : devices.some((d) => d.source === 'live')
                    ? `${devices.length} cihaz · ${devices.filter((d) => d.source === 'live').length} CANLI`
                    : `${devices.length} cihaz · canlı yok (eşleşmiş)`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center hover:bg-[var(--oem-surface-2)] transition-colors shrink-0"
            style={{ width: `calc(${iconSm} + 18px)`, height: `calc(${iconSm} + 18px)`, borderRadius: rSm }}
          >
            <X style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-ink-3)]" />
          </button>
        </div>

        {/* ── İçerik ── */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ padding: `${spSm} ${spLg}` }}
        >
          {/* Taranıyor */}
          {scanning && (
            <div
              className="flex items-center gap-2"
              style={{
                padding: `${spSm} ${spMd}`,
                marginTop: spSm,
                marginBottom: spSm,
                background: 'var(--oem-info-soft)',
                border: '1px solid var(--oem-info)',
                borderRadius: rMd,
              }}
            >
              <Loader2 style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-info)] animate-spin shrink-0" />
              <span className="text-[color:var(--oem-info)]" style={{ fontSize: fsm }}>
                Yakındaki Bluetooth cihazları aranıyor…
              </span>
            </div>
          )}

          {/* Hata */}
          {error && (
            <div
              className="flex flex-col gap-2"
              style={{
                padding: spMd,
                marginTop: spSm,
                marginBottom: spSm,
                background: 'var(--oem-danger-soft)',
                border: '1px solid var(--oem-danger)',
                borderRadius: rMd,
              }}
            >
              <div className="flex items-start gap-2">
                <AlertCircle style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-danger)] shrink-0 mt-0.5" />
                <span className="text-[color:var(--oem-danger)] leading-relaxed whitespace-pre-line" style={{ fontSize: fsm }}>
                  {error}
                </span>
              </div>
            </div>
          )}

          {/* PIN Paneli */}
          {pinTarget && (
            <div
              className="flex flex-col gap-3"
              style={{
                padding: spMd,
                marginTop: spSm,
                marginBottom: spSm,
                background: 'var(--oem-warn-soft)',
                border: '1px solid var(--oem-warn)',
                borderRadius: rMd,
              }}
            >
              <div className="flex items-center gap-2">
                <KeyRound style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-warn)] shrink-0" />
                <div>
                  <div className="font-bold text-[color:var(--oem-warn)]" style={{ fontSize: fsm }}>
                    {pinTarget.name} — Bağlantı kurulamadı
                  </div>
                  <div className="text-[color:var(--oem-warn)]" style={{ fontSize: fxs }}>
                    Cihazı yeniden eşleştirmek için PIN girin
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                {['0000', '1234'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPinValue(p)}
                    className="flex-1 font-bold tracking-widest transition-all active:scale-95"
                    style={{
                      padding: `${spSm} ${spMd}`,
                      fontSize: fsm,
                      borderRadius: rSm,
                      background: 'var(--oem-warn-soft)',
                      border: `1px solid ${pinValue === p ? 'var(--oem-warn)' : 'var(--oem-line)'}`,
                      color: 'var(--oem-warn)',
                    }}
                  >
                    {p}
                  </button>
                ))}
                <input
                  type="number"
                  placeholder="Özel"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.slice(0, 6))}
                  className="flex-1 text-center font-bold tracking-widest bg-transparent outline-none"
                  style={{
                    padding: `${spSm} ${spMd}`,
                    fontSize: fsm,
                    border: '1px solid var(--oem-line)',
                    borderRadius: rSm,
                    color: 'var(--oem-warn)',
                  }}
                />
              </div>

              <button
                disabled={!pinValue}
                onClick={() => handleConnect(pinTarget, pinValue)}
                className="w-full flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{
                  padding: spMd,
                  fontSize: fsm,
                  borderRadius: rMd,
                  minHeight: '44px',
                  background: pinValue ? 'var(--oem-warn-soft)' : 'transparent',
                  border: `1px solid ${pinValue ? 'var(--oem-warn)' : 'var(--oem-line)'}`,
                  color: 'var(--oem-warn)',
                }}
              >
                <KeyRound style={{ width: iconSm, height: iconSm }} />
                PIN ile Bağlan {pinValue ? `(${pinValue})` : ''}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => { CarLauncher.launchApp({ action: 'android.settings.BLUETOOTH_SETTINGS' }).catch(() => {}); }}
                  className="flex-1 flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider transition-all active:scale-95"
                  style={{
                    padding: `${spSm} ${spMd}`,
                    fontSize: fxs,
                    borderRadius: rSm,
                    minHeight: '36px',
                    background: 'var(--oem-surface-2)',
                    border: '1px solid var(--oem-line)',
                    color: 'var(--oem-ink-3)',
                  }}
                >
                  <Settings style={{ width: `calc(${iconSm} * 0.8)`, height: `calc(${iconSm} * 0.8)` }} />
                  BT Ayarları
                </button>
                <button
                  onClick={() => handleConnect(pinTarget)}
                  className="flex-1 flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider transition-all active:scale-95"
                  style={{
                    padding: `${spSm} ${spMd}`,
                    fontSize: fxs,
                    borderRadius: rSm,
                    minHeight: '36px',
                    background: 'var(--oem-surface-2)',
                    border: '1px solid var(--oem-line)',
                    color: 'var(--oem-ink-3)',
                  }}
                >
                  <RefreshCw style={{ width: `calc(${iconSm} * 0.8)`, height: `calc(${iconSm} * 0.8)` }} />
                  PIN'siz Tekrar
                </button>
              </div>
            </div>
          )}

          {/* Cihaz listesi — sadece OBD adayları (geniş kapsam) */}
          {(() => {
            // Canlı bulunanlar üstte (source==='live' önce), sıra korunarak.
            const SOURCE_RANK: Record<DeviceSource, number> = { live: 0, bonded: 1, cached: 2 };
            const byLiveFirst = (a: DiscoveredDevice, b: DiscoveredDevice) =>
              SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
            const obdDevices   = devices.filter((d) => looksLikeObd(d.name, d.address)).sort(byLiveFirst);
            const otherDevices = devices.filter((d) => !looksLikeObd(d.name, d.address)).sort(byLiveFirst);
            const visibleDevices = showAll ? [...devices].sort(byLiveFirst) : obdDevices;
            return (
              <>
                {visibleDevices.length > 0 ? (
            <div className="flex flex-col" style={{ gap: spSm, marginTop: spSm, paddingBottom: spSm }}>
              {visibleDevices.map((dev) => {
                const isObd  = looksLikeObd(dev.name, dev.address);
                const isCon  = connecting === dev.address;
                const isDone = connected === dev.address;

                return (
                  <div key={dev.address} className="w-full flex items-center" style={{ gap: spSm }}>
                  <button
                    disabled={!!connecting || !!connected}
                    onClick={() => void handleConnect(dev)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left transition-all active:scale-[0.99] disabled:opacity-50"
                    style={{
                      padding: spMd,
                      borderRadius: rMd,
                      minHeight: '52px',
                      background: isDone
                        ? 'var(--oem-good-soft)'
                        : isObd
                          ? 'var(--oem-info-soft)'
                          : 'var(--oem-surface-2)',
                      border: `1px solid ${
                        isDone  ? 'var(--oem-good)'  :
                        isObd   ? 'var(--oem-info)' :
                                  'var(--oem-line)'
                      }`,
                    }}
                  >
                    {/* İkon */}
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: `calc(${icon} + 14px)`,
                        height: `calc(${icon} + 14px)`,
                        borderRadius: rSm,
                        background: isDone  ? 'var(--oem-good-soft)'  :
                                    isObd   ? 'var(--oem-info-soft)' :
                                              'var(--oem-surface-2)',
                      }}
                    >
                      {isDone ? (
                        <CheckCircle style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-good)]" />
                      ) : isCon ? (
                        <Loader2 style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-info)] animate-spin" />
                      ) : isObd ? (
                        <Wifi style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-info)]" />
                      ) : (
                        <Bluetooth style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-ink-4)]" />
                      )}
                    </div>

                    {/* Bilgi */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-semibold truncate"
                        style={{
                          fontSize: fsm,
                          color: isDone ? 'var(--oem-good)' : isObd ? 'var(--oem-info)' : 'var(--oem-ink-2)',
                        }}
                      >
                        {dev.name}
                        {isObd && (
                          <span
                            className="ml-1.5 font-black uppercase tracking-wider inline-block"
                            style={{
                              fontSize: `calc(${fxs} * 0.9)`,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: 'var(--oem-info-soft)',
                              color: 'var(--oem-info)',
                            }}
                          >
                            OBD
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[color:var(--oem-ink-4)] mt-0.5" style={{ fontSize: fxs }}>
                        {dev.address}
                      </div>
                    </div>

                    {/* Durum — kaynak (canlı / eşleşmiş / kayıtlı) net göster */}
                    <div
                      className="shrink-0 font-bold text-right"
                      style={{
                        fontSize: fxs,
                        maxWidth: '38%',
                        color: isDone
                          ? 'var(--oem-good)'
                          : isCon
                            ? 'var(--oem-info)'
                            : dev.source === 'live'
                              ? 'var(--oem-info)'
                              : 'var(--oem-ink-3)',
                      }}
                    >
                      {isDone
                        ? 'Bağlandı'
                        : isCon
                          ? 'Bağlanıyor…'
                          : dev.source === 'live'
                            ? 'Canlı bulundu'
                            : dev.source === 'cached'
                              ? 'Kayıtlı'
                              : 'Daha önce eşleşmiş'}
                    </div>
                  </button>
                  {dev.bonded && (
                    <button
                      onClick={() => void handleForget(dev)}
                      disabled={!!connecting || !!connected}
                      title="Cihazı unut (eşleşmeyi sil)"
                      aria-label="Cihazı unut"
                      className="shrink-0 flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                      style={{
                        width: '44px', height: '44px', borderRadius: rSm,
                        background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger)',
                      }}
                    >
                      <Trash2 style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-danger)]" />
                    </button>
                  )}
                  </div>
                );
              })}
              {/* Gizli (OBD olmayan) cihaz varsa — OBD adayı bulunsa bile tümünü göster.
                  Kullanıcının adaptörü filtreye takılmış olabilir; el ile seçebilsin. */}
              {!showAll && otherDevices.length > 0 && !scanning && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full font-bold uppercase tracking-wider transition-all active:scale-95"
                  style={{
                    padding: spMd, fontSize: fxs, borderRadius: rMd, minHeight: '40px',
                    background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)',
                    color: 'var(--oem-ink-3)',
                  }}
                >
                  + Gizli {otherDevices.length} cihazı göster (tümü)
                </button>
              )}
            </div>
          ) : !scanning ? (
            <div
              className="flex flex-col items-center text-center"
              style={{ padding: `${spXl} ${spLg}` }}
            >
              <Bluetooth
                className="text-[color:var(--oem-ink-4)] mb-3"
                style={{ width: `calc(${icon} * 1.6)`, height: `calc(${icon} * 1.6)` }}
              />
              <p className="text-[color:var(--oem-ink-3)] leading-relaxed" style={{ fontSize: fsm }}>
                OBD adaptörü bulunamadı.
              </p>
              <p className="text-[color:var(--oem-ink-4)] leading-relaxed mt-2" style={{ fontSize: fxs, maxWidth: '85%' }}>
                Adaptörünüz takılı ve Bluetooth açık olduğundan emin olun.
                İlk kez bağlanıyorsanız Android BT Ayarları'ndan eşleştirin (PIN: 0000 veya 1234).
              </p>
              {otherDevices.length > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="font-bold uppercase tracking-wider mt-4 transition-all active:scale-95"
                  style={{
                    padding: `${spSm} ${spMd}`, fontSize: fxs, borderRadius: rSm,
                    background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)',
                    color: 'var(--oem-ink-3)',
                  }}
                >
                  Tüm {otherDevices.length} cihazı göster
                </button>
              )}
            </div>
          ) : null}
              </>
            );
          })()}

          {/* ── WiFi ELM327 (AP modu) manuel adres girişi — Patch 10 ── */}
          <div
            className="flex flex-col"
            style={{
              gap: spSm,
              marginTop: spSm,
              padding: spMd,
              background: 'var(--oem-surface-2)',
              border: '1px solid var(--oem-line)',
              borderRadius: rMd,
            }}
          >
            <div className="flex items-center gap-2">
              <Wifi style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-ink-3)] shrink-0" />
              <span className="font-bold uppercase tracking-wider text-[color:var(--oem-ink-2)]" style={{ fontSize: fxs }}>
                WiFi Adaptör (IP:Port)
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="url"
                placeholder="192.168.0.10:35000"
                value={wifiAddress}
                disabled={!!connecting || !!connected}
                onChange={(e) => { setWifiAddress(e.target.value); setWifiError(null); }}
                className="flex-1 min-w-0 bg-transparent outline-none font-mono"
                style={{
                  padding: spSm,
                  fontSize: fsm,
                  border: '1px solid var(--oem-line)',
                  borderRadius: rSm,
                  color: 'var(--oem-ink)',
                }}
              />
              <button
                onClick={handleConnectWifi}
                disabled={!!connecting || !!connected || !wifiAddress.trim()}
                className="shrink-0 flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
                style={{
                  padding: `${spSm} ${spMd}`,
                  fontSize: fxs,
                  borderRadius: rSm,
                  background: 'var(--oem-info-soft)',
                  border: '1px solid var(--oem-info)',
                  color: 'var(--oem-info)',
                }}
              >
                <Wifi style={{ width: iconSm, height: iconSm }} />
                Bağlan
              </button>
            </div>
            {wifiError && (
              <span className="text-[color:var(--oem-danger)]" style={{ fontSize: fxs }}>{wifiError}</span>
            )}
          </div>

          {/* ── Teşhis zaman çizelgesi (katlanabilir, varsayılan KAPALI) ── */}
          <div style={{ marginTop: spMd, borderTop: '1px solid var(--oem-line)', paddingTop: spMd }}>
            <button
              type="button"
              onClick={() => setShowDiag((v) => !v)}
              className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--oem-surface-2)] active:scale-[0.99]"
              style={{ padding: spSm, borderRadius: rSm, color: 'var(--oem-ink-2)' }}
              aria-expanded={showDiag}
            >
              <Stethoscope style={{ width: iconSm, height: iconSm }} className="text-[color:var(--oem-ink-3)]" />
              <span className="font-bold uppercase tracking-wider" style={{ fontSize: fxs }}>
                Bağlantı Teşhisi
              </span>
              <ChevronDown
                style={{ width: iconSm, height: iconSm, marginLeft: 'auto', transition: 'transform 0.2s', transform: showDiag ? 'rotate(180deg)' : 'none' }}
                className="text-[color:var(--oem-ink-4)]"
              />
            </button>
            {showDiag && (
              <div style={{ marginTop: spSm }}>
                <OBDDiagnosticTimeline />
              </div>
            )}
          </div>
        </div>

        {/* ── Alt bar ── */}
        <div
          className="flex gap-2 shrink-0 border-t"
          style={{
            padding: `${spMd} ${spLg}`,
            borderColor: 'var(--oem-line)',
          }}
        >
          <button
            onClick={() => void startScan()}
            disabled={scanning}
            className="flex-1 flex items-center justify-center gap-2 font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
            style={{
              padding: spMd,
              fontSize: fsm,
              borderRadius: rMd,
              minHeight: '44px',
              background: 'var(--oem-info-soft)',
              border: '1px solid var(--oem-info)',
              color: 'var(--oem-info)',
            }}
          >
            <RefreshCw style={{ width: iconSm, height: iconSm }} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Taranıyor…' : 'Yeniden Tara'}
          </button>
          <button
            onClick={onClose}
            className="font-bold uppercase tracking-wider transition-all active:scale-95"
            style={{
              padding: `${spMd} ${spXl}`,
              fontSize: fsm,
              borderRadius: rMd,
              minHeight: '44px',
              background: 'var(--oem-surface-2)',
              border: '1px solid var(--oem-line)',
              color: 'var(--oem-ink-3)',
            }}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
