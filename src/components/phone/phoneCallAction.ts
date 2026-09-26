/**
 * phoneCallAction — Telefon Merkezi'nin TEK arama tetikleme yolu.
 *
 * Native `android.intent.action.CALL` ile doğrudan arar; başarısız olursa
 * `DIAL` ile arayıcıyı açar (otomatik aramaz, kullanıcı elle onaylar).
 * Web/demo modda `tel:` intent'i tarayıcıya bırakılır.
 *
 * `contactId` verilirse ve arama GERÇEKTEN native'e iletildiyse
 * `recordCall()` çağrılır — "Son Aramalar" bu uygulamadan yapılan gerçek
 * aramalarla beslenir (sahte/varsayımsal kayıt YOK). Sistem çapında bir
 * arama geçmişi (CallLog) okuma erişimi bu derlemede YOKTUR — bu yüzden
 * yalnızca bu ekrandan başlatılan aramalar izlenebilir.
 */
import { isNative } from '../../platform/bridge';
import { CarLauncher } from '../../platform/nativePlugin';
import { recordCall, sanitizePhoneNumber } from '../../platform/contactsService';

export function callNumber(number: string, contactId?: string): void {
  const clean = sanitizePhoneNumber(number);
  if (isNative) {
    CarLauncher.launchApp({
      action: 'android.intent.action.CALL',
      data:   `tel:${clean}`,
    }).then(() => {
      if (contactId) recordCall(contactId);
    }).catch(() => {
      // Fallback: view (dialer açılır ama otomatik aramaz) — bu durumda
      // aramanın GERÇEKTEN başladığı kanıtlanamadığı için kayıt YAZILMAZ.
      CarLauncher.launchApp({ action: 'android.intent.action.DIAL', data: `tel:${clean}` }).catch(() => undefined);
    });
  } else {
    window.open(`tel:${clean}`, '_self');
    if (contactId) recordCall(contactId);
  }
}
