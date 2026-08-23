// lib/contact-links.mjs: the only writer of data/contact-links.json, which holds
// the merge decisions a human made by hand.
//
// Everything else about person identity is derived on read. This file is the one
// piece of persisted state, and it stores PINS, not edges.
//
// A pin is a positive statement: "this ref is the same person as that one", or
// "this ref stands alone". The obvious alternative, union-find with negative
// split edges, has a defeat: split A from B, then import C carrying the same
// LinkedIn URL, and C unions with both and silently reunites them. A positive pin
// cannot be routed around, and it never has to be reconciled against a URL match
// because it simply wins.
//
// Pins store REFS ("ta:42"), never a person id. A person id is derived from
// whichever refs are grouped, so correcting somebody's LinkedIn URL changes it. A
// stored id would dangle; a stored ref cannot, because the store and row number
// outlive any edit to the row.
//
// Absent, empty and corrupt all mean "no pins" and must never throw, the same
// contract lib/tt-linkedin.mjs follows. Deleting the file is a complete undo: it
// restores exactly the behavior of never having merged anything.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';

const LINKS_PATH = path.join(DATA_DIR, 'contact-links.json');

function readDocument() {
  try {
    const value = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writePins(change) {
  const document = readDocument();
  const pins = document.pins && typeof document.pins === 'object' && !Array.isArray(document.pins) ? { ...document.pins } : {};
  change(pins);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LINKS_PATH, JSON.stringify({ ...document, version: document.version || 1, pins }, null, 2) + '\n', 'utf8');
  return pins;
}

export function readPins() {
  const pins = readDocument().pins;
  return pins && typeof pins === 'object' && !Array.isArray(pins) ? pins : {};
}

export function pinTogether(refA, refB, note = '') {
  return writePins(pins => { pins[refA] = { with: refB, by: 'manual', at: new Date().toISOString().slice(0, 10), note: String(note || '') }; });
}

export function pinAlone(ref) {
  return writePins(pins => { pins[ref] = { alone: true, at: new Date().toISOString().slice(0, 10) }; });
}

export function unpin(ref) {
  return writePins(pins => { delete pins[ref]; });
}
