/**
 * VehicleIdentityFields — marka ızgarası + model + yıl (kontrollü; kaydetmez).
 * Kurulum sihirbazı ve Ayarlar > Araç aynı parçayı kullanır; yazma çağıranda
 * (`saveVehicleIdentity`).
 */
import { memo, useMemo, useState } from 'react';
import { brandLogoPath, monogramOf, searchBrands } from '../../platform/vehicle/brandCatalog';

export interface VehicleIdentityDraft {
  brandId: string | null;
  model: string;
  year: string;
}

const field: React.CSSProperties = {
  background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line)', borderRadius: 14,
  padding: '12px 14px', fontSize: 17, color: 'var(--oem-ink)', minHeight: 52, width: '100%', outline: 'none',
};

export const VehicleIdentityFields = memo(function VehicleIdentityFields({ value, onChange, hint }: {
  value: VehicleIdentityDraft;
  onChange: (v: VehicleIdentityDraft) => void;
  /** Öneri kaynağı (ör. VIN) — seçim DEĞİL, yalnız bilgi satırı. */
  hint?: string | null;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => searchBrands(q), [q]);

  return (
    <div className="flex flex-col gap-3">
      {hint && <div style={{ fontSize: 14, color: 'var(--oem-ink-2)' }}>{hint}</div>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Marka ara (örn. Fiat)" aria-label="Marka ara" style={field} />
      {list.length === 0 && q.trim() && (
        <button type="button" onClick={() => onChange({ ...value, brandId: null, model: value.model || q.trim() })}
          className="text-left active:scale-95"
          style={{ ...field, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Listede yok — baş harfle devam et ({monogramOf(q)})
        </button>
      )}
      <div role="radiogroup" aria-label="Marka" className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', maxHeight: 300, overflowY: 'auto' }}>
        {list.map((b) => {
          const on = b.id === value.brandId;
          const path = brandLogoPath(b);
          return (
            <button key={b.id} type="button" role="radio" aria-checked={on}
              onClick={() => onChange({ ...value, brandId: on ? null : b.id })}
              className="flex flex-col items-center justify-center gap-1.5 active:scale-95"
              style={{ minHeight: 88, borderRadius: 14, padding: 8,
                background: on ? 'var(--oem-accent-soft)' : 'var(--oem-surface-2, #303749)',
                border: `1.5px solid ${on ? 'var(--oem-accent)' : 'var(--oem-line)'}`, color: 'var(--oem-ink)' }}>
              <svg viewBox="0 0 24 24" width={30} height={30} aria-hidden="true" fill="currentColor">
                {path ? <path d={path} /> : (
                  <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="700">
                    {monogramOf(b.name)}
                  </text>
                )}
              </svg>
              <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1, textAlign: 'center' }}>{b.name}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        <input value={value.model} maxLength={40} onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder="Model (örn. Clio)" aria-label="Model" style={field} />
        <input value={value.year} inputMode="numeric" maxLength={4}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, '') })}
          placeholder="Yıl" aria-label="Model yılı" style={{ ...field, width: 120, flex: 'none' }} />
      </div>
    </div>
  );
});

export function draftToIdentity(d: VehicleIdentityDraft) {
  const y = Number(d.year);
  return { brandId: d.brandId, model: d.model, modelYear: d.year.length === 4 && Number.isFinite(y) ? y : null };
}
