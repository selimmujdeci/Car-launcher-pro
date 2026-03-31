/**
 * Contacts Service — Bluetooth telefon rehberi senkronizasyonu.
 *
 * Platform stratejisi:
 *   Native Android: CarLauncher plugin üzerinden Android ContactsContract
 *     (PluginCall → ContentResolver → vCard parse → Contact[])
 *     Şu an plugin desteklerse kullanılır, desteklemezse localStorage'a düşer.
 *   Web / Demo: localStorage tabanlı tam CRUD
 *
 * Veri modeli:
 *   Contact { id, name, phones[], avatar?, favorite, lastCalled? }
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
}

export type ContactSort = 'name' | 'recent' | 'frequent';

export interface ContactsState {
  contacts:    Contact[];
  loading:     boolean;
  synced:      boolean;       // native'den en az 1 kez çekildi mi
  lastSyncAt:  number | null;
  error:       string | null;
}

/* ── Başlangıç verileri ──────────────────────────────────── */

const DEMO_CONTACTS: Contact[] = [
  {
    id: 'c1', name: 'Murat Can',
    phones: [{ number: '+90 532 111 22 33', label: 'mobile' }],
    favorite: true, callCount: 12, lastCalled: Date.now() - 3_600_000,
  },
  {
    id: 'c2', name: 'Ayşe Yılmaz',
    phones: [{ number: '+90 541 222 33 44', label: 'mobile' }],
    favorite: false, callCount: 5, lastCalled: Date.now() - 7_200_000,
  },
  {
    id: 'c3', name: 'Ahmet Demir',
    phones: [
      { number: '+90 212 444 55 66', label: 'work' },
      { number: '+90 505 333 44 55', label: 'mobile' },
    ],
    favorite: false, callCount: 2, lastCalled: Date.now() - 86_400_000,
  },
  {
    id: 'c4', name: 'Fatma Kaya',
    phones: [{ number: '+90 543 777 88 99', label: 'mobile' }],
    favorite: true, callCount: 8,
  },
  {
    id: 'c5', name: 'Yol Yardım',
    phones: [{ number: '112', label: 'other' }],
    favorite: true, callCount: 0,
  },
  {
    id: 'c6', name: 'Araç Servisi',
    phones: [{ number: '+90 216 444 55 66', label: 'work' }],
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
};

let _state: ContactsState = { ...INITIAL };
const _listeners = new Set<(s: ContactsState) => void>();

function push(partial: Partial<ContactsState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Depolama ────────────────────────────────────────────── */

function loadFromStorage(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Contact[];
  } catch { /* ignore */ }
  return DEMO_CONTACTS;
}

function saveToStorage(contacts: Contact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch { /* ignore */ }
}

/* ── Native sync ─────────────────────────────────────────── */

async function syncFromNative(): Promise<Contact[]> {
  try {
    const result = await CarLauncher.getContacts();
    if (!Array.isArray(result?.contacts)) return [];

    return result.contacts.map((c, i) => ({
      id:       c.id || `native_${i}`,
      name:     c.name || 'Bilinmeyen',
      phones:   (c.phones ?? []).map((p) => ({
        number: p.number,
        label:  (
          p.type === 'WORK'  ? 'work'  :
          p.type === 'HOME'  ? 'home'  :
          p.type === 'OTHER' ? 'other' : 'mobile'
        ) as ContactPhone['label'],
      })),
      favorite:  false,
      callCount: 0,
    }));
  } catch {
    return [];
  }
}

/* ── Public API ──────────────────────────────────────────── */

export async function initializeContacts(): Promise<void> {
  try {
    push({ loading: true, error: null });

    // Önce localStorage'dan yükle (anında görünür)
    const stored = loadFromStorage();
    push({ contacts: stored });

    if (isNative) {
      const native = await syncFromNative();
      if (native.length > 0) {
        // Native kişileri stored ile birleştir (favorites/callCount koru)
        const storedMap = new Map(stored.map((c) => [c.id, c]));
        const merged: Contact[] = native.map((nc) => ({
          ...nc,
          favorite:   storedMap.get(nc.id)?.favorite  ?? nc.favorite,
          callCount:  storedMap.get(nc.id)?.callCount ?? nc.callCount,
          lastCalled: storedMap.get(nc.id)?.lastCalled,
        }));
        saveToStorage(merged);
        push({ contacts: merged, loading: false, synced: true, lastSyncAt: Date.now() });
        return;
      }
    }

    push({ loading: false, synced: false });
  } catch {
    // loadFromStorage / syncFromNative failure — degrade to empty contacts, never crash
    push({ loading: false, synced: false, error: 'Kişiler yüklenemedi' });
  }
}

export function searchContacts(query: string, sort: ContactSort = 'name'): Contact[] {
  const q = query.trim().toLowerCase();
  let result = q
    ? _state.contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phones.some((p) => p.number.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
      )
    : [..._state.contacts];

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

export function addContact(contact: Omit<Contact, 'id' | 'callCount'>): void {
  const newContact: Contact = {
    ...contact,
    id:        `local_${Date.now()}`,
    callCount: 0,
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
