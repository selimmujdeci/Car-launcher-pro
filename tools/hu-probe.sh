#!/system/bin/sh
# ============================================================================
# hu-probe.sh — Head Unit CAN/OBD/BT erişim tanılama taraması (CarOS Pro)
# ----------------------------------------------------------------------------
# Amaç: Yeni bir head unit'i HIZLI sınıflandırmak — hangi platform, root var mı,
#       CAN'a hangi yoldan erişilir (UART / SocketCAN / OEM SDK / provider),
#       hangi decoder box, BT/WiFi açılabiliyor mu.
# Kullanım: adb push tools/hu-probe.sh /data/local/tmp/ && \
#           adb shell sh /data/local/tmp/hu-probe.sh
# READ-ONLY: hiçbir şeyi değiştirmez/yazmaz. Güvenli.
# ============================================================================

P() { getprop "$1" 2>/dev/null; }
HR() { echo "------------------------------------------------------------"; }
SEC() { echo; echo "### $1"; }

echo "============================================================"
echo " CarOS Pro — Head Unit Tanılama  ($(date 2>/dev/null))"
echo "============================================================"

# ---- 1. KİMLİK ----
SEC "1. KİMLİK"
echo "manufacturer : $(P ro.product.manufacturer)"
echo "brand        : $(P ro.product.brand)"
echo "model        : $(P ro.product.model)"
echo "device       : $(P ro.product.device)"
echo "board/SoC    : $(P ro.product.board) / $(P ro.board.platform)"
echo "android      : $(P ro.build.version.release) (SDK $(P ro.build.version.sdk))"
echo "build.type   : $(P ro.build.type)"
echo "fingerprint  : $(P ro.build.fingerprint)"
echo "boot.orient  : $(P ro.boot.nwd.orientation)   (NWD panel rotasyon ipucu)"

# ---- 2. ROOT / GÜVENLİK ----
SEC "2. ROOT / GÜVENLİK"
ID=$(id 2>/dev/null); echo "id           : $ID"
echo "ro.secure    : $(P ro.secure)   ro.debuggable: $(P ro.debuggable)"
SU=""
for p in /system/bin/su /system/xbin/su /sbin/su /vendor/bin/su; do
  [ -e "$p" ] && SU="$SU $p"
done
echo "su binary    : ${SU:-YOK (on-device su yok)}"
case "$ID" in *uid=0*) ROOT=yes;; *) ROOT=no;; esac
echo "=> SHELL ROOT: $ROOT"

# ---- 3. SERİ PORTLAR (UART — ham CAN hattı adayı) ----
SEC "3. SERİ PORTLAR (UART)"
UART=""
for d in /dev/ttyS* /dev/ttyHS* /dev/ttyMT* /dev/ttyAML* /dev/ttyACM* /dev/ttymxc* /dev/tty_can* /dev/mcu* /dev/can_uart; do
  if [ -e "$d" ]; then echo "  $(ls -l "$d" 2>/dev/null)"; UART="$UART $d"; fi
done
[ -z "$UART" ] && echo "  (ttyS*/ttyHS*/ttyMT* bulunamadı)"
echo "-- /proc/tty/drivers --"
cat /proc/tty/drivers 2>/dev/null | grep -iE "serial|ttyS|ttyHS|ttyMT" || echo "  (okunamadı)"

# ---- 4. SocketCAN (gerçek CAN arayüzü) ----
SEC "4. SocketCAN / CAN ARAYÜZÜ"
CANIF=""
for n in /sys/class/net/can* /sys/class/net/vcan*; do
  [ -e "$n" ] && { echo "  CAN iface: $(basename "$n")"; CANIF="$CANIF $(basename "$n")"; }
done
ls -l /dev/can* 2>/dev/null && CANIF="$CANIF dev_can"
[ -z "$CANIF" ] && echo "  (SocketCAN can0/vcan yok — bu ünitede beklenir; CAN çoğunlukla decoder box→UART)"

