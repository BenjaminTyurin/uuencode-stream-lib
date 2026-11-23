# uuencode-stream-lib

Encodes binary data into the classic uuencode format, with fixed 45-byte line chunks.

```js
import { encode, encodeBytes, LINE_LENGTH } from 'uuencode-stream-lib';

// One-shot: encode a Uint8Array.
const body = encodeBytes(new Uint8Array([0x43, 0x61, 0x74]));
// '#0V%T\n'

// Streaming: encode chunks of any size; line boundaries stay at 45 bytes.
async function* source() {
  yield new Uint8Array([0x43, 0x61]);
  yield new Uint8Array([0x74]);
}
const streamed = await encode(source());
// '#0V%T\n'

console.log(LINE_LENGTH); // 45
```

The module is ESM-only and has no dependencies.

## Why this exists

A naive streaming encoder encodes each incoming chunk on its own. If the caller
hands you 7 bytes and then 7 more, you get two short lines instead of one line
of 14 source bytes, and decoders that assume the canonical 45-byte layout choke
on the result. This library buffers across chunk boundaries so the output always
uses the standard layout, regardless of how the input was split. The trade-off
is a small amount of in-memory buffering (at most 44 bytes of pending data) and
the requirement that `encode` is asynchronous, since it accepts async sources.

## The awkward edge

The output does **not** include the zero-length terminator line that a complete
uuencode body ends with. This is deliberate: streaming callers concatenate
chunks, and a terminator in the middle of a concatenation would be wrong. If
you need a self-contained body, append the terminator yourself:

```js
import { encodeBytes } from 'uuencode-stream-lib';

const body = encodeBytes(new Uint8Array([0x43, 0x61, 0x74])) + ' \n'; // ' ' is length char 0
```

A second edge: `encodeBytes` and `encode` pad the final short group with zero
bytes to produce four output characters, but the line's length character still
reports the true number of source bytes. Decoders rely on that length character
to discard the padding.

## API

- `LINE_LENGTH` — number, always `45`.
- `encodeBytes(bytes)` — takes a `Uint8Array`, returns a `string` of encoded
  lines each ending in `\n`. Throws `TypeError` for non-`Uint8Array` input.
- `encode(source)` — takes a sync or async iterable of `Uint8Array` chunks,
  returns a `Promise<string>` of encoded lines each ending in `\n`. Throws
  `TypeError` for a non-iterable source or a non-`Uint8Array` chunk.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

