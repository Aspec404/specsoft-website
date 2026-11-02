const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = __dirname;
const limit = 5 * 1024 * 1024;

function expectContains(file, pattern, description) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert(pattern.test(text), `${file}: ${description}`);
}

expectContains('studio.js', /JSON\.stringify\(graph\)\.length\s*>\s*(?:MAX_PROJECT|5242880|5\s*\*\s*1024\s*\*\s*1024)|var\s+MAX_PROJECT\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'project save cap should be 5 MB');
expectContains('studio-preview.js', /MAX_DOC\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'preview cap should be 5 MB');
expectContains('studio-publish.js', /MAX_PAGE\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)\s*,\s*MAX_FILES\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'publish caps should be 5 MB');
expectContains('studio-graph.js', /slice\(0,\s*(?:MAX_TEXT|5242880|5\s*\*\s*1024\s*\*\s*1024)\)/, 'script and SQL data should be truncated at 5 MB');
expectContains('studio-graph.js', /maxLength\s*=\s*(?:MAX_TEXT|5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'graph editor maxLength should be 5 MB');
expectContains('studio-data.js', /maxLength\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'data SQL textarea maxLength should be 5 MB');
expectContains('studio-view.js', /MAX_DOC\s*=\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'viewer cap should be 5 MB');
expectContains('studio-sql.js', /bytes:\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)\s*,\s*sql:\s*(?:5242880|5\s*\*\s*1024\s*\*\s*1024)/, 'SQL limits should be 5 MB');
expectContains('studio-shell.js', /5\s*MB|5242880|5\s*\*\s*1024\s*\*\s*1024/, 'help text should mention the updated 5 MB limit');

console.log('Studio size limits test passed.');
