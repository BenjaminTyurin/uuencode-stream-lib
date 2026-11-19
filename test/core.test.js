import test from 'node:test';
import assert from 'node:assert/strict';

import { encode, encodeBytes, LINE_LENGTH } from '../src/index.js';

// Helper: encode a string's UTF-8 bytes for readable test fixtures.
function bytes(text) {
  return new TextEncoder().encode(text);
}

// Helper: turn a list of chunks into a sync iterable.
function* chunks(...parts) {
  for (const part of parts) {
    yield part;
  }
}

// Helper: turn a list of chunks into an async iterable.
async function* asyncChunks(...parts) {
  for (const part of parts) {
    yield part;
  }
}

test('LINE_LENGTH is the canonical 45', () => {
  assert.equal(LINE_LENGTH, 45);
});

test('encodeBytes produces one length char plus four chars per 3 bytes', () => {
  // "Cat" is exactly three bytes, so the line is length '#' (3 + 0x20)
  // followed by the four encoded characters for 0x43 0x61 0x74.
  const out = encodeBytes(bytes('Cat'));
  assert.equal(out, '#0V%T\n');
});

test('encodeBytes pads a short final group with zero bytes', () => {
  // "Ca" is two bytes. The group is padded with a zero byte to produce four
  // output characters, and the length character reports 2 so a decoder knows
  // only two bytes are real. 0x43 0x61 0x00 encodes to '0V$ ' (the padded
  // fourth character is the space that represents a zero sextet).
  const out = encodeBytes(bytes('Ca'));
  assert.equal(out, '"0V$ \n');
});

test('encodeBytes emits a single length char for a one-byte input', () => {
  // 0x00 encodes to a space in the uuencode alphabet, so the four-character
  // group is space space space space. The length char is 1 + 0x20 = '!'.
  const out = encodeBytes(new Uint8Array([0x00]));
  assert.equal(out, '!    \n');
});

test('encodeBytes returns the empty string for empty input', () => {
  assert.equal(encodeBytes(new Uint8Array(0)), '');
});

test('encodeBytes splits exactly at 45 bytes', () => {
  const data = new Uint8Array(LINE_LENGTH);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = i;
  }
  const out = encodeBytes(data);
  const lines = out.split('\n');
  // One full line plus the trailing empty string from the final newline.
  assert.equal(lines.length, 2);
  assert.equal(lines[0].length, 1 + 60);
  assert.equal(lines[0][0], String.fromCharCode(LINE_LENGTH + 0x20));
});

test('encodeBytes emits a short line after a full line', () => {
  const data = new Uint8Array(LINE_LENGTH + 1);
  const out = encodeBytes(data);
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].length, 1 + 60);
  // Second line has one source byte, so one length char plus four chars.
  assert.equal(lines[1].length, 1 + 4);
  assert.equal(lines[1][0], String.fromCharCode(1 + 0x20));
});

test('encodeBytes rejects non-Uint8Array input', () => {
  assert.throws(() => encodeBytes('not bytes'), TypeError);
});

test('encode matches encodeBytes for a single chunk', async () => {
  const data = bytes('Hello, uuencode!');
  assert.equal(await encode(chunks(data)), encodeBytes(data));
});

test('encode matches encodeBytes for an async source', async () => {
  const data = bytes('Hello, uuencode!');
  assert.equal(await encode(asyncChunks(data)), encodeBytes(data));
});

test('encode joins chunk boundaries into full 45-byte lines', async () => {
  // Deliberately split the input at awkward offsets so the encoder has to
  // buffer across chunks to keep line boundaries at 45 bytes.
  const data = new Uint8Array(100);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (i * 7) & 0xff;
  }
  const parts = [
    data.subarray(0, 1),
    data.subarray(1, 44),
    data.subarray(44, 46),
    data.subarray(46, 100),
  ];
  assert.equal(await encode(chunks(...parts)), encodeBytes(data));
});

test('encode flushes a trailing partial line', async () => {
  const data = bytes('partial');
  const out = await encode(chunks(data.subarray(0, 3), data.subarray(3)));
  assert.equal(out, encodeBytes(data));
  assert.ok(out.endsWith('\n'));
});

test('encode returns empty string for an empty source', async () => {
  assert.equal(await encode(chunks()), '');
});

test('encode ignores zero-length chunks', async () => {
  const data = bytes('abc');
  const out = await encode(chunks(new Uint8Array(0), data, new Uint8Array(0)));
  assert.equal(out, encodeBytes(data));
});

test('encode rejects non-Uint8Array chunks', async () => {
  await assert.rejects(
    () => encode(chunks('nope')),
    TypeError,
  );
});

test('encode rejects a null source', async () => {
  await assert.rejects(() => encode(null), TypeError);
});

test('encode rejects a source that is not iterable', async () => {
  await assert.rejects(() => encode(42), TypeError);
});
