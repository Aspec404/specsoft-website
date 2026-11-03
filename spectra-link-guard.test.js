const assert = require('assert');
const { CANONICAL_SPECSOFT_SITE, sanitizeSpecsoftLinks } = require('./spectra-link-guard.js');

assert.strictEqual(
  sanitizeSpecsoftLinks('You can check the official SPECSOFT studio page here: https://www.specsoft.co.uk'),
  'You can check the official SPECSOFT studio page here: ' + CANONICAL_SPECSOFT_SITE
);
assert.strictEqual(
  sanitizeSpecsoftLinks('Official site: [SPECSOFT Official Website](https://specsoft.co.uk)'),
  'Official site: [SPECSOFT Official Website](' + CANONICAL_SPECSOFT_SITE + ')'
);
assert.strictEqual(
  sanitizeSpecsoftLinks('This is fine: https://example.com'),
  'This is fine: https://example.com'
);
assert.strictEqual(
  sanitizeSpecsoftLinks('https://specsoftdev.netlify.app/hello?x=1'),
  CANONICAL_SPECSOFT_SITE
);

console.log('Spectra link guard test passed.');
