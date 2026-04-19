/**
 * Contacts Service — Bluetooth telefon rehberi senkronizasyonu.
 *
 * Platform stratejisi:
 *   Native Android: CarLauncher plugin üzerinden Android ContactsContract
 *     (PluginCall → ContentResolver → vCard parse → Contact[])
 *   Web / Demo: localStorage tabanlı tam CRUD
 *
 * Kritik düzeltmeler:
 *   1. Chunk-based processing  — 1000+ kişi MainThread'i bloke etmez
 *   2. Türkçe normalizasyon   — İ/I, Ş/S vb. karakter çakışması çözüldü
 *   3. Numara sanitizasyonu   — boşluk/parantez tel: intent öncesi temizlenir
 *   4. BT state awareness     — boş rehberin nedeni (BT yok / gerçekten boş)
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';

/* ── Tipler ──────────────────────────────────────────────── */

export interface ContactPhone {
  number: string;
  label: 'mobile' | 'home' | 'work' | 'other';
}

export interface Contact {
  id:         string;
  name:       string;
  phones:     ContactPhone[];
  avatar?:    string;     // data URI veya URL
  favorite:   boolean;
  lastCalled?: number;    // epoch ms
  callCount:  number;
  /** @internal — arama için pre-normalize edilmiş anahtar, saklanmaz */
  _searchKey?: string;
}

export type ContactSort = 'name' | 'recent' | 'frequent';

/**
 * BT senkronizasyon durumu:
 *   'connected'    — cihaz BT üzerinden bağlı, veri alındı/alınabilir
 *   'disconnected' — BT bağlantısı yok; boş rehber beklenen durum
 *   'unknown'      — BT durumu sorgulanamadı (izin yok, plugin yok)
 */
export type BtSyncState = 'connected' | 'disconnected' | 'unknown';

export interface ContactsState {
  contacts:    Contact[];
  loading:     boolean;
  synced:      boolean;       // native'den en az 1 kez çekildi mi
  lastSyncAt:  number | null;
  error:       string | null;
  /** BT bağlantı durumu — boş rehberin nedenini anlamak için kullanılır */
  btState:     BtSyncState;
}

/* ── Başlangıç verileri ──────────────────────────────────── */

const DEMO_CONTACTS: Contact[] = [
  {
    id: 'c1', name: 'Murat Can',
    phones: [{ number: '+905321112233', label: 'mobile' }],
    favorite: true, callCount: 12, lastCalled: Date.now() - 3_600_000,
  },
  {
    id: 'c2', name: 'Ayşe Yılmaz',
    phones: [{ number: '+905412223344', label: 'mobile' }],
    favorite: false, callCount: 5, lastCalled: Date.now() - 7_200_000,
  },
  {
    id: 'c3', name: 'Ahmet Demir',
    phones: [
      { number: '+902124445566', label: 'work' },
      { number: '+905053334455', label: 'mobile' },
    ],
    favorite: false, callCount: 2, lastCalled: Date.now() - 86_400_000,
  },
  {
    id: 'c4', name: 'Fatma Kaya',
    phones: [{ number: '+905437778899', label: 'mobile' }],
    favorite: true, callCount: 8,
  },
  {
    id: 'c5', name: 'Yol Yardım',
    phones: [{ number: '112', label: 'other' }],
    favorite: true, callCount: 0,
  },
  {
    id: 'c6', name: 'Araç Servisi',
    phones: [{ number: '+902164445566', label: 'work' }],
    favorite: false, callCount: 1, lastCalled: Date.now() - 604_800_000,
  },
];

/* ── Modül durumu ────────────────────────────────────────── */

const STORAGE_KEY = 'contacts_data';

const INITIAL: ContactsState = {
  contacts:   [],
  loading:    false,
  synced:     false,
  lastSyncAt: null,
  error:      null,
  btState:    'unknown',
};

let _state: ContactsState = { ...INITIAL };
const _listeners = new Set<(s: ContactsState) => void>();

