/**
 * themeStudioPreviewPersistence.test.ts — Tema Stüdyo canlı önizleme KİLİDİ
 *
 * ── NEDEN VAR (kullanıcı şikâyeti + kaynak ölçümü, 2026-08-18) ──────────────
 * Kullanıcı: *"yaptığım düzenlemeleri göremiyorum ekranda gözükmüyor · ekran
 * sabit kalsın ki yaptığım düzenlemeleri görebileyim."*
 *
 * İKİ AYRI KÖK ölçüldü:
 *
 * **(A) Düzenleyici önizlemeyi tamamen kaldırıyordu.** `ThemeStudio` editör
 * açılınca `return <ComponentEditor/>` ile ERKEN DÖNÜYOR, `FullScreenSheet` de
 * `fixed inset-0 · zIndex 60` ile tüm ekranı kaplıyordu. Sonuç: "canlı
 * önizleme" yalnız HİÇBİR ŞEY DÜZENLENMEZKEN görülebiliyordu. Üstelik iframe
 * UNMOUNT olduğu için her editör açılış/kapanışında araç uygulaması BAŞTAN
 * boot ediyor, `previewReady` sıfırlanıyordu.
 *
 * **(B) Sözleşmenin iki ucu ayrışabiliyor.** PWA v3 mesajları
 * (`caros-theme-manifest`, `caros-preview-probe`) gönderirken araç köprüsü
 * onları dinlemiyorsa önizleme SESSİZCE ölür — hiçbir hata çıkmaz, "hazırım"
 * yanıtı geldiği için arayüz "CANLI ÖNİZLEME" bile der. Canlı sürümde tam
 * olarak bu ölçüldü (araçta `caros-preview-ready` VAR, `caros-theme-manifest`
 * YOK). Bu kilit en azından KAYNAK ÇİFTİNİN birlikte değişmesini zorunlu kılar.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STUDIO = readFileSync(
  join(ROOT, 'src', 'components', 'pwa', 'ThemeStudio.tsx'), 'utf8');
const EDITORS = readFileSync(
  join(ROOT, 'src', 'components', 'pwa', 'theme', 'ThemeEditors.tsx'), 'utf8');

describe('Tema Stüdyo — düzenlerken önizleme EKRANDA KALIR', () => {
  it('🔒 editör açıkken bileşen ERKEN RETURN ETMEZ (önizleme DOM\'da kalır)', () => {
    /* Erken return, iframe'i unmount eder → araç uygulaması baştan boot eder
       ve düzenleme yapılırken önizleme görülemez. */
    expect(STUDIO, 'editör paneli ana ağaçta render edilmiyor').toContain('const editorNode');
    /* `editorNode` IIFE'si İÇİNDEKİ `return` meşrudur; yasaklanan, BİLEŞENİN
       kendisinin erken dönmesidir. Ayrım, IIFE'nin üç editör dalından da ÖNCE
       açıldığını ve ana görünümün ONDAN SONRA geldiğini doğrulayarak yapılır. */
    const iifeAt = STUDIO.indexOf('const editorNode = (() => {');
    expect(iifeAt, 'editorNode IIFE yok').toBeGreaterThan(-1);
    for (const kind of ['tokens', 'surface', 'component']) {
      const at = STUDIO.indexOf(`if (editor.kind === '${kind}')`);
      expect(at, `'${kind}' dalı yok — kilit ölmüş olabilir`).toBeGreaterThan(-1);
      expect(iifeAt, `'${kind}' dalı IIFE DIŞINDA → o yolda önizleme kayboluyor`)
        .toBeLessThan(at);
    }
    const closeAt = STUDIO.indexOf('  })();');
    expect(closeAt, 'IIFE kapanışı yok').toBeGreaterThan(iifeAt);
    expect(STUDIO.indexOf('/* ── Ana görünüm'), 'ana görünüm IIFE içinde kalmış')
      .toBeGreaterThan(closeAt);
  });

  it('🔒 önizleme kabı `sticky` kalır — kaydırınca ekrandan kaçmaz', () => {
    expect(STUDIO).toContain("position: 'sticky'");
  });

  it('🔒 iframe TEK yerde render edilir (taşınırsa remount olur)', () => {
    const n = STUDIO.split('<iframe').length - 1;
    expect(n, `iframe ${n} yerde render ediliyor — taşınma remount üretir`).toBe(1);
  });

  it('🔒 düzenleyici kabuğu TÜM EKRANI KAPLAMAZ', () => {
    /* Yorumda geçen tarihsel açıklama kilidi düşürmesin — KOD deseni aranır. */
    expect(EDITORS, 'editör yine tam ekran — önizlemeyi örter')
      .not.toContain('className="fixed inset-0');
    expect(EDITORS, 'modal semantiği geri gelmiş (önizleme erişilemez olur)')
      .not.toContain('aria-modal');
  });

  it('🔒 düzenleyici KENDİ kaydırma kabını kurmaz (sticky\'yi öldürür)', () => {
    /* İç scroll kabı, dış sayfa kaydırmasını yutar → üstteki sticky önizleme
       hiç hareket etmez ama panel de sayfa akışında olmadığı için kullanıcı
       önizlemeyi kaybeder. */
    const shell = EDITORS.slice(
      EDITORS.indexOf('export function FullScreenSheet'),
      EDITORS.indexOf('/* ── Bileşen editörü'),
    );
    expect(shell.length).toBeGreaterThan(200);
    expect(shell, 'kabuk kendi scroll kabını kurmuş').not.toContain('overflow-y-auto');
  });

  it('🔒 düzenleyici açıkken önizleme KÜÇÜLÜR ama KAYBOLMAZ', () => {
    expect(STUDIO).toContain('const editing = editorNode !== null');
    expect(STUDIO, 'önizleme genişliği düzenleme durumuna bağlanmamış')
      .toContain("editing ? '62%' : '100%'");
    /* "display: none" ile gizlemek de iframe'i öldürür — yasak. */
    expect(STUDIO).not.toContain("editing ? 'none'");
  });
});

