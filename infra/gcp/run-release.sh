#!/bin/sh
set -eu
# The official CLI image bundles Python without necessarily putting python3 on
# PATH. Ask gcloud which interpreter it is actually using.
PYTHON="$(gcloud info --format='value(basic.python_location)')"
if [ -z "$PYTHON" ] || [ ! -x "$PYTHON" ]; then
  echo "Google Cloud CLI did not report an executable Python runtime." >&2
  exit 1
fi
exec "$PYTHON" infra/gcp/deploy-release.py "$@"
