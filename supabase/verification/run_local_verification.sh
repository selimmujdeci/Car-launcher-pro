#!/usr/bin/env bash
# =====================================================================
# run_local_verification.sh — FİLO GÜVENLİK/DEVİR DOĞRULAMASININ TAMAMI.
#
# Her matrisi **kendi temiz veritabanında** koşar. NEDEN: transfer matrisi
# sahipliği KALICI olarak değiştirir; aynı veritabanında ardından RLS
# matrisi koşulursa "bireysel kullanıcı kendi aracını göremiyor" gibi
# SAHTE bir düşüş üretir (ölçüldü). Matrisler birbirini kirletmemelidir.
#
# Kullanım:  bash supabase/verification/run_local_verification.sh
# Gereksinim: Docker (postgres:16-alpine imajı indirilir).
#
# ⚠️ Production'a HİÇBİR ŞEY uygulamaz. Yalnız geçici konteyner kullanır
#    ve çıkışta konteyneri KALDIRIR.
# =====================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$REPO_ROOT/supabase/migrations"
VERIFY="$REPO_ROOT/supabase/verification"
IMAGE="postgres:16-alpine"

CHAIN=(
  20260729000033_enable_individual_ownership_schema
  20260729000034_pairing_company_and_owner_gps
  20260729000035_fleet_membership_foundation
  20260729000036_fleet_management_rpcs
  20260729000037_anon_grant_defense_in_depth
  20260729000038_profiles_privilege_escalation_guard
  20260729000039_vehicle_ownership_transfer
)

FAILED=0

cleanup() {
  docker rm -f caros_verify_db >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Temiz DB kurar ve migration zincirini uygular.
# NOT: `-1` (single-transaction) ZORUNLUDUR — migration 035 DROP CONSTRAINT
# içerdiği için yarım uygulamayı fail-closed reddeder.
setup_db() {
  cleanup
  docker run -d --name caros_verify_db \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=carosfleet "$IMAGE" >/dev/null 2>&1

  for _ in $(seq 1 30); do
    if docker exec caros_verify_db pg_isready -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done

  docker cp "$VERIFY/local_baseline_fixture.sql" caros_verify_db:/tmp/baseline.sql >/dev/null
  if ! MSYS_NO_PATHCONV=1 docker exec caros_verify_db \
        psql -U postgres -d carosfleet -q -v ON_ERROR_STOP=1 -f /tmp/baseline.sql >/dev/null 2>&1; then
    echo "🔴 BASELINE KURULAMADI"
    return 1
  fi

  for m in "${CHAIN[@]}"; do
    docker cp "$MIGRATIONS/$m.sql" caros_verify_db:/tmp/m.sql >/dev/null
    if ! MSYS_NO_PATHCONV=1 docker exec caros_verify_db \
          psql -U postgres -d carosfleet -q -1 -v ON_ERROR_STOP=1 -f /tmp/m.sql >/dev/null 2>&1; then
      echo "🔴 MIGRATION DÜŞTÜ: $m"
      return 1
    fi
  done
  return 0
}

# Bir matrisi koşar; ÖZET satırındaki fail sayısını okur.
run_matrix() {
  local file="$1" label="$2"
  docker cp "$VERIFY/$file" caros_verify_db:/tmp/matrix.sql >/dev/null
  local out
  out="$(MSYS_NO_PATHCONV=1 docker exec caros_verify_db \
          psql -U postgres -d carosfleet -f /tmp/matrix.sql 2>&1)"

  # "pass | fail | toplam" tablosunun VERİ satırı.
  # Yapı: başlık · sütun adları · ayraç · veri → ayracın bir SONRAKİ satırı.
  local summary
  summary="$(echo "$out" | grep -A3 '== ÖZET ==' | tail -1)"
  local pass fail
  pass="$(echo "$summary" | awk -F'|' '{gsub(/ /,"",$1); print $1}')"
  fail="$(echo "$summary" | awk -F'|' '{gsub(/ /,"",$2); print $2}')"

  if [ -z "${fail:-}" ]; then
    echo "🔴 $label — ÖZET OKUNAMADI (matris çalışmadı)"
    echo "$out" | tail -20
    FAILED=1
    return
  fi

  if [ "$fail" = "0" ]; then
    echo "✅ $label — $pass/$((pass+fail)) PASS"
  else
    echo "🔴 $label — $fail DÜŞTÜ ($pass geçti)"
    echo "$out" | sed -n '/DÜŞENLER\|BEKLENMEYEN SONUÇLAR/,$p' | head -20
    FAILED=1
  fi
}

echo "=== 1/3 · MIGRATION ZİNCİRİ (033→039) ==="
if setup_db; then echo "✅ zincir uygulandı (7 migration)"; else FAILED=1; fi

echo ""
echo "=== 2/3 · RLS / PRIVILEGE MATRİSİ (temiz DB) ==="
run_matrix local_rls_matrix.sql "RLS matrisi"

echo ""
echo "=== 3/3 · SAHİPLİK DEVRİ MATRİSİ (yeni temiz DB) ==="
if setup_db; then
  run_matrix local_transfer_matrix.sql "Transfer matrisi"
else
  FAILED=1
fi

echo ""
if [ "$FAILED" = "0" ]; then
  echo "✅ TÜM YEREL DOĞRULAMALAR GEÇTİ"
else
  echo "🔴 EN AZ BİR DOĞRULAMA DÜŞTÜ"
fi
exit "$FAILED"
