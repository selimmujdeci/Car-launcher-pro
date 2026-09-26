/**
 * SON ÇARE YEREL GÜVENLİK SIFIRLAMASI.
 *
 * ── ÖLÇÜLEN KUSUR (production, 2026-09-17) ───────────────────────────────
 * Bir temizlik `FAILED_BLOCKING` ile bittiğinde `evaluateCleanupBootGate`
 * `SECURITY_RESET_REQUIRED` döndürür. O durumda:
 *   · `retryRecovery()` hiçbir şey yapmaz (yalnız `CLEANUP_RECOVERY_REQUIRED`
 *     durumunda çalışır),
 *   · `caros-account-cleanup` işaret çerezi durduğu için auth yazımı kilitli
 *     kalır (24 saat),
 *   · ne tüketici yüzeyinde ne filo panelinde bir çıkış yolu vardı.
 * Kullanıcı kendi hesabına giremez hâle geliyordu — "çıkış yaptım, giriş
 * ekranını bile göremiyorum".
 *
 * ── NEDEN BU GÜVENLİ ─────────────────────────────────────────────────────
 * Kilidin amacı, YARIDA KALMIŞ bir temizlikten sonra eski hesabın yerel
 * verisinin yeni orurma sızmasını engellemektir. Bu sıfırlama o amacı
 * ZAYIFLATMAZ, en sert biçimde YERİNE GETİRİR: tüm yerel depo, oturum
 * deposu ve bu kaynağın çerezleri silinir. Yani "temizlik tamamlanamadı"
 * durumu, "her şey silindi" durumuna çevrilir.
 *
 * Sunucu tarafına DOKUNULMAZ: araç sahipliği, eşleştirmeler ve kayıtlar
 * kullanıcının hesabında kalır; yeniden girişte geri gelirler.
 * Bu bir çıkış/temizlik OTORİTESİ DEĞİLDİR — kanonik temizlik artık
 * çalışamaz durumdayken devreye giren tek yönlü bir kaçış kapısıdır.
 */

export type LocalSecurityResetOutcome = Readonly<{
  storageCleared: boolean;
  cookiesCleared: boolean;
}>;

/** Bu kaynağın görünür tüm çerezlerini süresi geçmiş olarak işaretler. */
function expireVisibleCookies(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const names = document.cookie
      .split(';')
      .map((part) => part.trim().split('=', 1)[0])
      .filter((name) => name.length > 0);
    for (const name of names) {
      /* Aynı ad farklı Path altında yazılmış olabilir; ikisi de denenir.
         `SameSite=Strict` ile yazılanlar da bu biçimle süresi geçer. */
      document.cookie = `${name}=; Path=/; SameSite=Strict; Max-Age=0`;
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
    return true;
  } catch {
    return false;
  }
}

function clearWebStorage(): boolean {
  let ok = true;
  try { window.localStorage.clear(); } catch { ok = false; }
  try { window.sessionStorage.clear(); } catch { ok = false; }
  return ok;
}

/**
 * Yerel durumu tamamen siler. Çağıran, ardından sayfayı YENİDEN YÜKLEMELİDİR:
 * bellekteki store'lar ve Supabase istemcisi ancak o zaman temiz kurulur.
 */
export function performLocalSecurityReset(): LocalSecurityResetOutcome {
  const storageCleared = clearWebStorage();
  const cookiesCleared = expireVisibleCookies();
  return Object.freeze({ storageCleared, cookiesCleared });
}
