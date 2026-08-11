/**
 * linkLossLedger.ts — BAĞLANTI KOPMASININ KANIT DEFTERİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Zaman ve girdiler dışarıdan verilir → cihazsız test edilebilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (GÖREV A · kütük #536) ──────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * SAHA (2026-08-11, Xiaomi 23090RA98I · commit ad2ac94) — bu koşumun en sert
 * bulgusu bağlantı kararsızlığıydı ve kullanıcının baştan beri söylediği
 * "veri kesiliyor, geri geliyor" ilk kez SAYILARLA kayıtlıydı:
 *
 *   reconnectHistoryCount : 8   (8'i de `timeout`)
 *   connectionQuality     : 57  (önceki koşum: 100)
 *   reconnectPressure     : 1.71 (önceki: 0.0019)
 *   trail: OBD:LinkLost — 47 s boyunca HİÇBİR paket (ATRV dahil)
 *   trail: HealthMonitor — "No heartbeat for 19-20 s" ×3
 *
 * ── AMA KÖK NEDEN BİLİNMİYOR ──────────────────────────────────────────────
 * Adaylar: (a) adaptörün kendi beslemesi/menzili · (b) RFCOMM soketinin
 * sessizce düşmesi · (c) ELM init/protokol açılışının bitmemesi · (d) araç
 * ECU'sunun uykuya geçmesi. **DÖRDÜ DE AYNI SAYIYI ÜRETİR** (`timeout`), bu
 * yüzden mevcut `reconnectHistory` kökü AYIRT EDEMEZ.
 *
 * KÖR DÜZELTME YASAK (devir belgesi §5 GÖREV A). Bu defterin işi bir sonraki
 * saha koşumunda kopmanın hangi imzayla geldiğini KAYDETMEKTİR — düzeltmek
 * değil. Bu yüzden burada eşik uygulanmaz, reconnect tetiklenmez, ETA/veri
 * yolu DEĞİŞTİRİLMEZ (vizyon §7.9 "sessiz kayıt" kovası).
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ──────────────────────────────────────────────────
 *  · Kanıt yetmiyorsa aday `UNKNOWN`tır. "Muhtemelen soket düştü" demek
 *    tam olarak kaçındığımız hatadır (bkz. #530'da çürütülen tahmin).
 *  · Ölçülemeyen alan `null` taşınır — sahte 0 / sahte voltaj YASAK.
 *  · Defter EKSİK KANITI DA SAYAR (`evidenceGap`): "neyi ölçemedik" sorusu
 *    bir sonraki turun iş listesidir. Kanıt boşluğu gizlenmez.
 *  · Kurtarma kanıtı GEÇ gelir (yeniden bağlanma başarısı). Kayıt o an
 *    KESKİNLEŞİR (`refinedCandidate`); kurtarma yoksa "kurtuldu" İDDİA EDİLMEZ.
 */

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const LINK_LOSS_RING = 24;

/**
 * Adaptör besleme çöküşü eşiği (V).
 *
 * ⚠️ `ENGINE_RUNNING_VOLTAGE_MIN` (13.0 V, `obdRetryPolicy`) ile AYNI ŞEY DEĞİL
 * ve onun yerine geçmez: o eşik "motor çalışıyor mu" sorusuna, bu eşik
 * "adaptörün KENDİ beslemesi çöktü mü" sorusuna bakar. ELM327 türevleri ~11 V
 * altında kendini sıfırlar → link o anda ölür. Aradaki bant (11.5–13.0 V)
 * "kontak kapalı / motor durmuş" bandıdır ve ECU uykusunu düşündürür.
 */
export const LINK_LOSS_BROWNOUT_V = 11.5;
/** Kontak/motor kapalı bandının üst sınırı — `obdRetryPolicy` eşiğiyle aynı sayı. */
export const LINK_LOSS_IGNITION_OFF_V = 13.0;

