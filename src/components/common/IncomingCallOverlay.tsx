import { memo, useEffect, useState } from 'react';
import { Phone, PhoneOff, PhoneMissed } from 'lucide-react';
import { useNotificationState, dismissNotification } from '../../platform/notificationService';

export const IncomingCallOverlay = memo(function IncomingCallOverlay() {
  const { notifications } = useNotificationState();
  const [visible, setVisible] = useState(false);

  const call = notifications.find(n => n.category === 'call' && !n.isRead) ?? null;

  /* Animate in when call arrives */
  useEffect(() => {
    if (call) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [call?.id]);

  if (!call) return null;

  const handleDecline = () => {
    dismissNotification(call.id);
    setVisible(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div style={{
        width: 420,
        borderRadius: 32,
        background: 'linear-gradient(160deg, #0d1f0f 0%, #0a1a0c 100%)',
        border: '1px solid rgba(34,197,94,0.25)',
        boxShadow: '0 0 60px rgba(34,197,94,0.15), 0 32px 80px rgba(0,0,0,0.6)',
        padding: '44px 36px 36px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.96)',
        transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Avatar ring */}
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: -8,
            borderRadius: '50%',
            border: '2px solid rgba(34,197,94,0.3)',
            animation: 'callRipple1 2s ease-out infinite',
          }} />
          <div style={{
            position: 'absolute', inset: -20,
            borderRadius: '50%',
            border: '1.5px solid rgba(34,197,94,0.15)',
            animation: 'callRipple2 2s ease-out infinite 0.4s',
          }} />
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.1))',
            border: '2px solid rgba(34,197,94,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 24px rgba(34,197,94,0.3)',
          }}>
            <Phone size={36} style={{ color: '#22c55e' }} />
          </div>
        </div>

        {/* Labels */}
        <div style={{ textAlign: 'center', gap: 6, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'rgba(34,197,94,0.7)',
          }}>
            Gelen Arama
          </div>
          <div style={{
            fontSize: 28, fontWeight: 800, color: '#fff',
            letterSpacing: '-0.5px', lineHeight: 1.1,
          }}>
            {call.sender || 'Bilinmeyen'}
          </div>
          {call.appName && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
              {call.appName}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 20, width: '100%' }}>
          {/* Decline */}
          <button
            onClick={handleDecline}
            style={{
              flex: 1, height: 60, borderRadius: 16,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.35)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              cursor: 'pointer', color: '#f87171',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.28)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
          >
            <PhoneOff size={22} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Reddet</span>
          </button>

          {/* Accept */}
          <button
            onClick={handleDecline}
            style={{
              flex: 1, height: 60, borderRadius: 16,
              background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.2))',
              border: '1px solid rgba(34,197,94,0.45)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              cursor: 'pointer', color: '#4ade80',
              transition: 'background 0.15s',
              boxShadow: '0 0 20px rgba(34,197,94,0.2)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.35)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.2))')}
          >
            <Phone size={22} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Cevapla</span>
          </button>
        </div>

        {/* Ignore */}
        <button
          onClick={handleDecline}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.25)', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.08em',
          }}
        >
          <PhoneMissed size={14} />
          Yoksay
        </button>
      </div>

      <style>{`
        @keyframes callRipple1 {
          0%   { transform: scale(1);   opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0;   }
        }
        @keyframes callRipple2 {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(1.9); opacity: 0;   }
        }
      `}</style>
    </div>
  );
});
