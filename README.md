# RML Implementation Report

This repository generates the RML implementation report published as static HTML.

If you want to add your engine results, the expected workflow is:

1. Fork this repository.
2. Edit the data files for your engine.
3. Regenerate the report.
4. Open a pull request with your changes.

## What you need to edit

Most contributors only need to touch these files:

- `data/processors.csv`: add one row for your engine metadata
- `data/results/<your-engine>.csv`: add your per-test results

## Step by step

### 1. Fork and clone

Fork the repository on GitHub, then clone your fork locally.

### 2. Add your engine metadata

In `data/processors.csv`, add one line for your implementation:

`processor_id,name,version,release_date,contact,homepage,results_file`

Example:

```csv
my-engine,My Engine,1.0.0,2026-05-26,team@example.org,https://example.org/my-engine,results/my-engine.csv
```

Notes:

- `processor_id` should be stable and unique
- `results_file` should usually point to `results/<processor_id>.csv`
- `release_date` should use `YYYY-MM-DD`

### 3. Add your test results

Create a file in `data/results/` for your engine, for example `data/results/my-engine.csv`.

Format:

`testcase_id,status,notes`

Example:

```csv
testcase_id,status,notes
RMLTC0000-JSON,passed,
RMLTC0002g-JSON,failed,Invalid JSONPath is not handled yet
RMLLVTC0005a,inapplicable,Feature not implemented in this release
```

Allowed values for `status`:

- `passed`
- `failed`
- `inapplicable`

About `notes`:

- leave it empty when there is nothing to explain
- use it to describe a limitation, known issue, or reason for failure/inapplicability
- the generated report shows this text from the result cell

## Where the test cases come from

The report reads the official test-case metadata from the module repositories listed in `data/modules.csv`.

## Regenerate the report locally

After editing your CSV files, if you want to see the results locally, please execute:

```bash
node scripts/export-docs.mjs
```

This updates:

- `docs/index.html`
- `docs/resources/`
- `docs/<YYYY-MM-DD>/`

The export uses ReSpec and embeds the resolved data snapshot into the generated HTML, so the published page does not need to fetch CSV files at runtime.

## Submit your contribution

Once the generated output looks correct:

1. Commit only your CSV changes 
2. Push to your fork
3. Open a pull request

