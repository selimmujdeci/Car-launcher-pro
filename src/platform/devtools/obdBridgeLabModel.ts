/**
 * obdBridgeLabModel — OBD DATA BRIDGE GÖZLEMİNİN SAF MODELİ (P0-OBD-01).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * Ham gözlemi bir HÜKME çevirmek — ama **kanıt yoksa hüküm de yoktur**.
 * `null` gözlem `UNAVAILABLE` üretir; "iyi" varsayılmaz.
 *
 * ── ÜÇ DURUM BİRLEŞTİRİLMEZ ───────────────────────────────────────────────
 *   AKIYOR · ARAÇ VERMİYOR · HENÜZ SORULMADI
 * Üçünü tek "veri yok" kutusuna koymak, çalışan bir sistemi arızalı ya da
 * arızalı bir sistemi "araç desteklemiyor" göstermek olurdu.
 */

import type { ObdBridgeDiagnostics } from '../vehicleDataLayer/obdSignalBridge';
import type {
  CanonicalSignalObservation, AuthorityObservation, WireBudgetObservation,
} from './obdBridgeLabSources';
import type { ObdFreshnessState } from '../obd/obdFreshnessPolicy';

/** Ortak durum sınıflandırması — `sessionInspectorModel` sözleşmesiyle uyumlu. */
export type LabVerdict = 'OK' | 'WARN' | 'BAD' | 'UNAVAILABLE';

export interface LabLine {
  readonly label:   string;
  readonly value:   string;
  readonly verdict: LabVerdict;
  /** Neden bu hüküm — kullanıcı "neden kırmızı" diye sormasın. */
  readonly note:    string | null;
}

/** Sinyalin ekranda görünen tek satırı. */
export interface SignalRow {
  readonly key:     string;
  readonly pid:     string;
  readonly name:    string;
  /** Ölçüm + birim, ya da `UNAVAILABLE` — sahte 0 ASLA basılmaz. */
  readonly reading: string;
  /** Tazelik hükmü: `LIVE` · `STALE` · `UNAVAILABLE`. */
  readonly state:   ObdFreshnessState;
  /** İnsan okunur gerekçe — "neden UNAVAILABLE" sorusu ekranda cevaplanır. */
  readonly why:     string;
  /** Ölçümün yaşı, biçimlenmiş (`3 sn` · `2 dk 10 sn`); ölçüm yoksa `—`. */
  readonly age:     string;
  /** Ham yaş (ms) — sıralama/test için; ölçüm yoksa `null`. */
  readonly ageMs:   number | null;
  /** Son ölçüm anı (Unix ms); yoksa `null` — sahte damga YOK. */
  readonly measuredAtMs: number | null;
  /** Bu sinyalin LIVE penceresi, biçimlenmiş (`16 sn`); bilinmiyorsa `—`. */
  readonly window:  string;
  readonly verdict: LabVerdict;
  readonly safety:  boolean;
  /** `core` (ek trafik yok) / `extended` (slot tüketir). */
  readonly path:    string;
  /** Tazelik sınıfı (`hot` · `medium` · `slow` · `archival`). */
  readonly cls:     string;
}

/* ── 1. Köprü sağlığı ──────────────────────────────────────────────────── */

