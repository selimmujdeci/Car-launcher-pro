/**
 * SuperAdminShell — Sistem Komuta Merkezi
 *
 * Faz 3: Mobilden write yetenekleri + audit trail.
 * GİZLİLİK: Bireysel araç/kullanıcı verisi gösterilmez — anonim toplamlar.
 * Mali-400 uyumlu: opacity geçişleri, blur/gradient yok.
 */

import { useEffect, useState, useRef } from 'react';
import {
  ShieldAlert, ServerCrash, Flag, ChevronRight,
  Loader2, ChevronDown, ChevronUp, AlertTriangle, X,
} from 'lucide-react';
import { useRoleStore }             from '../../platform/roleSystem/RoleStore';
import { AdminLoginForm }          from './AdminLoginForm';
import {
  getFleetHealthSummary,
  getCriticalCount24h,
  getActiveFlagCount,
  getFeatureFlags,
  updateFeatureFlag,
  activateFleetLimpMode,
  getRecentIncidents,
  subscribeToCriticalEvents,
  type FleetHealthSummary,
  type FeatureFlag,
  type RecentIncident,
} from '../../platform/superadmin/superAdminService';
import { IncidentReplayLite } from './IncidentReplayLite';

// ── Renkler ───────────────────────────────────────────────────────────────────

const BG   = '#0a0a0a';
const SURF = '#111111';
const BORD = '#1c1c1c';
const TEXT = '#e5e7eb';
const MUTED= '#4b5563';
const DIM  = '#2d3748';
const RED  = '#dc2626';
const GREEN= '#4ade80';
const BLUE = '#60a5fa';
const AMB  = '#d97706';

// ── SuperAdminShell ───────────────────────────────────────────────────────────

