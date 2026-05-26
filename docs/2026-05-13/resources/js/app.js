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

function formatModuleHeader(moduleName) {
  if (moduleName.startsWith('RML-')) {
    return `RML-<br>${escapeHtml(moduleName.slice(4))}`;
  }
  return escapeHtml(moduleName);
}

function formatEngineHeader(name) {
  const camelSplit = name.match(/^([A-Z]?[a-z0-9]+)([A-Z].*)$/);
  if (camelSplit) {
    return `${escapeHtml(camelSplit[1])}<br>${escapeHtml(camelSplit[2])}`;
  }

  const hyphenIndex = name.indexOf('-');
  if (hyphenIndex > 0) {
    return `${escapeHtml(name.slice(0, hyphenIndex))}<br>${escapeHtml(name.slice(hyphenIndex + 1))}`;
  }

  return escapeHtml(name);
}

function resultCell(result) {
  if (!result) return '<span class="result-cell is-empty">-</span>';

  const note = (result.notes || '').trim();
  const noteButton = note
    ? `<button type="button" class="result-note" data-note-trigger aria-label="Show note">+</button><span class="result-popover" hidden>${escapeHtml(note)}</span>`
    : '';
  return `<span class="result-cell">${statusCell(result.status)}${noteButton}</span>`;
}

function normalizeSpecificationSlug(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  const known = {
    core: 'core',
    io: 'io',
    fnml: 'fnml',
    cc: 'cc',
    lv: 'lv',
    'rml-core': 'core',
    'rml-io': 'io',
    'rml-fnml': 'fnml',
    'rml-cc': 'cc',
    'rml-lv': 'lv',
    'http://w3id.org/rml/core': 'core',
    'http://w3id.org/rml/io': 'io',
    'http://w3id.org/rml/fnml': 'fnml',
    'http://w3id.org/rml/cc': 'cc',
    'http://w3id.org/rml/lv': 'lv'
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
  const header = moduleNames.map(moduleName => `<th class="wrap-header">${formatModuleHeader(moduleName)}</th>`).join('');

  const rows = processors.map(processor => {
    const summary = summarizeEngineByModule(processor.processor_id, processors, testcases, results);
    const moduleCells = moduleNames.map(moduleName => {
      const item = summary.modules[moduleName];
      return `<td>${item.passed}/${item.total}<div class="small">F ${item.failed} · <span class="summary-tail">I ${item.inapplicable}</span></div></td>`;
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

  return `<table class="summary-table"><thead><tr><th>Engine</th><th class="summary-metric">Reported</th><th class="summary-metric">Passed</th><th class="summary-metric">Failed</th><th class="summary-metric">Inappl.</th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function buildResultsTable(moduleName, testcases, processors, results) {
  const moduleTestcases = testcases
    .filter(testcase => testcase.module === moduleName)
    .sort((a, b) => a.testcase_id.localeCompare(b.testcase_id));
  const resultMap = new Map(
    results.map(result => [`${result.testcase_id}::${result.processor_id}`, result])
  );

  const headerCells = processors
    .map(processor => `<th class="wrap-header">${formatEngineHeader(processor.name)}</th>`)
    .join('');

  const rows = moduleTestcases.map(testcase => {
    const testcaseLabel = testcase.link
      ? `<a href="${escapeHtml(testcase.link)}"><code>${escapeHtml(testcase.testcase_id)}</code></a>`
      : `<code>${escapeHtml(testcase.testcase_id)}</code>`;
    const processorCells = processors.map(processor => {
      const result = resultMap.get(`${testcase.testcase_id}::${processor.processor_id}`);
      const tdClass = result ? 'result-td' : 'result-td result-td-empty';
      return `<td class="${tdClass}">${resultCell(result)}</td>`;
    }).join('');

    return `<tr>
      <td>${testcaseLabel}</td>
      ${processorCells}
    </tr>`;
  }).join('');

  if (!rows) {
    return '<p class="small">No matching results for this module.</p>';
  }

  return `<table><thead><tr><th>Test case</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderResultsTables(testcases, processors, results) {
  const moduleNames = [...new Set(testcases.map(testcase => testcase.module))];

  document.querySelectorAll('[data-module-results]').forEach(container => {
    const moduleName = container.getAttribute('data-module-results');
    const section = container.closest('section');

    if (section) {
      section.hidden = !moduleNames.includes(moduleName);
    }

    container.innerHTML = moduleNames.includes(moduleName)
      ? buildResultsTable(moduleName, testcases, processors, results)
      : '';
  });

  wireResultNotes();
}

function wireResultNotes() {
  if (document.body.dataset.resultNotesBound === 'true') return;
  document.body.dataset.resultNotesBound = 'true';

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-note-trigger]');

    document.querySelectorAll('.result-td.note-open').forEach(cell => {
      if (trigger && cell.contains(trigger)) return;
      cell.classList.remove('note-open');
      const popover = cell.querySelector('.result-popover');
      if (popover) popover.hidden = true;
    });

    if (!trigger) return;

    event.preventDefault();
    const cell = trigger.closest('.result-td');
    const popover = cell?.querySelector('.result-popover');
    if (!cell || !popover) return;

    const isOpen = cell.classList.contains('note-open');
    cell.classList.toggle('note-open', !isOpen);
    popover.hidden = isOpen;
  });
}

function setNotices() {}

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
  document.querySelectorAll('[data-module-results]').forEach(container => {
    container.innerHTML = html;
    const section = container.closest('section');
    if (section) {
      section.hidden = false;
    }
  });
  setNotices();
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
    renderResultsTables(testcases, processors, results);
  } catch (error) {
    console.error(error);
    setError(error.message || 'Unknown error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
