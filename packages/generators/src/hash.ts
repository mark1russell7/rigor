/**
 * The content hash of a document: SHA-256 of a string, and a canonical JSON form of a value.
 *
 * The two functions use no API of Node or of the browser, so a hash is the same on each platform.
 * `canonicalHash(value)` is `sha256Hex(canonicalJson(value))`: equal values give equal hashes, also when their keys have another order.
 */

/** The round constants of SHA-256. */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The options of `sha256Hex`. */
export interface Sha256Options {
  /**
   * The bytes that the hash reads, as in `fnv1a32`:
   *
   * - `"utf8"` (the default): the UTF-8 bytes. A lone surrogate becomes the bytes of U+FFFD, as `TextEncoder` writes them.
   * - `"wtf8"`: the UTF-8 bytes of each code point. A lone surrogate becomes its own 3 bytes (WTF-8).
   *
   * For a string without a lone surrogate, the two inputs give the same hash.
   */
  readonly input?: "utf8" | "wtf8";
}

/**
 * This function writes the bytes of a string into `out` and gives the count of the bytes. With no `out`, it only counts.
 * It reads the UTF-16 code units, so it makes no string for each character.
 */
function writeBytes(text: string, wtf8: boolean, out?: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xe000) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (c < 0xdc00 && low >= 0xdc00 && low < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else if (!wtf8) c = 0xfffd;
    }
    if (c < 0x80) {
      if (out !== undefined) out[n] = c;
      n += 1;
    } else if (c < 0x800) {
      if (out !== undefined) {
        out[n] = 0xc0 | (c >> 6);
        out[n + 1] = 0x80 | (c & 63);
      }
      n += 2;
    } else if (c < 0x10000) {
      if (out !== undefined) {
        out[n] = 0xe0 | (c >> 12);
        out[n + 1] = 0x80 | ((c >> 6) & 63);
        out[n + 2] = 0x80 | (c & 63);
      }
      n += 3;
    } else {
      if (out !== undefined) {
        out[n] = 0xf0 | (c >> 18);
        out[n + 1] = 0x80 | ((c >> 12) & 63);
        out[n + 2] = 0x80 | ((c >> 6) & 63);
        out[n + 3] = 0x80 | (c & 63);
      }
      n += 4;
    }
  }
  return n;
}

/**
 * This function gives the SHA-256 digest of the bytes of a string, as 64 lowercase hex characters.
 * The option `input` selects the bytes of a lone surrogate. It is not for passwords: it has no salt and no cost.
 */
export function sha256Hex(text: string, options?: Sha256Options): string {
  const input = options?.input ?? "utf8";
  if (input !== "utf8" && input !== "wtf8") throw new RangeError(`sha256Hex: input is "utf8" or "wtf8", not ${String(input)}.`);
  const wtf8 = input === "wtf8";
  // The bytes go straight into the padded buffer, so the digest makes one array, not a list of the bytes and a copy.
  const length = writeBytes(text, wtf8);
  const bits = length * 8;
  const total = Math.ceil((length + 9) / 64) * 64;
  const data = new Uint8Array(total);
  writeBytes(text, wtf8, data);
  data[length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + k) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** The options of `canonicalJson` and `canonicalHash`. */
export interface CanonicalOptions {
  /**
   * The form of the values that JSON does not have:
   *
   * - `"jcs"` (the default): RFC 8785. `NaN`, an infinite number and a string with a lone surrogate cause a `RangeError`.
   * - `"json"`: the form of `JSON.stringify`. `NaN` and an infinite number become `null`, and a lone surrogate becomes an escape.
   */
  readonly form?: "jcs" | "json";
  /**
   * The form of a `bigint`. `"error"` (the default) causes a `TypeError`, as `JSON.stringify` does.
   * `"suffix"` writes the digits and the letter `n`, for example `12n`. This text is not JSON, so use it only for a key.
   */
  readonly bigint?: "error" | "suffix";
}

/**
 * This function gives the canonical form of a value. The default form is RFC 8785 (JCS):
 *
 * - The keys of each object are in the order of their UTF-16 code units, with no whitespace.
 * - The numbers and the strings have the form of `JSON.stringify`, which is the form of RFC 8785.
 * - A key with the value `undefined` is not in the form. An `undefined` in an array, or as the value, becomes `null`.
 * - An object with a method `toJSON`, for example a `Date`, gives the form of the result of that method.
 * - A function, a symbol and a cycle cause a `TypeError`.
 *
 * `canonicalJson(JSON.parse(canonicalJson(v)))` is equal to `canonicalJson(v)`.
 */
export function canonicalJson(value: unknown, options?: CanonicalOptions): string {
  const form = options?.form ?? "jcs";
  const bigint = options?.bigint ?? "error";
  if (form !== "jcs" && form !== "json") throw new RangeError(`canonicalJson: form is "jcs" or "json", not ${String(form)}.`);
  if (bigint !== "error" && bigint !== "suffix") throw new RangeError(`canonicalJson: bigint is "error" or "suffix", not ${String(bigint)}.`);
  const jcs = form === "jcs";
  const open = new Set<object>();
  const text = (s: string): string => {
    if (jcs && !(s as string & { isWellFormed(): boolean }).isWellFormed()) throw new RangeError(`canonicalJson: the string ${JSON.stringify(s)} has a lone surrogate, which RFC 8785 does not allow.`);
    return JSON.stringify(s);
  };
  const write = (v: unknown, key: string): string => {
    if (v !== null && typeof v === "object" && typeof (v as { toJSON?: unknown }).toJSON === "function") v = (v as { toJSON(key: string): unknown }).toJSON(key);
    if (v === undefined || v === null) return "null";
    switch (typeof v) {
      case "boolean":
        return v ? "true" : "false";
      case "number":
        if (Number.isFinite(v)) return JSON.stringify(v);
        if (jcs) throw new RangeError(`canonicalJson: ${String(v)} is not a JSON number.`);
        return "null";
      case "string":
        return text(v);
      case "bigint":
        if (bigint === "suffix") return `${v}n`;
        throw new TypeError(`canonicalJson: the bigint ${v}n has no JSON form. Use the option bigint: "suffix" for a key.`);
      case "object":
        break;
      default:
        throw new TypeError(`canonicalJson: a ${typeof v} has no JSON form.`);
    }
    const o = v as object;
    if (open.has(o)) throw new TypeError("canonicalJson: the value has a cycle.");
    open.add(o);
    let out: string;
    if (Array.isArray(o)) out = `[${o.map((item: unknown, i) => write(item, String(i))).join(",")}]`;
    else {
      const r = o as Record<string, unknown>;
      const keys = Object.keys(r).filter((k) => r[k] !== undefined).sort();
      out = `{${keys.map((k) => `${text(k)}:${write(r[k], k)}`).join(",")}}`;
    }
    open.delete(o);
    return out;
  };
  return write(value, "");
}

/** This function gives the content hash of a value: `sha256Hex(canonicalJson(value, options))`. */
export function canonicalHash(value: unknown, options?: CanonicalOptions): string {
  return sha256Hex(canonicalJson(value, options));
}
