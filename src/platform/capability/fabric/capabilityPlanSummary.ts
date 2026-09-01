/**
 * capabilityPlanSummary.ts — **MAVİ F6 · GÖZLEME DAYALI BİRLEŞİK SONUÇ METNİ.**
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * Bileşik bir planda kullanıcıya söylenecek TEK cümle, adımların **gerçek
 * gözlemlerinden** üretilmelidir. "Hepsini yaptım" demek kolaydır; F6'nın kuralı
 * **sahte toplu başarının yasak** olmasıdır:
 *
 *   "Rotayı açtım ve müziği başlattım; aramayı başlatamadım."
 *
 * ── FİİL SEÇİMİ DÜRÜSTLÜK KARARIDIR ────────────────────────────────────────
 * Gözlem seviyesi cümlenin fiilini belirler ve **iki iddia birbirine
 * KARIŞTIRILMAZ**:
 *   · `OBSERVED` / `EXECUTED` → "…açtım / …okudum"  (kanıtlı)
 *   · `ACCEPTED`              → "…başlattım"        (teslim edildi, DOĞRULANMADI)
 *   · `FAILED`                → "…başlatamadım"
 *   · `CANCELLED`             → "…yapmadım"
 *   · `REQUESTED`             → "…onayını bekliyorum"
 * `ACCEPTED` için "yaptım/doğruladım" ASLA kullanılmaz — o yolda başarıyı
 * kanıtlayan bir gözlem yoktur (bkz. `observationCeiling`).
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** yalnız tip import eder; I/O · timer · `Date.now` · global durum YOK.
 *  · **PARAMETRE DEĞERİ METNE GİRMEZ.** "Ahmet'i aradım" DEĞİL "aramayı
 *    başlattım" denir — kişi adı, adres, sensör metni bu katmandan geçmez
 *    (gizlilik sınırı metin üretiminde de korunur).
 *  · **F2 KORUNUR:** bu katman ARA SÖZ üretmez; yalnız BİTMİŞ işin sonucunu
 *    anlatır.
 */

import type { CapabilityObservation } from './capabilityContract';
import type { CapabilityPlan, PlanItem, PlanResultClass } from './capabilityPlan';

/**
 * İşlem → kısa Türkçe ad. **Parametre değeri İÇERMEZ** (bilinçli): kişi adı ve
 * adres gibi veriler sonuç cümlesine taşınmaz. Katalogdaki HER işlemin burada
 * karşılığı olmalıdır — eksik kalırsa kilit testi düşer.
 */
const ITEM_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'navigation.route#start': 'rotayı',
  'navigation.route#startAddress': 'rotayı',
  'navigation.poi#search': 'aramayı',
  'navigation.poi#findGasStation': 'benzinlik aramasını',
  'navigation.poi#findParking': 'otopark aramasını',
  'navigation.poi#findRestArea': 'dinlenme tesisi aramasını',
  'media.playback#searchAndPlay': 'müziği',
  'media.playback#resume': 'çalmayı',
  'media.playback#pause': 'duraklatmayı',
  'media.playback#next': 'sonraki parçayı',
  'media.playback#previous': 'önceki parçayı',
  'media.volume#increase': 'ses artırmayı',
  'media.volume#decrease': 'ses azaltmayı',
  'media.app#open': 'müzik çaları',
  'settings.value#set': 'ayarı',
  'settings.theme#cycle': 'tema değişimini',
  'settings.theme#enableNightMode': 'gece modunu',
  'settings.surface#open': 'ayarları',
  'vehicle.sensor#query': 'sensör okumasını',
  'vehicle.health#check': 'araç sağlığını',
  'vehicle.maintenance#check': 'bakım kontrolünü',
  'diagnostics.dtc#clear': 'arıza kaydı silmeyi',
  'phone.call#start': 'aramayı',
  'surface.app#open': 'uygulamayı',
  'surface.screen#open': 'ekranı',
  'surface.favorites#open': 'favorileri',
});

export function labelOf(item: Pick<PlanItem, 'capabilityId' | 'operation'>): string {
  return ITEM_LABEL[`${item.capabilityId}#${item.operation}`] ?? 'işlemi';
}

/** Gözlem seviyesine göre DÜRÜST fiil. */
function verbFor(o: CapabilityObservation): string | null {
  switch (o) {
    case 'OBSERVED':
    case 'EXECUTED':  return 'açtım';
    case 'ACCEPTED':  return 'başlattım';
    case 'FAILED':    return 'başlatamadım';
    case 'CANCELLED': return 'yapmadım';
    case 'REQUESTED': return 'onayını bekliyorum';
    default:          return null;      // UNKNOWN → iddia ÜRETİLMEZ
  }
}

/** Aynı fiili paylaşan adımları tek öbekte toplar (sıra korunur). */
function groupByVerb(items: readonly PlanItem[]): (readonly [string, string[]])[] {
  const order: string[] = [];
  const acc = new Map<string, string[]>();
  for (const i of items) {
    const v = verbFor(i.observationState);
    if (v === null) continue;
    if (!acc.has(v)) { acc.set(v, []); order.push(v); }
    acc.get(v)!.push(labelOf(i));
  }
  return order.map((v) => [v, acc.get(v)!] as const);
}

function joinTr(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} ve ${parts[parts.length - 1]}`;
}

/**
 * Plandan **tek** ve dürüst sonuç cümlesi üretir.
 *
 * Boş dönerse çağıran kendi kanonik cevabını kullanır — bu katman
 * "söyleyecek bir şey yoksa" cümle UYDURMAZ.
 */
export function renderPlanOutcome(plan: CapabilityPlan): string {
  if (plan.refusalReason === 'multiple_confirmation_required_items') {
    /* P1 politikasıyla AYNI karar: belirsiz rızada hiçbir şey yapılmaz. */
    return 'Aynı anda birden fazla onay gerektiren işlemi yapamam. Lütfen tek tek söyle.';
  }

  const live = plan.items.filter((i) => i.executionState !== 'SUPPRESSED');
  if (live.length === 0) return '';

  const groups = groupByVerb(live);
  if (groups.length === 0) return '';

  /* Olumlu öbekler önce, olumsuzlar noktalı virgülden sonra — kullanıcı önce
     ne OLDUĞUNU, sonra ne OLMADIĞINI duyar. */
  const positive = groups.filter(([v]) => v === 'açtım' || v === 'başlattım');
  const negative = groups.filter(([v]) => v !== 'açtım' && v !== 'başlattım');

  const say = (g: readonly (readonly [string, string[]])[]): string =>
    g.map(([verb, labels]) => `${joinTr(labels)} ${verb}`).join(', ');

  const head = say(positive);
  const tail = say(negative);
  if (head && tail) return `${capitalize(head)}; ${tail}.`;
  if (head) return `${capitalize(head)}.`;
  return `${capitalize(tail)}.`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toLocaleUpperCase('tr-TR') + s.slice(1);
}

/** Sonuç sınıfının insan-okur etiketi (LAB/tanı — kullanıcıya söylenmez). */
export const PLAN_RESULT_LABEL: Readonly<Record<PlanResultClass, string>> = Object.freeze({
  ALL_SUCCEEDED: 'tümü başarılı',
  PARTIAL: 'kısmen başarılı',
  ALL_FAILED: 'tümü başarısız',
  AWAITING_CONFIRMATION: 'onay bekliyor',
  CANCELLED: 'iptal edildi',
  EMPTY: 'adım yok',
  REFUSED: 'politika reddi',
});
