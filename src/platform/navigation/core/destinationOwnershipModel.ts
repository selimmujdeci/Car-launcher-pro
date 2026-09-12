/**
 * destinationOwnershipModel — AKTİF HEDEFİN SAHİPLİĞİ (saha 2026-08-05 · kütük #429).
 *
 * SAHADA YAŞANAN: Kullanıcı sabah **Tarsus, Mersin (289 km)** hedefiyle yola çıktı.
 * Yol ortasında, **hiçbir kullanıcı eylemi olmadan**, rota kartı **"Konya, İç Anadolu
 * Bölgesi"**ne — yani aracın ARKASINDAKİ başlangıç şehrine — döndü. OSRM sürücüyü
 * doğal olarak geri çevirmeye çalıştı: ekranda "300 m sonra U dönüşü yapın", ardından
 * "30 m sonra sağa dönün"; harita rotası "7" gibi geri kıvrıldı. Otoyolda U dönüşü
 * fiziksel olarak imkânsız olduğu için talimatlar "saçma" göründü — kullanıcının
 * *"dönemeç olmayan yerde sola dönün diyor"* şikâyetinin kökü buydu.
 * Hedef elle yeniden Tarsus seçilince rota düzeldi.
 *
 * KİMİN DEĞİŞTİRDİĞİ BİLİNMİYOR — çünkü hedef değişiminin KAYDI YOKTU.
 * Bu model iki şeyi birden yapar:
 *   1. Değişimi KAYDEDER (bir dahaki sefere fail eden yol kanıtlanabilir olsun),
 *   2. Sahipsiz değişimi ENGELLER (kanıt beklerken sürücü yanlış yöne sürülmesin).
 *
 * İLKE: Aktif bir hedef varken, o hedefi YALNIZ KULLANICI değiştirebilir.
 * Sistem kaynaklı bir "hedef değişimi" bir hata belirtisidir, bir özellik değil.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok (zaman dışarıdan) · React yok.
 */

/** Hedefi kimin belirlediği. Kanıtsız çağrı YOKTUR — her çağıran kendini bildirir. */
export type DestinationSource =
  | 'USER_SEARCH'        // arama çubuğundan seçim
  | 'USER_MAP'           // haritada uzun basış
  | 'USER_VOICE'         // sesli komut / Mavi
  | 'USER_QUICK'         // ev/iş/benzinlik gibi hızlı hedefler
  /**
   * Kullanıcının BAŞKA BİR YÜZEYDEN araca devrettiği hedef: telefondaki
   * "Arabam Cebimde" uygulamasından "Araca Gönder" ya da WhatsApp/harita
   * uygulamasından gelen `geo:` paylaşımı.
   *
   * NEDEN KULLANICI KAYNAĞI: bu hedefi bir insan seçip GÖNDERDİ — sistemin
   * kendi türettiği bir hedef değil. `SYSTEM` sayılsaydı aktif oturum sürerken
   * SESSİZCE engellenirdi (`UNOWNED_CHANGE_DURING_SESSION`): kullanıcı telefondan
   * rota gönderir, araçta hiçbir şey olmazdı.
   *
   * NEDEN AYRI DEĞER: `USER_SEARCH`e katsaydık defterde hedefin araç dışından
   * geldiği kaybolurdu — sahada "bu rotayı kim koydu" sorusunun tek yanıtı budur.
   */
  | 'USER_HANDOFF'
  | 'SESSION_RESTORE'    // çökme/yeniden başlatma sonrası aynı yolculuğun devamı
  | 'SYSTEM';            // yukarıdakilerin hiçbiri — sahipsiz

export type DestinationDecision = 'ALLOW' | 'BLOCK';