/**
 * ECU, link'ten bu kadar ÖNCE sustuysa sıra "önce ECU sustu, sonra link öldü"dür.
 * (Watchdog eşiği protokole göre 12–47 s arasında değiştiği için pencere ondan
 * belirgin biçimde büyük seçildi — aksi halde her kopma "ECU sustu" görünürdü.)
 */
export const LINK_LOSS_ECU_LEAD_MS = 30_000;

/** Bu süre içinde ve DÜŞEN DENEME OLMADAN geri gelen link "soket düştü" imzasıdır. */
export const LINK_LOSS_FAST_RECOVERY_MS = 15_000;
/** Bu süreden uzun kurtarma ya da ≥2 düşen deneme "adaptör erişilemez" imzasıdır. */
export const LINK_LOSS_SLOW_RECOVERY_MS = 60_000;
/** Aday "baskın" ilan edilebilmesi için gereken pay (etaJumpLedger ile aynı ilke). */
export const LINK_LOSS_DOMINANT_MIN_SHARE = 0.5;

/** Kaydı DOĞURAN olay — ölçülen olgudur, yorum DEĞİLDİR. */
export type LinkLossTrigger =
  /** Watchdog: HİÇBİR paket yok (ATRV dahil) → gerçek kopma. */
  | 'LINK_DEAD_WATCHDOG'
  /** Watchdog: link canlı (ATRV akıyor) ama ECU sustu → kopma DEĞİL. */
  | 'ECU_SILENT_WATCHDOG'
  /** Veri kapısı kaybı → reconnect istendi. */
  | 'DATA_GATE_LOSS'
  /** Bağlantı denemesi zaman aşımına uğradı. */
  | 'CONNECT_TIMEOUT'
  /** ELM "UNABLE TO CONNECT" — adaptör yanıt veriyor, ECU vermiyor. */
  | 'CONNECT_UNABLE'
  /** Bağlantı denemesi başka bir hatayla düştü. */
  | 'CONNECT_FAIL'
  /** Kullanıcı eylemi (kopma DEĞİL). */
  | 'USER';

export const LINK_LOSS_TRIGGER_LABEL: Readonly<Record<LinkLossTrigger, string>> = {
  LINK_DEAD_WATCHDOG:  'watchdog: hiç paket yok (ATRV dahil)',
  ECU_SILENT_WATCHDOG: 'watchdog: link canlı, ECU sustu',
  DATA_GATE_LOSS:      'veri kapısı kaybı',
  CONNECT_TIMEOUT:     'bağlantı denemesi zaman aşımı',
  CONNECT_UNABLE:      'ELM: UNABLE TO CONNECT',
  CONNECT_FAIL:        'bağlantı denemesi düştü (diğer)',
  USER:               'kullanıcı eylemi',
} as const;

/**
 * KÖK NEDEN ADAYI — hüküm değil, imza sınıfıdır.
 *
 * `UNKNOWN` bir başarısızlık değil, dürüst bir cevaptır: dört adayın imzası
 * bazı durumlarda BİREBİR aynıdır ve o durumda ayrım yapmak uydurmadır.
 */
export type LinkLossCandidate =
  /** Adaptör yanıt vermiyor: besleme kesildi · fiziksel çıkarıldı · menzil dışı. */
  | 'ADAPTER_UNREACHABLE'
  /** Soket sessizce düştü; adaptör ayakta (hızlı, denemesiz kurtarma kanıtı). */
  | 'RFCOMM_SOCKET_DROP'
  /** Soket açıldı ama ELM init / protokol açılışı bitmedi. */
  | 'ELM_INIT_INCOMPLETE'
  /** Adaptör canlı, ECU susmuş/uykuda (kontak kapalı olabilir). */
  | 'ECU_SILENT'
  /** Kullanıcı kapattı — arıza DEĞİL. */
  | 'USER_ACTION'
  /** Kanıt yetersiz — aday İDDİA EDİLMEZ. */
  | 'UNKNOWN';

