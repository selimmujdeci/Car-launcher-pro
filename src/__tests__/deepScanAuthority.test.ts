/**
 * deepScanAuthority.test.ts — V-10 "İKİNCİ OTORİTE" KİLİDİ.
 *
 * ── V-10 NE SORUYORDU ──────────────────────────────────────────────────────
 * *"Deep Scan'de iki otorite mi var?"* — `deepScanOrchestrator` (1.103 satır,
 * kendini "TÜM katmanların tek koordinatörü" ilan ediyordu) ve sahada gerçekten
 * çalışan `discoveryLive`.
 *
 * ── ÖLÇÜM SONUCU: ŞÜPHE HAKLI, TEŞHİS EKSİKTİ ──────────────────────────────
 * Bugün iki motor AYNI İŞİ YAPMIYOR; iş bölüşülmüş:
 *   · AKTİF tarama          → `discoveryLive`          (tek otorite)
 *   · ÇEVRİMDIŞI değişim    → `deepScanOrchestrator`   (gerçekten çalışan yarı)
 * İkinci otorite riski GERÇEK ama GİZİL: orchestrator'a bir aktif faz handler'ı
 * enjekte edildiği an, iki motor araca ayrı ayrı sorgu göndermeye başlar.
 *
 * BU DOSYA O ANI YAKALAR. Kilit düşerse yapılacak şey testi zayıflatmak DEĞİL,
 * `deepScanAuthority.ts`teki kararı bilinçli olarak güncellemektir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  DEEP_SCAN_AUTHORITIES, ALLOWED_ORCHESTRATOR_HANDLERS, ownerOf,
} from '../platform/deepScan/deepScanAuthority';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * A) BEYAN
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScanAuthority › beyan', () => {
  it('her alanın TEK bir üretim sahibi vardır', () => {
    const domains = DEEP_SCAN_AUTHORITIES.map((a) => a.domain);
    expect(new Set(domains).size).toBe(domains.length);
    expect(domains).toContain('active_scan');
    expect(domains).toContain('offline_change_detection');
  });

  it('AKTİF taramanın sahibi `discoveryLive`dır — orchestrator DEĞİL', () => {
    expect(ownerOf('active_scan')).toMatch(/discoveryLive/);
    const rec = DEEP_SCAN_AUTHORITIES.find((a) => a.domain === 'active_scan')!;
    expect(rec.notOwner).toMatch(/deepScanOrchestrator/);
    expect(rec.why.length).toBeGreaterThan(40);
  });

  it('ÇEVRİMDIŞI değişim tespitinin sahibi orchestrator\'dır', () => {
    expect(ownerOf('offline_change_detection')).toMatch(/deepScanOrchestrator/);
  });

  it('bilinmeyen alan null döner (fail-soft, throw YOK)', () => {
    expect(ownerOf('yok-boyle-bir-alan')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) İKİNCİ OTORİTE KİLİDİ — V-10'un ÇEKİRDEĞİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScanAuthority › ikinci otorite doğamaz', () => {
  /** Üretimde orchestrator'a handler enjekte eden TÜM yerler. */
  const PRODUCTION_FILES = [
    'src/platform/system/platformCoreDeepScanWiring.ts',
    'src/platform/deepScan/index.ts',
  ];

  it('üretimde YALNIZCA izin verilen faz handler\'ları enjekte edilir', () => {
    const injected = new Set<string>();
    for (const f of PRODUCTION_FILES) {
      const src = stripComments(read(f));
      /* `handlers: { <faz>: ... }` bloklarındaki faz adlarını çıkar. */
      for (const m of src.matchAll(/handlers:\s*\{([^}]*)\}/g)) {
        for (const k of m[1].matchAll(/([a-z_]+)\s*:/g)) injected.add(k[1]);
      }
    }

    /* Enjekte edilen her faz beyan edilmiş olmalı. Yeni bir faz bağlandıysa bu
       kilit DÜŞER — testi gevşetmek YASAK; `deepScanAuthority.ts` bilinçli
       güncellenmelidir (ikinci otorite kazara doğmasın). */
    for (const phase of injected) {
      expect(
        ALLOWED_ORCHESTRATOR_HANDLERS,
        `orchestrator'a BEYAN EDİLMEMİŞ faz handler'ı bağlanmış: "${phase}" — ikinci tarama otoritesi doğuyor olabilir`,
      ).toContain(phase);
    }
  });

  it('izin listesi AKTİF faz İÇERMEZ (yalnız çevrimdışı)', () => {
    /* Aktif fazlar araca SORGU GÖNDERİR — orchestrator'a bağlanırsa
       `discoveryLive` ile aynı işi yapan ikinci yol doğar. */
    const ACTIVE_PHASES = [
      'identity', 'protocol', 'ecu_discovery', 'pid_discovery',
      'did_discovery', 'firmware',
    ];
    for (const p of ACTIVE_PHASES) {
      expect(ALLOWED_ORCHESTRATOR_HANDLERS, `aktif faz izin listesine girmiş: ${p}`).not.toContain(p);
    }
  });

  it('`discoveryLive` ÜRETİM tüketicisi olan tek aktif keşif yoludur', () => {
    /* Aktif keşif ürün yolunda gerçekten kullanılıyor olmalı — aksi hâlde
       "tek otorite" beyanı bir kâğıt üzerinde kalırdı. */
    const consumers = [
      'src/components/discovery/PidDidDeepScanPanel.tsx',
      'src/platform/maviCore/discoveryActions.ts',
    ].filter((f) => /getLiveDiscoveryCoordinator/.test(read(f)));
    expect(consumers.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) BELGE GERÇEĞİ ANLATIR (V-10 kabul ölçütünün ikinci yarısı)
 * ═════════════════════════════════════════════════════════════════════════ */
describe('deepScanAuthority › belge gerçeği anlatır', () => {
  it('orchestrator artık kendini "TÜM katmanların tek koordinatörü" İLAN ETMEZ', () => {
    const src = read('src/platform/deepScan/deepScanOrchestrator.ts');
    expect(src).not.toMatch(/TÜM katmanlarını yöneten tek koordinatör/);
    /* Sınırı AÇIKÇA yazmalı. */
    expect(src).toMatch(/OTORİTE SINIRI/);
    expect(src).toMatch(/discoveryLive/);
  });

  it('orchestrator aktif faz handler\'ı olmadığını AÇIKÇA söyler', () => {
    const src = read('src/platform/deepScan/deepScanOrchestrator.ts');
    expect(src).toMatch(/handler_unavailable|GERÇEK İŞ YAPILMAZ/);
  });
});