export interface DestinationRef {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface DestinationChange {
  readonly tsMs: number;
  readonly source: DestinationSource;
  readonly decision: DestinationDecision;
  readonly fromName: string | null;
  readonly toName: string;
  /** Yeni hedef eskisinden bu kadar metre uzakta (aynı hedefin tazelenmesi mi?). */
  readonly distanceM: number | null;
}

/** Kullanıcı iradesi taşıyan kaynaklar. */
const USER_SOURCES: ReadonlySet<DestinationSource> = new Set([
  'USER_SEARCH', 'USER_MAP', 'USER_VOICE', 'USER_QUICK', 'USER_HANDOFF',
]);

export function isUserSource(s: DestinationSource): boolean {
  return USER_SOURCES.has(s);
}

/**
 * Aynı hedefin yeniden yazılması sayılacağı yarıçap (m).
 * Geocoder aynı yeri birkaç metre farkla döndürebilir; bu bir "hedef değişimi"
 * değildir ve engellenmemelidir.
 */
export const SAME_DESTINATION_RADIUS_M = 150;

function _haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface OwnershipInput {
  /** Şu an aktif hedef; yoksa null (ilk hedef her kaynaktan konabilir). */
  readonly current: DestinationRef | null;
  /** Navigasyon oturumu sürüyor mu (PREVIEW dâhil). */
  readonly sessionActive: boolean;
  readonly next: DestinationRef;
  readonly source: DestinationSource;
  readonly tsMs: number;
}

export interface OwnershipVerdict {
  readonly decision: DestinationDecision;
  readonly change: DestinationChange;
  /** BLOCK ise sürücüye/gözlem katmanına verilecek kısa sebep. */
  readonly reason:
    | 'FIRST_DESTINATION'
    | 'USER_ACTION'
    | 'SAME_DESTINATION'
    | 'NO_ACTIVE_SESSION'
    | 'UNOWNED_CHANGE_DURING_SESSION';
}

/**
 * Hedef değişimine izin verilir mi?
 *
 * ENGELLENEN TEK DURUM: aktif oturum sürerken, kullanıcı iradesi olmayan bir
 * kaynağın hedefi BAŞKA bir yere taşıması. Diğer her şey serbesttir — kapı
 * dar tutuldu ki mevcut akışların hiçbiri kırılmasın.
 */
export function judgeDestinationChange(i: OwnershipInput): OwnershipVerdict {
  const distanceM = i.current
    ? _haversineM(i.current.latitude, i.current.longitude, i.next.latitude, i.next.longitude)
    : null;

  const mk = (decision: DestinationDecision, reason: OwnershipVerdict['reason']): OwnershipVerdict => ({
    decision,
    reason,
    change: {
      tsMs: i.tsMs,
      source: i.source,
      decision,
      fromName: i.current?.name ?? null,
      toName: i.next.name,
      distanceM,
    },
  });

  if (!i.current)                              return mk('ALLOW', 'FIRST_DESTINATION');
  if (distanceM != null && distanceM <= SAME_DESTINATION_RADIUS_M)
                                               return mk('ALLOW', 'SAME_DESTINATION');
  if (isUserSource(i.source))                  return mk('ALLOW', 'USER_ACTION');
  if (!i.sessionActive)                        return mk('ALLOW', 'NO_ACTIVE_SESSION');
  // Oturum sürerken sahipsiz değişim: sahada aracı geri çeviren tam olarak buydu.
  return mk('BLOCK', 'UNOWNED_CHANGE_DURING_SESSION');
}

/* ── Değişim defteri (oturum içi, salt-okunur dışarıya) ────────────────────── */

const MAX_HISTORY = 24;
const _history: DestinationChange[] = [];
let _blockedCount = 0;

export function recordDestinationChange(c: DestinationChange): void {
  _history.push(c);
  if (_history.length > MAX_HISTORY) _history.shift();
  if (c.decision === 'BLOCK') _blockedCount++;
}

export function getDestinationChangeLog(): {
  history: readonly DestinationChange[];
  blockedCount: number;
  lastChange: DestinationChange | null;
} {
  return {
    history: _history.slice(),
    blockedCount: _blockedCount,
    lastChange: _history.length > 0 ? _history[_history.length - 1]! : null,
  };
}

export function resetDestinationChangeLog(): void {
  _history.length = 0;
  _blockedCount = 0;
}
