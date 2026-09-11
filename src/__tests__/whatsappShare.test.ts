/**
 * whatsappShare.test.ts — telefon numarası → WhatsApp E.164-benzeri biçim,
 * deep-link URL üretimi ve "hazırla" akışının fail-closed davranışı.
 *
 * ÜRÜN KARARI (2026-09-11): WhatsApp'ın Gönder tuşuna otomatik BASILMAZ —
 * bu modül YALNIZ sohbeti hazır açar. `prepareWhatsAppMessage` ok:true
 * dönse BİLE bu "mesaj gitti" ANLAMINA GELMEZ; çağıran asla "gönderdim"
 * dememeli (bkz. useVoiceCommandHandler send_location_contact bloğu).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  resolveAppByName: vi.fn<(name: string) => { id: string; name: string } | null>(),
  launchApp: vi.fn<(opts: unknown) => Promise<void>>(),
}));

vi.mock('../platform/appRegistry', () => ({
  resolveAppByName: (n: string) => M.resolveAppByName(n),
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { launchApp: (o: unknown) => M.launchApp(o) },
}));

import {
  toWhatsAppPhoneDigits, buildWhatsAppSendUrl, prepareWhatsAppMessage,
} from '../platform/whatsappShare';

beforeEach(() => {
  M.resolveAppByName.mockReset();
  M.launchApp.mockReset();
});

describe('toWhatsAppPhoneDigits', () => {
  it('zaten uluslararası (+90...) numarayı olduğu gibi rakamlara çevirir', () => {
    expect(toWhatsAppPhoneDigits('+90 532 111 22 33')).toBe('905321112233');
  });

  it('yerel "0" trunk önekini ülke koduyla (90) değiştirir', () => {
    expect(toWhatsAppPhoneDigits('0532 111 22 33')).toBe('905321112233');
  });

  it('ayraçlı/parantezli biçimleri temizler (sanitizePhoneNumber ÖRNEĞİYLE tutarlı)', () => {
    // sanitizePhoneNumber('(0212) 444-55 66') → '02124445566' (kendi doc örneği)
    expect(toWhatsAppPhoneDigits('(0212) 444-55 66')).toBe('902124445566');
  });

  it('boş/geçersiz/çok kısa numarada null — sahte numara UYDURULMAZ', () => {
    expect(toWhatsAppPhoneDigits('')).toBeNull();
    expect(toWhatsAppPhoneDigits('123')).toBeNull();
    expect(toWhatsAppPhoneDigits('*123#')).toBeNull();
  });
});

describe('buildWhatsAppSendUrl', () => {
  it('WhatsApp click-to-chat şemasını üretir, metni URL-encode eder', () => {
    const url = buildWhatsAppSendUrl('905321112233', 'Ev\n36.900000, 34.800000');
    expect(url).toBe('whatsapp://send?phone=905321112233&text=Ev%0A36.900000%2C%2034.800000');
  });
});

describe('prepareWhatsAppMessage — fail-closed', () => {
  it('geçersiz numarada WhatsApp\'ı hiç DENEMEDEN invalid_phone döner', async () => {
    const r = await prepareWhatsAppMessage('123', 'metin');
    expect(r).toEqual({ ok: false, failure: 'invalid_phone' });
    expect(M.launchApp).not.toHaveBeenCalled();
  });

  it('WhatsApp kurulu değilse (uygulama indeksinde yok) not_installed döner, launchApp DENENMEZ', async () => {
    M.resolveAppByName.mockReturnValue(null);
    const r = await prepareWhatsAppMessage('+905321112233', 'metin');
    expect(r).toEqual({ ok: false, failure: 'not_installed' });
    expect(M.launchApp).not.toHaveBeenCalled();
  });

  it('native launchApp reddederse (ActivityNotFound vb.) launch_failed döner — sahte başarı YOK', async () => {
    M.resolveAppByName.mockReturnValue({ id: 'native-com.whatsapp', name: 'WhatsApp' });
    M.launchApp.mockRejectedValue(new Error('LAUNCH_FAILED'));
    const r = await prepareWhatsAppMessage('+905321112233', 'metin');
    expect(r).toEqual({ ok: false, failure: 'launch_failed' });
  });

  it('WhatsApp kurulu ve native launch başarılıysa ok:true — YALNIZ "sohbet açıldı" kanıtı, "gönderildi" DEĞİL', async () => {
    M.resolveAppByName.mockReturnValue({ id: 'native-com.whatsapp', name: 'WhatsApp' });
    M.launchApp.mockResolvedValue(undefined);
    const r = await prepareWhatsAppMessage('+905321112233', 'Ev\n36.9, 34.8');
    expect(r).toEqual({ ok: true });
    expect(M.launchApp).toHaveBeenCalledWith({
      action: 'android.intent.action.VIEW',
      data: expect.stringContaining('whatsapp://send?phone=905321112233&text='),
    });
  });
});
