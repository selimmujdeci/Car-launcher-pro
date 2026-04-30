import { hashPin } from './commandService';
import { usePinDialogStore } from '@/store/pinDialogStore';

const PIN_HASH_KEY = 'caros_critical_pin_hash';

/** Saklanan PIN hash'ini getirir. */
function getStoredPinHash(): string | null {
  try { return localStorage.getItem(PIN_HASH_KEY); } catch { return null; }
}

/** PIN hash'ini saklar. */
async function storePinHash(pin: string): Promise<void> {
  const h = await hashPin(pin);
  try { localStorage.setItem(PIN_HASH_KEY, h); } catch { /* quota */ }
}

/**
 * Kritik komut öncesi PIN doğrulaması.
 * - İlk kullanımda PIN belirlettir.
 * - Sonraki kullanımlarda PIN sor, hash'i karşılaştır.
 * - Doğruysa pinHash döner (sendCommand'a iletilecek), yanlışsa null.
 */
export async function verifyCriticalCommand(): Promise<string | null> {
  const { show } = usePinDialogStore.getState();
  const stored = getStoredPinHash();

  // İlk kullanım: PIN belirle
  if (!stored) {
    const pin = await show('Kritik komutlar için 4 haneli PIN belirleyin');
    if (!pin || !/^\d{4}$/.test(pin)) return null;
    await storePinHash(pin);
    return hashPin(pin);
  }

  // Sonraki kullanım: PIN doğrula
  const pin = await show('PIN girin');
  if (!pin) return null;
  const entered = await hashPin(pin);
  if (entered !== stored) return null;
  return entered;
}
