import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const RETRYABLE_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function writeFileAtomic(filePath, content, { rename = renameSync } = {}) {
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = openSync(tempPath, 'wx');
    writeFileSync(descriptor, content, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    for (let attempt = 0; ; attempt++) {
      try {
        rename(tempPath, filePath);
        return;
      } catch (error) {
        if (!RETRYABLE_RENAME_ERRORS.has(error?.code) || attempt >= 9) throw error;
        sleep((attempt + 1) * 5);
      }
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
    try { rmSync(tempPath, { force: true }); } catch { /* preserve the original error */ }
    throw error;
  }
}
