/**
 * offlinePairing.ts — ÇEVRİMDIŞI EŞLEŞTİRME (dürüst, fail-closed).
 *
 * ANAYASA: çevrimdışı eşleştirme GERÇEK SAHİPLİK ÜRETMEZ. Yalnız sunucuda
 * doğrulanmayı bekleyen bir **claim** üretir. Kullanıcıya "araç eşleşti"
 * DENMEZ — durum `PENDING_SERVER_VERIFICATION`'dır.
 */

import type { ConflictCode } from './types';

export type PendingPairingStatus =
  | 'PENDING_SERVER_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export interface PendingPairing {
  id:              string;
  userId:          string;
  /** Kod ŞİFRELİ saklanır; bu alan yalnız çözüldükten sonra doldurulur. */
  code:            string;
  requestedAt:     number;
  /** Araçtan okunan kodun kendi TTL'i (biliniyorsa). */
  codeExpiresAt:   number;
  idempotencyKey:  string;
  status:          PendingPairingStatus;
  conflictCode:    ConflictCode | null;
  attemptCount:    number;
}

/** Kod TTL'i bilinmiyorsa varsayılan: 60 sn (araç kodu ile aynı sözleşme). */
export const DEFAULT_CODE_TTL_MS = 60_000;

/** Sunucuya gönderilebilir mi — TTL geçmişse ASLA gönderilmez. */
export function isSendable(pairing: PendingPairing, now: number): boolean {
  if (pairing.status !== 'PENDING_SERVER_VERIFICATION') return false;
  if (pairing.codeExpiresAt <= now) return false;
  return true;
}

/** TTL geçmiş claim'leri EXPIRED yapar (dürüstlük: sessizce silinmez). */
export function expireOverdue(list: readonly PendingPairing[], now: number): PendingPairing[] {
  return list.map((p) =>
    p.status === 'PENDING_SERVER_VERIFICATION' && p.codeExpiresAt <= now
      ? { ...p, status: 'EXPIRED' as const }
      : p,
  );
}

/** Kullanıcıya gösterilecek dürüst durum metni. */
export function statusLabel(status: PendingPairingStatus): string {
  switch (status) {
    case 'PENDING_SERVER_VERIFICATION': return 'Sunucu doğrulaması bekleniyor';
    case 'VERIFIED':                    return 'Doğrulandı';
    case 'REJECTED':                    return 'Reddedildi';
    case 'EXPIRED':                     return 'Süresi doldu';
  }
}

/* ── Şifreli yerel saklama ─────────────────────────────────────────────── */

/**
 * Şifreleme arayüzü — enjekte edilebilir (test edilebilirlik).
 *
 * ⚠️ TEHDİT MODELİ (dürüst): `localStorage` güvenli bir kasa DEĞİLDİR. Bu
 * katman eşleştirme kodunun DÜZ METİN olarak diskte durmasını engeller;
 * cihazı ele geçiren bir saldırgana karşı tam koruma İDDİA ETMEZ.
 */
export interface SecureCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string | null>;
}

const PBKDF2_SALT  = 'caros-fleet-pairing-v1';
const PBKDF2_ITERS = 100_000;

function toB64(buf: Uint8Array): string {
  return btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(''));
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  // ArrayBuffer'ı açıkça ayır: WebCrypto `BufferSource` SharedArrayBuffer kabul etmez.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebCrypto AES-256-GCM şifreleyici. Kullanıcı kimliğinden anahtar türetir. */
export class WebCryptoCipher implements SecureCipher {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly passphrase: string) {}

  private key(): Promise<CryptoKey> {
    if (this.keyPromise) return this.keyPromise;
    this.keyPromise = (async () => {
      const enc = new TextEncoder();
      const raw = await crypto.subtle.importKey(
        'raw', enc.encode(this.passphrase), { name: 'PBKDF2' }, false, ['deriveKey'],
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
        raw,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    return this.keyPromise;
  }

  async encrypt(plain: string): Promise<string> {
    const key    = await this.key();
    const iv     = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain),
    );
    return `${toB64(iv)}.${toB64(new Uint8Array(cipher))}`;
  }

  async decrypt(value: string): Promise<string | null> {
    try {
      const [ivPart, dataPart] = value.split('.');
      if (!ivPart || !dataPart) return null;
      const key   = await this.key();
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(ivPart) }, key, fromB64(dataPart),
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null; // bozuk/başka anahtarla şifrelenmiş → fail-closed
    }
  }
}

/* ── Kalıcı depo ───────────────────────────────────────────────────────── */

const KEY_PREFIX = 'caros.fleet.pairing.';

interface StoredPairing extends Omit<PendingPairing, 'code'> {
  encryptedCode: string;
}

export class PendingPairingStore {
  constructor(
    private readonly userId: string,
    private readonly cipher: SecureCipher,
  ) {}

  private get storageKey(): string {
    return `${KEY_PREFIX}${this.userId}`;
  }

  private readRaw(): StoredPairing[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as StoredPairing[]) : [];
    } catch {
      return []; // bozuk depo → fail-soft
    }
  }

  private writeRaw(list: readonly StoredPairing[]): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(list));
    } catch {
      /* fail-soft */
    }
  }

  /**
   * Yeni bekleyen claim ekler. Aynı `idempotencyKey` varsa TEKRAR EKLENMEZ
   * (aynı pairing isteği iki kez gönderilmez).
   */
  async add(pairing: PendingPairing): Promise<void> {
    const list = this.readRaw();
    if (list.some((p) => p.idempotencyKey === pairing.idempotencyKey)) return;
    const { code, ...rest } = pairing;
    list.push({ ...rest, encryptedCode: await this.cipher.encrypt(code) });
    this.writeRaw(list);
  }

  /** Tüm claim'ler (kod çözülmüş). Çözülemeyen kayıt ATLANIR (fail-closed). */
  async list(): Promise<PendingPairing[]> {
    const out: PendingPairing[] = [];
    for (const stored of this.readRaw()) {
      const { encryptedCode, ...rest } = stored;
      const code = await this.cipher.decrypt(encryptedCode);
      if (code === null) continue;
      out.push({ ...rest, code });
    }
    return out;
  }

  async update(id: string, patch: Partial<Omit<PendingPairing, 'id' | 'code'>>): Promise<void> {
    const list = this.readRaw().map((p) => (p.id === id ? { ...p, ...patch } : p));
    this.writeRaw(list);
  }

  /**
   * Duruma göre ADET — kodu ÇÖZMEDEN okur.
   *
   * CAROS LAB bu yolu kullanır: gözlem paneli hassas materyale (eşleştirme kodu)
   * ASLA dokunmaz, yalnız VAR/YOK ve ADET görür (CLAUDE.md §Gözlemlenebilirlik-6).
   */
  statusCounts(): Record<PendingPairingStatus, number> {
    const out: Record<PendingPairingStatus, number> = {
      PENDING_SERVER_VERIFICATION: 0, VERIFIED: 0, REJECTED: 0, EXPIRED: 0,
    };
    for (const stored of this.readRaw()) {
      if (stored.status in out) out[stored.status] += 1;
    }
    return out;
  }

  async remove(id: string): Promise<void> {
    this.writeRaw(this.readRaw().filter((p) => p.id !== id));
  }

  /** Çıkış / hesap değişimi. */
  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      /* fail-soft */
    }
  }
}

/** Tüm kullanıcıların bekleyen pairing kayıtlarını siler (logout). */
export function clearAllPendingPairings(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* fail-soft */
  }
}
