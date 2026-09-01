/**
 * deviceIdentityLabModel.ts — CİHAZ KİMLİĞİ + E2E ANAHTAR GÖZLEMİNİN SAF MODELİ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * Ham gözlemi bir HÜKME çevirmek — ama **kanıt yoksa hüküm de yoktur**.
 * `null` gözlem `UNAVAILABLE` üretir; "iyi" varsayılmaz.
 */

import type {
  DeviceIdentityObservation,
  DevicePairingObservation,
  E2eKeyPublishObservation,
} from './deviceIdentityLabSources';

/** Ortak durum sınıflandırması — `sessionInspectorModel` sözleşmesiyle uyumlu. */
export type LabVerdict = 'OK' | 'WARN' | 'BAD' | 'UNAVAILABLE';

export interface LabLine {
  readonly label:   string;
  readonly value:   string;
  readonly verdict: LabVerdict;
  /** Neden bu hüküm — kullanıcı "neden kırmızı" diye sormasın. */
  readonly note:    string | null;
}

/* ── Cihaz kimliği ─────────────────────────────────────────────────────── */

const SOURCE_NOTE: Readonly<Record<string, string>> = {
  STORED:
    'Kimlik güvenli depodan okundu — normal çalışma.',
  DERIVED_SSAID:
    'Kimlik SSAID’den türetildi. İlk kurulum ya da REINSTALL sonrası beklenen durumdur; ' +
    'yeni araç kaydı AÇILMAZ.',
  RANDOM_FALLBACK:
    'SSAID okunamadı → kimlik rastgele üretildi. Bu cihazda uygulama silinip yeniden ' +
    'kurulursa YENİ ARAÇ AÇILIR.',
  UNKNOWN:
    'Kimlik bu oturumda henüz çözülmedi. “Bilinmiyor” güvenli DEMEK DEĞİLDİR.',
};

export function buildIdentityLines(obs: DeviceIdentityObservation | null): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'Cihaz kimliği', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE',
      note: 'Kimlik katmanı okunamadı.',
    }];
  }

  const sourceVerdict: LabVerdict =
    obs.source === 'STORED' || obs.source === 'DERIVED_SSAID' ? 'OK'
    : obs.source === 'RANDOM_FALLBACK' ? 'WARN'
    : 'UNAVAILABLE';

  const lines: LabLine[] = [
    {
      label: 'Kimlik kaynağı', value: obs.source, verdict: sourceVerdict,
      note: SOURCE_NOTE[obs.source] ?? null,
    },
    {
      label: 'Reinstall dayanıklı', value: obs.reinstallSafe ? 'EVET' : 'HAYIR',
      verdict: obs.reinstallSafe ? 'OK' : 'WARN',
      note: obs.reinstallSafe
        ? null
        : 'Uygulama kaldırılıp kurulursa bu cihaz sunucuda YENİ bir araç açar.',
    },
  ];

  /* Yalnız GERÇEKTEN olduğunda satır üret — sürekli yeşil “sorun yok” satırı
     gözü kör eder ve asıl uyarıyı gölgeler. */
  if (obs.registeredWithoutKey) {
    lines.push({
      label: 'Cihaz anahtarı', value: 'KAYITLI AMA ANAHTARSIZ', verdict: 'BAD',
      note: 'Sunucu bu aracı tanıyor ama yerel anahtar yok — telemetri ve komut ' +
            'durumu gönderilemez. Bilinen sınır: reinstall anahtarı geri getirmez.',
    });
  }
  if (obs.weakRandomUsed) {
    lines.push({
      label: 'Rastgelelik', value: 'ZAYIF (crypto yok)', verdict: 'WARN',
      note: 'Bu WebView’da crypto.getRandomValues bulunamadı; kimlik zayıf ' +
            'rastgelelikle üretildi.',
    });
  }
  return lines;
}

/* ── Eşleştirme / telemetri hattı ──────────────────────────────────────── */

export function buildPairingLines(obs: DevicePairingObservation | null): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'Telemetri hattı', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE', note: null,
    }];
  }

  const lines: LabLine[] = [{
    label: 'Supabase yapılandırması', value: obs.configured ? 'GÖMÜLÜ' : 'YOK',
    verdict: obs.configured ? 'OK' : 'WARN',
    note: obs.configured ? null : 'VITE_SUPABASE_URL/ANON_KEY build’e gömülmemiş — bulut yolu kapalı.',
  }];

  if (obs.droppedNoKeyCount > 0) {
    lines.push({
      label: 'Düşürülen olay', value: String(obs.droppedNoKeyCount), verdict: 'BAD',
      note: 'Cihaz anahtarı olmadığı için gönderilemeyen telemetri/tanı olayı sayısı.',
    });
  }
  return lines;
}