export const LINK_LOSS_CANDIDATE_LABEL: Readonly<Record<LinkLossCandidate, string>> = {
  ADAPTER_UNREACHABLE: 'adaptör erişilemez (besleme/menzil/fiziksel)',
  RFCOMM_SOCKET_DROP:  'soket düştü (adaptör ayakta)',
  ELM_INIT_INCOMPLETE: 'ELM init / protokol açılışı bitmedi',
  ECU_SILENT:          'ECU susmuş / uykuda',
  USER_ACTION:         'kullanıcı eylemi (arıza değil)',
  UNKNOWN:             'kanıt yetersiz — aday iddia edilmiyor',
} as const;

/**
 * Kararı VEREMEDİĞİMİZ noktada eksik olan kanıt.
 *
 * Bu liste bir sonraki turun ENSTRÜMANTASYON İŞ LİSTESİDİR: en çok eksik olan
 * kanıt, ölçülmesi gereken ilk şeydir. (Devir §5 GÖREV A: "önce ölçüm".)
 */
export type LinkLossEvidenceGap =
  /** ATRV hiç okunmadı → besleme çöküşü ile soket düşüşü ayrılamaz. */
  | 'ADAPTER_VOLTAGE'
  /** Link paketi yaşı bilinmiyor. */
  | 'LINK_PACKET_AGE'
  /** ECU veri yaşı bilinmiyor → sıra (ECU mi link mi önce) kurulamaz. */
  | 'ECU_DATA_AGE'
  /** Timeout'un hangi aşamada olduğu bildirilmedi. */
  | 'TIMEOUT_STAGE'
  /** Kurtarma henüz olmadı → hız/deneme imzası okunamaz. */
  | 'RECOVERY'
  /** Native soket hata kodu JS'e açılmamış (repoda kaynak YOK). */
  | 'NATIVE_SOCKET_ERROR';

export const LINK_LOSS_GAP_LABEL: Readonly<Record<LinkLossEvidenceGap, string>> = {
  ADAPTER_VOLTAGE:     'adaptör voltajı (ATRV) okunmadı',
  LINK_PACKET_AGE:     'son link paketi yaşı yok',
  ECU_DATA_AGE:        'son ECU verisi yaşı yok',
  TIMEOUT_STAGE:       'timeout aşaması bildirilmedi',
  RECOVERY:            'kurtarma kanıtı henüz yok',
  NATIVE_SOCKET_ERROR: 'native soket hata kodu JS\'e açılmamış',
} as const;

/** Kopma anında ölçülen durum. Ölçülemeyen her alan `null` (sahte 0 YASAK). */
export interface LinkLossSample {
  /** Duvar saati damgası — yalnız gösterim/sıralama için. */
  readonly atMs: number;
  readonly trigger: LinkLossTrigger;
  /** Timeout aşaması (yalnız CONNECT_* olaylarında anlamlı). */
  readonly timeoutStage: 'transport' | 'connect' | 'pid0100' | 'mode0902' | null;
  /** Son HERHANGİ paketin (ATRV DAHİL) yaşı — link canlılığı. */
  readonly linkPacketAgeMs: number | null;
  /** Son GEÇERLİ ECU frame'inin (ATRV HARİÇ) yaşı. */
  readonly ecuDataAgeMs: number | null;
  /** Son okunan adaptör voltajı (V). `null` = ATRV hiç okunmadı. */
  readonly adapterVoltageV: number | null;
  /** Bu oturumda hiç ECU verisi aktı mı. */
  readonly everHadEcuData: boolean;
  /** Taşıma katmanı (classic/ble) — PII taşımaz. */
  readonly transport: string | null;
  /** Aktif protokol (ATDPN) — PII taşımaz. */
  readonly protocolActive: string | null;
}