export function buildBridgeLines(obs: ObdBridgeDiagnostics | null): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'OBD Data Bridge', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE',
      note: 'Köprü katmanı okunamadı. "Okunamadı" ile "köprü yok" AYNI ŞEY DEĞİLDİR.',
    }];
  }

  const writes = obs.coreWrites + obs.extendedWrites;

  const lines: LabLine[] = [
    {
      label: 'Köprü durumu',
      value: obs.active ? 'AYAKTA' : 'DURDU',
      verdict: obs.active ? 'OK' : 'BAD',
      note: obs.active
        ? null
        : 'Köprü çalışmıyor — OBD sinyalleri kanonik mağazaya HİÇ ulaşmıyor. ' +
          'Guardian ve ürün arayüzü OBD-only araçta bu sinyalleri göremez.',
    },
    {
      label: 'Abonelik',
      value: `${obs.subscriptions}`,
      verdict: obs.active && obs.subscriptions > 0 ? 'OK' : obs.active ? 'BAD' : 'UNAVAILABLE',
      note: obs.active && obs.subscriptions === 0
        ? 'Köprü ayakta ama hiçbir kaynağa abone değil — sessiz ölüm.'
        : '1 çekirdek aboneliği + katalogdaki genişletilmiş PID izleyicileri.',
    },
    {
      label: 'Mağaza yazımı',
      value: writes === 0 ? 'HİÇ' : `${writes} (çekirdek ${obs.coreWrites} · genişletilmiş ${obs.extendedWrites})`,
      verdict: writes > 0 ? 'OK' : obs.active ? 'WARN' : 'UNAVAILABLE',
      note: writes === 0 && obs.active
        ? 'Köprü ayakta ama tek satır yazmadı. Beklenen: OBD bağlı değil, ya da ' +
          'okuma bayat (canlılık kapısı elemiş). Bu SATIR TEK BAŞINA arıza kanıtı DEĞİLDİR.'
        : null,
    },
    {
      label: 'Son yazım',
      value: obs.lastWriteAtMs === null ? 'HİÇ' : `${obs.lastWriteAtMs}`,
      verdict: obs.lastWriteAtMs === null ? 'UNAVAILABLE' : 'OK',
      note: obs.lastWriteAtMs === null
        ? 'Hiç yazım olmadığı için YAŞ HESAPLANMAZ (sahte "56 yıl" üretilmez).'
        : null,
    },
  ];

  /* Eleme satırı YALNIZ gerçekten eleme olduysa üretilir — sürekli yeşil
     "0 eleme" satırı gözü kör eder ve asıl uyarıyı gölgeler. */
  if (obs.rejected > 0) {
    lines.push({
      label: 'Elenen değer', value: `${obs.rejected}`, verdict: 'OK',
      note: 'Sentinel (-1 = "sorulmadı/desteklenmiyor") ya da bozuk değerler ' +
            'mağazaya YAZILMADI. Bu bir ARIZA DEĞİL, sahte-veri kapısının çalıştığının kanıtıdır.',
    });
  }
  return lines;
}

/* ── 2. Sinyal tablosu ─────────────────────────────────────────────────── */

/**
 * Bir sinyalin tazelik hükmü + PID durumu → tek dürüst satır.
 *
 * ── İKİ AYRI SORU, İKİ AYRI CEVAP ─────────────────────────────────────────
 *   `freshness`  → "elimizdeki ÖLÇÜM hâlâ geçerli mi?"  (LIVE · STALE · UNAVAILABLE)
 *   `pidStatus`  → "araç bu PID'i VERİYOR mu?"           (live · no_data · unsupported · probing)
 * İkisi ÇELİŞEBİLİR ve bu çelişki TEŞHİSTİR: ölçüm bayat ama PID hâlâ `live`
 * ise sorun köprüde/mağazadadır; ölçüm yok ve PID `unsupported` ise araçtadır.
 * Bu yüzden satır ikisini de taşır ve `why` alanı hangisinin konuştuğunu söyler.
 */
export function buildSignalRow(obs: CanonicalSignalObservation): SignalRow {
  const hasValue = obs.value !== null;

  let verdict: LabVerdict;
  let why: string;

  if (obs.freshness === 'LIVE') {
    verdict = 'OK';
    why = 'Ölçüm taze — karara girebilir.';
  } else if (obs.freshness === 'STALE') {
    verdict = 'WARN';
    why = 'Ölçüm GERÇEKTİ ama tazelik penceresi aşıldı. Değer GÖSTERİLİR, ' +
          'KARARA GİRMEZ. Guardian bu sinyali kullanmaz.';
  } else if (obs.freshnessReason === 'session_changed') {
    verdict = 'WARN';
    why = 'Ölçüm ÖNCEKİ OBD oturumuna ait. Adaptör bu arada başka bir araca ' +
          'takılmış olabilir → yaşı ne olursa olsun DÜŞÜRÜLDÜ.';
  } else if (obs.freshnessReason === 'expired') {
    verdict = 'UNAVAILABLE';
    why = 'Ölçüm o kadar eski ki aracın GÜNCEL durumu hakkında bilgi taşımıyor.';
  } else if (obs.pidStatus === 'unsupported') {
    verdict = 'UNAVAILABLE';
    why = 'Araç bu PID’i TANIMIYOR (keşif bitmap kanıtı). Bu bir arıza DEĞİLDİR.';
  } else if (obs.pidStatus === 'no_data') {
    verdict = 'WARN';
    why = 'Bitmap destekli diyor ama ECU YANIT VERMİYOR — "desteklenmiyor" ile ' +
          'AYNI ŞEY DEĞİLDİR.';
  } else if (obs.pidStatus === 'probing') {
    verdict = 'UNAVAILABLE';
    why = 'Henüz kanıt yok: keşif ya da ilk sorgu sürüyor.';
  } else {
    verdict = 'UNAVAILABLE';
    why = 'Bu sinyal için hiç ölçüm alınmadı.';
  }

  return {
    key:  obs.key,
    pid:  obs.pid,
    name: obs.name,
    reading: hasValue
      ? `${_fmt(obs.value as number)}${obs.unit ? ' ' + obs.unit : ''}`
      : 'UNAVAILABLE',
    state:   obs.freshness,
    why,
    age:     formatAge(obs.ageMs),
    ageMs:   obs.ageMs,
    measuredAtMs: obs.measuredAtMs,
    window:  formatAge(obs.staleMs),
    verdict,
    safety:  obs.safety,
    path:    obs.path,
    cls:     obs.cls,
  };
}

