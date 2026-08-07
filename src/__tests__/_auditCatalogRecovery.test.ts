/**
 * _auditCatalogRecovery.test.ts — TEK SEFERLİK KURTARMA DENETİMİ (2026-08-02).
 *
 * 2026-08-02'de `carosLabCatalog.ts` yanlışlıkla `git checkout --` ile HEAD'e
 * döndürüldü ve commit'lenmemiş çalışma kayboldu. Katalog `dist/` derlemesinden
 * yeniden üretildi. Bu dosya, kurtarmanın ALAN ALAN doğru olduğunu KANITLIYORDU.
 *
 * ── ⚠️ DENETİM TABANI ARTIK YOK (2026-08-02, D1–D3 turu) ────────────────────
 * Karşılaştırmanın dayandığı derleme `dist/assets/CarosLabShell-AQyy2DFS.js`
 * (2026-08-01 23:55) **SİLİNDİ**: aynı gün 10:32'de telefona kurulum için
 * koşulan `npm run apk:safe` → `npm run build` adımı `dist/`i yeniden üretti ve
 * chunk hash'i değişti (`CarosLabShell-B6HgwQJj.js`). `dist/` `.gitignore`
 * kapsamındadır ve git'te izlenmez → eski artefakt **geri getirilemez**.
 *
 * Bu dosyanın kendi sözleşmesi zaten şunu diyordu:
 *   "`dist/` yeniden üretildiğinde (yeni build) bu dosya SİLİNMELİDİR —
 *    aksi hâlde eski bundle'a bağlı kalır."
 *
 * ── NEDEN YENİ BUNDLE'A YÖNLENDİRİLMEDİ ─────────────────────────────────────
 * Yeni `dist/` **kurtarılmış kaynaktan** derlenmiştir. Kataloğu kendi
 * derlemesiyle karşılaştırmak DÖNGÜSELDİR: her zaman geçer ve hiçbir şey
 * kanıtlamaz. Yeşil bir "kurtarma doğrulandı" satırı üretmek, kanıtsız PASS
 * üretmenin ta kendisi olurdu (CLAUDE.md §Kanıtsız bilgi).
 *
 * ── GEÇMİŞ DENETİMİN SONUCU (belgede kayıtlı, tekrarlanamaz) ────────────────
 * `docs/AUTONOMOUS_FIELD_VALIDATION_P0_INDEPENDENT_AUDIT.md` §13:
 *   · 44/44 araç, 6 alan BİREBİR aynı
 *   · screenMap 35/35 case aynı ekrana
 *   · MainLayout sahipsiz string 0
 *   · hüküm: `VERIFIED_WITH_RESIDUAL_RISK` (23:55 sonrası pencere kör)
 * Bu sonuç GEÇERLİDİR ama **artık yeniden üretilemez**.
 *
 * Aşağıda YALNIZ kaynak-tabanlı, hâlâ anlamlı olan kilitler bırakılmıştır.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

/** Kurtarmanın dayandığı derleme — ARTIK YOK (yukarıdaki nota bakınız). */
const BASELINE_DIST = 'dist/assets/CarosLabShell-AQyy2DFS.js';

interface SourceCase { id: string; screen: string; prop: string }

/** Kaynak dosyadaki `case '<id>': return <Screen ... />` satırlarını okur. */
function readSourceCases(): SourceCase[] {
  const src = readFileSync('src/components/devtools/carosLabScreenMap.tsx', 'utf8');
  return [...src.matchAll(/case\s+'([a-z0-9-]+)':\s*return\s*<([A-Za-z0-9_]+)([^/>]*)\/>/g)]
    .map((m) => ({ id: m[1], screen: m[2], prop: m[3].trim() }));
}

describe('KURTARMA DENETİMİ — taban artefakt durumu', () => {
  /**
   * Bu kilit BİLEREK "taban yok" durumunu KAYDEDER. Amacı, birinin bu dosyaya
   * bakıp "kurtarma doğrulandı" sanmasını ENGELLEMEKTİR. Taban bir gün geri
   * gelirse (ör. eski build arşivden çıkarsa) bu kilit düşer ve karşılaştırma
   * yeniden yazılmalıdır — sessizce unutulmaz.
   */
  it('bundle karşılaştırması ARTIK YAPILAMIYOR — taban derleme silinmiş', () => {
    expect(
      existsSync(BASELINE_DIST),
      `${BASELINE_DIST} beklenmedik biçimde MEVCUT → bundle karşılaştırması yeniden yazılmalı`,
    ).toBe(false);
  });

  it('kurtarma sonucu YALNIZ denetim belgesinde kayıtlıdır (kod kanıtı yok)', () => {
    const doc = readFileSync(
      'docs/AUTONOMOUS_FIELD_VALIDATION_P0_INDEPENDENT_AUDIT.md', 'utf8',
    );
    expect(doc).toContain('44/44');
    expect(doc).toContain('VERIFIED_WITH_RESIDUAL_RISK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KAYNAK-TABANLI KİLİTLER — bundle'a bağlı DEĞİL, geçerliliğini koruyor
 *
 * NEDEN AYRI KİLİT: `tsc` bir case'in YANLIŞ ekrana bağlandığını YAKALAMAZ
 * (`trip-engine → LocationEngineScreen` tip olarak geçerlidir).
 * ════════════════════════════════════════════════════════════════════════ */

describe('KURTARMA DENETİMİ — carosLabScreenMap kaynak kilitleri', () => {
  const mine = readSourceCases();

  it('RuntimeSchedulingScreen odak prop\'ları KORUNDU (ortak ekran, farklı odak)', () => {
    const q = mine.find((m) => m.id === 'queue-monitor');
    const p = mine.find((m) => m.id === 'poll-scheduler');
    expect(q?.screen).toBe('RuntimeSchedulingScreen');
    expect(p?.screen).toBe('RuntimeSchedulingScreen');
    expect(q?.prop).toBe('focus="queue-monitor"');
    expect(p?.prop).toBe('focus="poll-scheduler"');
  });

  /**
   * TERS YÖN: her `case` katalogda GERÇEKTEN var olan bir araca gitmeli.
   * (Düz yön — "her aracın bir case'i var" — BİLEREK sınanmaz: bazı araçlar
   * fallback ekranına düşer, bu mevcut ve bilinçli bir üründür.)
   */
  it('her screenMap case\'i katalogda var olan bir araca gider (ölü case yok)', () => {
    const known = new Set(CAROS_LAB_TOOLS.map((t) => t.id));
    const dead = mine.filter((m) => !known.has(m.id)).map((m) => m.id);
    expect(dead, `katalogda karşılığı olmayan case: ${dead.join(', ')}`).toEqual([]);
  });

  it('uzun yol saha doğrulama aracı katalogda ve screenMap\'te MEVCUT', () => {
    expect(CAROS_LAB_TOOLS.some((t) => t.id === 'long-road-field-validation')).toBe(true);
    expect(mine.some((m) => m.id === 'long-road-field-validation')).toBe(true);
  });

  it('katalog araç kimlikleri BENZERSİZ', () => {
    const ids = CAROS_LAB_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
