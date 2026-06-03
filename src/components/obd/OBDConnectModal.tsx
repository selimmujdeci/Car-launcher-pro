/**
 * OBDConnectModal — Uygulama içi OBD cihaz tarama ve bağlantı.
 *
 * Android sistem BT ayarlarına girmeden doğrudan uygulama içinden
 * yakındaki Bluetooth cihazlarını tarar, listeler, seçilen cihaza bağlanır.
 * Pair gerektirmez — insecure RFCOMM ile direkt bağlantı dener.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bluetooth, BluetoothSearching, Wifi, X, CheckCircle, AlertCircle, Loader2, RefreshCw, Settings, KeyRound } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { startOBD, stopOBD, useOBDConnectionState, useOBDState } from '../../platform/obdService';

interface DiscoveredDevice {
  name:    string;
  address: string;
  bonded:  boolean;
  // Opsiyonel taşıma katmanı — native taraf "classic" veya "ble" gönderir.
  // Eski Classic akışı transport olmadan da çalışır (geriye dönük uyumlu).
  transport?: 'classic' | 'ble';
}

interface Props {
  open:    boolean;
  onClose: () => void;
}

// Geniş OBD anahtar kelime listesi — genel OBD2/ELM327 klonları dahil.
// "spp" / "ble serial" / "serial" / "bt" gibi generic SPP-stack isimleri de OBD adapter olabilir;
// "mini" + ELM327 klonları, "viecar", "bafx", "ediag" gibi tanınmış markalar dahil.
const OBD_REGEX = /obd|elm|v.?link|obdii|obd2|kw\d{3}|veepeak|icar|vgate|konnwei|obdlink|carscanner|xtool|autel|launch|thinkcar|viecar|bafx|panlong|ediag|carista|tonwon|topdon|ancel|nexas|foseal|spp[-_ ]?dev|serial|ble[-_ ]?spp|mini\s*obd/i;

// Telefon / kulaklık / saat / araba multimedya gibi kesin OBD olmayan cihazları dışla
const NON_OBD_REGEX = /iphone|ipad|airpod|airpods|galaxy\s*(buds|watch)|pixel\s*(buds|watch)|mi\s*band|mi\s*watch|honor\s*band|headset|earbud|speaker|tv|chromecast|laptop|mouse|keyboard|smartwatch|fitbit|huawei\s*watch|samsung\s*(tv|tab)|microntek|kswcar|fyt|car\s*play/i;

/**
 * Bir BT cihazının OBD adayı olup olmadığını tahmin eder.
 * - İsimde regex eşleşmesi → kesin OBD
 * - İsim yok / MAC adresi adı olarak gelmiş → muhtemel OBD (ELM327 klonları çoğu kez böyle)
 * - Bilinen NON-OBD ürün → asla aday değil
 */