export function SuperAdminShell() {
  const { role, syncStatus, syncWithSupabase, adminAuthState } = useRoleStore();

  // ── Read state
  const [fleet,    setFleet]    = useState<FleetHealthSummary | null>(null);
  const [critical, setCritical] = useState<number | null>(null);
  const [flagMeta, setFlagMeta] = useState<{ enabled: number; total: number } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [fetchErr, setFetchErr] = useState(false);
  const [newCritical, setNewCritical] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // ── Flags panel state
  const [showFlags,     setShowFlags]     = useState(false);
  const [flagsList,     setFlagsList]     = useState<FeatureFlag[]>([]);
  const [flagsLoading,  setFlagsLoading]  = useState(false);
  const [togglingFlag,  setTogglingFlag]  = useState<string | null>(null);
  const [flagError,     setFlagError]     = useState<string | null>(null);

  // ── Incident state
  const [incidents,      setIncidents]      = useState<RecentIncident[]>([]);
  const [incLoading,     setIncLoading]     = useState(false);
  const [replayIncident, setReplayIncident] = useState<RecentIncident | null>(null);

  // ── Limp Mode state
  const [showLimpModal, setShowLimpModal] = useState(false);
  const [executingLimp, setExecutingLimp] = useState(false);
  const [limpError,     setLimpError]     = useState<string | null>(null);
  const [limpSuccess,   setLimpSuccess]   = useState(false);

  // Yetki doğrula
  useEffect(() => { void syncWithSupabase(); }, [syncWithSupabase]);

  // Veri yükle
  useEffect(() => {
    if (role !== 'super_admin') return;
    let cancelled = false;
    setLoading(true);
    setFetchErr(false);

    async function loadData() {
      try {
        const [f, c, fl] = await Promise.all([
          getFleetHealthSummary(1),
          getCriticalCount24h(),
          getActiveFlagCount(),
        ]);
        if (!cancelled) { setFleet(f); setCritical(c); setFlagMeta(fl); }
      } catch {
        if (!cancelled) setFetchErr(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadIncidents() {
      if (cancelled) return;
      setIncLoading(true);
      try {
        const inc = await getRecentIncidents(10);
        if (!cancelled) setIncidents(inc);
      } catch { /* silent */ }
      finally { if (!cancelled) setIncLoading(false); }
    }

    void loadData();
    void loadIncidents();

    unsubRef.current = subscribeToCriticalEvents((_payload) => {
      if (!cancelled) {
        setCritical((p) => (p ?? 0) + 1);
        setNewCritical(true);
        setTimeout(() => { if (!cancelled) setNewCritical(false); }, 3000);
        // Yeni kritik olay → incident listesini yenile
        void getRecentIncidents(10).then((inc) => {
          if (!cancelled) setIncidents(inc);
        });
      }
    });

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [role]);

  // Flags paneli aç/kapat
  async function handleToggleFlags() {
    const next = !showFlags;
    setShowFlags(next);
    if (next && flagsList.length === 0) {
      setFlagsLoading(true);
      try { setFlagsList(await getFeatureFlags()); }
      catch { setFlagError('Flag listesi alınamadı'); }
      finally { setFlagsLoading(false); }
    }
  }

  // Flag toggle
  async function handleFlagToggle(flag: FeatureFlag) {
    if (togglingFlag) return;
    setTogglingFlag(flag.key);
    setFlagError(null);
    try {
      await updateFeatureFlag(flag.key, !flag.enabled);
      setFlagsList((prev) =>
        prev.map((f) => f.key === flag.key ? { ...f, enabled: !f.enabled } : f),
      );
      setFlagMeta((m) => m ? {
        ...m,
        enabled: m.enabled + (flag.enabled ? -1 : 1),
      } : m);
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : 'Güncelleme başarısız');
    } finally {
      setTogglingFlag(null);
    }
  }

  // Limp Mode
  async function handleLimpMode() {
    setExecutingLimp(true);
    setLimpError(null);
    try {
      await activateFleetLimpMode();
      setLimpSuccess(true);
      setShowLimpModal(false);
      // Flags listesini yenile
      setFlagsList(await getFeatureFlags());
      setFlagMeta(await getActiveFlagCount());
    } catch (e) {
      setLimpError(e instanceof Error ? e.message : 'İşlem başarısız');
    } finally {
      setExecutingLimp(false);
    }
  }

  // Recovery modu — deep link ile gelindi
  if (adminAuthState === 'recovery' || adminAuthState === 'updating_pw') {
    return <AdminLoginForm mode="reset-confirm" />;
  }

  // Giriş yapılmamış → login formu göster
  if (role !== 'super_admin' && adminAuthState !== 'signing_in') {
    // syncStatus 'syncing' → loading göster, aksi halde login formu
    if (syncStatus === 'syncing' || adminAuthState === 'idle') {
      return <AdminLoginForm mode="login" />;
    }
    return <AdminLoginForm mode="login" />;
  }

  // Giriş yapılıyor
  if (adminAuthState === 'signing_in') {
    return <AccessDenied syncStatus="syncing" />;
  }

  // Giriş yapıldı ama yetki yok (allowlist dışı vs.)
  if (role !== 'super_admin') {
    return <AccessDenied syncStatus={syncStatus} />;
  }

  if (fetchErr) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        background:BG, flexDirection:'column', gap:8, padding:24 }}>
        <ServerCrash size={24} style={{ color: AMB }} />
        <p style={{ fontFamily:'monospace', fontSize:10, color:MUTED, letterSpacing:'0.08em' }}>
          NETWORK_ERROR: Veri çekilemedi
        </p>
      </div>
    );
  }

  const score      = fleet?.stabilityScore ?? 100;
  const scoreColor = score >= 80 ? GREEN : score >= 60 ? AMB : RED;
  const critCount  = critical ?? 0;
  const critAccent = critCount > 0 ? RED : GREEN;

  return (
    <div style={{ flex:1, overflowY:'auto', background:BG, fontFamily:'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ padding:'20px 20px 16px', borderBottom:`1px solid ${BORD}`, background:'#080808' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            width:36, height:36, borderRadius:8,
            background:'rgba(220,38,38,0.1)', border:`1px solid rgba(220,38,38,0.25)`,
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            <ShieldAlert size={18} style={{ color:RED }} />
          </div>
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:RED, letterSpacing:'0.14em', textTransform:'uppercase' }}>
              SİSTEM KOMUTA MERKEZİ
            </p>
            <p style={{ fontSize:9, color:DIM, letterSpacing:'0.08em', marginTop:2 }}>
              SUPER_ADMIN · {syncStatus === 'verified' ? 'JWT DOĞRULANDI' : 'SYNCING...'}
              {newCritical && <span style={{ color:RED, marginLeft:8 }}>● YENİ KRİTİK OLAY</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Kartlar */}
      <div style={{ padding:'16px 16px', display:'flex', flexDirection:'column', gap:1 }}>

        {/* Filo Durumu */}
        <StatusCard
          icon={<ServerCrash size={16} style={{ color:scoreColor }} />}
          title="Filo Durumu"
          accent={scoreColor}
          loading={loading && !fleet}
          value={fleet ? `%${score}` : undefined}
          valueColor={scoreColor}
          sub={fleet
            ? `${fleet.totalEvents} event / son ${fleet.windowHours}sa · ${fleet.criticalCount} kritik`
            : 'vehicle_events bekleniyor'}
        />

        {/* Hata Kayıtları */}
        <StatusCard
          icon={<ShieldAlert size={16} style={{ color:critAccent }} />}
          title="Hata Kayıtları"
          accent={critAccent}
          loading={loading && critical === null}
          value={critCount > 0 ? `${critCount} KRİTİK` : 'TEMİZ'}
          valueColor={critAccent}
          sub={`Son 24 saat · ${critCount === 0 ? 'kritik olay yok' : `${critCount} acil durum`}`}
          urgent={critCount > 0}
        />

        {/* KRİTİK OLAY AKIŞI */}
        <IncidentFeed
          incidents={incidents}
          loading={incLoading}
          onSelect={setReplayIncident}
        />

        {/* Feature Flags — tıklanabilir */}
        <div>
          <button
            onClick={() => { void handleToggleFlags(); }}
            style={{
              width:'100%', textAlign:'left', cursor:'pointer',
              background: SURF, border:`1px solid ${showFlags ? `${BLUE}40` : BORD}`,
              borderRadius:4, padding:'12px 14px',
              display:'flex', alignItems:'center', gap:12,
              borderLeft:`3px solid ${BLUE}40`,
            }}
          >
            <div style={{
              width:32, height:32, borderRadius:6,
              background:`${BLUE}10`, border:`1px solid ${BLUE}20`,
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}>
              <Flag size={16} style={{ color:BLUE }} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:11, fontWeight:600, color:TEXT, letterSpacing:'0.04em' }}>Feature Flags</p>
              <p style={{ fontSize:10, color:MUTED, marginTop:2 }}>
                {flagMeta ? `${flagMeta.enabled} aktif · ${flagMeta.total - flagMeta.enabled} kapalı` : 'Yükleniyor...'}
              </p>
            </div>
            {showFlags
              ? <ChevronUp size={14} style={{ color:DIM }} />
              : <ChevronDown size={14} style={{ color:DIM }} />}
          </button>

          {/* Expanded flags list */}
          {showFlags && (
            <div style={{
              background:'#0d0d0d', border:`1px solid ${BORD}`,
              borderTop:'none', borderRadius:'0 0 4px 4px', padding:'8px 0',
            }}>
              {flagError && (
                <p style={{ fontSize:10, color:RED, padding:'4px 14px', fontFamily:'monospace' }}>
                  {flagError}
                </p>
              )}
              {flagsLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:16 }}>
                  <Loader2 size={14} style={{ color:MUTED, animation:'spin 1s linear infinite' }} />
                </div>
              ) : flagsList.length === 0 ? (
                <p style={{ fontSize:10, color:DIM, padding:'8px 14px', fontFamily:'monospace' }}>
                  FLAG_EMPTY: Tablo boş
                </p>
              ) : (
                flagsList.map((flag) => (
                  <FlagRow
                    key={flag.key}
                    flag={flag}
                    toggling={togglingFlag === flag.key}
                    onToggle={() => { void handleFlagToggle(flag); }}
                  />
                ))
              )}
            </div>
          )}
        </div>

      </div>

      {/* ACİL DURUM MÜDAHALESİ */}
      <div style={{ padding:'0 16px 8px' }}>
        <p style={{
          fontSize:9, fontWeight:700, color:DIM,
          letterSpacing:'0.14em', textTransform:'uppercase',
          marginBottom:8,
        }}>
          ACİL DURUM MÜDAHALESİ
        </p>

        {limpSuccess && (
          <p style={{ fontSize:10, color:GREEN, fontFamily:'monospace',
            marginBottom:8, letterSpacing:'0.06em' }}>
            ✓ LIMP_MODE_ACTIVATED — Tüm kritik flagler devre dışı
          </p>
        )}
        {limpError && (
          <p style={{ fontSize:10, color:RED, fontFamily:'monospace',
            marginBottom:8, letterSpacing:'0.06em' }}>
            ✗ {limpError}
          </p>
        )}

        <button
          onClick={() => setShowLimpModal(true)}
          disabled={executingLimp || limpSuccess}
          style={{
            width:'100%', padding:'14px 16px',
            background: limpSuccess ? 'rgba(74,222,128,0.06)' : 'rgba(220,38,38,0.08)',
            border: `1px solid ${limpSuccess ? `${GREEN}40` : RED}`,
            borderRadius:6, cursor: executingLimp || limpSuccess ? 'not-allowed' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:10,
            opacity: executingLimp || limpSuccess ? 0.6 : 1,
            // CSS pulse animation — Mali-400 uyumlu
            animation: limpSuccess ? 'none' : 'sa-emergency-pulse 1.6s ease-in-out infinite',
          }}
        >
          {executingLimp ? (
            <Loader2 size={14} style={{ color:RED, animation:'spin 1s linear infinite' }} />
          ) : (
            <AlertTriangle size={14} style={{ color: limpSuccess ? GREEN : RED }} />
          )}
          <span style={{
            fontSize:11, fontWeight:700,
            color: limpSuccess ? GREEN : RED,
            letterSpacing:'0.12em', textTransform:'uppercase',
            fontFamily:'monospace',
          }}>
            {executingLimp ? 'İŞLENİYOR...' : limpSuccess ? 'LIMP MODE AKTİF' : 'FLEET LIMP MODE'}
          </span>
        </button>
      </div>

      {/* Pulse animation keyframe — inline style ile */}
      <style>{`
        @keyframes sa-emergency-pulse {
          0%,100% { border-color: #dc2626; }
          50%      { border-color: #7f1d1d; }
        }
      `}</style>

      {/* Web paneli linki */}
      <div style={{ padding:'12px 16px 28px' }}>
        <div style={{
          background:SURF, border:`1px solid ${BORD}`,
          borderRadius:6, padding:'12px 14px',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <p style={{ flex:1, fontSize:11, color:MUTED, letterSpacing:'0.04em' }}>
            Tam yönetim için carospro.com/admin adresini ziyaret edin.
          </p>
          <ChevronRight size={14} style={{ color:DIM, flexShrink:0 }} />
        </div>
      </div>

      {/* Incident Replay Modal */}
      {replayIncident && (
        <IncidentReplayLite
          incident={replayIncident}
          onClose={() => setReplayIncident(null)}
        />
      )}

      {/* Limp Mode Onay Modalı */}
      {showLimpModal && (
        <LimpModeModal
          onConfirm={() => { void handleLimpMode(); }}
          onCancel={() => setShowLimpModal(false)}
          executing={executingLimp}
          error={limpError}
        />
      )}
    </div>
  );
}

