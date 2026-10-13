const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'providers/boat.js');
const original = fs.readFileSync(file, 'utf8').split('// BOAT_INTERACTIVE_BEGIN')[0].trimEnd();
const extension = fs.readFileSync(path.join(root, 'src/boat-interactive.js'), 'utf8');
fs.writeFileSync(file, original + '\n\n' + extension);