function looksLikeObd(name: string, address: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;                      // adsız → aday
  if (NON_OBD_REGEX.test(n)) return false;  // telefon / kulaklık vs.
  if (OBD_REGEX.test(n))    return true;
  // BT name çekilemediğinde plugin name=address yazar → muhtemelen OBD'dir
  if (n.toUpperCase() === address.toUpperCase()) return true;
  // İsim sadece hex/MAC karakterleri ise (xx:xx veya bare hex) → muhtemel OBD
  if (/^[0-9A-F:-]{8,}$/i.test(n)) return true;
  return false;
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
      const t = setTimeout(() => onCloseRef.current(), 1500);
      return () => clearTimeout(t);
    }
    if (obdConnectionState === 'error') {
      const failedDev = devices.find((d) => d.address === connecting) ?? null;
      setConnecting(null);
      setError(null);
      setPinTarget(failedDev);
      setPinValue('');
    }
  }, [obdConnectionState, connecting]);

  useEffect(() => {
    if (!connecting) return;
    const t = setTimeout(() => {
      setConnecting(null);
      setError('Bağlantı zaman aşımına uğradı (35 s). Adaptörün açık ve yakında olduğundan emin olun.');
    }, 35_000);
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
      setDevices([{ name: 'OBD2 Demo', address: 'AA:BB:CC:DD:EE:FF', bonded: true }]);
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

    try {
      await CarLauncher.requestAndroid13Permissions();
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (/denied|permission|bluetooth/i.test(msg)) {
        setError('Bluetooth izni reddedildi. Ayarlar > Uygulama İzinleri bölümünden Yakındaki Cihazlar iznini verin.');
        setScanning(false);
        return;
      }
    }

    // obdDeviceFound — her bulunan cihazda tetiklenir (bonded + aktif tarama)
    const handle = await CarLauncher.addListener('obdDeviceFound', (data) => {
      setDevices((prev) => {
        if (prev.some((d) => d.address === data.address)) return prev;
        return [...prev, { name: data.name, address: data.address, bonded: data.bonded, transport: data.transport }];
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
      setError((e as Error).message ?? 'Tarama başlatılamadı');
      setScanning(false);
      stopDiscovery();
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
    stopOBD();
    startOBD(dev.address, pin, dev.transport);
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
          background: 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(7,11,24,0.99))',
          border: '1px solid rgba(56,189,248,0.22)',
          borderRadius: rLg,
          boxShadow: '0 28px 64px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* ── Başlık ── */}
        <div
          className="flex items-center gap-3 shrink-0 border-b"
          style={{
            padding: `${spLg} ${spXl}`,
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: `calc(${icon} + 18px)`,
              height: `calc(${icon} + 18px)`,
              background: 'rgba(56,189,248,0.12)',
              border: '1px solid rgba(56,189,248,0.28)',
              borderRadius: rMd,
            }}
          >
            <BluetoothSearching style={{ width: icon, height: icon }} className="text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-white" style={{ fontSize: fbase }}>
              OBD Cihaz Bağlantısı
            </div>
            <div className="text-white/40 uppercase tracking-wider mt-0.5" style={{ fontSize: fxs }}>
              {scanning ? 'Taranıyor…' : `${devices.length} cihaz bulundu`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
            style={{ width: `calc(${iconSm} + 18px)`, height: `calc(${iconSm} + 18px)`, borderRadius: rSm }}
          >
            <X style={{ width: iconSm, height: iconSm }} className="text-white/50" />
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
                background: 'rgba(56,189,248,0.06)',
                border: '1px solid rgba(56,189,248,0.15)',
                borderRadius: rMd,
              }}
            >
              <Loader2 style={{ width: iconSm, height: iconSm }} className="text-sky-400 animate-spin shrink-0" />
              <span className="text-sky-400" style={{ fontSize: fsm }}>
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
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: rMd,
              }}
            >
              <div className="flex items-start gap-2">
                <AlertCircle style={{ width: iconSm, height: iconSm }} className="text-red-400 shrink-0 mt-0.5" />
                <span className="text-red-400 leading-relaxed whitespace-pre-line" style={{ fontSize: fsm }}>
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
                background: 'rgba(251,191,36,0.07)',
                border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: rMd,
              }}
            >
              <div className="flex items-center gap-2">
                <KeyRound style={{ width: iconSm, height: iconSm }} className="text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-amber-400" style={{ fontSize: fsm }}>
                    {pinTarget.name} — Bağlantı kurulamadı
                  </div>
                  <div className="text-amber-400/60" style={{ fontSize: fxs }}>
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
                      background: pinValue === p ? 'rgba(251,191,36,0.25)' : 'rgba(251,191,36,0.08)',
                      border: `1px solid ${pinValue === p ? 'rgba(251,191,36,0.5)' : 'rgba(251,191,36,0.2)'}`,
                      color: '#fbbf24',
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
                    border: '1px solid rgba(251,191,36,0.2)',
                    borderRadius: rSm,
                    color: '#fbbf24',
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
                  background: pinValue ? 'rgba(251,191,36,0.22)' : 'rgba(251,191,36,0.06)',
                  border: `1px solid ${pinValue ? 'rgba(251,191,36,0.55)' : 'rgba(251,191,36,0.15)'}`,
                  color: '#fbbf24',
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
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.4)',
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
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.4)',
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
            const obdDevices   = devices.filter((d) => looksLikeObd(d.name, d.address));
            const otherDevices = devices.filter((d) => !looksLikeObd(d.name, d.address));
            const visibleDevices = showAll ? devices : obdDevices;
            return (
              <>
                {visibleDevices.length > 0 ? (
            <div className="flex flex-col" style={{ gap: spSm, marginTop: spSm, paddingBottom: spSm }}>
              {visibleDevices.map((dev) => {
                const isObd  = looksLikeObd(dev.name, dev.address);
                const isCon  = connecting === dev.address;
                const isDone = connected === dev.address;

                return (
                  <button
                    key={dev.address}
                    disabled={!!connecting || !!connected}
                    onClick={() => void handleConnect(dev)}
                    className="w-full flex items-center gap-3 text-left transition-all active:scale-[0.99] disabled:opacity-50"
                    style={{
                      padding: spMd,
                      borderRadius: rMd,
                      minHeight: '52px',
                      background: isDone
                        ? 'rgba(34,197,94,0.12)'
                        : isObd
                          ? 'rgba(56,189,248,0.08)'
                          : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${
                        isDone  ? 'rgba(34,197,94,0.3)'  :
                        isObd   ? 'rgba(56,189,248,0.2)' :
                                  'rgba(255,255,255,0.06)'
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
                        background: isDone  ? 'rgba(34,197,94,0.15)'  :
                                    isObd   ? 'rgba(56,189,248,0.12)' :
                                              'rgba(255,255,255,0.06)',
                      }}
                    >
                      {isDone ? (
                        <CheckCircle style={{ width: iconSm, height: iconSm }} className="text-green-400" />
                      ) : isCon ? (
                        <Loader2 style={{ width: iconSm, height: iconSm }} className="text-sky-400 animate-spin" />
                      ) : isObd ? (
                        <Wifi style={{ width: iconSm, height: iconSm }} className="text-sky-400" />
                      ) : (
                        <Bluetooth style={{ width: iconSm, height: iconSm }} className="text-white/30" />
                      )}
                    </div>

                    {/* Bilgi */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-semibold truncate"
                        style={{
                          fontSize: fsm,
                          color: isDone ? '#4ade80' : isObd ? '#38bdf8' : 'rgba(255,255,255,0.75)',
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
                              background: 'rgba(56,189,248,0.15)',
                              color: '#38bdf8',
                            }}
                          >
                            OBD
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-white/25 mt-0.5" style={{ fontSize: fxs }}>
                        {dev.address}
                      </div>
                    </div>

                    {/* Durum */}
                    <div
                      className="shrink-0 font-bold"
                      style={{
                        fontSize: fxs,
                        color: isDone ? '#4ade80' : isCon ? '#38bdf8' : 'rgba(255,255,255,0.25)',
                      }}
                    >
                      {isDone ? 'Bağlandı' : isCon ? 'Bağlanıyor…' : dev.bonded ? 'Eşli' : 'Bağlan'}
                    </div>
                  </button>
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
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.35)',
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
                className="text-white/15 mb-3"
                style={{ width: `calc(${icon} * 1.6)`, height: `calc(${icon} * 1.6)` }}
              />
              <p className="text-white/35 leading-relaxed" style={{ fontSize: fsm }}>
                OBD adaptörü bulunamadı.
              </p>
              <p className="text-white/20 leading-relaxed mt-2" style={{ fontSize: fxs, maxWidth: '85%' }}>
                Adaptörünüz takılı ve Bluetooth açık olduğundan emin olun.
                İlk kez bağlanıyorsanız Android BT Ayarları'ndan eşleştirin (PIN: 0000 veya 1234).
              </p>
              {otherDevices.length > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="font-bold uppercase tracking-wider mt-4 transition-all active:scale-95"
                  style={{
                    padding: `${spSm} ${spMd}`, fontSize: fxs, borderRadius: rSm,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.35)',
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
        </div>

        {/* ── Alt bar ── */}
        <div
          className="flex gap-2 shrink-0 border-t"
          style={{
            padding: `${spMd} ${spLg}`,
            borderColor: 'rgba(255,255,255,0.06)',
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
              background: 'rgba(56,189,248,0.1)',
              border: '1px solid rgba(56,189,248,0.2)',
              color: '#38bdf8',
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
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