describe('Tema Stüdyo — postMessage sözleşmesinin İKİ UCU birlikte değişir', () => {
  /* Araç kopyası ana repodadır; website testleri `website/` kökünden koşar. */
  const bridgePath = join(ROOT, '..', 'src', 'platform', 'themePreviewBridge.ts');

  it('🔒 araç köprüsü kaynağı bulunabilir (yol kayarsa kilit sessizce ölmesin)', () => {
    expect(existsSync(bridgePath), `araç köprüsü bulunamadı: ${bridgePath}`).toBe(true);
  });

  it('🔒 PWA\'nın GÖNDERDİĞİ her mesaj tipini araç köprüsü TANIR', () => {
    const bridge = readFileSync(bridgePath, 'utf8');
    /* PWA'nın iframe'e postMessage ettiği tipler — kaynaktan çıkarılır. */
    const sent = [...STUDIO.matchAll(/postMessage\(\s*\{\s*type:\s*'([a-z-]+)'/g)]
      .map((m) => m[1]);
    expect(sent.length, 'PWA hiçbir mesaj göndermiyor — tarama deseni ölmüş')
      .toBeGreaterThan(0);
    for (const t of sent) {
      expect(bridge, `araç köprüsü '${t}' mesajını TANIMIYOR → önizleme sessizce ölür`)
        .toContain(`'${t}'`);
    }
  });

  it('🔒 PWA\'nın BEKLEDİĞİ her yanıt tipini araç köprüsü ÜRETİR', () => {
    const bridge = readFileSync(bridgePath, 'utf8');
    const expected = [...STUDIO.matchAll(/d\.type === '([a-z-]+)'/g)].map((m) => m[1]);
    expect(expected.length, 'PWA hiçbir yanıt beklemiyor — tarama deseni ölmüş')
      .toBeGreaterThan(0);
    for (const t of expected) {
      expect(bridge, `araç köprüsü '${t}' yanıtını ÜRETMİYOR`).toContain(`'${t}'`);
    }
  });
});
