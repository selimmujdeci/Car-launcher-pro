/**
 * driverProfileService — sürücü profilleri (kişisel tercih hafızası).
 *
 * Araç profilinden AYRIDIR (araç = tahrik/OBD/VIN, `vehicleProfileService`).
 * Bir sürücü profili, uygulamanın GERÇEKTEN uygulayabildiği kişisel tercihleri
 * taşır (`DRIVER_PREF_KEYS` + tema + Ev/İş). Koltuk/iklim gibi araca komut
 * gerektiren tercihler YOKTUR — uygulamanın araca yazma yolu yoktur.
 *
 * Davranış (OEM sürücü hafızası gibi):
 *  · Profil seçilince: önce ÇIKAN sürücünün güncel hâli onun profiline yazılır,
 *    sonra GELEN sürücünün tercihleri tek seferde uygulanır.
 *  · Bir sürücü etkinken yapılan her tercih değişikliği o profile KENDİLİĞİNDEN
 *    kaydedilir ("kaydet" düğmesi gerekmez).
 *  · Kaydedilmemiş tercih UYGULANMAZ (sahte varsayılan yazılmaz).
 *
 * Tek otorite: ayarların sahibi hâlâ `useStore` / `useCarTheme` / adres defteri;
 * bu servis yalnız onların kanonik yazma yollarını çağırır.
 */
import {
  useStore, DRIVER_PREF_KEYS, DRIVER_COLORS,
  type AppSettings, type DriverPrefs, type DriverProfile, type DriverQuickAddress,
} from '../store/useStore';
import { useCarTheme, type CarTheme } from '../store/useCarTheme';
import { useSystemStore } from '../store/useSystemStore';
import { setVolume, setBrightness } from './systemSettingsService';
import {
  getQuickAddress, setQuickAddress, clearQuickAddress, subscribeAddressBook,
  type QuickAddressCategory,
} from './addressBookService';

export const MAX_DRIVER_PROFILES = 6;

/** Uygulama sırasında senkron yazımı bastırır (kendi yazdığımızı geri kaydetmeyelim). */
let _applying = false;

function _quick(cat: QuickAddressCategory): DriverQuickAddress | null {
  const a = getQuickAddress(cat);
  return a ? { name: a.name, latitude: a.latitude, longitude: a.longitude, fullAddress: a.fullAddress } : null;
}

/** Şimdiki tercihleri yakalar — yeni profil ve otomatik hafıza bunu kullanır. */
export function captureDriverPrefs(): DriverPrefs {
  const s = useStore.getState().settings;
  const prefs: Record<string, unknown> = {};
  for (const k of DRIVER_PREF_KEYS) {
    const v = s[k];
    if (v !== undefined) prefs[k] = Array.isArray(v) ? [...v] : v;
  }
  return {
    ...(prefs as DriverPrefs),
    carTheme: useCarTheme.getState().theme,
    home: _quick('home'),
    work: _quick('work'),
  };
}

function _applyQuick(cat: QuickAddressCategory, a: DriverQuickAddress | null | undefined): void {
  if (a === undefined) return;                 // bu profilde hiç kaydedilmemiş → dokunma
  if (a === null) { clearQuickAddress(cat); return; }
  setQuickAddress(cat, a);
}

function _pct(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
}

/** Profilin tercihlerini uygular — her alan KENDİ kanonik yazma yolundan. */
function _applyPrefs(p: DriverPrefs): void {
  const patch: Partial<AppSettings> = {};
  for (const k of DRIVER_PREF_KEYS) {
    const v = p[k];
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  }
  const vol = _pct(p.volume);
  const bri = _pct(p.brightness);
  if (vol !== null) patch.volume = vol;
  if (bri !== null) patch.brightness = bri;
  if (Object.keys(patch).length) useStore.getState().updateSettings(patch);
  // Ses/parlaklık ayar ekranındaki kaydırıcıyla AYNI yoldan sisteme de yazılır.
  if (vol !== null) setVolume(vol);
  if (bri !== null) {
    setBrightness(bri);
    useSystemStore.getState().setUserOverride(120_000);  // oto-parlaklık hemen ezmesin
  }
  if (p.carTheme) {
    const t = useCarTheme.getState();
    if (t.theme !== p.carTheme) t.setTheme(p.carTheme as CarTheme);  // setTheme normalize eder
  }
  _applyQuick('home', p.home);
  _applyQuick('work', p.work);
}

