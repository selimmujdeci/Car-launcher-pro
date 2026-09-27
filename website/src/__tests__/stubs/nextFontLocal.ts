/**
 * Test stub'ı — `next/font/local` yalnız Next derleyicisinde çalışır; vitest'te
 * fonksiyon değildir. Tüketici route grubu (`(pwa)/layout.tsx`) Roboto Flex'i
 * yerel dosyadan yüklediği için layout'u import eden testler bu stub'la kurulur.
 * Görsel sonuç test edilmez; yalnız className/variable şekli sağlanır.
 */
const localFont = () => ({ className: '', variable: '', style: { fontFamily: 'sans-serif' } });
export default localFont;