// ── StatusCard ────────────────────────────────────────────────────────────────

function StatusCard({
  icon, title, accent, loading, value, valueColor, sub, urgent,
}: {
  icon:React.ReactNode; title:string; accent:string; loading:boolean;
  value?:string; valueColor:string; sub:string; urgent?:boolean;
}) {
  return (
    <div style={{
      background:SURF, border:`1px solid ${urgent ? `${RED}40` : BORD}`,
      borderRadius:4, padding:'12px 14px',
      display:'flex', alignItems:'center', gap:12, borderLeft:`3px solid ${accent}40`,
    }}>
      <div style={{
        width:32, height:32, borderRadius:6,
        background:`${accent}10`, border:`1px solid ${accent}20`,
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}>
        {icon}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:11, fontWeight:600, color:TEXT, letterSpacing:'0.04em' }}>{title}</p>
        <p style={{ fontSize:10, color:MUTED, marginTop:2,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{sub}</p>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        {loading
          ? <Loader2 size={12} style={{ color:MUTED, animation:'spin 1s linear infinite' }} />
          : <p style={{ fontFamily:'monospace', fontSize:11, fontWeight:700,
              color:valueColor, letterSpacing:'0.06em', textTransform:'uppercase' }}>
              {value ?? '—'}
            </p>
        }
      </div>
    </div>
  );
}

// ── FlagRow ────────────────────────────────────────────────────────────────────

function FlagRow({ flag, toggling, onToggle }: {
  flag: FeatureFlag; toggling: boolean; onToggle: () => void;
}) {
  const color = flag.enabled ? GREEN : MUTED;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'9px 14px',
      borderBottom:`1px solid ${BORD}`, opacity: toggling ? 0.5 : 1,
      transition:'opacity 150ms ease',
    }}>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:11, color:TEXT, fontWeight:500 }}>{flag.name || flag.key}</p>
        <p style={{ fontSize:9, color:DIM, fontFamily:'monospace', marginTop:1 }}>{flag.key}</p>
      </div>
      {toggling ? (
        <Loader2 size={12} style={{ color:MUTED, animation:'spin 1s linear infinite' }} />
      ) : (
        <button
          onClick={onToggle}
          style={{
            width:40, height:22, borderRadius:11,
            background: flag.enabled ? `${GREEN}25` : `${MUTED}20`,
            border:`1px solid ${color}40`,
            cursor:'pointer', position:'relative', flexShrink:0,
            transition:'background 150ms ease',
          }}
        >
          <div style={{
            position:'absolute', top:3,
            left: flag.enabled ? 21 : 3,
            width:14, height:14, borderRadius:'50%',
            background: color,
            transition:'left 150ms ease',
          }} />
        </button>
      )}
    </div>
  );
}

