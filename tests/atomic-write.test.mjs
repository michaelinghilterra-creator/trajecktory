#!/usr/bin/env node
import { readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../lib/atomic-write.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('atomic-write.test.mjs');
const dir = makeSandbox('atomic-write-test');
const target = join(dir, 'exact.txt');
const content = 'Example first\r\nExample second\n';
writeFileAtomic(target, content);
check(readFileSync(target, 'utf8') === content, 'content round-trips with CRLF bytes intact');
check(!readdirSync(dir).some(name => name.includes('.tmp-')), 'success leaves no temporary file');

let attempts = 0;
const retryTarget = join(dir, 'retry.txt');
writeFileAtomic(retryTarget, 'retry', {
  rename(from, to) {
    attempts++;
    if (attempts <= 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    renameSync(from, to);
  },
});
check(attempts === 3 && readFileSync(retryTarget, 'utf8') === 'retry', 'EBUSY rename is retried until it succeeds');
check(!readdirSync(dir).some(name => name.includes('.tmp-')), 'retried success leaves no temporary file');

const failedTarget = join(dir, 'persistent.txt');
let persistentAttempts = 0;
let persistentThrew = false;
try {
  writeFileAtomic(failedTarget, 'never written', {
    rename() {
      persistentAttempts++;
      throw Object.assign(new Error('still busy'), { code: 'EBUSY' });
    },
  });
} catch (error) {
  persistentThrew = error.code === 'EBUSY';
}
check(persistentThrew && persistentAttempts === 10, 'persistent rename failure throws after ten attempts');
check(!readdirSync(dir).some(name => name.includes('.tmp-')), 'persistent failure removes its temporary file');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
