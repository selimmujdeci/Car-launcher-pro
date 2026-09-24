/**
 * DriverSwitcher — durum çubuğunda hızlı sürücü değiştirme (tüm temalar).
 *
 * `StatusControls` içinde durur → dört temanın hepsinde aynı yer, aynı davranış.
 * Karar/uygulama burada DEĞİL: tek otorite `driverProfileService` (çıkanı kaydet,
 * geleni uygula, otomatik hafıza). Bu bileşen yalnız seçimi iletir.
 *
 * Sürücü bir bağlantı durumu değildir → yeşil/kırmızı nokta YOK (`neutral`).
 */
import { memo, useCallback, useState } from 'react';
import { UserRound, Check, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type DriverProfile } from '../../store/useStore';
import { switchDriver, clearActiveDriver } from '../../platform/driverProfileService';
import { openDrawer } from '../../platform/drawerBus';
import { focusSettingsSection } from '../../platform/settingsFocusBus';
import { showToast } from '../../platform/errorBus';
import { StatusItem } from './StatusItem';
import type { StatusPalette } from './StatusControls';

function Avatar({ d, size }: { d: DriverProfile; size: number }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: size / 2, flex: 'none',
      display: 'grid', placeItems: 'center', fontSize: size * 0.45, fontWeight: 900,
      background: `${d.color}26`, border: `2px solid ${d.color}`, color: d.color,
    }}>
      {d.name.trim().charAt(0).toLocaleUpperCase('tr') || '?'}
    </span>
  );
}

function DriverSwitcherInner({ palette, size }: { palette: StatusPalette; size: number }) {
  const { drivers, activeId } = useStore(useShallow((s) => ({
    drivers: s.settings.driverProfiles ?? [],
    activeId: s.settings.activeDriverProfileId,
  })));
  const [open, setOpen] = useState(false);
  const active = drivers.find((d) => d.id === activeId) ?? null;

  const pick = useCallback((d: DriverProfile) => {
    setOpen(false);
    if (d.id === activeId) return;
    if (switchDriver(d.id)) {
      showToast({ type: 'success', title: `Hoş geldin, ${d.name}`, message: 'Sürücü tercihlerin uygulandı.', duration: 2500 });
    }
  }, [activeId]);

  const guest = useCallback(() => {
    setOpen(false);
    if (activeId) clearActiveDriver();
  }, [activeId]);

  const manage = useCallback(() => {
    setOpen(false);
    openDrawer('settings');
    focusSettingsSection('profiles');
  }, []);

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48,
    padding: '6px 10px', borderRadius: 12, background: 'transparent', border: 'none',
    cursor: 'pointer', color: palette.ink, fontSize: 14, fontWeight: 700, textAlign: 'left',
  };

  return (
    <div style={{ position: 'relative' }}>
      <StatusItem
        Icon={UserRound}
        state="neutral"
        /* Türkçe büyük harf burada: CSS `uppercase` "Misafir"i "MISAFIR" (noktasız) yapıyordu. */
        caption={(active ? active.name : 'Misafir').toLocaleUpperCase('tr')}
        label={active ? `Sürücü: ${active.name} — değiştir` : 'Sürücü seçili değil — sürücü seç'}
        onClick={() => setOpen((o) => !o)}
        palette={palette}
        size={size}
      />
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 120 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Sürücü seç"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 121, width: 240,
              background: palette.surface ?? 'rgba(22,22,27,0.97)',
              border: `1px solid ${palette.line ?? 'rgba(255,255,255,0.14)'}`, borderRadius: 16,
              padding: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
            }}
          >
            {drivers.map((d) => (
              <button key={d.id} role="menuitemradio" aria-checked={d.id === activeId} onClick={() => pick(d)} style={row}>
                <Avatar d={d} size={30} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                {d.id === activeId && <Check style={{ width: 16, height: 16, color: palette.accent }} />}
              </button>
            ))}
            <button role="menuitemradio" aria-checked={!active} onClick={guest} style={{ ...row, color: palette.ink2 }}>
              <UserRound style={{ width: 30, height: 18 }} />
              <span style={{ flex: 1 }}>Misafir</span>
              {!active && <Check style={{ width: 16, height: 16, color: palette.accent }} />}
            </button>
            <div style={{ height: 1, margin: '4px 6px', background: palette.line ?? 'rgba(255,255,255,0.12)' }} />
            <button role="menuitem" onClick={manage} style={{ ...row, color: palette.ink2, fontWeight: 600 }}>
              <Settings2 style={{ width: 30, height: 18 }} />
              <span style={{ flex: 1 }}>{drivers.length ? 'Sürücüleri yönet' : 'Sürücü ekle'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export const DriverSwitcher = memo(DriverSwitcherInner);
