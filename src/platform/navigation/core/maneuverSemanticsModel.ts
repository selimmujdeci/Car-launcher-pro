/**
 * maneuverSemanticsModel — MANEVRANIN ANLAMI (SAF · P0-NAV-15).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-15 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `routingService.toTR()` manevrayı Türkçeye çeviren TEK yerdi ve `depart` ·
 * `arrive` · `roundabout` · `rotary` · `end of road` · `uturn` tiplerini DOĞRU
 * ele alıyordu. Ama **tip listesi eksikti** ve eksik tipler sessizce
 * DEĞİŞTİRİCİYE (modifier) düşüyordu:
 *
 *     if (mod === 'right') return 'Sağa dönün';   // ← her tip buraya düşer
 *
 * Ölçüm: **`merge` · `fork` · `on ramp` · `off ramp` ürün kodunun HİÇBİR
 * YERİNDE geçmiyordu.** OSRM bu tipleri ÜRETİR. Sonuç:
 *
 *   · Otoyol birleşmesi (`merge` + `right`)   → **"Sağa dönün"**
 *   · Yol ayrımı        (`fork` + `left`)     → **"Sola dönün"**
 *   · Otoyol çıkışı     (`off ramp` + `right`)→ **"Sağa dönün"**
 *
 * Bunlar DÖNÜŞ DEĞİLDİR. 120 km/h'te otoyolda giden sürücüye "sağa dönün"
 * demek yalnız yanlış değil, TEHLİKELİDİR: sürücü bir kavşak arar, bulamaz,
 * talimatı "saçma" sayar ve bir sonrakine de güvenmez. Kullanıcının
 * *"dönemeç olmayan yerde sola dönün diyor"* şikâyetiyle AYNI sınıf.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · UYDURMA DÖNÜŞ YASAK: tanınmayan tip/değiştirici bir YÖNE çevrilmez;
 *    `UNKNOWN` sınıfı yalnız nötr "Devam edin" üretir.
 *  · MEVCUT ÇIKTILAR KORUNUR: `toTR`in bugüne kadar ürettiği her doğru cümle
 *    BİREBİR aynı kalır (kilitli testler bunu denetler) — bu modül yalnız
 *    EKSİK sınıfları ekler.
 *  · Kanıt yoksa sayı uydurulmaz (dönel kavşak çıkış numarası kuralı aynen).
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) ANLAM SINIFLARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Manevranın NE OLDUĞU — sürücünün yapacağı eylemin sınıfı.
 *
 * `TURN` ile `MERGE`/`FORK`/`RAMP_*` arasındaki fark ürün açısından
 * KRİTİKTİR: birincisi direksiyon çevirmek, ötekiler ŞERİT SEÇMEKTİR.
 */
export type ManeuverKind =
  | 'DEPART'
  | 'ARRIVE'
  | 'TURN'
  | 'UTURN'
  | 'ROUNDABOUT'
  | 'ROUNDABOUT_EXIT'
  | 'END_OF_ROAD'
  /** Otoyola/ana yola KATILMA — dönüş DEĞİL, şerit birleştirme. */
  | 'MERGE'
  /** Yol İKİYE AYRILIYOR — dönüş DEĞİL, taraf seçme. */
  | 'FORK'
  /** Bağlantı yoluna GİRİŞ (otoyola çıkış rampası). */
  | 'RAMP_ON'
  /** Bağlantı yolundan ÇIKIŞ (otoyoldan ayrılma). */
  | 'RAMP_OFF'
  /** Aynı yolda devam (isim değişimi dâhil). */
  | 'CONTINUE'
  /** Sağlayıcı tanınmayan bir şey gönderdi — YÖNE ÇEVRİLMEZ. */
  | 'UNKNOWN';

export type ManeuverSide = 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'UNKNOWN';

/** Yönün ne kadar keskin olduğu — yalnız `TURN` için anlamlı. */
export type ManeuverSharpness = 'SHARP' | 'NORMAL' | 'SLIGHT' | 'NONE';

export interface ManeuverSemantics {
  readonly kind: ManeuverKind;
  readonly side: ManeuverSide;
  readonly sharpness: ManeuverSharpness;
  /**
   * Sağlayıcının gönderdiği tip TANINDI mı. `false` ise ürün bir yön
   * İDDİA ETMEZ — bu, "uydurma dönüş yasağı"nın ölçülebilir hâlidir.
   */
  readonly recognized: boolean;
}

