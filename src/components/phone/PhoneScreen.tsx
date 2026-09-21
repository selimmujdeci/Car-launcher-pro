/**
 * PhoneScreen — Telefon Merkezi (Faz 1).
 *
 * Alt dock'taki TELEFON düğmesinin AÇTIĞI TEK pencere. Önceki `PhoneScreen`
 * yalnız rehberdi; artık dört bölümlü bir merkez: Aramalar · Kişiler ·
 * Mesajlar · Bağlantı. Sekme çubuğu deseni `MediaScreen`in tab bar'ıyla
 * BİREBİR aynı görsel dilde (`var(--oem-*)` token'ları, aynı yükseklik/ikon
 * boyutu) — yeni bir tasarım dili İCAT EDİLMEDİ.
 *
 * İkinci bir müzik oynatıcı YOK, ikinci bir Mavi motoru YOK — bu ekran
 * yalnız telefon/rehber/bağlantı sunar.
 */
import { memo, useState } from 'react';
import { Phone, Users, MessageSquare, Link2 } from 'lucide-react';
import { PhoneCallsTab } from './PhoneCallsTab';
import { PhoneContactsTab } from './PhoneContactsTab';
import { PhoneMessagesTab } from './PhoneMessagesTab';
import { PhoneConnectionTab } from './PhoneConnectionTab';

type PhoneTab = 'calls' | 'contacts' | 'messages' | 'connection';

function TabBtn({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      data-editable="phone.tab-button" data-editable-type="dock"
      onClick={onClick}
      className="flex-1 relative flex flex-col items-center justify-center gap-1.5 py-3.5 transition-all duration-300"
      style={{ color: active ? 'var(--oem-accent, #E0A23C)' : 'var(--oem-ink-3, rgba(255,255,255,0.5))' }}
    >
      <div className={active ? 'scale-110 transition-all' : 'transition-all'}
        style={active ? { filter: 'drop-shadow(0 0 8px var(--oem-accent-glow, rgba(224,162,60,0.55)))' } : undefined}>
        {icon}
      </div>
      <span className="text-[10px] font-black uppercase tracking-[0.15em]">{label}</span>
      {active && <div className="absolute bottom-0 w-10 h-1 rounded-t-full" style={{ background: 'var(--oem-accent, #E0A23C)', boxShadow: '0 0 10px var(--oem-accent-glow, rgba(224,162,60,0.8))' }} />}
    </button>
  );
}

export const PhoneScreen = memo(function PhoneScreen() {
  const [tab, setTab] = useState<PhoneTab>('calls');

  return (
    <div data-theme-surface="phone" data-editable="phone.screen" data-editable-type="panel"
      className="h-full flex flex-col glass-card border-none !shadow-none relative overflow-hidden">

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'calls'      && <PhoneCallsTab />}
        {tab === 'contacts'   && <PhoneContactsTab />}
        {tab === 'messages'   && <PhoneMessagesTab />}
        {tab === 'connection' && <PhoneConnectionTab />}
      </div>

      {/* ── Sekme çubuğu — MediaScreen tab bar'ıyla aynı görsel dil ────── */}
      <div
        data-editable="phone.tabbar" data-editable-type="dock"
        className="flex-shrink-0 flex border-t rounded-b-[32px] overflow-hidden"
        style={{
          background:           'var(--oem-surface-0, rgba(20,24,32,0.85))',
          borderColor:          'var(--oem-line, rgba(255,255,255,0.10))',
          backdropFilter:       'blur(calc(var(--rt-blur, 1) * 12px))',
          WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 12px))',
        }}
      >
        <TabBtn active={tab === 'calls'}      icon={<Phone size={20} />}         label="Aramalar" onClick={() => setTab('calls')} />
        <TabBtn active={tab === 'contacts'}   icon={<Users size={20} />}         label="Kişiler"  onClick={() => setTab('contacts')} />
        <TabBtn active={tab === 'messages'}   icon={<MessageSquare size={20} />} label="Mesajlar" onClick={() => setTab('messages')} />
        <TabBtn active={tab === 'connection'} icon={<Link2 size={20} />}         label="Bağlantı" onClick={() => setTab('connection')} />
      </div>
    </div>
  );
});
