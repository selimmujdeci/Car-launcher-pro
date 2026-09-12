/**
 * hudOverlayAnchors.test.ts — KİLİT: yüzen katmanların ÇAPALARI çakışmasın.
 *
 * ── NEDEN BU DOSYA VAR (kütük #605, gerçek tarayıcıda ölçüldü 2026-08-16) ──
 *
 * Saha koşumunda (#598-E) dört "görsel çakışma" bildirilmişti. Hepsi
 * Playwright + gerçek Chromium ile, **kırpma ve görünürlük farkındalıklı**
 * kutu ölçümüyle dört viewport'ta yeniden ölçüldü
 * (904×406@dpr3 · 406×904@dpr3 · 1024×600@dpr1 · 1280×480@dpr1.5):
 *
 *   P2-1 SAHA TESTİ rozeti ↔ CAROS marka mührü   → **GERÇEK** (3/3 çözünürlük)
 *   P2-2 YOL/HİBRİT/UYDU düğmeleri               → **YOK** (ölçüm artefaktı)
 *   P2-3 ÖZEL KONUMLAR üstündeki "sahipsiz kare" → **GERÇEK** (3/3 çözünürlük)
 *   P2-4 alt bar etiketleri (Bildirim↔Klima)     → **YOK** (ölçüm artefaktı)
 *
 * P2-2/P2-4 neden artefakt: saha ölçümü ham `getBoundingClientRect()`
 * kullanıyordu. O kutu (a) `overflow` kabı içinde KAYDIRILMIŞ düğmeleri
 * kırpılmamış gibi, (b) `opacity:0` katmanları görünür gibi gösterir.
 * Ölçüldü: `Bildirim` · `Menü` · `Telefon` etiketleri ÜÇ çözünürlükte de
 * hiç boyanmıyor (DockScrollZone içinde kırpılı); navigasyonda katman şeridi
 * (`Yol`/`Hibrit`/`Uydu`) ve koordinat okuması `opacity:0` — yol adı çipi
 * onların üstüne binemez çünkü onlar ÇİZİLMİYOR.
 *
 * Bu dosya YALNIZ doğrulanan iki kusuru kilitler. Kilitler kaynak-metin
 * üzerindendir: her ikisi de saf CSS çapası olduğu için jsdom'da geometri
 * ölçülemez (jsdom yerleşim yapmaz) — ölçüm CİHAZDA/tarayıcıda yapılır,
 * burada korunan şey ÇAPA SÖZLEŞMESİDİR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('#605 · P2-1 — saha testi rozeti marka mührünü ÖRTMEZ', () => {
  const src = read('src/components/common/FieldTestBadge.tsx');

  it('rozet artık sol üst köşeye (marka mührünün evine) çapalanmaz', () => {
    /* Eski çapa: `fixed left-2 top-2`. Ölçülen bedel: 904×406'da amblem %61,
       `CAR` %64, `OS` %67 örtülüydü; 1280×480'de üçü de %51. */
    expect(src).not.toMatch(/className="[^"]*\bleft-2\b[^"]*\btop-2\b/);
    expect(src).not.toMatch(/className="[^"]*\btop-2\b[^"]*\bleft-2\b/);
  });

  it('rozet üst bandın ORTASINA ve başlık şeridinin ALTINA çapalanır', () => {
    // Yatay orta — marka (sol) ve durum sırası (sağ) ile aynı sütunda değil.
    expect(src).toContain("left: '50%'");
    expect(src).toContain("translateX(-50%)");
    // Dikeyde başlık şeridinin altı; `--sat` EKLENİR (çentikte kaymasın).
    expect(src).toMatch(/top:\s*'calc\(var\(--sat,\s*0px\)\s*\+\s*56px\)'/);
  });

  it('rozet hâlâ PASİF katmandır — tıklamayı yutmaz', () => {
    // Sözleşme değişmedi: dış kap pointer-events almaz (yalnız iç kutu alır).
    expect(src).toMatch(/className="pointer-events-none fixed/);
  });
});

