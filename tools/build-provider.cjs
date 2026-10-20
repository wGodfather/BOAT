const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'providers/boat.js');
const MARKER = '// BOAT_INTERACTIVE_BEGIN';
// Top-level identifiers of the attributed upstream bundle that src/boat-interactive.js relies on.
// If an upstream rebuild renames any of them the provider would throw ReferenceError at runtime,
// so the build refuses to append the extension until the list below is updated.
const REQUIRED = ['C', 'ce', 'de', 'N', 'Rt', 'Ye', 'qe', 'Oe', 'Ne'];

const bundle = fs.readFileSync(file, 'utf8');
if (bundle.split(MARKER).length > 2) throw Error(`${MARKER} appears more than once in providers/boat.js`);
const original = bundle.split(MARKER)[0].trimEnd();
const extension = fs.readFileSync(path.join(root, 'src/boat-interactive.js'), 'utf8');
if (!extension.startsWith(MARKER)) throw Error(`src/boat-interactive.js must start with ${MARKER}`);

function verifyUpstream(source) {
    // Evaluate the upstream part alone, exactly as tools/interactive.test.cjs does, so that every
    // `var`/`let`/`const`/function binding of its top-level scope becomes visible to `typeof`.
    const sandbox = { module: { exports: {} }, console, URL, URLSearchParams, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, AbortController, atob, btoa,
        require: name => name === 'cheerio' ? {} : null,
        fetch: async () => { throw Error('network access is disabled during the build'); } };
    vm.createContext(sandbox);
    try {
        vm.runInContext(source, sandbox, { filename: 'providers/boat.js (upstream part)' });
    } catch (error) {
        throw Error(`upstream bundle could not be evaluated: ${error.message}`);
    }
    const missing = REQUIRED.filter(name => vm.runInContext(`typeof ${name}`, sandbox) === 'undefined');
    if (missing.length) {
        throw Error(`upstream bundle does not define top-level identifier(s) used by src/boat-interactive.js: ${missing.join(', ')}`);
    }
}

verifyUpstream(original);
fs.writeFileSync(file, original + '\n\n' + extension);
console.log(`providers/boat.js rebuilt; upstream identifiers verified: ${REQUIRED.join(', ')}`);
