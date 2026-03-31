/**
 * Full-Coverage Edit Panel
 * Seçilen elemana bağlı açılır, tüm stil seçeneklerini sunar.
 * Değişiklikler anında uygulanır (no save needed).
 */
import { memo, useState, useCallback } from 'react';
import { X, RotateCcw, Globe, Monitor, EyeOff } from 'lucide-react';
import {
  useEditStore,
  EDITABLE_REGISTRY,
  STYLE_DEFAULTS,
  type ElementStyle,
} from '../../store/useEditStore';
import { COLOR_PRESETS, getContrastColor } from '../../platform/editStyleEngine';

interface Props {
  elementId: string;
  onClose: () => void;
}

type Tab = 'Renk' | 'Yazı' | 'Şekil' | 'Efekt';
const TABS: Tab[] = ['Renk', 'Yazı', 'Şekil', 'Efekt'];

/* ── Renk Seçici Satırı ─────────────────────────────────────── */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const isCustom = value !== null && !COLOR_PRESETS.some((p) => p.value === value);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em]">
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Varsayılan / Sıfırla */}
        <button
          onClick={() => onChange(null)}
          title="Varsayılan"
          className={`relative w-7 h-7 rounded-lg border-2 flex-shrink-0 transition-all active:scale-90 ${
            value === null
              ? 'border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.25)]'
              : 'border-white/20 hover:border-white/50'
          }`}
          style={{
            background:
              'repeating-linear-gradient(-45deg,#1e293b 0,#1e293b 2px,transparent 2px,transparent 7px)',
          }}
        >
          {value === null && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-white/60" />
            </div>
          )}
        </button>

        {/* Hazır renkler */}
        {COLOR_PRESETS.filter((p) => p.value !== null).map((p) => (
          <button
            key={p.id}
            title={p.label}
            onClick={() => onChange(p.value!)}
            className={`relative w-7 h-7 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-all active:scale-90 ${
              value === p.value
                ? 'border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.25)]'
                : 'border-white/15 hover:border-white/50'
            }`}
            style={{ backgroundColor: p.value! + 'cc' }}
          >
            {value === p.value && (
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getContrastColor(p.value!) }}
              />
            )}
          </button>
        ))}

        {/* Özel renk seçici */}
        <label
          title="Özel renk seç"
          className={`relative w-7 h-7 rounded-lg border-2 flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden transition-all active:scale-90 ${
            isCustom
              ? 'border-white scale-110'
              : 'border-dashed border-white/30 hover:border-white/60'
          }`}
          style={
            isCustom
              ? { backgroundColor: value + 'cc' }
              : {
                  background:
                    'conic-gradient(red 0deg,yellow 60deg,green 120deg,cyan 180deg,blue 240deg,magenta 300deg,red 360deg)',
                  opacity: 0.8,
                }
          }
        >
          <input
            type="color"
            value={value ?? '#3b82f6'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          {!isCustom && (
            <span className="text-[11px] font-black text-white drop-shadow z-10 pointer-events-none">
              +
            </span>
          )}
        </label>

        {/* Hex input */}
        {value !== null && (
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v) && v.length === 7) onChange(v);
            }}
            className="w-20 bg-white/8 border border-white/15 rounded-lg px-2 py-1 text-[10px] font-mono text-white uppercase tracking-widest focus:outline-none focus:border-blue-500 flex-shrink-0"
            maxLength={7}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

