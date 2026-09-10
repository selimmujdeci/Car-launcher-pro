# CAROS PRO — Geliştirme Stratejisi (Faz A: Developer Platform)

**Durum:** AKTİF · **Yürürlük:** 2026-07-24 · **Otorite:** Bağlayıcı ürün politikası

> CAROS PRO şu an **son kullanıcı ürünü değildir.**
> Aktif olarak geliştirilen profesyonel bir **Vehicle OS / Diagnostic Platform**'dur.

---

## 1. Öncelik Sırası (bağlayıcı)

1. Sağlam mimari
2. Doğruluk
3. Güvenlik
4. Gözlemlenebilirlik (Evidence / Logs)
5. Profesyonel geliştirici araçları
6. Performans
7. Son kullanıcı deneyimi

**UX, tasarım ve sadeleştirme şu an öncelik DEĞİLDİR.**

---

## 2. Developer First

Yeni geliştirilen her özellik **önce geliştirici kullanımına uygun** tasarlanır:

- Teknik ekranlar serbesttir.
- Teknik isimler (PID, DID, NRC, KWP, UDS, seqlock…) kullanılabilir.
- Ham loglar / ham hex trafiği gösterilebilir.

Örnek hedef araçlar: PID/DID Explorer · ECU Explorer · Protocol Explorer ·
Raw OBD Console · Session Inspector · Vehicle Fingerprint Explorer ·
Discovery Database · Runtime Monitor · Queue Monitor · Evidence Viewer ·
Decoder Registry · Stress Test · Benchmark · AI Debug · Tool Calling Debug ·
Memory Explorer.

---

## 3. "Kullanıcı bunu anlamaz" kararı YASAK

Şimdilik hiçbir özellik UX kaygısıyla kısıtlanmaz, gizlenmez veya sadeleştirilmez.
Önce tüm profesyonel altyapı kurulur.

---

## 4. Fazlar

| Faz | Kapsam | Durum |
|-----|--------|-------|
| **Faz A** | Developer Platform (CAROS LAB) | **ŞU AN** |
| Faz B | Servis / Expert Mode | sonra |
| Faz C | Son Kullanıcı deneyimi | sonra |

Bugün yazılan hiçbir araç çöpe gitmez — ileride yalnızca uygun katmana taşınır.

---

## 5. CAROS LAB (tüm geliştirici araçlarının tek çatısı)

Geçici isim: **CAROS LAB**. Kategoriler:

### Vehicle
- Live Data
- PID/DID Explorer
- ECU Explorer
- Protocol Explorer
- Deep Scan
- Vehicle Fingerprint

### Communication
- Raw OBD Traffic
- CAN Monitor
- KWP Monitor
- UDS Explorer
- Session Inspector
- Adapter Diagnostics

### Runtime
- Queue Monitor
- Poll Scheduler
- Recovery Monitor
- Performance
- Evidence Viewer

### AI
- Mavi Console
- Memory Explorer
- Action Registry
- Tool Calling
- Knowledge Explorer

### Developer
- Decoder Registry
- Discovery Database
- Raw Command Console
- Benchmark
- Stress Test
- Replay Log

Liste zamanla büyüyebilir.

---

## 6. Geliştirme Kuralı

Yeni özellik geliştirirken **önce**:

- profesyonel
- detaylı
- gözlemlenebilir
- test edilebilir
- geliştirici odaklı

olarak tasarla. Son kullanıcı ekranı **ayrıca ve sonra** yapılır.

---

## 7. Değişmez İlke

> CAROS PRO önce dünyanın en güçlü geliştirici ve teşhis platformlarından biri olacak.
> Son kullanıcı deneyimi bunun **üzerine** inşa edilecek.

---

## 8. Neyi EZMEZ (invaryantlar korunur)

Bu strateji öncelik sırasını değiştirir; **stabilite invaryantlarını ezmez**:

- fail-soft · zero-leak · atomik/minimal patch · performans bütçesi
- `docs/DEVICE_VALIDATION_LEDGER.md` saha doğrulama kütüğü (🔴 bekleyen özellik
  "çalışıyor" diye sunulamaz)
- `docs/CAROS_PRO_VIZYONU.md` durum seviyeleri ve ÜRÜN HAZIR alanı
- Ticari lisans kuralları (copyleft/NC varlık yasağı)
- Supabase GRANT + RLS + policy zorunluluğu

Geliştirici araçları **satışa giden pakette** yer alacaksa, güvenlik-riskli
uçların (ör. adb açma, ham yazma komutları) kapıları ayrıca değerlendirilir —
"developer first" bu kapıları kaldırmaz, yalnızca ekranların teknik olmasına izin verir.