# ---- 5. CAN/ARAÇ İLE İLGİLİ PAKETLER (platform + box ipucu) ----
SEC "5. İLGİLİ PAKETLER"
pm list packages 2>/dev/null | sed 's/package://' \
  | grep -iE "can|mcu|carservice|carsetting|vehicle|obd|nwd|hiworld|raise|rzc|topway|mtc|fyt|\.bt\.|bluetooth|mycar|factory" \
  | sort || echo "  (pm list okunamadı)"

# ---- 6. CAN SERVİS / PROVIDER ERİŞİMİ ----
SEC "6. BİLİNEN CAN ERİŞİM NOKTALARI"
echo "-- exported CanService araması --"
for pkg in com.nwd.can.setting com.nwd.mycar com.android.car com.hiworld.can com.raise.can; do
  pm path "$pkg" >/dev/null 2>&1 && echo "  paket VAR: $pkg"
done
echo "-- decoder box / cartype property --"
getprop 2>/dev/null | grep -iE "can|mcu|cartype|carbox|hiworld|raise|protocol" | head -20 || echo "  (yok)"

# ---- 7. BLUETOOTH DURUMU (OEM kilidi var mı) ----
SEC "7. BLUETOOTH"
echo "bluetooth_on (setting): $(settings get global bluetooth_on 2>/dev/null)"
dumpsys bluetooth_manager 2>/dev/null | grep -iE "^  enabled:|^  state:|name:|address:" | head -6
echo "-- son adapter geçişleri (USER_TURN_OFF = OEM zorla kapatıyor) --"
dumpsys bluetooth_manager 2>/dev/null | grep -iE "USER_TURN_OFF|TURNING|ON_|OFF" | tail -5
echo "-- bonded cihazlar --"
dumpsys bluetooth_manager 2>/dev/null | grep -A20 "Bonded devices" | grep -iE "name:|address:" | head -10

# ---- 8. WiFi (TCP OBD adaptörü için) ----
SEC "8. WiFi"
echo "wifi_on (setting): $(settings get global wifi_on 2>/dev/null)"
dumpsys wifi 2>/dev/null | grep -iE "mWifiInfo|SSID|curState|Wi-Fi is" | head -4

# ---- 9. VARSAYILAN LAUNCHER ----
SEC "9. LAUNCHER"
cmd package resolve-activity -c android.intent.category.HOME 2>/dev/null | grep -iE "packageName|name=" | head -3 \
  || dumpsys window 2>/dev/null | grep -i mCurrentFocus | head -1

# ---- 10. ÖZET / SINIFLANDIRMA ----
SEC "10. ÖZET — SINIFLANDIRMA"
HR
echo "ROOT (adb shell)   : $ROOT"
[ -n "$UART" ] && echo "UART portu         : VAR ($UART) -> root ile ham CAN sniff denenebilir" \
               || echo "UART portu         : görünmüyor"
[ -n "$CANIF" ] && echo "SocketCAN          : VAR ($CANIF) -> candump ile direkt CAN" \
                || echo "SocketCAN          : yok (decoder box→UART beklenir)"
NWD=$(pm list packages 2>/dev/null | grep -c "com.nwd")
echo "NWD platformu      : $([ "$NWD" -gt 0 ] 2>/dev/null && echo "EVET ($NWD nwd paketi) -> NwdCanClient/outer SDK; UART baypas" || echo "hayır")"
BTON=$(settings get global bluetooth_on 2>/dev/null)
BTOFF=$(dumpsys bluetooth_manager 2>/dev/null | grep -c "USER_TURN_OFF")
echo "Bluetooth          : on=$BTON, USER_TURN_OFF kayıt=$BTOFF $([ "$BTOFF" -gt 0 ] 2>/dev/null && echo "(OEM kilitliyor olabilir!)")"
HR
echo "ÖNERİ:"
[ "$ROOT" = "yes" ] && [ -n "$UART" ] && echo " * En temiz yol: root + UART CAN sniff (OEM'i baypas)."
[ "$NWD" -gt 0 ] 2>/dev/null && echo " * NWD ünitesi: NwdCanClient zaten var; canlı akış yoksa UART'a geç."
[ -z "$UART" ] && [ -z "$CANIF" ] && echo " * CAN yolu net değil: OBD-II (WiFi/BT ELM327) tabanına yaslan."
echo "============================================================"
echo " Tanılama bitti."
echo "============================================================"
