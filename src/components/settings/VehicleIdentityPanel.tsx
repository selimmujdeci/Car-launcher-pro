/**
 * VehicleIdentityPanel — Ayarlar > Araç: marka/model/yıl, amblem ve açılış ekranı.
 *
 * Kimlik aktif `VehicleProfile`'a `saveVehicleIdentity` ile yazılır (tek sahip).
 * Kaynak ayrımı gösterilir: kullanıcı seçimi "VIN ile doğrulandı" diye sunulmaz;
 * VIN seçimle çelişirse sessizce ezilmez, kullanıcıya sorulur.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { BRAND_TRADEMARK_NOTICE, IDENTITY_SOURCE_LABEL, getBrand } from '../../platform/vehicle/brandCatalog';
import {
  acceptVinBrand, checkBrandAgainstVin, currentCanonicalVin, dismissVinBrandConflict, getActiveVehicleProfile,
  saveVehicleIdentity,
} from '../../platform/vehicle/vehicleBrandIdentity';
import { prepareEmblemImage } from '../../platform/vehicle/emblemImage';
import { VehicleEmblem, resolveEmblem } from '../vehicle/VehicleEmblem';
import { VehicleIdentityFields, draftToIdentity, type VehicleIdentityDraft } from '../vehicle/VehicleIdentityFields';
import { showToast } from '../../platform/errorBus';

const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 48, borderRadius: 14, padding: '0 16px', fontSize: 14, fontWeight: 800,
  background: on ? 'var(--oem-accent-soft)' : 'var(--oem-surface-2, #303749)',
  border: `1.5px solid ${on ? 'var(--oem-accent)' : 'var(--oem-line)'}`, color: 'var(--oem-ink)',
});
const btn: React.CSSProperties = { ...chip(false), minHeight: 44 };

function useCanonicalVin(): string | null {
  const [vin, setVin] = useState(() => currentCanonicalVin());
  useEffect(() => {
    const t = setInterval(() => setVin(currentCanonicalVin()), 5000);
    return () => clearInterval(t);
  }, []);
  return vin;
}

export const VehicleIdentityPanel = memo(function VehicleIdentityPanel() {
  const profile = useStore((s) => s.settings.vehicleProfiles.find((p) => p.id === s.settings.activeVehicleProfileId) ?? null);
  const bootStyle = useStore((s) => s.settings.bootSplashStyle);
  const vin = useCanonicalVin();
  const check = checkBrandAgainstVin(vin, profile);
  const emblem = resolveEmblem(profile);
  const brand = getBrand(profile?.brandId);

  const [editing, setEditing] = useState(!profile?.brandId && !profile?.model);
  const [draft, setDraft] = useState<VehicleIdentityDraft>(() => ({
    brandId: profile?.brandId ?? null, model: profile?.model ?? '', year: profile?.modelYear ? String(profile.modelYear) : '',
  }));
  const fileRef = useRef<HTMLInputElement>(null);

  const sourceLabel = check.kind === 'match'
    ? IDENTITY_SOURCE_LABEL.vin_proven
    : profile?.identitySource ? IDENTITY_SOURCE_LABEL[profile.identitySource] : null;

  const save = () => {
    saveVehicleIdentity({ ...draftToIdentity(draft), source: 'user_selected' });
    setEditing(false);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const src = await prepareEmblemImage(f);
      if (!getActiveVehicleProfile()) saveVehicleIdentity({ brandId: null, source: 'user_selected' });
      const target = getActiveVehicleProfile();
      if (target) useStore.getState().updateVehicleProfile(target.id, { customEmblem: src });
    } catch {
      showToast({ type: 'error', title: 'Görsel okunamadı', message: 'PNG, JPG veya WebP bir görsel seç.' });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="grid place-items-center rounded-2xl flex-shrink-0"
          style={{ width: 84, height: 84, background: '#05070b', border: '1px solid var(--oem-line)' }}>
          {emblem
            ? <VehicleEmblem emblem={emblem} treatment={profile?.emblemTreatment ?? 'neon'} variant="static" size={60} />
            : <span style={{ fontSize: 28, color: 'var(--oem-ink-3)' }}>—</span>}
        </span>
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--oem-ink)' }}>
            {[brand?.name, profile?.model].filter(Boolean).join(' ') || 'Araç seçilmedi'}
            {profile?.modelYear ? <span style={{ fontWeight: 600, color: 'var(--oem-ink-2)' }}> · {profile.modelYear}</span> : null}
          </div>
          {sourceLabel && <div style={{ fontSize: 13, color: 'var(--oem-ink-3)' }}>Kaynak: {sourceLabel}</div>}
        </div>
        {!editing && <button type="button" style={btn} onClick={() => setEditing(true)}>Değiştir</button>}
      </div>

      {check.kind === 'conflict' && vin && (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl p-3"
          style={{ background: 'rgba(251,146,60,.12)', border: '1px solid rgba(251,146,60,.4)' }}>
          <div style={{ fontSize: 14, color: 'var(--oem-ink)' }}>
            OBD'den okunan VIN <b>{check.vinBrand.name}</b> gösteriyor; seçimin <b>{check.selected?.name ?? '—'}</b>. Hangisi doğru?
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" style={btn} onClick={() => acceptVinBrand(check.vinBrand)}>{check.vinBrand.name} olarak düzelt</button>
            <button type="button" style={btn} onClick={() => dismissVinBrandConflict(vin)}>Seçimim doğru</button>
          </div>
        </div>
      )}
      {check.kind === 'suggest' && !editing && (
        <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 14, color: 'var(--oem-ink-2)' }}>
          OBD'den okunan VIN <b style={{ color: 'var(--oem-ink)' }}>{check.vinBrand.name}</b> gösteriyor.
          <button type="button" style={btn}
            onClick={() => saveVehicleIdentity({ brandId: check.vinBrand.id, model: profile?.model, modelYear: profile?.modelYear, source: 'vin_proven' })}>
            Kullan
          </button>
        </div>
      )}

      {editing && (
        <>
          <VehicleIdentityFields value={draft} onChange={setDraft} />
          <div className="flex gap-2 justify-end">
            {(profile?.brandId || profile?.model) && <button type="button" style={btn} onClick={() => setEditing(false)}>Vazgeç</button>}
            <button type="button" onClick={save}
              style={{ ...btn, background: 'var(--oem-accent)', color: 'var(--oem-accent-ink, #1A140A)', border: 'none' }}>Kaydet</button>
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--oem-ink)' }}>Açılış ekranı</div>
        <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Açılış ekranı">
          <button type="button" role="radio" aria-checked={bootStyle === 'caros'} style={chip(bootStyle === 'caros')}
            onClick={() => useStore.getState().updateSettings({ bootSplashStyle: 'caros' })}>CarOS Pro</button>
          <button type="button" role="radio" aria-checked={bootStyle === 'emblem'} style={chip(bootStyle === 'emblem')}
            disabled={!emblem}
            onClick={() => useStore.getState().updateSettings({ bootSplashStyle: 'emblem' })}>Araç amblemli</button>
        </div>
        {!emblem && <div style={{ fontSize: 13, color: 'var(--oem-ink-3)' }}>Araç amblemli açılış için önce marka seç ya da kendi görselini ekle.</div>}
        {bootStyle === 'emblem' && <div style={{ fontSize: 13, color: 'var(--oem-ink-3)' }}>Sürüşte ve geri viteste oynamaz; dokununca geçilir.</div>}
      </div>

      <div className="flex flex-col gap-2">
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--oem-ink)' }}>Amblem</div>
          <div className="flex gap-2 flex-wrap">
            {profile && (['neon', 'original'] as const).map((t) => {
              const on = (profile.emblemTreatment ?? 'neon') === t;
              return (
                <button key={t} type="button" aria-pressed={on} style={chip(on)}
                  onClick={() => useStore.getState().updateVehicleProfile(profile.id, { emblemTreatment: t })}>
                  {t === 'neon' ? 'Cam / Neon' : 'Orijinal renk'}
                </button>
              );
            })}
            <button type="button" style={chip(false)} onClick={() => fileRef.current?.click()}>Kendi görselini ekle</button>
            {profile?.customEmblem && (
              <button type="button" style={chip(false)}
                onClick={() => useStore.getState().updateVehicleProfile(profile.id, { customEmblem: undefined })}>Görseli kaldır</button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <div style={{ fontSize: 12, color: 'var(--oem-ink-3)' }}>Görsel yalnız bu cihazda saklanır.</div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--oem-ink-3)' }}>{BRAND_TRADEMARK_NOTICE}</div>
    </div>
  );
});
