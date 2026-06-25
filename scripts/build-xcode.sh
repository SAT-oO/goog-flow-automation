#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/extension"
OUT_DIR="$ROOT"

if [[ ! -d "$EXT_DIR" ]]; then
  echo "Missing extension directory: $EXT_DIR" >&2
  exit 1
fi

APP_NAME="Flow Image Automator"
BUNDLE_ID="com.googflow.image-automator"

echo "Converting web extension to Safari Xcode project..."
xcrun safari-web-extension-converter "$EXT_DIR" \
  --project-location "$OUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --copy-resources \
  --force

echo "Done. Open: $OUT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
