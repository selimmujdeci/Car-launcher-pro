import { memo, useCallback } from 'react';
import { Star } from 'lucide-react';
import type { AppItem } from '../../data/apps';

interface Props {
  apps: AppItem[];
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onLaunch: (id: string) => void;
  gridColumns?: 3 | 4 | 5;
}

interface AppItemProps {
  app: AppItem;
  isFav: boolean;
  index: number;
  onToggleFavorite: (id: string) => void;
  onLaunch: (id: string) => void;
}

const COL_CLASS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

const AppItemCard = memo(function AppItemCard({ app, isFav, index, onToggleFavorite, onLaunch }: AppItemProps) {
  const handleLaunch = useCallback(() => onLaunch(app.id), [app.id, onLaunch]);
  const handleFavorite = useCallback(() => onToggleFavorite(app.id), [app.id, onToggleFavorite]);

  return (
    <div
      className="relative animate-slide-up"
      style={{ animationDelay: (Math.min(index, 5) * 15) + "ms" }}
    >
      <button
        onClick={handleLaunch}
        className="w-full aspect-square flex flex-col items-center justify-center gap-6 rounded-[3rem] glass-card border-white/10 hover:border-white/30 hover:scale-[1.03] active:scale-[0.92] transition-all duration-500 group shadow-lg"
      >
        <span className="text-8xl leading-none drop-shadow-2xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">{app.icon}</span>
        <span className="text-primary text-[15px] font-black px-4 text-center leading-tight truncate w-full tracking-[0.05em] uppercase">
          {app.name}
        </span>
      </button>

      {app.supportsFavorite && (
        <button
          onClick={handleFavorite}
          className={`absolute top-5 right-5 w-12 h-12 flex items-center justify-center rounded-[1.25rem] transition-all duration-300 active:scale-90 shadow-2xl glass-card ${
            isFav
              ? 'text-yellow-500 border-yellow-400/40 shadow-[0_0_20px_rgba(250,204,21,0.3)] bg-yellow-500/10'
              : 'text-secondary/20 border-white/5 hover:text-secondary/40'
          }`}
        >
          <Star className={"w-6 h-6 " + (isFav ? 'fill-yellow-500' : '')} />
        </button>
      )}
    </div>
  );
});

export const AppGrid = memo(function AppGrid({ apps, favorites, onToggleFavorite, onLaunch, gridColumns = 3 }: Props) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div className="p-8 pb-12">

        {/* Başlık */}
        <div className="flex items-center justify-between mb-10 px-4">
          <div>
            <h2 className="text-4xl font-black text-primary uppercase tracking-[0.2em] drop-shadow-sm">Uygulamalar</h2>
            <div className="h-1.5 w-16 bg-blue-500 rounded-full mt-3 shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-[0.3em] text-secondary opacity-50 glass-card px-5 py-2.5 border-white/10 shadow-sm">
            {apps.length} TOPLAM SİSTEM
          </span>
        </div>

        {/* Grid */}
        <div className={`grid ${COL_CLASS[gridColumns] ?? 'grid-cols-3'} gap-6`}>
          {apps.map((app, index) => (
            <AppItemCard
              key={app.id}
              app={app}
              isFav={favorites.includes(app.id)}
              index={index}
              onToggleFavorite={onToggleFavorite}
              onLaunch={onLaunch}
            />
          ))}
        </div>

      </div>
    </div>
  );
});