export interface LinkLossRecord {
  readonly atMs: number;
  readonly trigger: LinkLossTrigger;
  /** Kopma ANINDAKİ kanıtla kurulan aday. */
  readonly candidate: LinkLossCandidate;
  /** Kurtarma kanıtıyla keskinleşen aday — kurtarma yoksa `candidate` ile AYNI. */
  readonly refinedCandidate: LinkLossCandidate;
  /** İnsan-okur tek cümle — LAB'da doğrudan gösterilir. */
  readonly note: string;
  /** Kararı engelleyen eksik kanıtlar (boş = kanıt tamdı). */
  readonly evidenceGap: readonly LinkLossEvidenceGap[];
  readonly linkPacketAgeMs: number | null;
  readonly ecuDataAgeMs: number | null;
  readonly adapterVoltageV: number | null;
  readonly timeoutStage: LinkLossSample['timeoutStage'];
  readonly transport: string | null;
  readonly protocolActive: string | null;
  /** Kopmadan başarılı handshake'e geçen süre (ms). `null` = HÂLÂ BEKLİYOR. */
  readonly recoveryMs: number | null;
  /** Kurtarmaya kadar düşen deneme sayısı. `null` = kurtarma yok. */
  readonly recoveryFailedAttempts: number | null;
}

/** Kurtarma kanıtı — başarılı handshake anında bilinir. */
export interface LinkLossRecovery {
  readonly recoveredAtMs: number;
  /** Kurtarmaya kadar DÜŞEN deneme sayısı (0 = ilk denemede toparladı). */
  readonly failedAttempts: number;
}

function _voltageBand(v: number | null): 'BROWNOUT' | 'IGNITION_OFF' | 'RUNNING' | 'UNKNOWN' {
  if (v === null || !Number.isFinite(v) || v <= 0) return 'UNKNOWN';
  if (v < LINK_LOSS_BROWNOUT_V)      return 'BROWNOUT';
  if (v < LINK_LOSS_IGNITION_OFF_V)  return 'IGNITION_OFF';
  return 'RUNNING';
}

/**
 * Kopma anındaki kanıttan aday üretir. Kanıt yetmezse `UNKNOWN` + boşluk listesi.
 *
 * ⚠️ Bu fonksiyon KARAR ÜRETMEZ: reconnect tetiklemez, eşik uygulamaz, veri
 * yolunu değiştirmez. Yalnız sınıflandırır.
 */
