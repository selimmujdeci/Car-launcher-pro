#!/system/bin/sh
# ============================================================================
# uart-sniff.sh — MCU/CAN seri (UART) hattını keşfet ve dinle (CarOS Pro)
# ----------------------------------------------------------------------------
# Amaç: Head unit'te MCU↔SoC arası ham CAN/araç verisini taşıyan /dev/ttyS*
#       portunu bulmak ve canlı baytları yakalamak (root gerekir).
# NOT: OEM CanService portu çoğunlukla EXCLUSIVE açar → doğrudan okuma boş/EBUSY
#      dönebilir. O durumda 'holder' + 'spy' (strace) modunu kullan.
#
# Kullanım (adb shell sh /data/local/tmp/uart-sniff.sh <komut> ...):
#   list                      → tüm ttyS portları + hangi process tutuyor
#   holder <dev>              → portu açık tutan process (pid + isim + fd)
#   read   <dev> [baud] [sn]  → portu doğrudan oku, hex dök (varsayılan 115200, 8sn)
#   spy    <dev> [sn]         → portu tutan process'i strace ile dinle (8sn)
# Örnek: ... list   |   ... holder /dev/ttyS1   |   ... read /dev/ttyS1 115200 10
# READ-ONLY: porta YAZMAZ. Sadece okur/dinler.
# ============================================================================

CMD="$1"; DEV="$2"

# Portu açık tutan pid'leri /proc/*/fd taramasıyla bul (lsof yoksa)
holders() {
  d="$1"
  for fd in /proc/[0-9]*/fd/*; do
    tgt=$(readlink "$fd" 2>/dev/null)
    [ "$tgt" = "$d" ] || continue
    pid=$(echo "$fd" | sed 's#/proc/##; s#/fd/.*##')
    nm=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\0' ' ')
    echo "  pid=$pid  fd=$(basename "$fd")  proc=$nm"
  done
}

case "$CMD" in
  list)
    echo "=== /dev/ttyS* /dev/ttyHS* /dev/ttyMT* portlari ==="
    for d in /dev/ttyS* /dev/ttyHS* /dev/ttyMT* /dev/ttyAML* /dev/mcu* /dev/can*; do
      [ -e "$d" ] || continue
      echo "PORT $d"
      H=$(holders "$d"); [ -n "$H" ] && echo "$H" || echo "  (açık tutan process yok — boşta/erişilebilir olabilir)"
    done
    echo "=== /proc/tty/drivers ==="
    cat /proc/tty/drivers 2>/dev/null | grep -iE "serial|ttyS|ttyHS|ttyMT"
    echo "İPUCU: OEM CanService (com.nwd.can*/bc03) hangi portu tutuyorsa MCU hattı odur."
    ;;

  holder)
    [ -z "$DEV" ] && { echo "kullanım: holder <dev>"; exit 1; }
    echo "=== $DEV portunu tutan process(ler) ==="
    H=$(holders "$DEV"); [ -n "$H" ] && echo "$H" || echo "  (tutan yok)"
    ;;

  read)
    [ -z "$DEV" ] && { echo "kullanım: read <dev> [baud] [saniye]"; exit 1; }
    BAUD="${3:-115200}"; SEC="${4:-8}"
    echo "=== $DEV @ ${BAUD} baud, ${SEC}sn doğrudan okuma ==="
    stty -F "$DEV" "$BAUD" cs8 -cstopb -parenb raw -echo 2>/dev/null \
      || echo "  (stty ayarlanamadı — port meşgul/exclusive olabilir)"
    # od ile hex dök; timeout yoksa arka plan + kill
    ( od -An -tx1 -v "$DEV" 2>/dev/null ) &
    RP=$!
    sleep "$SEC"
    kill "$RP" 2>/dev/null
    echo "=== okuma bitti (boşsa port exclusive → 'spy' dene) ==="
    ;;

  spy)
    [ -z "$DEV" ] && { echo "kullanım: spy <dev> [saniye]"; exit 1; }
    SEC="${3:-8}"
    PID=$(for fd in /proc/[0-9]*/fd/*; do
            [ "$(readlink "$fd" 2>/dev/null)" = "$DEV" ] && { echo "$fd" | sed 's#/proc/##; s#/fd/.*##'; break; }
          done)
    [ -z "$PID" ] && { echo "$DEV açık tutan process yok — 'read' kullan"; exit 1; }
    echo "=== $DEV tutan pid=$PID strace ile dinleniyor (${SEC}sn) ==="
    if ! command -v strace >/dev/null 2>&1 && [ ! -x /data/local/tmp/strace ]; then
      echo "!! strace YOK. Cihaza arm/arm64 strace push et:"
      echo "   adb push strace /data/local/tmp/ && chmod 755 /data/local/tmp/strace"
      echo "   (sonra: STRACE=/data/local/tmp/strace ... veya PATH'e ekle)"
      exit 2
    fi
    ST=$(command -v strace 2>/dev/null); [ -z "$ST" ] && ST=/data/local/tmp/strace
    ( "$ST" -f -p "$PID" -e trace=read -xx -s 64 2>&1 | grep -iE "read\(" ) &
    SP=$!
    sleep "$SEC"
    kill "$SP" 2>/dev/null
    echo "=== spy bitti — read(...) satirlarindaki hex = ham CAN frame'leri ==="
    ;;

  *)
    echo "uart-sniff.sh — komutlar: list | holder <dev> | read <dev> [baud] [sn] | spy <dev> [sn]"
    ;;
esac
