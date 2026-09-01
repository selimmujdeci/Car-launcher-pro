/**
 * formatManeuverDistance — P0-NAV-04 · manevra mesafesinin sürüş biçimi (SAF).
 *
 * Bileşen dosyasından AYRI tutulur: bir modül hem bileşen hem yardımcı
 * export ederse Vite fast-refresh o dosyayı yeniden yükleyemez (lint uyarısı).
 * Tanım `NavigationHUD.fmtTurn`ten TAŞINDI; eşikler ve yuvarlama BİREBİR aynı
 * (20 m altı "ŞİMDİ", 100 m altı 10'a, 1 km altı 50'ye yuvarlanır).
 */
export function formatManeuverDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m <  20)   return 'ŞİMDİ';
  if (m < 100)   return `${Math.round(m / 10) * 10} m`;
  if (m < 1000)  return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
