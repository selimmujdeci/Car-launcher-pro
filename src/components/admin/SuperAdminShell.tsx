/**
 * SuperAdminShell — Sistem Komuta Merkezi
 *
 * Faz 2: Supabase telemetri verileriyle canlandırılmış panel.
 * GİZLİLİK: Bireysel araç/kullanıcı verisi gösterilmez — anonim toplamlar.
 * Mali-400 uyumlu: ağır animasyon/grafik yok.
 */

import { useEffect, useState, useRef } from 'react';
import { ShieldAlert, ServerCrash, Flag, ChevronRight, Loader2 } from 'lucide-react';
import { useRoleStore }             from '../../platform/roleSystem/RoleStore';
import {
  getFleetHealthSummary,
  getCriticalCount24h,
  getActiveFlagCount,
  subscribeToCriticalEvents,
  type FleetHealthSummary,
} from '../../platform/superadmin/superAdminService';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const BG    = '#0a0a0a';
const SURF  = '#111111';
const BORD  = '#1c1c1c';
const TEXT  = '#e5e7eb';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const BLUE  = '#60a5fa';
const AMB   = '#d97706';

// ── SuperAdminShell ───────────────────────────────────────────────────────────

export function SuperAdminShell() {
  const { role, syncStatus, syncWithSupabase } = useRoleStore();

  // Veri state'leri
  const [fleet,    setFleet]    = useState<FleetHealthSummary | null>(null);
  const [critical, setCritical] = useState<number | null>(null);
  const [flags,    setFlags]    = useState<{ enabled: number; total: number } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [fetchErr, setFetchErr] = useState(false);

  // Realtime yeni kritik event bildirimi
  const [newCritical, setNewCritical] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // Yetki doğrula
  useEffect(() => {
    void syncWithSupabase();
  }, [syncWithSupabase]);

  // Veri yükle — sadece super_admin ise
  useEffect(() => {
    if (role !== 'super_admin') return;

    let cancelled = false;
    setLoading(true);
    setFetchErr(false);

    async function fetch() {
      try {
        const [f, c, fl] = await Promise.all([
          getFleetHealthSummary(1),
          getCriticalCount24h(),
          getActiveFlagCount(),
        ]);
        if (!cancelled) {
          setFleet(f);
          setCritical(c);
          setFlags(fl);
        }
      } catch {
        if (!cancelled) setFetchErr(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetch();

    // Realtime: kritik event gelince sayacı artır
    unsubRef.current = subscribeToCriticalEvents(() => {
      if (!cancelled) {
        setCritical((p) => (p ?? 0) + 1);
        setNewCritical(true);
        // 3 saniye sonra yeni-event göstergesini kaldır
        setTimeout(() => { if (!cancelled) setNewCritical(false); }, 3000);
      }
    });

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [role]);

  // Yetki yoksa
  if (role !== 'super_admin') {
    return (
      <div
        style={{
          flex:           1,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          background:      BG,
          flexDirection:  'column',
          gap:             12,
          padding:         24,
        }}
      >
        {syncStatus === 'syncing' ? (
          <Loader2 size={24} style={{ color: MUTED, animation: 'spin 1s linear infinite' }} />
        ) : (
          <ShieldAlert size={28} style={{ color: RED }} />
        )}
        <p style={{ fontFamily: 'monospace', fontSize: 11, color: MUTED, letterSpacing: '0.08em' }}>
          {syncStatus === 'syncing' ? 'YETKİ DOĞRULANIYORU...' : 'ERİŞİM REDDEDİLDİ'}
        </p>
      </div>
    );
  }

  // Hata durumu
  if (fetchErr) {
    return (
      <div
        style={{
          flex:           1,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          background:      BG,
          flexDirection:  'column',
          gap:             8,
          padding:         24,
        }}
      >
        <ServerCrash size={24} style={{ color: AMB }} />
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>
          NETWORK_ERROR: Veri çekilemedi
        </p>
      </div>
    );
  }

  // Stabilite rengi
  const score     = fleet?.stabilityScore ?? 100;
  const scoreColor = score >= 80 ? GREEN : score >= 60 ? AMB : RED;

  // Kritik olay rengi
  const critCount   = critical ?? 0;
  const critAccent  = critCount > 0 ? RED : GREEN;
  const critStatus  = critCount > 0 ? `${critCount} KRİTİK` : 'TEMİZ';

  return (
    <div
      style={{
        flex:      1,
        overflowY: 'auto',
        background: BG,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding:      '20px 20px 16px',
          borderBottom: `1px solid ${BORD}`,
          background:    '#080808',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width:      36,
              height:     36,
              borderRadius: 8,
              background: 'rgba(220,38,38,0.1)',
              border:     `1px solid rgba(220,38,38,0.25)`,
              display:    'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink:  0,
            }}
          >
            <ShieldAlert size={18} style={{ color: RED }} />
          </div>
          <div>
            <p
              style={{
                fontSize:      11,
                fontWeight:     700,
                color:          RED,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              SİSTEM KOMUTA MERKEZİ
            </p>
            <p style={{ fontSize: 9, color: DIM, letterSpacing: '0.08em', marginTop: 2 }}>
              SUPER_ADMIN · {syncStatus === 'verified' ? 'JWT DOĞRULANDI' : 'SYNCING...'}
              {newCritical && (
                <span style={{ color: RED, marginLeft: 8 }}>● YENİ KRİTİK OLAY</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Kartlar */}
      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 1 }}>

        {/* Filo Durumu */}
        <StatusCard
          icon={<ServerCrash size={16} style={{ color: scoreColor }} />}
          title="Filo Durumu"
          accent={scoreColor}
          loading={loading && !fleet}
          value={fleet ? `%${score}` : undefined}
          valueColor={scoreColor}
          sub={
            fleet
              ? `${fleet.totalEvents} event / son ${fleet.windowHours}sa · ${fleet.criticalCount} kritik`
              : 'vehicle_events bekleniyor'
          }
        />

        {/* Hata Kayıtları */}
        <StatusCard
          icon={<ShieldAlert size={16} style={{ color: critAccent }} />}
          title="Hata Kayıtları"
          accent={critAccent}
          loading={loading && critical === null}
          value={critStatus}
          valueColor={critAccent}
          sub={`Son 24 saat · ${critCount === 0 ? 'kritik olay yok' : `${critCount} acil durum`}`}
          urgent={critCount > 0}
        />

        {/* Feature Flags */}
        <StatusCard
          icon={<Flag size={16} style={{ color: BLUE }} />}
          title="Feature Flags"
          accent={BLUE}
          loading={loading && !flags}
          value={flags ? `${flags.enabled}/${flags.total}` : undefined}
          valueColor={BLUE}
          sub={
            flags
              ? `${flags.enabled} aktif · ${flags.total - flags.enabled} kapalı`
              : 'feature_flags tablosu bekleniyor'
          }
        />

      </div>

      {/* Web paneli linki */}
      <div style={{ padding: '4px 16px 24px' }}>
        <div
          style={{
            background:   SURF,
            border:       `1px solid ${BORD}`,
            borderRadius:  6,
            padding:      '12px 14px',
            display:      'flex',
            alignItems:   'center',
            gap:           10,
          }}
        >
          <p style={{ flex: 1, fontSize: 11, color: MUTED, letterSpacing: '0.04em' }}>
            Tam yönetim için carospro.com/admin adresini ziyaret edin.
          </p>
          <ChevronRight size={14} style={{ color: DIM, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
}

// ── StatusCard ────────────────────────────────────────────────────────────────

interface StatusCardProps {
  icon:       React.ReactNode
  title:      string
  accent:     string
  loading:    boolean
  value?:     string
  valueColor: string
  sub:        string
  urgent?:    boolean
}

function StatusCard({ icon, title, accent, loading, value, valueColor, sub, urgent }: StatusCardProps) {
  return (
    <div
      style={{
        background:   SURF,
        border:       `1px solid ${urgent ? `${RED}40` : BORD}`,
        borderRadius:  4,
        padding:      '12px 14px',
        display:      'flex',
        alignItems:   'center',
        gap:           12,
        borderLeft:   `3px solid ${accent}40`,
      }}
    >
      <div
        style={{
          width:      32,
          height:     32,
          borderRadius: 6,
          background: `${accent}10`,
          border:     `1px solid ${accent}20`,
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink:  0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: TEXT, letterSpacing: '0.04em' }}>
          {title}
        </p>
        <p style={{ fontSize: 10, color: MUTED, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {loading ? (
          <Loader2 size={12} style={{ color: MUTED, animation: 'spin 1s linear infinite' }} />
        ) : (
          <p
            style={{
              fontFamily:    'monospace',
              fontSize:       11,
              fontWeight:     700,
              color:          valueColor,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {value ?? '—'}
          </p>
        )}
      </div>
    </div>
  );
}
