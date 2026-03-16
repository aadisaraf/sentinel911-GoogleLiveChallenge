#!/bin/bash
# ============================================================================
# Sentinel-911 — Automated Google Cloud Run Deployment (IaC)
# ============================================================================
# This script automates the full deployment pipeline:
#   1. Builds the Docker image for the FastAPI backend
#   2. Pushes it to Google Artifact Registry
#   3. Deploys to Cloud Run with all required env vars
#
# Prerequisites:
#   - Google Cloud SDK (gcloud) installed and authenticated
#   - A GCP project with billing enabled
#   - APIs enabled: Cloud Run, Artifact Registry, Firestore
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="sentinel911-backend"
IMAGE_NAME="sentinel911"
REPO_NAME="sentinel911-repo"

if [ -z "$PROJECT_ID" ]; then
  echo "❌ ERROR: No GCP project set. Run 'gcloud config set project YOUR_PROJECT_ID' or export GCP_PROJECT_ID"
  exit 1
fi

echo "🚀 Sentinel-911 Cloud Deployment"
echo "   Project:  $PROJECT_ID"
echo "   Region:   $REGION"
echo "   Service:  $SERVICE_NAME"
echo ""

# ── Step 1: Enable required APIs ──────────────────────────────────────────
echo "📦 Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  --project="$PROJECT_ID" --quiet

# ── Step 2: Create Artifact Registry repo (if not exists) ─────────────────
echo "📦 Setting up Artifact Registry..."
gcloud artifacts repositories describe "$REPO_NAME" \
  --location="$REGION" --project="$PROJECT_ID" 2>/dev/null || \
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --description="Sentinel-911 Docker images"

# ── Step 3: Configure Docker authentication ───────────────────────────────
echo "🔐 Configuring Docker authentication..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Step 4: Build Docker image ────────────────────────────────────────────
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:latest"
echo "🐳 Building Docker image..."
docker build -t "$IMAGE_URI" ./server_end

# ── Step 5: Push to Artifact Registry ─────────────────────────────────────
echo "📤 Pushing image to Artifact Registry..."
docker push "$IMAGE_URI"

# ── Step 6: Deploy to Cloud Run ───────────────────────────────────────────
echo "☁️  Deploying to Cloud Run..."

# Check for required secrets
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "⚠️  GEMINI_API_KEY not set in environment. Reading from server_end/.env..."
  if [ -f "./server_end/.env" ]; then
    export $(grep -v '^#' ./server_end/.env | xargs)
  fi
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "❌ ERROR: GEMINI_API_KEY is required. Set it via: export GEMINI_API_KEY=your_key"
  exit 1
fi

gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --set-env-vars="GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars="AES_SECRET=${AES_SECRET:-d3377d4ddc5d3f33c6a9100d28993874}" \
  --quiet

# ── Step 7: Get service URL ───────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Sentinel-911 Backend Deployed Successfully!"
echo "═══════════════════════════════════════════════════════════"
echo "   Service URL: $SERVICE_URL"
echo "   Health Check: $SERVICE_URL/api/health"
echo ""
echo "   To connect your frontend, create .env.local with:"
echo "   VITE_BACKEND_URL=$SERVICE_URL"
echo ""
echo "   Then rebuild: npm run build"
echo "═══════════════════════════════════════════════════════════"
