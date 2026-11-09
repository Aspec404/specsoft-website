const fs = require('fs');
const assert = require('assert');

const eventText = fs.readFileSync(__dirname + '/thethe-event.js', 'utf8');
const apexText = fs.readFileSync(__dirname + '/apex-credits.js', 'utf8');

assert(!/appendChild\(mk\('b', null, '0'\)\)/.test(eventText), 'tHE badge should not hardcode a zero balance');
assert(/readApexBalance\(|window\.ApexCredits/.test(eventText), 'tHE badge should read from the real APEX balance');
assert(/new CustomEvent\('apex:balance'/.test(apexText), 'apex wallet should emit the balance event that the themed badge listens for');

console.log('tHE event badge test passed.');
