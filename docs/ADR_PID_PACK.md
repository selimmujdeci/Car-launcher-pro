# ADR-PID-PACK — Sinyal Tanım Paketi (PID/DID)

**Durum:** TASARIM (karara sunuldu)
**Tarih:** 2026-08-09
**Kapattığı çatal:** cihazda kanıt üretimi tek sinyalle (akü voltajı) sınırlı → `VEHICLE`
kapsamı 7 beklenen kategoriden **1'ini** dolduruyor → `buildVehicleVerdict` hükmü
`INSUFFICIENT_EVIDENCE`den çıkamıyor. Genişlik gerekli.
**İlgili:** ADR-286 (karar otoritesi) · kütük #490 · #497 · #501 · P1-1 (`samples: []`)
**Bağlayıcı çerçeve:** ADR-286 §4.1 (tek yorumlayıcı) · CLAUDE.md ticari lisans kuralı ·
gözlemlenebilirlik kuralı (7 şart)

> Bu belge **tasarımdır**. Kod yazılmadı, şema değiştirilmedi, commit atılmadı.

---

## 0. Yönetici özeti — bu ADR'nin üç sürprizi

Kodu okumadan önce beklenen iş *"yüzlerce yeni PID tanımı eklemek"*ti. Ölçüm başka
bir tablo gösterdi:

1. **Tanımların çoğu ZATEN VAR.** Hedeflenen beş kategoriden dördü (`ARIZA KAYDI`,
   `HAZIRLIK`, `TERMAL`, `YAKIT TRİMİ`) için gereken J1979 tanımlarının neredeyse
   tamamı `StandardPidRegistry.ts` + `StandardPidEnums.ts` içinde **bugün mevcut ve
   testli**. Eksik olan tanım değil; (a) tanımların **veri** olmayışı, (b) değerlerin
   **akmıyor** oluşu (P1-1), (c) kategori başına **kanıt modelinin** yazılmamış olması.
2. **Veri-güdümlü yorumlayıcı da ZATEN VAR.** `vehicleDidProfile.ts` doğrulayıcı +
   derleyici + **eval'siz beyaz-liste çözücü** kümesiyle tam olarak istenen deseni
   uyguluyor. İkinci yorumlayıcı yazmak yerine **bu genişletilir**. Asıl aykırı duran
   `StandardPidRegistry.ts`'tir: o **kod**, kapanış (closure) taşıyor — yani bugün
   sistemde **iki tanım biçimi ve iki örtük yorumlayıcı** var. ADR-286 kural 3 ihlali
   PID tarafında **şu an yürürlükte**.
3. **`provenance` adı ÇAKIŞIYOR.** `aiEvidence.ts` içinde `EVIDENCE_PROVENANCES =
   MEASURED | DERIVED | ESTIMATED | UNKNOWN` **zaten var** ve *ölçüm kalitesi*
   demek; `provenanceConfidenceCeiling('DERIVED')` → **`HIGH`**. Görev tanımındaki
   `DERIVED` ise *"topluluk/tersine mühendislik, doğrulanmamış"* demek — yani en
   **güvenilmez** sınıf. Aynı sözcük, iki eksen, **zıt** anlam. Bu ad birebir
   alınsaydı, topluluk formülünden gelen bir değer sessizce `HIGH` güven tavanı
   kazanırdı. → **Yeni eksenin adı `provenance` DEĞİL, `defTrust`; `DERIVED` değeri
   `COMMUNITY` olarak adlandırılır.** (§1.2 — çerçeveden bilinçli tek sapma, gerekçe orada.)

---

## 1. Karar

