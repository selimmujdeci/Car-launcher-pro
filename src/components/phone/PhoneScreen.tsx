/**
 * PhoneScreen — Launcher içi rehber + arama ekranı.
 *
 * - Kişi listesi (ContactsService ile)
 * - Hızlı arama kutusu
 * - Favoriler satırı
 * - Kişiye tıklayınca numara seç + ara (tel: intent → Android dialer)
 * - Dialer: Android dialer overlay açar ama UI launcher içinde kalır
 */
import { memo, useState, useMemo } from 'react';
import { Search, Phone, Star, User } from 'lucide-react';
import { useContactsState } from '../../platform/contactsService';
import { isNative } from '../../platform/bridge';
import { CarLauncher } from '../../platform/nativePlugin';

/* ── Arama yardımcısı ────────────────────────────────────── */

function callNumber(number: string): void {
  const clean = number.replace(/\s/g, '');
  if (isNative) {
    CarLauncher.launchApp({
      action: 'android.intent.action.CALL',
      data:   `tel:${clean}`,
    }).catch(() => {
      // Fallback: view (dialer açılır ama otomatik aramaz)
      CarLauncher.launchApp({ action: 'android.intent.action.DIAL', data: `tel:${clean}` }).catch(() => undefined);
    });
  } else {
    window.open(`tel:${clean}`, '_self');
  }
}

/* ── Kişi satırı ─────────────────────────────────────────── */

function ContactRow({ contact, onCall }: {
  contact: { id: string; name: string; phones: { number: string; label: string }[]; avatar?: string; favorite: boolean };
  onCall: (name: string, phones: { number: string; label: string }[]) => void;
}) {
  const initials = contact.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <button
      onClick={() => onCall(contact.name, contact.phones)}
      className="flex items-center gap-4 w-full px-4 py-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] active:scale-[0.98] transition-all duration-150 text-left border border-white/5"
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="w-12 h-12 rounded-2xl object-cover flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
          <span className="text-blue-300 text-sm font-black">{initials || <User className="w-5 h-5" />}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-primary font-bold text-sm truncate">{contact.name}</div>
        <div className="text-slate-500 text-xs mt-0.5 truncate">
          {contact.phones[0]?.number ?? '—'}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {contact.favorite && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
        <Phone className="w-4 h-4 text-slate-600" />
      </div>
    </button>
  );
}

/* ── Numara seçici modal ─────────────────────────────────── */

function NumberPicker({
  name,
  phones,
  onClose,
}: {
  name: string;
  phones: { number: string; label: string }[];
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center var(--panel-bg-secondary) backdrop-blur-md backdrop-blur-sm">
      <div className="bg-[rgba(255,255,255,0.05)] border border-white/10 rounded-3xl p-6 w-full max-w-xs mx-4 shadow-2xl">
        <div className="text-primary font-black text-lg mb-1 text-center">{name}</div>
        <div className="text-slate-500 text-xs text-center mb-5">Numara seç</div>
        <div className="flex flex-col gap-2.5">
          {phones.map((p) => (
            <button
              key={p.number}
              onClick={() => { callNumber(p.number); onClose(); }}
              className="flex items-center gap-3 p-4 rounded-2xl bg-blue-600/15 border border-blue-500/25 active:scale-95 transition-transform"
            >
              <Phone className="w-5 h-5 text-blue-400 flex-shrink-0" />
              <div className="flex-1 text-left">
                <div className="text-primary font-bold text-sm">{p.number}</div>
                <div className="text-blue-400/60 text-xs capitalize">{p.label}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-3 rounded-2xl var(--panel-bg-secondary) text-slate-400 text-sm font-bold active:scale-95 transition-transform"
        >
          İptal
        </button>
      </div>
    </div>
  );
}

/* ── Ana bileşen ─────────────────────────────────────────── */

export const PhoneScreen = memo(function PhoneScreen() {
  const { contacts, loading } = useContactsState();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<{ name: string; phones: { number: string; label: string }[] } | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return contacts;
    const q = query.toLowerCase();
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phones.some((p) => p.number.includes(q))
    );
  }, [contacts, query]);

  const favorites = useMemo(() => contacts.filter((c) => c.favorite), [contacts]);

  const handleCall = (name: string, phones: { number: string; label: string }[]) => {
    if (phones.length === 0) return;
    if (phones.length === 1) { callNumber(phones[0].number); return; }
    setPicking({ name, phones });
  };

  return (
    <div className="h-full flex flex-col glass-card border-none !shadow-none relative">

      {/* Numara seçici overlay */}
      {picking && (
        <NumberPicker name={picking.name} phones={picking.phones} onClose={() => setPicking(null)} />
      )}

      {/* Arama kutusu */}
      <div className="flex-shrink-0 p-4 pb-2">
        <div className="flex items-center gap-3 var(--panel-bg-secondary) border border-white/10 rounded-2xl px-4 py-3">
          <Search className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kişi ara veya numara gir…"
            className="flex-1 bg-transparent text-primary text-sm placeholder-slate-600 outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-slate-600 hover:text-slate-400 text-lg leading-none">×</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4 no-scrollbar">

        {/* Favoriler */}
        {!query && favorites.length > 0 && (
          <div>
            <div className="text-slate-600 text-[10px] font-black uppercase tracking-widest mb-2 px-1">Favoriler</div>
            <div className="grid grid-cols-4 gap-2">
              {favorites.slice(0, 8).map((c) => {
                const initials = c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <button
                    key={c.id}
                    onClick={() => handleCall(c.name, c.phones)}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/5 active:scale-95 transition-transform"
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="w-12 h-12 rounded-2xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                        <span className="text-amber-300 text-sm font-black">{initials}</span>
                      </div>
                    )}
                    <span className="text-primary text-[10px] font-bold truncate w-full text-center">{c.name.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Kişi listesi */}
        <div>
          {!query && <div className="text-slate-600 text-[10px] font-black uppercase tracking-widest mb-2 px-1">Tüm Kişiler</div>}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-600 text-sm">Kişiler yükleniyor…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <User className="w-10 h-10 text-slate-700" />
              <div className="text-slate-600 text-sm text-center">
                {query ? `"${query}" için sonuç bulunamadı` : 'Rehberde kişi yok'}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((c) => (
                <ContactRow key={c.id} contact={c} onCall={handleCall} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});


