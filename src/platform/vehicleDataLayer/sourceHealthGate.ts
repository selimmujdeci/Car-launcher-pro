/**
 * sourceHealthGate — kaynak sağlığı (SOURCE_HEALTH) için GÖRÜNÜRLÜK KAPISI.
 *
 * PROBLEM (cihazda gözlendi): worker'ın 1 Hz watchdog'u kaynak canlılığını
 * "monotonik saat − lastSeen < timeout" ile ölçer. O saat uygulama arka plandayken de
 * İLERLER; ama (a) WebView timer'ları kısılır/durur ve (b) CAN/OBD/GPS frame'leri gelmez.
 * Foreground dönüşündeki ilk tikte fark timeout'u KAT KAT aşar → kaynak sağlamken
 * "ölü" kararı üretilir (sahte disconnect + dönüşte true/false fırtınası).
 *
 * ÇÖZÜM (bu modül): sağlık kararı görünürlüğe bağlanır.
 *   - `hidden`  → sağlık GEÇİŞİ ÜRETİLMEZ (mevcut durum dondurulur; `lastSeen` BOZULMAZ).
 *   - `visible` dönüşü → sağlık timeout SAATİ yeniden tabanlanır: arka planda geçen süre
 *     timeout hesabına YAZILMAZ. Dönüşten sonra
 *       · taze frame gelirse            → normal karar (alive)
 *       · görünür süre timeout'u dolarsa → normal karar (dead) — gerçek kayıp MASKELENMEZ
 *       · henüz ikisi de değilse         → KARAR YOK (son bilinen değer korunur; yoksa unknown)
 *
 * SAF: timer/DOM/store/IO YOK — tüm zaman dışarıdan (`now`) verilir → deterministik test.
 * Yalnız SOURCE_HEALTH kararını etkiler; fusion/reverse/SAB davranışına DOKUNMAZ.
 */

export interface SourceHealthGate {
  /**
   * Görünürlük değişimi. Aynı durumun tekrarı NO-OP'tur (yeniden tabanlama YAPMAZ).
   * @returns durum gerçekten değiştiyse `true`
   */
  setVisible(visible: boolean, now: number): boolean;
  /** Ana thread bildirene kadar GÖRÜNÜR varsayılır (boot'ta davranış değişmez). */
  isVisible(): boolean;
  /**
   * Tek kaynak için sağlık kararı.
   * @param computed watchdog'un ham `_alive()` sonucu
   * @param prev     en son BİLDİRİLEN değer (`null` = hiç bildirilmedi)
   * @returns `boolean` = karar · `null` = KARAR VERİLEMEZ (çağıran POSTLAMAZ → unknown korunur)
   */
  decide(
    now: number,
    lastSeen: number,
    timeoutMs: number,
    computed: boolean,
    prev: boolean | null,
  ): boolean | null;
}

export function createSourceHealthGate(): SourceHealthGate {
  let _visible = true;      // worker boot'ta görünür varsayar → mevcut davranış korunur
  let _baselineAt = 0;      // 0 = yeniden tabanlama penceresi YOK (normal çalışma)

  return {
    setVisible(visible: boolean, now: number): boolean {
      if (visible === _visible) return false;          // duplicate → spam/rebaseline YOK
      _visible = visible;
      // YALNIZ foreground dönüşünde saat yeniden tabanlanır. Arka plana geçerken
      // hiçbir şey sıfırlanmaz (lastSeen'ler ve son bildirilen durum korunur).
      if (visible && Number.isFinite(now)) _baselineAt = now;
      return true;
    },

    isVisible(): boolean {
      return _visible;
    },

    decide(now, lastSeen, timeoutMs, computed, prev) {
      if (_baselineAt === 0) return computed;          // normal çalışma → ham karar
      if (lastSeen >= _baselineAt) return computed;    // dönüşten SONRA taze frame → karar geçerli
      if (computed) return computed;                   // hâlâ canlı görünüyor → sorun yok
      // "Ölü" kararı arka plandaki sessizliğe dayanıyor olabilir: görünür süre timeout'u
      // doldurmadıysa KARAR VERME (son bilinen değer korunur; yoksa `null` = unknown).
      if ((now - _baselineAt) < timeoutMs) return prev;
      return false;                                    // görünür zamanda GERÇEK timeout doldu
    },
  };
}