/* ── E2E açık anahtar yayını ───────────────────────────────────────────── */

const OUTCOME_NOTE: Readonly<Record<string, string>> = {
  ok:
    'Anahtar sunucuda güncel. Fiziksel komutlar (kilit/korna/alarm) şifrelenebilir.',
  rotated:
    'Yeni anahtar yayınlandı (rotasyon). Telefon bir sonraki komutta yeni anahtarı kullanır.',
  rejected:
    'Sunucu yayını REDDETTİ — anahtar sunucuda GÜNCELLENMEDİ; fiziksel komutlar çalışmaz.',
  no_key:
    'Yayın hiç DENENEMEDİ: cihaz anahtarı ya da Supabase yapılandırması yok. ' +
    'Bu “başarısız” değil, “deneme yapılamadı” demektir.',
  error:
    'Ağ ya da RPC hatası. Anahtar sunucuda ESKİ hâliyle kalmış olabilir.',
};

/**
 * E2E yayın hükmü.
 *
 * FAIL-CLOSED: yayın kanıtı yoksa `UNAVAILABLE` döner. "Muhtemelen çalışıyordur"
 * demek, üretimde iki yıl boyunca hiç çalışmamış bir zinciri "sağlıklı" göstermenin
 * tam olarak yoludur.
 */
export function buildE2eLines(obs: E2eKeyPublishObservation | null): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'E2E açık anahtar', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE', note: null,
    }];
  }

  if (obs.runs === 0) {
    return [{
      label: 'E2E açık anahtar', value: 'HİÇ DENENMEDİ', verdict: 'UNAVAILABLE',
      note: 'Komut dinleyicisi bu oturumda hiç bağlanmadı — yayın denemesi yok.',
    }];
  }

  const verdict: LabVerdict =
    obs.outcome === 'ok' || obs.outcome === 'rotated' ? 'OK'
    : obs.outcome === 'rejected' || obs.outcome === 'error' ? 'BAD'
    : obs.outcome === 'no_key' ? 'WARN'
    : 'UNAVAILABLE';

  const lines: LabLine[] = [
    {
      label: 'Son yayın sonucu', value: obs.outcome ?? 'UNAVAILABLE', verdict,
      note: obs.outcome === null ? null : (OUTCOME_NOTE[obs.outcome] ?? null),
    },
    {
      label: 'Yayın denemesi / kabul', value: `${obs.runs} / ${obs.ok}`,
      verdict: obs.ok > 0 ? 'OK' : 'WARN',
      note: obs.ok === 0 ? 'Hiçbir yayın sunucu tarafından kabul edilmedi.' : null,
    },
  ];

  if (obs.reason !== null) {
    lines.push({
      label: 'Red gerekçesi', value: obs.reason, verdict: 'BAD',
      note: obs.reason === 'INVALID_KEY_FORMAT'
        ? 'Anahtarın biçimi sunucu kapısından geçmedi.'
        : obs.reason === 'UNSUPPORTED_ALG'
          ? 'Araç ile sunucunun anahtar sözleşmesi AYRIŞMIŞ.'
          : null,
    });
  }

  if (obs.cryptoFailed > 0) {
    lines.push({
      label: 'Şifreleme kapısında reddedilen komut', value: String(obs.cryptoFailed),
      verdict: 'BAD',
      note: 'Bu komutlar E2E zarfı olmadan geldi ve KATEGORİK reddedildi. ' +
            'Sayaç sıfırdan büyükse gönderen uç ile araç AYRIŞMIŞ demektir.',
    });
  }

  return lines;
}

/** Ekranın tepesindeki tek cümlelik hüküm — en kötü satır kazanır. */
export function overallVerdict(groups: readonly (readonly LabLine[])[]): LabVerdict {
  let worst: LabVerdict = 'OK';
  const rank: Readonly<Record<LabVerdict, number>> = {
    OK: 0, UNAVAILABLE: 1, WARN: 2, BAD: 3,
  };
  for (const g of groups) {
    for (const l of g) {
      if (rank[l.verdict] > rank[worst]) worst = l.verdict;
    }
  }
  return worst;
}
