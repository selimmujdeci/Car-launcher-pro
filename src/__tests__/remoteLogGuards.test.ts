/**
 * remoteLogGuards.test.ts — Uzak log bekçileri: İSTEMCİ ↔ SUNUCU senkronu.
 *
 * ── BU DOSYANIN KAPSAMI DEĞİŞTİ (kütük #588) ──────────────────────────────
 * Eskiden bu dosya migration 020'nin SQL METNİNİ okuyup sunucu bekçilerini
 * (boyut kırpma · 60 sn/30 olay rate limit · 30 gün retention) doğruluyordu.
 * #583'ün baseline squash'ı 020'yi `supabase/migrations_archive/`'e taşıyınca
 * dosya yükleme anında düştü — kilitler ölüydü.
 *
 * Sunucu bekçileri **silinmedi, TAŞINDI**: `prodBaselineSecurityGuards.test.ts`
 * artık onları üretimin gerçeğine (`00000000000000_prod_baseline.sql`) soruyor.
 *
 * Burada kalan iddia tek başına ne sunucudan ne istemciden doğrulanabilir:
 * **iki ucun BİRBİRİYLE tutarlı olması.** İstemci, sunucunun boyut tavanını
 * bir sabitle biliyor (`SERVER_MAX_BYTES`) ve kullanıcıya "bu rapor kırpılacak"
 * uyarısını ondan üretiyor. Sunucu tavanı değişip istemci sabiti kalırsa uyarı
 * sessizce YANLIŞ olur — kimse fark etmez. Bu dosya o ayrışmayı yakalar.
 */
import { describe, it, expect } from 'vitest';
import baselineSql from '../../supabase/migrations/00000000000000_prod_baseline.sql?raw';
import remoteLogSrc from '../platform/remoteLogService.ts?raw';
import { SERVER_MAX_BYTES } from '../platform/diagnosticDelivery';

/** Prod'daki `push_vehicle_event` gövdesinden gerçek tavanı okur. */
function serverMaxBytesFromProd(): number | null {
  const start = baselineSql.indexOf('CREATE OR REPLACE FUNCTION public.push_vehicle_event(');
  if (start < 0) return null;
  const body = baselineSql.slice(start, baselineSql.indexOf('$function$;', start));
  const m = body.match(/c_max_bytes\s+constant integer\s+:=\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

describe('istemci ↔ sunucu — boyut tavanı senkronu', () => {
  it('KİLİT: istemcideki SERVER_MAX_BYTES prod\'daki c_max_bytes ile AYNI', () => {
    /* Ayrışırsa iki yönde de zarar var:
       · istemci sabiti BÜYÜKSE  → "kırpılmayacak" der, sunucu kırpar → veri
         sessizce kaybolur ve kullanıcı tam rapor gönderdiğini sanır;
       · istemci sabiti KÜÇÜKSE → gereksiz yere "kırpılacak" uyarısı verir,
         kullanıcı gönderebileceği raporu göndermez.
       Sunucu tavanı bilinçli değişirse bu test düşer → istemci sabiti de
       güncellenmelidir. Kilit tam olarak bunu zorlar. */
    const prodMax = serverMaxBytesFromProd();
    expect(prodMax, 'prod\'da boyut tavanı sabiti bulunamadı').not.toBeNull();
    expect(SERVER_MAX_BYTES).toBe(prodMax);
  });

  it('KİLİT: tavan gerçek bir sınır — sıfır değil, fiilen sınırsız da değil', () => {
    expect(SERVER_MAX_BYTES).toBeGreaterThan(4_096);
    expect(SERVER_MAX_BYTES).toBeLessThanOrEqual(262_144);
  });
});

describe('istemci — sunucu bekçisine bel bağlamaz', () => {
  it('KİLİT: gönderim RPC\'den geçer (doğrudan tablo insert\'i bekçileri ATLAR)', () => {
    /* `from('vehicle_events').insert(...)` rate limit ve kırpmayı TAMAMEN
       atlar — ikisi de RPC gövdesindedir. */
    expect(remoteLogSrc).toContain('push_vehicle_event');
    expect(remoteLogSrc).not.toMatch(/\.from\(\s*['"]vehicle_events['"]\s*\)\s*\.insert/);
  });

  it('KİLİT: istemcinin KENDİ frekans sınırı var (sunucu sessizce düşürür)', () => {
    /* Sunucu rate limit aşımında istisna ATMAZ, `RETURN NULL` yapar — yani
       istemci gönderdiğini "gitti" sanar. Bu yüzden frekans disiplini
       istemcide de olmalıdır; jeton kovası sabitleri kilitlenir. */
    expect(remoteLogSrc).toMatch(/RATE_CAPACITY\s*=\s*\d+/);
    expect(remoteLogSrc).toMatch(/RATE_REFILL_MS\s*=/);
  });

  it('KİLİT: istemci payload\'ı kendi de sınırlar (derinlik · dizi · metin)', () => {
    /* Sunucu tavanı aşan payload'ı `ctx`+`msg`e indirger ve GERİSİNİ KAYBEDER.
       Anlamlı teşhis için istemci önce kendi budamasını yapar. */
    expect(remoteLogSrc).toMatch(/MAX_DEPTH\s*=\s*\d+/);
    expect(remoteLogSrc).toMatch(/MAX_ARRAY_LEN\s*=\s*\d+/);
    expect(remoteLogSrc).toMatch(/MAX_MSG_LEN\s*=\s*[\d_]+/);
  });

  it('KİLİT: kırpma UYARISI tavandan türetilir, elle yazılmaz', () => {
    expect(remoteLogSrc).toMatch(/willTruncate:\s*sizeBytes > SERVER_MAX_BYTES/);
  });
});