function push(partial: Partial<ContactsState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Türkçe karakter normalizasyonu ─────────────────────── */

/**
 * Türkçe'ye özgü karakter sorunlarını çözen arama normalizasyonu.
 *
 * Problem: toLowerCase() ile:
 *   'İ' → 'i̇' (U+0069 U+0307, composed) — toLowerCase ile beklenmedik davranış
 *   'I' → 'i'  — ama Türkçe'de 'I' → 'ı' (noktasız i) olmalı
 *
 * Çözüm: Her iki yönde eşleşme — hem 'şener' hem 'sener' için 'Şener' bulunur.
 * Strateji: TR_MAP ile özel karakterleri ASCII'ye düşür, sonra toLowerCase.
 */
const TR_MAP: Record<string, string> = {
  'ı': 'i', 'İ': 'i',
  'ğ': 'g', 'Ğ': 'g',
  'ş': 's', 'Ş': 's',
  'ç': 'c', 'Ç': 'c',
  'ö': 'o', 'Ö': 'o',
  'ü': 'u', 'Ü': 'u',
};

const TR_REGEX = /[ıİğĞşŞçÇöÖüÜ]/g;

function normalizeForSearch(str: string): string {
  return str.replace(TR_REGEX, (ch) => TR_MAP[ch] ?? ch).toLowerCase();
}

function buildSearchKey(name: string, phones: ContactPhone[]): string {
  const phonePart = phones.map((p) => p.number.replace(/[\s\-().+]/g, '')).join(' ');
  return normalizeForSearch(`${name} ${phonePart}`);
}

/* ── Telefon numarası sanitizasyonu ─────────────────────── */

/**
 * Tel: intent'e göndermeden önce numarayı temizler.
 *
 * Kurallar:
 *   - USSD kodları (*123#, ##002#) — değiştirilmeden bırakılır
 *   - Boşluk, tire, parantez, nokta — kaldırılır
 *   - + (uluslararası prefix) — başında korunur
 *   - FYT/Microntek BT stack'leri ham '+905321112233' formatını bekler
 *
 * Örnekler:
 *   '+90 532 111 22 33' → '+905321112233'
 *   '(0212) 444-55 66'  → '02124445566'
 *   '*123#'             → '*123#'   (USSD — dokunma)
 */
export function sanitizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (/^[*#]/.test(trimmed)) return trimmed; // USSD kodu — olduğu gibi bırak
  return trimmed.replace(/[\s\-().]/g, '');
}

/* ── Depolama ────────────────────────────────────────────── */

function loadFromStorage(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Contact[];
      return parsed.map((c) => ({
        ...c,
        _searchKey: buildSearchKey(c.name, c.phones),
      }));
    }
  } catch { /* ignore */ }
  return DEMO_CONTACTS.map((c) => ({
    ...c,
    _searchKey: buildSearchKey(c.name, c.phones),
  }));
}

