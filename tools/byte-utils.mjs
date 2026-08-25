// byte-utils.mjs — byte-accurate helpers for preservation-first document assembly.
//
// Reference implementation for AutoResearch coordinators. These functions are
// correct at the BYTE level and are safe with real-world files that mix line
// endings (LF + CRLF) and contain multi-byte UTF-8 (smart quotes, em/en dashes,
// math symbols). Import and reuse them; do not re-implement hashing or line
// numbering inline.
//
//   import { sha256, lineNo, terminatorLength, regionExtent, extractBetweenMarkers } from '<preset>/tools/byte-utils.mjs';

import crypto from 'node:crypto';

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 1-based line number of a BYTE offset in a raw buffer.
// Counts LF (0x0a) bytes; a CRLF pair counts once (the LF). Multi-byte UTF-8 is
// irrelevant because we count bytes, never decoded characters.
export function lineNo(buf, byteOffset) {
  const end = Math.min(byteOffset, buf.length);
  let n = 1;
  for (let i = 0; i < end; i++) if (buf[i] === 0x0a) n++;
  return n;
}

// Length of the native line terminator starting at `offset`: 2 for CRLF, 1 for
// LF (or lone CR), 0 when the byte is not a line terminator.
export function terminatorLength(buf, offset) {
  if (buf[offset] === 0x0d && buf[offset + 1] === 0x0a) return 2;
  if (buf[offset] === 0x0a || buf[offset] === 0x0d) return 1;
  return 0;
}

export function countOccurrences(buf, needle) {
  let n = 0;
  let at = 0;
  while ((at = buf.indexOf(needle, at)) >= 0) {
    n++;
    at += Math.max(1, needle.length);
  }
  return n;
}

// Resolve a full-line inclusive region from a start anchor to an end anchor.
// The returned `end` INCLUDES the end line's native terminator (`\r\n` or `\n`).
// Throws when an anchor is absent/reversed or the end line has no terminator.
// Callers must independently require each anchor to occur exactly once.
//
// `startStr`/`endStr` are anchor text that MUST round-trip to the exact file
// bytes (UTF-8 JSON strings for UTF-8 sources).
export function regionExtent(buf, startStr, endStr) {
  const start = Buffer.from(startStr, 'utf8');
  const end = Buffer.from(endStr, 'utf8');
  const s = buf.indexOf(start);
  const e0 = buf.indexOf(end, s);
  if (s < 0 || e0 < s) throw new Error('regionExtent: anchor not found or reversed');
  const e = e0 + end.length;
  const t = terminatorLength(buf, e);
  if (t === 0) throw new Error('regionExtent: no native line terminator after end anchor');
  return { start: s, end: e + t, terminator: t === 2 ? 'CRLF' : 'LF' };
}

// Extract payload bytes strictly between a BEGIN marker line and an END marker
// line, excluding the marker lines themselves and including the payload's own
// trailing terminator. Throws when a marker is missing or reversed.
export function extractBetweenMarkers(buf, beginLine, endLine) {
  const a = buf.indexOf(Buffer.from(beginLine, 'utf8'));
  const b = buf.indexOf(Buffer.from(endLine, 'utf8'), a);
  if (a < 0 || b < a) throw new Error('extractBetweenMarkers: marker missing or reversed');
  return buf.subarray(a + Buffer.byteLength(beginLine), b);
}