export function classifyLinkLoss(sample: LinkLossSample): LinkLossRecord {
  const gaps: LinkLossEvidenceGap[] = [];
  const band = _voltageBand(sample.adapterVoltageV);

  let candidate: LinkLossCandidate = 'UNKNOWN';
  let why = 'kanıt yetersiz';

  switch (sample.trigger) {
    case 'USER':
      candidate = 'USER_ACTION';
      why = 'kullanıcı kapattı';
      break;

    /* Link CANLI, ECU susmuş — bu bir kopma değil; adaptör suçsuz. */
    case 'ECU_SILENT_WATCHDOG':
      candidate = 'ECU_SILENT';
      why = band === 'IGNITION_OFF' || band === 'BROWNOUT'
        ? `ECU sustu, adaptör canlı · voltaj ${sample.adapterVoltageV} V (kontak kapalı olabilir)`
        : 'ECU sustu, adaptör canlı (ATRV akıyor)';
      break;

    /* Veri kapısı kaybı: adaptörle konuşuluyordu, ECU frame'i kesildi. */
    case 'DATA_GATE_LOSS':
      candidate = 'ECU_SILENT';
      why = 'veri kapısı kapandı — adaptör yanıt veriyordu, ECU frame\'i kesildi';
      break;

    /* ELM'in kendisi konuşuyor ("UNABLE TO CONNECT") → adaptör ayakta, ECU yok. */
    case 'CONNECT_UNABLE':
      candidate = 'ECU_SILENT';
      why = 'ELM yanıt verdi ama ECU\'ya bağlanamadı (kontak/uyku)';
      break;

    case 'CONNECT_TIMEOUT':
      switch (sample.timeoutStage) {
        case 'transport':
          candidate = 'ADAPTER_UNREACHABLE';
          why = 'soket AÇILAMADI (transport aşaması) — adaptör yanıt vermiyor';
          break;
        case 'connect':
          candidate = 'ELM_INIT_INCOMPLETE';
          why = 'soket açıldı, ELM init / protokol açılışı bitmedi';
          break;
        case 'pid0100':
          candidate = 'ECU_SILENT';
          why = 'zorunlu 0100 bitmap\'i yanıtsız — ECU susuyor';
          break;
        case 'mode0902':
          /* VIN timeout'u YAYGINDIR ve kopmayı AÇIKLAMAZ → aday iddia edilmez. */
          candidate = 'UNKNOWN';
          why = 'yalnız VIN (0902) aşamasında timeout — kopmayı açıklamaz';
          break;
        default:
          candidate = 'UNKNOWN';
          why = 'timeout aşaması bildirilmedi';
          gaps.push('TIMEOUT_STAGE');
          break;
      }
      break;

    case 'CONNECT_FAIL':
      /* Native hata sınıfı JS'e açılmamıştır → tahmin yapılmaz. */
      candidate = 'UNKNOWN';
      why = 'bağlantı düştü, hata sınıfı JS\'e açılmamış';
      gaps.push('NATIVE_SOCKET_ERROR');
      break;

    case 'LINK_DEAD_WATCHDOG': {
      const lead = (sample.ecuDataAgeMs !== null && sample.linkPacketAgeMs !== null)
        ? sample.ecuDataAgeMs - sample.linkPacketAgeMs
        : null;

      if (band === 'BROWNOUT') {
        candidate = 'ADAPTER_UNREACHABLE';
        why = `adaptör beslemesi çökmüş (${sample.adapterVoltageV} V < ${LINK_LOSS_BROWNOUT_V} V)`;
      } else if (lead !== null && lead > LINK_LOSS_ECU_LEAD_MS) {
        candidate = 'ECU_SILENT';
        why = `ECU link'ten ${Math.round(lead / 1000)} s ÖNCE susmuş — sıra ECU→link`;
      } else {
        /* AYRILAMAZ: adaptörün fişten çekilmesi de soketin düşmesi de AYNI ANDA
           her paketi kesir. Ayrım yalnız KURTARMA kanıtıyla yapılabilir. */
        candidate = 'UNKNOWN';
        why = 'tüm paketler AYNI ANDA kesildi — besleme ile soket imzası burada AYNI';
        gaps.push('RECOVERY');
        if (band === 'UNKNOWN') gaps.push('ADAPTER_VOLTAGE');
      }
      break;
    }
  }

  if (sample.linkPacketAgeMs === null) gaps.push('LINK_PACKET_AGE');
  if (sample.ecuDataAgeMs === null && sample.everHadEcuData) gaps.push('ECU_DATA_AGE');

  const uniqueGaps = gaps.filter((g, i) => gaps.indexOf(g) === i);
  const note = `${LINK_LOSS_TRIGGER_LABEL[sample.trigger]} → `
             + `${LINK_LOSS_CANDIDATE_LABEL[candidate]} · ${why}`;

  return {
    atMs: sample.atMs,
    trigger: sample.trigger,
    candidate,
    refinedCandidate: candidate,
    note,
    evidenceGap: uniqueGaps,
    linkPacketAgeMs: sample.linkPacketAgeMs,
    ecuDataAgeMs: sample.ecuDataAgeMs,
    adapterVoltageV: sample.adapterVoltageV,
    timeoutStage: sample.timeoutStage,
    transport: sample.transport,
    protocolActive: sample.protocolActive,
    recoveryMs: null,
    recoveryFailedAttempts: null,
  };
}

/**
 * Kurtarma kanıtını kayda işler ve ayırt EDİLEBİLİR hâle gelen adayı keskinleştirir.
 *
 * Yalnız `UNKNOWN` kalmış LINK_DEAD kayıtları keskinleşir; zaten kanıtı olan bir
 * aday kurtarma yüzünden DEĞİŞTİRİLMEZ (geriye dönük yeniden yorum yasağı).
 * Saat sıçramasında negatif süre çıkarsa `null` yazılır — uydurma YOK.
 */
