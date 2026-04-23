# RML Implementation Report

Static implementation report for GitHub Pages using ReSpec and CSV files.

## Structure

- `dev.html`: ReSpec source document
- `css/style.css`: visual tweaks
- `js/app.js`: loads module inventories and engine CSV files, or uses embedded snapshot data in `docs/index.html`
- `scripts/export-docs.mjs`: exports `docs/index.html` from `dev.html` via ReSpec CLI and embeds a data snapshot
- `data/modules.csv`: list of RML modules and the CSV to fetch test cases from
- `data/processors.csv`: implementations metadata
- `data/testcases/*.csv`: example module test-case inventories using the upstream format
- `data/results/*.csv`: one result file per engine

## CSV formats

### modules.csv
`module_id,module_name,specification_slug,testcases_csv`

Each row points to a CSV with the module test cases. By default this project points directly to the raw files in the `kg-construct` GitHub repositories. The app expects the CSV to include at least:

`ID,title,description,specification,...,error`

You can keep these CSVs local for testing, but the default setup uses the raw GitHub URLs directly.

### processors.csv
`processor_id,name,version,release_date,contact,homepage,results_file`

`results_file` is optional. If omitted, the app looks for `data/results/<processor_id>.csv`.

### data/results/<engine>.csv
`testcase_id,status,notes`

You can also keep a `processor_id` column in each result file; when it is missing, the app fills it from the engine declared in `processors.csv`.

Allowed `status` values:
- `passed`
- `failed`
- `inapplicable`

## Publish on GitHub Pages

1. Run `node scripts/export-docs.mjs`.
2. Commit the generated `docs/` output.
3. Enable GitHub Pages from `docs/`.
4. Open the published URL.

The export script uses ReSpec's own HTML export through `npx respec`, then embeds the resolved data snapshot into `docs/index.html` so the published page does not fetch CSV files at runtime.

## Suggested next step

Replace the example engine CSVs with your real results. If needed, adjust `data/modules.csv` to point to different branches or repositories.
