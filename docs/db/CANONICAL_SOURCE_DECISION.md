# CAROS PRO — Kanonik Supabase Kaynak Kararı (PR-SQL-1)

> Bu belge, hangi migration setinin **kanonik** (tek doğru kaynak) olduğunu ve canlı DB ile
> nasıl uzlaştırılacağını sabitler. **Bu PR'da hiçbir dosya silinmez/taşınmaz/yeniden
> adlandırılmaz; production'a hiçbir şey uygulanmaz.**

---

## 1. Mevcut durum (kanıt: `CANONICAL_SCHEMA_INVENTORY.md` §2)

İki migration seti var ve **ayrışmış**:

| Set | Konum | Dosya | Canlı `schema_migrations`'ta |
|-----|-------|------:|------------------------------|
| Kök | `supabase/migrations/` | 28 | yalnız 2 (`…021`, `…022`) |
| Website | `website/supabase/migrations/` | 12 | **çoğu** (001…20260430) |

Ek olarak kök setin bir kısmı (key_beam, geofences, get_recent_diagnostics, push_vehicle_event
fix'leri) canlıya **Management API ile out-of-band** uygulanmış → yapı canlıda var ama
`schema_migrations`'ta kayıt yok.

**Yani:** ne kök ne website seti tek başına canlı DB'yi birebir temsil ediyor. Canlı DB =
`website seti` + `elle uygulanan kök alt-kümesi`.

---

## 2. Karar

### 2.1 Kanonik kaynak = `supabase/migrations/` (kök)

- İleriye dönük **tek kanonik migration klasörü kök settir**. Yeni kanonik migration'lar
  buraya, **yalnız ileri-yönlü (forward-only)** ve **idempotent** olarak eklenir.

### 2.2 Website seti (`website/supabase/migrations/`)

- **Bu PR'da SİLİNMEZ, TAŞINMAZ, YENİDEN ADLANDIRILMAZ.** Tarihsel gerçektir (canlı DB'yi bu set kurdu).
- Website setindeki **canlıda yaşayan ve gerekli** yapılar, kök sette **yeni, güvenli,
  idempotent** migration'larla **temsil edilecek** (kopya değil — `IF NOT EXISTS` guard'lı
  "reconcile" migration'ları). Böylece taze bir ortam yalnız kök setle aynı canlı şemayı üretir.

### 2.3 Yasaklar (bu PR ve reconcile PR'ları)

- ❌ `website/supabase` klasörünü silme
- ❌ eski migration'ları yeniden adlandırma / timestamp geçmişini bozma
- ❌ aynı eski migration'ları taşıma
- ❌ `schema_migrations` geçmişini elle düzenleme
- ❌ production'a `db push` / Management API yazma

---

## 3. Uzlaştırma stratejisi (forward-only reconcile)

Reconcile migration'ları (PR-SQL-2+) şu ilkelerle yazılır:

1. **Non-destructive existence guard'ları:**
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - policy için: `DO $$ BEGIN IF NOT EXISTS (SELECT … FROM pg_policies …) THEN CREATE POLICY … END IF; END $$;`
   - RPC için: `CREATE OR REPLACE FUNCTION` (signature değişmeden)
2. **Destructive işlem YOK:** `DROP TABLE/COLUMN`, `TRUNCATE`, geri-döndürülemez `ALTER TYPE` yasak.
3. **Veri dönüşümü gerekiyorsa** (ör. TEXT→UUID) önce **preflight doğrulama sorgusu** + fail-safe guard;
   ana dönüşüm ayrı, gözden geçirilmiş, bakım-penceresi migration'ı (PR-SQL-5).
4. Her migration sonunda **salt-okuma verification bloğu** (bkz. `supabase/verification/`).

---

## 4. İdempotency & test kapısı

- Her reconcile migration **iki kez** uygulanabildiğinde (shadow/local DB) hata vermemeli.
- Uygulanabilirlik **shadow/local DB'de** test edilir (bkz. `supabase/verification/README.md`),
  **asla production'da**.
- Frontend `typecheck/test/build` reconcile PR'larında yeşil kalmalı (şema isim/kolon
  hizalaması kod akışını bozmamalı).

---

## 5. İsim drift'i kararları (öneri — PR-SQL-3'te doğrulanacak)

| Kod adı | Canlı ad | Öneri |
|---------|----------|-------|
| `push_subscriptions` (website) | `vehicle_push_tokens` | Kod/website'i canlı ada hizala (tercih) VEYA uyumluluk view'ı |
| `linking_codes` (website) | `vehicle_linking_codes` | aynı |
| `remote_commands` (src) | `route_commands` / `vehicle_commands` | kod düzeltmesi (tablo üretme değil) |

> İsim drift'leri **tablo oluşturma** ile değil, tercihen **kod hizalama** ile çözülür;
> zorunlu ise geriye-dönük uyumluluk `VIEW`'ı (salt-okuma) değerlendirilir. Karar PR-SQL-3'te,
> gerçek kullanım kanıtıyla.
