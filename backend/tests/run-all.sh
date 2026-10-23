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

SERIES=(integration options settings menu deroule cancel service caisse cuisine gestion delivery-race e2e-delivery web-contract securite multi-restaurant identites arabe session deploiement parcours)
LOGS=$(mktemp -d)
total_ok=0
total_ko=0
echecs=()

# On attend que le port se libere vraiment, et non une seconde au hasard.
#
# Un serveur qui garde des connexions ouvertes met parfois plus de temps a
# rendre le port. Le nouveau echouait alors silencieusement sur EADDRINUSE
# pendant que l'ancien, moribond, continuait de repondre a /health : la
# serie tournait contre un serveur en train de s'eteindre et cassait au
# milieu, avec des echecs qui n'avaient aucun rapport avec son sujet. On a
# perdu une soiree a chercher le defaut dans l'annulation de commande.
arreter_serveur() {
  for p in $(pgrep -f "src/server.js" 2>/dev/null); do
    cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
    case "$cmd" in node*) kill "$p" 2>/dev/null;; esac
  done
  for _ in $(seq 1 20); do
    curl -sf -m 1 http://localhost:4000/health > /dev/null 2>&1 || return 0
    sleep 0.5
  done
  # Il s'accroche : on insiste, puis on laisse le demarrage trancher.
  pkill -9 -f "src/server.js" 2>/dev/null
  sleep 1
}

demarrer_serveur() {
  node src/server.js > "$LOGS/serveur.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 25); do
    # Il ne suffit pas qu'un serveur reponde : il faut que ce soit
    # celui-ci. `demarreDepuisS` le dit, et c'est pour cela qu'il existe.
    if kill -0 "$pid" 2>/dev/null &&
       curl -sf -m 2 http://localhost:4000/health 2>/dev/null |
         grep -qE '"demarreDepuisS":[0-9]{1,2}[,}]'; then
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break
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
