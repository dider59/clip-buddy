#!/bin/bash
set -e
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/clip-buddy@minimal.shell"
echo "Compiling schemas in $EXT_DIR/schemas/"
cd "$EXT_DIR"
glib-compile-schemas schemas/
echo "Done. gschemas.compiled created:"
ls -lh schemas/gschemas.compiled
echo ""
echo "Now enable extension:"
echo "  gnome-extensions enable clip-buddy@minimal.shell"
echo "Then restart shell: Wayland = logout/login, X11 = Alt+F2 -> r"
