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
        className="w-full aspect-square flex flex-col items-center justify-center gap-4 rounded-[2.25rem] bg-[#02040a] border-2 border-white/10 shadow-xl hover:bg-[#0a0e1a] active:scale-[0.94] transition-all duration-100"
      >
        <span className="text-6xl leading-none drop-shadow-md">{app.icon}</span>
        <span className="text-white text-lg font-black px-2 text-center leading-tight truncate w-full tracking-tight">
          {app.name}
        </span>
      </button>

      {app.supportsFavorite && (
        <button
          onClick={handleFavorite}
          className={`absolute top-3 right-3 w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-100 active:scale-90 shadow-lg ${
            isFav
              ? 'text-yellow-400 bg-yellow-400/20 border-2 border-yellow-400/30'
              : 'text-slate-400 bg-black/60 border-2 border-white/10'
          }`}
        >
          <Star className={"w-5 h-5 " + (isFav ? 'fill-yellow-400' : '')} />
        </button>
      )}
    </div>
  );
});

export const AppGrid = memo(function AppGrid({ apps, favorites, onToggleFavorite, onLaunch, gridColumns = 3 }: Props) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="p-5 pb-8">

        {/* Başlık */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-white">Uygulamalar</h2>
          <span className="text-[13px] text-slate-400 bg-white/[0.07] border border-white/[0.1] rounded-full px-3 py-1 tabular-nums">
            {apps.length} uygulama
          </span>
        </div>

        {/* Grid */}
        <div className={`grid ${COL_CLASS[gridColumns] ?? 'grid-cols-3'} gap-4`}>
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