function _profiles(): DriverProfile[] {
  return useStore.getState().settings.driverProfiles ?? [];
}

function _writeProfiles(list: DriverProfile[], activeId?: string | null): void {
  const patch: Partial<AppSettings> = { driverProfiles: list };
  if (activeId !== undefined) patch.activeDriverProfileId = activeId;
  useStore.getState().updateSettings(patch);
}

/** Etkin sürücünün profiline şimdiki tercihleri yazar. */
function _saveActive(): void {
  const { activeDriverProfileId: id } = useStore.getState().settings;
  if (!id) return;
  const prefs = captureDriverPrefs();
  const list = _profiles();
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return;
  if (JSON.stringify(list[i].prefs) === JSON.stringify(prefs)) return;   // değişiklik yok → yazma yok
  const next = [...list];
  next[i] = { ...list[i], prefs };
  _writeProfiles(next);
}

/** Sürücüye geç: çıkan sürücü kaydedilir, gelen sürücünün tercihleri uygulanır. */
export function switchDriver(id: string): boolean {
  const target = _profiles().find((d) => d.id === id);
  if (!target) return false;
  _saveActive();
  _applying = true;
  try {
    const list = _profiles().map((d) => d.id === id ? { ...d, lastUsedAt: new Date().toISOString() } : d);
    _writeProfiles(list, id);
    _applyPrefs(target.prefs);
  } finally {
    _applying = false;
  }
  return true;
}

/** Sürücü seçimini kaldır (misafir): tercihler olduğu gibi kalır, artık kaydedilmez. */
export function clearActiveDriver(): void {
  _saveActive();
  useStore.getState().updateSettings({ activeDriverProfileId: null });
}

/** Yeni sürücü — şimdiki tercihlerle başlar ve etkin olur. */
export function addDriver(name: string): DriverProfile | null {
  const clean = name.trim().slice(0, 32);
  const list = _profiles();
  if (!clean || list.length >= MAX_DRIVER_PROFILES) return null;
  _saveActive();
  const used = new Set(list.map((d) => d.color));
  const color = DRIVER_COLORS.find((c) => !used.has(c)) ?? DRIVER_COLORS[list.length % DRIVER_COLORS.length];
  const now = new Date().toISOString();
  const d: DriverProfile = {
    id: `drv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: clean, color, createdAt: now, lastUsedAt: now, prefs: captureDriverPrefs(),
  };
  _writeProfiles([..._profiles(), d], d.id);
  return d;
}

export function renameDriver(id: string, name: string): void {
  const clean = name.trim().slice(0, 32);
  if (!clean) return;
  _writeProfiles(_profiles().map((d) => d.id === id ? { ...d, name: clean } : d));
}

export function removeDriver(id: string): void {
  const s = useStore.getState().settings;
  _writeProfiles(_profiles().filter((d) => d.id !== id),
    s.activeDriverProfileId === id ? null : undefined);
}

/* ── Otomatik hafıza ─────────────────────────────────────────────────────── */

let _unsubs: Array<() => void> = [];
let _timer: ReturnType<typeof setTimeout> | null = null;

function _schedule(): void {
  if (_applying) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; if (!_applying) _saveActive(); }, 800);
}

function _prefsKey(s: AppSettings): string {
  return DRIVER_PREF_KEYS.map((k) => JSON.stringify(s[k] ?? null)).join('|');
}

/** Etkin sürücünün tercih değişikliklerini izler ve profiline yazar. İdempotent. */
export function startDriverProfileSync(): () => void {
  stopDriverProfileSync();
  let last = _prefsKey(useStore.getState().settings);
  _unsubs.push(useStore.subscribe((st) => {
    const k = _prefsKey(st.settings);
    if (k === last) return;              // sürücü tercihi dışı değişim → yazma yok
    last = k;
    _schedule();
  }));
  _unsubs.push(useCarTheme.subscribe(_schedule));
  _unsubs.push(subscribeAddressBook(_schedule));
  return stopDriverProfileSync;
}

export function stopDriverProfileSync(): void {
  for (const u of _unsubs) u();
  _unsubs = [];
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

/** Test yardımcısı: bekleyen otomatik kaydı hemen çalıştırır. */
export function _flushDriverSyncForTest(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; _saveActive(); }
}
