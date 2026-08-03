import { spawn } from 'node:child_process';

export async function pickBookFile(): Promise<string | null> {
  const candidates: string[][] = [
    [
      'zenity',
      '--file-selection',
      '--title=Open e-book',
      '--file-filter=Books | *.fb2 *.fb2.zip *.epub',
    ],
    ['kdialog', '--getopenfilename', '.', '*.fb2 *.fb2.zip *.epub'],
  ];
  for (const args of candidates) {
    const result = await runPicker(args);
    if (result !== null) return result;
  }
  return null;
}

function runPicker(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(args[0]!, args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 30000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const trimmed = out.trim();
      if (code === 0 && trimmed !== '') {
        resolve(trimmed);
      } else if (code !== null && code !== 0 && err.trim() === '') {
        resolve(null);
      } else {
        resolve(null);
      }
    });
  });
}
