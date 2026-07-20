# PR requirement coverage lab

This lab asks a second demo AI system to compare a written change request with PR text and supplied code, test, and documentation artifacts. Epistemic Engine then independently gates the result one requirement at a time.

| Scenario | What the reviewer sees | Expected certificate | Merge gate |
| --- | --- | --- | --- |
| Fully covered | Four high-confidence assessments with direct evidence | `VERIFIED` | Allowed after approval |
| Partially covered | Working core change, missing regression and migration coverage | `VERIFIED_WITH_CONDITIONS` | Blocked |
| Missing coverage | No assessment or artifact for a security requirement | `INSUFFICIENT_EVIDENCE` | Blocked |
| Contradicted | PR text claims compatibility while a legacy test fails | `CONTRADICTED` | Blocked despite approval |
| Confidence only | 99% reviewer confidence with no artifact reference | `INSUFFICIENT_EVIDENCE` | Blocked |

The default provider is recorded and deterministic. It tests the real application, Engine, database, policy, certificate, human report, and dashboard paths without pretending that a live model call occurred.

```sh
npm run test:pr-review
```

To run the same contract against a live model, provide an API key and select the OpenAI provider:

```powershell
$env:OPENAI_API_KEY = "..."
$env:PR_REVIEW_PROVIDER = "openai"
$env:OPENAI_MODEL = "gpt-5.6"
npm run test:pr-review
```

Live mode uses the OpenAI [Responses API](https://developers.openai.com/api/reference/responses/create) with [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Model text is treated as untrusted evidence. The adapter rejects invented artifact IDs, and the Engine will not support a critical claim merely because the reviewer reports high confidence.

Outputs are written under `.epistemic/pr-review/`, with an aggregate `.epistemic/pr-review-suite-report.json`. Every scenario includes a direct run-inspector URL, certificate digest, expected/observed result, claim states, and open-unknown count.

## Private GCP live runner

The live provider is packaged as the private, on-demand Cloud Run Job `epistemic-pr-review-live`. It has no public HTTP endpoint and consumes the OpenAI key from Secret Manager only at runtime.

```sh
export GCP_PROJECT_ID=epistemic-503011
export OPENAI_SECRET_NAME=OPENAI_API_KEY
bash deploy/gcp/deploy-pr-review-job.sh
gcloud run jobs execute epistemic-pr-review-live \
  --project epistemic-503011 \
  --region europe-west1 \
  --wait
```

The deployment pins the newest enabled secret version instead of embedding the key in an image, build argument, environment file, source file, or command output. A Cloud Run Job has no idle service instance; compute exists only for an execution.
