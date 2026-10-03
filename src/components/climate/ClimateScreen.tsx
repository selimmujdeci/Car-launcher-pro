/*
 * KONTRAST DÜZELTMESİ (saha 2026-08-05 · kütük #412-d / #425).
 *
 * CİHAZDA ÖLÇÜLDÜ (ekran görüntüsü): `A/C` · `AUTO` · `SYNC` etiketleri ve
 * sıcaklık değerleri (22.0 / 21.0) **beyaz üzerine beyaz** çıkıyor, koltuk
 * ısıtma kademe rakamları görünmüyordu. KÖK: bu ekran tamamen karanlık tema
 * VARSAYIMIYLA yazılmıştı — `text-white` ve sabit `rgba(255,255,255,…)`
 * değerleri, açık/gündüz paletinde beyaz zeminle aynı renge düşüyordu.
 * Tüm renkler kanonik `--oem-*` token katmanına taşındı: tema ve gün/gece
 * geçişlerinde kontrast otomatik korunur (tasarım sistemi tek katman kuralı).
 */
/*
 * GERÇEK VERİ (2026-10-03): bu ekran eskiden TAMAMEN SAHTEYDİ — sabit 22/21 °C, fan 3,
 * uydurma kabin sıcaklığı simülasyonu ve araca hiçbir şey göndermeyen ama basınca
 * "değişmiş" görünen düğmeler (sahte onay). Artık aracın CAN'den bildirdiği klima
 * durumunu (store `canClimate`) GÖSTERİR. Klima yazımı bilinçli olarak YOK → düğme
 * değil durum rozeti; araçta olmayan koltuk/direksiyon ısıtma kaldırıldı. Bilinmeyen
 * değer "—"; CAN akışı sustuysa "son bilinen" uyarısı.
 */
import { memo, useRef } from 'react';
import { Thermometer, Wind, X } from 'lucide-react';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useVehicleAccess } from '../../hooks/useVehicleAccess';
import { ComfortPanel } from './ComfortPanel';

/* ── Renk hesaplamaları ──────────────────────────── */

type RGB = readonly [number, number, number];

