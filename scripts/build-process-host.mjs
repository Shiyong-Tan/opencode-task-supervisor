import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
if (process.platform === 'win32') {
  mkdirSync('dist/native', { recursive: true });
  execFileSync(join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/r:System.Web.Extensions.dll', `/out:${resolve('dist/native/JobHost.exe')}`, resolve('native/JobHost.cs')],
    { stdio: 'inherit', windowsHide: true });
}
