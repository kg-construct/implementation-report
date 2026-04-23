import { spawn } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');
const resourcesDir = path.join(docsDir, 'resources');
const VALID_STATUSES = new Set(['passed', 'failed', 'inapplicable']);

function csvTextToObjects(text) {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!cleaned.trim()) return [];

  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (ch === '"') {
      if (inQuotes && cleaned[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      row.push(value);
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += ch;
  }

  row.push(value);
  if (row.some(cell => cell !== '')) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0];
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] ?? '';
    });
    return obj;
  });
}

async function fetchCsv(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) {
    const response = await fetch(pathOrUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load ${pathOrUrl} (${response.status})`);
    }
    return csvTextToObjects(await response.text());
  }

  const absolutePath = path.join(projectRoot, pathOrUrl);
  return csvTextToObjects(readFileSync(absolutePath, 'utf8'));
}

function normalizeSpecificationSlug(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  const known = {
    core: 'core',
    io: 'io',
    fnml: 'fnml',
    cc: 'cc',
    lv: 'lv',
    star: 'star',
    'rml-core': 'core',
    'rml-io': 'io',
    'rml-fnml': 'fnml',
    'rml-cc': 'cc',
    'rml-lv': 'lv',
    'rml-star': 'star',
    'http://w3id.org/rml/core': 'core',
    'http://w3id.org/rml/io': 'io',
    'http://w3id.org/rml/fnml': 'fnml',
    'http://w3id.org/rml/cc': 'cc',
    'http://w3id.org/rml/lv': 'lv',
    'http://w3id.org/rml/star': 'star'
  };
  return known[normalized] || normalized;
}

function titleCaseSpecification(specification) {
  const slug = normalizeSpecificationSlug(specification);
  if (!slug) return 'Unknown';
  if (slug === 'star') return 'RML-star';
  return `RML-${slug.toUpperCase()}`;
}

function testcaseLink(testcaseId, specificationSlug) {
  if (!testcaseId || !specificationSlug) return '';
  return `https://kg-construct.github.io/rml-${specificationSlug}/test-cases/docs/#${encodeURIComponent(testcaseId)}`;
}

function normalizeTestcase(row, moduleInfo = null) {
  const specificationSlug = normalizeSpecificationSlug(moduleInfo?.specification_slug || row.specification);
  return {
    testcase_id: row.ID || row.testcase_id || '',
    module: moduleInfo?.module_name || titleCaseSpecification(specificationSlug),
    title: row.title || '',
    description: row.description || '',
    specification: specificationSlug,
    link: testcaseLink(row.ID || row.testcase_id || '', specificationSlug),
    source_csv: moduleInfo?.testcases_csv || '',
    error: String(row.error || '').toLowerCase() === 'true'
  };
}

function resolveResultsPath(processor) {
  const configured = (processor.results_file || '').trim();
  const fallback = `results/${processor.processor_id}.csv`;
  const pathValue = configured || fallback;

  if (
    pathValue.startsWith('data/') ||
    pathValue.startsWith('./') ||
    pathValue.startsWith('../') ||
    /^https?:\/\//.test(pathValue)
  ) {
    return pathValue;
  }

  return `data/${pathValue}`;
}

async function loadSnapshot() {
  const [processors, modules] = await Promise.all([
    fetchCsv('data/processors.csv'),
    fetchCsv('data/modules.csv')
  ]);

  const testcaseGroups = await Promise.all(
    modules.map(async moduleInfo => {
      const rows = await fetchCsv(moduleInfo.testcases_csv);
      return rows.map(row => normalizeTestcase(row, moduleInfo));
    })
  );

  const resultGroups = await Promise.all(
    processors.map(async processor => {
      const rows = await fetchCsv(resolveResultsPath(processor));
      return rows.map(row => ({
        ...row,
        processor_id: row.processor_id || processor.processor_id
      }));
    })
  );

  const results = resultGroups.flat().filter(result => VALID_STATUSES.has(result.status));

  return {
    generated_at: new Date().toISOString(),
    processors,
    modules,
    testcases: testcaseGroups.flat(),
    results
  };
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function injectSnapshot(html, snapshot) {
  const json = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return html
    .replace(/href="css\/style\.css"/g, 'href="resources/css/style.css"')
    .replace(/src="js\/app\.js"/g, 'src="resources/js/app.js"')
    .replace(
      /<script src="resources\/js\/app\.js"><\/script>/,
      `<script id="report-data" type="application/json">${json}</script>\n<script src="resources/js/app.js"></script>`
    );
}

async function main() {
  const snapshot = await loadSnapshot();

  rmSync(path.join(resourcesDir, 'css'), { recursive: true, force: true });
  rmSync(path.join(resourcesDir, 'js'), { recursive: true, force: true });
  rmSync(path.join(docsDir, 'data'), { recursive: true, force: true });
  mkdirSync(path.join(resourcesDir, 'css'), { recursive: true });
  mkdirSync(path.join(resourcesDir, 'js'), { recursive: true });

  await runCommand('npx', ['--yes', 'respec', '--src', 'dev.html', '--out', 'docs/index.html', '--timeout', '60']);

  const exportedHtml = readFileSync(path.join(docsDir, 'index.html'), 'utf8');
  const finalHtml = injectSnapshot(exportedHtml, snapshot);

  writeFileSync(path.join(docsDir, 'index.html'), finalHtml);
  copyFileSync(path.join(projectRoot, 'css', 'style.css'), path.join(resourcesDir, 'css', 'style.css'));
  copyFileSync(path.join(projectRoot, 'js', 'app.js'), path.join(resourcesDir, 'js', 'app.js'));

  process.stdout.write('Exported docs/index.html from dev.html using ReSpec and embedded report data.\n');
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
