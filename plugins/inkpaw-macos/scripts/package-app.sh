#!/bin/bash
# Produce a local development app bundle only. No signing, notarization, install,
# Launch Services registration, account access, or publication is performed.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    printf '%s\n' 'Inkpaw app packaging requires macOS 15+ with Xcode command-line tools. Linux can run only the portable contract tests.' >&2
    exit 1
fi

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ -L "$PACKAGE_ROOT/.build" ]]; then
    printf '%s\n' 'Refusing to package through a symlinked .build directory.' >&2
    exit 1
fi
cd "$PACKAGE_ROOT"

swift build --configuration release --product InkpawCompanion
BIN_DIR="$(swift build --configuration release --show-bin-path)"
BINARY="$BIN_DIR/InkpawCompanion"
if [[ ! -x "$BINARY" ]]; then
    printf 'Missing compiled executable: %s\n' "$BINARY" >&2
    exit 1
fi

OUTPUT="$PACKAGE_ROOT/.build/unsigned"
if [[ -L "$OUTPUT" ]]; then
    printf '%s\n' 'Refusing to package through a symlinked output directory.' >&2
    exit 1
fi
mkdir -p "$OUTPUT"
STAGING="$(mktemp -d "$OUTPUT/.InkpawCompanion.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
APP="$STAGING/InkpawCompanion.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/InkpawCompanion"
chmod 755 "$APP/Contents/MacOS/InkpawCompanion"
cp "$PACKAGE_ROOT/Packaging/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
plutil -lint "$APP/Contents/Info.plist"

# The only replaced output is this script's own generated bundle inside .build.
FINAL_APP="$OUTPUT/InkpawCompanion.app"
if [[ -L "$FINAL_APP" ]]; then
    printf '%s\n' 'Refusing to replace a symlinked app bundle.' >&2
    exit 1
fi
rm -rf -- "$FINAL_APP"
mv "$APP" "$FINAL_APP"
ARCHIVE="$OUTPUT/InkpawCompanion-unsigned.zip"
if [[ -L "$ARCHIVE" ]]; then
    printf '%s\n' 'Refusing to replace a symlinked archive.' >&2
    exit 1
fi
ditto -c -k --sequesterRsrc --keepParent "$FINAL_APP" "$ARCHIVE"
printf '\nLocal app: %s\nArchive: %s\n' "$FINAL_APP" "$ARCHIVE"
printf '%s\n' 'No Developer ID signing or notarization was performed. This is a development artifact, not a Gatekeeper-approved release.'