/* ── Ana Panel ──────────────────────────────────────────────── */
export const EditPanel = memo(function EditPanel({ elementId, onClose }: Props) {
  const { getStyle, updateElement, resetElement, updateGlobal } = useEditStore();
  const [tab, setTab] = useState<Tab>('Renk');
  const [scope, setScope] = useState<'local' | 'global'>('local');

  const style = getStyle(elementId);
  const info = EDITABLE_REGISTRY[elementId];
  const elementType = info?.type ?? 'card';

  const update = useCallback(
    (patch: Partial<ElementStyle>) => {
      if (scope === 'global') {
        updateGlobal(elementType, patch);
      } else {
        updateElement(elementId, patch);
      }
    },
    [scope, elementId, elementType, updateElement, updateGlobal],
  );

  const hide = useCallback(() => {
    updateElement(elementId, { visible: false });
    onClose();
  }, [elementId, updateElement, onClose]);

  const reset = useCallback(() => {
    resetElement(elementId);
  }, [elementId, resetElement]);

  // Seçili renk göstergesi için kullan
  const indicatorColor =
    style.accentColor ?? style.borderColor ?? style.bgColor ?? '#3b82f6';

  return (
    <>
      {/* Arka plan overlay */}
      <div className="fixed inset-0 z-[88]" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed left-0 right-0 z-[89] mx-2 animate-slide-up"
        style={{ bottom: 'var(--dock-h, 92px)' }}
      >
        <div className="bg-[#050e1c]/97 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-[0_-16px_64px_rgba(0,0,0,0.8)] overflow-hidden">

          {/* ── Başlık ── */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/8">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full border border-white/30 flex-shrink-0 transition-colors duration-150"
                style={{ backgroundColor: indicatorColor }}
              />
              <span className="text-white text-sm font-black uppercase tracking-[0.12em]">
                {info?.label ?? elementId}
              </span>
              <span className="text-[9px] text-emerald-400 font-black uppercase tracking-widest bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
                CANLI
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={hide}
                title="Gizle"
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/8 border border-red-500/18 active:scale-90 transition-all hover:bg-red-500/18"
              >
                <EyeOff className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button
                onClick={reset}
                title="Sıfırla"
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/6 border border-white/10 active:scale-90 transition-all hover:bg-white/12"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/6 border border-white/10 active:scale-90 transition-all hover:bg-white/12"
              >
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          {/* ── Scope + Tab bar ── */}
          <div className="flex items-center gap-2 px-4 pt-2.5 pb-2 border-b border-white/5">
            {/* Lokal / Global toggle */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-0.5 flex-shrink-0 border border-white/8">
              <button
                onClick={() => setScope('local')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                  scope === 'local' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Monitor className="w-2.5 h-2.5" />
                Sadece Bu
              </button>
              <button
                onClick={() => setScope('global')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                  scope === 'global' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Globe className="w-2.5 h-2.5" />
                Tümü
              </button>
            </div>

            <div className="w-px h-5 bg-white/10 flex-shrink-0" />

            {/* Tab'lar */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex-shrink-0 transition-all ${
                    tab === t
                      ? 'bg-white/14 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab İçeriği ── */}
          <div className="px-4 py-3 max-h-[220px] overflow-y-auto">

            {/* ─── RENK ─── */}
            {tab === 'Renk' && (
              <div className="flex flex-col gap-4">
                <ColorRow
                  label="Arka Plan Rengi"
                  value={style.bgColor}
                  onChange={(v) => update({ bgColor: v })}
                />

                {style.bgColor && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em]">
                        Arka Plan Yoğunluğu
                      </span>
                      <span className="text-white text-[10px] font-black tabular-nums">
                        {style.bgOpacity}%
                      </span>
                    </div>
                    <input
                      type="range" min={5} max={95} step={5}
                      value={style.bgOpacity}
                      onChange={(e) => update({ bgOpacity: Number(e.target.value) })}
                      className="w-full h-1 accent-blue-500"
                    />
                  </div>
                )}

                <ColorRow
                  label="Kenarlık Rengi"
                  value={style.borderColor}
                  onChange={(v) => update({ borderColor: v })}
                />
                <ColorRow
                  label="Yazı Rengi"
                  value={style.textColor}
                  onChange={(v) => update({ textColor: v })}
                />
                <ColorRow
                  label="Vurgu / Accent Rengi"
                  value={style.accentColor}
                  onChange={(v) => update({ accentColor: v })}
                />
              </div>
            )}

            {/* ─── YAZI ─── */}
            {tab === 'Yazı' && (
              <div className="flex flex-col gap-4">
                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Yazı Kalınlığı
                  </span>
                  <div className="flex gap-2">
                    {(
                      [
                        [null,  'Varsayılan'],
                        [400,   'Normal'    ],
                        [600,   'Orta'      ],
                        [700,   'Kalın'     ],
                        [900,   'Siyah'     ],
                      ] as const
                    ).map(([w, lbl]) => (
                      <button
                        key={String(w)}
                        onClick={() => update({ fontWeight: w ?? null })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                          style.fontWeight === w
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                        style={{ fontWeight: w ?? undefined }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em]">
                      Yazı Boyutu
                    </span>
                    <span className="text-white text-[10px] font-black tabular-nums">
                      {Math.round((style.fontScale ?? 1) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range" min={0.7} max={1.5} step={0.05}
                    value={style.fontScale ?? 1}
                    onChange={(e) => update({ fontScale: Number(e.target.value) })}
                    className="w-full h-1 accent-blue-500"
                  />
                  <div className="flex justify-between text-slate-600 text-[9px] mt-1">
                    <span>70%</span><span>100%</span><span>150%</span>
                  </div>
                </div>
              </div>
            )}

            {/* ─── ŞEKİL ─── */}
            {tab === 'Şekil' && (
              <div className="flex flex-col gap-4">
                {/* Boyut */}
                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Boyut
                  </span>
                  <div className="flex gap-2">
                    {(['small', 'default', 'large'] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => update({ size: sz })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                          style.size === sz
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                      >
                        {sz === 'small' ? 'Küçük' : sz === 'default' ? 'Normal' : 'Büyük'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kenarlık kalınlığı */}
                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Kenarlık Kalınlığı
                  </span>
                  <div className="flex gap-2">
                    {[0, 1, 2, 3, 4].map((w) => (
                      <button
                        key={w}
                        onClick={() => update({ borderWidth: w })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all active:scale-95 ${
                          style.borderWidth === w
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                      >
                        {w}px
                      </button>
                    ))}
                  </div>
                </div>

                {/* Köşe stili */}
                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Köşe Stili
                  </span>
                  <div className="flex gap-2">
                    {(
                      [
                        [0,   'Yok'  ],
                        [0.5, 'Az'   ],
                        [1,   'Orta' ],
                        [1.5, 'Fazla'],
                        [2.5, 'Tam'  ],
                      ] as const
                    ).map(([r, lbl]) => (
                      <button
                        key={r}
                        onClick={() => update({ borderRadius: r })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all active:scale-95 ${
                          style.borderRadius === r
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                        style={{ borderRadius: `${r * 6}px` }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Saydamlık */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em]">
                      Saydamlık
                    </span>
                    <span className="text-white text-[10px] font-black tabular-nums">
                      {style.opacity}%
                    </span>
                  </div>
                  <input
                    type="range" min={40} max={100} step={5}
                    value={style.opacity}
                    onChange={(e) => update({ opacity: Number(e.target.value) })}
                    className="w-full h-1 accent-blue-500"
                  />
                </div>
              </div>
            )}

            {/* ─── EFEKT ─── */}
            {tab === 'Efekt' && (
              <div className="flex flex-col gap-4">
                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Parlama (Glow)
                  </span>
                  <div className="flex gap-2">
                    {(
                      [
                        [0, 'Kapalı'],
                        [1, 'Hafif' ],
                        [2, 'Orta'  ],
                        [3, 'Güçlü'],
                      ] as const
                    ).map(([lvl, lbl]) => (
                      <button
                        key={lvl}
                        onClick={() => update({ glowLevel: lvl })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all active:scale-95 ${
                          style.glowLevel === lvl
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-2">
                    Gölge (Shadow)
                  </span>
                  <div className="flex gap-2">
                    {(
                      [
                        [0, 'Yok'  ],
                        [1, 'Hafif'],
                        [2, 'Orta' ],
                        [3, 'Derin'],
                      ] as const
                    ).map(([lvl, lbl]) => (
                      <button
                        key={lvl}
                        onClick={() => update({ shadowLevel: lvl })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all active:scale-95 ${
                          style.shadowLevel === lvl
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/6 text-slate-400 hover:bg-white/12'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scope bilgisi */}
                <div className="bg-white/4 rounded-2xl px-4 py-3 border border-white/6">
                  <div className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">
                    {scope === 'global' ? '🌐 Global Mod' : '📌 Lokal Mod'}
                  </div>
                  <div className="text-slate-400 text-[10px] leading-relaxed">
                    {scope === 'global'
                      ? `"${elementType}" tipindeki tüm kartlara uygulanıyor.`
                      : 'Sadece bu elemana uygulanıyor. Tümüne uygulamak için "Tümü" seç.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

// Şu an saklı olan tüm varsayılanlar
export { STYLE_DEFAULTS };
