/**
 * SecureAccessModal — Gizli Mühendislik Erişim Kapısı
 *
 * OEM Hidden Factory Access standardına uygun.
 * Sadece 5-tap sekansı ile tetiklenir; doğrudan render edilmez.
 * Mali-400: blur yok, saf opacity geçişi.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useRoleStore } from '../../platform/roleSystem/RoleStore';
import { AdminLoginForm } from './AdminLoginForm';
import { openDrawer } from '../../platform/drawerBus';

interface Props {
  onClose: () => void
}

export function SecureAccessModal({ onClose }: Props) {
  const { role } = useRoleStore();
  const firedRef = useRef(false);

  // Auth başarılı → drawer aç ve modalı kapat
  useEffect(() => {
    if (role === 'super_admin' && !firedRef.current) {
      firedRef.current = true;
      const t = setTimeout(() => {
        onClose();
        openDrawer('super-admin');
      }, 280);
      return () => clearTimeout(t);
    }
  }, [role, onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.97)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Minimal header — "CAROS PRO SECURE ACCESS" */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', flexShrink: 0,
        borderBottom: '0.5px solid #1c1c1c',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#dc2626' }} />
          <span style={{
            fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
            color: 'rgba(220,38,38,0.5)', letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}>
            CarOS Pro Secure Access
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#374151', padding: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* AdminLoginForm kalan alanı doldurur */}
      <AdminLoginForm mode="login" />
    </div>
  );
}
