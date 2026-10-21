const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [mode, release, exit = '0'] = process.argv.slice(2);
if (mode === 'member') {
  const timer = setInterval(() => {
    try { if (fs.readFileSync(release, 'utf8') === String(process.pid)) { clearInterval(timer); process.exit(0); } } catch {}
  }, 5);
  setTimeout(() => process.exit(91), 10000).unref();
} else if (mode === 'finite') {
  setTimeout(() => process.exit(Number(exit)), 700);
} else if (mode === 'churn') {
  (async () => {
    for (let i = 0; i < 280; i++) {
      const child = spawn(process.execPath, [__filename, 'member', release], { stdio: 'ignore', windowsHide: true });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      if (code !== 0) throw Error('Member fixture failed');
    }
    console.log('FIXTURE COMPLETE'); process.exit(Number(exit));
  })().catch(() => process.exit(92));
} else if (mode === 'root-exit') {
  spawn(process.execPath, [__filename, 'member', release], { stdio: 'ignore', windowsHide: true });
  setTimeout(() => process.exit(Number(exit)), 150);
} else process.exit(93);
