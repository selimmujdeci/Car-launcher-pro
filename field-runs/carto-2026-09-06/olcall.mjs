import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
for (const f of process.argv.slice(2)) {
  const b64 = readFileSync(f).toString('base64');
  writeFileSync('_olc.html', '<body style="margin:0"><img src="data:image/png;base64,' + b64 + '">');
  execSync('node olc.mjs _olc.html', { stdio: 'inherit' });
  console.log('   ^ ' + f);
}
