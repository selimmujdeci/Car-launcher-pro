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
  LogOut, Activity, GitBranch, SlidersHorizontal, ScrollText,
  Check, Pencil,
} from 'lucide-react';
import { useRoleStore, getAdminClient } from '../../platform/roleSystem/RoleStore';
import { AdminLoginForm }              from './AdminLoginForm';
import { DiagnosticsBridgeLite }       from './DiagnosticsBridgeLite';
import { RolloutControlLite, RolloutKeyframes } from './RolloutControlLite';
import {
  getFleetHealthSummary,
  getCriticalCount24h,
  getActiveFlagCount,
  getFeatureFlags,
  updateFeatureFlag,
  activateFleetLimpMode,
  getRecentIncidents,
  subscribeToCriticalEvents,
  getSystemPolicies,
  updatePolicy,
  getAuditLogEntries,
  type FleetHealthSummary,
  type FeatureFlag,
  type RecentIncident,
  type SystemPolicy,
  type AuditLogEntry,
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
  const { role, syncStatus, syncWithSupabase, adminAuthState, signOutAdmin } = useRoleStore();

  const [adminEmail, setAdminEmail] = useState<string>('');

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
  const [diagIncident,   setDiagIncident]   = useState<RecentIncident | null>(null);

  // ── Limp Mode state
  const [showLimpModal, setShowLimpModal] = useState(false);
  const [executingLimp, setExecutingLimp] = useState(false);
  const [limpError,     setLimpError]     = useState<string | null>(null);
  const [limpSuccess,   setLimpSuccess]   = useState(false);

  // ── Rollout state
  const [showRollout, setShowRollout] = useState(false);

  // ── Policies state
  const [showPolicies,    setShowPolicies]    = useState(false);
  const [policiesList,    setPoliciesList]    = useState<SystemPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [editingPolicyKey,  setEditingPolicyKey]  = useState<string | null>(null);
  const [editingValue,      setEditingValue]      = useState('');
  const [confirmingPolicy,  setConfirmingPolicy]  = useState<string | null>(null);
  const [savingPolicyKey,   setSavingPolicyKey]   = useState<string | null>(null);
  const [policyError,       setPolicyError]       = useState<string | null>(null);

  // ── Audit Log state
  const [auditEntries,  setAuditEntries]  = useState<AuditLogEntry[]>([]);
  const [auditLoading,  setAuditLoading]  = useState(false);

  // Admin e-postasını al
  useEffect(() => {
    void getAdminClient()?.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setAdminEmail(data.user.email);
    });
  }, []);

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

    async function loadAuditLog() {
      if (cancelled) return;
      setAuditLoading(true);
      try {
        const entries = await getAuditLogEntries(15);
        if (!cancelled) setAuditEntries(entries);
      } catch { /* silent */ }
      finally { if (!cancelled) setAuditLoading(false); }
    }

    void loadData();
    void loadIncidents();
    void loadAuditLog();

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

  // Policies paneli aç/kapat
  async function handleTogglePolicies() {
    const next = !showPolicies;
    setShowPolicies(next);
    if (next && policiesList.length === 0) {
      setPoliciesLoading(true);
      try { setPoliciesList(await getSystemPolicies()); }
      catch { /* silent */ }
      finally { setPoliciesLoading(false); }
    }
  }

  // Policy kaydet (çift onay flow'unda ikinci adım)
  async function handlePolicySave(key: string) {
    setSavingPolicyKey(key);
    setPolicyError(null);
    try {
      await updatePolicy(key, editingValue);
      setPoliciesList((prev) =>
        prev.map((p) => p.key === key ? { ...p, value: editingValue, updatedAt: new Date().toISOString() } : p),
      );
      // Audit log'u yenile
      void getAuditLogEntries(15).then(setAuditEntries);
      setEditingPolicyKey(null);
      setConfirmingPolicy(null);
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : 'Kaydetme başarısız');
    } finally {
      setSavingPolicyKey(null);
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
      <div style={{ padding:'14px 16px 12px', borderBottom:`0.5px solid ${BORD}`, background:'#080808' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            width:34, height:34, borderRadius:8,
            background:'rgba(220,38,38,0.1)', border:`0.5px solid rgba(220,38,38,0.25)`,
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            <ShieldAlert size={17} style={{ color:RED }} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:11, fontWeight:700, color:RED, letterSpacing:'0.14em', textTransform:'uppercase' }}>
              SİSTEM KOMUTA MERKEZİ
            </p>
            <p style={{ fontSize:9, color:MUTED, letterSpacing:'0.06em', marginTop:2,
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {adminEmail || 'SUPER_ADMIN'} · {syncStatus === 'verified' ? 'JWT DOĞRULANDI' : 'SYNCING...'}
              {newCritical && <span style={{ color:RED, marginLeft:8 }}>● YENİ KRİTİK OLAY</span>}
            </p>
          </div>
          {/* Çıkış Yap */}
          <button
            onClick={() => { void signOutAdmin(); }}
            title="Çıkış Yap"
            style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'5px 10px',
              background:'transparent', border:`0.5px solid ${BORD}`,
              borderRadius:4, cursor:'pointer',
              color:MUTED, flexShrink:0,
              fontFamily:'monospace', fontSize:9, fontWeight:700,
              letterSpacing:'0.08em', textTransform:'uppercase',
            }}
          >
            <LogOut size={11} />
            ÇIKIŞ
          </button>
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
          onDiagnostics={setDiagIncident}
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

        {/* DAĞITIM MERKEZİ — Rollout modal açar */}
        <button
          onClick={() => setShowRollout(true)}
          style={{
            width:'100%', textAlign:'left', cursor:'pointer',
            background: SURF, border:`0.5px solid ${BORD}`,
            borderRadius:4, padding:'12px 14px',
            display:'flex', alignItems:'center', gap:12,
            borderLeft:`3px solid ${BLUE}40`,
          }}
        >
          <div style={{
            width:32, height:32, borderRadius:6,
            background:`${BLUE}10`, border:`0.5px solid ${BLUE}20`,
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            <GitBranch size={15} style={{ color:BLUE }} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:11, fontWeight:600, color:TEXT, letterSpacing:'0.04em' }}>Dağıtım Merkezi</p>
            <p style={{ fontSize:10, color:MUTED, marginTop:2 }}>Canary planları · Rollout kontrolü</p>
          </div>
          <ChevronRight size={13} style={{ color:DIM, flexShrink:0 }} />
        </button>

        {/* SİSTEM POLİTİKALARI */}
        <div>
          <button
            onClick={() => { void handleTogglePolicies(); }}
            style={{
              width:'100%', textAlign:'left', cursor:'pointer',
              background: SURF, border:`0.5px solid ${showPolicies ? `${AMB}40` : BORD}`,
              borderRadius:4, padding:'12px 14px',
              display:'flex', alignItems:'center', gap:12,
              borderLeft:`3px solid ${AMB}40`,
            }}
          >
            <div style={{
              width:32, height:32, borderRadius:6,
              background:`${AMB}10`, border:`0.5px solid ${AMB}20`,
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}>
              <SlidersHorizontal size={15} style={{ color:AMB }} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:11, fontWeight:600, color:TEXT, letterSpacing:'0.04em' }}>Sistem Politikaları</p>
              <p style={{ fontSize:10, color:MUTED, marginTop:2 }}>
                {policiesList.length > 0 ? `${policiesList.length} politika` : 'Termal · Bellek · Sync'}
              </p>
            </div>
            {showPolicies
              ? <ChevronUp size={13} style={{ color:DIM }} />
              : <ChevronDown size={13} style={{ color:DIM }} />}
          </button>

          {showPolicies && (
            <div style={{
              background:'#0d0d0d', border:`0.5px solid ${BORD}`,
              borderTop:'none', borderRadius:'0 0 4px 4px',
            }}>
              {policyError && (
                <p style={{ fontSize:9, color:RED, padding:'6px 14px', fontFamily:'monospace', letterSpacing:'0.06em' }}>
                  ✗ {policyError}
                </p>
              )}
              {policiesLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:16 }}>
                  <Loader2 size={13} style={{ color:MUTED, animation:'spin 1s linear infinite' }} />
                </div>
              ) : policiesList.length === 0 ? (
                <p style={{ fontSize:9, color:DIM, padding:'8px 14px', fontFamily:'monospace' }}>
                  POLICY_EMPTY: system_configs tablosu boş
                </p>
              ) : (
                policiesList.map((policy) => (
                  <PolicyRow
                    key={policy.key}
                    policy={policy}
                    editing={editingPolicyKey === policy.key}
                    confirming={confirmingPolicy === policy.key}
                    saving={savingPolicyKey === policy.key}
                    editValue={editingPolicyKey === policy.key ? editingValue : policy.value}
                    onEdit={() => { setEditingPolicyKey(policy.key); setEditingValue(policy.value); setConfirmingPolicy(null); setPolicyError(null); }}
                    onCancel={() => { setEditingPolicyKey(null); setConfirmingPolicy(null); setPolicyError(null); }}
                    onChangeValue={(v) => setEditingValue(v)}
                    onRequestConfirm={() => setConfirmingPolicy(policy.key)}
                    onConfirm={() => { void handlePolicySave(policy.key); }}
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

      {/* DENETİM GÜNLÜĞÜ */}
      <div style={{ padding:'0 16px 8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
          <ScrollText size={11} style={{ color:DIM }} />
          <p style={{
            fontSize:9, fontWeight:700, color:DIM,
            letterSpacing:'0.14em', textTransform:'uppercase',
          }}>
            DENETİM GÜNLÜĞÜ
          </p>
          {auditLoading && <Loader2 size={9} style={{ color:DIM, animation:'spin 1s linear infinite' }} />}
        </div>

        {auditEntries.length === 0 && !auditLoading ? (
          <p style={{ fontFamily:'monospace', fontSize:9, color:DIM, padding:'4px 0' }}>
            AUDIT_EMPTY: Kayıtlı işlem yok
          </p>
        ) : (
          <div style={{
            background:SURF, border:`0.5px solid ${BORD}`,
            borderRadius:4, overflow:'hidden',
          }}>
            {auditEntries.map((entry, idx) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                isLast={idx === auditEntries.length - 1}
              />
            ))}
          </div>
        )}
      </div>

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

      {/* Canlı Teşhis Modalı */}
      {diagIncident && (
        <DiagnosticsBridgeLite
          incident={diagIncident}
          onClose={() => setDiagIncident(null)}
        />
      )}

      {/* Dağıtım Merkezi Modalı */}
      {showRollout && (
        <>
          <RolloutControlLite onClose={() => setShowRollout(false)} />
          <RolloutKeyframes />
        </>
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
  incidents, loading, onSelect, onDiagnostics,
}: {
  incidents:     RecentIncident[];
  loading:       boolean;
  onSelect:      (inc: RecentIncident) => void;
  onDiagnostics: (inc: RecentIncident) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            const color      = inc.severity === 'critical' ? RED : AMB;
            const isExpanded = expandedId === inc.id;
            return (
              <div key={inc.id} style={{
                borderBottom: idx < incidents.length - 1 ? `1px solid ${BORD}` : 'none',
              }}>
                {/* Olay satırı */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : inc.id)}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px',
                    background: isExpanded ? '#141414' : 'transparent',
                    border: 'none',
                    transition: 'background 100ms ease',
                  }}
                  onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLButtonElement).style.background = '#161616'; }}
                  onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: DIM, flexShrink: 0, minWidth: 54 }}>
                    {fmtTs(inc.ts)}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: MUTED, flexShrink: 0 }}>
                    dev:{inc.deviceHash}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color, flexShrink: 0, textTransform: 'uppercase' }}>
                    {inc.overallHealth}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: inc.thermalLevel >= 2 ? AMB : DIM, marginLeft: 'auto' }}>
                    T:L{inc.thermalLevel}
                  </span>
                  {isExpanded
                    ? <ChevronDown size={10} style={{ color: DIM, flexShrink: 0 }} />
                    : <ChevronRight size={10} style={{ color: DIM, flexShrink: 0 }} />}
                </button>

                {/* Aksiyon satırı — genişletilince göster */}
                {isExpanded && (
                  <div style={{
                    display: 'flex', gap: 1,
                    padding: '6px 12px 8px',
                    background: '#0e0e0e',
                    borderTop: `0.5px solid ${BORD}`,
                  }}>
                    <button
                      onClick={() => { setExpandedId(null); onSelect(inc); }}
                      style={{
                        flex: 1, padding: '7px 0', cursor: 'pointer',
                        background: 'transparent',
                        border: `0.5px solid ${BORD}`, borderRadius: '3px 0 0 3px',
                        color: MUTED, fontFamily: 'monospace', fontSize: 9,
                        fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}
                    >
                      <ChevronRight size={10} />
                      REPLAY
                    </button>
                    <button
                      onClick={() => { setExpandedId(null); onDiagnostics(inc); }}
                      style={{
                        flex: 1, padding: '7px 0', cursor: 'pointer',
                        background: 'rgba(96,165,250,0.07)',
                        border: `0.5px solid ${BLUE}40`, borderRadius: '0 3px 3px 0',
                        color: BLUE, fontFamily: 'monospace', fontSize: 9,
                        fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}
                    >
                      <Activity size={10} />
                      CANLI TEŞHİS
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PolicyRow ─────────────────────────────────────────────────────────────────

function PolicyRow({
  policy, editing, confirming, saving,
  editValue, onEdit, onCancel, onChangeValue, onRequestConfirm, onConfirm,
}: {
  policy:           SystemPolicy
  editing:          boolean
  confirming:       boolean
  saving:           boolean
  editValue:        string
  onEdit:           () => void
  onCancel:         () => void
  onChangeValue:    (v: string) => void
  onRequestConfirm: () => void
  onConfirm:        () => void
}) {
  return (
    <div style={{
      borderBottom: `0.5px solid ${BORD}`,
      padding: '9px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, color: TEXT, fontWeight: 500 }}>{policy.name}</p>
          <p style={{ fontSize: 8, color: DIM, fontFamily: 'monospace', marginTop: 1, letterSpacing: '0.06em' }}>
            {policy.key}
          </p>
        </div>

        {!editing ? (
          <>
            <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: AMB }}>
              {policy.value}{policy.unit ? ` ${policy.unit}` : ''}
            </span>
            <button
              onClick={onEdit}
              style={{
                background: 'transparent', border: `0.5px solid ${BORD}`,
                borderRadius: 3, cursor: 'pointer', color: MUTED,
                padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
              }}
            >
              <Pencil size={9} />
              DÜZENLİ
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="text"
              value={editValue}
              onChange={(e) => onChangeValue(e.target.value)}
              autoFocus
              style={{
                width: 72, padding: '4px 7px',
                background: '#141414', border: `0.5px solid ${AMB}60`,
                borderRadius: 3, color: AMB, fontFamily: 'monospace', fontSize: 11,
                outline: 'none',
              }}
            />
            {policy.unit && (
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: DIM }}>{policy.unit}</span>
            )}
            {!confirming ? (
              <>
                <button
                  onClick={onRequestConfirm}
                  style={{
                    padding: '4px 8px', background: `${AMB}15`,
                    border: `0.5px solid ${AMB}60`, borderRadius: 3,
                    cursor: 'pointer', color: AMB, fontFamily: 'monospace',
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Check size={9} />
                  KAYDET
                </button>
                <button
                  onClick={onCancel}
                  style={{
                    padding: '4px 6px', background: 'transparent',
                    border: `0.5px solid ${BORD}`, borderRadius: 3,
                    cursor: 'pointer', color: MUTED,
                  }}
                >
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onConfirm}
                  disabled={saving}
                  style={{
                    padding: '4px 8px', background: 'rgba(220,38,38,0.12)',
                    border: `0.5px solid ${RED}`, borderRadius: 3,
                    cursor: saving ? 'not-allowed' : 'pointer', color: RED,
                    fontFamily: 'monospace', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                    display: 'flex', alignItems: 'center', gap: 4, opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving
                    ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />
                    : null}
                  {saving ? '...' : 'ONAYLA'}
                </button>
                <button
                  onClick={onCancel}
                  disabled={saving}
                  style={{
                    padding: '4px 6px', background: 'transparent',
                    border: `0.5px solid ${BORD}`, borderRadius: 3,
                    cursor: 'pointer', color: MUTED, opacity: saving ? 0.4 : 1,
                  }}
                >
                  <X size={10} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {confirming && !saving && (
        <p style={{
          fontFamily: 'monospace', fontSize: 8, color: RED,
          marginTop: 5, letterSpacing: '0.06em',
        }}>
          ⚠ {policy.key}: {policy.value} → {editValue} — onaylıyor musunuz?
        </p>
      )}
    </div>
  );
}

// ── AuditRow ──────────────────────────────────────────────────────────────────

function AuditRow({ entry, isLast }: { entry: AuditLogEntry; isLast: boolean }) {
  const sevColor = entry.severity === 'critical' ? RED : entry.severity === 'warning' ? AMB : DIM;

  function fmtTs(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('tr-TR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return '--:--'; }
  }

  const shortEmail = entry.actorEmail.length > 20
    ? entry.actorEmail.slice(0, 18) + '…'
    : entry.actorEmail;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 12px',
      borderBottom: isLast ? 'none' : `0.5px solid ${BORD}`,
    }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: sevColor, flexShrink: 0 }} />
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: DIM, flexShrink: 0, minWidth: 54 }}>
        {fmtTs(entry.ts)}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: MUTED, flexShrink: 0, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
        {shortEmail}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: sevColor, flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
        {entry.action}
      </span>
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
