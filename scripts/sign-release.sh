#!/usr/bin/env bash
# Signs the unsigned release builds on this machine, so the release key never reaches the build PC.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="$ROOT/key.properties"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
TOOLS="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
JKS=$(sed -n 's/^storeFile=//p' "$PROPS")
ALIAS=$(sed -n 's/^keyAlias=//p' "$PROPS")
export OCTOBOT_STOREPASS="$(sed -n 's/^storePassword=//p' "$PROPS")"

AAB="$ROOT/release/bundle/release/app-release.aab"
"$JAVA_HOME/bin/jarsigner" -keystore "$JKS" -storepass:env OCTOBOT_STOREPASS -digestalg SHA-256 -sigalg SHA256withRSA "$AAB" "$ALIAS" > /dev/null
"$JAVA_HOME/bin/jarsigner" -verify "$AAB" | head -1

APK_IN="$ROOT/release/apk/release/app-release-unsigned.apk"
APK_OUT="$ROOT/release/octobot-release.apk"
"$TOOLS/zipalign" -f -p 4 "$APK_IN" "$APK_OUT"
JAVA_HOME="$JAVA_HOME" PATH="$JAVA_HOME/bin:$PATH" "$TOOLS/apksigner" sign --ks "$JKS" --ks-pass env:OCTOBOT_STOREPASS "$APK_OUT"
JAVA_HOME="$JAVA_HOME" PATH="$JAVA_HOME/bin:$PATH" "$TOOLS/apksigner" verify --print-certs "$APK_OUT" | grep -E "SHA-256"
ls -la "$AAB" "$APK_OUT"
