/**
 * F4.3 · ARAÇ HAFIZASI YÜZEYİ — navigasyon, izolasyon ve mimari muhafızlar.
 *
 * YAKLAŞIM: `@testing-library/react` depoda YOK ve yeni bağımlılık eklenmez.
 * Bu dosya (a) navigasyon sözleşmesini, (b) bileşenin ikinci otorite
 * kurmadığını ve (c) araç değişiminde sızıntı korumasını kilitler.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const PAGE  = read('src/app/(pwa)/kumanda/page.tsx');
const PANEL = read('src/components/pwa/VehicleMemoryPanel.tsx');
const MODEL = read('src/lib/memory/vehicleMemory.ts');

/* ═══ Navigasyon ════════════════════════════════════════════════════════ */

describe('F4.3 · navigasyon bozulmadı', () => {
  it('ana çubuk HÂLÂ TAM 5 yüzey (altıncı sekme eklenmedi)', () => {
    const ids = [...PAGE.matchAll(/id: '(aracim|yolculuklar|saglik|harita|daha)'/g)]
      .map((m) => m[1]);
    expect(new Set(ids).size).toBe(5);
    const primary = PAGE.slice(PAGE.indexOf('const PRIMARY_TABS'), PAGE.indexOf('DAHA FAZLA —'));
    expect(primary).not.toContain("'hafiza'");
  });

  it('hafıza "Daha Fazla" altından erişilir', () => {
    expect(PAGE).toContain("type SecondaryTab = 'eslestir' | 'kayitlar' | 'hafiza' | 'tema'");
    expect(PAGE).toContain("activeTab === 'hafiza'");
    expect(PAGE).toContain("id: 'hafiza'");
  });
});

/* ═══ Mimari muhafızlar ════════════════════════════════════════════════ */

describe('F4.3 · ikinci otorite kurulmadı', () => {
  it('panel KENDİ hükmünü/ölçümünü üretmez — projeksiyonu render eder', () => {
    expect(PANEL).toContain('buildVehicleMemory');
    /* Hüküm/eşik/tahmin yok. */
    expect(PANEL).not.toMatch(/judge|verdict|threshold|estimateRange/i);
    /* Bakım hesabı yok (F4 kilometre ekseni hâlâ bloklu). */
    expect(PANEL).not.toMatch(/km kaldı|oilLife|intervalKm/);
  });

  it('panel İKİNCİ aktif araç deposu kurmaz', () => {
    expect(PANEL).not.toContain('useVehicleStore');
    /* Araç yukarıdan prop ile gelir. */
    expect(PANEL).toContain('vehicle: LiveVehicle | null');
  });

  it('panel MEVCUT kanonik okuma servislerini kullanır', () => {
    expect(PANEL).toContain('fetchVehicleTripsResult');
    expect(PANEL).toContain('loadFuelEntries');
    expect(PANEL).toContain('loadServiceEntries');
    /* Doğrudan tablo sorgusu AÇMAZ — yetki RLS'te, okuma servislerde. */
    expect(PANEL).not.toContain("from('vehicle_trips')");
    expect(PANEL).not.toContain('supabaseBrowser');
  });

  it('model KENDİ başına veri çekmez (saf projeksiyon)', () => {
    const kod = MODEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(kod).not.toContain('supabase');
    expect(kod).not.toContain('fetch(');
    /* `Date.now()` yok: "şimdi" uydurulamaz. */
    expect(kod).not.toContain('Date.now()');
    /* İzin verilen import'lar: tip taşıyıcıları + SAF projeksiyon yardımcıları.
       `diagnosticHistory` (F5.3) bir DEĞER import'udur ama I/O YAPMAZ ve yeni
       otorite KURMAZ — teşhis cümlesini TEK yerde tutar. Onu buraya almamak,
       aynı metni ikinci kez yazmak (yani ikinci otorite) anlamına gelirdi. */
    const imports = [...kod.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '@/lib/diagnostics/diagnosticHistory',
      '@/lib/fleet/vehicleTripsView',
      '@/lib/recordsService',
    ]);
    /* Guard'ın ASIL amacı korunur: izin verilen her import da saf olmalı. */
    const diag = read('src/lib/diagnostics/diagnosticHistory.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(diag).not.toContain('supabase');
    expect(diag).not.toContain('fetch(');
    expect(diag).not.toContain('Date.now()');
  });
});

/* ═══ Araç izolasyonu ══════════════════════════════════════════════════ */

describe('F4.3 · araç geçişinde sızıntı yok', () => {
  it('12 — geç gelen okuma araç damgasıyla ELENİR', () => {
    /* A okunurken kullanıcı B'ye geçerse A'nın sonucu B ekranına yazılamaz. */
    expect(PANEL).toContain('requestedFor.current !== vehicleId');
    expect(PANEL).toContain('requestedFor.current = vehicleId');
  });

  it('araç yoksa hiçbir geçmiş iddiası basılmaz', () => {
    expect(PANEL).toContain('Araç seçilmedi');
  });
});

/* ═══ Dürüstlük ════════════════════════════════════════════════════════ */

describe('F4.3 · boşluk dürüstçe anlatılır', () => {
  it('10 — demo/sahte olay yok, dürüst boş durum var', () => {
    expect(PANEL).toContain('henüz kayıtlı geçmiş yok');
    /* Yalnız KOD sınanır: açıklama metni "demo olay üretilmez" demek
       zorunda ve bu bir ihlal değildir. */
    const kod = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(kod).not.toMatch(/örnek|demo|placeholder|mockEvent/i);
  });

  it('11 — OKUNAMADI ayrıca bildirilir ("kayıt yok" ile karışmaz)', () => {
    expect(PANEL).toContain('unreadableSources');
    expect(PANEL).toContain('okunamadı');
  });

  it('provenance kullanıcıya düz Türkçe gösterilir', () => {
    expect(PANEL).toContain('provenanceLabel');
  });
});
