import { memo } from 'react';
import type { PerformanceMode } from '../../platform/performanceMode';
import type { ModeSuggestion } from '../../platform/deviceDetection';

interface Props {
  suggestion: ModeSuggestion;
  currentMode: PerformanceMode;
  onAccept: (mode: PerformanceMode) => void;
  onDismiss: () => void;
}

export const PerformanceModeSuggestion = memo(function PerformanceModeSuggestion({
  suggestion,
  currentMode,
  onAccept,
  onDismiss,
}: Props) {
  if (suggestion.suggested === currentMode) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onDismiss}
      />

      {/* Modal */}
      <div className="relative bg-[#0d1628] border border-blue-500/30 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{suggestion.icon}</span>
          <h2 className="text-xl font-semibold text-white">Performans Önerisi</h2>
        </div>

        {/* Reason */}
        <p className="text-slate-300 text-sm mb-6 leading-relaxed">
          {suggestion.reason}
        </p>

        {/* Mode display */}
        <div className="bg-white/5 rounded-lg p-4 mb-6 border border-white/10">
          <div className="text-xs text-slate-500 mb-2">Önerilen Mod</div>
          <div className="text-lg font-semibold text-blue-400">
            {suggestion.suggested === 'lite' && '⚡ Hafif'}
            {suggestion.suggested === 'balanced' && '⚙️ Dengeli'}
            {suggestion.suggested === 'premium' && '🚀 Premium'}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-medium text-sm transition-[background-color,border-color] duration-150 hover:bg-white/10 hover:border-white/20"
          >
            Şimdi Değil
          </button>
          <button
            onClick={() => onAccept(suggestion.suggested)}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm transition-[background-color] duration-150 hover:bg-blue-700 active:scale-95"
          >
            Uygula
          </button>
        </div>
      </div>
    </div>
  );
});
