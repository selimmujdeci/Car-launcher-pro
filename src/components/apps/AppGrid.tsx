import { memo } from 'react';
import { Star } from 'lucide-react';
import type { AppItem } from '../../data/apps';

interface Props {
  apps: AppItem[];
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onLaunch: (id: string) => void;
  gridColumns?: 3 | 4 | 5;
}

const COL_CLASS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

function AppGrid({ apps, favorites, onToggleFavorite, onLaunch, gridColumns = 3 }: Props) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="p-5 pb-8">

        {/* Başlık */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-white">Uygulamalar</h2>
          <span className="text-[11px] text-slate-600 bg-white/5 border border-white/5 rounded-full px-3 py-1 tabular-nums">
            {apps.length} uygulama
          </span>
        </div>

        {/* Grid */}
        <div className={`grid ${COL_CLASS[gridColumns] ?? 'grid-cols-3'} gap-4`}>
          {apps.map((app, index) => {
            const isFav = favorites.includes(app.id);
            return (
              <div
                key={app.id}
                className="relative animate-slide-up"
                style={{ animationDelay: `${Math.min(index, 11) * 25}ms` }}
              >

                <button
                  onClick={() => onLaunch(app.id)}
                  className="w-full aspect-square flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#0d1628] border border-white/5 shadow-lg hover:bg-[#111f38] hover:border-white/10 active:scale-[0.96] active:bg-[#0a1020] transition-[transform,background-color,border-color] duration-150"
                >
                  <span className="text-5xl leading-none">{app.icon}</span>
                  <span className="text-slate-200 text-sm font-medium px-2 text-center leading-tight truncate w-full">
                    {app.name}
                  </span>
                </button>

                {app.supportsFavorite && (
                  <button
                    onClick={() => onToggleFavorite(app.id)}
                    className={`absolute top-2 right-2 w-10 h-10 flex items-center justify-center rounded-xl transition-[transform,background-color,border-color,color] duration-150 active:scale-90 ${
                      isFav
                        ? 'text-yellow-400 bg-yellow-400/15 border border-yellow-400/20 hover:bg-yellow-400/25'
                        : 'text-slate-600 bg-black/30 border border-white/5 hover:text-yellow-400/60 hover:bg-yellow-400/10'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${isFav ? 'fill-yellow-400' : ''}`} />
                  </button>
                )}

              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

export default memo(AppGrid);
