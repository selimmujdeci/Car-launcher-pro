import { CRITICAL_PIN_ENROLLED_KEY } from './commandService';
import { usePinDialogStore } from '@/store/pinDialogStore';

/**
 * Kritik komut öncesi PIN diyaloğu.
 *
 * MRI N-2/N-3 (083): PIN artık SUNUCUDA doğrulanır. Bu dosya eskiden
 * SHA-256(PIN)'i localStorage'da tutup yerelde karşılaştırıyor ve hash'i
 * sunucuya gönderiyordu — sunucuda PIN hiç kayıtlı değildi, karar telefondaydı.
 * Artık:
 *   · burada yalnız PIN SORULUR ve biçimi denetlenir; hash üretilmez, saklanmaz;
 *   · ham PIN `sendCommand({ pin })` → `verify_and_send_critical_command`a gider;
 *   · sunucuda PIN yoksa `commandService` onu `set_vehicle_pin` ile kaydeder.
 * localStorage'daki tek şey UX ipucudur ("belirleyin" mi "girin" mi) — güvenlik
 * otoritesi değildir; yanlışsa sunucu düzeltir (pin_not_set / Yanlış PIN).
 */

const LEGACY_PIN_HASH_KEY = 'caros_critical_pin_hash';

function hasEnrollmentHint(): boolean {
  try {
    if (localStorage.getItem(CRITICAL_PIN_ENROLLED_KEY)) return true;
    /* Eski PWA'nın yerel hash'i: kullanıcı bir PIN seçmişti. Hash artık
       anlamsız (sunucu bilmiyor) → sil; ipucu olarak "girin" göster; sunucu
       `pin_not_set` derse commandService girilen PIN'i kaydeder. */
    if (localStorage.getItem(LEGACY_PIN_HASH_KEY)) {
      localStorage.removeItem(LEGACY_PIN_HASH_KEY);
      return true;
    }
  } catch { /* storage yok */ }
  return false;
}

/**
 * PIN'i sorar; 4–8 rakamsa ham PIN'i döner, aksi hâlde null.
 * Doğrulama YAPMAZ — otorite sunucudur.
 */
export async function verifyCriticalCommand(): Promise<string | null> {
  const { show } = usePinDialogStore.getState();
  const pin = await show(hasEnrollmentHint()
    ? 'PIN girin'
    : 'Kritik komutlar için 4 haneli PIN belirleyin');
  if (!pin || !/^\d{4,8}$/.test(pin)) return null;
  return pin;
}