describe('#605 · P2-3 — sol alt köşenin TEK sahibi var', () => {
  const hud  = read('src/components/map/NavigationHUD.tsx');
  const ctrl = read('src/components/map/MapHudControls.tsx');

  /** `MapHudControls` içindeki "Yol durumu bildir" düğmesinin kendi ölçüleri. */
  function reportButtonStrip(): { bottomOffset: number; size: number } {
    const at = ctrl.indexOf('aria-label="Yol durumu bildir"');
    expect(at, '"Yol durumu bildir" düğmesi bulunamadı').toBeGreaterThan(-1);
    const body = ctrl.slice(at, at + 1200);   // düğmenin kendi `style` bloğu
    const off = /bottom:\s*'calc\(var\(--lp-dock-h,\s*68px\)\s*\+\s*(\d+)px\)'/.exec(body);
    const sz  = /width:\s*(\d+),\s*height:\s*(\d+)/.exec(body);
    expect(off, 'düğmenin alt çapası okunamadı').not.toBeNull();
    expect(sz,  'düğmenin ölçüsü okunamadı').not.toBeNull();
    expect(sz![1]).toBe(sz![2]);                      // kare olduğu varsayımı
    return { bottomOffset: Number(off![1]), size: Number(sz![1]) };
  }

  /** `NavigationHUD` hızlı kart sütununun alt çapası. */
  function quickCardBottom(): number {
    const m = /bottom:\s*'calc\(var\(--lp-dock-h,\s*68px\)\s*\+\s*(\d+)px\)'/.exec(
      /* P0-NAV-02: ham `z-20` merkezi katman sözleşmesine taşındı
         (`--z-map-label`). Çapa dizgesi güncellendi; ÖLÇÜM aynı. */
      hud.slice(hud.indexOf('absolute left-3 z-[var(--z-map-label)] pointer-events-auto')),
    );
    expect(m, 'hızlı kart sütununun alt çapası okunamadı').not.toBeNull();
    return Number(m![1]);
  }

  it('hızlı kart sütunu, rapor düğmesinin şeridinin ÜSTÜNDEN başlar', () => {
    /* ÖLÇÜLEN KUSUR: ikisi de aynı köşeye çapalıydı (kart +10, düğme +18) →
       48×48 yarı saydam düğme en alttaki kartın (ÖZEL KONUMLAR) üstüne
       biniyordu: 904×406 %30/%15 · 1024×600 %28/%14 · 1280×480 %22/%11.
       Kullanıcı bunu "sahipsiz yarı saydam kare" diye bildirdi. */
    const btn = reportButtonStrip();
    expect(quickCardBottom()).toBeGreaterThanOrEqual(btn.bottomOffset + btn.size);
  });

  it('rapor düğmesi YERİNDE kalır — sürüşte en erişilir köşe odur', () => {
    // Çözüm düğmeyi taşımak DEĞİL, sütunu yukarı almaktı; kilit bunu sabitler.
    expect(reportButtonStrip().bottomOffset).toBe(18);
  });
});

describe('#605 · harita sabitleri DÖNGÜSÜZ yaprak modülden gelir', () => {
  const ids     = read('src/platform/map/_mapIds.ts');
  const state   = read('src/platform/map/_mapState.ts');
  const builder = read('src/platform/mapStyleBuilders.ts');

  it('_mapIds gerçekten YAPRAKTIR — hiçbir şey import etmez', () => {
    /* Döngü buradan kurulursa `NIGHT_PALETTE` modül üst seviyesinde TDZ'ye
       çarpar ve uygulama AÇILIŞTA çöker (#605'te gerçek tarayıcıda ölçüldü:
       "Cannot access 'MAP_BG_NIGHT' before initialization"). */
    expect(ids).not.toMatch(/^\s*import\s/m);
  });

  it('MAP_BG_* token tanımı _mapIds içindedir', () => {
    expect(ids).toMatch(/export const MAP_BG_NIGHT\s*=/);
    expect(ids).toMatch(/export const MAP_BG_DAY\s*=/);
    // `_mapState` yalnız YENİDEN DIŞA VERİR — ikinci bir tanım kurmaz.
    expect(state).not.toMatch(/export const MAP_BG_(NIGHT|DAY)\s*=/);
  });

  it('mapStyleBuilders token’ları _mapState üzerinden OKUMAZ (döngü kurar)', () => {
    expect(builder).not.toMatch(/MAP_BG_[A-Z]+[\s\S]{0,80}from '\.\/map\/_mapState'/);
    expect(builder).toMatch(/import \{ MAP_BG_NIGHT, MAP_BG_DAY \} from '\.\/map\/_mapIds';/);
  });
});
