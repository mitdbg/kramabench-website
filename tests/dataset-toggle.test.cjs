'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, deferred, response, settle} = require('./browser-free-harness.cjs');
const siteDir = process.env.KRAMA_SITE_DIR || path.resolve(__dirname, '..');
const row = (system, score = '50.00%', model = 'Test model') => ({System: system, Models: model, Archaeology: score, Astronomy: score, Biomedical: score, Environment: score, Legal: score, Wildfire: score, Overall: score, 'Overall Benchmark Time': '-'});
const defaultFixtures = {
  'data/benchmark_results.csv': [row('PUBLIC_ONLY')],
  'data/benchmark_obscured.csv': [row('OBSCURED_ONLY')],
  'data/benchmark_oracle.csv': [row('ORACLE_ONLY')],
  'data/pipeline_design_scores.csv': [row('PUBLIC_PIPELINE_DESIGN')],
  'data/pipeline_implementation_scores.csv': [row('PUBLIC_PIPELINE_IMPLEMENTATION')],
};
function harness(options = {}) {return createHarness({siteDir, fixtures: {...defaultFixtures, ...options.fixtures}, fetch: options.fetch});}
function table(h) {return h.query('#leaderboard-table tbody').innerHTML;}
async function selectDataset(h, dataset) {assert.ok(h.element('dataset-selector'), 'dataset fieldset must exist'); const radio = h.element('dataset-' + dataset); assert.ok(radio); for (const name of ['public', 'obscured']) h.element('dataset-' + name).checked = name === dataset; await radio.dispatch('change'); await h.settle();}
async function oracle(h, enabled) {const control = h.element('oracle-toggle'); assert.ok(control); control.checked = enabled; await control.dispatch('change'); await h.settle();}
function assertNoPublicPipelineVisible(h) {
  const section = h.element('pipeline-tables') || h.element('pipeline-scores');
  if (section?.hidden || section?.style.display === 'none') return;
  for (const selector of ['#pipeline-design-table tbody', '#pipeline-implementation-table tbody']) assert.doesNotMatch(h.query(selector).innerHTML, /PUBLIC_PIPELINE/);
}
test('default public results and obscured results remain isolated', async () => {
  const h = harness(); await h.initialize(); assert.match(table(h), /PUBLIC_ONLY/); assert.doesNotMatch(table(h), /OBSCURED_ONLY/);
  await selectDataset(h, 'obscured'); assert.match(table(h), /OBSCURED_ONLY/); assert.doesNotMatch(table(h), /PUBLIC_ONLY|ORACLE_ONLY/);
  await selectDataset(h, 'public'); assert.match(table(h), /PUBLIC_ONLY/); assert.doesNotMatch(table(h), /OBSCURED_ONLY/);
});
test('Oracle is public-only and disabled while obscured is selected', async () => {
  const h = harness(); await h.initialize(); await oracle(h, true); assert.match(table(h), /ORACLE_ONLY/);
  await selectDataset(h, 'obscured'); const checkbox = h.element('oracle-toggle'); assert.equal(checkbox.disabled, true); assert.equal(checkbox.checked, false); assert.match(table(h), /OBSCURED_ONLY/);
  const oracleFetches = h.calls.filter(call => call.url.includes('benchmark_oracle')).length;
  await oracle(h, true); const container = h.query('.toggle-container');
  if (container) {await container.dispatch('keydown', {key: ' '}); await container.dispatch('keydown', {key: 'Enter'}); await container.dispatch('click');}
  await h.settle(); assert.equal(h.calls.filter(call => call.url.includes('benchmark_oracle')).length, oracleFetches); assert.match(table(h), /OBSCURED_ONLY/);
  await selectDataset(h, 'public'); assert.equal(checkbox.disabled, false);
});
test('public pipeline results are not visible in obscured view', async () => {
  const h = harness(); await h.initialize(); assert.match(h.query('#pipeline-design-table tbody').innerHTML, /PUBLIC_PIPELINE_DESIGN/);
  await selectDataset(h, 'obscured'); assertNoPublicPipelineVisible(h);
});
test('switching to obscured clears visible public results before its request resolves', async () => {
  const pending = deferred(); const h = harness({fetch: url => url.includes('benchmark_obscured') ? pending.promise : undefined});
  await h.initialize(); assert.match(table(h), /PUBLIC_ONLY/);
  const radio = h.element('dataset-obscured'); assert.ok(radio); h.element('dataset-public').checked = false; radio.checked = true; void radio.dispatch('change'); await settle();
  assert.doesNotMatch(table(h), /PUBLIC_ONLY|ORACLE_ONLY/); assertNoPublicPipelineVisible(h);
  pending.resolve(response([row('OBSCURED_ONLY')])); await h.settle(); assert.match(table(h), /OBSCURED_ONLY/);
});
test('a stale public leaderboard response cannot replace newer obscured rows', async () => {
  const pending = deferred(); const h = harness({fetch: url => url.includes('benchmark_results') ? pending.promise : undefined});
  void h.initialize(); await settle(); await selectDataset(h, 'obscured'); assert.match(table(h), /OBSCURED_ONLY/);
  pending.resolve(response([row('STALE_PUBLIC_RESPONSE')])); await h.settle(); assert.match(table(h), /OBSCURED_ONLY/); assert.doesNotMatch(table(h), /STALE_PUBLIC_RESPONSE/);
});
test('a stale public load failure cannot replace newer obscured rows', async () => {
  const pending = deferred(); const h = harness({fetch: url => url.includes('benchmark_results') ? pending.promise : undefined});
  void h.initialize(); await settle(); await selectDataset(h, 'obscured');
  pending.reject(new Error('STALE_PUBLIC_ERROR')); await h.settle(); assert.match(table(h), /OBSCURED_ONLY/); assert.doesNotMatch(table(h), /STALE_PUBLIC_ERROR/);
});
test('a stale Oracle response cannot replace current obscured rows', async () => {
  const pending = deferred(); const h = harness({fetch: url => url.includes('benchmark_oracle') ? pending.promise : undefined});
  await h.initialize(); const checkbox = h.element('oracle-toggle'); checkbox.checked = true; void checkbox.dispatch('change'); await settle();
  await selectDataset(h, 'obscured'); pending.resolve(response([row('STALE_ORACLE_RESPONSE')])); await h.settle();
  assert.match(table(h), /OBSCURED_ONLY/); assert.doesNotMatch(table(h), /STALE_ORACLE_RESPONSE/);
});
test('late public pipeline responses cannot become visible in obscured view', async () => {
  const pending = deferred(); const h = harness({fetch: url => url.includes('pipeline_') ? pending.promise : undefined});
  void h.initialize(); await settle(); await selectDataset(h, 'obscured');
  pending.resolve(response([row('PUBLIC_PIPELINE_LATE_RESPONSE')])); await h.settle(); assertNoPublicPipelineVisible(h);
});
test('search treats regular-expression punctuation literally and preserves search through dataset change', async () => {
  const literal = 'Literal [ ] ( ) + * ? . \\ ^ $ { } |';
  const h = harness({fixtures: {'data/benchmark_results.csv': [row(literal)], 'data/benchmark_obscured.csv': [row(literal)]}}); await h.initialize();
  const input = h.element('search-input');
  for (const term of ['[', '(', '\\', '+', '*', '?', '.', '^', '$', '{', '|']) {
    input.value = term; await input.dispatch('keydown', {key: 'Enter'}); await h.settle(); assert.match(table(h), /Literal/); assert.doesNotMatch(table(h), /Error loading/);
  }
  input.value = '['; await input.dispatch('keydown', {key: 'Enter'}); await selectDataset(h, 'obscured'); assert.match(table(h), /Literal/); assert.equal(input.value, '[');
  await input.dispatch('keydown', {key: 'Escape'}); await h.settle(); assert.equal(input.value, ''); assert.doesNotMatch(table(h), /<mark>/);
});
test('CSV labels remain escaped HTML even with hostile text and search highlighting', async () => {
  const malicious = '<img src=x onerror=globalThis.pwned=true> & "quoted"';
  const h = harness({fixtures: {'data/benchmark_results.csv': [row(malicious, '50.0%', '<script>bad()</script>')]}}); await h.initialize();
  assert.doesNotMatch(table(h), /<img\b|<script\b/); assert.match(table(h), /&lt;img/);
  h.element('search-input').value = '<img'; await h.element('search-input').dispatch('keydown', {key: 'Enter'}); await h.settle();
  assert.doesNotMatch(table(h), /<img\b|<script\b/); assert.notEqual(h.context.pwned, true);
});
test('native dataset and Oracle controls have keyboard-accessible labels', () => {
  const h = harness(); const fieldset = h.element('dataset-selector'); assert.ok(fieldset); assert.equal(fieldset.tagName, 'FIELDSET');
  assert.match(h.html, /<fieldset\b[^>]*id=["']dataset-selector["'][^>]*>[\s\S]*?<legend\b[^>]*>[^<]+<\/legend>/i);
  for (const name of ['public', 'obscured']) {
    const radio = h.element('dataset-' + name); assert.equal(radio.tagName, 'INPUT'); assert.equal(radio.getAttribute('type'), 'radio'); assert.equal(radio.getAttribute('name'), 'dataset'); assert.equal(radio.value, name);
    assert.ok(new RegExp('<label\\b[^>]*for=["\']dataset-' + name + '["\']').test(h.html), 'radio needs an associated label');
  }
  const oracleControl = h.element('oracle-toggle'); assert.equal(oracleControl.tagName, 'INPUT'); assert.equal(oracleControl.getAttribute('type'), 'checkbox');
  assert.ok(oracleControl.getAttribute('aria-label') || /<label\b[^>]*for=["']oracle-toggle["']/i.test(h.html));
});
test('system URL validator allows web links and rejects executable or unknown schemes', () => {
  const h = harness(); const validate = h.context.KramaBench?.validateSystemUrl || h.context.validateSystemUrl;
  assert.equal(typeof validate, 'function');
  for (const url of ['https://example.org/paper', 'http://example.org/code']) assert.ok(validate(url));
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<svg/onload=alert(1)>', 'vbscript:msgbox(1)', 'file:///tmp/test', 'ftp://example.org/file', 'http://user:password@example.org/', 'mailto:user@example.org', '  java\nscript:alert(1)', '', null, undefined, {}]) assert.ok(!validate(url), 'unsupported URL must not become a link');
});
test('system links escape labels and include safe external-link attributes', () => {
  const h = harness(); const render = h.context.KramaBench?.renderSystemLabel || h.context.renderSystemLabel; assert.equal(typeof render, 'function');
  for (const system of ['TalkTask', 'RADAR', 'DeepAnalyze']) {
    const output = render(system, ''); assert.match(output, /<a\b/); assert.match(output, /href=["']https?:\/\//);
    if (/target=["']_blank["']/.test(output)) {assert.match(output, /\brel=["'][^"']*noopener/); assert.match(output, /\brel=["'][^"']*noreferrer/);}
  }
  for (const candidate of ['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/bad']) assert.doesNotMatch(render('TalkTask', '', candidate), /<a\b/);
  const attributeAttempt = render('TalkTask', '', 'https://example.org/" onmouseover="bad()'); assert.doesNotMatch(attributeAttempt, /<a[^>]*\s(?:onmouseover|onclick)=/i);
  const malicious = 'TalkTask <img src=x onerror=globalThis.pwned=true> & "quoted"';
  const rendered = render(malicious, '<img'); assert.doesNotMatch(rendered, /<img\b|<script\b|href=["']javascript:/); assert.notEqual(h.context.pwned, true);
  const unknown = render('Unknown [system]', '['); assert.doesNotMatch(unknown, /href=["'](?:javascript|data|vbscript):/i); assert.match(unknown, /Unknown/);
});
test('active load errors cannot inject HTML into leaderboard status', async () => {
  const h = harness({fetch: url => {if (url.includes('benchmark_results')) throw new Error('<img src=x onerror=globalThis.pwned=true>');}}); await h.initialize();
  assert.doesNotMatch(table(h), /<img\b|<script\b/); assert.notEqual(h.context.pwned, true);
});
function readCsvRecords(file) {
  const input = fs.readFileSync(file, 'utf8'); const records = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {if (ch === '"' && input[i + 1] === '"') {cell += '"'; i++;} else if (ch === '"') quoted = false; else cell += ch;}
    else if (ch === '"') quoted = true;
    else if (ch === ',') {row.push(cell); cell = '';}
    else if (ch === '\n') {row.push(cell.replace(/\r$/, '')); if (row.some(Boolean)) records.push(row); row = []; cell = '';}
    else cell += ch;
  }
  if (cell || row.length) {row.push(cell); records.push(row);}
  const header = records.shift() || []; return records.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] || ''])));
}
test('every currently published system family has a validated link in every table', () => {
  const h = harness(); const getUrl = h.context.KramaBench?.getSystemUrl || h.context.getSystemUrl; const validate = h.context.KramaBench?.validateSystemUrl || h.context.validateSystemUrl;
  assert.equal(typeof getUrl, 'function'); assert.equal(typeof validate, 'function');
  const names = new Set();
  for (const filename of ['benchmark_results.csv', 'benchmark_obscured.csv', 'benchmark_oracle.csv', 'pipeline_design_scores.csv', 'pipeline_implementation_scores.csv']) for (const entry of readCsvRecords(path.join(siteDir, 'data', filename))) if (entry.System) names.add(entry.System);
  assert.ok(names.size >= 5);
  for (const name of names) assert.ok(validate(getUrl(name)), 'published system needs a safe paper/repository link: ' + name);
});
test('published CSVs keep obscured conditions separate and identify DeepAnalyze-8B', () => {
  const publicRows = readCsvRecords(path.join(siteDir, 'data/benchmark_results.csv'));
  const obscuredRows = readCsvRecords(path.join(siteDir, 'data/benchmark_obscured.csv'));
  const oracleRows = readCsvRecords(path.join(siteDir, 'data/benchmark_oracle.csv'));
  assert.ok(obscuredRows.some(entry => /TalkTask/i.test(entry.System)));
  const deep = obscuredRows.filter(entry => /DeepAnalyze/i.test(entry.System)); assert.ok(deep.length);
  for (const entry of deep) assert.equal(entry.Models, 'DeepAnalyze-8B');
  assert.ok(publicRows.every(entry => !/obscured/i.test(entry.System)));
  assert.ok(oracleRows.every(entry => !/obscured/i.test(entry.System)));
});