export function attachRecovery(rec: LinkLossRecord, recovery: LinkLossRecovery): LinkLossRecord {
  const raw = recovery.recoveredAtMs - rec.atMs;
  const recoveryMs = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const attempts = Number.isFinite(recovery.failedAttempts) && recovery.failedAttempts >= 0
    ? Math.round(recovery.failedAttempts) : null;

  let refined = rec.refinedCandidate;
  let note = rec.note;

  if (rec.candidate === 'UNKNOWN' && rec.trigger === 'LINK_DEAD_WATCHDOG' && recoveryMs !== null) {
    if (attempts === 0 && recoveryMs <= LINK_LOSS_FAST_RECOVERY_MS) {
      refined = 'RFCOMM_SOCKET_DROP';
      note = `${rec.note} → KURTARMA: ${recoveryMs} ms, düşen deneme 0 `
           + `(adaptör ayaktaydı → soket düşüşü imzası)`;
    } else if ((attempts !== null && attempts >= 2) || recoveryMs > LINK_LOSS_SLOW_RECOVERY_MS) {
      refined = 'ADAPTER_UNREACHABLE';
      note = `${rec.note} → KURTARMA: ${recoveryMs} ms, düşen deneme ${attempts ?? '?'} `
           + `(adaptör bir süre erişilemezdi)`;
    } else {
      note = `${rec.note} → KURTARMA: ${recoveryMs} ms, düşen deneme ${attempts ?? '?'} `
           + `(imza hâlâ ayırt edici DEĞİL)`;
    }
  }

  /* Kurtarma geldi → `RECOVERY` boşluğu kapandı; diğer boşluklar korunur. */
  const gaps = recoveryMs !== null
    ? rec.evidenceGap.filter((g) => g !== 'RECOVERY')
    : rec.evidenceGap;

  return { ...rec, refinedCandidate: refined, note, evidenceGap: gaps, recoveryMs, recoveryFailedAttempts: attempts };
}

/** Bounded defter — en YENİ kayıtlar korunur. */
export function appendLinkLoss(
  ledger: readonly LinkLossRecord[], rec: LinkLossRecord,
): LinkLossRecord[] {
  const out = [...ledger, rec];
  return out.length > LINK_LOSS_RING ? out.slice(out.length - LINK_LOSS_RING) : out;
}

/**
 * Kurtarmayı BEKLEYEN en yeni kayda işler. Bekleyen yoksa defter DEĞİŞMEZ
 * (kurtarma kanıtı sahibi olmayan bir kayda yazılmaz).
 */
export function noteRecovery(
  ledger: readonly LinkLossRecord[], recovery: LinkLossRecovery,
): LinkLossRecord[] {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const rec = ledger[i];
    /* Kullanıcı eylemi bir arıza değildir → kurtarma kanıtı ona bağlanmaz. */
    if (rec.recoveryMs !== null || rec.trigger === 'USER') continue;
    const out = ledger.slice();
    out[i] = attachRecovery(rec, recovery);
    return out;
  }
  return ledger.slice();
}

export interface LinkLossSummary {
  readonly total: number;
  readonly byTrigger: Readonly<Record<LinkLossTrigger, number>>;
  /** Aday başına adet — `refinedCandidate` sayılır (kurtarma kanıtı dahil). */
  readonly byCandidate: Readonly<Record<LinkLossCandidate, number>>;
  /**
   * Baskın aday — **yalnız açık farkla öndeyse** bildirilir. `UNKNOWN` ve
   * `USER_ACTION` baskın SAYILMAZ: ilki kanıt yokluğu, ikincisi arıza değildir.
   */
  readonly dominant: LinkLossCandidate | null;
  /** Kurtarma kanıtı henüz gelmemiş kayıt sayısı. */
  readonly pendingRecoveryCount: number;
  /** Kanıt yetersizliğinden aday kurulamayan kayıt sayısı. */
  readonly unknownCount: number;
  readonly medianRecoveryMs: number | null;
  readonly maxRecoveryMs: number | null;
  /** Eksik kanıt sayacı — bir sonraki turun enstrümantasyon iş listesi. */
  readonly evidenceGapCounts: Readonly<Record<LinkLossEvidenceGap, number>>;
  /** En çok eksik olan kanıt → "önce bunu ölç". Kayıt/boşluk yoksa `null`. */
  readonly nextMeasurement: LinkLossEvidenceGap | null;
}

