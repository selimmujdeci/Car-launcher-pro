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
import { PhoneConnectionTab } from '../components/phone/PhoneConnectionTab';

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

  it('Mesajlar sekmesi — sahte mesaj göstermez, native erişim engelini dürüstçe açıklar', () => {
    const html = renderToStaticMarkup(<PhoneMessagesTab />);
    expect(html).toContain('kullanılamıyor');
    expect(html).not.toContain('Ahmet');
    expect(html).not.toContain('Ayşe');
  });

  it('Bağlantı sekmesi çökmeden render olur — ses profili ve Companion bölümleri var', () => {
    const html = renderToStaticMarkup(<PhoneConnectionTab />);
    expect(html).toContain('Ses Profili');
    expect(html).toContain('CarOS Companion');
  });
});