// ── LimpModeModal ─────────────────────────────────────────────────────────────

function LimpModeModal({ onConfirm, onCancel, executing, error }: {
  onConfirm: () => void; onCancel: () => void; executing: boolean; error: string | null;
}) {
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(0,0,0,0.88)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div style={{
        width:'100%', maxWidth:360,
        background:'#0a0a0a', border:`1px solid ${RED}`,
        borderRadius:6, overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding:'12px 16px', borderBottom:`1px solid rgba(220,38,38,0.3)`,
          background:'rgba(220,38,38,0.06)',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <AlertTriangle size={14} style={{ color:RED }} />
            <span style={{
              fontFamily:'monospace', fontSize:10, fontWeight:700,
              color:RED, letterSpacing:'0.12em', textTransform:'uppercase',
            }}>
              ACİL DURUM ONAY
            </span>
          </div>
          {!executing && (
            <button onClick={onCancel} style={{
              background:'transparent', border:'none', cursor:'pointer',
              color:MUTED, padding:2,
            }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding:'16px 16px' }}>
          <p style={{ fontSize:12, color:MUTED, fontFamily:'system-ui', lineHeight:1.5, marginBottom:12 }}>
            <strong style={{ color:RED }}>TÜM FİLOYU KISITLAMAK İSTEDİĞİNİZE EMİN MİSİNİZ?</strong>
          </p>
          <p style={{ fontSize:11, color:DIM, fontFamily:'system-ui', lineHeight:1.5, marginBottom:8 }}>
            Bu işlem CRM, Hazard Intelligence, Safety Co-Pilot ve diğer tüm kritik flagleri
            devre dışı bırakır. Araçlar 10 dakika içinde etkilenecektir.
          </p>
          <div style={{
            background:'rgba(220,38,38,0.04)', border:`1px solid rgba(220,38,38,0.2)`,
            borderRadius:4, padding:'8px 12px', marginBottom:8,
          }}>
            <p style={{ fontFamily:'monospace', fontSize:10, color:RED }}>
              CRM · Hazard Intelligence · Safety Co-Pilot · Predictive Intelligence · Voice Extras
            </p>
          </div>
          {error && (
            <p style={{ fontFamily:'monospace', fontSize:10, color:RED, marginTop:8 }}>
              ✗ {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display:'flex', justifyContent:'flex-end', gap:8,
          padding:'10px 16px', borderTop:`1px solid ${BORD}`,
        }}>
          <button
            onClick={onCancel}
            disabled={executing}
            style={{
              padding:'6px 14px', background:'transparent',
              border:`1px solid ${BORD}`, borderRadius:4,
              color:MUTED, cursor:'pointer',
              fontFamily:'monospace', fontSize:9, fontWeight:700,
              letterSpacing:'0.08em', textTransform:'uppercase',
            }}
          >
            VAZGEÇ
          </button>
          <button
            onClick={onConfirm}
            disabled={executing}
            style={{
              padding:'6px 14px',
              background:'rgba(220,38,38,0.12)', border:`1px solid ${RED}`,
              borderRadius:4, cursor: executing ? 'not-allowed' : 'pointer',
              color:RED, fontFamily:'monospace', fontSize:9, fontWeight:700,
              letterSpacing:'0.08em', textTransform:'uppercase',
              display:'flex', alignItems:'center', gap:6, opacity: executing ? 0.6 : 1,
            }}
          >
            {executing && <Loader2 size={10} style={{ animation:'spin 1s linear infinite' }} />}
            {executing ? 'İŞLENİYOR...' : 'ONAYLA — LIMP MODE'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── IncidentFeed ──────────────────────────────────────────────────────────────

function IncidentFeed({
  incidents, loading, onSelect,
}: {
  incidents: RecentIncident[];
  loading:   boolean;
  onSelect:  (inc: RecentIncident) => void;
}) {
  function fmtTs(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return '--:--'; }
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 0 6px',
      }}>
        <p style={{
          fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
          color: DIM, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          KRİTİK OLAY AKIŞI
        </p>
        {loading && <Loader2 size={10} style={{ color: DIM, animation: 'spin 1s linear infinite' }} />}
      </div>

      {incidents.length === 0 && !loading ? (
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: DIM, padding: '4px 0' }}>
          FEED_EMPTY: Kayıtlı kritik olay yok
        </p>
      ) : (
        <div style={{
          background: SURF, border: `1px solid ${BORD}`,
          borderRadius: 4, overflow: 'hidden',
        }}>
          {incidents.map((inc, idx) => {
            const color = inc.severity === 'critical' ? RED : AMB;
            return (
              <button
                key={inc.id}
                onClick={() => onSelect(inc)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: idx < incidents.length - 1 ? `1px solid ${BORD}` : 'none',
                  transition: 'background 100ms ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#161616'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {/* Severity dot */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: color, flexShrink: 0,
                }} />

                {/* Timestamp */}
                <span style={{
                  fontFamily: 'monospace', fontSize: 9, color: DIM,
                  flexShrink: 0, minWidth: 54,
                }}>
                  {fmtTs(inc.ts)}
                </span>

                {/* DeviceHash */}
                <span style={{
                  fontFamily: 'monospace', fontSize: 9, color: MUTED,
                  flexShrink: 0,
                }}>
                  dev:{inc.deviceHash}
                </span>

                {/* Health */}
                <span style={{
                  fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                  color, flexShrink: 0, textTransform: 'uppercase',
                }}>
                  {inc.overallHealth}
                </span>

                {/* Thermal */}
                <span style={{
                  fontFamily: 'monospace', fontSize: 9,
                  color: inc.thermalLevel >= 2 ? AMB : DIM, marginLeft: 'auto',
                }}>
                  T:L{inc.thermalLevel}
                </span>

                <ChevronRight size={10} style={{ color: DIM, flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── AccessDenied (giriş yapmış ama yetkisiz) ─────────────────────────────────

function AccessDenied({ syncStatus }: { syncStatus: string }) {
  const { signOutAdmin } = useRoleStore();
  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
      background:BG, flexDirection:'column', gap:12, padding:24 }}>
      {syncStatus === 'syncing'
        ? <Loader2 size={24} style={{ color:MUTED, animation:'spin 1s linear infinite' }} />
        : <ShieldAlert size={28} style={{ color:RED }} />}
      <p style={{ fontFamily:'monospace', fontSize:11, color:MUTED, letterSpacing:'0.08em' }}>
        {syncStatus === 'syncing' ? 'YETKİ DOĞRULANIYORU...' : 'ERİŞİM REDDEDİLDİ'}
      </p>
      {syncStatus !== 'syncing' && (
        <button
          onClick={() => { void signOutAdmin(); }}
          style={{
            marginTop:8, padding:'5px 14px',
            background:'transparent', border:`1px solid ${BORD}`, borderRadius:4,
            color:MUTED, cursor:'pointer',
            fontFamily:'monospace', fontSize:9, fontWeight:700,
            letterSpacing:'0.08em', textTransform:'uppercase',
          }}
        >
          ÇIKIŞ YAP
        </button>
      )}
    </div>
  );
}
