# Dodolink NG — Google Cloud Run Deployment Guide

## Architecture

```
Mobile App (Expo) ──────────────────────────────────► Cloud Run: dodolink-api
Admin Dashboard (nginx) ────────────────────────────► Cloud Run: dodolink-admin
                                                              │
                                                    Cloud SQL (PostgreSQL)
                                                    Google Cloud Storage
```

## Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- Docker installed
- A GCP project with billing enabled
- Your own Clerk account (see step 1 below)

---

## Step 1 — Get your own Clerk keys (REQUIRED)

> **Why?** Replit's Clerk keys are locked to Replit's infrastructure and
> cannot be used outside it.

1. Go to **https://clerk.com** and create a free account
2. Create a new application (call it "Dodolink NG")
3. In Clerk Dashboard → **API Keys**, copy:
   - `CLERK_PUBLISHABLE_KEY` (starts with `pk_live_...` for production)
   - `CLERK_SECRET_KEY` (starts with `sk_live_...` for production)
4. Under **Domains**, add your Cloud Run URL once you have it

> ⚠️ Important: Users who signed up during Replit testing will NOT carry over.
> Clerk development and production environments have separate user stores.

---

## Step 2 — Enable GCP APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com
```

---

## Step 3 — Create Cloud SQL instance

```bash
gcloud sql instances create dodolink-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1

gcloud sql databases create dodolink --instance=dodolink-db

gcloud sql users create dodolink \
  --instance=dodolink-db \
  --password=YOUR_STRONG_PASSWORD
```

Your `DATABASE_URL` will be:
```
postgresql://dodolink:YOUR_STRONG_PASSWORD@localhost/dodolink?host=/cloudsql/PROJECT_ID:us-central1:dodolink-db
```

---

## Step 4 — Create GCS bucket

```bash
gcloud storage buckets create gs://dodolink-storage \
  --location=us-central1 \
  --uniform-bucket-level-access
```

---

## Step 5 — Create service account

```bash
# Create the service account
gcloud iam service-accounts create dodolink-api-sa \
  --display-name="Dodolink API Service Account"

# Grant Cloud SQL access
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:dodolink-api-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Grant GCS access
gcloud storage buckets add-iam-policy-binding gs://dodolink-storage \
  --member="serviceAccount:dodolink-api-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Allow signed URL creation
gcloud iam service-accounts add-iam-policy-binding \
  dodolink-api-sa@PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:dodolink-api-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Allow Secret Manager access
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:dodolink-api-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Step 6 — Store secrets in Secret Manager

```bash
# Run these one by one, pasting each value when prompted
echo -n "YOUR_DATABASE_URL" | \
  gcloud secrets create database-url --data-file=-

echo -n "pk_live_..." | \
  gcloud secrets create clerk-publishable-key --data-file=-

echo -n "sk_live_..." | \
  gcloud secrets create clerk-secret-key --data-file=-

echo -n "sk_live_..." | \
  gcloud secrets create paystack-secret-key --data-file=-

echo -n "pk_live_..." | \
  gcloud secrets create paystack-public-key --data-file=-

openssl rand -hex 64 | tr -d '\n' | \
  gcloud secrets create session-secret --data-file=-
```

---

## Step 7 — Run database migrations

```bash
# Run once to push your Drizzle schema to Cloud SQL
DATABASE_URL="postgresql://dodolink:PASSWORD@YOUR_CLOUD_SQL_IP/dodolink" \
  pnpm --filter @workspace/db run push
```

---

## Step 8 — Deploy

```bash
export GCP_PROJECT_ID=your-project-id
export GCP_REGION=us-central1
bash cloud-run/deploy.sh
```

This builds both Docker images, pushes them to Artifact Registry, and deploys both Cloud Run services.

---

## Step 9 — Update Mobile App API URL

After deployment, update the Expo app to point to your new Cloud Run API URL:

In `artifacts/dodolink-ng/`, set:
```
EXPO_PUBLIC_API_URL=https://dodolink-api-XXXX-uc.a.run.app
```

---

## Updating after code changes

```bash
bash cloud-run/deploy.sh v2   # tag as v2
```
