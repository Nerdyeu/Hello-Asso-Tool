#!/bin/bash
# Installe (ou met à jour) Trombinoscope sur Mac, sans blocage Gatekeeper.
# Usage : curl -fsSL https://raw.githubusercontent.com/Nerdyeu/Hello-Asso-Tool/main/install-mac.sh | bash
# Un fichier téléchargé avec curl n'est pas mis en « quarantaine » par macOS, contrairement à un
# téléchargement via Safari/Chrome : l'application s'ouvre donc directement, sans « Ouvrir quand même ».
set -euo pipefail

REPO="Nerdyeu/Hello-Asso-Tool"
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ASSET="Trombinoscope-Mac-AppleSilicon.zip"
else
  ASSET="Trombinoscope-Mac-Intel.zip"
fi
URL="https://github.com/$REPO/releases/latest/download/$ASSET"

DEST="/Applications"
if [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; mkdir -p "$DEST"; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Téléchargement de $ASSET…"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"

# ferme une éventuelle version en cours d'exécution avant de la remplacer
pkill -f "Trombinoscope.app/Contents/MacOS/" 2>/dev/null || true

rm -rf "$DEST/Trombinoscope.app"
ditto -x -k "$TMP/app.zip" "$DEST"
xattr -dr com.apple.quarantine "$DEST/Trombinoscope.app" 2>/dev/null || true

echo "Installé dans $DEST/Trombinoscope.app — lancement…"
open "$DEST/Trombinoscope.app"
