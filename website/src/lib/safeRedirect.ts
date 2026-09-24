/**
 * safeRedirect — giriş akışının `next` parametresi için TEK açık-yönlendirme kapısı.
 *
 * Yalnız KENDİ kökümüze dönen göreli yol kabul edilir. Eski iki kopya
 * (`auth/callback/route.ts`, `auth/hash-callback/page.tsx`) `//evil.com`'u
 * reddediyor ama `/\evil.com`'u GEÇİRİYORDU — tarayıcılar ters eğik çizgiyi
 * düz çizgi sayar, istemci yönlendirmesi böylece dış siteye gidebilirdi
 * (CodeQL taraması sırasında bulundu, 2026-09-25).
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
  if (raw[0] !== '/') return fallback;                    // göreli kök yolu değil
  if (raw[1] === '/' || raw[1] === '\\') return fallback; // protokol-göreli (//, /\)
  if (raw.includes('\\')) return fallback;                // her yerde ters eğik çizgi
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback; // kontrol karakteri (\t \n ile kaçış)
  return raw;
}
