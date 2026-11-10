const fs = require('fs');
const path = require('path');
const assert = require('assert');

const text = fs.readFileSync(path.join(__dirname, 'chats.js'), 'utf8');

assert(/function\s+csPlay\([\s\S]*?const\s+startClip\s*=\s*function\s*\([\s\S]*?csAudio\.play\(\)/.test(text),
  'status music should trigger playback from inside the user gesture path instead of waiting for metadata');

assert(!/loadedmetadata\s*[,)]\s*.*go\s*|loadedmetadata[\s\S]*?csAudio\.play\(\)/.test(text),
  'status music should not defer playback until a loadedmetadata callback that can lose the click gesture');

assert(/CS_CLIP\s*=\s*30|Math\.min\(30,\s*Number\(mus\.start\)|status_music_start_rng|status_music_start.*30|0\s*and\s*30/.test(text),
  'status music should use a 30-second selectable clip window and save it with a 0..30 start offset');

assert(/not playable in this browser|Pick a different song|Details:\s+/.test(text),
  'status music should give a clear unsupported-preview explanation and a recovery hint');

console.log('Chat status music autoplay guard test passed.');