1. **Tanımlar VERİDİR.** Tek şema (`SignalDefPack`), tek yorumlayıcı
   (`vehicleDidProfile`'ın genişletilmişi). Yeni araç desteği = yeni **paket sürümü**,
   kod değişikliği değil.
2. **Her tanım `defTrust` taşır:** `STANDARD` · `COMMUNITY` · `FIELD_VERIFIED`.
3. **`COMMUNITY` tanımdan gelen değer GÖSTERİLİR, KANIT OLMAZ.** Ayrım kanıt
   omurgasının *içinde* değil, **girişinde** yapılır (§4). Motor değişmez, ikinci
   güven otoritesi doğmaz.
4. **Eşleme kanıtla daraltılır, isabetle değil.** Hiçbir tanım, o araçta **kendini
   kanıtlamadan** kanıt üretemez (§3.3).
5. **Terfi cihazda OLMAZ.** Cihaz yalnız **biriktirir ve raporlar**; `FIELD_VERIFIED`
   damgasını yalnız imzalı bir paket sürümü verir. **Düşürme (demotion) cihazda olur
   ve anındadır** — asimetri kasıtlıdır (§5).
6. **Lisans saflığı kayıtta taşınır:** her tanım `sourceRef` + `license` alanı
   zorunludur; alanı boş tanım **derlenmez** (bugünkü `source` zorunluluğunun
   sertleştirilmiş hâli).
7. **Paket kendi poll döngüsünü KURMAZ.** Talep-güdümlü mevcut modele (`watchPid`/
   `watchDid`) abone olur; boşta maliyet **sıfır** kalır (Mali-400 sözleşmesi).

---

### 1.1 Neden Car Scanner değiliz (tasarımın ayırt edici noktası)

Bir okuyucu için tanım tek şey yapar: **hex → sayı**. Bizde tanım **dört** şey yapar:

| Okuyucu (Car Scanner sınıfı) | CarOS Pro `SignalDefPack` |
|---|---|
| formül | formül **+ kaynağı + lisansı + güven sınıfı** |
| değeri gösterir | değerin **hüküm kurup kuramayacağına** karar verir |
| "destekliyor mu" = evet/hayır | 7 sonuçlu `capabilityOutcome` + araçta **kendini kanıtlama** |
| topluluk listesi = gerçek | topluluk listesi = **iddia**; terfi mekanizması var (§5) |

Fark tek cümlede: **okuyucu tanımına inanır, biz tanımımızı sorgularız.**

### 1.2 Ad çakışması — çerçeveden tek sapma ve gerekçesi

Görev tanımı provenance değerlerini `STANDARD · DERIVED · FIELD_VERIFIED` diye verdi.
`DERIVED` sözcüğü **alınamaz**:

```
aiEvidence.ts:93   EVIDENCE_PROVENANCES = ['MEASURED','DERIVED','ESTIMATED','UNKNOWN']
aiEvidence.ts:127  provenanceConfidenceCeiling('DERIVED') → 'HIGH'
```

Bu eksen *ölçümün nasıl elde edildiğini* söyler (sensör mü, ECU hesabı mı) ve
`deriveEvidenceConfidence`'ın üç girdisinden biridir. Yeni eksen ise *formülün nereden
geldiğini* söyler. İkisi **bağımsızdır**: J1979 standardındaki `PID 04` tanımı
`defTrust = STANDARD` ama `measurementKind = DERIVED`'dir (ECU hesaplıyor). Aynı
sözcük iki eksende zıt yönde kullanılırsa, çakışma bir gün mutlaka `HIGH` tavanı
yanlış tarafa verir.

**Karar:** yeni eksen `defTrust`; değerler `STANDARD | COMMUNITY | FIELD_VERIFIED`.
Mevcut `provenance` alanı **hiç dokunulmadan** kalır ve pakette `measurementKind`
adıyla **tanım başına** beyan edilir (bugün `batteryEvidenceSource.ts:181`'de
`'MEASURED'` sabit yazılı — tanıma taşınması bir iyileştirmedir: sadece tanım,
PID'in sensör mü hesap mı olduğunu bilir).

---

## 2. (a) Paket şeması

### 2.1 PID ve DID: aynı şema, ayrı erişim ayrımı — gerekçe

**Karar: TEK şema, `access` alanında ayrımlı birleşim (discriminated union).**

Ayrı şema *savunulabilir* görünüyor çünkü erişim gerçekten farklı:

| | Mode 01 PID | UDS 0x22 DID | KWP 0x21 LID |
|---|---|---|---|
| kimlik genişliği | 1 bayt (`05`) | 2 bayt (`F190`) | 1 bayt (`80`) |
| adresleme | fonksiyonel yayın (7DF) | ECU'ya özgü tx/rx | KWP 3-bayt başlık |
| destek keşfi | **bitmask** (`0100/0120/…`) | bitmask **YOK** → yoklama | yoklama |
| tazelenme | 250 ms–1 s | saniyeler | saniyeler |
| olumsuz yanıt | `NO DATA` | `7F xx NRC` | `7F xx NRC` |

Ama bu farkların **tamamı erişim katmanındadır**. Anlam katmanı — ad, birim, formül,
aralık, geçerlilik koşulu, kategori, güven sınıfı, kaynak, lisans, sürüm — **birebir
aynıdır**. Ayrı şema seçmek, aynı anlam katmanını iki kez tanımlamak ve iki kez
yorumlamak demektir: ADR-286 kural 3'ün PID/DID ekseninde yeniden ihlali.

Karşı-gerekçe de zayıf değil ama yeterli değil: *"tek şema, PID'e ait olmayan alanları
(tx/rx) PID kayıtlarında `''` bırakır"*. Cevap: bu zaten **bugünkü davranış** —
`vehicleDidProfile.ts:140` `tx: ''`'i (varsayılan oturum adreslemesi) meşru bir değer
olarak kabul ediyor ve `ECU_ADDR_RE` bunu doğruluyor. Ayrımlı birleşim bunu `''`
kaçamağı olmadan **tipli** hâle getirir, yani tek şema aslında bugünkünden **daha**
sıkı olur.

**Emsal:** `vehicleDidProfile` bir şema içinde `service: '22' | '21'` ayrımını **zaten**
taşıyor. `'01'` eklemek yeni bir hamle değil, mevcut hamlenin üçüncü adımıdır.

### 2.2 Bir tanımın alanları

Kavramsal şekil (alan adları tasarım niyetini gösterir; `⊕` = mevcut şemada var,
`✚` = yeni):

```
SignalDef {
  ── kimlik ─────────────────────────────────────────────────────────────
  key            ✚ "J1979:01:05"          // kararlı, sürümler arası aynı
  signal         ✚ "COOLANT_TEMP_C"       // KANONİK ANLAM kimliği (çapraz tanığın anahtarı)
  access         ✚ ayrımlı birleşim:
                     | { kind:'mode01', pid:'05' }
                     | { kind:'uds22',  did:'F190', ecu:'engine' }
                     | { kind:'kwp21',  lid:'80',   ecu:'engine' }
                     | { kind:'native', decoder:'PID01' }   // bit alanı — §2.4
  ── anlam ──────────────────────────────────────────────────────────────
  name           ⊕ "Soğutma sıvısı sıcaklığı"
  unit           ⊕ "°C"
  bytes          ⊕ 1
  min / max      ⊕ -40 / 215
  category       ⊕ "sicaklik"
  dynamics       ✚ 'varying' | 'static'   // terfi makullük kontrolünün girdisi (§5)
  ── çözüm ──────────────────────────────────────────────────────────────
  decode         ⊕ { fn:'temp40' }        // BEYAZ LİSTE — eval/DSL YASAK
  validWhen      ✚ ['ALWAYS']             // SINIRLI kod kümesi, ifade dili DEĞİL
  ── güven ve köken ─────────────────────────────────────────────────────
  defTrust       ✚ 'STANDARD'
  measurementKind✚ 'MEASURED'             // = mevcut EvidenceProvenance ekseni
  sourceRef      ⊕ "SAE J1979 Tablo B.1"  // bugün profil düzeyinde; tanım düzeyine iner
  license        ✚ "SPEC-PUBLIC"          // SPDX kimliği veya SPEC-PUBLIC
  verification   ✚ null | { classKey, vehicles, cycles, samples, packVersion, date }
  ── kanıt köprüsü ──────────────────────────────────────────────────────
  evidence       ✚ null | { category:'TEMPERATURE', metric:'coolant_temp_c' }
}
```

`SignalDefPack` (kapsayıcı) — ADR-286 `RulePack` deseniyle **birebir tutarlı**:

```
SignalDefPack {
  packVersion    "SP-2026.08.09"
  schemaVersion  1
  applicability  { protocols:[...], classKeys:[...], vinWmi:[...] }   // §3
  ecus           ⊕ VehicleEcuDef[]
  defs           SignalDef[]
  checksum       "<sha256 of canonical JSON>"
}
```

### 2.3 `validWhen` neden bir ifade dili DEĞİL

Geçerlilik koşulu (*"motor çalışırken oku"*) bir mini dil olarak tasarlanmaya çok
uygundur — ve tam olarak bu yüzden yasaktır. ADR-286 §4.1: *"karar sırasını veriye
çevirmek ikinci bir yorumlayıcı yazmak demektir."* Aynı şey koşul için de geçerlidir:
`"rpm > 400 && speed == 0"` bir ifade **ayrıştırıcısı** ister, ayrıştırıcı bir
**değerlendirici** ister, değerlendirici bir **ikinci motordur**.

Bunun yerine **sınırlı kod kümesi** (`decode.fn` beyaz listesiyle aynı desen):

| Kod | Anlamı | Kimden okunur |
|---|---|---|
| `ALWAYS` | koşulsuz | — |
| `ENGINE_RUNNING` | rpm > 0 kanıtlı | `obdService` anlık görüntüsü |
| `ENGINE_OFF` | rpm = 0 kanıtlı | aynı |
| `VEHICLE_STOPPED` | hız = 0 kanıtlı | aynı |
| `WARMED_UP` | soğutma sıvısı ≥ 70 °C | aynı |

Yeni bir koşul gerekirse **kod eklenir ve testi yazılır**. Kombinasyon `VE` ile
sınırlıdır (dizi = hepsi sağlanmalı); `VEYA`/`DEĞİL` yoktur — bu ikisi eklendiği anda
elde bir dil olur.

**Fail-closed:** koşul **bilinemiyorsa** (rpm okunamıyor) tanım okunmaz ve bu bir
`skip` olarak **sayılır**; *"koşul bilinmiyor → herhâlde sağlanıyordur"* üretilmez.

### 2.4 Bit alanları pakete GİRMEZ — ve bunun bir bedeli var

`PID 01` (MIL + DTC sayısı + hazırlık monitörleri) ve `PID 41` **skaler değildir**.
Bugün skaler şemaya sıkıştırılmış olmalarının bedeli kodda **yazılı olarak** duruyor:

```
StandardPidRegistry.ts:69-70
  `01` bir BİT ALANIDIR; bu katalog tek sayı döndürdüğü için ondan yalnız
  KARAR DEĞERİ olan "arıza kodu sayısı" (A & 0x7F) çıkarılır — MIL bayrağı ayrı
  bir sayıya sıkıştırılıp UYDURULMAZ.
```

`PID 41` ise `popcount(b[1] & 0x70) + popcount(b[2] & b[3])` ile *"hazır olmayan
monitör sayısı"*na indirgenmiş — **hangi** monitörün hazır olmadığı bilgisi atılmış.

**Karar:** bit/enum PID'leri pakette **skaler tanım olarak modellenmez**. `access.kind
= 'native'` ile mevcut testli çözücülere (`decodePid01` · `decodePid03` · `decodePid1C`)
**referans verilir**. Paket bu PID'lerin *anlamını, güvenini, kaynağını ve kanıt
eşlemesini* taşır; *çözümünü* taşımaz.

**Bedeli dürüstçe:** bu, "her tanım veridir" iddiasında bir **delik**tir. Bit alanı
çözücüleri kod olarak kalır ve yeni bir bit alanı **kod değişikliği gerektirir**.
Alternatif — bit alanı için ikinci bir şema (`bits: [{bit, signal, meaning}]`) — daha
saf olurdu ama benzin/dizel'e göre **anlamı değişen** C/D baytlarını (`StandardPidEnums.ts:16-22`)
ifade etmek için yine koşullu mantık isterdi. Delik bilinçli seçildi; sayısı azdır
(bugün 3 çözücü) ve `docs/CAROS_PRO_VIZYONU.md`'ye **açık borç** olarak yazılır.

---

## 3. (b) Araç eşleme

### 3.1 Hangi sinyal otoritedir — sıralı cevap

**Tek otorite yoktur; veto edenler ve seçenler ayrılır.**

| Sıra | Sinyal | Rolü | Neden bu rol |
|---|---|---|---|
| 1 | **Protokol sınıfı** (`activeProtocol`) | **VETO** | CAN başlıklı profili KWP hattına göndermek `COMM_ERROR` fırtınasıdır — *sahada ölçüldü* (`manufacturerPidService.ts:54-75`: 6 başarısız deneme 5,4 sn'de bant genişliğinin yarısını yedi, tazelik 47 sn'ye uzadı, link koptu). Eşleşmezse paket **hiç** uygulanmaz |
| 2 | **ECU yanıt parmak izi** (yanıt veren tx/rx, `0100` bitmask, `PID 1C` OBD standardı, Mode 09 varlığı) | **EN GÜÇLÜ SEÇİCİ** | Aracın **yaptığı** şeydir, iddia ettiği değil. Bitmask bir *ölçümdür* |
| 3 | **VIN** | **ÖNBELLEK ANAHTARI — seçici DEĞİL** | VIN'in WMI'si üreticiyi söyler; **hangi ECU yazılım seviyesinin takılı olduğunu SÖYLEMEZ**. Filo aracında ECU değişir, VIN değişmez. `hashVin` (mevcut) öğrenilmişi saklamak için doğru anahtardır; formül seçmek için **yanlış** otoritedir |
| 4 | **Kullanıcı seçimi** (`settings.manufacturerDidProfileId`) | **ÜST-BELİRLEYİCİ, ama vetoyu AŞAMAZ** | İnsan bilgisi değerlidir; ama protokol vetosunu ve makullük kapısını (§3.3) aşamaz — kullanıcı yanlış marka seçtiğinde uydurma değer üretilmemelidir |

> **Neden VIN otorite değil — bu ADR'nin en kolay yanlış yapılacak kararı.** VIN'i
> otorite yapmak sezgisel ve kolaydır; her ticari okuyucu bunu yapar. Bizim hedefimiz
> **bilinmeyen** araçtır: VIN'in çözümlenemediği, WMI'nin tanınmadığı, aftermarket
> ECU'lu araç. VIN otorite olsaydı, VIN okunamayan araçta sistem **hiçbir şey**
> yapamazdı. ECU davranışı otorite olduğunda, VIN'siz araçta bile keşif çalışır.

### 3.2 Sınıf anahtarı

Öğrenilmiş bilgi **araç sınıfı** düzeyinde saklanır, tek araç düzeyinde değil:
`classKey = "mmy:MARKA|MODEL|YIL"` (bu biçim üründe **zaten var** —
`navigationCoreSources.ts` `mmy:FIAT|DOBLO|2016`). Fingerprint (`hashVin`) araç
düzeyi anahtardır ve `discoveredDataRepository` bunu **zaten** kullanıyor.

İkisi farklı iş görür: **fingerprint** *"bu araçta bu tanım çalıştı mı"*yı, **classKey**
*"bu sınıfta bu tanım kaç araçta çalıştı"*yı (terfi girdisi, §5) tutar.

### 3.3 Yanlış eşleme riski nasıl kapatılır

**Kapatılmaz — daraltılır.** Bilinmeyen araç varsayımı altında eşleme **her zaman**
bazen yanlış olacaktır. Bu yüzden savunma eşlemede değil, **tanım başına aktivasyon
kanıtında**dır:

```
CANDIDATE ──(kanıt)──> ACTIVE ──(çelişki)──> REJECTED
    │                                            ▲
    └────────────(ilk okumada sınır dışı)────────┘
```

Bir tanım `CANDIDATE` doğar. `ACTIVE` olması için **hepsi** gerekir:

1. Çözülen değer `min..max` içinde (mevcut `decodeCompiledDid` bunu **zaten** yapıyor —
   sınır dışı `NaN` döner),
2. `validWhen` koşulları **kanıtlı** olarak sağlanmış,
3. `capabilityOutcome` = `working` (mevcut sözlük; `timeout` **kanıt sayılmaz**,
   `isCapabilityEvidence` — mevcut),
4. **Çapraz tanık** varsa uyumlu (§3.4).

`CANDIDATE` iken değer **gösterilir** (Faz A: ham hex ve çözüm serbesttir) ama
**kanıt olmaz**. `COMMUNITY` kapısıyla aynı çatal, aynı yer (§4.2) — iki ayrı kapı değil.

`parse_error` veya sınır dışı → tanım o **fingerprint** için `REJECTED`, kalıcı
(`discoveredDataRepository`, mevcut). Yeniden denenmez; israf ve yanlış değer riski
birlikte kapanır.

### 3.4 Çapraz tanık (`signal` alanının asıl işi)

İki bağımsız tanım aynı `signal`'i iddia ediyorsa (ör. `BATTERY_VOLTAGE_V` için hem
adaptörün `ATRV`si hem `PID 42` kontrol ünitesi voltajı; ya da `OIL_TEMP_C` için hem
`PID 5C` hem marka DID'i):

- **Uyumlu** (fark < beyan edilen tolerans) → ikisi de `ACTIVE`; **daha yüksek
  `defTrust`lu** olan kanıt üretir, diğeri **sessiz tanık** kalır. İki kanıt
  yazılmaz — aynı metriğin iki aktif kaydı motorda `REVISION_DIVERGENCE` çelişkisi
  doğurur (bu tuzak `batteryEvidenceSource.ts:205-210`'da **zaten** ölçülmüş ve
  `SUPERSEDED` ile çözülmüş).
- **Uyumsuz** → **ikisi de `CANDIDATE`'e düşer, hiçbiri hüküm kurmaz.** Bir
  `STANDARD` tanık bir `COMMUNITY` tanımla çelişiyorsa `COMMUNITY` olan doğrudan
  `REJECTED` olur — güvenilir bir çelişki, sıradan bir uyumsuzluktan güçlüdür.

Bu mekanizma yeni bir güven otoritesi kurmaz: yalnızca **hangi kanıdın yazılacağını**
seçer. Güven yine `deriveEvidenceConfidence`ten gelir.

---

## 4. (h) Kanıt omurgasına bağlantı

### 4.1 Bir okumanın kanıda dönüşme yolu

Şablon `batteryEvidenceSource.ts` — **yeniden yazılmaz, çoğaltılır**:

```
  native (obdExtendedData / readObdDid)
      │  ham hex
      ▼
  paket yorumlayıcısı  ── decode (beyaz liste) ── min/max ── validWhen
      │  { signal, value, atMs, defTrust, measurementKind }
      ▼
  ╔═ KAPI 1: defTrust ═══════════════════════════════════════════════╗
  ║  COMMUNITY  →  gösterim hattı (UI/LAB). KANIT HATTINA GİRMEZ.    ║
  ║  CANDIDATE  →  aynı şekilde (§3.3)                               ║
  ╚═══════════════════════════════════════════════════════════════════╝
      │  STANDARD | FIELD_VERIFIED ve ACTIVE
      ▼
  <kategori>EvidenceModel   (SAF: I/O yok, Date.now yok — batteryEvidenceModel deseni)
      │  { produce, severity, sampleCount, metric, value } | { skip, reason }
      ▼
  <kategori>EvidenceSource
      │  AiEvidence adayı kurulur:
      │    source          = 'TELEMETRY'
      │    category        = def.evidence.category
      │    metric          = def.evidence.metric
      │    provenance      = def.measurementKind      ← tanımdan, sabit DEĞİL
      │    confidence      = deriveEvidenceConfidence(...)   ← TEK otorite
      ▼
  ╔═ KAPI 2: validateEvidenceInput  (mevcut, zorunlu, sayaçlı) ══════╗
      │  accepted
      ▼
  aynı metriğin eski ACTIVE kaydı → SUPERSEDED  (mevcut desen)
      │
      ▼
  yerel kanıt defteri  →  maviReasoningEngine
```

### 4.2 `defTrust` kapısı neden **girişte**, motorun içinde değil

Alternatif tasarım: `COMMUNITY` kanıtı deftere yaz, güven tavanını `LOW`a çek, motor
karar verirken dikkate alsın. **Reddedildi**, iki nedenle:

1. **Tavan tek başına YETMEZ.** `canActivate` yalnız `confidence === 'UNKNOWN'`i
   reddeder (`aiEvidence.ts:270`). `LOW` güvenli bir kanıt **aktif olur ve hüküm
   kurabilir** — yani *"gösterilir ama hüküm kuramaz"* şartı sağlanmazdı.
2. Motorun içine `defTrust` bakan bir dal eklemek, **ikinci bir güven otoritesi**
   yaratır (çerçeve madde 3'ün ihlali) ve TS↔SQL parite matrisine yeni bir eksen
   sokar.

Kapı girişte olunca motor **hiç değişmez**, parite bozulmaz, tek yer değişir.

**Yine de tavan EKLENİR — ikinci katman olarak.** `defTrustConfidenceCeiling`:
`STANDARD` → `VERY_HIGH` · `FIELD_VERIFIED` → `VERY_HIGH` · `COMMUNITY` → `LOW`,
ve `deriveEvidenceConfidence`'a **dördüncü en-zayıf-halka** olarak katılır. Kapı
sağlamken bu bir **no-op**tur; amacı gelecekte kapıyı atlayan bir yol açılırsa
sessiz kalmamaktır. Bu, projenin kendi deseni: `evidenceInputGuard.ts:85-88` —
*"`default` dalları bir güvenlik ağıdır; asıl kapı burasıdır."*

### 4.3 `evidenceInputGuard` ile ilişkisi — değişmez, ama yetmez

`validateEvidenceInput` **union üyeliği** doğrular (`category`/`source`/`severity`/
`provenance`/`state` tanınan değer mi). Paket tanımı bozuksa üretilen kanıt **union
uyumlu ama yanlış** olabilir — ör. yanlış formül `TEMPERATURE` kategorisinde
`180 °C` yazar; guard bunu **kabul eder**, çünkü tipler doğrudur.

Yani guard **şema sürüklenmesini** yakalar, **anlam hatasını** yakalamaz. Anlamı
kapayan §3.3 (aralık + koşul + çapraz tanık) ve §5'tir. İkisi **tamamlayıcıdır**;
guard'a yeni sorumluluk yüklenmez (o dosya saf ve dar kalmalı).

### 4.4 `AiEvidence` şeması değişmiyor — ve bunun kaybı

`defTrust` **`AiEvidence`'a alan olarak EKLENMEZ**. Gerekçe: kapı sayesinde deftere
yalnız `STANDARD | FIELD_VERIFIED` girer → değer **türetilebilir**; alan eklemek
`EVIDENCE_VERSION` artışı + SQL aynası + parite matrisi etkisi demektir.

**Kaybı dürüstçe:** bir tanım sonradan **düşürülürse** (§5), o tanımla üretilmiş eski
kanıtlar geriye dönük ayırt edilemez. Telafi: **düşürme, o metriğin aktif kanıtlarını
`EXPIRED` yapar** (mevcut durum makinesinde meşru geçiş, silme değil — sözleşme
kuralı 4 korunur). Filo yüklemesi geldiğinde alan gerekebilir → §9 bilinmeyen (B6).

---

## 5. (c) Terfi mekanizması — `COMMUNITY` → `FIELD_VERIFIED`

Bu bölüm tasarımın en özgün parçasıdır ve en kolay kendini kandıracak yerdir.

### 5.1 Terfi neyin hakkındadır

Terfi **tanım hakkında değil**, `(tanım, araç sınıfı)` **çifti** hakkındadır. Bir
formülün Renault Trafic'te doğru olması, Fiat Doblo'da doğru olduğunu göstermez.
`verification` bloğu bu yüzden `classKey` taşır.

### 5.2 Beş kapı (hepsi geçilmeli)

| # | Kapı | Eşik | Neden bu |
|---|---|---|---|
| K1 | **Hacim** | ≥ 20 kabul edilmiş örnek · ≥ 3 ayrı kontak çevrimi · ≥ 2 ayrı fingerprint | Tek oturum **takılı sensörü** ayırt edemez; tek araç **modifiyeli** olabilir. 20, `sampleConfidenceCeiling`in `VERY_HIGH` eşiğinin (5) belirgin üstünde — orada **değeri**, burada **formülü** doğruluyoruz |
| K2 | **Aralık makullüğü** | tüm örnekler `min..max` içinde **ve** `dynamics:'varying'` ise gözlenen varyans > 0 | 20 örnek boyunca **sabit** bir sayı, doğru formülün değil **sabitin** kanıtıdır. `dynamics:'static'` (VIN, parça no) beyan edilmişse sabitlik **beklenen**dir |
| K3 | **Fiziksel tutarlılık** | tanımın beyan ettiği kontrol kodları geçmeli | Sınırlı kod kümesi (ifade dili değil): `MONOTONIC_WARMUP` (soğuk çalıştırmadan sonra artar) · `CORRELATES_RPM` · `CORRELATES_SPEED` · `ZERO_AT_ENGINE_OFF` · `WITHIN_AMBIENT_BAND`. **Hiç kod beyan etmeyen tanım terfi edemez** — kontrolsüz terfi, kontrolsüz iddiadır |
| K4 | **Çapraz tanık** | aynı `signal` için `STANDARD` tanık varsa sapma tolerans içinde | Tanık **çelişiyorsa** sonuç terfi-yok değil, **doğrudan `REJECTED`**: güvenilir bir çelişki elimizdeki en güçlü bilgidir |
| K5 | **Öz-referanssızlık** | terfi kanıtı, terfi edilen tanımın kendi türettiği bir değerden gelemez | Aksi hâlde sistem kendi kendini onaylar |

> **Eşikler ÖLÇÜLMEDİ, SEÇİLDİ.** 20/3/2 sayıları mühendislik yargısıdır; kalibre
> edecek saha verisi **yok**. Bu yüzden eşikler **paket verisinde** durur
> (`promotionThresholds`), kodda sabit değil — ilk saha turundan sonra revize
> edilebilsinler. ADR-286 kabul ölçütü 3 ile aynı ilke: eşik sabitleri tek kaynaktan.

### 5.3 Kim onaylar — cihaz DEĞİL

**Cihaz terfi ettirmez. Cihaz biriktirir ve raporlar.**

Cihazda üçüncü bir yerel durum vardır: **`LOCALLY_CORROBORATED`** — beş kapıyı bu
araçta geçmiş `COMMUNITY` tanım. Anlamı: *"LAB'da öne çıkar, terfi raporuna girer"*.
Anlamı **değildir**: *"kanıt üretebilir"*. Kanıt kapısı hâlâ kapalıdır.

`FIELD_VERIFIED` damgasını yalnız **imzalı bir paket sürümü** verir (insan incelemesi
+ `verification` bloğunun doldurulması + `packVersion` artışı).

> **ADR-286 ile çelişki var mı? Yok — ve ayrım önemlidir.** ADR-286 *"karar otoritesi
> cihazdadır"* der: cihaz **kanıttan hüküm** üretmek için ağa muhtaç değildir. Terfi
> ise **kural kitabını yeniden yazmaktır** — kanıttan hüküm değil, hükmün *dayanağını*
> değiştirmek. Kendi kural kitabını yazan cihaz, kendini yanlış bir formüle ikna
> edebilir ve bunu bir daha kimse fark etmez. ADR-286 §4.2'nin *"gömülü paket taban
> gerçektir, senkron en iyi çabadır"* kuralıyla birebir aynı yerde duruyoruz.

Ağsız araçta ne kaybedilir: **hiçbir temel yetenek**. Yalnız terfi raporu birikir ve
yeni paket inemez. `STANDARD` tanımlar gömülüdür ve beş kategorinin dördünü tek
başına besler (§7) — bu tesadüf değil, tasarımın dayanağıdır.

### 5.4 Geri alınabilirlik — asimetrik

| | Terfi | Düşürme |
|---|---|---|
| Nerede | yalnız imzalı paket | **cihazda, anında** |
| Kanıt | 5 kapı, ≥2 araç, ≥3 çevrim | **tek doğrulanmış çelişki** |
| Kapsam | sınıf (`classKey`) | yerel (`fingerprint`) + raporlanır |
| Geri alma | — | **cihaz geri alamaz**; yalnız yeni paket sürümü |

Asimetri kasıtlıdır: **yanlış "doğrulandı" damgası, damgasızlıktan kötüdür.** Bir kez
düşen tanım, o araçta kendini yeniden ikna edemez — aksi hâlde düşme/yükselme
salınımı doğar ve hüküm titrer.

Düşürme tetikleyicileri: (i) `FIELD_VERIFIED` tanımdan sınır dışı değer, (ii)
`STANDARD` çapraz tanıkla tolerans dışı sapma, (iii) `parse_error`. Her düşürme
**sayılır ve LAB'da okunur** — sessiz düşürme yoktur.

### 5.5 Terfi raporunun gizliliği — varsayılan KAPALI

Rapor içeriği (yalnız bunlar): tanım `key`i · `classKey` · örnek sayısı · çevrim
sayısı · araç sayısı · çözülen değerin **özet istatistiği** (min/maks/ort/std) ·
kontrol kodu sonuçları · `packVersion`.

**Taşınmaz:** VIN (yalnız hash bile gönderilmez — sınıf yeterlidir) · konum · plaka ·
sürücü kimliği · **ham örnek dizisi** (bir soğutma sıvısı serisi bir yolculuk izidir).

**Varsayılan `KAPALI`.** Gerekçe ticari: Çinli üreticiye gömülü satış hedefinde
sessiz telemetri yükleme bir yükümlülüktür. Terfi raporlaması **açık kullanıcı
onayıyla** çalışır. Bu, terfinin hızını düşürür — kabul edilen bedeldir.

> Not: hız istatistiği bile yolculuk hakkında bilgi taşıyabilir. Bu yüzden
> `evidence.category = 'LOCATION'` olan hiçbir tanım terfi raporuna **girmez**.

---

## 6. (d) Bellek · (e) Sorgu bütçesi

### 6.1 Bellek tavanı

Sorun **derlenmiş biçim değil, JSON ayrıştırma tepe noktasıdır.** Derlenmiş bir tanım
(nesne + dizeler + kapanış + Map girdisi) kabaca 0,6–1 kB'dır; 1.000 tanım ≈ 1 MB —
sorun değil. Ama 10.000 tanımlık tek JSON ≈ 4–8 MB metin, `JSON.parse` tepe noktası
bunun 2–3 katı → Mali-400 sınıfı WebView'da boot jank/OOM riski.

**Karar: iki düzeyli indeks + shard'lar. Katalog ASLA bütün olarak ayrıştırılmaz.**

| Katman | Ne zaman yüklenir | Tavan |
|---|---|---|
| **L1 uygulanabilirlik indeksi** (`classKey`/protokol → shard listesi) | boot, gömülü | **≤ 64 KB** |
| **`j1979-core` shard'ı** (STANDARD) | boot, gömülü — **taban gerçek** | ~120 tanım · **≤ 200 KB** JSON |
| **Marka shard'ı** | protokol + sınıf **tespit edildikten sonra**, tembel | **≤ 400 tanım · ≤ 512 KB** JSON/shard |
| Aynı anda açık shard | — | **≤ 2** (j1979-core hariç) |
| **Toplam derlenmiş** | — | **≤ 1.200 tanım · ≤ 1,5 MB** |

- **Daraltma sırası:** protokol vetosu → sınıf anahtarı → tüketici talebi. Talep eden
  yoksa marka shard'ı **hiç** ayrıştırılmaz.
- **Tahliye:** shard'larda LRU; **aktif izleyicisi olan veya kanıt besleyen shard
  tahliye edilmez** (uçuş sırasında tahliye = sahte boşluk).
- **Tavan aşılırsa:** yeni shard **yüklenmez**, olay **sayılır**, ilgili sinyaller
  `UNAVAILABLE` görünür. Sessiz kısmi yükleme yoktur.
- `j1979-core` **asla tahliye edilmez** — ADR-286 §4.2'nin *"gömülü paket taban
  gerçektir"* kuralının bellek karşılığı.

> Bu sayılar **bütçe beyanıdır, ölçüm değil.** K24'te ölçülmeleri kütük maddesidir
> (#508). Ölçüm bütçeyi düşürürse **bütçe düşer**, tavan sessizce yükseltilmez.

### 6.2 Sorgu bütçesi

**Temel ilke: paketin kendi poll döngüsü YOKTUR.** Tanım, bir tüketici (kanıt kaynağı,
LAB ekranı, widget, sesli sorgu) **talep etmedikçe** sorgulanmaz. Mevcut talep-güdümlü
model (`watchPid` / `watchDid`) korunur; boşta bağlantıda ek trafik **sıfır** kalır.

Bütçe **PID sayısıyla değil, hat süresi payıyla** ifade edilir — çünkü maliyet tekdüze
değildir: desteklenmeyen bir PID ELM327'de **~200 ms** NO-DATA bekletir
(`extendedPidService.ts:20`), isabetli okuma bunun çok altındadır.

| Kural | `low` (K24) | `mid`/`high` |
|---|---|---|
| FAST grup (hız/RPM) | **rezerve**, her turda ilk sırada, asla feda edilmez | aynı |
| Paket kaynaklı trafik tavanı | **≤ %25** tur süresi | ≤ %40 |
| Çekirdek sinyal bayatlarsa | paket trafiği **askıya alınır**, tazelik dönene dek | aynı |

Askıya alma **yeni bir tazelik otoritesi kurmaz**: mevcut bayatlık ölçüsünü okur.
Bu, ölçülmüş felaketin (`manufacturerPidService.ts:54-75` — 47 sn tazelik, link
kaybı) tekrarını engelleyen asıl kapıdır.

**Yoklama (probing) polling'den AYRI ve daha sıkı bütçelidir:**

- **Sürüşte yoklama YOK.** Yalnız `VEHICLE_STOPPED` **ve** aktif rota rehberliği yokken.
  Yoklama bir teşhis etkinliğidir, sürüş etkinliği değil.
- ≤ 1 yoklama/sn · ≤ 30 yoklama/kontak çevrimi · her aday **ömür boyu ≤ 3 yoklama**,
  sonra sınıflandırılır ve bir daha sorulmaz.
- **Mode 01'de yoklama neredeyse gereksiz:** bitmask keşfi (`parseSupportedBitmask` +
  `seedSupportedPids`, **mevcut**) desteklenmeyen PID'i sorgudan önce eler.
  **Bitmask'in olumsuz dediği PID'i yoklamak YASAKTIR.**
- **UDS DID'de bitmask yok** → yoklama tek yol. Yükü `capabilityOutcome` kalıcılığı
  taşır: `unsupported`/`security_required` **kalıcı**, `timeout` **kanıt değil**
  (hepsi mevcut). Ayrıca ECU devre kesici (`ECU_MUTE_RETRY_MS`, yarı-açık) **aynen
  korunur** — pahalı biçimde öğrenilmiş saha bilgisidir.

**Hot-path etkisi: yapısal olarak sıfır.** Paket okuyucu yalnız **yükleme anında**
çalışır (derleme → Map, mevcut desen); çözüm saf ve O(bayt); kare başına iş yoktur.
Gerçek risk CPU değil **hat çekişmesidir** ve onu §6.2 payı kapatır.

---

## 7. Beş kategori eşlemesi

Aşağıdaki tablo *"hangi tanım gerekli"* sorusunu yanıtlar. **Sürpriz:** `MEVCUT`
sütunu neredeyse dolu.

### 7.1 AKÜ (`BATTERY`) — bugün ÇALIŞAN tek kategori

| Sinyal | Erişim | `defTrust` | Mevcut? |
|---|---|---|---|
| Adaptör hat voltajı | `ATRV` (ELM komutu) | `STANDARD` | ✅ akıyor (#490/#502) |
| **Kontrol ünitesi voltajı** | `01:42` | `STANDARD` | ✅ tanım var (`Registry:130`), **kanıt hattına bağlı DEĞİL** |

→ `01:42`'nin bağlanması **çapraz tanığın ilk gerçek kullanımıdır**: ATRV konektörü,
`42` ECU besleme hattını ölçer. Uyum → güven; sapma → ikisi de `CANDIDATE`.

### 7.2 ARIZA KAYDI (MIL + DTC) → `DIAGNOSTIC`

| Sinyal | Erişim | Mevcut? |
|---|---|---|
| MIL + onaylı DTC sayısı | `01:01` → `decodePid01` (`access.kind='native'`) | ✅ testli |
| MIL yanarken yol / süre | `01:21` · `01:4D` | ✅ `Registry:96,141` |
| Silmeden beri yol / süre / ısınma | `01:31` · `01:4E` · `01:30` | ✅ `Registry:112,142,111` |
| DTC listeleri (Mode 03/07/0A) | **paket kapsamı DIŞI** | ✅ `dtcService`/`udsDtc`/`kwpDtc` |

> **Sınır:** Mode 03/07/0A PID değildir — değişken uzunlukta DTC listesi döndüren
> servislerdir. Paket bunları **modellemez**; mevcut servisler otoritedir. Paketin
> katkısı `01:01`/`01:21` gibi **sayısal bağlamı** kanıda çevirmektir.

### 7.3 HAZIRLIK MONİTÖRLERİ → `DIAGNOSTIC`

| Sinyal | Erişim | Mevcut? |
|---|---|---|
| Monitör destek/tamamlanma haritası | `01:01` B/C/D → `decodePid01` (benzin/dizel ayrımı dâhil) | ✅ testli |
| Hazır olmayan monitör sayısı | `01:41` | ⚠️ var ama **kayıplı** (`popcount` sıkıştırması) |
| OBD standardı | `01:1C` → `decodePid1C` | ✅ testli |

→ **Tamamı `STANDARD`; `COMMUNITY` tanıma HİÇ ihtiyaç yok.** En ucuz kapsam kazancı
budur ve önce bu yapılmalıdır. `01:41`'in kayıplı sıkıştırması `access.kind='native'`
ile düzeltilir (hangi monitörün hazır olmadığı geri kazanılır).

### 7.4 TERMAL → `TEMPERATURE`

| Sinyal | Erişim | `defTrust` | Mevcut? |
|---|---|---|---|
| Soğutma sıvısı | `01:05` | `STANDARD` | ✅ (`core`, akıyor) |
| Emme havası | `01:0F` | `STANDARD` | ✅ (`core`, akıyor) |
| **Motor yağı** | `01:5C` | `STANDARD` | ✅ `Registry:154` — **kanıt hattı yok** |
| Ortam havası | `01:46` | `STANDARD` | ✅ `Registry:134` |
| Katalizör (B1S1/B2S1) | `01:3C`/`3D` | `STANDARD` | ✅ `Registry:119,120` |
| Şanzıman yağı, marka yağ sıcaklığı | UDS DID | `COMMUNITY` | marka shard'ı — terfi adayı |

### 7.5 YAKIT TRİMİ → `FUEL`

| Sinyal | Erişim | Mevcut? |
|---|---|---|
| STFT/LTFT B1/B2 | `01:06`/`07`/`08`/`09` | ✅ `Registry:74-77` |
| Yakıt sistemi durumu | `01:03` → `decodePid03` | ✅ testli |
| Komutlanan hava-yakıt oranı | `01:44` | ✅ `Registry:132` |
| Komutlanan EGR / EGR hatası | `01:2C` / `01:2D` | ✅ `Registry:107,108` |

→ **Tamamı `STANDARD` ve tamamı zaten tanımlı.** Yakıt trimi için eksik olan **tanım
değil**, (a) değer akışı (P1-1) ve (b) `fuelTrimEvidenceModel`.

### 7.6 Eşlemenin özeti — işin gerçek şekli

| Kategori | Eksik tanım | Eksik kanıt modeli | P1-1'e bağımlı |
|---|---|---|---|
| AKÜ | — | — (var) | hayır (çekirdek yol) |
| HAZIRLIK | — | **evet** | kısmen (`01` tek-seferlik okuma) |
| ARIZA KAYDI | — | **evet** | kısmen |
| TERMAL | — (marka DID'leri hariç) | **evet** | **evet** (`5C`/`46`/`3C` extended) |
| YAKIT TRİMİ | — | **evet** | **evet** |

> **Bu tablo ADR'nin en önemli çıktısıdır.** *"Genişlik lazım"* isteğinin karşılığı
> yüzlerce yeni tanım değil: **beş kanıt modeli + P1-1'in kapatılması + tanımların
> veriye taşınması.** Bunu ölçmeden başlanan bir paket işi, dolu bir katalog ve boş
> bir kanıt defteri üretirdi — projede iki kez ölçülmüş kusur sınıfı (#383 yakıt
> kalibrasyonu, #486 vektör karo).

---

## 8. (f) Mevcutla ilişki · (g) Dağıtım

### 8.1 Korunacaklar (yeniden yazılmaz)

| Varlık | Neden korunur |
|---|---|
| `vehicleDidProfile.ts` doğrulayıcı + derleyici | **Yorumlayıcı budur.** Genişletilir, çatallanmaz |
| Beyaz liste çözücüler + **eval/DSL yasağı** | Güvenlik ve öngörülebilirlik sözleşmesi |
| `capabilityOutcome.ts` (7 sonuç, `isCapabilityEvidence`) | Paketin ihtiyaç duyduğu zero-trust kapısı **zaten bu** |
| `extendedPidService` bitmask keşfi + `seedSupportedPids` + `ELM_WATCH_CAP` | Paket bunu **besler**, yerine geçmez |
| `manufacturerPidService` ECU devre kesici (yarı-açık) | Sahada pahalıya öğrenildi |
| `discoveredDataRepository` + `hashVin` + `evaluateAutoAddGate` | Öğrenilmişin kalıcı yeri |
| `StandardPidEnums` bit/enum çözücüler | §2.4 — pakete girmez, referans verilir |
| `evidenceInputGuard` + `deriveEvidenceConfidence` | **Tek güven otoritesi**, dokunulmaz |
| `batteryEvidenceSource` deseni (SUPERSEDED, halka, sayaç, cleanup) | Kategori kaynaklarının şablonu |

### 8.2 Değişecekler

1. **`StandardPidRegistry.ts` koddan veriye taşınır** → `j1979-core` shard'ı.
   `decodeStandardPid` **imzası değişmez** (çağıranlar etkilenmez), gövdesi derlenmiş
   Map'ten okur.
   - **Bedeli açık:** bugünkü kapanışların bir kısmı beyaz listeyle ifade edilemiyor —
     `lambda` (2AB/65536), `PID 32` iki'ye tümleyen /4, `popcount`, `A & 0x7F`.
     Beyaz listeye **4–6 adlandırılmış çözücü** eklenir (`lambda2AB`, `signed2c_div4`,
     `mask7f`, `bitcount`). Adlandırılmış ve testli — dil değil.
   - **Göç yöntemi ADR-286 §5.3'ün altın dosyası:** her mevcut PID için bir değer
     taramasında eski ve yeni çözüm **birebir** karşılaştırılır; ayrışma **build'i
     kırar**. 70 formül elle taşınmaz.
2. **`VehicleDidProfile` alan kazanır:** `defTrust` · `license` · `signal` ·
   `validWhen` · `dynamics` · `measurementKind` · `verification`.
   - **Mevcut profillerin varsayılanı `COMMUNITY`** (fail-closed). Sonra elle
     doğrulanır: `universalUdsProfile` → `STANDARD` (ISO 14229-1 Annex C),
     Renault/Dacia/Zoe/Trafic profilleri → `COMMUNITY` (terfi adayı).
   - **Bunun bugünkü maliyeti sıfırdır:** DID'ler bugün **hiçbir kanıt hattını
     beslemiyor** (`batteryEvidenceSource` `obdService` anlık görüntüsünü okuyor).
     Yani kapı, bugün var olan bir yeteneği kısıtlamıyor.
3. **`settings.manufacturerDidProfileId`** korunur ama `'auto'` seçeneği eklenir ve
   varsayılan olur. Kullanıcı elle seçebilmeye **devam eder** (§3.1 sıra 4).
4. **P1-1 sıralama kararı (bağlayıcı):** `samples: []` kapanmadan paketin **ikinci**
   kategorisi sevk edilmez. AKÜ çekirdek yoldan aktığı için paralel çalışılabilir;
   ama *"beş kategori besleniyor"* iddiası `samples: []` dururken **yazılamaz**.

### 8.3 Dağıtım — ADR-286 §4.2 ile birebir

| Kanal | Rol | Zorunlu |
|---|---|---|
| **Gömülü** (L1 indeks + `j1979-core` + `FIELD_VERIFIED` shard'lar) | **Taban gerçek**. Ağ hiç olmasa da beş kategoriden dördü tam çalışır | ✅ her zaman |
| **Senkron** (indirilen shard/paket) | Yalnız **aynı `schemaVersion`** içinde daha yeni `packVersion` | opsiyonel |

- `schemaVersion` eşit değilse paket **bütünüyle reddedilir**. **Shard bazlı kısmi
  kabul YASAK** — paket shard'lanabilir olduğu için bu kaçamak cazip olacaktır; karışık
  sürümlü shard'lar bir ayrışma fabrikasıdır (ADR-286 R3).
- **İki düzeyli bütünlük:** her shard'ın kendi checksum'ı **ve** tüm shard
  checksum'larını kapsayan manifest checksum'ı. Tembel yüklenen bir shard'ın checksum'ı
  tutmazsa **reddedilir ve sayılır**; sinyaller `UNAVAILABLE` görünür, varsayılan
  **uydurulmaz**.
- Doğrulama düşerse **gömülü pakete dönülür**, olay **sayılır** (sessiz düşüş yok).
- **Ağsız araçta kaybedilen tam liste:** yeni shard indirilemez · terfi raporu
  gönderilemez. Kaybedilmeyen: tüm `STANDARD` tanımlar, tüm gömülü `FIELD_VERIFIED`
  tanımlar, kanıt üretimi, hüküm üretimi.
- **Kullanıcı/yan-yükleme paketleri üründe YOK.** LAB'da (Faz A) geliştirici bir paket
  yan-yükleyebilir; yan-yüklenen paketteki **her tanım, ne iddia ederse etsin,
  `COMMUNITY`e zorlanır**. Diskteki bir dosya `FIELD_VERIFIED` iddia edebilir — bu
  kapı o sahteciliği kapatır.

### 8.4 Lisans saflığı — işletim kuralı

- `license` alanı **zorunlu**; boş/eksik → tanım **derlenmez** (bugünkü `source`
  zorunluluğunun sertleştirilmiş hâli, `vehicleDidProfile.ts:118`).
- İzinli değerler: `SPEC-PUBLIC` (SAE/ISO metninden **formül**, metin değil) ·
  `MIT` · `Apache-2.0` · `BSD-2/3` · `ISC` · `CC0` · `Unlicense`.
- **Yasak:** GPL/AGPL/LGPL/SSPL · `CC-BY-NC` · **lisansı belirsiz** kaynak ·
  **tescilli veritabanından kopya** (tek satır bile).
- **Standart metni kopyalanamaz** — formül ve birim olgudur, standardın *metni*
  telifli. Tanımın `name`i **kendi Türkçe ifademiz** olmalıdır (bugünkü kayıt zaten
  böyle yazılmış).
R2'nin iki yarısı vardır ve **yalnız biri test edilebilir**. İkisini ayırmadan yazmak,
makinenin denetleyemediği yarıyı denetleniyor sanmaktır.

### 8.4.1 Test EDİLEBİLİR yarı — CI kapısı

Makine tarafından denetlenir; insan dikkatine bırakılamaz. Kütük satırı: **#515**.

| Kural | Kapı |
|---|---|
| Her tanımda `license` **var ve boş değil** | derleme reddi |
| `license` **beyaz listede** (`SPEC-PUBLIC`·`MIT`·`Apache-2.0`·`BSD-2/3`·`ISC`·`CC0`·`Unlicense`) | **CI kırılır** |
| Her tanımda `sourceRef` **var ve boş değil** | derleme reddi |
| `defTrust: COMMUNITY` ise `sourceRef` bir **URL veya belge kimliği** içerir | **CI kırılır** |
| Yan-yüklenen paketin `defTrust`u **`COMMUNITY`e zorlanır** | çalışma zamanı testi |

### 8.4.2 Test EDİLEMEZ yarı — SÜREÇ KURALI (bağlayıcı)

Bir formülün **nereden geldiğini** hiçbir CI kontrolü göremez. `license: "SPEC-PUBLIC"`
yazan bir alan, tanımın gerçekten spec'ten mi yoksa başka bir uygulamanın kataloğundan
mı geldiğini kanıtlamaz. Bu yüzden aşağıdakiler süreç kuralıdır ve **incelemede**
uygulanır. R2'yi tehlikeli yapan tam olarak budur: ihlal, yeşil testle, temiz `tsc` ile
ve geçerli görünen bir `license` alanıyla **birlikte** var olabilir.

> **1. Kaynaksız tanım pakete GİRMEZ.** Hiçbir tanım, **alıntılanabilir kamuya açık bir
> kaynak** gösterilmeden eklenemez. `sourceRef` doğrulanabilir olmalıdır: standart adı +
> tablo/bölüm numarası, ya da URL + erişim tarihi + o kaynağın kendi lisansı.
> *"Bir forumda gördüm"*, *"internette vardı"*, *"herkes böyle kullanıyor"* geçerli
> kaynak **değildir**.
>
> **2. BAŞKA BİR OBD UYGULAMASININ VERİTABANINDAN TANIM ALINMAZ —
> ne kopyalayarak ne referans alarak.**
> Bu yasak; o uygulamanın ücretli/ücretsiz, açık/kapalı kaynak olmasından ve verinin
> APK'dan çıkarılmış, ekrandan okunmuş, tersine mühendislikle elde edilmiş ya da
> *"zaten herkesçe biliniyor"* olmasından **bağımsızdır**. Başka bir ürünün kataloğuna
> **bakarak** yazılan tanım da kapsamdadır — *"kendi kelimelerimle yazdım"* bir aklama
> değildir. Kopyalanan şey metin değil, **seçim ve eşleştirme emeğidir**; korunan da odur.
>
> **3. İzin verilen iki yol vardır, üçüncüsü yoktur:**
> **(a) Spec'ten sıfırdan** — SAE J1979 / ISO 15031-5 / ISO 14229-1 gibi standardın
> kendisinden okunan formül ve birim. *(Formül ve birim olgudur; standardın **metni**
> teliflidir ve kopyalanamaz — tanımın `name`i kendi ifademiz olmalıdır.)*
> **(b) Kendi saha ölçümümüzden** — kendi test aracımızda kendi ölçtüğümüz veriden
> türetilen formül. Bu yol `defTrust: COMMUNITY` doğurur ve §5 terfi kapılarından
> geçmeden `FIELD_VERIFIED` olamaz.
>
> **4. Şüphe hâlinde tanım EKLENMEZ.** Kaynağın lisansı belirsizse *"muhtemelen
> serbesttir"* bir karar değildir. Belirsiz **tek satır** tüm paketi zehirler.
>
> **5. Uyulmanın kanıtı beyandır.** Yeni tanım getiren her değişiklik, **tanım başına**
> kaynağı ve hangi yolla (a/b) elde edildiğini açıkça beyan eder. Beyansız tanım
> incelemede **reddedilir** — testler yeşil olsa bile.

**Neden bu kadar sert:** ürün, müşterinin hukuk ekibince denetlenecektir. Tescilli bir
katalogdan alınmış **tek** tanım sözleşmeyi ve ürünün tüm ticari değerini riske atar.
Bu, teknik bir kusur değil **geri alınamaz** bir kusurdur: kod düzeltilebilir,
dağıtılmış bir ihlal düzeltilemez.

---

## 9. Riskler (ciddiyet sırasına göre)

| # | Risk | Neden bu sırada | Azaltma |
|---|---|---|---|
| **R1** | **Yanlış tanım → makul görünen yanlış değer → yanlış hüküm** | En tehlikelisi: **sessizdir**. `250 °C` fark edilir, `95 °C` fark edilmez — ve hükme girer. Anayasanın "sahte veri yasağı"nın doğrudan ihlali | Tanım başına aktivasyon kanıtı (§3.3) · çapraz tanık (§3.4) · `COMMUNITY` kanıt kapısı (§4.2) · sınır dışıda kalıcı `REJECTED` |
| **R2** | **Lisans kirlenmesi** (tescilli DB'den kopyalanmış tek tanım) | **Ticari olarak ölümcül** ve **testle yakalanamaz** — yeşil test, temiz `tsc`, zehirli anlaşma | Zorunlu `license` + `sourceRef` · beyaz liste **CI kapısı** · yan-yüklenen paket zorla `COMMUNITY` · "forumda gördüm" reddi |
| **R3** | **OBD hattı doyması → çekirdek sinyal bayatlaması → link kaybı** | **Ölçüldü, varsayım değil:** 6 başarısız DID denemesi bant genişliğinin yarısını yedi, tazelik 47 sn, `OBD_STALE_DATA` + link kaybı. Katalog genişledikçe bu kusur **bizim elimizle** geri gelir | FAST grup rezerve · pay tavanı (%25 `low`) · bayatlıkta **askıya alma** · sürüşte yoklama yok · bitmask-negatif PID yoklaması yasak · ömür boyu ≤3 yoklama |
| **R4** | **Terfi öz-aldanması** — `FIELD_VERIFIED` sertifikalı bir yalan | Bir kez yanlış damga vurulursa **tüm mekanizma güvenilmez** olur; R1'i "doğrulanmış" kılıfıyla geri getirir | Terfi **cihazda yok** · ≥2 araç/≥3 çevrim · varyans kapısı (sabit ≠ doğru) · çapraz tanık çelişkisi = doğrudan `REJECTED` · öz-referans yasağı · **asimetrik geri alma** |
| **R5** | **`provenance` ad çakışması** — `COMMUNITY` formül sessizce `HIGH` tavan kazanır | Tek satırlık bir adlandırma hatası tüm güven zincirini delerdi; **bugün mevcut kodda hazır tuzak** | Yeni eksen `defTrust`/`COMMUNITY` (§1.2) · `deriveEvidenceConfidence`a **dördüncü** en-zayıf-halka · kaynak taraması kilidi: `defTrust` değerleri `EVIDENCE_PROVENANCES` ile **hiç kesişmemeli** |
| **R6** | **Katalog büyür, değer akmaz** (P1-1 açık) | Projede **iki kez ölçülmüş** kusur sınıfı (#383, #486): *"mekanizma kodda var ≠ çalışıyor"*. Dolu katalog + boş `samples` = sahte ilerleme | P1-1 sıralama kararı (§8.2/4) · her kategori için LAB'da **gerçek örnek sayısı** okunur · kütükte 🔴 kalır |
| **R7** | **Bit alanı sıkıştırması** — enum PID'i skalere zorlamak | **Bir kez oldu:** `PID 01` MIL bayrağını atmak zorunda kaldı, `PID 41` hangi monitörün hazır olmadığını kaybetti | Bit alanı pakete girmez (`access.kind='native'`, §2.4) · yeni bit alanı için skaler kaçamağı **kod incelemesinde reddedilir** |
| **R8** | **Bellek/ayrıştırma tepe noktası** (Mali-400 boot) | Jank/OOM görünür ama **kurtarılabilir**; R1-R4 gibi sessiz değil | İki düzeyli indeks · shard tavanı 512 KB · aynı anda ≤2 shard · tavan aşımında yükleme **reddedilir ve sayılır** |
| **R9** | **`schemaVersion` sürüklenmesi** (ADR-286 R3'ün mirası) | Sessiz ayrışma tehlikeli ama mekanizma **zaten tasarlanmış** — yeni risk değil, devralınan risk | Eşit değilse **bütün paket** reddedilir · shard bazlı kısmi kabul yasak · `packVersion` hüküm kaydına gömülür |
| **R10** | **Terfi raporu gizlilik sızıntısı** | Varsayılan kapalı olduğu için maruziyet dar; ama açıldığında geri alınamaz | Yalnız özet istatistik · ham seri yok · VIN yok (hash bile) · `LOCATION` kategorisi rapora hiç girmez · varsayılan **KAPALI** |

---

## 10. Kabul ölçütleri

Bu ADR **uygulanmış** sayılmaz, aşağıdakiler **ölçülene** kadar:

1. **Tek yorumlayıcı:** `StandardPidRegistry`de kapanış (closure) taşıyan tanım
   **kalmaz**; tüm PID/DID çözümü tek derleyiciden geçer (kilit: kaynak taraması).
2. **Göç kaybı sıfır:** her mevcut PID için eski↔yeni çözüm altın dosyada **birebir**;
   ayrışma build'i kırar.
3. **`COMMUNITY` hüküm kuramaz:** `COMMUNITY`/`CANDIDATE` bir tanımdan üretilmiş
   hiçbir kayıt kanıt defterine **girmez** (kilit: çağrı yolu taraması + davranış testi).
4. **Ad çakışması kapalı:** `defTrust` değer kümesi ile `EVIDENCE_PROVENANCES`
   **hiç kesişmez** (kilit: küme kesişimi testi).
5. **Lisans kapısı:** beyaz liste dışı `license` içeren paket **derlenmez** ve CI
   **kırılır**.
6. **Hat bütçesi gerçek araçta:** `low` tier'da paket trafiği açıkken hız/RPM tazeliği
   **bozulmaz**; bayatlıkta askıya alma **gözlemlenir**.
7. **Bellek:** K24'te toplam derlenmiş tanım ≤ 1.200 / ≤ 1,5 MB **ölçülür**; aşım
   **sayılır ve raporlanır**.
8. **Ağsız:** uçak modunda beş kategoriden **dördü** kanıt üretir (`STANDARD` tabanla).
9. **Gözlemlenebilirlik (7 şart):** LAB'da paket sürümü · shard durumu · tanım başına
   `defTrust`/durum (`CANDIDATE`/`ACTIVE`/`REJECTED`/`LOCALLY_CORROBORATED`) ·
   çapraz tanık sapmaları · red/düşürme sayaçları · yoklama bütçesi okunur.
   **Aktif komut YOK** (yoklama LAB'dan tetiklenmez). VIN/konum **taşınmaz**.
10. **Terfi:** en az bir `COMMUNITY` tanım beş kapıyı gerçek araçta geçer ve
    `LOCALLY_CORROBORATED` olur — **kanıt üretmediği doğrulanır**.

---

## 11. Kütüğe açılacak 🔴 satırlar (taslak)

Taslaktır; iş yapıldıkça `docs/DEVICE_VALIDATION_LEDGER.md`'ye işlenir. Son kullanılan
sıra numarası **502**.

| # | Başlık | Ölçülebilir kabul ölçütü |
|---|---|---|
| **#503** | 🔴 **TEK YORUMLAYICI · PID tanımları hâlâ KOD (ADR-286 kural 3 ihlali)** | `StandardPidRegistry`de kapanış taşıyan tanım **0** olur; `j1979-core` shard'ı derlenir. Altın dosya: ~70 PID × değer taraması, eski↔yeni **birebir**; ayrışma build'i kırar. Yeni adlandırılmış çözücülerin (`lambda2AB`·`signed2c_div4`·`mask7f`·`bitcount`) her biri ayrı testli |
| **#504** | 🔴 **AD ÇAKIŞMASI · `defTrust` ile `EVIDENCE_PROVENANCES` kesişebilir** | Küme kesişimi **boş** (kilit testi). `defTrustConfidenceCeiling` `deriveEvidenceConfidence`a **dördüncü** halka olarak katılır ve `COMMUNITY` → `LOW` ölçülür. `provenance` alanı **değişmemiş** olduğu doğrulanır |
| **#505** | 🔴 **KANIT KAPISI · `COMMUNITY` tanım hüküm kurabiliyor mu — ölçülmedi** | Gerçek araçta `COMMUNITY` bir DID okunur ve **gösterilir**; kanıt defterinde o metriğe ait **hiç** kayıt oluşmaz. Çağrı yolu taraması: kanıt kurucu yol yalnız `STANDARD`/`FIELD_VERIFIED` alır |
| **#506** | 🔴 **AKTİVASYON KANITI · tanım kendini kanıtlamadan kanıt üretiyor mu** | Kasten bozuk bir tanım (yanlış katsayı) yüklenir: ilk okumada sınır dışı → `REJECTED`, kanıt **üretilmez**, sayaç artar, LAB'da okunur. İkinci kontak çevriminde **yeniden sorulmaz** |
| **#507** | 🔴 **ÇAPRAZ TANIK · `ATRV` ↔ `01:42` sapması ölçülmedi** | Gerçek araçta iki voltaj kaynağı yan yana okunur; sapma LAB'da **sayı olarak** görünür. Tolerans dışında ikisi de `CANDIDATE`'e düşer ve akü kanıdı **durur** (sessiz devam etmez) |
| **#508** | 🔴 **BELLEK BÜTÇESİ · 1.200 tanım / 1,5 MB tavanı K24'te ÖLÇÜLMEDİ** | K24'te derlenmiş tanım sayısı + tahmini bellek LAB'da okunur; boot'ta tek shard ayrıştırma süresi ölçülür. Tavan aşımında shard **yüklenmez** ve sayaç artar. Ölçüm bütçeyi düşürürse **bütçe düşer** |
| **#509** | 🔴 **HAT BÜTÇESİ · paket trafiği çekirdek tazeliği bozuyor mu** | `low` tier'da paket trafiği açıkken hız/RPM tazeliği bozulmaz; kasten aşırı talep üretilir → askıya alma **gözlemlenir** ve LAB'da okunur. 47 sn tazelik kusuru (`manufacturerPidService` saha vakası) **tekrarlanmaz** |
| **#510** | 🔴 **YOKLAMA BÜTÇESİ · sürüşte yoklama yapılmıyor mu** | Sürüş sırasında yoklama sayacı **artmaz**. Kontak çevrimi başına ≤30, aday başına ömür boyu ≤3 ölçülür. Bitmask-negatif PID için yoklama sayısı **0** |
| **#511** | 🔴 **HAZIRLIK MONİTÖRLERİ · kanıt modeli yok (en ucuz kapsam kazancı)** | Gerçek araçta `01:01`'den monitör haritası okunur ve `DIAGNOSTIC` kanıdı üretilir; `01:41`'in kayıplı `popcount` sıkıştırması kalkar, **hangi** monitörün hazır olmadığı LAB'da okunur |
| **#512** | 🔴 **TERMAL · `01:5C` motor yağı sıcaklığı tanımlı ama kanıt hattı yok** | Gerçek araçta `5C` değeri akar ve `TEMPERATURE` kanıdı üretilir. Araç desteklemiyorsa `unsupported` **dürüstçe** görünür — sahte 0 veya "normal" **üretilmez** |
| **#513** | 🔴 **YAKIT TRİMİ · dört tanım mevcut, model yok** | Gerçek araçta STFT/LTFT B1 akar ve `FUEL` kanıdı üretilir; `01:03` yakıt sistemi durumuyla birlikte LAB'da okunur |
| **#514** | 🔴 **TERFİ · beş kapı gerçek araçta hiç koşmadı** | Bir `COMMUNITY` tanım ≥20 örnek/≥3 çevrim/≥2 araçta beş kapıyı geçer → `LOCALLY_CORROBORATED`; **kanıt üretmediği** ayrıca doğrulanır. Kasten çelişkili çapraz tanıkta **düşürme anında** olur ve sayılır |
| **#515** | 🔴 **LİSANS KAPISI · CI'da `license`/`sourceRef` beyaz liste kontrolü YOK (R2'nin test edilebilir yarısı)** | Beş kontrolün beşi de koşar (ADR §8.4.1): (1) `license` eksik/boş tanım **derlenmez** · (2) beyaz liste dışı `license` build'i **kırar** · (3) `sourceRef` eksik/boş tanım **derlenmez** · (4) `defTrust:COMMUNITY` + URL/belge kimliği içermeyen `sourceRef` build'i **kırar** · (5) yan-yüklenen paketin `FIELD_VERIFIED` iddiası **yok sayılır**, `COMMUNITY`e zorlandığı çalışma zamanında ölçülür. **Not:** R2'nin diğer yarısı (tanımın gerçekten nereden geldiği) **test edilemez** — ADR §8.4.2 süreç kuralıdır, kütükte kapatılamaz |
| **#516** | 🔴 **DAĞITIM · `schemaVersion` uyuşmazlığında kısmi kabul sızabilir** | Farklı `schemaVersion`lı paket **bütünüyle** reddedilir; tek shard'ı bozuk paket **hiç** yüklenmez (kısmi kabul yok), sayaç artar, sinyaller `UNAVAILABLE` görünür |
| **#517** | 🔴 **GÖZLEM YÜZEYİ · CAROS LAB'da paket ekranı yok** | LAB'da salt-okunur ekran: `packVersion` · shard durumu/boyutu · tanım başına `defTrust`+durum · çapraz tanık sapmaları · red/düşürme/yoklama sayaçları. **Aktif komut yok**, VIN/konum **taşınmaz**, bilinmeyen alan `UNKNOWN`/`UNAVAILABLE` |
| **#518** | 🔴 **SIRALAMA · P1-1'in DURUMU BİLİNMİYOR — elimizdeki tek ölçüm DÜZELTMEDEN ÖNCEye ait** | ⚠️ Premis düzeltildi (P1-1 teşhisi, 2026-08-09): `samples: []` ölçümü **2026-07-15** raporundan; arka plan tüketicisini ekleyen `_watchAllSupportedPids` **2026-07-17**'de (`f1e0e7f` madde 4) eklendi ve commit'in kendisi *"🔴 Gerçek araç doğrulaması BEKLİYOR"* diyor. Kabul ölçütü: gerçek araçta **önce Runtime Scheduling → YENİLE** (yoksa `cacheState:never_refreshed` → sahte `NO_NATIVE_EVIDENCE`), sonra `extendedPollEvidence.decision` okunur ve **H1/H2/H3/H4'ten biri** kayda geçer. `H4_HEALTHY` çıkarsa P1-1 zaten kapalıdır ve #518 **kapanır**; diğer üç hüküm ayrı kütük satırı doğurur |

---

## 12. (Bilinmeyenler) Bu ADR'nin KARAR VEREMEDİĞİ şeyler

Uydurmamak için açıkça yazılıyor:

- **B1 — P1-1'in kök nedeni bilinmiyor.** `samples: []` için üç hipotez (H1 native /
  H2 decode / H3 köprü) gerçek araçta **ayrıştırılmadı**. Paket, teşhis edilmemiş bir
  akış sorununu **çözemez**; sadece üstüne yığar. Bu yüzden §8.2/4 sıralama kararı
  bir tahmin değil, **zorunluluk**tur.
- **B2 — Terfi eşikleri (20/3/2) SEÇİLDİ, ÖLÇÜLMEDİ.** Kalibre edecek saha verisi yok.
  Bu yüzden eşikler pakette durur; ilk saha turu bunları **değiştirecektir**.
- **B3 — Bellek ve hat sayıları BÜTÇE, ölçüm değil.** 1,5 MB / 1.200 tanım / %25 pay /
  200 ms NO-DATA — sonuncusu kod yorumundan, diğerleri mühendislik yargısından.
  K24'te ölçülmeden hiçbiri iddia edilemez (#508/#509).
- **B4 — Hangi açık kaynak katalogların lisansı gerçekten temiz, DENETLENMEDİ.**
  Aday isim vermek bu ADR'nin işi değil; her aday için ayrı lisans incelemesi gerekir.
  Bu hukuki danışmanlık değildir.
- **B5 — Sınıf anahtarının granülaritesi belirsiz.** `mmy:MARKA|MODEL|YIL` motor kodunu
  içermiyor; aynı model yılında iki motor varyantı farklı DID haritası taşıyabilir.
  Motor kodu güvenilir biçimde okunabilir mi — **bilinmiyor**. Fazla ince anahtar terfiyi
  imkânsızlaştırır, fazla kaba anahtar yanlış terfi üretir. İlk saha verisiyle karar.
- **B6 — `AiEvidence` `defTrust` alanı almalı mı.** Şimdilik hayır (§4.4); filo
  yüklemesi ve geriye dönük yeniden yorumlama geldiğinde yeniden değerlendirilmeli.
- **B7 — Terfi raporlaması OEM veri politikasında sevk edilebilir mi.** Varsayılan
  kapalı olsa bile bazı üreticiler herhangi bir giden veriyi yasaklayabilir. O durumda
  terfi yalnız **bizim** test filomuzla ilerler ve **çok yavaşlar** — mekanizma
  çalışır, hızı düşer.
- **B8 — Bit alanı deliği kalıcı mı.** §2.4 bilinçli bir eksiklik. Bit alanı sayısı
  büyürse (üretici durum DID'leri) ikinci bir şema gerekebilir; bugünkü 3 çözücüde
  gerekmiyor.
- **B9 — `signal` kanonik sözlüğünün sahibi kim.** Çapraz tanık `signal` kimliklerinin
  tekliğine dayanır. Bu sözlük pakette mi, kodda mı yaşamalı — pakette olursa iki paket
  aynı `signal`i farklı anlamla tanımlayabilir; kodda olursa yeni sinyal kod değişikliği
  ister (madde 1 ile gerilim). **Karar verilmedi.**
