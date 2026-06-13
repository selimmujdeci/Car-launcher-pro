/**
 * Security Suite — Vale Modu, Geofencing, Uygulama Kilidi ve Sentry Mode 2.0.
 */

import { memo, useState, useCallback, useEffect } from 'react';
import {
  Shield, MapPin, Lock, Unlock, AlertTriangle,
  Plus, Minus, X, Navigation, ChevronRight, Eye, Video, Upload, Wifi,
} from 'lucide-react';
import {
  useGeofenceState,
  setGeofenceEnabled,
  setGeofenceCenter,
  setGeofenceRadius,
  setValeMode,
  setValeSpeedLimit,
  setPinLock,
  unlockPin,
  clearValeViolations,
  dismissGeofenceAlert,
  checkGeofence,
} from '../../platform/geofenceService';
import { setupPin, clearPin, getLockoutState } from '../../platform/pinService';
import { useGPSLocation } from '../../platform/gpsService';
import { useOBDState } from '../../platform/obdService';
import {
  useSentryState,
  armSentry,
  disarmSentry,
  clearSentryAlerts,
} from '../../platform/security/sentryEngine';

/* ── PIN Girişi ──────────────────────────────────────────── */

const PinPad = memo(function PinPad({
  mode,
  onSuccess,
  onCancel,
  title,
}: {
  mode: 'set' | 'verify';
  onSuccess: () => void;
  onCancel?: () => void;
  title?: string;
}) {
  const [pin, setPin]           = useState('');
  const [error, setError]       = useState(false);
  const [busy, setBusy]         = useState(false);
  const [locked, setLocked]     = useState(false);
  const [remaining, setRemaining] = useState(0);

  // Kilit geri sayımı
  useEffect(() => {
    const iv = setInterval(() => {
      const ls = getLockoutState();
      setLocked(ls.locked);
      setRemaining(ls.remainingSec);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const handleDigit = useCallback(async (d: string) => {
    if (locked || busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      if (mode === 'set') {
        await setupPin(next);
        onSuccess();
      } else {
        const ok = await unlockPin(next);
        if (ok) {
          onSuccess();
        } else {
          const ls = getLockoutState();
          setLocked(ls.locked);
          setRemaining(ls.remainingSec);
          setError(true);
          setTimeout(() => { setError(false); setPin(''); setBusy(false); }, 800);
          return;
        }
      }
      setBusy(false);
    }
  }, [pin, onSuccess, mode, locked, busy]);

  const handleBackspace = useCallback(() => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
    setError(false);
  }, [busy]);

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <div>
        <div className="font-bold text-lg text-center" style={{ color: 'var(--oem-ink)' }}>{title ?? 'PIN Gir'}</div>
        <div className="text-xs text-center mt-1" style={{ color: 'var(--oem-ink-3)' }}>
          {locked
            ? `Çok fazla hatalı deneme — ${remaining}s bekle`
            : mode === 'set' ? 'Yeni 4 haneli PIN belirle' : '4 haneli PIN kodunu gir'}
        </div>
      </div>

      {/* PIN noktaları */}
      <div className="flex gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full border-2 transition-all"
            style={
              locked  ? { borderColor: 'rgba(239,68,68,0.4)' } :
              error   ? { borderColor: 'var(--oem-danger, #ef4444)', background: 'var(--oem-danger, #ef4444)' } :
              i < pin.length ? { borderColor: 'var(--oem-info, #60a5fa)', background: 'var(--oem-info, #60a5fa)' }
                              : { borderColor: 'var(--oem-line-strong, rgba(255,255,255,0.22))' }
            }
          />
        ))}
      </div>

      {/* Kilit uyarısı */}
      {locked && (
        <div className="flex items-center gap-2 text-xs rounded-xl px-4 py-2"
          style={{ color: 'var(--oem-danger, #ef4444)', background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.28))' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {remaining}s sonra tekrar dene
        </div>
      )}

      {/* Klavye */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
          <button
            key={i}
            onClick={() => d === '⌫' ? handleBackspace() : d ? handleDigit(d) : undefined}
            disabled={!d || locked || busy}
            className="h-14 rounded-2xl text-xl font-bold transition-all active:scale-90 disabled:opacity-30"
            style={
              !d ? { opacity: 0, pointerEvents: 'none' } :
              d === '⌫'
                ? { background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.25))', color: 'var(--oem-danger, #ef4444)' }
                : { background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink)' }
            }
          >
            {d}
          </button>
        ))}
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          className="text-sm transition-colors"
          style={{ color: 'var(--oem-ink-3)' }}
        >
          İptal
        </button>
      )}
    </div>
  );
});

