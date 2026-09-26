/**
 * appControlCommands — uygulama kontrolü için KESİN kurallı sesli komutlar (SAF).
 *
 * ÖLÇÜLDÜ 2026-09-26 (genel ayrıştırıcı): "30 saniye ileri sar" → music_next@1
 * (şarkı DEĞİŞTİRİYORDU) · "tesla temasına geç" / "sürücü değiştir" →
 * music_next · "karıştırmayı aç" → show_weather · "şarkıyı tekrarla" →
 * open_music · sürücü değiştirme komutu hiç YOKTU.
 *
 * Kurallar DAR ve tam-cümle tabanlıdır: eşleşmeyen her metin `null` döner ve
 * normal akışına (parser/beyin) gider. I/O yok, durum yok.
 */

export type CoreThemeName = 'expedition' | 'horizon' | 'tesla' | 'pro';

export type AppControl =
  | { readonly op: 'shuffle'; readonly on: boolean }
  | { readonly op: 'repeat'; readonly mode: 'off' | 'one' | 'all' }
  | { readonly op: 'seek'; readonly deltaSec: number }
  | { readonly op: 'restart' }
  | { readonly op: 'theme'; readonly theme: CoreThemeName }
  | { readonly op: 'driver'; readonly name: string | null };

function norm(s: string): string {
  return s.toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[.,!?;:'"’()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:mavi\s+)?(?:lutfen\s+)?/, '')
    .replace(/\s+lutfen$/, '');
}

const NUM: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, onbes: 15, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, doksan: 90,
};

function amount(tok: string | undefined): number | null {
  if (!tok) return null;
  if (/^\d{1,3}$/.test(tok)) return Number(tok);
  return NUM[tok] ?? null;
}

const OFF = /(?:kapat|durdur|iptal|kaldir|birak)$/;

export function parseAppControl(raw: string): AppControl | null {
  if (typeof raw !== 'string') return null;
  const n = norm(raw);
  if (!n || n.length > 60) return null;

  /* ── Karışık çalma ──────────────────────────────────────────────────── */
  if (/^(?:karistirma(?:yi)?|karisik calma(?:yi)?|karisik mod(?:u)?|shuffle|rastgele (?:calma(?:yi)?|mod(?:u)?))\s+(?:ac|baslat|aktif et|kapat|durdur|iptal et|kaldir)$/.test(n)) {
    return { op: 'shuffle', on: !OFF.test(n.replace(/\s+et$/, '')) };
  }
  if (/^(?:sarkilari\s+)?karistir$/.test(n)) return { op: 'shuffle', on: true };

  /* ── Tekrar ─────────────────────────────────────────────────────────── */
  if (/^(?:tekrar(?:i|lama(?:yi)?)?|tekrar mod(?:u|unu)?|repeat)\s+(?:kapat|durdur|iptal et|kaldir)$/.test(n)) {
    return { op: 'repeat', mode: 'off' };
  }
  if (/^(?:bu\s+)?(?:sarkiyi|parcayi)\s+(?:tekrarla|tekrar cal|basa sarip tekrarla|surekli cal)$/.test(n)
    || /^(?:tekrar mod(?:u|unu)?|tekli tekrar)\s+(?:ac|aktif et)$/.test(n)) {
    return { op: 'repeat', mode: 'one' };
  }
  if (/^(?:listeyi|hepsini|sirayi|tum listeyi)\s+tekrarla$/.test(n)) return { op: 'repeat', mode: 'all' };

  /* ── Sarma ──────────────────────────────────────────────────────────── */
  if (/^(?:sarkiyi|parcayi)?\s*(?:bastan (?:baslat|al|cal)|basa (?:sar|al|don))$/.test(n)) return { op: 'restart' };
  {
    const m = n.match(/^(?:(\d{1,3}|[a-z]+)\s+(saniye|dakika)\s+|biraz\s+)?(ileri|geri)\s+(sar|al|git)$/);
    // Çıplak "ileri git" bir navigasyon cümlesi olabilir → miktar YOKSA yalnız "sar/al".
    if (m && !(m[4] === 'git' && m[1] === undefined)) {
      const unit = m[2] === 'dakika' ? 60 : 1;
      const q = m[1] !== undefined ? amount(m[1]) : 15;
      if (q === null || q <= 0 || q * unit > 600) return null;
      return { op: 'seek', deltaSec: (m[3] === 'geri' ? -1 : 1) * q * unit };
    }
  }

  /* ── Tema adıyla ────────────────────────────────────────────────────── */
  {
    const m = n.match(/^(?:temayi\s+)?(expedition|ekspedisyon|horizon|horayzin|tesla|pro)\s+(?:tema(?:si|sini|sina)?|temasina)?\s*(?:gec|ac|yap|olsun|sec|degistir)?$/);
    if (m && /tema/.test(n)) {
      const t = m[1] === 'ekspedisyon' ? 'expedition' : m[1] === 'horayzin' ? 'horizon' : m[1];
      return { op: 'theme', theme: t as CoreThemeName };
    }
  }

  /* ── Sürücü ─────────────────────────────────────────────────────────── */
  if (/^surucu(?:yu)?\s+degistir$/.test(n) || /^surucu(?:ler)?\s+(?:kim|kimler|listesi)$/.test(n)) {
    return { op: 'driver', name: null };
  }
  {
    // İsim ham metinden (büyük harf korunur) alınır; eşleşme yürütücüde.
    // Ek ("Ayşe'ye") burada SOYULMAZ — "Ayşe" → "Ayş" olurdu; yürütücü kayıtlı adlarla eşler.
    const mRaw = raw.trim().match(/^(?:mavi\s+)?(?:sürücüyü|surucuyu|sürücü|surucu)\s+(\S+)\s+(?:yap|olsun|seç|sec|geç|gec)$/i)
      ?? raw.trim().match(/^(?:mavi\s+)?(\S+)\s+(?:sürüyor|suruyor|kullanıyor|kullaniyor)$/i);
    if (mRaw && mRaw[1] && !/^(ben|biz|kim)$/i.test(mRaw[1])) return { op: 'driver', name: mRaw[1] };
  }
  return null;
}

/** Söylenen ad kayıtlı bir sürücü mü? Türkçe yönelme/belirtme eki toleranslı ("Ayşe'ye", "Mehmet'i"). */
export function matchDriverName<T extends { id: string; name: string }>(spoken: string, drivers: readonly T[]): T | null {
  const k = (x: string) => norm(x).replace(/\s+/g, '');
  const said = k(spoken.replace(/['’].*$/, ''));
  if (!said) return null;
  const exact = drivers.find((d) => k(d.name) === said);
  if (exact) return exact;
  // Eksiz söylenmemişse: kayıtlı ad + tek ek ("mehmeti", "aysey e") biçimi.
  return drivers.find((d) => {
    const base = k(d.name);
    return base.length >= 2 && said.startsWith(base) && /^(?:y?[aeiu]|n?[aeiu]|y[ae]|n[ae])$/.test(said.slice(base.length));
  }) ?? null;
}
