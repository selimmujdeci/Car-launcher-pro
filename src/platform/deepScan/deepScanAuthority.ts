/**
 * deepScanAuthority — "derin tarama" işini KİMİN sahiplendiğinin TEK BEYANI (V-10).
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · servis importu YOK.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * V-10 depoda **iki otorite** olduğundan şüpheleniyordu: `deepScanOrchestrator`
 * (1.103 satır, kendini *"Deep Scan'in TÜM katmanlarını yöneten tek
 * koordinatör"* ilan ediyor) ve sahada gerçekten çalışan `discoveryLive`.
 *
 * ── ÖLÇÜM (2026-08-22) — ŞÜPHE HAKLIYDI AMA TEŞHİS EKSİKTİ ─────────────────
 * Üretimde orchestrator'a enjekte edilen **TEK** handler `change_detection`
 * (`platformCoreDeepScanWiring`). **Hiçbir AKTİF faz handler'ı yok** — ne
 * identity, ne protocol, ne ECU/PID/DID keşfi. Orchestrator'ın kendi başlığı
 * da bunu zaten söylüyordu: *"foundation'da yok → hepsi handler_unavailable"*.
 *
 * Yani bugün **iki motor aynı işi yapmıyor**; iş BÖLÜŞÜLMÜŞ durumda:
 *   · AKTİF tarama (araca sorgu göndermek) → `discoveryLive` — TEK otorite
 *   · ÇEVRİMDIŞI değişim tespiti           → `deepScanOrchestrator`
 *
 * İkinci otorite riski GERÇEK ama **GİZİL**: orchestrator'a bir gün aktif faz
 * handler'ı enjekte edilirse, aynı işi yapan ikinci bir yol doğar ve iki motor
 * araca ayrı ayrı sorgu göndermeye başlar. Bu dosya o sınırı AÇIKÇA yazar;
 * `deepScanAuthority.test.ts` ise sınırın sessizce aşılmasını ENGELLER.
 *
 * ── KARAR ───────────────────────────────────────────────────────────────────
 * `discoveryLive` KAZANDI (sahada çalışıyor, Mavi eylemleri ve LAB paneli onu
 * kullanıyor, kanıtlanmış). Orchestrator EMEKLİ EDİLMEDİ çünkü çevrimdışı yarısı
 * (değişim tespiti · kapsam kütüğü · `evaluateDeepScanCompletion` tamamlanma
 * gerçeği) GERÇEKTEN ÇALIŞIYOR ve `discoveryLive` bunları YAPMIYOR — silmek
 * çalışan bir yeteneği kaybetmek olurdu.
 *
 * Aktif fazlara handler bağlamak isteyen, önce bu dosyayı ve kilidi
 * GÜNCELLEMEK zorundadır — yani karar BİLİNÇLİ olur, kazara değil.
 */

/** Derin taramanın ayrıştırılmış iş alanları. */
export type DeepScanDomain = 'active_scan' | 'offline_change_detection';

export interface DeepScanAuthorityRecord {
  readonly domain: DeepScanDomain;
  /** İşi ÜRETİMDE gerçekten yapan modül. */
  readonly owner: string;
  /** Ne yaptığı — tek cümle. */
  readonly does: string;
  /** Bu alanı sahiplenMEYEN ama sahiplenir görünen modül (varsa). */
  readonly notOwner: string | null;
  /** Neden o değil. */
  readonly why: string;
}

export const DEEP_SCAN_AUTHORITIES: readonly DeepScanAuthorityRecord[] = Object.freeze([
  {
    domain: 'active_scan',
    owner: 'obd/discovery/discoveryLive.getLiveDiscoveryCoordinator()',
    does: 'Araca GERÇEK sorgu göndererek PID/DID keşfi yapar; Mavi eylemleri ve CAROS LAB paneli aynı tekil örneği kullanır.',
    notOwner: 'deepScan/deepScanOrchestrator.run()',
    why: 'Orchestrator\'ın aktif fazlarına üretimde HİÇBİR handler enjekte edilmiyor; tüm aktif fazlar `handler_unavailable` döner ve GERÇEK İŞ YAPILMAZ.',
  },
  {
    domain: 'offline_change_detection',
    owner: 'deepScan/deepScanOrchestrator (change_detection handler)',
    does: 'Ağ/araç olmadan, kayıtlı profil ile son gözlemi karşılaştırıp değişim tespiti yapar; kapsam kütüğü ve tamamlanma gerçeğini üretir.',
    notOwner: 'obd/discovery/discoveryLive',
    why: 'discoveryLive canlı keşif yapar; değişim tespiti, kapsam kütüğü ve tamamlanma hükmü ONDA YOKTUR.',
  },
] as const);

/**
 * Orchestrator'a üretimde enjekte edilmesine İZİN VERİLEN faz handler'ları.
 *
 * Bu liste bir POLİTİKADIR, bir gözlem değil: kilit testi üretim kodunu tarar ve
 * burada olmayan bir faza handler bağlanmışsa DÜŞER. Böylece "ikinci otorite"
 * kazara değil, ancak bu dosya bilerek güncellenerek doğabilir.
 */
export const ALLOWED_ORCHESTRATOR_HANDLERS: readonly string[] = Object.freeze([
  'change_detection',
]);

/** Bir alanın üretim sahibi; bilinmeyen alan için `null` (fail-soft). */
export function ownerOf(domain: string): string | null {
  for (const a of DEEP_SCAN_AUTHORITIES) if (a.domain === domain) return a.owner;
  return null;
}
