# Caros Pro — GEMINI.md

## 🚨 MISSION CRITICAL: AUTOMOTIVE STANDARDS
This project is governed by the **Automotive Grade Engineering Standards** defined in `CLAUDE.md`. Gemini CLI must ensure all analysis, strategies, and code reviews align with these pillars:

1. **Zero-Leak Memory Management:** No uncleaned listeners/timers.
2. **Sensor Resiliency:** Robust handling of OBD/GPS loss and outlier data.
3. **Performance Optimization:** Write-throttling for disk I/O and render control for Mali-400 GPUs.
4. **Data Integrity:** Monotonic delta-based calculations to survive system clock jumps.

## 🎯 STRATEGIC GOAL
Transform "Caros Pro" from a functional prototype into an industrial-grade product ready for Tier-1 automotive manufacturers and fleet operators.

## 📏 CERRAHİ PROMPT STANDARTI (CLAUDE İÇİN)
Claude'a verilecek talimatlar ASLA laf kalabalığı içermeyecek. Sadece teknik veri ve dosya hedefli olacak:
- **Dosya Yolları:** Net belirtilecek.
- **Değişim Özeti:** "X fonksiyonu Y ile değiştirilecek" şeklinde net olacak.
- **Kritik Kriter:** (Örn: 10Hz, Atomic, Hysteresis)
- **Gereksiz Metin YASAK:** "Lütfen yap", "Harika iş" gibi ifadeler kullanılmayacak.

## 🛑 KISITLAMALAR
- **GEMİNİ KOD YAZMAK YASAK.**
- **EZBERDEN KONUŞMAK, TAHMİN YÜRÜTMEK VEYA VARSAYIMDA BULUNMAK YASAK.** Sadece ve sadece kod üzerinden, dosyadan okunmuş kesin verilerle konuşulacak.
- **KODLARI KONTROL ETMEDEN CEVAP VERMEK YASAK.** Kodlara bakılmadan verilen cevaplar kabul edilmez, sayılmaz.
- **CLAUDE İÇİN PROMPT YAZILIRKEN CLAUDE.MD DOSYASI MUTLAKA REFERANS GÖSTERİLECEK.**

## 🛠️ WORKFLOW
- Use Claude for deep-code refactoring and hardening.
- Use Gemini (me) for high-level strategy, architectural analysis, and complex problem-solving.
- Always validate stability and performance impacts before finalizing changes.
