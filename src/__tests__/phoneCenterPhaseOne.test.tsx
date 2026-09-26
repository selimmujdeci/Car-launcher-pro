/**
 * phoneCenterPhaseOne.test.tsx — TELEFON MERKEZİ FAZ 1 · duman testi.
 *
 * Alt dock TELEFON düğmesinin açtığı `PhoneScreen`in dört bölümlü hâle
 * gelmesini ve eski rehber davranışının (arama kutusu, kişi satırları)
 * BİREBİR korunduğunu kilitler. Ağır DOM/etkileşim testi değildir —
 * `renderToStaticMarkup` ile "çökmeden render olur + beklenen gerçek metin
 * orada" düzeyinde bir duman testidir (bu dosyaların üzerindeki mevcut
 * `PhoneHubFieldValidationScreen` testleriyle aynı desen).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PhoneScreen } from '../components/phone/PhoneScreen';
import { PhoneContactsTab } from '../components/phone/PhoneContactsTab';
import { PhoneCallsTab } from '../components/phone/PhoneCallsTab';
import { PhoneMessagesTab } from '../components/phone/PhoneMessagesTab';
import { PhoneConnectionTab, describePhoneConnection } from '../components/phone/PhoneConnectionTab';

describe('Telefon Merkezi Faz 1 — duman testi', () => {
  it('PhoneScreen çökmeden render olur ve dört sekmeyi gösterir', () => {
    const html = renderToStaticMarkup(<PhoneScreen />);
    expect(html).toContain('Aramalar');
    expect(html).toContain('Kişiler');
    expect(html).toContain('Mesajlar');
    expect(html).toContain('Bağlantı');
  });

  it('varsayılan sekme Aramalar\'dır — numara çevirme ve son aramalar görünür', () => {
    const html = renderToStaticMarkup(<PhoneScreen />);
    expect(html).toContain('Numara Çevir');
    expect(html).toContain('Son Aramalar');
  });

  it('Kişiler sekmesi eski rehber davranışını korur (arama kutusu var)', () => {
    const html = renderToStaticMarkup(<PhoneContactsTab />);
    expect(html).toContain('Kişi ara veya numara gir');
  });

  it('Aramalar sekmesi çökmeden render olur', () => {
    const html = renderToStaticMarkup(<PhoneCallsTab />);
    expect(html).toContain('Numara Çevir');
  });

  it('Mesajlar sekmesi — sahte mesaj göstermez; ölçülmemiş erişimi "mesaj yok" diye sunmaz', () => {
    const html = renderToStaticMarkup(<PhoneMessagesTab />);
    expect(html).toContain('Bildirim erişimi');
    expect(html).not.toContain('Yeni mesaj yok');
    expect(html).not.toContain('Ahmet');
    expect(html).not.toContain('Ayşe');
  });

  it('Bağlantı sekmesi — Bluetooth telefonu + bildirim erişimi; Companion YOK (ürün kararı 2026-09-23)', () => {
    const html = renderToStaticMarkup(<PhoneConnectionTab />);
    expect(html).toContain('Telefon (Bluetooth)');
    expect(html).toContain('Arama ve Mesaj Bildirimleri');
    expect(html).not.toContain('Companion');
  });

  it('🔒 telefon bağlantısı: bilinmeyen/başka cihaz "bağlı" SAYILMAZ', () => {
    expect(describePhoneConnection(undefined).good).toBe(false);
    expect(describePhoneConnection(null).good).toBe(false);
    expect(describePhoneConnection({ state: 'ON', phones: [] }).good).toBe(false);
    expect(describePhoneConnection({ state: 'ON', phones: [{ name: 'S23' }] }).good).toBe(false);
    expect(describePhoneConnection({ state: 'ON', phones: [{ name: 'S23', connected: false }] }).good).toBe(false);
    expect(describePhoneConnection({ state: 'NO_PERMISSION' }).good).toBe(false);
    const ok = describePhoneConnection({ state: 'ON', phones: [{ name: 'S23', connected: true }] });
    expect(ok.good).toBe(true);
    expect(ok.title).toBe('Bağlı: S23');
  });
});
