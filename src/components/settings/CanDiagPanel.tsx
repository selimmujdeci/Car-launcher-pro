import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Save, Radio } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import type { CanIdConfig, CanRawFrame } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';

const DEFAULT_IDS: CanIdConfig = {
  speed:   0x0C9,
  gear:    0x0E8,
  fuel:    0x145,
  doors:   0x3B0,
  lights:  0x1A0,
  tpms:    0x385,
  rpm:     0x316,
  coolant: 0x294,
  oilTemp: 0x280,
  throttle:0x201,
  battVolt:0x3A0,
  gearPos: 0x1D0,
  ambient: 0x350,
  chassis: 0x0C0,
  body:    0x3D0,
};

const SIGNAL_LABELS: Record<keyof CanIdConfig, string> = {
  speed:   'Hız',
  gear:    'Vites Tipi',
  fuel:    'Yakıt',
  doors:   'Kapılar',
  lights:  'Farlar',
  tpms:    'TPMS',
  rpm:     'Devir (RPM)',
  coolant: 'Su Isısı',
  oilTemp: 'Yağ Isısı',
  throttle:'Pedal %',
  battVolt:'Akü Volt',
  gearPos: 'Vites Pozisyonu',
  ambient: 'Dış Hava',
  chassis: 'Şasi (ABS/TCS/ESC)',
  body:    'Gövde (Fren/Kemer/...)',
};

type SnifferEntry = { hex: string; data: string; count: number };
type EditIds = Record<keyof CanIdConfig, string>;

function toHex(n: number) {
  return `0x${n.toString(16).toUpperCase().padStart(3, '0')}`;
}

function toEditIds(cfg: CanIdConfig): EditIds {
  return Object.fromEntries(
    (Object.keys(cfg) as (keyof CanIdConfig)[]).map(k => [k, toHex(cfg[k])])
  ) as EditIds;
}

