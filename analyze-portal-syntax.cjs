// Analyze portalv3.html script blocks for syntax errors and map to file lines
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'portalv3.html');
const html = fs.readFileSync(file, 'utf8');

// Find all <script>...</script> blocks with their start line numbers
const lines = html.split(/\n/);
let scripts = [];
let inScript = false;
let current = { startLine: 0, code: [] };
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inScript && line.includes('<script')) {
    inScript = true;
    current = { startLine: i + 1, code: [] };
    continue;
  }
  if (inScript && line.includes('</script>')) {
    scripts.push(current);
    inScript = false;
    continue;
  }
  if (inScript) current.code.push(line);
}

console.log(`Found ${scripts.length} script blocks`);
let hadError = false;

scripts.forEach((s, idx) => {
  const code = s.code.join('\n');
  try {
    new Function(code);
  } catch (e) {
    hadError = true;
    // Try to extract line number from error or stack
    let errLine = 1;
    const m = (e.stack || '').match(/<anonymous>:(\d+):(\d+)/);
    if (m) errLine = parseInt(m[1], 10);
    const fileLine = s.startLine + errLine - 1;
    console.log(`\n❌ ERROR in script block ${idx + 1} @ file line ${fileLine}: ${e.message}`);
    // Show surrounding lines
    const contextStart = Math.max(0, fileLine - 4);
    const contextEnd = Math.min(lines.length, fileLine + 3);
    for (let j = contextStart; j < contextEnd; j++) {
      const prefix = (j + 1 === fileLine) ? '>>' : '  ';
      console.log(`${prefix} ${String(j + 1).padStart(6)} | ${lines[j]}`);
    }
  }
});

if (!hadError) console.log('\n✓ All script blocks are syntactically valid');