/* ── Değiştirici (modifier) çözümleme ────────────────────────────────────── */

function _side(mod: string): ManeuverSide {
  if (mod === 'right' || mod === 'slight right' || mod === 'sharp right') return 'RIGHT';
  if (mod === 'left'  || mod === 'slight left'  || mod === 'sharp left')  return 'LEFT';
  if (mod === 'straight') return 'STRAIGHT';
  return 'UNKNOWN';
}

function _sharpness(mod: string): ManeuverSharpness {
  if (mod === 'sharp right' || mod === 'sharp left')   return 'SHARP';
  if (mod === 'slight right' || mod === 'slight left') return 'SLIGHT';
  if (mod === 'right' || mod === 'left')               return 'NORMAL';
  return 'NONE';
}

/** OSRM tipleri — sözlük SABİTTİR, kullanıcı metni buraya GİRMEZ. */
const _KIND_BY_TYPE: Readonly<Record<string, ManeuverKind>> = {
  'depart':            'DEPART',
  'arrive':            'ARRIVE',
  'roundabout':        'ROUNDABOUT',
  'rotary':            'ROUNDABOUT',
  'roundabout turn':   'ROUNDABOUT',
  'exit roundabout':   'ROUNDABOUT_EXIT',
  'exit rotary':       'ROUNDABOUT_EXIT',
  'end of road':       'END_OF_ROAD',
  /* ── P0-NAV-15'te EKLENEN sınıflar — eskiden hepsi "dönüş" oluyordu ───── */
  'merge':             'MERGE',
  'fork':              'FORK',
  'on ramp':           'RAMP_ON',
  'off ramp':          'RAMP_OFF',
  'ramp':              'RAMP_ON',
  'turn':              'TURN',
  'continue':          'CONTINUE',
  'new name':          'CONTINUE',
  'notification':      'CONTINUE',
  'use lane':          'CONTINUE',
};

/**
 * Sağlayıcı manevrasını ANLAM sınıfına çevirir. **SAF.**
 *
 * Tanınmayan tip `UNKNOWN`dır ve **yön iddiası taşımaz** — `toTR`in eski
 * davranışında böyle bir tip sessizce değiştiriciye düşüp "Sağa dönün"e
 * dönüşebiliyordu.
 */
