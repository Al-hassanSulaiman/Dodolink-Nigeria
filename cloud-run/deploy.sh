#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Dodolink NG — Google Cloud Run deployment script
# Run from the project root: bash cloud-run/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration — edit these ───────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
REPO="dodolink"                          # Artifact Registry repo name
API_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/api-server"
ADMIN_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/admin-dashboard"
TAG="${1:-latest}"

echo "▶ Project : $PROJECT_ID"
echo "▶ Region  : $REGION"
echo "▶ Tag     : $TAG"

# ── 1. Authenticate & set project ────────────────────────────────────────────
gcloud config set project "$PROJECT_ID"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# ── 2. Create Artifact Registry repo (idempotent) ────────────────────────────
gcloud artifacts repositories describe "$REPO" \
  --location="$REGION" &>/dev/null || \
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Dodolink NG images"

# ── 3. Build & push images from project root ─────────────────────────────────
echo "▶ Building API server…"
docker build \
  -f artifacts/api-server/Dockerfile \
  -t "$API_IMAGE:$TAG" \
  .

echo "▶ Building Admin Dashboard…"
docker build \
  -f artifacts/admin-dashboard/Dockerfile \
  -t "$ADMIN_IMAGE:$TAG" \
  .

docker push "$API_IMAGE:$TAG"
docker push "$ADMIN_IMAGE:$TAG"

# ── 4. Deploy to Cloud Run ────────────────────────────────────────────────────
echo "▶ Deploying API server…"
# Substitute placeholders in service YAML then deploy
sed \
  -e "s|REGION-docker.pkg.dev/PROJECT_ID/$REPO/api-server:latest|$API_IMAGE:$TAG|g" \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|REGION|$REGION|g" \
  cloud-run/api-service.yaml | \
  gcloud run services replace - --region="$REGION"

echo "▶ Deploying Admin Dashboard…"
sed \
  -e "s|REGION-docker.pkg.dev/PROJECT_ID/$REPO/admin-dashboard:latest|$ADMIN_IMAGE:$TAG|g" \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|REGION|$REGION|g" \
  cloud-run/admin-service.yaml | \
  gcloud run services replace - --region="$REGION"

echo "✅ Deployment complete."
gcloud run services describe dodolink-api  --region="$REGION" --format="value(status.url)"
gcloud run services describe dodolink-admin --region="$REGION" --format="value(status.url)"
