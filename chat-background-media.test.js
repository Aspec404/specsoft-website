const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = __dirname;

function expectContains(file, regex, description) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert(regex.test(text), `${file}: ${description}`);
}

expectContains('chats-community-settings.js', /video\/mp4|video\/webm|\.mp4\b|\.webm\b/i, 'chat backgrounds should accept MP4/WebM media');
expectContains('chats-community-settings.css', /\.csx-bg-video|\.csx-bg\.is-video|\.csx-bgprev-layer\.is-video/i, 'chat background styles should support animated or video media');

console.log('Chat background media support test passed.');