export function classifyManeuver(
  type: unknown, modifier: unknown,
): ManeuverSemantics {
  const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
  const m = typeof modifier === 'string' ? modifier.trim().toLowerCase() : '';

  /* U dönüşü tipten DEĞİL değiştiriciden gelir (OSRM sözleşmesi) ve her
     tipin üstünde önceliklidir — geriye dönmek her bağlamda U dönüşüdür. */
  if (m === 'uturn') {
    return { kind: 'UTURN', side: 'UNKNOWN', sharpness: 'NONE', recognized: true };
  }

  const known = _KIND_BY_TYPE[t];
  if (known !== undefined) {
    return {
      kind: known,
      side: _side(m),
      sharpness: known === 'TURN' ? _sharpness(m) : 'NONE',
      recognized: true,
    };
  }

  /* ── UYDURMA DÖNÜŞ YASAĞI ────────────────────────────────────────────────
     Tip tanınmadı. Değiştirici "right" olsa BİLE bunu bir DÖNÜŞE çevirmek,
     sağlayıcının söylemediği bir şeyi sürücüye söylemektir. Taraf bilgisi
     TAŞINIR (şerit ipucu olarak değerlidir) ama sınıf `UNKNOWN` kalır ve
     cümle nötr üretilir. */
  return {
    kind: 'UNKNOWN',
    side: _side(m),
    sharpness: 'NONE',
    recognized: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) TÜRKÇE CÜMLE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Dönel kavşak çıkışının Türkçe sıralaması.
 * KANIT YOKSA sayı UYDURULMAZ — genel ifade kullanılır (mevcut kural).
 */
const _EXIT_ORDINAL: Readonly<Record<number, string>> = {
  1: 'birinci', 2: 'ikinci', 3: 'üçüncü', 4: 'dördüncü',
  5: 'beşinci', 6: 'altıncı', 7: 'yedinci', 8: 'sekizinci',
};

const _TURN_TEXT: Readonly<Record<string, string>> = {
  'RIGHT|SHARP':   'Sert sağa dönün',
  'RIGHT|NORMAL':  'Sağa dönün',
  'RIGHT|SLIGHT':  'Hafif sağa dönün',
  'LEFT|SHARP':    'Sert sola dönün',
  'LEFT|NORMAL':   'Sola dönün',
  'LEFT|SLIGHT':   'Hafif sola dönün',
  'STRAIGHT|NONE': 'Düz devam edin',
};

/** Taraf sözcüğü — bilinmiyorsa `null` (uydurma taraf YASAK). */
function _sideWord(side: ManeuverSide): string | null {
  if (side === 'RIGHT') return 'sağ';
  if (side === 'LEFT')  return 'sol';
  return null;
}

/**
 * Anlam sınıfından Türkçe talimat üretir. **SAF.**
 *
 * ⚠️ MEVCUT ÇIKTILAR BİREBİR KORUNUR: `toTR`in ürettiği her doğru cümle
 * (kilitli testler dâhil) aynen çıkar. Yeni sınıflar YALNIZ eskiden yanlış
 * çevrilen tipleri düzeltir.
 *
 * @param name Yol adı; boşsa parantez EKLENMEZ.
 * @param exit Dönel kavşak çıkış numarası; yoksa sayı UYDURULMAZ.
 */
export function maneuverInstructionTr(
  sem: ManeuverSemantics, name: string, exit?: number | null,
): string {
  const s = name ? ` (${name})` : '';

  switch (sem.kind) {
    case 'DEPART':  return `Yola çıkın${s}`;
    case 'ARRIVE':  return 'Hedefinize ulaştınız';
    case 'UTURN':   return 'U dönüşü yapın';

    case 'ROUNDABOUT': {
      const ord = exit != null && Number.isFinite(exit) ? _EXIT_ORDINAL[exit] : undefined;
      return ord
        ? `Dönel kavşakta ${ord} çıkıştan ayrılın${s}`
        : 'Dönel kavşakta devam edin';
    }
    case 'ROUNDABOUT_EXIT': return `Dönel kavşaktan çıkın${s}`;
    case 'END_OF_ROAD':     return 'Yol sonunda dönün';

    /* ── P0-NAV-15'te DÜZELTİLEN sınıflar ────────────────────────────────
       Hiçbiri "dönün" DEMEZ: bunlar direksiyon çevirmek değil ŞERİT SEÇMEKTİR. */
    case 'MERGE': {
      const w = _sideWord(sem.side);
      return w ? `${w === 'sağ' ? 'Sağdan' : 'Soldan'} katılın${s}` : `Yola katılın${s}`;
    }
    case 'FORK': {
      const w = _sideWord(sem.side);
      return w ? `${w === 'sağ' ? 'Sağdaki' : 'Soldaki'} yola devam edin${s}` : `Yol ayrımında devam edin${s}`;
    }
    case 'RAMP_ON': {
      const w = _sideWord(sem.side);
      return w ? `${w === 'sağ' ? 'Sağdaki' : 'Soldaki'} bağlantı yoluna girin${s}` : `Bağlantı yoluna girin${s}`;
    }
    case 'RAMP_OFF': {
      const w = _sideWord(sem.side);
      return w ? `${w === 'sağ' ? 'Sağdaki' : 'Soldaki'} çıkışı kullanın${s}` : `Çıkışı kullanın${s}`;
    }

    case 'TURN': {
      const key = `${sem.side}|${sem.sharpness}`;
      const txt = _TURN_TEXT[key];
      /* Taraf bilinmiyorsa DÖNÜŞ CÜMLESİ KURULMAZ — nötr devam. */
      return txt !== undefined ? `${txt}${s}` : `Devam edin${s}`;
    }

    case 'CONTINUE': {
      /* Aynı yolda devam: değiştirici bir DÖNÜŞ değil, yolun kıvrımıdır. */
      if (sem.side === 'STRAIGHT') return `Düz devam edin${s}`;
      return `Devam edin${s}`;
    }

    case 'UNKNOWN':
    default:
      /* UYDURMA DÖNÜŞ YASAĞI: tanınmayan tip nötr cümle alır. */
      return `Devam edin${s}`;
  }
}

/**
 * Tek adımda: sağlayıcı tip/değiştiricisinden Türkçe talimat. **SAF.**
 * `routingService.toTR` bunun ince bir sarmalayıcısıdır (tek çeviri otoritesi).
 */
export function maneuverToTr(
  type: string, modifier: string, name: string, exit?: number | null,
): string {
  return maneuverInstructionTr(classifyManeuver(type, modifier), name, exit);
}
