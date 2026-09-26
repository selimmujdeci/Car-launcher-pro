/**
 * randomId — kayıt kimlikleri için TEK rastgele parça üreticisi.
 *
 * NEDEN (2026-09-25, CodeQL js/insecure-randomness): 12 ayrı yer kimliğini
 * `Math.random().toString(36)` ile üretiyordu. Bu kimlikler güvenlik değeri
 * DEĞİLDİR (bildirim, kuyruk girdisi, oturum etiketi…), ama `Math.random`
 * her yerde kullanıldıkça gerçekten güvenlik amaçlı bir değerin yanlışlıkla
 * aynı yoldan üretilmesi gözden kaçar. Tek yardımcı: kriptografik kaynak.
 *
 * YEDEK: `crypto.getRandomValues` yoksa (çok eski WebView) `Math.random`
 * KULLANILMAZ — kimliğin ihtiyacı tahmin edilemezlik değil BENZERSİZLİKTİR;
 * zaman + artan sayaç bunu sağlar. Güvenlik değeri (anahtar/PIN/eşleşme kodu)
 * için BU DOSYA KULLANILMAZ; onların kendi fail-closed üreticileri vardır.
 */

let _seq = 0;

/** `len` karakterlik [0-9a-v] parça (varsayılan 8). 32 tabanı 256'yı tam böler → yanlılık yok. */
export function randomToken(len = 8): string {
  try {
    const g = globalThis.crypto;
    if (g && typeof g.getRandomValues === 'function') {
      const b = g.getRandomValues(new Uint8Array(len));
      let out = '';
      for (let i = 0; i < len; i++) out += (b[i] & 31).toString(32);
      return out;
    }
  } catch { /* aşağıdaki benzersizlik yedeğine düş */ }
  _seq = (_seq + 1) % 1_679_616;   // 36^4
  return (Date.now().toString(36) + _seq.toString(36).padStart(4, '0')).slice(-len).padStart(len, '0');
}

/** UUID v4 — varsa yerleşik `randomUUID`, yoksa `getRandomValues` ile; en son benzersizlik yedeği. */
export function randomUuid(): string {
  try {
    const g = globalThis.crypto;
    if (g && typeof g.randomUUID === 'function') return g.randomUUID();
    if (g && typeof g.getRandomValues === 'function') {
      const b = g.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch { /* aşağıya düş */ }
  return `${Date.now().toString(36)}-${randomToken(12)}`;
}
