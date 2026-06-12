import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Save, Radio, Download } from 'lucide-react';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { CarLauncher } from '../../platform/nativePlugin';
import type { CanIdConfig, CanRawFrame } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';
import { useHALStatusStore } from '../../platform/vehicleDataLayer/halStatusStore';
import { TestProtocolPanel }      from '../debug/TestProtocolPanel';
import { CandidateStatusPanel }   from '../debug/CandidateStatusPanel';

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
type EditIds      = Record<keyof CanIdConfig, string>;

function toHex(n: number) {
  return `0x${n.toString(16).toUpperCase().padStart(3, '0')}`;
}

function toEditIds(cfg: CanIdConfig): EditIds {
  return Object.fromEntries(
    (Object.keys(cfg) as (keyof CanIdConfig)[]).map(k => [k, toHex(cfg[k])])
  ) as EditIds;
}

const MAX_DIAG_LINES = 400;

export function CanDiagPanel() {
  const { canPhase, canStatusText } = useHALStatusStore();
  const [editIds, setEditIds] = useState<EditIds>(toEditIds(DEFAULT_IDS));
  const [snifferOn, setSnifferOn]   = useState(false);
  const [snifferMap, setSnifferMap] = useState<Map<string, SnifferEntry>>(new Map());
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [diagLines, setDiagLines]   = useState<string[]>([]);
  // Tanı günlüğünü dosyaya çıkarma durumu (head unit internetsiz → USB/dosya yöneticisiyle al)
  const [diagSaveState, setDiagSaveState] = useState<'idle' | 'saving' | { path: string } | 'error'>('idle');

  const liveMap  = useRef<Map<string, SnifferEntry>>(new Map());
  const flushRef = useRef<number | null>(null);
  const diagRef  = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isNative || !CarLauncher.getCanIds) return;
    CarLauncher.getCanIds()
      .then(ids => setEditIds(toEditIds(ids)))
      .catch(() => {});
  }, []);

  // K24 tanı mesajları
  useEffect(() => {
    if (!isNative) return;
    let handle: { remove(): void } | null = null;
    CarLauncher.addListener('canDiag', ({ msg }: { msg: string }) => {
      setDiagLines(prev => {
        const next = [...prev, msg];
        return next.length > MAX_DIAG_LINES ? next.slice(-MAX_DIAG_LINES) : next;
      });
      // Scroll to bottom
      requestAnimationFrame(() => {
        if (diagRef.current) diagRef.current.scrollTop = diagRef.current.scrollHeight;
      });
    }).then(h => { handle = h; }).catch(() => {});
    return () => { handle?.remove(); };
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

  // Tanı günlüğünü .txt olarak public Documents'a yaz → head unit internetsiz olduğu için
  // pano/paylaşım çalışmaz; tek dosyayı USB/MTP ya da dosya yöneticisiyle çıkarmak en garanti yol.
  const saveDiagToFile = useCallback(async () => {
    if (diagLines.length === 0) return;
    setDiagSaveState('saving');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `caros-can-diag-${stamp}.txt`;
    const header =
      `CarOS Pro — K24 CAN Tanı Günlüğü\n` +
      `Tarih: ${new Date().toLocaleString('tr-TR')}\n` +
      `Satır: ${diagLines.length}\n` +
      `${'='.repeat(48)}\n\n`;
    const body = header + diagLines.join('\n') + '\n';
    try {
      if (!isNative) {
        // Tarayıcı modu: blob indir (geliştirme kolaylığı)
        const blob = new Blob([body], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        setDiagSaveState({ path: `İndirilenler/${fileName}` });
        return;
      }
      // Public Documents → dosya yöneticisi/USB ile görünür. İzin reddedilirse app-özel
      // External klasörüne düş (her zaman yazılabilir, /Android/data/... altında USB'den okunur).
      let savedPath: string;
      try {
        const res = await Filesystem.writeFile({
          path: fileName, data: body, directory: Directory.Documents,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `Documents/${fileName}`;
      } catch {
        const res = await Filesystem.writeFile({
          path: fileName, data: body, directory: Directory.External,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `External/${fileName}`;
      }
      setDiagSaveState({ path: savedPath });
    } catch (e) {
      console.error('[CanDiag] dosya kaydı başarısız', e);
      setDiagSaveState('error');
    }
  }, [diagLines]);

  const entries = [...snifferMap.values()].sort((a, b) => a.hex.localeCompare(b.hex));

  return (
    <div className="flex flex-col gap-3">

      {/* ── CAN ID Yapılandırması ── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.72)' }}>
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
              <span className="text-[11px] font-black uppercase tracking-widest w-16 shrink-0 truncate"
                style={{ color: 'rgba(255,255,255,0.72)' }}>
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

        <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.60)' }}>
          Hex formatında girin (örn. 0x1A0 veya 1A0). Sniffer'dan otomatik atamak için aşağıdaki tabloya tıklayın.
        </p>
      </div>

      {/* ── CAN Sniffer ── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" style={{ color: snifferOn ? '#34d399' : 'rgba(255,255,255,0.3)' }} />
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.72)' }}>
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
          <div className="text-center py-4">
            {(canPhase === 'FALLBACK_ACTIVE' || canPhase === 'FAILED') ? (
              <span className="text-[13px] font-bold leading-snug" style={{ color: '#ef4444' }}>
                {canStatusText || 'CAN verisi alınamadı. Yedek sürüş moduna geçildi.'}
              </span>
            ) : canPhase === 'RETRYING' ? (
              <span className="text-[13px] font-bold leading-snug" style={{ color: '#fbbf24' }}>
                {canStatusText || 'CAN bağlantısı yeniden deneniyor...'}
              </span>
            ) : (
              <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                CAN frame bekleniyor...
              </span>
            )}
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
                    <span className="font-mono text-[9px] truncate" style={{ color: 'rgba(255,255,255,0.72)' }}>{e.data}</span>
                    <span className="text-[9px] text-right tabular-nums" style={{ color: 'rgba(255,255,255,0.62)' }}>{e.count}</span>
                  </button>

                  {assignTarget === e.hex && (
                    <div className="flex flex-wrap gap-1.5 px-2 py-2 mt-0.5 rounded-lg"
                      style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}>
                      <span className="text-[9px] font-black uppercase tracking-widest w-full mb-0.5"
                        style={{ color: 'rgba(255,255,255,0.72)' }}>
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

        <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.60)' }}>
          {snifferOn
            ? 'Aracınızın gönderdiği tüm CAN ID\'leri listeleniyor. Bir satıra tıklayarak hangi sinyale ait olduğunu atayın, ardından Kaydet\'e basın.'
            : 'CAN bus\'u keşfetmek için Sniffer\'ı başlatın. Araç ateşleme açıkken çalıştırın.'}
        </p>
      </div>

      {/* ── K24 Tanı Günlüğü ── */}
      {diagLines.length > 0 && (
        <div className="glass-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.72)' }}>
              K24 Tanı Günlüğü
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={saveDiagToFile}
                disabled={diagSaveState === 'saving'}
                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg active:scale-95"
                style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)', color: '#60a5fa' }}
              >
                <Download className="w-3 h-3" />
                {diagSaveState === 'saving' ? 'Kaydediliyor…' : 'Dosyaya Kaydet'}
              </button>
              <button
                onClick={() => { setDiagLines([]); setDiagSaveState('idle'); }}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
              >
                Temizle
              </button>
            </div>
          </div>

          {typeof diagSaveState === 'object' && (
            <div className="px-1 py-1.5 rounded-lg text-[10px] leading-relaxed break-all"
              style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)', color: '#34d399' }}>
              ✓ Kaydedildi → <span className="font-mono">{diagSaveState.path}</span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>
                USB kablo (MTP) veya dosya yöneticisiyle bu .txt'yi al, sohbete yükle.
              </span>
            </div>
          )}
          {diagSaveState === 'error' && (
            <div className="px-1 py-1.5 rounded-lg text-[10px]"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              Dosya yazılamadı — depolama izni reddedildi. Ekran görüntüsü al.
            </div>
          )}
          <div
            ref={diagRef}
            className="flex flex-col gap-0.5 max-h-[75vh] overflow-y-auto font-mono"
          >
            {diagLines.map((line, i) => (
              <span
                key={i}
                className="text-[10px] leading-relaxed px-1"
                style={{
                  color: line.includes('[MARKER]')    ? '#f59e0b'     // test marker — amber
                       : line.includes('TRANSACT HIT') ? '#a78bfa'    // binder hit — violet
                       : line.includes('ContentProvider HIT') ? '#34d399' // provider hit — green
                       : line.startsWith('BULUNDU')    ? '#34d399'
                       : line.includes('INTENT ts=')   ? '#38bdf8'    // broadcast — sky blue
                       : line.startsWith('İzin')       ? '#f87171'
                       : line.startsWith('URI yanıt')  ? '#fbbf24'
                       : 'rgba(255,255,255,0.55)',
                }}
              >
                {line}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── CAN Sinyal Doğrulama ── */}
      <div className="glass-card p-4">
        <CandidateStatusPanel />
      </div>

      {/* ── Test Protokolü ── */}
      <div className="glass-card p-4">
        <TestProtocolPanel />
      </div>

    </div>
  );
}
