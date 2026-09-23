/**
 * IncomingCallOverlay — gelen arama / süren görüşme.
 *
 * Düğmeler bildirimin GERÇEKTEN taşıdığı eylemlerden türetilir
 * (`notificationService.hasAction`): "Cevapla" yalnız ANSWER eylemi varsa,
 * "Reddet" yalnız DECLINE varsa görünür. Eylem yoksa düğme de yoktur —
 * cevaplanamayan aramada "Cevapla" göstermek sahte başarı olurdu.
 * "Yoksay" telefona DOKUNMAZ; yalnız bu ekranı kapatır.
 *
 * Çalan arama (ANSWER var) tam ekran; süren görüşme (HANG_UP var) ve eylemsiz
 * arama kartı üstte küçük bir şerittir — sürüş ekranını kapatmaz.
 */
import { memo, useEffect, useState } from 'react';
import { Phone, PhoneOff, PhoneMissed, X } from 'lucide-react';
import {
  useNotificationState, hasAction, answerCall, declineCall, hangUpCall, markNotificationRead,
  type NotificationActionResult,
} from '../../platform/notificationService';

function failureText(res: NotificationActionResult): string {
  return res.reason === 'notification_gone'
    ? 'Arama artık yok'
    : 'Telefon bu işlemi kabul etmedi — telefondan yapın';
}

export const IncomingCallOverlay = memo(function IncomingCallOverlay() {
  const { notifications } = useNotificationState();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = notifications.find(n => n.category === 'call' && !n.isRead) ?? null;
  const ringing = call !== null && hasAction(call, 'ANSWER');

  /* Animate in when call arrives.
     Effect YALNIZ çağrı KİMLİĞİNE tepki verir; `call` nesnesinin kendisine
     bakmaz. Bakarsa her bildirim dizisi tazelemesinde (yeni nesne kimliği)
     yeniden koşar ve 30 ms'lik giriş animasyonu sürekli baştan başlar.
     `AppNotification.id` zorunlu string olduğundan `callId !== null`,
     `call !== null` ile birebir aynıdır. */
  const callId = call?.id ?? null;
  useEffect(() => {
    setError(null);
    setBusy(false);
    if (callId !== null) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [callId]);

  if (!call) return null;

  const run = async (action: (id: string) => Promise<NotificationActionResult>) => {
    setBusy(true);
    setError(null);
    const res = await action(call.id);
    setBusy(false);
    /* Başarıda kart kendiliğinden değişir/kapanır: telefon bildirimi günceller
       (süren görüşme) ya da kaldırır (ret/bitiş). Burada sonuç UYDURULMAZ. */
    if (!res.ok) setError(failureText(res));
  };

  const ignore = () => {
    markNotificationRead(call.id);
    setVisible(false);
  };

  /* ── Süren görüşme / eylemsiz arama: üst şerit ─────────────────────── */
  if (!ringing) {
    const canHangUp = hasAction(call, 'HANG_UP');
    return (
      <div
        role="status"
        style={{
          position: 'fixed', top: 12, left: '50%', zIndex: 9000,
          transform: `translateX(-50%) translateY(${visible ? 0 : -16}px)`,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease, transform 0.2s ease',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 8px 8px 16px', borderRadius: 999, maxWidth: 'calc(100vw - 32px)',
          background: 'rgba(10,26,12,0.94)', border: '1px solid rgba(34,197,94,0.35)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <Phone size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.sender || 'Bilinmeyen'}
          </span>
          <span style={{ fontSize: 11, color: error ? '#f87171' : 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {error ?? (call.text || call.appName)}
          </span>
        </div>
        {canHangUp && (
          <button
            onClick={() => void run(hangUpCall)}
            disabled={busy}
            style={{
              height: 40, padding: '0 16px', borderRadius: 999, flexShrink: 0,
              background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800,
              cursor: 'pointer', opacity: busy ? 0.5 : 1,
            }}
          >
            <PhoneOff size={16} /> Kapat
          </button>
        )}
        <button
          onClick={ignore}
          aria-label="Gizle"
          style={{
            width: 36, height: 36, borderRadius: 999, flexShrink: 0,
            background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const canDecline = hasAction(call, 'DECLINE');

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

        {error && (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171', textAlign: 'center' }}>{error}</div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 20, width: '100%' }}>
          {/* Decline */}
          {canDecline && (
            <button
              onClick={() => void run(declineCall)}
              disabled={busy}
              style={{
                flex: 1, height: 60, borderRadius: 16,
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.35)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer', color: '#f87171',
                transition: 'background 0.15s',
                opacity: busy ? 0.5 : 1,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.28)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
            >
              <PhoneOff size={22} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Reddet</span>
            </button>
          )}

          {/* Accept */}
          <button
            onClick={() => void run(answerCall)}
            disabled={busy}
            style={{
              flex: 1, height: 60, borderRadius: 16,
              background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.2))',
              border: '1px solid rgba(34,197,94,0.45)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              cursor: 'pointer', color: '#4ade80',
              transition: 'background 0.15s',
              boxShadow: '0 0 20px rgba(34,197,94,0.2)',
              opacity: busy ? 0.5 : 1,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.35)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(16,185,129,0.2))')}
          >
            <Phone size={22} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Cevapla</span>
          </button>
        </div>

        {/* Ignore — yalnız bu ekranı kapatır, arama telefonda sürer */}
        <button
          onClick={ignore}
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
