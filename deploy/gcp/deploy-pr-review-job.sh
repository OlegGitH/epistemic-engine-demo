#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-europe-west1}"
PREFIX="${EPISTEMIC_RESOURCE_PREFIX:-epistemic}"
SECRET_NAME="${OPENAI_SECRET_NAME:-OPENAI_API_KEY}"
CONTROL_PLANE_URL="${EPISTEMIC_ENDPOINT:-https://epistemic-control-plane-r7zqwwvzgq-ew.a.run.app}"
DASHBOARD_URL="${EPISTEMIC_DASHBOARD_ENDPOINT:-https://epistemic-dashboard-r7zqwwvzgq-ew.a.run.app}"
MODEL="${OPENAI_MODEL:-gpt-5.6}"
RUNTIME_SA="${PREFIX}-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
REPOSITORY="${PREFIX}-containers"
JOB="${PREFIX}-pr-review-live"
TAG="${GITHUB_SHA:-$(git rev-parse --short=12 HEAD)}"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/pr-review-live:${TAG}"

SECRET_VERSION="$(gcloud secrets versions list "$SECRET_NAME" \
  --project "$GCP_PROJECT_ID" \
  --filter 'state=ENABLED' \
  --sort-by '~createTime' \
  --limit 1 \
  --format 'value(name)')"
if [[ -z "$SECRET_VERSION" ]]; then
  echo "No enabled version exists for Secret Manager secret ${SECRET_NAME}." >&2
  exit 1
fi

gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --project "$GCP_PROJECT_ID" \
  --member "serviceAccount:${RUNTIME_SA}" \
  --role roles/secretmanager.secretAccessor \
  --quiet >/dev/null

gcloud builds submit . \
  --project "$GCP_PROJECT_ID" \
  --region "$REGION" \
  --config deploy/gcp/cloudbuild-pr-review-job.yaml \
  --substitutions "_IMAGE=${IMAGE}"

JOB_ARGS=(
  --project "$GCP_PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE"
  --service-account "$RUNTIME_SA"
  --set-secrets "OPENAI_API_KEY=${SECRET_NAME}:${SECRET_VERSION}"
  --set-env-vars "PR_REVIEW_PROVIDER=openai,OPENAI_MODEL=${MODEL},EPISTEMIC_ENDPOINT=${CONTROL_PLANE_URL},EPISTEMIC_DASHBOARD_ENDPOINT=${DASHBOARD_URL},EPISTEMIC_REQUIRE_DURABLE=true"
  --tasks 1
  --max-retries 0
  --task-timeout 20m
  --memory 512Mi
  --cpu 1
)

if gcloud run jobs describe "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB" "${JOB_ARGS[@]}"
else
  gcloud run jobs create "$JOB" "${JOB_ARGS[@]}"
fi

echo "Deployed ${JOB} with ${SECRET_NAME} version ${SECRET_VERSION}."
echo "The secret value was not read or printed by this deployment script."
if [[ "${RUN_AFTER_DEPLOY:-false}" == "true" ]]; then
  gcloud run jobs execute "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" --wait
fi
