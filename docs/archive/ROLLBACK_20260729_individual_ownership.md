# GERİ ALMA PLANI — 20260729000033 + 20260729000034

> ⚠️ **Bu belge ÇALIŞTIRILMADI ve production'a UYGULANMADI.** Yalnız canlı
> `pg_dump` şemasından kurulmuş yerel shadow veritabanında prova edilmiştir.
> Repo politikası gereği ayrı bir `down` migration dosyası OLUŞTURULMAMIŞTIR;
> geri alma bilinçli, elle ve onaylı bir işlemdir.

## Sıra ZORUNLU: önce 034, sonra 033

`034` nullable kolonlara veri yazar (bireysel `company_id IS NULL` satırları).
Önce `033` geri alınırsa `SET NOT NULL` bu satırlar yüzünden zaten patlar.

```
ADIM 1 → 034 geri al   (fonksiyon + kolon)
ADIM 2 → 033 geri al   (NOT NULL, FAIL-CLOSED ön kontrolle)
```

## ADIM 1 — 034 geri alma

1. `push_vehicle_event`'i **027 gövdesine** döndür
   (`supabase/migrations/20260706000027_push_vehicle_event_cap_64k.sql` dosyasını
   aynen yeniden uygula — canlı gövdenin bu sürüm olduğu `pg_dump` ile doğrulandı).
2. `DROP FUNCTION IF EXISTS public.pair_vehicle_to_user(text, uuid);`
3. `ALTER TABLE public.vehicle_pairings DROP COLUMN IF EXISTS company_id;`

**Veri etkisi:** yalnız `vehicle_pairings.company_id` kolonu kaybolur (bu kolon
034 ile eklenmiştir; başka yerde veri kaybı yoktur).

## ADIM 2 — 033 geri alma (FAIL-CLOSED)

`ALTER COLUMN ... SET NOT NULL` **tek başına yazılMAZ**. Önce NULL satır sayılır;
sıfır değilse geri alma DURUR — aksi hâlde ya komut patlar ya da (yanlış bir
"temizlik" refleksiyle) bireysel kullanıcı verisi silinir.

```sql
DO $$
DECLARE v_p integer; v_l integer;
BEGIN
  SELECT count(*) INTO v_p FROM public.profiles          WHERE company_id IS NULL;
  SELECT count(*) INTO v_l FROM public.vehicle_locations WHERE company_id IS NULL;
  IF v_p > 0 OR v_l > 0 THEN
    RAISE EXCEPTION 'ROLLBACK DURDU: profiles NULL=%, vehicle_locations NULL=%', v_p, v_l;
  END IF;
  ALTER TABLE public.profiles          ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.vehicle_locations ALTER COLUMN company_id SET NOT NULL;
END $$;
```

**NULL satır varsa ne yapılmalı?** Geri alma yapılMAZ. Bireysel kullanıcı ve
konum verisi gerçek üretim verisidir; onu silmek geri alma değil **veri kaybıdır**.
O noktada ileri yönde düzeltme (fix-forward) tercih edilmelidir.

## Shadow'da prova edilen sonuçlar

| Durum | Sonuç |
|---|---|
| Bireysel veri VARKEN geri alma | `ROLLBACK DURDU: profiles NULL=2, vehicle_locations NULL=1` → **fail-closed** ✅ |
| Bireysel veri YOKKEN geri alma | `ROLLBACK OK: iki kolon NOT NULL geri kondu` ✅ |
| ADIM 1 sonrası | `pair_vehicle_to_user=0`, `vehicle_pairings.company_id=0`, `push_vehicle_event` gövdesi **027**'ye döndü ✅ |
