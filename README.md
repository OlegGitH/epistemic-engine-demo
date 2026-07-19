# Food Lens — Epistemic Engine demo

Food Lens is a deliberately small, transparent image-classification application for testing the Epistemic Engine pipeline. A user uploads a meal photo, the browser extracts aggregate visual features, and a deterministic demo model classifies the image as `healthy`, `mixed`, or `less_healthy`.

The model is educational only. It is not a medical, nutritional, allergy, or ingredient-identification tool.

## Run locally

```bash
npm install
npm start
```

Open <http://127.0.0.1:4300>. You can upload an image or use the bundled salad, pizza, and donut samples.

## Test

```bash
npm test
npm run smoke
npm run evidence
```

`npm run evidence` executes the unit and smoke tests itself before writing evidence; it does not declare success from a hard-coded fixture. It records command results and SHA-256 hashes of the release inputs.

With the Epistemic Engine running on port `8080`, exercise its dependency-free full scope:

```bash
npm run test:engine
```

Or run the application, evidence, and engine checks together:

```bash
npm run test:full
```

Set `EPISTEMIC_ENDPOINT` to target another Engine URL. The report is written to `.epistemic/engine-scope-report.json` and includes a dashboard URL for the isolated test account. The repository has no runtime dependencies. Node.js 20 or newer is sufficient.

## Engine scope matrix

The full-scope harness makes every expected outcome executable:

| Capability | Expected result |
| --- | --- |
| Discovery and tool catalog | Protocol features advertised; GitHub pipeline generated |
| Portable event ingestion | Single and batch events accepted; duplicate is idempotent; sequence collision rejected |
| Portable decision | Complete evidence plus approval produces `allow` and a stable certificate |
| Supported control-plane run | Four critical claims supported; approved action is `VERIFIED` |
| Missing evidence | Critical unknowns produce `INSUFFICIENT_EVIDENCE` |
| Contradiction | A PII-bearing log produces `CONTRADICTED` even with approval |
| Bounded verification | Unapproved and production execution rejected; approved sandbox artifacts accepted |
| Certificate ingestion | Valid proof accepted idempotently; tampered proof rejected |
| Authentication lifecycle | Invalid and revoked ingest tokens rejected; rotation restores the connection |
| Dashboard aggregation | Runs, claims, evidence, contradictions, reports, AI usage, and certificates aggregated |
| Streaming | Run endpoint emits an SSE graph snapshot |

The GitHub workflow starts a pinned, isolated in-memory Engine and runs this matrix on every change. PostgreSQL, optional Docker/Codex/OpenAI integrations, and GCP infrastructure remain separate integration environments and are listed explicitly as exclusions in the generated report.

## Evidence boundary

- Raw image bytes stay in the browser.
- The API rejects raw-image, base64, byte-array, and data-URL fields, including nested fields.
- A 48×48 canvas sample is reduced to aggregate RGB, brightness, colorfulness, and edge-density values.
- The API receives those features plus file metadata and an SHA-256 digest.
- The response exposes the model version, score, confidence, signals, and disclaimer.
- The deterministic behavior makes CI and Epistemic evidence reproducible.

`.epistemic.yaml` describes the release decision and `.github/workflows/ci.yml` runs unit tests, an API smoke test, produces executable evidence, evaluates the portable release decision, and exercises the pinned Engine scope.

When `EPISTEMIC_ENDPOINT`, `EPISTEMIC_AI_SYSTEM_ID`, and the `EPISTEMIC_INGEST_TOKEN` secret are configured in GitHub, the workflow publishes its real commit SHA, report, and verified certificate to the account dashboard. Without those values, publication is skipped while tests and local certification still run.
