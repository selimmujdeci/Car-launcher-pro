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
      className="flex items-center gap-4 w-full px-4 py-3 rounded-2xl active:scale-[0.98] transition-all duration-150 text-left"
      style={{ background: 'var(--oem-surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--oem-line, rgba(255,255,255,0.08))' }}
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="w-12 h-12 rounded-2xl object-cover flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--oem-info-soft, rgba(59,130,246,0.15))', border: '1px solid var(--oem-info, rgba(59,130,246,0.35))' }}>
          <span className="text-sm font-black" style={{ color: 'var(--oem-info, #60a5fa)' }}>{initials || <User className="w-5 h-5" />}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate" style={{ color: 'var(--oem-ink)' }}>{contact.name}</div>
        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--oem-ink-3)' }}>
          {contact.phones[0]?.number ?? '—'}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {contact.favorite && <Star className="w-3.5 h-3.5 fill-current" style={{ color: 'var(--oem-warn, #f59e0b)' }} />}
        <Phone className="w-4 h-4" style={{ color: 'var(--oem-ink-3)' }} />
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
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl p-6 w-full max-w-xs mx-4 shadow-2xl"
        style={{ background: 'var(--oem-surface-0)', border: '1px solid var(--oem-line)' }}>
        <div className="font-black text-lg mb-1 text-center" style={{ color: 'var(--oem-ink)' }}>{name}</div>
        <div className="text-xs text-center mb-5" style={{ color: 'var(--oem-ink-3)' }}>Numara seç</div>
        <div className="flex flex-col gap-2.5">
          {phones.map((p) => (
            <button
              key={p.number}
              onClick={() => { callNumber(p.number); onClose(); }}
              className="flex items-center gap-3 p-4 rounded-2xl active:scale-95 transition-transform"
              style={{ background: 'var(--oem-info-soft, rgba(59,130,246,0.12))', border: '1px solid var(--oem-info, rgba(59,130,246,0.3))' }}
            >
              <Phone className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--oem-info, #60a5fa)' }} />
              <div className="flex-1 text-left">
                <div className="font-bold text-sm" style={{ color: 'var(--oem-ink)' }}>{p.number}</div>
                <div className="text-xs capitalize" style={{ color: 'var(--oem-info, #60a5fa)', opacity: 0.65 }}>{p.label}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-3 rounded-2xl text-sm font-bold active:scale-95 transition-transform"
          style={{ background: 'var(--oem-surface-2)', color: 'var(--oem-ink-2)' }}
        >
          İptal
        </button>
      </div>
    </div>
  );
}

/* ── Ana bileşen ─────────────────────────────────────────── */

export const PhoneScreen = memo(function PhoneScreen() {
  const { contacts, loading, error } = useContactsState();
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
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
          <Search className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--oem-ink-3)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kişi ara veya numara gir…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--oem-ink)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-lg leading-none transition-colors"
              style={{ color: 'var(--oem-ink-3)' }}>×</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4 no-scrollbar">

        {/* Favoriler */}
        {!query && favorites.length > 0 && (
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>Favoriler</div>
            <div className="grid grid-cols-4 gap-2">
              {favorites.slice(0, 8).map((c) => {
                const initials = c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <button
                    key={c.id}
                    onClick={() => handleCall(c.name, c.phones)}
                    className="flex flex-col items-center gap-2 p-3 rounded-2xl active:scale-95 transition-transform"
                    style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="w-12 h-12 rounded-2xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                        style={{ background: 'var(--oem-warn-soft, rgba(245,158,11,0.12))', border: '1px solid var(--oem-warn, rgba(245,158,11,0.25))' }}>
                        <span className="text-sm font-black" style={{ color: 'var(--oem-warn, #f59e0b)' }}>{initials}</span>
                      </div>
                    )}
                    <span className="text-[10px] font-bold truncate w-full text-center" style={{ color: 'var(--oem-ink)' }}>{c.name.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Kişi listesi */}
        <div>
          {!query && <div className="text-[10px] font-black uppercase tracking-widest mb-2 px-1" style={{ color: 'var(--oem-ink-3)' }}>Tüm Kişiler</div>}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm" style={{ color: 'var(--oem-ink-3)' }}>Kişiler yükleniyor…</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <User className="w-10 h-10" style={{ color: 'var(--oem-danger, #ef4444)' }} />
              <div className="text-sm text-center" style={{ color: 'var(--oem-danger, #ef4444)' }}>{error}</div>
              <div className="text-xs text-center" style={{ color: 'var(--oem-ink-3)' }}>Ayarlar → Uygulama İzinleri → Kişiler</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <User className="w-10 h-10" style={{ color: 'var(--oem-ink-3)' }} />
              <div className="text-sm text-center" style={{ color: 'var(--oem-ink-3)' }}>
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