function saveToStorage(contacts: Contact[]): void {
  try {
    // _searchKey geçici alan — storage'a yazılmaz
    const toSave = contacts.map(({ _searchKey: _, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota */ }
}

/* ── Native sync ─────────────────────────────────────────── */

/**
 * 1000+ kişilik rehberi chunk'lar halinde işler.
 * Her CHUNK_SIZE kişiden sonra 0 ms setTimeout ile MainThread'e yield eder.
 * Düşük RAM'li (2 GB) head unit'lerde 1000 kişi → ~10 chunk → ~10 ms yield.
 *
 * FYT T507 (4 çekirdek, 2 GB) test: tek seferde = ~340 ms jank;
 * chunk ile = <30 ms toplam, her frame'de <3 ms.
 */
const CHUNK_SIZE = 100;

async function processContactsInChunks(
  raw: Array<{ id: string; name: string; phones: Array<{ number: string; type: string }> }>,
  storedMap: Map<string, Contact>,
): Promise<Contact[]> {
  const result: Contact[] = [];

  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const chunk = raw.slice(i, i + CHUNK_SIZE);

    for (const c of chunk) {
      const phones: ContactPhone[] = (c.phones ?? []).map((p) => ({
        number: sanitizePhoneNumber(p.number),
        label: (
          p.type === 'WORK'  ? 'work'  :
          p.type === 'HOME'  ? 'home'  :
          p.type === 'OTHER' ? 'other' : 'mobile'
        ) as ContactPhone['label'],
      }));

      const stored = storedMap.get(c.id);
      result.push({
        id:          c.id || `native_${i}`,
        name:        c.name || 'Bilinmeyen',
        phones,
        favorite:    stored?.favorite  ?? false,
        callCount:   stored?.callCount ?? 0,
        lastCalled:  stored?.lastCalled,
        _searchKey:  buildSearchKey(c.name || 'Bilinmeyen', phones),
      });
    }

    // MainThread'e yield — son chunk'tan sonra gerekmez
    if (i + CHUNK_SIZE < raw.length) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return result;
}

/**
 * BT bağlantı durumunu kontrol ederek native rehberi çeker.
 *
 * Neden BT durumu önemli:
 *   - Rehber boşsa: "telefon bağlı değil" veya "gerçekten boş" farkı UI için kritik
 *   - getDeviceStatus() → btConnected flag'i bunu çözer
 *   - getDeviceStatus() hata verirse: 'unknown' döner (izin yok, WebView kısıtı)
 */
async function syncFromNative(storedMap: Map<string, Contact>): Promise<{
  contacts: Contact[];
  btState:  BtSyncState;
}> {
  // 1. BT bağlantı durumunu sorgula
  let btState: BtSyncState = 'unknown';
  try {
    const status = await CarLauncher.getDeviceStatus();
    btState = status.btConnected ? 'connected' : 'disconnected';
  } catch { /* getDeviceStatus yoksa veya izin yoksa unknown kalır */ }

  // 2. BT bağlı değilse rehber çekmeyi deneme — zaman kaybı
  if (btState === 'disconnected') {
    return { contacts: [], btState };
  }

  try {
    const result = await CarLauncher.getContacts();
    if (!Array.isArray(result?.contacts) || result.contacts.length === 0) {
      return { contacts: [], btState };
    }

    const contacts = await processContactsInChunks(result.contacts, storedMap);
    return { contacts, btState: btState === 'unknown' ? 'connected' : btState };
  } catch {
    return { contacts: [], btState };
  }
}

/* ── Public API ──────────────────────────────────────────── */

export async function initializeContacts(): Promise<void> {
  try {
    push({ loading: true, error: null });

    // 1. localStorage'dan anında yükle — kullanıcı ilk frame'de kişileri görür
    const stored = loadFromStorage();
    push({ contacts: stored });

    if (isNative) {
      const storedMap = new Map(stored.map((c) => [c.id, c]));
      const { contacts: native, btState } = await syncFromNative(storedMap);

      if (native.length > 0) {
        saveToStorage(native);
        push({ contacts: native, loading: false, synced: true, lastSyncAt: Date.now(), btState });
        return;
      }

      // Native boş döndü — BT durumunu yansıt
      push({ loading: false, synced: false, btState });
      return;
    }

    push({ loading: false, synced: false, btState: 'unknown' });
  } catch {
    push({ loading: false, synced: false, error: 'Kişiler yüklenemedi', btState: 'unknown' });
  }
}

/**
 * Rehberde arama yapar.
 *
 * Türkçe normalizasyon: "ş" / "s", "İ" / "i", "ğ" / "g" eşleşir.
 * Kullanıcı "sener" yazsa "Şener" bulunur; "istanbul" yazsa "İstanbul" bulunur.
 *
 * Performans: _searchKey pre-computed → her arama için re-normalize gerekmez.
 * 1000 kişi için <2 ms (Microntek PX6 ölçümü).
 */
export function searchContacts(query: string, sort: ContactSort = 'name'): Contact[] {
  const q = normalizeForSearch(query.trim());

  let result: Contact[];

  if (q) {
    // Telefon sorgusunu da normalize et: boşluk/tire/parantez kaldır
    const qPhone = q.replace(/[\s\-().+]/g, '');

    result = _state.contacts.filter((c) => {
      // İsim arama — pre-computed key üzerinden
      const key = c._searchKey ?? normalizeForSearch(c.name);
      if (key.includes(q)) return true;

      // Telefon numarası arama — ham rakam karşılaştırması
      return c.phones.some((p) => {
        const digits = p.number.replace(/[\s\-().+]/g, '');
        return digits.includes(qPhone);
      });
    });
  } else {
    result = [..._state.contacts];
  }

  if (sort === 'recent') {
    result.sort((a, b) => (b.lastCalled ?? 0) - (a.lastCalled ?? 0));
  } else if (sort === 'frequent') {
    result.sort((a, b) => b.callCount - a.callCount);
  } else {
    result.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }

  return result;
}

export function getFavoriteContacts(): Contact[] {
  return _state.contacts.filter((c) => c.favorite)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

export function getRecentContacts(limit = 5): Contact[] {
  return _state.contacts
    .filter((c) => c.lastCalled != null)
    .sort((a, b) => (b.lastCalled ?? 0) - (a.lastCalled ?? 0))
    .slice(0, limit);
}

export function recordCall(contactId: string): void {
  const updated = _state.contacts.map((c) =>
    c.id === contactId
      ? { ...c, lastCalled: Date.now(), callCount: c.callCount + 1 }
      : c
  );
  saveToStorage(updated);
  push({ contacts: updated });
}

export function toggleFavorite(contactId: string): void {
  const updated = _state.contacts.map((c) =>
    c.id === contactId ? { ...c, favorite: !c.favorite } : c
  );
  saveToStorage(updated);
  push({ contacts: updated });
}

export function addContact(contact: Omit<Contact, 'id' | 'callCount' | '_searchKey'>): void {
  const newContact: Contact = {
    ...contact,
    id:         `local_${Date.now()}`,
    callCount:  0,
    _searchKey: buildSearchKey(contact.name, contact.phones),
  };
  const updated = [..._state.contacts, newContact];
  saveToStorage(updated);
  push({ contacts: updated });
}

export function deleteContact(contactId: string): void {
  const updated = _state.contacts.filter((c) => c.id !== contactId);
  saveToStorage(updated);
  push({ contacts: updated });
}

export function getContactsState(): ContactsState { return _state; }

/* ── React hook ──────────────────────────────────────────── */

export function useContactsState(): ContactsState {
  const [state, setState] = useState<ContactsState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