/* ── Geofence Haritası (basit görsel) ────────────────────── */

const GeofenceMap = memo(function GeofenceMap({
  center,
  radiusKm,
  currentDistKm,
  isOutside,
}: {
  center: { lat: number; lng: number } | null;
  radiusKm: number;
  currentDistKm: number;
  isOutside: boolean;
}) {
  if (!center) {
    return (
      <div className="w-full h-32 rounded-xl flex items-center justify-center"
        style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
        <div className="text-sm text-center" style={{ color: 'var(--oem-ink-3)' }}>
          <MapPin className="w-6 h-6 mx-auto mb-2" />
          Merkez belirlenmedi
        </div>
      </div>
    );
  }

  const pct = Math.min(100, (currentDistKm / radiusKm) * 100);
  const color = isOutside ? '#ef4444' : pct > 80 ? '#f59e0b' : '#22c55e';

  return (
    <div className="w-full rounded-xl p-4"
      style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
      {/* Merkez konum */}
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-info, #60a5fa)' }} />
        <span className="text-xs font-medium truncate" style={{ color: 'var(--oem-ink)' }}>
          {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
        </span>
      </div>

      {/* Mesafe göstergesi */}
      <div className="flex justify-between text-xs mb-1.5">
        <span style={{ color: 'var(--oem-ink-3)' }}>Mesafe</span>
        <span className="font-bold" style={{ color: isOutside ? 'var(--oem-danger, #ef4444)' : 'var(--oem-ink-2)' }}>
          {currentDistKm.toFixed(2)} / {radiusKm} km
        </span>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--oem-surface-3, rgba(255,255,255,0.08))' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>

      {isOutside && (
        <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--oem-danger, #ef4444)' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Araç belirlenen bölgenin dışında!
        </div>
      )}
    </div>
  );
});

/* ── Ana Panel ───────────────────────────────────────────── */

