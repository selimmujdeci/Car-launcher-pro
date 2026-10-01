"""
ELM327 pasif CAN dinleyici — OBD portundaki TÜM CAN trafiğini kaydeder (ATMA).

Araca HİÇBİR ŞEY yazmaz: yalnız adaptör ayar komutları (AT..) + ATMA (monitor all).
Head-unit/CarOS aynı ELM'e bağlıysa önce oradan kopar (Bluetooth tek istemci).

Kullanım:
  python scripts/can-sniff-elm.py --port COM5                 # 11-bit 500k (ATSP6)
  python scripts/can-sniff-elm.py --port COM5 --proto 8       # 11-bit 250k
  python scripts/can-sniff-elm.py --port COM5 --sweep 20      # ID gruplarını tek tek 20 sn dinle

Çalışırken konsola bir etiket yazıp Enter'a bas ("sürücü +1", "kapı sol ön") →
o an kayda İŞARET düşer; değişen ID'ler işaretle eşleştirilir.
Ctrl+C → durdur, özet yaz.

Çıktı (--out klasörü):
  raw.log      her satır: <ms> <ID> <bayt...>  ve  <ms> # İŞARET: etiket
  summary.csv  ID, adet, Hz, farklı yük sayısı, değişen bayt maskesi, son yük
"""
import argparse
import csv
import os
import queue
import sys
import threading
import time

import serial


def open_elm(port, baud):
    s = serial.Serial(port, baud, timeout=0.2)
    time.sleep(0.5)
    s.reset_input_buffer()
    return s


def cmd(s, c, wait=1.5):
    """AT komutu gönder, '>' istemine kadar oku."""
    s.write((c + "\r").encode())
    buf = b""
    end = time.time() + wait
    while time.time() < end:
        buf += s.read(256)
        if buf.rstrip().endswith(b">"):
            break
    return buf.decode(errors="replace").replace("\r", " ").strip(" >")


def stop_monitor(s):
    s.write(b"\r")
    end = time.time() + 2
    buf = b""
    while time.time() < end:
        buf += s.read(256)
        if b">" in buf:
            break


class Stats:
    def __init__(self):
        self.d = {}  # id -> [count, first_ms, last_ms, payloads(set), mask(list), last]

    def add(self, ms, cid, data):
        e = self.d.get(cid)
        if e is None:
            self.d[cid] = [1, ms, ms, {tuple(data)}, [0] * len(data), data]
            return
        e[0] += 1
        e[2] = ms
        e[3].add(tuple(data))
        last = e[5]
        if len(e[4]) < len(data):
            e[4] += [0] * (len(data) - len(e[4]))
        for i, b in enumerate(data):
            if i >= len(last) or last[i] != b:
                e[4][i] = 1
        e[5] = data

    def write(self, path):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "adet", "hz", "farkli_yuk", "degisen_baytlar", "son_yuk"])
            for cid in sorted(self.d, key=lambda x: int(x, 16)):
                n, a, b, pl, mask, last = self.d[cid]
                hz = n / ((b - a) / 1000) if b > a else 0
                w.writerow([cid, n, f"{hz:.1f}", len(pl),
                            "".join("X" if m else "." for m in mask),
                            " ".join(f"{x:02X}" for x in last)])


def parse_line(line):
    parts = line.split()
    if len(parts) < 2:
        return None
    cid = parts[0].upper()
    if not all(c in "0123456789ABCDEF" for c in cid) or len(cid) not in (3, 8):
        return None
    try:
        data = [int(x, 16) for x in parts[1:]]
    except ValueError:
        return None
    return cid, data


def monitor(s, seconds, raw, stats, t0, marks, label):
    """ATMA çalıştır; seconds=None → Ctrl+C'ye kadar. BUFFER FULL'da yeniden başlat."""
    overflows = 0
    end = None if seconds is None else time.time() + seconds
    s.write(b"ATMA\r")
    buf = b""
    while end is None or time.time() < end:
        while not marks.empty():
            m = marks.get()
            raw.write(f"{int((time.time() - t0) * 1000)} # İŞARET: {m}\n")
            raw.flush()
            print(f"  ✓ işaret: {m}")
        buf += s.read(4096)
        *lines, buf = buf.split(b"\r")
        for ln in lines:
            t = ln.decode(errors="replace").strip(" >\n")
            if not t:
                continue
            if "BUFFER FULL" in t or "STOPPED" in t:
                overflows += 1
                stop_monitor(s)
                s.write(b"ATMA\r")
                continue
            p = parse_line(t)
            ms = int((time.time() - t0) * 1000)
            if p:
                stats.add(ms, *p)
                raw.write(f"{ms} {p[0]} {' '.join(f'{x:02X}' for x in p[1])}\n")
    stop_monitor(s)
    print(f"  [{label}] {len(stats.d)} farklı ID toplam · taşma {overflows}")
    return overflows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--baud", type=int, default=38400)
    ap.add_argument("--proto", default="6", help="6=11bit/500k 7=29bit/500k 8=11bit/250k 9=29bit/250k")
    ap.add_argument("--sweep", type=int, default=0, help="ID grubu başına saniye (0=kapalı)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    out = a.out or os.path.join("field-runs", time.strftime("can-sniff-%Y%m%d-%H%M%S"))
    os.makedirs(out, exist_ok=True)
    s = open_elm(a.port, a.baud)
    for c in ["ATZ", "ATE0", "ATL0", "ATS1", "ATH1", "ATCAF0", "ATAL", f"ATSP{a.proto}"]:
        r = cmd(s, c, 3 if c == "ATZ" else 1.5)
        print(f"{c:8} → {r}")
    print("Protokol:", cmd(s, "ATDPN"))

    marks = queue.Queue()

    def reader():
        for line in sys.stdin:
            if line.strip():
                marks.put(line.strip())
    threading.Thread(target=reader, daemon=True).start()

    stats = Stats()
    t0 = time.time()
    with open(os.path.join(out, "raw.log"), "w", encoding="utf-8") as raw:
        try:
            if a.sweep:
                # ELM tamponu yoğun hatta taşar → 11-bit ID'leri üst 3 bite göre 8 gruba
                # böl, her grubu ayrı dinle: hiçbir ID taşma yüzünden kaçmaz.
                for g in range(8):
                    cmd(s, f"ATCF{g << 8:03X}")
                    cmd(s, "ATCM700")
                    monitor(s, a.sweep, raw, stats, t0, marks, f"grup {g}xx")
                cmd(s, "ATCRA")  # filtreyi sıfırla
            print("Serbest dinleme — etiket yaz + Enter = işaret, Ctrl+C = bitir")
            monitor(s, None, raw, stats, t0, marks, "serbest")
        except KeyboardInterrupt:
            stop_monitor(s)
    stats.write(os.path.join(out, "summary.csv"))
    print(f"\n{len(stats.d)} farklı CAN ID → {out}")
    s.close()


if __name__ == "__main__":
    main()
