# Güvenlik Politikası — CarOS Pro

CarOS Pro ticari bir araç zekâ işletim sistemidir ve güvenlik açıklarını ciddiye
alır. Bu belge, güvenlik açığı bildirim sürecini tanımlar.

## Desteklenen Sürümler

| Sürüm | Güvenlik güncellemesi |
|-------|:---------------------:|
| `main` (aktif geliştirme) | ✅ |
| En son etiketli sürüm (`v1.x`) | ✅ |
| Önceki sürümler | ❌ |

## Güvenlik Açığı Bildirimi

**Güvenlik açıklarını herkese açık GitHub Issue olarak AÇMAYIN.**

Bunun yerine:

1. **GitHub Security Advisories** üzerinden özel bildirim gönderin
   (Repo → *Security* → *Report a vulnerability*), veya
2. **aybarsselimaybars@gmail.com** adresine şifreli/özel e-posta gönderin.

Lütfen bildiriminize şunları ekleyin:

- Açığın türü ve etkilenen bileşen (araç uygulaması / native köprü / website / Supabase);
- Yeniden üretme adımları (mümkünse PoC);
- Olası etki (veri sızıntısı, uzaktan kod çalıştırma, telemetri manipülasyonu vb.);
- Varsa önerilen düzeltme.

## Kapsam (Özel Dikkat)

Bu ürünün güvenliği araç güvenliğiyle doğrudan ilişkilidir. Özellikle önemli alanlar:

- **Zero-trust telemetri** — OBD/CAN/BLE üzerinden gelen güvenilmez sensör verisi;
- **Uzaktan komut** (`TECHNICAL_SPEC_REMOTE_COMMAND.md`) ve companion PWA köprüsü;
- **Supabase RLS / GRANT** politikaları (bkz. `CLAUDE.md` §Supabase Security);
- **BYOK API anahtarları** — kullanıcı anahtarlarının cihaz içinde saklanması;
- **Güvenlik-kritik sürüş katmanları** (overheat, düşük yağ basıncı, reverse overlay).

## Yanıt Süreci

- **48 saat** içinde bildirim alındı onayı;
- **7 gün** içinde ilk değerlendirme ve önem derecesi;
- Düzeltme sonrası, bildirende aksini istemedikçe, sorumlu ifşa (responsible disclosure).

## Kapsam Dışı

- Sosyal mühendislik / fiziksel erişim gerektiren saldırılar;
- Kullanıcının kendi BYOK anahtarını ifşa etmesi;
- Üçüncü taraf head unit OEM firmware'inin kendi açıkları.

---

> Güvenlik açığı bildirimleri, `CLAUDE.md` zero-trust telemetri ve zero-leak
> mühendislik standartlarıyla değerlendirilir.