export function CanDiagPanel() {
  const [editIds, setEditIds] = useState<EditIds>(toEditIds(DEFAULT_IDS));
  const [snifferOn, setSnifferOn]   = useState(false);
  const [snifferMap, setSnifferMap] = useState<Map<string, SnifferEntry>>(new Map());
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const liveMap  = useRef<Map<string, SnifferEntry>>(new Map());
  const flushRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNative || !CarLauncher.getCanIds) return;
    CarLauncher.getCanIds()
      .then(ids => setEditIds(toEditIds(ids)))
      .catch(() => {});
  }, []);

  const toggleSniffer = useCallback(async () => {
    const next = !snifferOn;
    setSnifferOn(next);
    setAssignTarget(null);
    if (isNative && CarLauncher.setCanSnifferEnabled) {
      await CarLauncher.setCanSnifferEnabled({ enabled: next });
    }
    if (!next) {
      liveMap.current = new Map();
      setSnifferMap(new Map());
    }
  }, [snifferOn]);

  useEffect(() => {
    if (!isNative || !snifferOn) return;
    let handle: { remove(): void } | null = null;
    CarLauncher.addListener('canRawFrame', (f: CanRawFrame) => {
      const prev = liveMap.current.get(f.hex);
      liveMap.current.set(f.hex, { hex: f.hex, data: f.data, count: (prev?.count ?? 0) + 1 });
      if (flushRef.current === null) {
        flushRef.current = window.setTimeout(() => {
          setSnifferMap(new Map(liveMap.current));
          flushRef.current = null;
        }, 250);
      }
    }).then(h => { handle = h; }).catch(() => {});
    return () => {
      handle?.remove();
      if (flushRef.current !== null) { clearTimeout(flushRef.current); flushRef.current = null; }
    };
  }, [snifferOn]);

  const handleSave = useCallback(async () => {
    const parsed: Partial<CanIdConfig> = {};
    for (const [k, v] of Object.entries(editIds) as [keyof CanIdConfig, string][]) {
      const n = parseInt(v.replace(/^0x/i, ''), 16);
      if (!isNaN(n) && n > 0 && n <= 0x7FF) (parsed as Record<string, number>)[k] = n;
    }
    if (isNative && CarLauncher.setCanIds) await CarLauncher.setCanIds(parsed).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [editIds]);

  const assign = useCallback((signal: keyof CanIdConfig, hex: string) => {
    setEditIds(prev => ({ ...prev, [signal]: hex }));
    setAssignTarget(null);
  }, []);

  const entries = [...snifferMap.values()].sort((a, b) => a.hex.localeCompare(b.hex));

  return (
    <div className="flex flex-col gap-3">

      {/* ── CAN ID Yapılandırması ── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Sinyal → CAN ID
          </span>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
            style={saved
              ? { background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399' }
              : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.45)' }}
          >
            <Save className="w-3 h-3" />
            {saved ? 'Kaydedildi' : 'Kaydet'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SIGNAL_LABELS) as (keyof CanIdConfig)[]).map(sig => (
            <div key={sig}
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-[9px] font-black uppercase tracking-widest w-16 shrink-0 truncate"
                style={{ color: 'rgba(255,255,255,0.35)' }}>
                {SIGNAL_LABELS[sig]}
              </span>
              <input
                type="text"
                value={editIds[sig]}
                onChange={e => setEditIds(prev => ({ ...prev, [sig]: e.target.value }))}
                className="flex-1 min-w-0 bg-transparent text-[11px] font-mono outline-none border-none"
                style={{ color: 'rgba(255,255,255,0.75)', caretColor: '#60a5fa' }}
                placeholder="0x000"
              />
            </div>
          ))}
        </div>

        <p className="text-[9px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.22)' }}>
          Hex formatında girin (örn. 0x1A0 veya 1A0). Sniffer'dan otomatik atamak için aşağıdaki tabloya tıklayın.
        </p>
      </div>

      {/* ── CAN Sniffer ── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" style={{ color: snifferOn ? '#34d399' : 'rgba(255,255,255,0.3)' }} />
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
              CAN Sniffer
            </span>
            {snifferOn && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
            )}
          </div>
          <button
            onClick={toggleSniffer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
            style={snifferOn
              ? { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }
              : { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399' }}
          >
            <Activity className="w-3 h-3" />
            {snifferOn ? 'Durdur' : 'Başlat'}
          </button>
        </div>

        {snifferOn && entries.length === 0 && (
          <div className="text-center py-4 text-[11px]" style={{ color: 'rgba(255,255,255,0.22)' }}>
            CAN frame bekleniyor...
          </div>
        )}

        {entries.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="grid gap-1 px-1 pb-1 text-[9px] font-black uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.22)', gridTemplateColumns: '4rem 1fr auto' }}>
              <span>ID</span><span>Veri</span><span className="text-right">Adet</span>
            </div>

            <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto">
              {entries.map(e => (
                <div key={e.hex}>
                  <button
                    onClick={() => setAssignTarget(prev => prev === e.hex ? null : e.hex)}
                    className="w-full grid gap-2 items-center px-2 py-1.5 rounded-lg transition-all text-left"
                    style={{
                      gridTemplateColumns: '4rem 1fr auto',
                      background: assignTarget === e.hex
                        ? 'rgba(96,165,250,0.10)' : 'rgba(255,255,255,0.03)',
                      border: assignTarget === e.hex
                        ? '1px solid rgba(96,165,250,0.25)' : '1px solid transparent',
                    }}
                  >
                    <span className="font-mono text-[10px] font-black" style={{ color: '#22d3ee' }}>{e.hex}</span>
                    <span className="font-mono text-[9px] truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>{e.data}</span>
                    <span className="text-[9px] text-right tabular-nums" style={{ color: 'rgba(255,255,255,0.28)' }}>{e.count}</span>
                  </button>

                  {assignTarget === e.hex && (
                    <div className="flex flex-wrap gap-1.5 px-2 py-2 mt-0.5 rounded-lg"
                      style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}>
                      <span className="text-[9px] font-black uppercase tracking-widest w-full mb-0.5"
                        style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {e.hex} → hangi sinyal?
                      </span>
                      {(Object.keys(SIGNAL_LABELS) as (keyof CanIdConfig)[]).map(sig => (
                        <button
                          key={sig}
                          onClick={() => assign(sig, e.hex)}
                          className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                          style={{
                            background: editIds[sig] === e.hex
                              ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.05)',
                            border: editIds[sig] === e.hex
                              ? '1px solid rgba(52,211,153,0.4)' : '1px solid rgba(255,255,255,0.1)',
                            color: editIds[sig] === e.hex ? '#34d399' : 'rgba(255,255,255,0.45)',
                          }}
                        >
                          {SIGNAL_LABELS[sig]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.22)' }}>
          {snifferOn
            ? 'Aracınızın gönderdiği tüm CAN ID\'leri listeleniyor. Bir satıra tıklayarak hangi sinyale ait olduğunu atayın, ardından Kaydet\'e basın.'
            : 'CAN bus\'u keşfetmek için Sniffer\'ı başlatın. Araç ateşleme açıkken çalıştırın.'}
        </p>
      </div>

    </div>
  );
}
