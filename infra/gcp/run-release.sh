#!/bin/sh
set -eu
# The official CLI image bundles Python without necessarily putting python3 on
# PATH. Ask gcloud which interpreter it is actually using.
PYTHON="$(gcloud info --format='value(basic.python_location)')"
if [ -z "$PYTHON" ] || [ ! -x "$PYTHON" ]; then
  echo "Google Cloud CLI did not report an executable Python runtime." >&2
  exit 1
fi
# Bundled Python may have a compiled-in CA location absent from the container.
# Use a real trusted bundle; never disable TLS verification.
SDK_ROOT="$(gcloud info --format='value(installation.sdk_root)')"
for CA in /etc/ssl/certs/ca-certificates.crt \
  "$SDK_ROOT/lib/third_party/certifi/cacert.pem" \
  "$SDK_ROOT/lib/third_party/httplib2/cacerts.txt"; do
  if [ -r "$CA" ] && [ -s "$CA" ]; then
    export SSL_CERT_FILE="$CA"
    break
  fi
done
if [ -z "${SSL_CERT_FILE:-}" ]; then
  echo "A trusted certificate bundle is required for release HTTPS requests." >&2
  exit 1
fi
exec "$PYTHON" infra/gcp/deploy-release.py "$@"
