# TTS_FIELD_TEST — Head Unit Sesli Cevap / TTS Saha Testi

> **Amaç:** K24 head unit'te neden hiç sesli cevap çıkmadığını KANITLAMAK.
> Telefonda çalışıyor, K24'te sessiz. Kod yazmadan önce hangi halkanın koptuğunu
> (motor yok / stream yanlış / reject) ham logla belirle.
> **Cihaz:** K24 / NWD (K2401). Hazırlık tarihi: 2026-06-25.

---

## 0. Neden bu test (kök neden özeti)

```
SafetyAnnouncer (effect)  →  core.announce()                 safetyAnnouncerCore.ts
   ├─ chime(level) = playSafetyChime → Web Audio API (WebView)   safetyChime.ts   ← AYRI ses yolu
   └─ speak(msg)   = speakSafetyAlert → ttsSpeak()               ttsService.ts:279
            ↓ _isNative === true (K24)
        CarLauncher.speak({text,rate}) → NATIVE Android TextToSpeech  CarLauncherPlugin.java:3060
```

**Kritik ayrım:** Chime **Web Audio** (WebView), TTS **native Android TTS motoru**.
İkisi farklı yoldan çıkar → "chime var mı / TTS var mı" sorusu teşhisi ikiye böler.

Native TTS gerçekleri:
- Init: `status == SUCCESS` değilse `ttsReady` **hiç true olmaz** (CarLauncherPlugin.java:238-256).
  Çin head unit ROM'larında TTS motoru çoğu kez **hiç kurulu değildir**.
- `speak()`: `if (!ttsReady || ttsEngine == null) { call.reject("TTS_NOT_READY"); return; }`
  (CarLauncherPlugin.java:3064).
- JS: `CarLauncher.speak(...).catch(() => settle())` (ttsService.ts:155) → **reject sessizce
  yutulur**, kullanıcıya hata yok → "ses de yok, hata da yok" semptomu.
- `ttsEngine.speak(text, QUEUE_FLUSH, null, utteranceId)` (CarLauncherPlugin.java:3073) →
  params **null** → varsayılan stream. Bazı ROM'larda TTS varsayılan stream'i kısık/route dışı.
- Türkçe verisi yoksa default locale'e düşüp `ttsReady=true` zorlanıyor (242-244) → dil
  eksikliği **tek başına bloklamaz**; motorun hiç olmaması bloklar.

---

## 1. Ön koşullar

- [ ] PC + K24 aynı WiFi. K24 IP: Ayarlar → Cihaz hakkında → IP.
- [ ] adb: `C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- [ ] Medya sesi açık (head unit ses seviyesi 0 değil).

---

## 2. TTS motoru envanteri (cevap üretmeden ÖNCE)

```powershell
$adb = "C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb connect <K24_IP>:5555

# 1) Cihazda TTS motoru kurulu mu?
& $adb -s <K24_IP>:5555 shell "pm list packages | grep -i tts"
& $adb -s <K24_IP>:5555 shell "pm list packages | grep -iE 'texttospeech|svox|pico|google'"

# 2) Varsayılan TTS motoru hangisi?
& $adb -s <K24_IP>:5555 shell settings get secure tts_default_synth

# 3) Varsayılan TTS dili?
& $adb -s <K24_IP>:5555 shell settings get secure tts_default_locale

# 4) Ses stream durumu (kısık/mute teşhisi)
& $adb -s <K24_IP>:5555 shell "dumpsys audio | grep -iE 'STREAM_MUSIC|STREAM_SYSTEM|mute|Ringer'"
```

Beklenen yorum:
- `pm list packages | grep tts` **boş** → **motor hiç yok** (en güçlü aday). Kodla çözülmez.
- `tts_default_synth` = `null`/boş → varsayılan motor atanmamış → init SUCCESS gelmeyebilir.
- Bir motor varsa (örn. `com.google.android.tts`) → motor #2/#3 yolu (stream/dil) muhtemel.

---

## 3. Canlı sesli cevap testi (log akışıyla)

```powershell
& $adb -s <K24_IP>:5555 logcat -c
& $adb -s <K24_IP>:5555 logcat -s CarLauncherPlugin:* NwdCanClient:* OBD:* Safety:* TTS:* TextToSpeech:* AndroidRuntime:*
```

Sonra cihazda:
1. **Normal asistan** sesli cevap üreten bir komut çalıştır (telefonda ses verenle aynısı).
2. **Safety anonsu** tetikle (ör. el freni çekiliyken aracı hareket ettir → `parking_brake.moving`
   kuralı → `voiceAnnouncementAlert` → `speakSafetyAlert`). *(Araçta güvenli ortamda.)*

İzlenecek log kanıtları:
- TTS motoru init: `TextToSpeech` / "onInit" SUCCESS mı, "No engine installed" / "LANG_NOT_SUPPORTED" mı?
- `CarLauncherPlugin` üzerinde `speak` çağrısı geldi mi?
- **`TTS_NOT_READY`** reject var mı? (varsa → motor hazır değil, kesin kanıt)
- `AndroidRuntime` crash var mı?

---

## 4. Gözlem: chime var mı / TTS var mı

| Chime (bip) | TTS (konuşma) | Teşhis | Aksiyon (sonraki, ayrı patch) |
|-------------|---------------|--------|-------------------------------|
| **VAR** | **YOK** | Web Audio çalışıyor, **native TTS motoru/stream sorunlu** (en olası) | §2'ye bak: motor yoksa fail-soft UI uyarısı; motor varsa stream/AudioAttributes |
| **YOK** | **YOK** | WebView+native ses çıkışı **tamamen kısık** → genel stream/route/mute | dumpsys audio + head unit ses ayarı; uygulama dışı |
| **VAR** | **VAR** | Aslında çalışıyor → senaryo/ses seviyesi/tetikleme sorunuydu | tetikleme yolunu doğrula |
| **YOK** | **VAR** | (beklenmez) chime AudioContext suspended olabilir | safetyChime resume akışı |

> `TTS_NOT_READY` logu + `pm list packages | grep tts` boş → **kesin: motor yok** →
> kodla zorla çözmeye çalışma; ROM'a TTS motoru gerekir. Tek yapılabilecek: kullanıcıya
> görsel "TTS motoru yok" uyarısı (fail-soft) + opsiyonel Web Speech fallback denemesi.

---

## 5. Raporlanacak sonuç (bu dosyanın altına doldur)

```
TARİH:
K24 IP:

TTS motoru kurulu mu (pm list grep tts):
Default TTS engine (tts_default_synth):
Default TTS locale (tts_default_locale):
dumpsys audio STREAM_MUSIC/mute durumu:

TTS init SUCCESS mi (logcat):
speakSafetyAlert çağrıldı mı (logcat/JS):
CarLauncher.speak çağrıldı mı (CarLauncherPlugin log):
TTS_NOT_READY reject var mı:
Chime duyuldu mu (evet/hayır):
TTS duyuldu mu (evet/hayır):

KARAR (tablo §4):
```

---

## 6. Kurallar (ZORUNLU)

- **TTS motoru yoksa kodla zorla çözmeye çalışma** (ROM eksikliği).
- TTS **stream'ini değiştirme** — önce logla motor var mı / hangi stream'e gidiyor kanıtla.
- voiceService akışına dokunma; değişiklik gerekirse **CarLauncherPlugin.speak/init**'e izole.
- Safety zinciri (Announcer/Queue/RuleEngine) bu testin konusu değil — sadece çıkış (TTS) halkası.
