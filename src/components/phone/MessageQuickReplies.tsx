/**
 * MessageQuickReplies — mesaja tek dokunuşla hazır yanıt.
 *
 * Yalnız bildirim metin yazılabilen bir yanıt eylemi taşıyorsa görünür
 * (`hasAction(n, 'REPLY')`). Klavye YOK — sürüşte yazma açılmaz. Gönderim
 * sonucu telefondaki uygulamanın kabulüne bağlıdır; "Gönderildi" yalnız
 * yanıt eylemi başarıyla tetiklendiğinde yazılır.
 */
import { memo, useState } from 'react';
import { Send } from 'lucide-react';
import { hasAction, replyToMessage, type AppNotification } from '../../platform/notificationService';

const QUICK_REPLIES: readonly string[] = [
  'Sürüyorum, sonra yazarım.',
  'Yoldayım, birazdan ararım.',
  'Tamam.',
];

type SendState = { text: string; phase: 'sending' | 'sent' | 'failed' } | null;

export const MessageQuickReplies = memo(function MessageQuickReplies({ notif }: { notif: AppNotification }) {
  const [state, setState] = useState<SendState>(null);

  if (!hasAction(notif, 'REPLY')) return null;

  const send = async (text: string) => {
    setState({ text, phase: 'sending' });
    const res = await replyToMessage(notif.id, text);
    setState({ text, phase: res.ok ? 'sent' : 'failed' });
  };

  return (
    <div className="flex flex-col gap-1.5 mt-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REPLIES.map((text) => (
          <button
            key={text}
            onClick={() => void send(text)}
            disabled={state?.phase === 'sending'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-40"
            style={{ background: 'var(--oem-info-soft, rgba(59,130,246,0.10))', border: '1px solid var(--oem-info, rgba(59,130,246,0.3))', color: 'var(--oem-info, #60a5fa)' }}
          >
            <Send className="w-3 h-3" /> {text}
          </button>
        ))}
      </div>
      {state && (
        <div className="text-[11px] font-bold" style={{
          color: state.phase === 'sent' ? 'var(--oem-good, #22c55e)'
            : state.phase === 'failed' ? 'var(--oem-danger, #ef4444)' : 'var(--oem-ink-3)',
        }}>
          {state.phase === 'sending' ? 'Gönderiliyor…'
            : state.phase === 'sent' ? `Gönderildi: "${state.text}"`
            : 'Gönderilemedi — mesaj telefonda kapanmış olabilir'}
        </div>
      )}
    </div>
  );
});