/**
 * Süreyi insan okunur yapar. `null` → `—` (SAHTE 0 YOK: "0 sn" bir ölçümdür,
 * "ölçüm yok" değildir; ikisini aynı göstermek tam olarak bu turun kapattığı
 * yalan türüdür).
 */
export function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const totalSec = Math.floor(ms / 1_000);
  if (totalSec < 60) return `${totalSec} sn`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec === 0 ? `${min} dk` : `${min} dk ${sec} sn`;
  const hr = Math.floor(min / 60);
  return `${hr} sa ${min % 60} dk`;
}

/** En fazla 2 ondalık; tam sayıda ondalık basılmaz. */
function _fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

export function buildSignalRows(
  obs: readonly CanonicalSignalObservation[] | null,
): readonly SignalRow[] {
  if (obs === null) return [];
  return obs.map((o) => buildSignalRow(o));
}

/** Kaç sinyal CANLI / BAYAT / YOK — tek bakışta özet. */
export function summarizeSignals(rows: readonly SignalRow[]): {
  readonly total: number; readonly live: number; readonly stale: number; readonly missing: number;
} {
  let live = 0, stale = 0, missing = 0;
  for (const r of rows) {
    if (r.state === 'LIVE') live++;
    else if (r.state === 'STALE') stale++;
    else missing++;
  }
  return { total: rows.length, live, stale, missing };
}

/* ── 3. Otorite tablosu ────────────────────────────────────────────────── */

const AUTHORITY_LABEL: Readonly<Record<string, string>> = {
  coolantTemp: 'Soğutma sıvısı sıcaklığı',
  oilTemp:     'Motor yağı sıcaklığı',
  throttle:    'Gaz kelebeği konumu',
  batteryVolt: '12V akü / modül voltajı',
  ambientTemp: 'Ortam hava sıcaklığı',
};

export function buildAuthorityLines(
  obs: readonly AuthorityObservation[] | null,
): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'Otorite tablosu', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE', note: null,
    }];
  }
  return obs.map((a) => {
    const label = AUTHORITY_LABEL[a.signal] ?? a.signal;
    if (a.source === 'NONE') {
      return {
        label, value: 'KAYNAK YOK', verdict: 'UNAVAILABLE' as LabVerdict,
        note: 'Ne CAN ne OBD bu büyüklüğü veriyor. İlgili kural PASİFTİR — ' +
              'bu bir arıza değil, KANIT YOKLUĞUDUR.',
      };
    }
    /* Her iki kaynak da varken hangisinin kazandığını AÇIKÇA yazmak şart:
       "değer var ama yanlış kaynaktan" kusuru ancak böyle görülür. */
    const both = a.canPresent && a.obdPresent;
    const stale = a.state === 'STALE';
    return {
      label,
      value: `${a.source} · ${a.value === null ? 'UNAVAILABLE' : _fmt(a.value)}`
             + (stale ? ' · BAYAT' : ''),
      verdict: (stale ? 'WARN' : 'OK') as LabVerdict,
      note: stale
        ? 'Değer BAYAT: gösterilir ama Guardian ve akü koruması onu KULLANMAZ ' +
          '(fail-closed). Bayat ölçümle karar vermek sahte veriyle karar vermektir.'
        : both
          ? 'CAN ve OBD İKİSİ DE ölçüyor; öncelik sözleşmesi gereği CAN kazandı ' +
            '(doğrudan araç şebekesi, daha düşük gecikme).'
          : a.source === 'OBD'
            ? 'CAN bu büyüklüğü vermiyor; değer OBD köprüsünden geliyor.'
            : null,
    };
  });
}

