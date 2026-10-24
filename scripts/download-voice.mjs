import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Range-specific query keys avoid intermediary caches confusing different byte ranges.
export async function downloadModel(url, destination) {
  const size = 43898754;
  const blockSize = 1024 * 1024;
  const chunks = Math.ceil(size / blockSize);
  const dir = destination + '.chunks';
  await mkdir(dir, { recursive: true });
  let next = 0;
  async function run() {
    while (next < chunks) {
      const index = next++;
      const start = index * blockSize, end = Math.min(size - 1, start + blockSize - 1);
      const file = path.join(dir, String(index));
      if (fs.existsSync(file) && fs.statSync(file).size === end - start + 1) continue;
      let complete = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch(`${url}&shike-range=${start}-${end}`, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(90000) });
          if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) throw new Error('Unexpected model range');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== end - start + 1) throw new Error('Incomplete model range');
          await writeFile(file, bytes); complete = true;
          console.log(`Voice model chunk ${index + 1}/${chunks}`); break;
        } catch (error) { console.log(`Voice range ${index + 1}, retry ${attempt + 1}: ${error.message}`); }
      }
      if (!complete) throw new Error('语音模型下载中断。请联网后重试，已完成分段会保留。');
    }
  }
  await Promise.all([run(), run(), run(), run()]);
  const parts = [];
  for (let i = 0; i < chunks; i++) parts.push(await readFile(path.join(dir, String(i))));
  await writeFile(destination, Buffer.concat(parts));
}