function lc(a: RGB, b: RGB, t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(',')})`;
}

function tc(temp: number, on = true): string {
  if (!on) return 'var(--oem-line)';
  const f = Math.max(0, Math.min(1, (temp - 16) / 14));
  if (f < 0.4) return lc([59, 130, 246], [16, 185, 129], f / 0.4);
  if (f < 0.7) return lc([16, 185, 129], [245, 158, 11], (f - 0.4) / 0.3);
  return lc([245, 158, 11], [239, 68, 68], (f - 0.7) / 0.3);
}

/* ── Dairesel sıcaklık arki ─────────────────────── */

function Arc({ temp, on }: { temp: number; on: boolean }) {
  const r = 62, cx = 80, cy = 80;
  const xy = (deg: number): [number, number] => {
    const a = (deg - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  /* Altı açık 240° gösterge: 8 yönünden (−120°) saat yönünde tepeden 4 yönüne (+120°).
     (Eski açılar 210°→330° ve ters yönlü dolgu yayı bozuk çiziyordu; çizgi kalınlığı
     güneş modunda 0'a ezildiği için hiç GÖRÜNMÜYORDU — 2026-10-03 birlikte düzeldi.) */
  const [sx, sy] = xy(-120);
  const [ex, ey] = xy(120);
  const frac = Math.max(0, Math.min(1, (temp - 16) / 14));
  const [fx, fy] = xy(-120 + frac * 240);
  const col = tc(temp, on);
  const f = (n: number) => n.toFixed(1);
  return (
    <svg width="160" height="160" viewBox="0 0 160 160" className="absolute inset-0 pointer-events-none">
      {/* Çizgi SATIR İÇİ STİL ile (nitelik DEĞİL): güneş modu kuralı
          `svg *[fill] { stroke-width: 0 !important }` nitelikli yayı siliyordu
          (tarayıcıda ölçüldü 2026-10-03; EcoScoreCard ile aynı çözüm). */}
      {/* arka iz */}
      <path
        d={`M${f(sx)} ${f(sy)} A${r} ${r} 0 1 1 ${f(ex)} ${f(ey)}`}
        style={{ fill: 'none', stroke: 'var(--oem-line)', strokeWidth: 4.5, strokeLinecap: 'round' }}
      />
      {/* dolgu */}
      {frac > 0.005 && (
        <path
          d={`M${f(sx)} ${f(sy)} A${r} ${r} 0 ${frac * 240 > 180 ? 1 : 0} 1 ${f(fx)} ${f(fy)}`}
          style={{
            fill: 'none', stroke: col, strokeWidth: 4.5, strokeLinecap: 'round',
            filter: `drop-shadow(0 0 7px ${col})`, transition: 'stroke 0.3s',
          }}
        />
      )}
    </svg>
  );
}

/* ── Fan animasyonu ─────────────────────────────── */

function FanViz({ speed, on }: { speed: number; on: boolean }) {
  const spinning = on && speed > 0;
  const dur = speed > 0 ? `${Math.max(0.12, 0.85 / speed)}s` : '2s';
  return (
    <svg
      width="56" height="56" viewBox="0 0 56 56"
      className={spinning ? 'animate-spin' : ''}
      style={{ animationDuration: dur, opacity: on ? 1 : 0.18, transition: 'opacity 0.3s' }}
    >
      {[0, 90, 180, 270].map(a => (
        <ellipse key={a} cx="28" cy="13" rx="5.5" ry="12"
          fill="rgba(224,162,60,0.72)" transform={`rotate(${a} 28 28)`} />
      ))}
      <circle cx="28" cy="28" r="5" fill="var(--oem-ink)" />
    </svg>
  );
}

/* ── Durum rozetleri (DOKUNULMAZ — araca komut gitmez) ───────────────
   Saha 2026-10-03 (Megane): dolgulu kutu biçimi TUŞ sanıldı ("dokunuyorum tepki vermiyor").
   Artık zeminsiz nokta + etiket: gösterge olduğu görünür. */

function StatusChip({ label, active, editId }: { label: string; active: boolean | null; editId: string }) {
  const col = '#E0A23C';
  return (
    <div
      data-editable={editId} data-editable-type="card"
      className="flex-1 flex items-center justify-center gap-1.5 py-1 text-[11px] font-extrabold tracking-widest uppercase"
      style={{ color: active ? col : 'var(--oem-ink-3)', opacity: active === null ? 0.45 : 1 }}
    >
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{ width: 8, height: 8, background: active ? col : 'transparent', border: `1.5px solid ${active ? col : 'var(--oem-ink-4)'}` }}
      />
      {label}
      <span className="sr-only">{active === null ? 'bilinmiyor' : active ? 'açık' : 'kapalı'}</span>
    </div>
  );
}

function fmtTemp(t: number | null): string {
  return t === null ? '—' : t.toFixed(1);
}

function Zone({ title, temp, on }: { title: string; temp: number | null; on: boolean }) {
  const shown = on && temp !== null;
  return (
    <div data-editable="climate.zone" data-editable-type="card" className="flex-1 flex flex-col items-center gap-3">
      <span className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-[color:var(--oem-ink-4)]">{title}</span>
      <div className="relative" style={{ width: 160, height: 160 }}>
        <Arc temp={temp ?? 16} on={shown} />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span
            className="text-[42px] font-bold tabular-nums leading-none transition-colors duration-300"
            style={{ color: shown ? 'var(--oem-ink)' : 'var(--oem-ink-4)', fontVariantNumeric: 'tabular-nums' }}
          >
            {fmtTemp(temp)}
          </span>
          <span className="text-xs text-[color:var(--oem-ink-4)] mt-0.5">°C</span>
        </div>
      </div>
    </div>
  );
}

/* ── Ana bileşen ─────────────────────────────────── */

export const ClimateScreen = memo(function ClimateScreen({ onClose }: { onClose?: () => void }) {
  const c = useUnifiedVehicleStore((st) => st.canClimate);
  const outside = useUnifiedVehicleStore((st) => st.canAmbientTemp);
  const rootRef = useRef<HTMLDivElement>(null);
  const access = useVehicleAccess(rootRef);   // çekmece kapalıyken sorgu durur

  const on = c?.power === true;
  const fanMax = c?.fanMax && c.fanMax > 0 ? c.fanMax : 7;
  const fan = on ? (c?.fanLevel ?? null) : 0;
  const stale = access?.stream === 'STALE';

  return (
    <div
      ref={rootRef}
      data-theme-surface="climate" data-editable="climate.screen" data-editable-type="panel"
      className="flex flex-col h-full text-[color:var(--oem-ink)] select-none overflow-hidden"
      style={{ background: 'linear-gradient(155deg, #060c1a 0%, #030810 100%)' }}
    >
      {/* ── Başlık ── */}
      <header data-editable="climate.header" data-editable-type="header" className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <Wind size={16} className="text-[color:var(--oem-ink-3)]" />
          <span className="text-[13px] font-bold tracking-[0.18em] uppercase text-[color:var(--oem-ink-2)]">
            İklim
          </span>
          <span className="text-[11px] font-bold" style={{ color: c === null ? 'var(--oem-ink-4)' : on ? '#10b981' : 'var(--oem-ink-3)' }}>
            {c === null ? 'veri yok' : on ? 'açık' : 'kapalı'}
          </span>
        </div>

        {/* Dış sıcaklık (araçtan) */}
        {outside !== null && (
          <div
            data-editable="climate.cabin-badge" data-editable-type="card"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}
          >
            <Thermometer size={13} className="text-amber-400" />
            <span className="text-[13px] font-mono font-bold tracking-widest">{outside.toFixed(0)}°C</span>
            <span className="text-[11px] text-[color:var(--oem-ink-3)] ml-0.5">dış</span>
          </div>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full transition-all duration-200 active:scale-90"
            style={{ width: 44, height: 44, background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}
          >
            <X size={18} color="var(--oem-ink-2)" />
          </button>
        )}
      </header>

      <div className="shrink-0 mx-6 h-px" style={{ background: 'var(--oem-surface-2)' }} />

      {c !== null && stale && (
        <div className="shrink-0 mx-6 mt-3 text-[12px] font-semibold" style={{ color: '#fbbf24' }}>
          Araçtan bir süredir veri gelmiyor — gösterilenler son bilinen değer.
        </div>
      )}

      {/* Veri yokken boş halka / fan / rozet ÇİZİLMEZ — kontrol sanılıyordu (saha 2026-10-03). */}
      {c === null ? (
        <div className="flex-1 min-h-0 flex items-center justify-center px-8">
          <div
            className="max-w-[440px] rounded-2xl p-5 text-center"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}
          >
            <Wind size={28} className="mx-auto mb-3 text-[color:var(--oem-ink-3)]" />
            <div className="text-[15px] font-bold text-[color:var(--oem-ink)]">Araçtan klima bilgisi gelmiyor.</div>
            <div className="mt-2 text-[13px] leading-snug text-[color:var(--oem-ink-2)]">
              Klimayı aracın kendi düğmeleriyle kullanın. CarOS klimaya komut göndermez; araç bildirdiğinde durumu burada gösterir.
            </div>
          </div>
        </div>
      ) : (<>
      {/* ── Ana Bölge: Sürücü | Fan/Modlar | Yolcu ── */}
      <div className="flex items-center justify-center gap-3 px-4 py-4 flex-1 min-h-0">
        <Zone title="Sürücü" temp={c?.tempDriverC ?? null} on={on} />

        <div data-editable="climate.fan" data-editable-type="gauge" className="flex flex-col items-center gap-3 shrink-0" style={{ width: 176 }}>
          <FanViz speed={fan ?? 0} on={on} />
          <div className="flex gap-1.5 items-end h-9">
            {Array.from({ length: fanMax }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 14, height: 10 + i * 4, borderRadius: 4, flexShrink: 0,
                  background: fan !== null && fan > i && on ? `rgba(224,162,60,${0.45 + i * 0.08})` : 'var(--oem-surface-2)',
                }}
              />
            ))}
          </div>
          <span className="text-[10px] text-[color:var(--oem-ink-4)] font-bold tracking-widest">
            {!on ? 'KAPALI' : c?.auto ? 'FAN OTOMATİK' : fan === null ? 'FAN —' : `FAN ${fan}`}
          </span>
          <div className="flex w-full">
            <StatusChip label="A/C"  active={on && c.ac === true}   editId="climate.mode-button" />
            <StatusChip label="AUTO" active={on && c.auto === true} editId="climate.mode-button" />
            <StatusChip label="DUAL" active={on && c.dual === true} editId="climate.mode-button" />
          </div>
        </div>

        <Zone title="Yolcu" temp={c?.tempPassengerC ?? null} on={on} />
      </div>

      {/* ── Hava: iç hava · ön cam · arka cam ── */}
      <div className="shrink-0 px-4 pb-3">
        <div
          data-editable="climate.air-panel" data-editable-type="panel"
          className="rounded-2xl p-4"
          style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-surface-2)' }}
        >
          <div className="flex gap-2">
            <StatusChip label="İç hava"  active={c.recirc === true}       editId="climate.air-button" />
            <StatusChip label="Ön cam"   active={c.defrostFront === true} editId="climate.air-button" />
            <StatusChip label="Arka cam" active={c.defrostRear === true}  editId="climate.air-button" />
          </div>
        </div>
      </div>
      </>)}

      {/* ── Konfor: koltuk masajı · iç ambiyans (araç bildiriyorsa) ── */}
      <div className="shrink-0 px-4 pb-3">
        <ComfortPanel access={access} />
      </div>

      {c !== null && (
        <div className="shrink-0 px-6 pb-5 text-[12px] text-[color:var(--oem-ink-2)]">
          Klimayı aracın kendi düğmeleriyle yönetin; CarOS aracın bildirdiği durumu gösterir.
        </div>
      )}
    </div>
  );
});
