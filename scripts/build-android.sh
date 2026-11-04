#!/usr/bin/env bash
# Builds the Android app on the build PC inside Docker and copies the result back.
# Usage: scripts/build-android.sh [assembleDebug|bundleRelease]
set -euo pipefail

TASK="${1:-assembleDebug}"
HOST="${ANDROID_BUILD_HOST:?set ANDROID_BUILD_HOST to user@host of a machine with Docker}"
REMOTE_DIR="projects/robot-octopus"
IMAGE="octobot-android-builder:1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  --exclude node_modules --exclude dist --exclude site --exclude .git --exclude .wrangler \
  --exclude .gradle --exclude build --exclude 'android/app/src/main/assets/public' \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

ssh "$HOST" bash -s -- "$TASK" "$REMOTE_DIR" "$IMAGE" <<'REMOTE'
set -euo pipefail
TASK="$1"; DIR="$HOME/$2"; IMAGE="$3"
docker build -q -t "$IMAGE" "$DIR/scripts/android" > /dev/null
# The home folder holds the debug keystore. Losing it would make every build refuse to update.
mkdir -p "$HOME/.cache/octobot-gradle" "$HOME/.cache/octobot-npm" "$HOME/.cache/octobot-home"
# --rm and a named image only: nothing else on this machine is touched.
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home -e ANDROID_USER_HOME=/tmp/home/.android -e GRADLE_USER_HOME=/gradle -e npm_config_cache=/npm \
  -v "$HOME/.cache/octobot-gradle:/gradle" -v "$HOME/.cache/octobot-npm:/npm" \
  -v "$HOME/.cache/octobot-home:/tmp/home" \
  -v "$DIR:/work" -w /work "$IMAGE" bash -c "
    set -euo pipefail
    npm ci --no-audit --no-fund
    npm run build:site
    npx cap sync android
    cd android
    ./gradlew --no-daemon --console=plain $TASK
  "
REMOTE

mkdir -p "$ROOT/release"
rsync -az --include='*/' --include='*.apk' --include='*.aab' --exclude='*' --prune-empty-dirs \
  "$HOST:$REMOTE_DIR/android/app/build/outputs/" "$ROOT/release/"
find "$ROOT/release" -type f \( -name '*.apk' -o -name '*.aab' \) -exec ls -la {} +
