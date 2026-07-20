# Branch scenario lab

Each scenario branch runs the same Food Lens application and Epistemic Engine, but supplies a deliberately different evidence path. A branch is successful when the Engine reaches the expected decision—even when that decision blocks deployment.

| Branch | Evidence path | Expected certificate | Action |
| --- | --- | --- | --- |
| `scenario/supported-release` | Build, tests, compatibility, privacy, and rollback evidence | `VERIFIED` | Allowed |
| `scenario/insufficient-evidence` | No direct release evidence | `INSUFFICIENT_EVIDENCE` | Blocked |
| `scenario/privacy-contradiction` | Passing privacy check plus a PII-bearing runtime log | `CONTRADICTED` | Blocked |
| `scenario/bounded-verification` | Build and tests, then two approved sandbox verifications | `VERIFIED_WITH_CONDITIONS` | Blocked pending human approval |

## Run the selected branch locally

Start the PostgreSQL-backed Engine and dashboard, check out one scenario branch, then run:

```sh
npm ci
npm run test:scenario
```

Without switching branches, a local developer can override the manifest selection, for example:

```powershell
$env:EPISTEMIC_SCENARIO = "privacy-contradiction"
npm run test:scenario
```

The command prints the account-specific dashboard URL and writes:

- `.epistemic/branch-scenario-report.json` — expected versus observed decision and object IDs
- `.epistemic/branch-certificate.json` — machine-readable certificate
- `.epistemic/branch-certificate-report.md` — human decision report

GitHub Actions also runs the full Engine contract suite, runs the selected path, restarts the Engine, proves that both the full-scope and branch-specific state survived in PostgreSQL, and uploads all reports as the `food-lens-engine-scope` artifact.

To add another path, add its event and assertion contract to `scripts/run-branch-scenario.mjs`, select it in `epistemic-scenario.json`, and create a branch whose name matches the manifest's `branch` value.