export const SecuritySuite = memo(function SecuritySuite() {
  const geo    = useGeofenceState();
  const gps    = useGPSLocation();
  const obd    = useOBDState();
  const sentry = useSentryState();

  const [activeTab, setActiveTab] = useState<'geofence' | 'vale' | 'pin' | 'sentry'>('geofence');
  const [showPinPad, setShowPinPad]  = useState(false);
  const [settingPin, setSettingPin]  = useState(false);

  useEffect(() => {
    if (gps?.latitude !== undefined) {
      checkGeofence(gps.latitude, gps.longitude, obd.speed);
    }
  }, [gps?.latitude, gps?.longitude, obd.speed]);

  const handleSetCurrentLocation = useCallback(() => {
    if (gps?.latitude) {
      setGeofenceCenter({ lat: gps.latitude, lng: gps.longitude });
    }
  }, [gps]);

  const handleToggleGeofence = useCallback(() => {
    setGeofenceEnabled(!geo.enabled);
  }, [geo.enabled]);

  const handleToggleVale = useCallback(() => {
    setValeMode(!geo.valeModeActive);
  }, [geo.valeModeActive]);

  const handleTogglePin = useCallback(async () => {
    if (geo.pinLockEnabled) {
      await clearPin();
      setPinLock(false);
    } else {
      setSettingPin(true);
      setShowPinPad(true);
    }
  }, [geo.pinLockEnabled]);

  // PIN ayarla — PinPad setupPin'i çağırır, burada sadece kilidi etkinleştir
  const handlePinSet = useCallback(() => {
    if (!settingPin) return;
    setPinLock(true);
    setShowPinPad(false);
    setSettingPin(false);
  }, [settingPin]);

  const handleToggleSentry = useCallback(() => {
    if (sentry.status !== 'idle') {
      disarmSentry();
    } else {
      void armSentry();
    }
  }, [sentry.status]);

  const tabs = [
    { id: 'geofence' as const, label: 'Geofence',  icon: Navigation },
    { id: 'vale'     as const, label: 'Vale Modu',  icon: Shield },
    { id: 'pin'      as const, label: 'PIN Kilit',  icon: Lock },
    { id: 'sentry'   as const, label: 'Gözcü',      icon: Eye },
  ];

  return (
    <div className="h-full flex flex-col glass-card border-none !shadow-none text-primary overflow-hidden" data-editable="security-suite" data-editable-type="card">
      {/* Başlık */}
      <div className="flex-shrink-0 px-8 py-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-[1.25rem] bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-lg">
            <Shield className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <div className="text-primary font-black text-xl tracking-tight uppercase">Güvenlik Paketi</div>
            <div className="text-secondary text-[10px] font-black uppercase tracking-[0.2em] opacity-60">Vale & Gözcü Modu</div>
          </div>
          {sentry.status !== 'idle' && (
            <div className="ml-auto flex items-center gap-1.5 bg-red-500/20 border border-red-500/30 rounded-xl px-3 py-1.5">
              <div className={`w-2 h-2 rounded-full bg-red-400 ${sentry.status === 'triggered' ? 'animate-ping' : 'animate-pulse'}`} />
              <span className="text-red-400 text-[10px] font-black tracking-wider">
                {sentry.status === 'triggered' ? 'DARBE!' : 'GÖZCÜ AKTİF'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex-shrink-0 flex gap-2.5 p-4"
        style={{ background: 'var(--oem-surface-0)', borderBottom: '1px solid var(--oem-line)' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="flex-1 h-11 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
            style={activeTab === t.id
              ? { background: 'var(--oem-warn, #f59e0b)', color: '#0a0a0a', border: '1px solid transparent', boxShadow: '0 8px 20px rgba(245,158,11,0.3)' }
              : { background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }
            }
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* PIN pad overlay */}
      {showPinPad && (
        <div className="absolute inset-0 z-50 glass-card border-none !shadow-none/95 backdrop-blur-sm flex items-center justify-center">
          <PinPad
            mode={settingPin ? 'set' : 'verify'}
            title={settingPin ? 'Yeni PIN Oluştur' : 'PIN Gir'}
            onSuccess={settingPin ? handlePinSet : () => setShowPinPad(false)}
            onCancel={() => { setShowPinPad(false); setSettingPin(false); }}
          />
        </div>
      )}

      {/* Vale uyarısı overlay */}
      {geo.valeAlert && (
        <div className="absolute inset-x-4 top-24 z-40 bg-red-500/95 backdrop-blur-sm rounded-2xl p-4 shadow-2xl border border-red-400/50 animate-fade-in">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-primary flex-shrink-0 mt-0.5 animate-pulse" />
            <div>
              <div className="text-primary font-bold text-base">Hız Sınırı Aşıldı!</div>
              <div className="text-red-100 text-sm mt-0.5">
                {Math.round(geo.valeAlert.speedKmh)} km/h — Limit: {geo.valeAlert.limitKmh} km/h
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* ── Geofence sekmesi ────────────────────────────── */}
        {activeTab === 'geofence' && (
          <>
            {/* Durum kartı */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold" style={{ color: 'var(--oem-ink-2)' }}>Sanal Çit</span>
                <button
                  onClick={handleToggleGeofence}
                  className="relative w-12 h-6 rounded-full transition-all"
                  style={{ background: geo.enabled ? 'var(--oem-good, #22c55e)' : 'var(--oem-surface-3, rgba(255,255,255,0.10))' }}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all ${geo.enabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <GeofenceMap
                center={geo.center}
                radiusKm={geo.radiusKm}
                currentDistKm={geo.currentDistKm}
                isOutside={geo.isOutside}
              />
            </div>

            {/* Yarıçap ayarı */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--oem-ink-3)' }}>Yarıçap</span>
                <span className="font-bold" style={{ color: 'var(--oem-ink)' }}>{geo.radiusKm} km</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setGeofenceRadius(Math.max(0.5, geo.radiusKm - 0.5))}
                  className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                  style={{ background: 'var(--oem-surface-3)', color: 'var(--oem-ink)' }}
                ><Minus className="w-4 h-4" /></button>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--oem-surface-3, rgba(255,255,255,0.08))' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (geo.radiusKm / 20) * 100)}%`, background: 'var(--oem-info, #3b82f6)' }}
                  />
                </div>
                <button
                  onClick={() => setGeofenceRadius(Math.min(20, geo.radiusKm + 0.5))}
                  className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                  style={{ background: 'var(--oem-surface-3)', color: 'var(--oem-ink)' }}
                ><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Merkez konum */}
            <button
              onClick={handleSetCurrentLocation}
              disabled={!gps?.latitude}
              className="h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40"
            >
              <MapPin className="w-4 h-4" />
              Mevcut Konumu Merkez Yap
            </button>

            {/* Uyarı geçmişi */}
            {geo.lastAlert && (
              <div className="rounded-2xl p-4 flex items-start gap-3"
                style={geo.lastAlert.type === 'exit'
                  ? { background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.35))' }
                  : { background: 'var(--oem-good-soft)', border: '1px solid var(--oem-good, rgba(34,197,94,0.35))' }}>
                <AlertTriangle className="w-5 h-5 flex-shrink-0"
                  style={{ color: geo.lastAlert.type === 'exit' ? 'var(--oem-danger, #ef4444)' : 'var(--oem-good, #22c55e)' }} />
                <div className="flex-1">
                  <div className="text-sm font-bold"
                    style={{ color: geo.lastAlert.type === 'exit' ? 'var(--oem-danger, #ef4444)' : 'var(--oem-good, #22c55e)' }}>
                    {geo.lastAlert.type === 'exit' ? 'Bölge Dışına Çıkıldı' : 'Bölgeye Girildi'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>
                    {new Date(geo.lastAlert.timestamp).toLocaleTimeString('tr-TR')} · {geo.lastAlert.distanceKm.toFixed(2)} km
                  </div>
                </div>
                <button onClick={dismissGeofenceAlert} style={{ color: 'var(--oem-ink-3)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Vale Modu sekmesi ────────────────────────────── */}
        {activeTab === 'vale' && (
          <>
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Vale Modu</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>Hız limiti aşılınca uyarı</div>
                </div>
                <button
                  onClick={handleToggleVale}
                  className="relative w-12 h-6 rounded-full transition-all"
                  style={{ background: geo.valeModeActive ? 'var(--oem-warn, #f59e0b)' : 'var(--oem-surface-3, rgba(255,255,255,0.10))' }}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all ${geo.valeModeActive ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            {/* Hız limiti */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--oem-ink-3)' }}>Hız Limiti</span>
                <span className="font-black text-lg" style={{ color: 'var(--oem-warn, #f59e0b)' }}>{geo.valeSpeedLimit} km/h</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setValeSpeedLimit(Math.max(20, geo.valeSpeedLimit - 5))}
                  className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                  style={{ background: 'var(--oem-surface-3)', color: 'var(--oem-ink)' }}
                ><Minus className="w-4 h-4" /></button>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--oem-surface-3, rgba(255,255,255,0.08))' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${((geo.valeSpeedLimit - 20) / 160) * 100}%`, background: 'var(--oem-warn, #f59e0b)' }}
                  />
                </div>
                <button
                  onClick={() => setValeSpeedLimit(Math.min(180, geo.valeSpeedLimit + 5))}
                  className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                  style={{ background: 'var(--oem-surface-3)', color: 'var(--oem-ink)' }}
                ><Plus className="w-4 h-4" /></button>
              </div>
              <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--oem-ink-3)' }}>
                <span>20</span><span>100</span><span>180</span>
              </div>
            </div>

            {/* İhlal kaydı */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--oem-ink-3)' }}>İhlal Kaydı</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>{geo.valeViolations.length} kayıt</span>
                  {geo.valeViolations.length > 0 && (
                    <button onClick={clearValeViolations} className="text-slate-600 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                {geo.valeViolations.length === 0 ? (
                  <div className="text-xs text-center py-3" style={{ color: 'var(--oem-ink-3)' }}>İhlal yok</div>
                ) : (
                  geo.valeViolations.slice().reverse().map((v, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2"
                      style={{ background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.14))' }}>
                      <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>
                        {new Date(v.timestamp).toLocaleTimeString('tr-TR')}
                      </span>
                      <span className="text-xs font-bold" style={{ color: 'var(--oem-danger, #ef4444)' }}>
                        {Math.round(v.speedKmh)} km/h
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Gözcü (Sentry) sekmesi ──────────────────────── */}
        {activeTab === 'sentry' && (
          <>
            {/* Arm/Disarm toggle */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>Gözcü Modu</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>
                    {sentry.videoAvailable ? 'Video + G-Sensör aktif' : 'Yalnızca G-Sensör (kamera yok)'}
                  </div>
                </div>
                <button
                  onClick={handleToggleSentry}
                  className="relative w-12 h-6 rounded-full transition-all"
                  style={{ background: sentry.status !== 'idle' ? 'var(--oem-danger, #ef4444)' : 'var(--oem-surface-3, rgba(255,255,255,0.10))' }}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all ${
                    sentry.status !== 'idle' ? 'left-7' : 'left-1'
                  }`} />
                </button>
              </div>
            </div>

            {/* Tesla tarzı "Gözcü Aktif" banner */}
            {sentry.status !== 'idle' && (
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={sentry.status === 'triggered'
                  ? { border: '1px solid var(--oem-danger, rgba(239,68,68,0.55))', background: 'var(--oem-danger-soft)', boxShadow: '0 0 24px rgba(239,68,68,0.28)' }
                  : { border: '1px solid var(--oem-danger, rgba(239,68,68,0.22))', background: 'var(--oem-danger-soft)' }
                }
              >
                <div className="relative flex-shrink-0">
                  <Eye
                    className={`w-8 h-8 ${sentry.status === 'triggered' ? 'animate-pulse' : ''}`}
                    style={{ color: 'var(--oem-danger, #ef4444)' }}
                  />
                  {sentry.videoAvailable && (
                    <Video className="w-3.5 h-3.5 absolute -bottom-1 -right-1" style={{ color: 'var(--oem-danger, #ef4444)' }} />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-black text-sm tracking-wide" style={{ color: 'var(--oem-danger, #ef4444)' }}>
                    {sentry.status === 'triggered'
                      ? 'DARBE TESPİT EDİLDİ — KAYIT ALINIYOR'
                      : 'GÖZCÜ AKTİF — KAYIT ALINIYOR'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>
                    G-Kuvvet: {sentry.lastImpactG.toFixed(1)} m/s²
                    {sentry.pendingUploads > 0 && (
                      <span className="ml-2" style={{ color: 'var(--oem-warn, #f59e0b)' }}>
                        · {sentry.pendingUploads} klip yüklenecek
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Bekleyen yüklemeler */}
            {sentry.pendingUploads > 0 && (
              <div className="rounded-2xl p-3 flex items-center gap-3"
                style={{ background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn, rgba(245,158,11,0.28))' }}>
                <Wifi className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-warn, #f59e0b)' }} />
                <span className="text-xs" style={{ color: 'var(--oem-warn, #f59e0b)' }}>
                  {sentry.pendingUploads} klip çevrimiçi olunca yüklenecek
                </span>
              </div>
            )}

            {/* Alert geçmişi */}
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--oem-ink-3)' }}>Olaylar</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--oem-ink-3)' }}>{sentry.alerts.length} olay</span>
                  {sentry.alerts.length > 0 && (
                    <button onClick={clearSentryAlerts} className="text-slate-600 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                {sentry.alerts.length === 0 ? (
                  <div className="text-xs text-center py-4" style={{ color: 'var(--oem-ink-3)' }}>
                    {sentry.status === 'idle' ? 'Gözcü kapalı' : 'Henüz olay yok'}
                  </div>
                ) : (
                  sentry.alerts.slice().reverse().map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                      style={{ background: 'var(--oem-danger-soft)', border: '1px solid var(--oem-danger, rgba(239,68,68,0.14))' }}
                    >
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-danger, #ef4444)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold" style={{ color: 'var(--oem-ink)' }}>
                          {new Date(a.triggeredAt).toLocaleTimeString('tr-TR')}
                          <span className="font-normal ml-1.5" style={{ color: 'var(--oem-ink-3)' }}>
                            {a.impactG.toFixed(1)} m/s²
                          </span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {a.uploadStatus === 'done' && a.clipUrl && (
                          <a href={a.clipUrl} target="_blank" rel="noopener noreferrer">
                            <Video className="w-3.5 h-3.5" style={{ color: 'var(--oem-good, #22c55e)' }} />
                          </a>
                        )}
                        {a.uploadStatus === 'done' && !a.clipUrl && (
                          <span className="text-[10px]" style={{ color: 'var(--oem-good, #22c55e)' }}>✓</span>
                        )}
                        {a.uploadStatus === 'uploading' && (
                          <Upload className="w-3.5 h-3.5 animate-bounce" style={{ color: 'var(--oem-info, #60a5fa)' }} />
                        )}
                        {a.uploadStatus === 'failed' && (
                          <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--oem-warn, #f59e0b)' }} />
                        )}
                        {a.uploadStatus === 'pending' && (
                          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--oem-ink-3)' }} />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* ── PIN Kilit sekmesi ────────────────────────────── */}
        {activeTab === 'pin' && (
          <>
            <div className="rounded-2xl p-4" style={{ border: '1px solid var(--oem-line)', background: 'var(--oem-surface-2)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>PIN Kilidi</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>Ayarlara giriş koruması</div>
                </div>
                <button
                  onClick={handleTogglePin}
                  className="relative w-12 h-6 rounded-full transition-all"
                  style={{ background: geo.pinLockEnabled ? 'var(--oem-good, #22c55e)' : 'var(--oem-surface-3, rgba(255,255,255,0.10))' }}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all ${geo.pinLockEnabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            <div
              className="rounded-2xl p-4 flex items-center gap-3"
              style={geo.pinLockEnabled
                ? { background: 'var(--oem-good-soft)', border: '1px solid var(--oem-good, rgba(34,197,94,0.28))' }
                : { background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }
              }>
              {geo.pinLockEnabled
                ? <Lock className="w-5 h-5" style={{ color: 'var(--oem-good, #22c55e)' }} />
                : <Unlock className="w-5 h-5" style={{ color: 'var(--oem-ink-3)' }} />
              }
              <div>
                <div className="text-sm font-bold"
                  style={{ color: geo.pinLockEnabled ? 'var(--oem-good, #22c55e)' : 'var(--oem-ink-3)' }}>
                  {geo.pinLockEnabled ? 'Kilit Aktif' : 'Kilit Devre Dışı'}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--oem-ink-3)', opacity: 0.75 }}>
                  {geo.pinLockEnabled ? '4 haneli PIN ile koruma aktif' : 'PIN kilidi kapalı'}
                </div>
              </div>
            </div>

            {geo.pinLockEnabled && (
              <>
                <button
                  onClick={() => { setShowPinPad(true); setSettingPin(false); }}
                  className="h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                  style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }}
                >
                  <Lock className="w-4 h-4" />
                  PIN'i Test Et
                </button>
                <button
                  onClick={() => { setSettingPin(true); setShowPinPad(true); }}
                  className="h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                  PIN'i Değiştir
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default SecuritySuite;


