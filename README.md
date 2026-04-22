# RML Implementation Report

Static implementation report for GitHub Pages using ReSpec and CSV files.

## Structure

- `index.html`: ReSpec document
- `css/style.css`: visual tweaks
- `js/app.js`: loads CSV and generates tables
- `data/processors.csv`: implementations metadata
- `data/testcases.csv`: canonical test cases
- `data/results.csv`: per-processor per-test results

## CSV formats

### processors.csv
`processor_id,name,version,release_date,contact,homepage`

### testcases.csv
`testcase_id,module,title,description,link`

### results.csv
`testcase_id,processor_id,status,notes`

Allowed `status` values:
- `passed`
- `failed`
- `inapplicable`

## Publish on GitHub Pages

1. Create a repository.
2. Upload these files.
3. Enable GitHub Pages from the default branch or `docs/`.
4. Open the published URL.

## Suggested next step

Replace the example CSVs with your real module and test-case inventory.
