/**
 * remoteCommandModel.ts — CAROS LAB · Uzak Komut Zinciri SAF modeli.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DIŞARIDAN gelir) · global
 * durum yok · React importu yok. Girdi mutasyona uğratılmaz; her çağrı yeni
 * nesne döndürür → kilitlenebilir.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini
 * KULLANIR (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem kurulmaz.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';
import type { RemoteCommandRawSnapshot } from './remoteCommandSources';

/* ── Zincir hükmü ─────────────────────────────────────────────────────────── */

/**
 * Zincirin tek cümlelik hükmü. Amaç "komut çalışmadı"nın SEBEBİNİ ayırt etmek:
 *  · `NOT_LISTENING`  — dinleyici hiç bağlı değil: komut araca ULAŞAMAZ.
 *  · `NOT_POLLING`    — dinleyici bağlı ama komutlar HİÇ çekilmemiş. Teslim
 *                       yolu ÇEKME'dir (Realtime anon istemcide RLS yüzünden
 *                       olay üretmez, #647); yoklama koşmuyorsa komut gelmez.
 *  · `POLL_FAILING`   — yoklama koşuyor ama hata veriyor (cihaz anahtarı yok
 *                       ya da RPC/ağ hatası). "Bekleyen komut yok" DEĞİLDİR.
 *  · `NEVER_RECEIVED` — dinleyici bağlı, yoklama sağlıklı, hiç komut gelmemiş.
 *  · `CRYPTO_BLOCKED` — komutlar geliyor ama E2E kapısında düşüyor.
 *  · `TYPE_UNKNOWN`   — komutlar geliyor ama tipi araçta tanımsız (#573 izi).
 *  · `SAFETY_BLOCKED` — sürüş güvenliği kapısı baskın.
 *  · `HEALTHY`        — komutlar geliyor ve çoğunlukla tamamlanıyor.
 *  · `UNKNOWN`        — kaynak okunamadı, hüküm verilemez (fail-closed).
 */
export type RemoteCommandVerdict =
  | 'NOT_LISTENING' | 'NOT_POLLING'    | 'POLL_FAILING'
  | 'NEVER_RECEIVED' | 'CRYPTO_BLOCKED'
  | 'TYPE_UNKNOWN'  | 'SAFETY_BLOCKED' | 'HEALTHY' | 'UNKNOWN';

export const REMOTE_COMMAND_VERDICT_LABEL: Readonly<Record<RemoteCommandVerdict, string>> = {
  NOT_LISTENING:  'DİNLEYİCİ BAĞLI DEĞİL',
  NOT_POLLING:    'KOMUT HİÇ ÇEKİLMEDİ',
  POLL_FAILING:   'ÇEKME HATA VERİYOR',
  NEVER_RECEIVED: 'HİÇ KOMUT GELMEDİ',
  CRYPTO_BLOCKED: 'ŞİFRE KAPISINDA DÜŞÜYOR',
  TYPE_UNKNOWN:   'KOMUT TİPİ TANIMSIZ',
  SAFETY_BLOCKED: 'GÜVENLİK KAPISI REDDEDİYOR',
  HEALTHY:        'KOMUTLAR İŞLENİYOR',
  UNKNOWN:        'OKUNAMADI',
} as const;

/**
 * Hüküm — SAF ve sıralı. En ağır engel önce gelir: dinleyici yoksa diğer
 * sayaçlar zaten anlamsızdır. `HEALTHY` yalnız gerçekten tamamlanan komut
 * VARSA verilir; "hata yok" tek başına sağlık kanıtı DEĞİLDİR.
 */
export function judgeRemoteCommandChain(s: RemoteCommandRawSnapshot): RemoteCommandVerdict {
  if (s.listenerActive === null || s.command === null) return 'UNKNOWN';
  if (!s.listenerActive) return 'NOT_LISTENING';

  const c = s.command;

  /* Teslim yolu ÇEKME'dir (#647). Yoklama hiç koşmadıysa "komut gelmedi"
     DENEMEZ — henüz SORULMAMIŞTIR. */
  if (c.pollRuns === 0) return 'NOT_POLLING';
  /* Turların yarısından fazlası hata veriyorsa sessizlik bir ölçüm değildir. */
  if (c.pollErrors > c.pollRuns / 2) return 'POLL_FAILING';

  if (c.received === 0) return 'NEVER_RECEIVED';

  // Baskınlık: bir engel işlenen komutların yarısından fazlasını yiyorsa hükümdür.
  const half = c.received / 2;
  if (c.cryptoFailed  > half) return 'CRYPTO_BLOCKED';
  if (c.unknownType   > half) return 'TYPE_UNKNOWN';
  if (c.movingBlocked > half) return 'SAFETY_BLOCKED';

  return c.completed > 0 ? 'HEALTHY' : 'UNKNOWN';
}