/* ── 4. Hat bütçesi ────────────────────────────────────────────────────── */

export function buildWireBudgetLines(obs: WireBudgetObservation | null): readonly LabLine[] {
  if (obs === null) {
    return [{
      label: 'Hat bütçesi', value: 'UNAVAILABLE', verdict: 'UNAVAILABLE', note: null,
    }];
  }
  const lines: LabLine[] = [
    {
      label: 'Tele giden liste',
      value: `${obs.nativeListCount} PID`,
      verdict: 'OK',
      note: 'ELM327 hattının GERÇEK yükü. Native tur başına EN FAZLA 1 PID okur ' +
            '(round-robin, POLL_SLOW) — katalog 30 sinyal tanımlasa bile hat boğulmaz.',
    },
    {
      /* P0-OBD-CORE-06: "N PID destekli" cümlesi, zincir kırıldıysa bir TAVAN
         değil ALT SINIRDIR — bu ayırım olmadan LAB kanıtsız hüküm veriyordu. */
      label: 'Destek kanıtı',
      value: !obs.supportedKnown
        ? 'KANIT YOK'
        : obs.discoveryCompleteness === 'incomplete'
          ? `${obs.supportedCount} PID (EN AZ — keşif zinciri kırıldı)`
          : obs.discoveryCompleteness === 'complete'
            ? `${obs.supportedCount} PID destekli (kanıt TAM)`
            : `${obs.supportedCount} PID destekli (bütünlük ÖLÇÜLMEDİ)`,
      verdict: !obs.supportedKnown
        ? 'UNAVAILABLE'
        : obs.discoveryCompleteness === 'complete' ? 'OK' : 'WARN',
      note: !obs.supportedKnown
        ? "Keşif bitmap'i henüz okunmadı → kapı FAIL-CLOSED: izlenen PID'ler tele " +
          "GÖNDERİLMEZ. Bu doğru davranıştır (desteksiz sorgu ELM327'de ~200 ms bekletir)."
        : obs.discoveryCompleteness === 'incomplete'
          ? "Bitmap zinciri cevapsızlık/hata yüzünden KIRILDI: sorulmamış blokların " +
            "PID'leri BİLİNMİYOR — 'araç desteklemiyor' ÇIKARIMI YASAK. Sınırlı " +
            "yeniden keşif turu açılır (20 s + 60 s)."
          : null,
    },
    {
      label: 'İzlenen / bekleyen',
      value: `${obs.watchedCount} / ${obs.gatedCount}`,
      verdict: obs.gatedCount > 0 && obs.supportedKnown ? 'WARN' : 'OK',
      note: obs.gatedCount > 0
        ? 'Bekleyenler: kanıt yoksa kapı kapalı olduğu için, kanıt varsa araç ' +
          'desteklemediği için sorulmuyor. İkisi AYNI ŞEY DEĞİLDİR — üstteki ' +
          '"Destek kanıtı" satırı hangisi olduğunu söyler.'
        : null,
    },
  ];
  if (obs.discoveryPending > 0) {
    lines.push({
      label: 'Keşif', value: `${obs.discoveryPending} bitmask bekliyor`, verdict: 'OK',
      note: 'Kapıyı açacak olan iş sürüyor.',
    });
  }
  if (obs.burst) {
    lines.push({
      label: 'BURST modu', value: 'AÇIK', verdict: 'WARN',
      note: 'Canlı Test ekranı açık: tur başına TÜM izlenen liste okunuyor. ' +
            'Hat yükü normalin çok üstündedir; ekran kapanınca düşük-yük rotasyonuna döner.',
    });
  }
  return lines;
}

/* ── Genel hüküm ───────────────────────────────────────────────────────── */

/** En kötü hüküm kazanır; hiç satır yoksa `UNAVAILABLE`. */
export function overallVerdict(groups: readonly (readonly { verdict: LabVerdict }[])[]): LabVerdict {
  let worst: LabVerdict = 'UNAVAILABLE';
  let sawOk = false;
  for (const g of groups) {
    for (const l of g) {
      if (l.verdict === 'BAD') return 'BAD';
      if (l.verdict === 'WARN') worst = 'WARN';
      if (l.verdict === 'OK') sawOk = true;
    }
  }
  if (worst === 'WARN') return 'WARN';
  return sawOk ? 'OK' : 'UNAVAILABLE';
}
