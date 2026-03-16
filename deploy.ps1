# ============================================================================
# Sentinel-911 — Automated Google Cloud Run Deployment (Windows PowerShell)
# ============================================================================
# Usage:
#   .\deploy.ps1
# ============================================================================

$ErrorActionPreference = "Continue"

# ── Configuration ──────────────────────────────────────────────────────────
$PROJECT_ID = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { (gcloud config get-value project 2>$null).Trim() }
$REGION = if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }
$SERVICE_NAME = "sentinel911-backend"
$IMAGE_NAME = "sentinel911"
$REPO_NAME = "sentinel911-repo"

if (-not $PROJECT_ID) {
    Write-Error "ERROR: No GCP project set. Run 'gcloud config set project YOUR_PROJECT_ID'"
    exit 1
}

# Read API key from env or from .env file
$API_KEY = $env:GEMINI_API_KEY
if (-not $API_KEY) {
    if (Test-Path ".\server_end\.env") {
        Get-Content ".\server_end\.env" | ForEach-Object {
            if ($_ -match "^GEMINI_API_KEY=(.+)$") {
                $API_KEY = $matches[1]
            }
        }
    }
}
if (-not $API_KEY) {
    Write-Error "ERROR: GEMINI_API_KEY not found. Set via `$env:GEMINI_API_KEY = 'your_key'` or add to server_end\.env"
    exit 1
}

$AES_SECRET = if ($env:AES_SECRET) { $env:AES_SECRET } else { "d3377d4ddc5d3f33c6a9100d28993874" }

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " Sentinel-911 Cloud Deployment" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  Project:  $PROJECT_ID"
Write-Host "  Region:   $REGION"
Write-Host "  Service:  $SERVICE_NAME"
Write-Host ""

# ── Step 1: Enable required APIs ──────────────────────────────────────────
Write-Host "1/5 Enabling required Google Cloud APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com --project="$PROJECT_ID" --quiet

# ── Step 2: Deploy to Cloud Run using source deploy (builds remotely via Cloud Build) ──
Write-Host "2/5 Building and deploying via Cloud Build (no local Docker needed)..." -ForegroundColor Yellow
Write-Host "  This will take 2-5 minutes..." -ForegroundColor Gray

$ENV_VARS = "GEMINI_API_KEY=$API_KEY,GCP_PROJECT_ID=$PROJECT_ID,AES_SECRET=$AES_SECRET"

gcloud run deploy $SERVICE_NAME `
    --source="./server_end" `
    --region="$REGION" `
    --project="$PROJECT_ID" `
    --platform=managed `
    --allow-unauthenticated `
    --memory=1Gi `
    --cpu=1 `
    --timeout=300 `
    --set-env-vars="$ENV_VARS" `
    --quiet

# ── Get service URL ───────────────────────────────────────────────────────
$SERVICE_URL = (gcloud run services describe $SERVICE_NAME --region="$REGION" --project="$PROJECT_ID" --format="value(status.url)").Trim()

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Deployed Successfully!" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host "  Service URL: $SERVICE_URL" -ForegroundColor White
Write-Host "  Health Check: $SERVICE_URL/api/health" -ForegroundColor White
Write-Host ""
Write-Host "  To connect your frontend:" -ForegroundColor Yellow
Write-Host "  Set VITE_BACKEND_URL=$SERVICE_URL in .env.local" -ForegroundColor Yellow
Write-Host ""