/* ── Kartlar ──────────────────────────────────────────────────────────────── */

export interface RemoteCommandCard {
  readonly id:     string;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

export interface RemoteCommandView {
  readonly readAt:  number;
  readonly verdict: RemoteCommandVerdict;
  readonly cards:   readonly RemoteCommandCard[];
}

const SRC_LISTENER = 'commandListener';
const SRC_SPEED    = 'speedAlertRuntime';

/** ms → insan okunur yaş. Saf; `null` girdi `null` çıktı verir (uydurma yok). */
export function ageText(fromMs: number | null, nowMs: number): string | null {
  if (fromMs === null || !Number.isFinite(fromMs)) return null;
  const d = nowMs - fromMs;
  if (d < 0) return 'şimdi';
  if (d < 60_000) return `${Math.round(d / 1000)} sn önce`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)} dk önce`;
  return `${Math.round(d / 3_600_000)} sa önce`;
}

/**
 * Görünümü kurar. `nowMs` DIŞARIDAN gelir — model zamanı kendisi okumaz.
 * Okunamayan her alan `UNAVAILABLE`dır; **sahte 0 yazılmaz**.
 */
export function buildRemoteCommandView(
  s: RemoteCommandRawSnapshot,
  nowMs: number,
): RemoteCommandView {
  const c  = s.command;
  const sa = s.speedAlert;
  /* `?? null`: kaynak katmanı bu alanı üretemezse (eski snapshot / okuma hatası)
     model ÇÖKMEZ, alan UNAVAILABLE olur — fail-soft. */
  const g  = s.speedGate ?? null;
  const cfg = s.speedAlertConfig;

  const chain: RemoteCommandCard = {
    id: 'chain', title: '1 · Dinleyici / Teslim',
    fields: [
      observed({
        id: 'listener', label: 'Komut dinleyicisi', source: SRC_LISTENER,
        note: 'Dinleyici canlı mı. Bağlı değilse telefondan gönderilen komut araca ULAŞMAZ (DB’de pending kalır, TTL dolar).',
      }, s.listenerActive === null ? null : (s.listenerActive ? 'BAĞLI' : 'BAĞLI DEĞİL')),
      observed({
        id: 'pollRuns', label: 'Yoklama turu', source: SRC_LISTENER,
        note: 'Bekleyen komutların cihaz anahtarıyla SORULDUĞU tur sayısı. Teslim yolu ÇEKME’dir: Realtime olayları anon istemcide RLS yüzünden HİÇ gelmez (#647). 0 ise komut hiç sorulmamıştır.',
      }, c ? c.pollRuns : null),
      observed({
        id: 'pollErrors', label: '↳ hatalı tur', source: SRC_LISTENER,
        note: 'Cihaz anahtarı yok / RPC / ağ hatası. Hatalı tur "bekleyen komut yok" ANLAMINA GELMEZ.',
      }, c ? c.pollErrors : null),
      observed({
        id: 'lastPollOutcome', label: 'Son yoklama sonucu', source: SRC_LISTENER,
        note: 'ok = komut döndü · empty = gerçekten bekleyen yok · no_key = cihaz anahtarı okunamadı · error = RPC/ağ hatası. Bu ayrım olmadan sessizlik yorumlanamaz.',
      }, c ? c.lastPollOutcome : null),
      observed({
        id: 'lastPollRows', label: 'Son turda dönen komut', source: SRC_LISTENER,
        note: 'Son yoklamada gelen satır sayısı. Hata durumunda sahte 0 YAZILMAZ, "okunamadı" kalır.',
      }, c ? c.lastPollRows : null),
      derived({
        id: 'lastPollAt', label: 'Son yoklama', source: SRC_LISTENER,
        note: 'Yoklama yaşı. Aralık 15 sn’dir; bundan çok daha eskiyse dinleyici uyutulmuş olabilir.',
      }, c ? ageText(c.lastPollAt, nowMs) : null),
      observed({
        id: 'received', label: 'Alınan komut', source: SRC_LISTENER,
        note: 'Araca ULAŞAN komut sayısı. 0 ise ya hiç komut gönderilmedi, ya yoklama koşmadı, ya da yoklama hata veriyor — üstteki alanlar ayırır.',
      }, c ? c.received : null),
      observed({
        id: 'completed', label: 'Tamamlanan', source: SRC_LISTENER,
        note: 'Araçta gerçekten yürütülen komutlar.',
      }, c ? c.completed : null),
      observed({
        id: 'rejected', label: 'Reddedilen', source: SRC_LISTENER,
        note: 'Güvenlik/politika gereği reddedilenler (retry YOK).',
      }, c ? c.rejected : null),
      observed({
        id: 'failed', label: 'Başarısız', source: SRC_LISTENER,
        note: 'Yeniden denemeler tükendikten sonra kalıcı düşenler.',
      }, c ? c.failed : null),
      observed({
        id: 'retries', label: 'Yeniden deneme', source: SRC_LISTENER,
        note: 'Toplam retry sayısı (exponential backoff).',
      }, c ? c.retries : null),
      observed({
        id: 'ttl', label: 'TTL aşımı', source: SRC_LISTENER,
        note: '5 dk pencereyi geçtiği için hiç yürütülmeyen komutlar — araç uzun süre çevrimdışıysa artar.',
      }, c ? c.ttlExpired : null),
    ],
  };

  const gates: RemoteCommandCard = {
    id: 'gates', title: '2 · Kapılar (neden reddedildi)',
    fields: [
      observed({
        id: 'crypto', label: 'E2E şifre kapısı', source: SRC_LISTENER,
        note: 'Fiziksel (MCU/CAN) ve yıkıcı komutlar şifresiz KABUL EDİLMEZ. Buradaki artış anahtar eşleşmesi bozuk demektir.',
      }, c ? c.cryptoFailed : null),
      observed({
        id: 'moving', label: 'Sürüş güvenliği kapısı', source: SRC_LISTENER,
        note: 'Araç 5 km/h üstündeyken kilit/kilit-açma reddi. Bu sayaç ancak hız otoritesi BESLENİYORSA artabilir.',
      }, c ? c.movingBlocked : null),
      observed({
        id: 'movingUnverified', label: 'Hız kanıtsız kabul', source: SRC_LISTENER,
        note: 'Tehlikeli komutun TAZE hız ölçümü olmadan kabul edildiği durumlar. Sıfırdan büyükse o komutlar kapıdan değil, kapının körlüğünden geçmiştir — "güvenlik kapısı korudu" DENEMEZ.',
      }, c ? c.movingUnverified : null),
      observed({
        id: 'unknownType', label: 'Tanımsız komut tipi', source: SRC_LISTENER,
        note: 'Araç bu tipi bilmiyor. Artıyorsa telefon ile araç sürümleri ayrışmıştır (veya DB tip listesi eksiktir).',
      }, c ? c.unknownType : null),
      observed({
        id: 'lastType', label: 'Son komut tipi', source: SRC_LISTENER,
        note: 'Yalnız TİP tutulur — komut kimliği, payload ve hedef adres defterlere GİRMEZ.',
      }, c ? c.lastType : null),
      observed({
        id: 'lastOutcome', label: 'Son sonuç', source: SRC_LISTENER,
        note: 'Son işlenen komutun sonucu.',
      }, c ? c.lastOutcome : null),
      derived({
        id: 'lastAt', label: 'Son işlem', source: SRC_LISTENER,
        note: 'Son komut işleme anının yaşı (okuma anına göre türetildi).',
      }, c ? ageText(c.lastAt, nowMs) : null),
    ],
  };

  const speed: RemoteCommandCard = {
    id: 'speed', title: '3 · Hız Otoritesi / Hız Uyarısı',
    fields: [
      observed({
        id: 'running', label: 'Hız aboneliği', source: SRC_SPEED,
        note: 'Kapalıysa hem hız uyarısı hem SÜRÜŞ GÜVENLİĞİ KAPISI beslenmiyordur (kapı kör kalır).',
      }, sa ? (sa.running ? 'ÇALIŞIYOR' : 'DURDU') : null),
      observed({
        id: 'samples', label: 'İşlenen hız örneği', source: SRC_SPEED,
        note: 'OBD veri akışından gelen örnek sayısı — kararın taban ölçüsü.',
      }, sa ? sa.samples : null),
      observed({
        id: 'gateFed', label: 'Kapıya verilen ölçüm', source: SRC_SPEED,
        note: 'Sürüş güvenliği kapısına kaç kez GERÇEK hız verildi. 0 ise kapı hâlâ kördür.',
      }, sa ? sa.gateFed : null),
      observed({
        id: 'fusedFed', label: '↳ füzyon otoritesinden', source: SRC_SPEED,
        note: 'BİRİNCİL kaynak: HAL>CAN>OBD>GPS önceliğiyle çözülen araç hızı. OBD dongle olmayan araçta kapıyı besleyen tek kaynak budur.',
      }, sa ? sa.fusedFed : null),
      observed({
        id: 'obdFed', label: '↳ doğrudan OBD (yedek)', source: SRC_SPEED,
        note: 'YEDEK kaynak: füzyon katmanı düşerse kapı tamamen kör kalmasın diye tutulur.',
      }, sa ? sa.obdFed : null),
      /* Sayaç "beslendi mi"yi söyler; bu alan "ŞU AN taze mi"yi söyler.
         Bayat ölçümle çalışan kapı beslenmiştir AMA hüküm veremez. */
      derived({
        id: 'gateFreshness', label: 'Kapıdaki ölçümün yaşı', source: SRC_LISTENER,
        note: `Bu yaş ${g === null ? '?' : Math.round(g.maxAgeMs / 1000)} sn'yi geçerse kapı "hız bilinmiyor" der ve tehlikeli komutu hız kanıtı OLMADAN geçirir (reddetmez — kapalı otoparkta aracını açamamak ürünü kırardı).`,
      }, g ? ageText(g.lastAtMs, nowMs) : null),
      observed({
        id: 'gateSpeed', label: 'Kapıdaki son hız', source: SRC_LISTENER,
        note: 'Kapının hüküm kurduğu değer. "Hiç ölçülmedi" ile "ölçüldü ve 0" AYRI şeylerdir — burada sahte 0 gösterilmez.',
      }, g && g.lastSpeedKmh !== null ? `${Math.round(g.lastSpeedKmh)} km/h` : null),
      observed({
        id: 'unknownSpeed', label: 'Hız ölçülemedi', source: SRC_SPEED,
        note: 'Hızın bilinmediği örnekler — bu anlarda hüküm ÜRETİLMEZ ve kapıya 0 YAZILMAZ.',
      }, sa ? sa.unknownSpeed : null),
      observed({
        id: 'alertConfig', label: 'Araçtaki uyarı ayarı', source: SRC_SPEED,
        note: 'Telefondan gelen ayarın araçtaki geçerli hali. "Kurulmadı" ise komut hiç ulaşmamıştır.',
      }, cfg ? `${cfg.enabled ? 'AÇIK' : 'KAPALI'} · ${cfg.thresholdKmh} km/h` : null),
      observed({
        id: 'fired', label: 'Üretilen uyarı', source: SRC_SPEED,
        note: 'Eşik aşımında üretilen bildirim sayısı.',
      }, sa ? sa.fired : null),
      observed({
        id: 'suppressed', label: 'Cooldown ile bastırılan', source: SRC_SPEED,
        note: `Aşım sürerken ${Math.round(s.cooldownMs / 60_000)} dk penceresi dolmadığı için gönderilmeyenler (bildirim yağmuru koruması).`,
      }, sa ? sa.suppressedCooldown : null),
      observed({
        id: 'pushBound', label: 'Telefon bildirim kanalı', source: SRC_SPEED,
        note: 'Bağlı değilse uyarı ÜRETİLSE BİLE telefona gitmez.',
      }, sa ? (sa.pushChannelBound ? 'BAĞLI' : 'BAĞLI DEĞİL') : null),
      observed({
        id: 'driverBound', label: 'Araç içi uyarı kanalı', source: SRC_SPEED,
        note: 'Sürücü uyarısının yolu (VehicleEventHub → SystemOrchestrator). Bağlı değilse direksiyondaki kişi UYARILMAZ; uyarı yalnız telefona gider.',
      }, sa ? (sa.driverChannelBound ? 'BAĞLI' : 'BAĞLI DEĞİL') : null),
      observed({
        id: 'driverAlerts', label: 'Sürücüye verilen uyarı', source: SRC_SPEED,
        note: 'Araç içinde gösterilen uyarı sayısı. Bu sayı uyarının ÜRETİLDİĞİNİ gösterir; sürücünün GÖRDÜĞÜNÜ kanıtlamaz (geri viteste bastırılmış olabilir).',
      }, sa ? sa.driverAlerts : null),
      observed({
        id: 'lastReason', label: 'Son karar gerekçesi', source: SRC_SPEED,
        note: 'disabled · speed_unknown · below · still_over · fired',
      }, sa ? sa.lastReason : null),
      derived({
        id: 'policy', label: 'Politika', source: SRC_SPEED,
        note: 'Eşik aralığı ve histerezis bandı — sayaçlar bunlar bilinmeden yorumlanamaz.',
      }, `${s.thresholdMinKmh}–${s.thresholdMaxKmh} km/h · histerezis ${s.hysteresisKmh} km/h`),
    ],
  };

  // Kaynak tamamen okunamadıysa kartlar yine üretilir ama alanlar UNAVAILABLE olur
  // (ekran boş kalmaz, "okunamadı" AÇIKÇA görünür).
  if (c === null && sa === null) {
    return {
      readAt: s.readAt,
      verdict: 'UNKNOWN',
      cards: [
        { id: 'chain', title: chain.title, fields: [
          unavailable({ id: 'src', label: 'Kaynak', source: SRC_LISTENER, note: 'Kanıt defteri okunamadı.' }),
        ] },
      ],
    };
  }

  return {
    readAt:  s.readAt,
    verdict: judgeRemoteCommandChain(s),
    cards:   [chain, gates, speed],
  };
}
