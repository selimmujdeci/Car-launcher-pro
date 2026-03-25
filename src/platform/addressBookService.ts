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
        .slice(0, 5);

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
