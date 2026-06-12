/**
 * abortCompat — AbortSignal.timeout() WebView uyumluluk katmanı.
 *
 * SAHA HATASI (2026-06-12): `AbortSignal.timeout()` Chrome 103+ API'sidir.
 * Head unit WebView'ları (Duster K24: Chrome 64-78) bu metodu TANIMAZ —
 * çağrı anında TypeError fırlar, fetch AĞA HİÇ ÇIKAMADAN ölür. Sonuç:
 * cihazda Gemini/hava durumu/trafik/Overpass çağrılarının TAMAMI "anında
 * başarısız" oluyordu; asistan her cümlede offline tekrar-rica / "İnternet
 * yavaş" döngüsüne düşüyordu.
 *
 * Bu yardımcı her ortamda güvenlidir:
 *   - Chrome 103+  → native AbortSignal.timeout
 *   - Chrome 66-102 → AbortController + setTimeout fallback
 *   - Daha eski    → undefined (timeout'suz fetch — istek yine çalışır)
 *
 * KURAL: src/ altında ham `AbortSignal.timeout(...)` KULLANILMAZ — her zaman
 * bu modüldeki `signalWithTimeout(ms)` çağrılır (cssCompat.ts ile aynı felsefe).
 */
export function signalWithTimeout(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  } catch {
    return undefined; // çok eski WebView: AbortController da yok — timeout'suz devam
  }
}
