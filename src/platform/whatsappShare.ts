/**
 * whatsappShare.ts — WhatsApp'ta belirli bir kişinin sohbetini, konum mesajı
 * DOLU halde açan TEK otorite.
 *
 * ── RESMÎ SINIR (kanıtlanmış, CLAUDE.md §8 EVIDENCE/UNKNOWN) ────────────────
 * WhatsApp, üçüncü taraf bir uygulamanın kullanıcı adına Gönder tuşuna
 * basmasına hiçbir genel/resmî Android mekanizmasıyla izin VERMEZ (Meta'nın
 * bilinçli anti-spam/rıza tasarımı — araştırıldı, doğrulandı). Bu modül
 * SADECE sohbeti hazırlar: WhatsApp'ı doğru kişinin sohbetinde, metin dolu
 * açar. Mesajın FİİLEN gitmesi kullanıcının kendi dokunuşuna bağlıdır.
 * Gerçek gönderim SONUCU doğrulanamaz — çağıran (`useVoiceCommandHandler`)
 * bu yüzden ASLA "gönderdim" DEMEMELİDİR, yalnız "hazırladım".
 *
 * ── OTORİTE AYRIMI (CLAUDE.md §6 TEK OTORİTE) ────────────────────────────────
 *  · Konum METNİ: `savedLocationsService.buildLocationShareText` (tek
 *    otorite, paralel biçim KURULMADI).
 *  · Kişi/numara: `contactsService` (tek otorite) — `sanitizePhoneNumber`
 *    TEMEL alınır; burada yalnız WhatsApp'ın "ülke kodu + rakam, ayraç/+
 *    YOK" biçimi için ZORUNLU minimal ek dönüşüm var, YENİ bağımsız bir
 *    numara-normalizasyon SİSTEMİ kurulmadı.
 *  · Uygulama kurulu mu: `appRegistry.resolveAppByName` (mevcut native
 *    uygulama indeksi — YENİ bir "yüklü mü" kanalı KURULMADI).
 *  · Fiilî açma: `nativePlugin.CarLauncher.launchApp` (mevcut genel intent
 *    köprüsü — YENİ bir Capacitor eklentisi GETİRİLMEDİ).
 */

import { resolveAppByName } from './appRegistry';
import { sanitizePhoneNumber } from './contactsService';
import { CarLauncher } from './nativePlugin';

/**
 * Varsayılan ülke kodu — YALNIZ numara zaten uluslararası biçimde DEĞİLSE
 * (baştaki yerel "0" trunk öneki yerine) eklenir. Genel bir ülke-kodu
 * tablosu KURULMAZ; mevcut demo veriler/rehber verisi Türkiye pazarını
 * yansıtıyor (`contactsService.ts` DEMO_CONTACTS `+90` ile kayıtlı).
 */
const DEFAULT_COUNTRY_CODE = '90';

export type WhatsAppPrepareFailure = 'not_installed' | 'invalid_phone' | 'launch_failed';

export interface WhatsAppPrepareResult {
  readonly ok: boolean;
  readonly failure?: WhatsAppPrepareFailure;
}

/**
 * `sanitizePhoneNumber` çıktısını WhatsApp'ın beklediği "ülke kodu + rakamlar,
 * ayraç/artı YOK" biçimine getirir. Zaten uzun görünen (10-15 hane) bir
 * numaraya dokunulmaz. Yalnız yerel trunk "0" ile başlayan 11 haneli TR
 * numaraları (ör. "05321112233") için baştaki "0" ülke koduyla değiştirilir.
 * Kısa/boş/tanınmayan biçimde `null` — sahte numara UYDURULMAZ (fail-closed).
 */
export function toWhatsAppPhoneDigits(rawNumber: string): string | null {
  const sanitized = sanitizePhoneNumber(rawNumber);
  const digits = sanitized.replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 11) {
    return DEFAULT_COUNTRY_CODE + digits.slice(1);
  }
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/** WhatsApp'ın belgelenmiş "click-to-chat" özel şeması — yalnız WhatsApp'ın
 * kendisi bu şemayı ("whatsapp://") kayıtlıdır, tarayıcıyla ÇAKIŞMAZ. */
export function buildWhatsAppSendUrl(phoneDigits: string, text: string): string {
  return `whatsapp://send?phone=${phoneDigits}&text=${encodeURIComponent(text)}`;
}

/**
 * WhatsApp'ı belirli bir numaranın sohbetinde, mesaj DOLU şekilde açar.
 * Gönder tuşuna BASMAZ (yalnız hazırlar) — WhatsApp'ın resmî sınırı budur.
 * `ok:true` "sohbet açıldı" demektir, "mesaj gitti" DEĞİL.
 */
export async function prepareWhatsAppMessage(
  phoneRaw: string, text: string,
): Promise<WhatsAppPrepareResult> {
  const digits = toWhatsAppPhoneDigits(phoneRaw);
  if (!digits) return { ok: false, failure: 'invalid_phone' };

  // Erken, dürüst kontrol: mevcut native uygulama indeksinde WhatsApp yoksa
  // hiç denemeden net mesaj verilir (native launchApp'in atma/reddetme
  // döngüsünü BEKLEMEYE gerek yok — indeks zaten native taramadan gelir).
  if (!resolveAppByName('whatsapp')) {
    return { ok: false, failure: 'not_installed' };
  }

  const url = buildWhatsAppSendUrl(digits, text);
  try {
    await CarLauncher.launchApp({ action: 'android.intent.action.VIEW', data: url });
    return { ok: true };
  } catch {
    // Uygulama indeksi bayat olabilir (native tarama henüz güncellenmemiş) —
    // gerçek `startActivity` başarısızlığı NİHAİ, dürüst kanıttır.
    return { ok: false, failure: 'launch_failed' };
  }
}
