#!/bin/bash
#
# Lance toutes les series de tests contre un vrai serveur et une vraie base.
#
# Le serveur est redemarre avant chaque serie. Ce n'est pas du confort :
# les compteurs de tentatives de connexion et de debit de la borne vivent
# en memoire, et une serie qui les epuise ferait echouer la suivante pour
# une raison qui n'a rien a voir avec ce qu'elle teste.
#
#   usage :  bash tests/run-all.sh
#
set -u

cd "$(dirname "$0")/.." || exit 1

SERIES=(integration options settings menu cancel service caisse cuisine delivery-race e2e-delivery web-contract securite)
LOGS=$(mktemp -d)
total_ok=0
total_ko=0
echecs=()

arreter_serveur() {
  for p in $(pgrep -f "src/server.js" 2>/dev/null); do
    cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    case "$cmd" in node*) kill "$p" 2>/dev/null;; esac
  done
  sleep 1
}

demarrer_serveur() {
  node src/server.js > "$LOGS/serveur.log" 2>&1 &
  for _ in $(seq 1 25); do
    if curl -sf http://localhost:4000/health > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "  Le serveur n'a pas demarre. Journal :"
  tail -15 "$LOGS/serveur.log"
  return 1
}

echo
echo "===== SERIES DE TESTS ====="
echo

for serie in "${SERIES[@]}"; do
  arreter_serveur
  demarrer_serveur || exit 1

  node "tests/$serie.test.js" > "$LOGS/$serie.out" 2>&1
  ok=$(grep -cE '^  OK' "$LOGS/$serie.out")
  ko=$(grep -cE '^  FAIL' "$LOGS/$serie.out")
  total_ok=$((total_ok + ok))
  total_ko=$((total_ko + ko))

  if [ "$ko" -gt 0 ]; then
    echecs+=("$serie")
    printf '  %-15s %3d controles, %d ECHEC(S)\n' "$serie" "$ok" "$ko"
    grep -E '^  FAIL' "$LOGS/$serie.out" | sed 's/^/     /'
  else
    printf '  %-15s %3d controles\n' "$serie" "$ok"
  fi
done

arreter_serveur

echo
if [ "$total_ko" -eq 0 ]; then
  echo "===== $total_ok controles, aucun echec ====="
else
  echo "===== $total_ok controles, $total_ko ECHEC(S) dans : ${echecs[*]} ====="
  echo "Journaux : $LOGS"
fi
echo

[ "$total_ko" -eq 0 ]
