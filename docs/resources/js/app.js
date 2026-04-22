function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvTextToObjects(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];
  const lines = cleaned.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
}

async function fetchCsv(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`);
  }
  const text = await response.text();
  return csvTextToObjects(text);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusCell(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function buildProcessorTable(processors, results) {
  const counts = {};
  for (const p of processors) {
    counts[p.processor_id] = { passed: 0, failed: 0, inapplicable: 0 };
  }
  for (const r of results) {
    if (counts[r.processor_id] && counts[r.processor_id][r.status] !== undefined) {
      counts[r.processor_id][r.status]++;
    }
  }

  const rows = processors.map(p => {
    const c = counts[p.processor_id] || { passed: 0, failed: 0, inapplicable: 0 };
    return `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.version)}</td>
        <td>${escapeHtml(p.release_date)}</td>
        <td>${escapeHtml(p.contact)}</td>
        <td><a href="${escapeHtml(p.homepage)}">${escapeHtml(p.homepage)}</a></td>
        <td>Passed: ${c.passed}<br>Failed: ${c.failed}<br>Inapplicable: ${c.inapplicable}</td>
      </tr>`;
  }).join('');

  return `<table><thead><tr><th>Name</th><th>Version</th><th>Test date</th><th>Contact</th><th>Web page</th><th>Stats</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildSummary(testcases, results) {
  const modules = [...new Set(testcases.map(t => t.module))];
  const cards = modules.map(module => {
    const tcIds = new Set(testcases.filter(t => t.module === module).map(t => t.testcase_id));
    const relevant = results.filter(r => tcIds.has(r.testcase_id));
    const passed = relevant.filter(r => r.status === 'passed').length;
    const failed = relevant.filter(r => r.status === 'failed').length;
    const inapp = relevant.filter(r => r.status === 'inapplicable').length;
    return `<div class="card"><h3>${escapeHtml(module)}</h3><div class="small">${tcIds.size} test cases</div><p>Passed: ${passed}<br>Failed: ${failed}<br>Inapplicable: ${inapp}</p></div>`;
  }).join('');
  return `<div class="cards">${cards}</div>`;
}

function buildResultsTable(testcases, processors, results, filters) {
  const processorMap = Object.fromEntries(processors.map(p => [p.processor_id, p]));
  const testcaseMap = Object.fromEntries(testcases.map(t => [t.testcase_id, t]));

  const filtered = results.filter(r => {
    const tc = testcaseMap[r.testcase_id];
    if (!tc) return false;
    if (filters.module && tc.module !== filters.module) return false;
    if (filters.processor && r.processor_id !== filters.processor) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${r.testcase_id} ${tc.title} ${tc.module} ${r.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => a.testcase_id.localeCompare(b.testcase_id) || a.processor_id.localeCompare(b.processor_id));

  const rows = filtered.map(r => {
    const tc = testcaseMap[r.testcase_id];
    const p = processorMap[r.processor_id];
    const tcLabel = tc.link
      ? `<a href="${escapeHtml(tc.link)}"><code>${escapeHtml(r.testcase_id)}</code></a>`
      : `<code>${escapeHtml(r.testcase_id)}</code>`;
    return `<tr>
      <td>${tcLabel}</td>
      <td>${escapeHtml(tc.module)}</td>
      <td>${escapeHtml(tc.title)}</td>
      <td>${escapeHtml(p?.name ?? r.processor_id)}</td>
      <td>${statusCell(r.status)}</td>
      <td>${escapeHtml(r.notes || '')}</td>
    </tr>`;
  }).join('');

  return `<table><thead><tr><th>Test case</th><th>Module</th><th>Title</th><th>Processor</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function populateSelect(id, values, labelMap = null) {
  const el = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelMap && labelMap[v] ? labelMap[v] : v;
    el.appendChild(opt);
  });
}

function setError(message) {
  const html = `
    <div class="error-box">
      <p><strong>CSV data could not be loaded automatically.</strong></p>
      <p>${escapeHtml(message)}</p>
      <p>If you open <code>index.html</code> directly from your disk, the browser may block access to local CSV files. On GitHub Pages this will work normally.</p>
      <p>For local testing, run a tiny static server in this folder, for example:</p>
      <pre><code>python3 -m http.server 8000</code></pre>
      <p>and then open <code>http://localhost:8000</code>.</p>
    </div>`;
  document.getElementById('processors-table').innerHTML = html;
  document.getElementById('summary-cards').innerHTML = html;
  document.getElementById('results-table').innerHTML = html;
}

function wireFilters(testcases, processors, results) {
  const processorNames = Object.fromEntries(processors.map(p => [p.processor_id, p.name]));
  populateSelect('moduleFilter', [...new Set(testcases.map(t => t.module))]);
  populateSelect('processorFilter', processors.map(p => p.processor_id), processorNames);

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
    const [processors, testcases, results] = await Promise.all([
      fetchCsv('../resources/data/processors.csv'),
      fetchCsv('../resources/data/testcases.csv'),
      fetchCsv('../resources/data/results.csv')
    ]);

    document.getElementById('processors-table').innerHTML = buildProcessorTable(processors, results);
    document.getElementById('summary-cards').innerHTML = buildSummary(testcases, results);
    wireFilters(testcases, processors, results);
  } catch (error) {
    console.error(error);
    setError(error.message || 'Unknown error');
  }
}

init();
