import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvText } from '../lib/env-file.mjs';

test('parseEnvText reads plain lines and skips comments and blanks', () => {
  const env = parseEnvText('# note\nFIRST_KEY=one\n\n  SECOND_KEY = two words \nbroken line\n');
  assert.deepEqual(env, { FIRST_KEY: 'one', SECOND_KEY: 'two words' });
});

test('parseEnvText keeps a line saved with a Windows line ending', () => {
  const env = parseEnvText('FIRST_KEY=one\r\nSTATE_DIR=C:\\widgets\\state\r\nLAST_KEY=three\r\n');
  assert.equal(env.STATE_DIR, 'C:\\widgets\\state');
  assert.deepEqual(Object.keys(env), ['FIRST_KEY', 'STATE_DIR', 'LAST_KEY']);
  assert.ok(!Object.values(env).some(value => value.includes('\r')));
});

test('parseEnvText handles a file whose only mixed line ends in a carriage return', () => {
  const env = parseEnvText('FIRST_KEY=one\nSTATE_DIR=C:\\widgets\\state\r\nLAST_KEY=three');
  assert.deepEqual(env, { FIRST_KEY: 'one', STATE_DIR: 'C:\\widgets\\state', LAST_KEY: 'three' });
});

test('parseEnvText returns an empty object for empty input', () => {
  assert.deepEqual(parseEnvText(''), {});
  assert.deepEqual(parseEnvText(undefined), {});
});
