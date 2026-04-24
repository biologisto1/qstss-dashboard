const state = {
  selectedQid: null,
  students: [],
  options: { qids: [], names: [] },
};

const palette = {
  RAW: '#2c75c9',
  NSIS: '#c7475a',
  STEM: '#3f9a48',
  English: '#7952a3',
  Math: '#00756f',
};

async function fetchJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try { detail = (await response.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return response.json();
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${formatNumber(value, 1)}%`;
}

function safe(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function setHeader(meta) {
  const date = meta.last_modified ? new Date(meta.last_modified * 1000).toLocaleString() : 'unknown';
  document.getElementById('headerMeta').innerHTML = `
    <div><strong>Live workbook:</strong> ${meta.workbook}</div>
    <div><strong>Students:</strong> ${meta.student_count} · <strong>Cohorts:</strong> ${meta.cohorts.join(', ')}</div>
    <div><strong>Last modified:</strong> ${date}</div>
  `;
  const cohortFilter = document.getElementById('cohortFilter');
  cohortFilter.innerHTML = '<option value="">All cohorts</option>' + meta.cohorts.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderKpis(headline) {
  const cards = [
    ['Students Tracked', headline.total_students, 'Unique QID records in Student_Master'],
    ['Average Growth', formatNumber(headline.average_gain), 'Mean entry-to-exit overall gain'],
    ['Average Exit', formatNumber(headline.average_exit), 'Mean exit overall score'],
    ['Direct Admissions', headline.direct_admissions ?? '—', 'Students flagged for direct admission'],
    ['STEM Majors', headline.stem_majors ?? '—', 'University majors aligned to STEM'],
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(([label, value, note]) => `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-note">${note}</div>
    </div>
  `).join('');
}

function renderCohortTable(rows) {
  const tbody = document.querySelector('#cohortTable tbody');
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td><strong>${safe(row.Cohort)}</strong></td>
      <td>${formatNumber(row.Students, 0)}</td>
      <td>${formatNumber(row.Avg_Entry)}</td>
      <td>${formatNumber(row.Avg_Exit)}</td>
      <td>${formatNumber(row.Avg_Gain)}</td>
      <td>${formatNumber(row.Avg_SAT, 0)}</td>
      <td>${formatNumber(row.STEM_Majors, 0)}</td>
      <td>${formatNumber(row.Direct_Admissions, 0)}</td>
    </tr>
  `).join('');
}

