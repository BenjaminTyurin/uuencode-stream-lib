// Core uuencode encoder.
//
// The uuencode format encodes binary data in 3-byte groups as 4 printable
// characters. Each line starts with a length character that encodes the number
// of source bytes on that line, and the line ends with a newline. The classic
// `uuencode` utility emits 45 source bytes per line (60 encoded characters),
// which is the fixed chunk size this library implements.
//
// We deliberately do not implement decoding, headers, or the `begin`/`end`
// wrapper. Those are container concerns; this module only turns bytes into the
// encoded body.

/** Number of source bytes represented on each output line. */
export const LINE_LENGTH = 45;

// The uuencode alphabet maps the 6-bit values 0..63 onto printable characters.
// 0 maps to a space (0x20) and 63 maps to '`' (0x60). The gap between 'Z' and
// 'a' is not a typo; uuencode predates ASCII and skips the punctuation range.
const ENCODE_TABLE = (() => {
  const table = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    table[i] = i === 0 ? 0x20 : i + 0x20;
  }
  return table;
})();

/**
 * Encode one length value (0..45) as its uuencode length character.
 *
 * The length character uses the same 0x20 offset as the data alphabet, so a
 * value of 0 becomes a space. A line whose length is zero is the terminator
 * line, which callers that want a complete uuencode body can add themselves.
 *
 * @param {number} n number of source bytes on the line, 0..45
 * @returns {string} single character
 */
function lengthChar(n) {
  if (!Number.isInteger(n) || n < 0 || n > LINE_LENGTH) {
    throw new RangeError(`line length must be an integer in 0..${LINE_LENGTH}`);
  }
  return String.fromCharCode(n + 0x20);
}

/**
 * Encode a single 3-byte group into 4 uuencode characters.
 *
 * The final group of a stream may be short. uuencode pads the missing bytes
 * with zeroes for the purpose of producing four output characters; the length
 * character on the line tells a decoder how many of those bytes are real. We
 * follow that rule rather than dropping characters, because decoders rely on
 * every non-terminator line having exactly four characters per group.
 *
 * @param {number} b0 first byte
 * @param {number} b1 second byte, or 0 when absent
 * @param {number} b2 third byte, or 0 when absent
 * @returns {string} four characters
 */
function encodeGroup(b0, b1, b2) {
  const c0 = (b0 >> 2) & 0x3f;
  const c1 = ((b0 << 4) | (b1 >> 4)) & 0x3f;
  const c2 = ((b1 << 2) | (b2 >> 6)) & 0x3f;
  const c3 = b2 & 0x3f;
  return String.fromCharCode(
    ENCODE_TABLE[c0],
    ENCODE_TABLE[c1],
    ENCODE_TABLE[c2],
    ENCODE_TABLE[c3],
  );
}

/**
 * Encode a Uint8Array into uuencode lines.
 *
 * Each returned line is terminated with '\n'. The result does not include a
 * zero-length terminator line; callers that need a self-contained uuencode
 * body can append `lengthChar(0) + '\n'` themselves. We chose to omit it so
 * that streaming callers can concatenate chunks without worrying about a
 * terminator appearing in the middle of their output.
 *
 * @param {Uint8Array} bytes source data
 * @returns {string} encoded lines, each ending in '\n'
 */
export function encodeBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('encodeBytes expects a Uint8Array');
  }

  let out = '';
  for (let offset = 0; offset < bytes.length; offset += LINE_LENGTH) {
    const remaining = bytes.length - offset;
    const lineBytes = remaining < LINE_LENGTH ? remaining : LINE_LENGTH;
    out += lengthChar(lineBytes);

    // Walk the line in 3-byte groups. The last group may be short; the
    // missing bytes are treated as zero for encoding purposes.
    for (let i = 0; i < lineBytes; i += 3) {
      const b0 = bytes[offset + i];
      const b1 = i + 1 < lineBytes ? bytes[offset + i + 1] : 0;
      const b2 = i + 2 < lineBytes ? bytes[offset + i + 2] : 0;
      out += encodeGroup(b0, b1, b2);
    }

    out += '\n';
  }
  return out;
}

/**
 * Encode a stream of bytes into uuencode lines.
 *
 * The function accepts any iterable or async iterable of Uint8Array chunks.
 * Chunks are buffered internally so that line boundaries always fall on the
 * fixed 45-byte boundary regardless of how the caller split the input. This is
 * the whole point of the library: a naive encoder that encodes each incoming
 * chunk independently would produce lines shorter than 45 bytes and break
 * decoders that expect the canonical layout.
 *
 * @param {Iterable<Uint8Array>|AsyncIterable<Uint8Array>} source byte chunks
 * @returns {Promise<string>} encoded lines, each ending in '\n'
 */
export async function encode(source) {
  if (source == null) {
    throw new TypeError('encode expects an iterable of Uint8Array chunks');
  }

  // A single reusable buffer holds bytes that have not yet formed a complete
  // 45-byte line. Using a plain array of bytes keeps the logic simple; the
  // amounts involved are small and bounded by LINE_LENGTH.
  const pending = [];
  let out = '';

  const flushLine = () => {
    out += lengthChar(pending.length);
    for (let i = 0; i < pending.length; i += 3) {
      const b0 = pending[i];
      const b1 = i + 1 < pending.length ? pending[i + 1] : 0;
      const b2 = i + 2 < pending.length ? pending[i + 2] : 0;
      out += encodeGroup(b0, b1, b2);
    }
    out += '\n';
    pending.length = 0;
  };

  const pushChunk = (chunk) => {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('encode expects Uint8Array chunks');
    }
    let offset = 0;
    while (offset < chunk.length) {
      const room = LINE_LENGTH - pending.length;
      const take = Math.min(room, chunk.length - offset);
      for (let i = 0; i < take; i += 1) {
        pending.push(chunk[offset + i]);
      }
      offset += take;
      if (pending.length === LINE_LENGTH) {
        flushLine();
      }
    }
  };

  // Support both sync and async iterables without requiring the caller to
  // wrap a plain array in Promise.resolve.
  if (typeof source[Symbol.asyncIterator] === 'function') {
    for await (const chunk of source) {
      pushChunk(chunk);
    }
  } else if (typeof source[Symbol.iterator] === 'function') {
    for (const chunk of source) {
      pushChunk(chunk);
    }
  } else {
    throw new TypeError('encode expects an iterable of Uint8Array chunks');
  }

  if (pending.length > 0) {
    flushLine();
  }
  return out;
}
