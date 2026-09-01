import { create } from 'zustand';

export interface Address {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: 'favorite' | 'history';
  category?: 'home' | 'work' | 'other';
  lastVisited?: number;
  visitCount?: number;
  /** Kullanıcının girdiği/seçtiği serbest metin adres (UI gösterimi) — opsiyonel. */
  fullAddress?: string;
  /** Son kayıt zamanı (ms) — Ev/İş hızlı-kayıt akışında "kullanıcı gerçekten kaydetti mi"
   *  ayrımı için kullanılır (bkz. isValidDestination + NAVIGATION-P0-1). */
  updatedAt?: number;

  /* ── P0-NAV-09 · HEDEF KÜNYESİ (opsiyonel — mevcut çağıranlar bozulmaz) ────
   * Ölçülen boşluk: rota motoruna giden hedefin NEREDEN geldiği, NE ZAMAN
   * çözüldüğü ve KOORDİNATIN NE KADAR kesin olduğu üründe hiçbir yerde
   * taşınmıyordu → "aramada doğru yeri bulduk ama rotaya yanlış nokta mı
   * gitti" sorusu ölçülemiyordu.
   *
   * ⚠️ Hepsi OPSİYONELDİR ve BİLDİRİLMEDİĞİNDE hiçbir kural çalışmaz —
   * "bilinmiyor" ile "bayat/kesin değil" AYNI ŞEY DEĞİLDİR. Uydurma
   * varsayılan ATANMAZ. */
  /** Hedefi üreten sağlayıcı/katman etiketi (ör. `NOMINATIM`, `LOCAL_POI`). */
  provider?: string;
  /** Hedefin ÇÖZÜLDÜĞÜ an (ms) — bayat arama sonucu bu alanla yakalanır. */
  resolvedAtMs?: number;
  /** Koordinatın kesinliği; sağlayıcı söylemediyse alan KONULMAZ. */
  precision?: 'ROOFTOP' | 'STREET' | 'AREA' | 'UNKNOWN';
}

interface AddressBookState {
  addresses: Map<string, Address>;
  favorites: Set<string>;
  recentAddresses: Address[];
  isLoading: boolean;
  error: string | null;
}

const useAddressBookStore = create<AddressBookState>(() => ({
  addresses: new Map(),
  favorites: new Set(),
  recentAddresses: [],
  isLoading: false,
  error: null,
}));

const STORAGE_KEY = 'addressbook_data';

/**
 * Initialize address book (load from localStorage)
 */
export async function initializeAddressBook(): Promise<void> {
  try {
    useAddressBookStore.setState({ isLoading: true });

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved) as { addresses?: [string, Address][]; favorites?: string[] };
      const addresses = new Map<string, Address>(data.addresses || []);
      const favorites = new Set<string>(data.favorites || []);

      // Load recent addresses
      const recentAddresses = Array.from(addresses.values())
        .filter((a) => a.type === 'history')
        .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
        .slice(0, 50);

      useAddressBookStore.setState({
        addresses,
        favorites,
        recentAddresses,
        isLoading: false,
        error: null,
      });
    } else {
      // Initialize with defaults
      const defaults = [
        {
          id: 'home',
          name: 'Ev',
          latitude: 0,
          longitude: 0,
          type: 'favorite' as const,
          category: 'home' as const,
        },
        {
          id: 'work',
          name: 'İş',
          latitude: 0,
          longitude: 0,
          type: 'favorite' as const,
          category: 'work' as const,
        },
      ];

      const addresses = new Map(defaults.map((a) => [a.id, a]));
      useAddressBookStore.setState({
        addresses,
        isLoading: false,
        error: null,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load address book';
    useAddressBookStore.setState({ isLoading: false, error: msg });
  }
}

/**
 * Save address book to localStorage
 */
function saveAddressBook(): void {
  try {
    const { addresses, favorites } = useAddressBookStore.getState();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        addresses: Array.from(addresses.entries()),
        favorites: Array.from(favorites),
      })
    );
  } catch (err) {
    console.error('Failed to save address book:', err);
  }
}

/**
 * Add or update address
 */
export function setAddress(address: Address): void {
  const { addresses, favorites } = useAddressBookStore.getState();
  addresses.set(address.id, address);

  if (address.type === 'favorite') {
    favorites.add(address.id);
  }

  useAddressBookStore.setState({ addresses, favorites });
  saveAddressBook();
}

/**
 * Get address by ID
 */
export function getAddress(id: string): Address | null {
  const { addresses } = useAddressBookStore.getState();
  return addresses.get(id) || null;
}

/**
 * Get all favorite addresses
 */
export function getFavoriteAddresses(): Address[] {
  const { addresses, favorites } = useAddressBookStore.getState();
  return Array.from(favorites)
    .map((id) => addresses.get(id))
    .filter((a) => a !== undefined) as Address[];
}

/**
 * Get recent addresses (visited history)
 */
export function getRecentAddresses(limit = 5): Address[] {
  const { addresses } = useAddressBookStore.getState();
  return Array.from(addresses.values())
    .filter((a) => a.type === 'history')
    .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
    .slice(0, limit);
}

/**
 * Add to history / record visit
 */
