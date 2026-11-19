// Public entry point for uuencode-stream-lib.
// Keeping the barrel small makes the exported surface obvious and stable.
export {
  encode,
  encodeBytes,
  LINE_LENGTH,
} from './core.js';
