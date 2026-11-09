#!/bin/bash
# Double-cliquez sur ce fichier pour lancer le Trombinoscope.
cd "$(dirname "$0")"
xattr -dr com.apple.quarantine . 2>/dev/null
chmod +x ./Trombinoscope
./Trombinoscope
