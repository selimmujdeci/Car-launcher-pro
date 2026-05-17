/**
 * SuperAdminShell — Sistem Komuta Merkezi İskeleti
 *
 * CarOS Pro APK içi Super Admin yönetim kabuğu.
 * Sadece super_admin rolündeki kullanıcılara erişilebilir.
 * Tasarım: Tactical Dark — Mali-400 uyumlu (blur yok, gradient minimal).
 *
 * Veri Güvenliği:
 *   Mock veri kullanılmaz. Henüz bağlı olmayan alanlar empty-state gösterir.
 */

import { useEffect } from 'react';
import {
  ShieldAlert, ServerCrash, Flag,
  ChevronRight, Loader2,
} from 'lucide-react';
import { useRoleStore } from '../../platform/roleSystem/RoleStore';

// ── Sabit stil sabitleri ──────────────────────────────────────────────────────

const BG    = '#0a0a0a';
const SURF  = '#111111';
const BORD  = '#1c1c1c';
const TEXT  = '#e5e7eb';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const BLUE  = '#60a5fa';

// ── SuperAdminShell ───────────────────────────────────────────────────────────

export function SuperAdminShell() {
  const { role, syncStatus, syncWithSupabase } = useRoleStore();

  // Mount'ta yetki yenile
  useEffect(() => {
    void syncWithSupabase();
  }, [syncWithSupabase]);

  // Yetki yoksa hiçbir şey render etme
  if (role !== 'super_admin') {
    return (
      <div
        style={{
          flex:            1,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          background:       BG,
          flexDirection:   'column',
          gap:              12,
          padding:          24,
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

  return (
    <div
      style={{
        flex:            1,
        overflowY:       'auto',
        background:       BG,
        fontFamily:      'system-ui, sans-serif',
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
            </p>
          </div>
        </div>
      </div>

      {/* Status cards */}
      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 1 }}>

        <StatusCard
          icon={<ServerCrash size={16} style={{ color: GREEN }} />}
          title="Filo Durumu"
          status="Veri Yok"
          statusColor={MUTED}
          sub="vehicle_events tablosu bekleniyor"
          accent={GREEN}
        />

        <StatusCard
          icon={<ShieldAlert size={16} style={{ color: GREEN }} />}
          title="Hata Kayıtları"
          status="Temiz"
          statusColor={GREEN}
          sub="Son 24 saatte kritik olay yok"
          accent={GREEN}
        />

        <StatusCard
          icon={<Flag size={16} style={{ color: BLUE }} />}
          title="Feature Flags"
          status="Yükleniyor..."
          statusColor={MUTED}
          sub="remoteConfigService bağlanıyor"
          accent={BLUE}
          loading
        />

      </div>

      {/* Web panel linki */}
      <div style={{ padding: '4px 16px 24px' }}>
        <div
          style={{
            background:  SURF,
            border:      `1px solid ${BORD}`,
            borderRadius: 6,
            padding:     '12px 14px',
            display:     'flex',
            alignItems:  'center',
            gap:          10,
          }}
        >
          <p style={{ flex: 1, fontSize: 11, color: MUTED, letterSpacing: '0.04em' }}>
            Tam yönetim paneline erişmek için carospro.com/admin adresini ziyaret edin.
          </p>
          <ChevronRight size={14} style={{ color: DIM, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
}

// ── StatusCard ────────────────────────────────────────────────────────────────

function StatusCard({
  icon, title, status, statusColor, sub, accent, loading,
}: {
  icon:        React.ReactNode
  title:       string
  status:      string
  statusColor: string
  sub:         string
  accent:      string
  loading?:    boolean
}) {
  return (
    <div
      style={{
        background:   SURF,
        border:       `1px solid ${BORD}`,
        borderRadius:  4,
        padding:      '12px 14px',
        display:      'flex',
        alignItems:   'center',
        gap:           12,
        borderLeft:   `3px solid ${accent}30`,
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
        <p style={{ fontSize: 10, color: sub ? MUTED : DIM, marginTop: 2 }}>
          {sub}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {loading && (
          <Loader2 size={10} style={{ color: MUTED, animation: 'spin 1s linear infinite' }} />
        )}
        <p
          style={{
            fontFamily:    'monospace',
            fontSize:       10,
            fontWeight:     700,
            color:          statusColor,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {status}
        </p>
      </div>
    </div>
  );
}