function renderBarList(title, rows, labelKey) {
  if (!rows || !rows.length) return `<div class="small">No ${title.toLowerCase()} data available.</div>`;
  const max = Math.max(...rows.map(r => Number(r.Students) || 0), 1);
  return `
    <div class="chart-card">
      <h3>${title}</h3>
      ${rows.map(r => {
        const value = Number(r.Students) || 0;
        return `<div class="bar-row" title="${safe(r[labelKey])}: ${value}">
          <div class="bar-label">${safe(r[labelKey])}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
          <strong>${value}</strong>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderDestinationInsights(dashboard) {
  document.getElementById('destinationCharts').innerHTML = [
    renderBarList('Top Universities', dashboard.top_universities || [], 'University'),
    renderBarList('Top Majors / Specialties', dashboard.top_majors || [], 'Major'),
  ].join('');
}

function optionText(student) {
  return `${safe(student.QID, '')} · ${safe(student.Student_Name, '')} · ${safe(student.Cohort, '')}`;
}

function setOptions(options) {
  state.options = options;
  const qidSelect = document.getElementById('qidSelect');
  const nameSelect = document.getElementById('nameSelect');
  qidSelect.innerHTML = '<option value="">Select QID</option>' + options.qids.map(s => `<option value="${s.QID}">${optionText(s)}</option>`).join('');
  nameSelect.innerHTML = '<option value="">Select student</option>' + options.names.map(s => `<option value="${s.QID}">${safe(s.Student_Name)} · ${safe(s.QID)} · ${safe(s.Cohort)}</option>`).join('');
}

function renderSearchResults(results) {
  state.students = results;
  document.getElementById('resultCount').textContent = `${results.length} matching student${results.length === 1 ? '' : 's'}`;
  const container = document.getElementById('results');
  if (!results.length) {
    container.innerHTML = '<div class="empty-state">No matching students. Try a QID, Arabic/English name, or another cohort.</div>';
    return;
  }
  container.innerHTML = results.map(student => `
    <div class="result-item ${student.QID === state.selectedQid ? 'active' : ''}" data-qid="${student.QID}">
      <div class="result-name">${safe(student.Student_Name, 'Unnamed student')}</div>
      <div class="result-meta">${student.QID} · ${safe(student.Cohort, 'Unknown cohort')}</div>
      <div class="result-meta">${safe(student.University, 'University not captured')} · ${safe(student.Major, 'Major not captured')}</div>
      <div class="result-meta"><span class="badge">Gain ${formatNumber(student.Gain_Overall)}</span></div>
    </div>
  `).join('');
  container.querySelectorAll('.result-item').forEach(el => el.addEventListener('click', () => loadStudent(el.dataset.qid)));
}

function lineChartSVG(rows) {
  if (!rows || !rows.length) return '<div class="empty-state">No trajectory data available for this student.</div>';
  const width = 720, height = 320;
  const margin = { top: 26, right: 28, bottom: 42, left: 52 };
  const seriesNames = ['RAW', 'NSIS', 'STEM', 'English', 'Math'];
  const validRows = rows.filter(r => r.Year_Order !== null && r.Year_Order !== undefined);
  const years = validRows.map(r => Number(r.Year_Order)).filter(Number.isFinite);
  const values = validRows.flatMap(r => seriesNames.map(s => Number(r[s]))).filter(Number.isFinite);
  if (!years.length || !values.length) return '<div class="empty-state">Trajectory values are unavailable.</div>';
  const minX = Math.min(...years), maxX = Math.max(...years);
  const minY = Math.max(0, Math.floor((Math.min(...values) - 5) / 5) * 5);
  const maxY = Math.min(105, Math.ceil((Math.max(...values) + 5) / 5) * 5);
  const xScale = x => margin.left + ((x - minX) / Math.max(1, maxX - minX)) * (width - margin.left - margin.right);
  const yScale = y => height - margin.bottom - ((y - minY) / Math.max(1, maxY - minY)) * (height - margin.top - margin.bottom);
  const yTicks = [minY, Math.round((minY + maxY) / 2), maxY];
  const grid = yTicks.map(v => `<line x1="${margin.left}" y1="${yScale(v)}" x2="${width - margin.right}" y2="${yScale(v)}" stroke="#e1ecee"/>`).join('');
  const axes = `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#8aa0a7"/><line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#8aa0a7"/>`;
  const yLabels = yTicks.map(v => `<text x="${margin.left - 10}" y="${yScale(v) + 4}" text-anchor="end" font-size="12" fill="#65767c">${formatNumber(v, 0)}</text>`).join('');
  const xLabels = years.map(v => `<text x="${xScale(v)}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="12" fill="#65767c">Y${v}</text>`).join('');
  const lines = seriesNames.map(name => {
    const pts = validRows.map(r => [xScale(Number(r.Year_Order)), yScale(Number(r[name]))]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pts.length < 1) return '';
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const markers = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${palette[name]}" stroke="white" stroke-width="1.5"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${palette[name]}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>${markers}`;
  }).join('');
  const legend = seriesNames.map(name => `<div class="legend-item"><span class="legend-swatch" style="background:${palette[name]}"></span>${name}</div>`).join('');
  return `<div class="chart-card"><h3>4-Year QSTSS Subject Trajectory</h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="4-year student subject trajectory">${grid}${axes}${yLabels}${xLabels}${lines}</svg><div class="legend">${legend}</div></div>`;
}

function radarSVG(cog) {
  const domains = [
    ['Verbal', cog.Current_Verbal_SAS, cog.Baseline_Verbal_SAS],
    ['Quantitative', cog.Current_Quantitative_SAS, cog.Baseline_Quantitative_SAS],
    ['Nonverbal', cog.Current_Nonverbal_SAS, cog.Baseline_Nonverbal_SAS],
    ['Spatial', cog.Current_Spatial_SAS, cog.Baseline_Spatial_SAS],
  ];
  if (!domains.some(d => Number.isFinite(Number(d[1])) || Number.isFinite(Number(d[2])))) return '<div class="empty-state">CAT4 domain profile is not available.</div>';
  const size = 330, cx = 165, cy = 165, maxR = 110;
  const scale = v => Math.max(0, Math.min(130, Number(v) || 0)) / 130 * maxR;
  const point = (idx, val) => {
    const angle = -Math.PI / 2 + idx * (2 * Math.PI / domains.length);
    const r = scale(val);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const polygon = index => domains.map((d, i) => point(i, d[index]).map(n => n.toFixed(1)).join(',')).join(' ');
  const axis = domains.map((d, i) => {
    const [x, y] = point(i, 130);
    const [lx, ly] = point(i, 145);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#d9e4e7"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#65767c">${d[0]}</text>`;
  }).join('');
  const rings = [40, 70, 100, 130].map(v => `<circle cx="${cx}" cy="${cy}" r="${scale(v)}" fill="none" stroke="#e7eef0"/>`).join('');
  return `<div class="chart-card"><h3>Cognitive Profile</h3><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="CAT4 radar chart">${rings}${axis}<polygon points="${polygon(2)}" fill="rgba(199,155,43,0.20)" stroke="#c79b2b" stroke-width="2"/><polygon points="${polygon(1)}" fill="rgba(0,107,99,0.22)" stroke="#006b63" stroke-width="2.5"/></svg><div class="legend"><div class="legend-item"><span class="legend-swatch" style="background:#006b63"></span>Current</div><div class="legend-item"><span class="legend-swatch" style="background:#c79b2b"></span>Baseline</div></div></div>`;
}

function dataPoint(label, value) {
  return `<div class="data-point"><div class="data-label">${label}</div><div class="data-value">${safe(value)}</div></div>`;
}


function renderAchievementTable(achievements) {
  const items = achievements?.items || [];
  const summary = achievements?.summary || {};
  if (!items.length) {
    return `
      <div class="note-card participation-card full-span">
        <h3>Projects, competitions and awards</h3>
        <div class="participation-kpis">
          <div><strong>0</strong><span>Matched projects</span></div>
          <div><strong>0</strong><span>Matched competitions</span></div>
          <div><strong>0</strong><span>Matched awards</span></div>
        </div>
        <p class="small">${safe(summary.source_note, 'No student-level project/competition record is currently matched for this selected student.')}</p>
        <p class="small"><strong>Important:</strong> the newly attached achievement source lists student names but does not include QID numbers; therefore the app only displays records when the student name can be matched reliably.</p>
      </div>`;
  }
  return `
    <div class="note-card participation-card full-span">
      <h3>Projects, competitions and awards</h3>
      <div class="participation-kpis">
        <div><strong>${formatNumber(summary.projects, 0)}</strong><span>Matched projects</span></div>
        <div><strong>${formatNumber(summary.competitions, 0)}</strong><span>Competitions / events</span></div>
        <div><strong>${formatNumber(summary.awards, 0)}</strong><span>Awards / ranks</span></div>
      </div>
      <p class="small">${safe(summary.source_note)}</p>
      <div class="table-wrap achievement-table">
        <table>
          <thead><tr><th>Year</th><th>Type</th><th>Project / Competition</th><th>Organizer</th><th>Award / Rank</th></tr></thead>
          <tbody>
            ${items.map(i => `<tr>
              <td>${safe(i.Academic_Year || i.Year)}</td>
              <td>${safe(i.Item_Type)}</td>
              <td><strong>${safe(i.Title)}</strong><div class="small">${safe(i.Category, '')}</div></td>
              <td>${safe(i.Organizer)}<div class="small">${safe(i.Date, '')}</div></td>
              <td>${safe(i.Award_or_Rank)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function compactLineChartSVG(rows) {
  return lineChartSVG(rows || []).replace('4-Year QSTSS Subject Trajectory', 'Cohort Academic Trajectory');
}

function evidenceAchievementBar(summary) {
  const rows = summary?.top_events || [];
  return renderBarList('Top Participation / Award Events', rows, 'Title');
}

function renderStudent(profile) {
  const master = profile.master || {};
  const cognitive = profile.cognitive || {};
  const participation = profile.participation || {};
  const university = profile.university_exit || {};
  const achievements = profile.achievements || {};
  document.getElementById('selectedHint').textContent = `${safe(master.Student_Name, '')} · ${safe(master.QID, '')}`;
  document.getElementById('qidSelect').value = master.QID || '';
  document.getElementById('nameSelect').value = master.QID || '';
  const universityName = university.University || master.University;
  const majorName = university.Major || master.Major;
  const sponsorName = university.Sponsor || master.Sponsor;
  const html = `
    <div class="profile-top">
      <div>
        <div class="identity-card">
          <h3>${safe(master.Student_Name, 'Selected Student')}</h3>
          <p><strong>QID:</strong> ${safe(master.QID)} · <strong>Cohort:</strong> ${safe(master.Cohort)}</p>
          <p><strong>University:</strong> ${safe(universityName, 'Not captured')}</p>
          <p><strong>Major / Specialty:</strong> ${safe(majorName, 'Not captured')}</p>
          <p><strong>Sponsor:</strong> ${safe(sponsorName, 'Not captured')}</p>
        </div>
        <div class="profile-data">
          ${dataPoint('Entry Overall', formatNumber(master.Entry_Overall))}
          ${dataPoint('Exit Overall', formatNumber(master.Exit_Overall))}
          ${dataPoint('Gain Overall', formatNumber(master.Gain_Overall))}
          ${dataPoint('Final Secondary %', formatNumber(master['Final_Secondary_%']))}
          ${dataPoint('SAT Total', formatNumber(master.SAT_Total, 0))}
          ${dataPoint('CAT4 Growth', formatNumber(cognitive.CAT4_Growth))}
        </div>
      </div>
      <div>${lineChartSVG(profile.trajectory || [])}</div>
    </div>
    <div class="note-grid">
      <div class="note-card">
        <h3>Cognitive insight</h3>
        <div class="small"><strong>Baseline profile:</strong> ${safe(cognitive.Baseline_Profile)}</div>
        <div class="small"><strong>Current profile:</strong> ${safe(cognitive.Current_Profile)}</div>
        <div class="small"><strong>Auto classification:</strong> ${safe(cognitive.Auto_Profile_Class)}</div>
        <p class="small">${safe(cognitive.AI_Interpretation, 'No interpretation stored in the workbook.')}</p>
      </div>
      <div>${radarSVG(cognitive)}</div>
      ${renderAchievementTable(achievements)}
      <div class="note-card full-span">
        <h3>Inspection-ready interpretation</h3>
        <p class="small">This profile connects admission baseline, internal academic growth, CAT4 cognitive indicators, enrichment participation, and university destination evidence into one traceable student pathway.</p>
      </div>
    </div>
  `;
  document.getElementById('studentProfile').innerHTML = html;
}

function renderQuality(q) {
  const items = [
    ['QID Records', formatNumber(q.qid_records, 0)],
    ['Duplicate QIDs', formatNumber(q.duplicate_qids, 0)],
    ['University Coverage', pct(q.university_coverage_pct)],
    ['Major Coverage', pct(q.major_coverage_pct)],
    ['SAT Coverage', pct(q.sat_coverage_pct)],
    ['CAT4 Records', formatNumber(q.cat4_records, 0)],
    ['Participation Records', formatNumber(q.participation_records, 0)],
    ['Achievement Records', formatNumber(q.achievement_records, 0)],
  ];
  document.getElementById('qualityGrid').innerHTML = items.map(([label, value]) => `<div class="quality-item"><div class="quality-value">${value}</div><div class="quality-label">${label}</div></div>`).join('');
}

async function loadStudent(qid) {
  if (!qid) return;
  state.selectedQid = qid;
  const profile = await fetchJSON(`/api/student/${encodeURIComponent(qid)}`);
  renderSearchResults(state.students);
  renderStudent(profile);
  activateTab('profile');
}

async function runSearch() {
  const query = document.getElementById('studentSearch').value.trim();
  const cohort = document.getElementById('cohortFilter').value;
  const results = await fetchJSON(`/api/students?query=${encodeURIComponent(query)}&cohort=${encodeURIComponent(cohort)}&limit=50`);
  renderSearchResults(results);
}

async function loadOptions() {
  const cohort = document.getElementById('cohortFilter').value;
  const options = await fetchJSON(`/api/student-options?cohort=${encodeURIComponent(cohort)}`);
  setOptions(options);
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === name));
}


function evidenceKpi(label, value, digits = 2) {
  return `<div class="evidence-kpi"><div class="label">${label}</div><div class="value">${formatNumber(value, digits)}</div></div>`;
}

function evidenceCards(cards) {
  return `<div class="evidence-grid">${(cards || []).map(card => `
    <article class="surface evidence-card">
      <span class="evidence-code">${safe(card.code)}</span>
      <h3>${safe(card.title)}</h3>
      <p>${safe(card.interpretation)}</p>
      ${(card.metrics || []).map(m => `<div class="metric-row"><span>${safe(m.label)}</span><strong>${formatNumber(m.value)}</strong></div>`).join('')}
    </article>
  `).join('')}</div>`;
}

function tableFromRows(rows, columns) {
  if (!rows || !rows.length) return '<div class="empty-state">No data available for this selection.</div>';
  return `<div class="table-wrap"><table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr>${columns.map(c => `<td>${c.bold ? '<strong>' : ''}${c.format ? c.format(r[c.key], r) : safe(r[c.key])}${c.bold ? '</strong>' : ''}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

function renderEvidenceTable(rows) {
  return tableFromRows(rows, [
    { key: 'Cohort', label: 'Cohort', bold: true },
    { key: 'Final_NSIS', label: 'Final NSIS', format: v => formatNumber(v) },
    { key: 'Final_Math', label: 'Final Math', format: v => formatNumber(v) },
  ]);
}

function evidenceBenchmarkLine(rows) {
  const mapped = (rows || []).map(r => ({
    Year_Order: r.Year_Index,
    RAW: r.Avg_RAW,
    NSIS: r.Avg_NSIS,
    STEM: r.Avg_STEM,
    English: r.Avg_English,
    Math: r.Avg_Math,
  }));
  return lineChartSVG(mapped).replace('4-Year QSTSS Subject Trajectory', 'Average scores by year');
}

function groupedBarSVG(title, rows, keys, options = {}) {
  if (!rows || !rows.length) return '<div class="empty-state">No chart data available.</div>';
  const width = 640, height = 320;
  const margin = { top: 28, right: 28, bottom: 62, left: 58 };
  const labels = rows.map(r => String(r.Subject || r.Cohort || ''));
  const vals = rows.flatMap(r => keys.map(k => Number(r[k.key]))).filter(Number.isFinite);
  const maxY = options.percent ? 100 : Math.max(10, Math.ceil(Math.max(...vals, 10) / 10) * 10);
  const minY = options.allowNegative ? Math.min(0, Math.floor(Math.min(...vals, 0) / 10) * 10) : 0;
  const xBand = (width - margin.left - margin.right) / Math.max(1, rows.length);
  const barW = Math.min(26, (xBand - 18) / keys.length);
  const y = v => height - margin.bottom - ((v - minY) / Math.max(1, maxY - minY)) * (height - margin.top - margin.bottom);
  const zero = y(0);
  const grid = [minY, (minY + maxY) / 2, maxY].map(v => `<line x1="${margin.left}" y1="${y(v)}" x2="${width - margin.right}" y2="${y(v)}" stroke="#e1ecee"/><text x="${margin.left - 10}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#65767c">${options.percent ? formatNumber(v,0)+'%' : formatNumber(v,0)}</text>`).join('');
  const bars = rows.map((r, i) => {
    const center = margin.left + i * xBand + xBand / 2;
    return keys.map((k, j) => {
      const value = Number(r[k.key]);
      if (!Number.isFinite(value)) return '';
      const bx = center - (keys.length * barW) / 2 + j * barW;
      const by = Math.min(y(value), zero);
      const bh = Math.max(1, Math.abs(zero - y(value)));
      return `<rect x="${bx}" y="${by}" width="${barW-2}" height="${bh}" rx="3" fill="${k.color}"/><text x="${bx + barW/2}" y="${by - 5}" text-anchor="middle" font-size="10" fill="#12324a">${options.percent ? formatNumber(value,0)+'%' : formatNumber(value,1)}</text>`;
    }).join('') + `<text x="${center}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="11" fill="#65767c">${safe(labels[i])}</text>`;
  }).join('');
  const legend = keys.map(k => `<div class="legend-item"><span class="legend-swatch" style="background:${k.color}"></span>${k.label}</div>`).join('');
  return `<div class="chart-card"><h3>${title}</h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">${grid}<line x1="${margin.left}" y1="${zero}" x2="${width - margin.right}" y2="${zero}" stroke="#8aa0a7"/>${bars}</svg><div class="legend">${legend}</div></div>`;
}

function renderBenchmarkTables(evidence) {
  return `
    <div class="evidence-table-grid">
      <article class="surface evidence-table-card">
        <h2>Year profile (selected cohort)</h2>
        ${tableFromRows(evidence.year_profile || [], [
          { key: 'Year_Index', label: 'Year', format: v => formatNumber(v, 0) },
          { key: 'Avg_RAW', label: 'Avg RAW', format: v => formatNumber(v) },
          { key: 'Avg_NSIS', label: 'Avg NSIS', format: v => formatNumber(v) },
          { key: 'Avg_STEM', label: 'Avg STEM', format: v => formatNumber(v) },
          { key: 'Avg_English', label: 'Avg English', format: v => formatNumber(v) },
          { key: 'Avg_Math', label: 'Avg Math', format: v => formatNumber(v) },
          { key: 'Avg_CA_Est', label: 'Avg CA Est', format: v => formatNumber(v) },
        ])}
      </article>
      <article class="surface evidence-table-card">
        <h2>Cohort comparison (final averages)</h2>
        ${renderEvidenceTable(evidence.cohort_comparison || [])}
      </article>
    </div>
    <div class="evidence-table-grid">
      <article class="surface evidence-table-card">
        <h2>Entry vs exit average</h2>
        ${tableFromRows(evidence.entry_exit || [], [
          { key: 'Subject', label: 'Subject', bold: true },
          { key: 'Entry', label: 'Entry', format: v => formatNumber(v) },
          { key: 'Exit', label: 'Exit', format: v => formatNumber(v) },
        ])}
      </article>
      <article class="surface evidence-table-card">
        <h2>Average gain and improvement rate</h2>
        ${tableFromRows(evidence.avg_gain || [], [
          { key: 'Subject', label: 'Subject', bold: true },
          { key: 'Avg_Gain', label: 'Avg Gain', format: v => formatNumber(v) },
          { key: 'Improved_%', label: 'Improved %', format: v => pct(v) },
        ])}
      </article>
    </div>`;
}

async function loadEvidence() {
  const cohort = document.getElementById('cohortFilter').value;
  const evidence = await fetchJSON(`/api/dashboard/evidence?cohort=${encodeURIComponent(cohort)}`);
  document.getElementById('evidenceSubtitle').textContent = `Showing: ${safe(evidence.selected_cohort)} · benchmarking page with cohort growth, internal achievement, and evidence narrative.`;
  const gainRows = evidence.avg_gain || [];
  const entryExitRows = evidence.entry_exit || [];
  document.getElementById('evidenceContent').className = 'cognia-benchmark';
  document.getElementById('evidenceContent').innerHTML = `
    <section class="cognia-topline">
      <div>
        <h3>${safe(evidence.selected_cohort)} Benchmarking Evidence</h3>
        <p class="small">This view mirrors the original Excel <strong>Cognia_Evidence_Page</strong>: cohort selector, growth KPIs, year profile, cohort benchmarking, and diagrams.</p>
        <ul class="methodology-list">${(evidence.methodology || []).map(m => `<li>${safe(m)}</li>`).join('')}</ul>
      </div>
      <div class="evidence-summary compact">
        ${evidenceKpi('Students', evidence.headline.students, 0)}
        ${evidenceKpi('Avg NSIS Gain', evidence.headline.avg_nsis_gain)}
        ${evidenceKpi('Avg Math Exit', evidence.headline.avg_math_gain)}
        ${evidenceKpi('% Improved in NSIS', evidence.headline.improved_nsis_pct, 1)}
        ${evidenceKpi('Avg STEM Gain', evidence.headline.avg_stem_gain)}
      </div>
    </section>

    <div class="evidence-charts evidence-first">
      ${evidenceBenchmarkLine(evidence.year_profile || [])}
      ${groupedBarSVG('Average gain by subject', gainRows.filter(r => r.Subject !== 'CA Est'), [{ key: 'Avg_Gain', label: 'Avg Gain', color: '#c79b2b' }], { allowNegative: true })}
    </div>

    <div class="evidence-charts evidence-first">
      ${groupedBarSVG('Entry vs exit average', entryExitRows, [
        { key: 'Entry', label: 'Entry', color: '#2c75c9' },
        { key: 'Exit', label: 'Exit', color: '#c7475a' },
      ])}
      ${groupedBarSVG('Students improved (%)', gainRows.filter(r => r.Subject !== 'CA Est'), [{ key: 'Improved_%', label: 'Improved %', color: '#00756f' }], { percent: true })}
    </div>

    <div class="evidence-charts evidence-first">
      ${groupedBarSVG('Final NSIS and Math by cohort', evidence.cohort_comparison || [], [
        { key: 'Final_NSIS', label: 'Final NSIS', color: '#2c75c9' },
        { key: 'Final_Math', label: 'Final Math', color: '#c7475a' },
      ])}
      <div class="insight-stack">
        ${renderBarList('Cohort Top Universities', evidence.top_universities || [], 'University')}
        ${renderBarList('Cohort Top Majors / Specialties', evidence.top_majors || [], 'Major')}
      </div>
    </div>

    ${renderBenchmarkTables(evidence)}

    <div class="evidence-charts evidence-first">
      ${evidenceAchievementBar(evidence.schoolwide_achievements || {})}
      <div class="surface evidence-note">
        <h3>Enrichment Evidence Source</h3>
        <p class="small">Student-level project and award records are integrated from the attached 2024/2025 achievements file. Because that source contains names rather than QID numbers, student profile matching is conservative and uses reliable Arabic-name matching only.</p>
        <div class="metric-row"><span>Total achievement/participation records</span><strong>${formatNumber(evidence.schoolwide_achievements?.total_records, 0)}</strong></div>
        <div class="metric-row"><span>Participation records</span><strong>${formatNumber(evidence.schoolwide_achievements?.participations, 0)}</strong></div>
        <div class="metric-row"><span>Award/rank records</span><strong>${formatNumber(evidence.schoolwide_achievements?.awards, 0)}</strong></div>
      </div>
    </div>

    ${evidenceCards(evidence.evidence_cards)}
  `;
}

async function boot() {
  const [meta, dashboard] = await Promise.all([fetchJSON('/api/meta'), fetchJSON('/api/dashboard/executive')]);
  setHeader(meta);
  renderKpis(dashboard.headline);
  renderCohortTable(dashboard.cohort_summary || []);
  renderDestinationInsights(dashboard);
  renderQuality(dashboard.data_quality || {});
  await loadOptions();
  await runSearch();
  await loadEvidence();

  document.getElementById('studentSearch').addEventListener('input', runSearch);
  document.getElementById('cohortFilter').addEventListener('change', async () => { await loadOptions(); await runSearch(); await loadEvidence(); });
  document.getElementById('qidSelect').addEventListener('change', e => loadStudent(e.target.value));
  document.getElementById('nameSelect').addEventListener('change', e => loadStudent(e.target.value));
  document.getElementById('refreshButton').addEventListener('click', () => window.location.reload());
  document.getElementById('printProfile').addEventListener('click', () => window.print());
  document.getElementById('printEvidence').addEventListener('click', () => { activateTab('evidence'); window.print(); });
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:2rem;font-family:Segoe UI,Arial,sans-serif"><h2>Dashboard failed to load</h2><p>${err.message}</p><p>Check that the workbook path is correct and the FastAPI server is running.</p></div>`;
});
