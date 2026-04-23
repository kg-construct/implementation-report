const VALID_STATUSES = ['passed', 'failed', 'inapplicable'];

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

async function fetchCsv(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`Could not load ${path} (${response.status})`);
    error.status = response.status;
    error.path = path;
    throw error;
  }
  return csvTextToObjects(await response.text());
}

function readEmbeddedData() {
  const element = document.getElementById('report-data');
  if (!element) return null;

  try {
    return JSON.parse(element.textContent);
  } catch (error) {
    console.error('Could not parse embedded report data', error);
    return null;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainCell(value, fallback = '-') {
  return value ? escapeHtml(value) : fallback;
}

function linkCell(url) {
  if (!url) return '-';
  return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
}

function statusCell(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
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

async function fetchModules() {
  return fetchCsv('data/modules.csv');
}

async function fetchAllTestcases(modules) {
  const settled = await Promise.allSettled(
    modules.map(async moduleInfo => {
      const rows = await fetchCsv(moduleInfo.testcases_csv);
      return rows.map(row => normalizeTestcase(row, moduleInfo));
    })
  );

  const notices = [];
  const testcases = [];

  settled.forEach((entry, index) => {
    const moduleInfo = modules[index];
    if (entry.status === 'fulfilled') {
      testcases.push(...entry.value);
      return;
    }

    const error = entry.reason;
    notices.push(`Could not load test cases for ${moduleInfo.module_name}: ${error.message}`);
  });

  return { testcases, notices };
}

function resolveResultsPath(processor) {
  const configured = (processor.results_file || '').trim();
  const fallback = `results/${processor.processor_id}.csv`;
  const path = configured || fallback;

  if (
    path.startsWith('data/') ||
    path.startsWith('./') ||
    path.startsWith('../') ||
    /^https?:\/\//.test(path)
  ) {
    return path;
  }

  return `data/${path}`;
}

async function fetchResultsForProcessor(processor) {
  const path = resolveResultsPath(processor);
  const rows = await fetchCsv(path);
  return rows.map(row => ({
    ...row,
    processor_id: row.processor_id || processor.processor_id
  }));
}

async function fetchAllResults(processors) {
  const settled = await Promise.allSettled(processors.map(fetchResultsForProcessor));
  const notices = [];
  const results = [];

  settled.forEach((entry, index) => {
    const processor = processors[index];
    if (entry.status === 'fulfilled') {
      results.push(...entry.value);
      return;
    }

    const error = entry.reason;
    if (error && error.status === 404) {
      notices.push(`No results file found for ${processor.name || processor.processor_id}: ${resolveResultsPath(processor)}`);
      return;
    }

    notices.push(`Could not load results for ${processor.name || processor.processor_id}: ${error.message}`);
  });

  return { results, notices };
}

async function loadLiveData() {
  const [processors, modules] = await Promise.all([
    fetchCsv('data/processors.csv'),
    fetchModules()
  ]);
  const { testcases, notices: testcaseNotices } = await fetchAllTestcases(modules);
  const { results, notices: resultNotices } = await fetchAllResults(processors);

  return {
    processors,
    modules,
    testcases,
    results,
    notices: [...testcaseNotices, ...resultNotices]
  };
}

function buildProcessorTable(processors) {
  const rows = processors.map(processor => `
      <tr>
        <td>${escapeHtml(processor.name)}</td>
        <td>${plainCell(processor.version)}</td>
        <td>${plainCell(processor.release_date)}</td>
        <td>${plainCell(processor.contact)}</td>
        <td>${linkCell(processor.homepage)}</td>
      </tr>`).join('');

  return `<table><thead><tr><th>Name</th><th>Version</th><th>Test date</th><th>Contact</th><th>Web page</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function summarizeEngineByModule(processorId, processors, testcases, results) {
  const moduleNames = [...new Set(testcases.map(testcase => testcase.module))];
  const summary = {
    passed: 0,
    failed: 0,
    inapplicable: 0,
    reported: 0,
    modules: {}
  };

  moduleNames.forEach(moduleName => {
    summary.modules[moduleName] = { covered: 0, total: 0, passed: 0, failed: 0, inapplicable: 0 };
  });

  const testcaseMap = Object.fromEntries(testcases.map(testcase => [testcase.testcase_id, testcase]));
  testcases.forEach(testcase => {
    summary.modules[testcase.module].total++;
  });

  results
    .filter(result => result.processor_id === processorId)
    .forEach(result => {
      const testcase = testcaseMap[result.testcase_id];
      if (!testcase) return;

      const moduleSummary = summary.modules[testcase.module];
      moduleSummary.covered++;
      if (VALID_STATUSES.includes(result.status)) {
        moduleSummary[result.status]++;
        summary[result.status]++;
      }
      summary.reported++;
    });

  return summary;
}

function buildSummaryTable(processors, testcases, results) {
  const moduleNames = [...new Set(testcases.map(testcase => testcase.module))];
  const header = moduleNames.map(moduleName => `<th>${escapeHtml(moduleName)}</th>`).join('');

  const rows = processors.map(processor => {
    const summary = summarizeEngineByModule(processor.processor_id, processors, testcases, results);
    const moduleCells = moduleNames.map(moduleName => {
      const item = summary.modules[moduleName];
      return `<td>${item.covered}/${item.total}<div class="small">P ${item.passed} · F ${item.failed} · I ${item.inapplicable}</div></td>`;
    }).join('');

    return `<tr>
      <td>${escapeHtml(processor.name)}</td>
      <td>${summary.reported}</td>
      <td>${summary.passed}</td>
      <td>${summary.failed}</td>
      <td>${summary.inapplicable}</td>
      ${moduleCells}
    </tr>`;
  }).join('');

  if (!rows) {
    return '<p class="small">No engines found in <code>data/processors.csv</code>.</p>';
  }

  return `<table><thead><tr><th>Engine</th><th>Reported</th><th>Passed</th><th>Failed</th><th>Inapplicable</th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function buildResultsTable(testcases, processors, results, filters) {
  const processorMap = Object.fromEntries(processors.map(processor => [processor.processor_id, processor]));
  const testcaseMap = Object.fromEntries(testcases.map(testcase => [testcase.testcase_id, testcase]));

  const filtered = results.filter(result => {
    const testcase = testcaseMap[result.testcase_id];
    if (!testcase) return false;
    if (filters.module && testcase.module !== filters.module) return false;
    if (filters.processor && result.processor_id !== filters.processor) return false;
    if (filters.status && result.status !== filters.status) return false;
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const haystack = `${result.testcase_id} ${testcase.title} ${testcase.module} ${result.notes || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => a.testcase_id.localeCompare(b.testcase_id) || a.processor_id.localeCompare(b.processor_id));

  const rows = filtered.map(result => {
    const testcase = testcaseMap[result.testcase_id];
    const processor = processorMap[result.processor_id];
    const testcaseLabel = testcase.link
      ? `<a href="${escapeHtml(testcase.link)}"><code>${escapeHtml(result.testcase_id)}</code></a>`
      : `<code>${escapeHtml(result.testcase_id)}</code>`;

    return `<tr>
      <td>${testcaseLabel}</td>
      <td>${escapeHtml(testcase.module)}</td>
      <td>${escapeHtml(testcase.title)}</td>
      <td>${escapeHtml(processor?.name ?? result.processor_id)}</td>
      <td>${statusCell(result.status)}</td>
      <td>${escapeHtml(result.notes || '')}</td>
    </tr>`;
  }).join('');

  return `<table><thead><tr><th>Test case</th><th>Module</th><th>Title</th><th>Processor</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function populateSelect(id, values, labelMap = null) {
  const element = document.getElementById(id);
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labelMap && labelMap[value] ? labelMap[value] : value;
    element.appendChild(option);
  });
}

function setNotices(messages) {
  const element = document.getElementById('data-notices');
  if (!element) return;

  if (!messages.length) {
    element.hidden = true;
    element.innerHTML = '';
    return;
  }

  const items = messages.map(message => `<li>${escapeHtml(message)}</li>`).join('');
  element.hidden = false;
  element.innerHTML = `<div class="notice-box"><strong>Data notices</strong><ul>${items}</ul></div>`;
}

function collectDataNotices(testcases, processors, results) {
  const testcaseIds = new Set();
  const processorIds = new Set();
  const notices = [];

  testcases.forEach(testcase => {
    if (testcaseIds.has(testcase.testcase_id)) {
      notices.push(`Duplicate test case id detected: ${testcase.testcase_id}`);
    }
    testcaseIds.add(testcase.testcase_id);
  });

  processors.forEach(processor => {
    if (processorIds.has(processor.processor_id)) {
      notices.push(`Duplicate engine id detected: ${processor.processor_id}`);
    }
    processorIds.add(processor.processor_id);
  });

  results.forEach(result => {
    if (!processorIds.has(result.processor_id)) {
      notices.push(`Result references an unknown engine id: ${result.processor_id}`);
    }
    if (!testcaseIds.has(result.testcase_id)) {
      notices.push(`Result references an unknown test case id: ${result.testcase_id}`);
    }
    if (!VALID_STATUSES.includes(result.status)) {
      notices.push(`Unexpected status "${result.status}" in result ${result.testcase_id}/${result.processor_id}`);
    }
  });

  return [...new Set(notices)];
}

function setError(message) {
  const html = `
    <div class="error-box">
      <p><strong>CSV data could not be loaded automatically.</strong></p>
      <p>${escapeHtml(message)}</p>
      <p>If you open <code>dev.html</code> directly from your disk, the browser may block access to local or remote files.</p>
      <p>For local testing, run a static server in this folder, for example:</p>
      <pre><code>python3 -m http.server 8000</code></pre>
      <p>and then open <code>http://localhost:8000/dev.html</code>.</p>
    </div>`;

  document.getElementById('processors-table').innerHTML = html;
  document.getElementById('summary-table').innerHTML = html;
  document.getElementById('results-table').innerHTML = html;
  setNotices([]);
}

function wireFilters(testcases, processors, results) {
  const processorNames = Object.fromEntries(processors.map(processor => [processor.processor_id, processor.name]));
  populateSelect('moduleFilter', [...new Set(testcases.map(testcase => testcase.module))]);
  populateSelect('processorFilter', processors.map(processor => processor.processor_id), processorNames);

  const render = () => {
    const filters = {
      module: document.getElementById('moduleFilter').value,
      processor: document.getElementById('processorFilter').value,
      status: document.getElementById('statusFilter').value,
      search: document.getElementById('searchFilter').value.trim()
    };
    document.getElementById('results-table').innerHTML = buildResultsTable(testcases, processors, results, filters);
  };

  ['moduleFilter', 'processorFilter', 'statusFilter', 'searchFilter'].forEach(id => {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });

  render();
}

async function init() {
  try {
    const embedded = readEmbeddedData();
    const liveData = embedded || await loadLiveData();
    const { processors, testcases, results } = liveData;
    const notices = [
      ...(liveData.notices || []),
      ...collectDataNotices(testcases, processors, results)
    ];

    document.getElementById('processors-table').innerHTML = buildProcessorTable(processors);
    document.getElementById('summary-table').innerHTML = buildSummaryTable(processors, testcases, results);
    setNotices(notices);
    wireFilters(testcases, processors, results);
  } catch (error) {
    console.error(error);
    setError(error.message || 'Unknown error');
  }
}

init();
