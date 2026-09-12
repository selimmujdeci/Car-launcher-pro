# CarOS Pro — Dış Müşteri REST API'si (v1)

> **Durum:** v1 · **SALT-OKUNUR** · kütük **#719**
> Sunucu tarafı kurulup kilitlendi; **gerçek bir müşteri anahtarıyla uçtan uca
> ölçülmedi** — kabul ölçütleri kütükte açık.

Bu API, bir filo müşterisinin **kendi verisini** kendi sistemine çekmesi içindir.
Araç içi cihazın kullandığı anahtarla **hiçbir ilgisi yoktur**.

---

## 1. Neden ayrı bir anahtar sınıfı

`vehicles.api_key` bir **cihaz** anahtarıdır: tek bir aracı temsil eder, head
unit'te durur ve o anahtarla **telemetri yazılır**. Bir müşteri entegrasyonuna
onu vermek, müşteriye **cihazın kimliğini** vermek olurdu.

Bu yüzden ayrı bir sınıf açıldı: **şirket kapsamlı · salt-okunur · iptal
edilebilir**.

---

## 2. Anahtar yönetimi

Anahtarı **yalnız `admin` veya `super_admin`** rolündeki bir kullanıcı
oluşturabilir. `member` oluşturabilseydi, şirketin tüm verisini dışarı
taşıyabilirdi.

| İşlem | RPC |
|---|---|
| Oluştur | `create_company_api_key(p_name, p_raw_key, p_scopes, p_rate_limit)` |
| Listele | `list_company_api_keys()` |
| İptal et | `revoke_company_api_key(p_key_id)` |

**Ham anahtar yalnız oluşturma anında BİR KEZ görünür.** Veritabanında yalnız
**SHA-256 özeti** saklanır; kaybedilen anahtar geri getirilemez, yenisi üretilir.

Listede yalnız **ilk 8 karakter** (`key_prefix`) görünür — hangi anahtarı iptal
ettiğinizi bilmeniz için. Bu önek **tek başına işe yaramaz**.

**İptal edilen anahtar SİLİNMEZ**, yalnız `revoked_at` işaretlenir: bir sızıntı
soruşturmasında izin yok olmaması için.

---

## 3. Kimlik doğrulama

```http
GET /api/v1/vehicles HTTP/1.1
Host: <alan-adiniz>
Authorization: Bearer <api_key>
```

Anahtar **yalnız** `Authorization: Bearer` başlığıyla gönderilir. Sorgu
parametresiyle gönderilmez — URL'ler sunucu günlüklerine, tarayıcı geçmişine ve
`Referer` başlığına düşer.

---

## 4. Kapsamlar

| Kapsam | Ne verir |
|---|---|
| `read:vehicles` | Şirketin araç listesi |
| `read:trips` | Şirketin yolculuk kayıtları |

**Yazma kapsamı BİLİNÇLİ OLARAK YOKTUR.** Dış bir anahtarla araca komut yazmak
çok daha geniş bir güvenlik yüzeyidir ve bu sürümün kapsamı dışındadır.

Bilinmeyen bir kapsam sessizce yok sayılmaz; anahtar oluşturma **reddedilir**.

---

## 5. Uçlar

### `GET /api/v1/vehicles` — kapsam `read:vehicles`

```json
{ "data": [ { "id": "…", "name": "…", "plate": "…", "created_at": "…" } ] }
```

### `GET /api/v1/trips` — kapsam `read:trips`

| Parametre | Varsayılan | Tavan |
|---|---|---|
| `limit` | 100 | **500** (sunucuda kırpılır) |
| `vehicle_id` | — | yalnız kendi şirketinizin aracı |

```json
{
  "data": [{
    "id": "…", "vehicle_id": "…",
    "started_at": "…", "ended_at": "…",
    "distance_km": 12.4,  "distance_source": "MEASURED",
    "fuel_used_l": 0.9,   "fuel_source": "ESTIMATED",
    "estimated_cost": 40.5, "cost_source": "ESTIMATED",
    "driver_attribution_status": "UNKNOWN"
  }],
  "limit": 100
}
```

> ### ⚠️ `*_source` alanlarını GÖRMEZDEN GELMEYİN
> Her ölçüm kendi **kaynağını** taşır: `MEASURED` (araçtan ölçüldü) ·
> `ESTIMATED` (hesaplandı) · `UNAVAILABLE` (yok).
> Bugün üretimde **yakıt ve maliyet `ESTIMATED`**tir ve birim fiyat
> **varsayılandır**. Bu alanları atıp yalnız sayıyı kullanmak, tahmini ölçüm
> gibi göstermek olur. Bunlar bu yüzden API'de **gizlenmedi**.

---

## 6. Hız sınırı

Anahtar başına **dakikalık** sabit pencere (varsayılan **60/dk**).

| Başlık | Anlamı |
|---|---|
| `X-RateLimit-Limit` | Dakikalık üst sınır |
| `X-RateLimit-Remaining` | Bu pencerede kalan |
| `Retry-After` | 429 aldığınızda kaç saniye sonra deneyeceğiniz |

Sayaç **atomik** artar: eşzamanlı istekler sayacı kaybetmez.

---

## 7. Hatalar

```json
{ "error": { "code": "INVALID_KEY", "message": "API anahtarı geçersiz." } }
```

| HTTP | `code` | Anlamı |
|---|---|---|
| 401 | `MISSING_KEY` | `Authorization` başlığı yok/bozuk |
| 401 | `INVALID_KEY` | Anahtar geçersiz **veya iptal edilmiş** |
| 401 | `SCOPE_NOT_GRANTED` | Anahtarda bu kapsam yok |
| 429 | `RATE_LIMITED` | Dakikalık sınır aşıldı |
| 503 | `SERVICE_UNAVAILABLE` | API geçici olarak hizmet veremiyor |

**Geçersiz ve iptal edilmiş anahtar AYNI cevabı alır.** Ayırmak, saldırgana
hangi anahtarların var olduğunu söylerdi.

**Yapılandırma eksikse kapı açılmaz (503).** Bir API kapısının "emin değilim,
geçir" demesi, kapı olmaması demektir.

---

## 8. Yanıt önbelleklenmez

Tüm başarılı yanıtlar `Cache-Control: no-store` taşır: filo verisi anlıktır ve
ara katmanlarda saklanmamalıdır.

---

## 9. Bilinen sınırlar (dürüstçe)

- **v1 salt-okunurdur.** Yazma yok.
- **Sayfalama basittir**: `limit` var, imleç (cursor) yok. Büyük veri kümelerinde
  `vehicle_id` ile daraltın.
- **Webhook yok.** Değişiklikleri sorgulayarak (polling) alırsınız.
- Kapsamlar **araç bazında daraltılamaz**; şirket geneli okur.
- **Gerçek bir müşteri anahtarıyla uçtan uca ölçülmedi** (kütük #719).