function _emptyTriggers(): Record<LinkLossTrigger, number> {
  return {
    LINK_DEAD_WATCHDOG: 0, ECU_SILENT_WATCHDOG: 0, DATA_GATE_LOSS: 0,
    CONNECT_TIMEOUT: 0, CONNECT_UNABLE: 0, CONNECT_FAIL: 0, USER: 0,
  };
}

function _emptyCandidates(): Record<LinkLossCandidate, number> {
  return {
    ADAPTER_UNREACHABLE: 0, RFCOMM_SOCKET_DROP: 0, ELM_INIT_INCOMPLETE: 0,
    ECU_SILENT: 0, USER_ACTION: 0, UNKNOWN: 0,
  };
}

function _emptyGaps(): Record<LinkLossEvidenceGap, number> {
  return {
    ADAPTER_VOLTAGE: 0, LINK_PACKET_AGE: 0, ECU_DATA_AGE: 0,
    TIMEOUT_STAGE: 0, RECOVERY: 0, NATIVE_SOCKET_ERROR: 0,
  };
}

function _median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarizeLinkLosses(ledger: readonly LinkLossRecord[]): LinkLossSummary {
  const byTrigger = _emptyTriggers();
  const byCandidate = _emptyCandidates();
  const evidenceGapCounts = _emptyGaps();
  const recoveries: number[] = [];
  let pendingRecoveryCount = 0;

  for (const r of ledger) {
    byTrigger[r.trigger] += 1;
    byCandidate[r.refinedCandidate] += 1;
    for (const g of r.evidenceGap) evidenceGapCounts[g] += 1;
    if (r.recoveryMs === null) {
      if (r.trigger !== 'USER') pendingRecoveryCount += 1;
    } else {
      recoveries.push(r.recoveryMs);
    }
  }

  /* Baskınlık: pay eşiği VE ikinciden açık fark (etaJumpLedger ile aynı ilke).
     `UNKNOWN`/`USER_ACTION` yarışa GİRMEZ — biri kanıt yokluğu, öteki arıza değil. */
  const contenders = (Object.keys(byCandidate) as LinkLossCandidate[])
    .filter((k) => k !== 'UNKNOWN' && k !== 'USER_ACTION')
    .map((k) => [k, byCandidate[k]] as const)
    .sort((a, b) => b[1] - a[1]);
  let dominant: LinkLossCandidate | null = null;
  if (ledger.length > 0 && contenders.length > 0 && contenders[0][1] > 0) {
    const share = contenders[0][1] / ledger.length;
    const clearLead = contenders.length < 2 || contenders[0][1] > contenders[1][1];
    if (share >= LINK_LOSS_DOMINANT_MIN_SHARE && clearLead) dominant = contenders[0][0];
  }

  const gapRank = (Object.keys(evidenceGapCounts) as LinkLossEvidenceGap[])
    .map((k) => [k, evidenceGapCounts[k]] as const)
    .sort((a, b) => b[1] - a[1]);
  const nextMeasurement = gapRank.length > 0 && gapRank[0][1] > 0 ? gapRank[0][0] : null;

  return {
    total: ledger.length,
    byTrigger,
    byCandidate,
    dominant,
    pendingRecoveryCount,
    unknownCount: byCandidate.UNKNOWN,
    medianRecoveryMs: _median(recoveries),
    maxRecoveryMs: recoveries.length > 0 ? Math.max(...recoveries) : null,
    evidenceGapCounts,
    nextMeasurement,
  };
}
