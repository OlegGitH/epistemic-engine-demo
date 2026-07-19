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

The repository has no runtime dependencies. Node.js 20 or newer is sufficient.

## Evidence boundary

- Raw image bytes stay in the browser.
- A 48×48 canvas sample is reduced to aggregate RGB, brightness, colorfulness, and edge-density values.
- The API receives those features plus file metadata and an SHA-256 digest.
- The response exposes the model version, score, confidence, signals, and disclaimer.
- The deterministic behavior makes CI and Epistemic evidence reproducible.

`.epistemic.yaml` describes the release decision and `.github/workflows/ci.yml` runs unit tests, an API smoke test, and produces `.epistemic/ci-evidence.json` for downstream certification.

When `EPISTEMIC_ENDPOINT`, `EPISTEMIC_AI_SYSTEM_ID`, and the `EPISTEMIC_INGEST_TOKEN` secret are configured in GitHub, the workflow publishes its real commit SHA, report, and verified certificate to the account dashboard. Without those values, publication is skipped while tests and local certification still run.
