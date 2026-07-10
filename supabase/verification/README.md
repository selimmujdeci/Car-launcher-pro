# Supabase Şema Doğrulama Tooling (PR-SQL-1)

Bu klasör, kanonik şema uzlaştırmasının **salt-okuma** doğrulama araçlarını içerir.
**Production DB'ye hiçbir şey uygulanmaz.**

## İçerik

| Dosya | Ne yapar |
|-------|----------|
| `verify_canonical_schema.sql` | Bir DB'nin kanonik şemaya uygunluğunu SALT-OKUMA sorgularıyla raporlar (tablo/RLS/grant/policy/tip/FK/index/RPC). |
| `../../tools/db/scan-supabase-usage.mjs` | Kod tabanındaki `.from()`/`.rpc()` kullanımını tarayıp tablo/RPC matrisi çıkarır (DB'ye DOKUNMAZ). |

## 1. Kod kullanım matrisi (DB'siz)

```bash
node tools/db/scan-supabase-usage.mjs           # özet
node tools/db/scan-supabase-usage.mjs --json    # makine-okur JSON
```

Çıktı: kodda kullanılan tablo ve RPC listesi + sıklık. Canlı DB introspection'ıyla
(elle) karşılaştırıp `docs/db/CANONICAL_SCHEMA_INVENTORY.md`'yi güncel tutmak için.

## 2. Şema doğrulama (SHADOW / LOCAL DB — asla production)

Önce **shadow/local** bir Supabase/Postgres kur:

```bash
# Seçenek A — Supabase CLI local stack
supabase start
# migrasyonları uygula (yalnız local)
supabase db reset            # kök supabase/migrations/ setini local'e uygular

# Seçenek B — geçici Postgres (docker)
# docker run --rm -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
# psql "postgresql://postgres:pw@localhost:5433/postgres" -f <her migration>
```

Sonra doğrulamayı çalıştır:

```bash
psql "$SHADOW_DB_URL" -f supabase/verification/verify_canonical_schema.sql
```

### Yorumlama

- **Bölüm 1/2/9:** eksik tablo/RLS/RPC → PR-SQL-2/3 kapsamı.
- **Bölüm 3b:** `anon` YAZMA grant'ı çıkan tablolar → PR-SQL-4 hardening.
- **Bölüm 4b:** `anon USING(true)` SELECT policy'leri → scope daraltma (PR-SQL-4).
- **Bölüm 5b/6:** FK-uyumsuz `vehicle_id` (TEXT) → PR-SQL-5 (preflight'lı, non-destructive).
- **Bölüm 8b:** SECURITY DEFINER RPC'de `search_path` pinli değilse → güvenlik düzeltmesi.

## 3. İdempotency testi (reconcile PR'ları için)

Her reconcile migration **iki kez** uygulanınca hata vermemeli:

```bash
psql "$SHADOW_DB_URL" -f supabase/migrations/<yeni_migration>.sql
psql "$SHADOW_DB_URL" -f supabase/migrations/<yeni_migration>.sql   # tekrar → hata YOK beklenir
```

## 🔒 Kurallar

- Bu araçların hiçbiri production'a yazmaz; `verify_canonical_schema.sql` yalnız `SELECT` içerir.
- `docs-local/db-truth/` introspection çıktıları **gitignore'ludur, commit edilmez**.
- Canlıya uygulama yalnız ayrı, onaylı bir süreçte (bu PR kapsamı dışında).
