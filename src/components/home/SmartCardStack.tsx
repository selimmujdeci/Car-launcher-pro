/**
 * SmartCardStack — Proaktif Öneri Kartları
 *
 * Ana ekranın sol altında maksimum 2 kart gösterir.
 * 3. kart varsa arkada gölge olarak belirtilir (stack efekti).
 * Her kart slide-in animasyonuyla belirir, dokunmayla dismiss edilir.
 *
 * Sunlight-friendly: opak arka plan, yüksek kontrast badge'ler.
 * CLAUDE.md §3: Re-render sadece store değiştiğinde olur.
 */

import { memo, useCallback } from 'react';
import {
  Flame, Fuel, Wrench, Navigation, Music,
  ChevronRight, X, Clock,
} from 'lucide-react';
import { useStore, type SmartCard } from '../../store/useStore';
import { startNavigation }  from '../../platform/navigationService';
import { getFavoriteAddresses } from '../../platform/addressBookService';
import { Tv2 } from 'lucide-react';

/* ── İkon eşlemesi ───────────────────────────────────────────── */

const KIND_ICON: Record<string, React.ElementType> = {
  'engine-warning':      Flame,
  'fuel-warning':        Fuel,
  'fuel-suggestion':     Fuel,
  'maintenance-warning': Wrench,
  'route-work':          Navigation,
  'route-home':          Navigation,
  'music-suggestion':    Music,
  'theater-mode':        Tv2,
};

/* ── Tek kart ────────────────────────────────────────────────── */

interface CardProps {
  card:      SmartCard;
  index:     number;         // 0 = en öne, 1 = arkada
  total:     number;
  onDismiss: (id: string) => void;
  onAction:  (card: SmartCard) => void;
}

const SmartCardItem = memo(function SmartCardItem({
  card, index, total, onDismiss, onAction,
}: CardProps) {
  const Icon = KIND_ICON[card.kind] ?? ChevronRight;
  const isBack = index > 0;

  return (
    <div
      className={`
        relative w-[320px] rounded-2xl border transition-all duration-300 select-none
        ${isBack
          ? 'opacity-50 scale-[0.96] -mt-3 pointer-events-none'
          : 'opacity-100 scale-100 shadow-xl'}
      `}
      style={{
        backgroundColor: 'rgba(15,15,20,0.92)',
        borderColor:     `${card.color}40`,
        boxShadow:       isBack ? 'none' : `0 8px 32px ${card.color}25`,
        zIndex:          10 - index,
      }}
    >
      {/* Renkli sol kenar şeridi */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ backgroundColor: card.color }}
      />

      <div className="pl-4 pr-3 py-3 flex items-center gap-3">
        {/* İkon */}
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${card.color}20` }}
        >
          <Icon className="w-4.5 h-4.5" style={{ color: card.color }} />
        </div>

        {/* Metin */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white text-[13px] font-bold leading-tight truncate">
              {card.title}
            </span>
            {card.badge && (
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0"
                style={{ backgroundColor: `${card.color}30`, color: card.color }}
              >
                {card.badge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-slate-400 text-[11px] leading-snug truncate">
              {card.subtitle}
            </span>
            {card.eta && (
              <span className="text-slate-500 text-[10px] flex items-center gap-0.5 flex-shrink-0">
                <Clock className="w-2.5 h-2.5" />
                {card.eta}
              </span>
            )}
          </div>
        </div>

        {/* CTA + Kapat */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onAction(card)}
            className="text-[11px] font-black px-2.5 py-1.5 rounded-xl active:scale-95 transition-all"
            style={{ backgroundColor: `${card.color}25`, color: card.color }}
          >
            {card.cta}
          </button>
          <button
            onClick={() => onDismiss(card.id)}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-400 active:scale-90 transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Alt gölge göstergesi: arkasında başka kart varsa */}
      {index === 0 && total > 1 && (
        <div className="absolute -bottom-1.5 left-4 right-4 h-2 rounded-b-xl opacity-20"
          style={{ backgroundColor: card.color }} />
      )}
    </div>
  );
});

/* ── Stack bileşeni ──────────────────────────────────────────── */

interface SmartCardStackProps {
  /** Navigasyon/launch işlemlerini HomeScreen'e devreder */
  onNavigate?:   (destination: string) => void;
  onLaunch?:     (appId: string) => void;
  onOpenDrawer?: (drawer: string) => void;
  onSearchPoi?:  (query: string) => void;
}

export const SmartCardStack = memo(function SmartCardStack({
  onNavigate,
  onLaunch,
  onOpenDrawer,
  onSearchPoi,
}: SmartCardStackProps) {
  const cards   = useStore((s) => s.activeSmartCards);
  const dismiss = useStore((s) => s.dismissSmartCard);

  const handleAction = useCallback((card: SmartCard) => {
    dismiss(card.id);
    const { action } = card;

    switch (action.type) {
      case 'navigate': {
        if (onNavigate) {
          onNavigate(action.destination);
          return;
        }
        // Fallback: addressBook üzerinden
        const dest = action.destination === 'home' ? 'home' : 'work';
        const addr = getFavoriteAddresses().find((a) => a.category === dest);
        if (addr) startNavigation(addr);
        break;
      }
      case 'launch':
        onLaunch?.(action.appId);
        break;
      case 'open-drawer':
        if (action.drawer === 'theater') {
          // Theater Mode: prop zinciri gerekmez — store üzerinden direkt aktivasyon
          useStore.getState().setIsTheaterModeActive(true);
        } else {
          onOpenDrawer?.(action.drawer);
        }
        break;
      case 'search-poi':
        onSearchPoi?.(action.query);
        break;
    }
  }, [dismiss, onNavigate, onLaunch, onOpenDrawer, onSearchPoi]);

  if (cards.length === 0) return null;

  // Max 2 kart görünür; 3. kart mevcutsa 2. arkasında gölge olur
  const visible = cards.slice(0, 2);

  return (
    <div
      className="absolute bottom-4 left-4 z-40 flex flex-col-reverse gap-0 pointer-events-none"
      aria-label="Akıllı Öneriler"
    >
      {visible.map((card, i) => (
        <div
          key={card.id}
          className="pointer-events-auto animate-slide-up"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <SmartCardItem
            card={card}
            index={i}
            total={cards.length}
            onDismiss={dismiss}
            onAction={handleAction}
          />
        </div>
      ))}
    </div>
  );
});
