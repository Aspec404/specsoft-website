const fs = require('fs');
const path = require('path');
const assert = require('assert');

const text = fs.readFileSync(path.join(__dirname, 'chats.js'), 'utf8');

assert(/function\s+csPlay\([\s\S]*?const\s+startClip\s*=\s*function\s*\([\s\S]*?csAudio\.play\(\)/.test(text),
  'status music should trigger playback from inside the user gesture path instead of waiting for metadata');

assert(!/loadedmetadata\s*[,)]\s*.*go\s*|loadedmetadata[\s\S]*?csAudio\.play\(\)/.test(text),
  'status music should not defer playback until a loadedmetadata callback that can lose the click gesture');

assert(/not playable in this browser|Pick a different song|Details:\s+/.test(text),
  'status music should give a clear unsupported-preview explanation and a recovery hint');

console.log('Chat status music autoplay guard test passed.');