export function recordVisit(
  name: string,
  latitude: number,
  longitude: number
): Address {
  const { addresses } = useAddressBookStore.getState();

  // Check if address already exists
  let existing = Array.from(addresses.values()).find(
    (a) => Math.abs(a.latitude - latitude) < 0.0001 && Math.abs(a.longitude - longitude) < 0.0001
  );

  if (existing && existing.type === 'history') {
    existing.lastVisited = Date.now();
    existing.visitCount = (existing.visitCount || 1) + 1;
  } else {
    const id = `visit_${Date.now()}`;
    existing = {
      id,
      name,
      latitude,
      longitude,
      type: 'history',
      lastVisited: Date.now(),
      visitCount: 1,
    };
    addresses.set(id, existing);
  }

  // Trim history to 50 most recent entries
  const historyEntries = Array.from(addresses.entries())
    .filter(([, a]) => a.type === 'history')
    .sort(([, a], [, b]) => (b.lastVisited || 0) - (a.lastVisited || 0));
  if (historyEntries.length > 50) {
    historyEntries.slice(50).forEach(([id]) => addresses.delete(id));
  }

  useAddressBookStore.setState({ addresses });
  saveAddressBook();

  return existing;
}

/**
 * Add favorite
 */
export function addFavorite(address: Address): void {
  address.type = 'favorite';
  setAddress(address);
}

/**
 * Remove favorite
 */
export function removeFavorite(id: string): void {
  const { addresses, favorites } = useAddressBookStore.getState();
  favorites.delete(id);
  const addr = addresses.get(id);
  if (addr) {
    addr.type = 'history';
  }
  useAddressBookStore.setState({ addresses, favorites });
  saveAddressBook();
}

/**
 * Search addresses by name
 */
export function searchAddresses(query: string): Address[] {
  const { addresses } = useAddressBookStore.getState();
  const q = query.toLowerCase();
  return Array.from(addresses.values()).filter(
    (a) => a.name.toLowerCase().includes(q)
  );
}

/**
 * Get address book state
 */
export function useAddressBook() {
  return useAddressBookStore();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ev / İş hızlı-hedef API'si (NAVIGATION-P0-1)
 *
 * Kök neden (NAVIGATION-AUDIT-1): initializeAddressBook() Ev/İş kayıtlarını
 * lat=0,lng=0 (Null Island) varsayılanıyla oluşturuyordu ve bu değerleri
 * OKUYUP navigasyona bağlayan hiçbir tüketici yoktu. Bu bölüm TEK guard'ı
 * (isValidDestination) ve TEK yazma/okuma/silme yüzeyini tanımlar — paralel
 * bir depolama YOK, mevcut addresses Map'i / setAddress / getAddress yeniden
 * kullanılır.
 * ══════════════════════════════════════════════════════════════════════════ */

export type QuickAddressCategory = 'home' | 'work';

/** Koordinat sıfıra çok yakınsa (Null Island) "kayıtlı değil" sayılır — float eşitliğine güvenme. */
const NULL_ISLAND_EPS = 1e-9;

/**
 * lat/lng sınır-içi mi ve (0,0) Null Island DEĞİL mi — geçerli bir navigasyon
 * hedefi için tek yetkili guard. 0,0 hiçbir zaman geçerli hedef sayılmaz
 * (initializeAddressBook varsayılanı da budur — kullanıcı henüz kaydetmemiş demektir).
 */
export function isValidDestination(
  point: { latitude: number; longitude: number } | null | undefined,
): boolean {
  if (!point) return false;
  const { latitude: lat, longitude: lng } = point;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < NULL_ISLAND_EPS && Math.abs(lng) < NULL_ISLAND_EPS) return false;
  return true;
}

export interface QuickAddressInput {
  latitude:    number;
  longitude:   number;
  /** Kullanıcıya gösterilecek serbest metin adres (arama sonucu veya "Mevcut konum"). */
  fullAddress?: string;
  /** Özel etiket — verilmezse kategoriye göre "Ev"/"İş" kullanılır. */
  name?: string;
}

/**
 * Ev/İş adresini kaydeder. Geçersiz koordinat (0,0 dahil) SESSİZCE REDDEDİLİR
 * (fail-closed) — hiçbir zaman yarı-yazılmış/bozuk kayıt oluşmaz.
 * @returns kayıt başarılıysa true, geçersiz girişte false.
 */
export function setQuickAddress(category: QuickAddressCategory, input: QuickAddressInput): boolean {
  if (!isValidDestination(input)) return false;
  const existing = getAddress(category);
  const address: Address = {
    id:          category,
    name:        input.name?.trim() || (category === 'home' ? 'Ev' : 'İş'),
    latitude:    input.latitude,
    longitude:   input.longitude,
    type:        'favorite',
    category,
    fullAddress: input.fullAddress?.trim() || undefined,
    updatedAt:   Date.now(),
    lastVisited: existing?.lastVisited,
    visitCount:  existing?.visitCount,
  };
  setAddress(address);
  return true;
}

/**
 * Kayıtlı VE geçerli Ev/İş adresini döner; kayıtlı değilse veya geçersizse null.
 * Navigasyon başlatma dâhil hiçbir tüketici bu guard'ı atlamamalı.
 */
export function getQuickAddress(category: QuickAddressCategory): Address | null {
  const addr = getAddress(category);
  return addr && isValidDestination(addr) ? addr : null;
}

/**
 * Ev/İş adresini siler — kayıt initializeAddressBook() varsayılanına (geçersiz
 * placeholder) döner, favorites/local storage tutarlılığı setAddress ile korunur.
 */
export function clearQuickAddress(category: QuickAddressCategory): void {
  setAddress({
    id:       category,
    name:     category === 'home' ? 'Ev' : 'İş',
    latitude: 0,
    longitude: 0,
    type:     'favorite',
    category,
  });
}
