/**
 * OBDConnectModal — Uygulama içi OBD cihaz tarama ve bağlantı.
 *
 * Android sistem BT ayarlarına girmeden doğrudan uygulama içinden
 * yakındaki Bluetooth cihazlarını tarar, listeler, seçilen cihaza bağlanır.
 * Pair gerektirmez — insecure RFCOMM ile direkt bağlantı dener.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bluetooth, BluetoothSearching, Wifi, X, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { startOBD } from '../../platform/obdService';

interface DiscoveredDevice {
  name:    string;
  address: string;
  bonded:  boolean;
}

interface Props {
  open:    boolean;
  onClose: () => void;
}

const OBD_REGEX = /obd|elm|vlink|obdii|kw|veepeak|icar|vgate/i;

export function OBDConnectModal({ open, onClose }: Props) {
  const [devices,     setDevices]     = useState<DiscoveredDevice[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [connecting,  setConnecting]  = useState<string | null>(null); // address
  const [connected,   setConnected]   = useState<string | null>(null); // address
  const [error,       setError]       = useState<string | null>(null);

  const handlesRef = useRef<Array<{ remove: () => void }>>([]);

  const cleanup = useCallback(() => {
    handlesRef.current.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
    handlesRef.current = [];
    if (Capacitor.isNativePlatform()) {
      CarLauncher.stopOBDDiscovery().catch(() => {/* ignore */});
    }
  }, []);

  const startScan = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      // Web modda demo cihaz göster
      setDevices([{ name: 'iCar3 (Demo)', address: 'AA:BB:CC:DD:EE:FF', bonded: false }]);
      setScanning(false);
      return;
    }

    cleanup();
    setDevices([]);
    setError(null);
    setConnecting(null);
    setConnected(null);
    setScanning(true);

    try {
      // Cihaz bulunca listeye ekle (duplicate'leri filtrele)
      const foundHandle = await CarLauncher.addListener('obdDeviceFound', (dev) => {
        setDevices((prev) => {
          if (prev.some((d) => d.address === dev.address)) return prev;
          // OBD cihazları başa, diğerleri sona
          const isObd = OBD_REGEX.test(dev.name);
          return isObd ? [dev, ...prev] : [...prev, dev];
        });
      });

      // Tarama bitince spinner'ı kaldır
      const finishedHandle = await CarLauncher.addListener('obdDiscoveryFinished', () => {
        setScanning(false);
      });

      handlesRef.current = [foundHandle, finishedHandle];

      await CarLauncher.startOBDDiscovery();
    } catch (e) {
      setError((e as Error).message ?? 'Tarama başlatılamadı');
      setScanning(false);
    }
  }, [cleanup]);

  // Modal açılınca otomatik tara
  useEffect(() => {
    if (open) {
      void startScan();
    } else {
      cleanup();
      setDevices([]);
      setScanning(false);
      setConnecting(null);
      setConnected(null);
      setError(null);
    }
    return cleanup;
  }, [open, startScan, cleanup]);

  const handleConnect = async (dev: DiscoveredDevice) => {
    setConnecting(dev.address);
    setError(null);
    try {
      await CarLauncher.connectOBD({ address: dev.address });
      setConnected(dev.address);
      setConnecting(null);
      // OBD servisini yeniden başlat
      startOBD();
      // 1.5s sonra modal'ı kapat
      setTimeout(onClose, 1500);
    } catch (e) {
      setConnecting(null);
      setError(`${dev.name}: ${(e as Error).message ?? 'Bağlantı başarısız'}`);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(7,11,24,0.99))',
          border: '1px solid rgba(56,189,248,0.2)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)' }}>
            <BluetoothSearching className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">OBD Cihaz Bağlantısı</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">
              {scanning ? 'Taranıyor…' : `${devices.length} cihaz bulundu`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* İçerik */}
        <div className="px-4 py-3 max-h-80 overflow-y-auto">
          {/* Taranıyor göstergesi */}
          {scanning && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl"
              style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)' }}>
              <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
              <span className="text-[11px] text-sky-400">Yakındaki Bluetooth cihazları aranıyor…</span>
            </div>
          )}

          {/* Hata */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-400 leading-relaxed">{error}</span>
            </div>
          )}

          {/* Cihaz listesi */}
          {devices.length > 0 ? (
            <div className="space-y-1.5">
              {devices.map((dev) => {
                const isObd  = OBD_REGEX.test(dev.name);
                const isCon  = connecting === dev.address;
                const isDone = connected === dev.address;

                return (
                  <button
                    key={dev.address}
                    disabled={!!connecting || !!connected}
                    onClick={() => void handleConnect(dev)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all active:scale-95 disabled:opacity-50"
                    style={{
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
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: isDone  ? 'rgba(34,197,94,0.15)'  :
                                    isObd   ? 'rgba(56,189,248,0.12)' :
                                              'rgba(255,255,255,0.06)',
                      }}>
                      {isDone ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : isCon ? (
                        <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                      ) : isObd ? (
                        <Wifi className="w-4 h-4 text-sky-400" />
                      ) : (
                        <Bluetooth className="w-4 h-4 text-white/30" />
                      )}
                    </div>

                    {/* Bilgi */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate"
                        style={{ color: isDone ? '#4ade80' : isObd ? '#38bdf8' : 'rgba(255,255,255,0.7)' }}>
                        {dev.name}
                        {isObd && (
                          <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>
                            OBD
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/25 font-mono">{dev.address}</div>
                    </div>

                    {/* Durum */}
                    <div className="text-[10px] shrink-0"
                      style={{ color: isDone ? '#4ade80' : isCon ? '#38bdf8' : 'rgba(255,255,255,0.25)' }}>
                      {isDone ? 'Bağlandı' : isCon ? 'Bağlanıyor…' : dev.bonded ? 'Eşli' : 'Bağlan'}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !scanning ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Bluetooth className="w-8 h-8 text-white/15" />
              <p className="text-xs text-white/30">Yakında OBD cihazı bulunamadı</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-2 flex gap-2">
          <button
            onClick={() => void startScan()}
            disabled={scanning}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
            style={{
              background: 'rgba(56,189,248,0.1)',
              border: '1px solid rgba(56,189,248,0.2)',
              color: '#38bdf8',
            }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Taranıyor…' : 'Yeniden Tara'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all active:scale-95"
            style={{
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
