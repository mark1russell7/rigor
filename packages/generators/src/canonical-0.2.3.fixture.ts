// This file is a frozen copy of `canonicalJson` of version 0.2.3, from `src/hash.ts` at commit 90722e8.
// The tests compare the current `canonicalJson` with it. The bench `scripts/bench-canonical.ts` times the two.
// Do not change this file. Only the name of the function and its TSDoc comment are new.
// The build does not include this file, because `src/index.ts` does not import it.

import type { CanonicalOptions } from "./hash.ts";

/** The getter of `RegExp.prototype.source`. It causes a `TypeError` for an object with no slot of a `RegExp`. */
const sourceOf = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!;

/** The getter of the `Symbol.toStringTag` of the typed arrays. It gives `undefined` for an object that is not a typed array. */
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, Symbol.toStringTag)!.get! as (this: object) => string | undefined;

/** The types that the option `tags: "typed"` writes with a tag. */
const tagged: ReadonlySet<string> = new Set(["Date", "RegExp", "Map", "Set"]);

/** This function is true for an object, and false for `null` and each primitive. */
const isObject = (v: unknown): v is object => v !== null && typeof v === "object";

/** This function gives the brand of an object: the tag of `Object.prototype.toString`. The brand is the same in each realm. */
const brandOf = (o: object): string => Object.prototype.toString.call(o).slice(8, -1);

/** This function is true when `method` accepts `o` as its `this`. Thus it tests an internal slot, the same in each realm. */
function hasSlot(method: (...args: never[]) => unknown, o: object): boolean {
  try {
    Reflect.apply(method, o, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * This function gives the primitive value of a boxed `Number`, `String`, `Boolean` or `BigInt`, as `JSON.stringify` does.
 * For each other object, it gives the object.
 */
function unboxed(o: object, brand: string): unknown {
  if (brand === "Number" && hasSlot(Number.prototype.valueOf, o)) return Number(o);
  if (brand === "String" && hasSlot(String.prototype.valueOf, o)) return String(o);
  if (brand === "Boolean" && hasSlot(Boolean.prototype.valueOf, o)) return Boolean.prototype.valueOf.call(o);
  if (brand === "BigInt" && hasSlot(BigInt.prototype.valueOf, o)) return BigInt.prototype.valueOf.call(o);
  return o;
}

/** This function is `canonicalJson` of version 0.2.3. */
export function canonicalJsonV023(value: unknown, options?: CanonicalOptions): string {
  const form = options?.form ?? "jcs";
  const tags = options?.tags ?? "none";
  if (tags !== "none" && tags !== "typed") throw new RangeError(`canonicalJson: tags is "none" or "typed", not ${String(tags)}.`);
  const typed = tags === "typed";
  const bigint = options?.bigint ?? (typed ? "suffix" : "error");
  if (form !== "jcs" && form !== "json") throw new RangeError(`canonicalJson: form is "jcs" or "json", not ${String(form)}.`);
  if (bigint !== "error" && bigint !== "suffix") throw new RangeError(`canonicalJson: bigint is "error" or "suffix", not ${String(bigint)}.`);
  const jcs = form === "jcs";
  const open = new Set<object>();
  const text = (s: string): string => {
    if (jcs && !(s as string & { isWellFormed(): boolean }).isWellFormed()) throw new RangeError(`canonicalJson: the string ${JSON.stringify(s)} has a lone surrogate, which RFC 8785 does not allow.`);
    return JSON.stringify(s);
  };
  // This function gives the tag of a Date, a RegExp, a Map or a Set, and undefined for each other object.
  // It tests the internal slot of each type. Thus a value from another realm gets its tag, and an object with only the name of a type does not.
  const tagOf = (o: object): string | undefined => {
    const brand = brandOf(o);
    if (brand === "Date" && hasSlot(Date.prototype.getTime, o)) return `Date(${Date.prototype.getTime.call(o)})`;
    if (brand === "RegExp" && hasSlot(sourceOf, o)) return `RegExp(${text(RegExp.prototype.toString.call(o))})`;
    const map = brand === "Map" && hasSlot(Map.prototype.has, o);
    if (!map && !(brand === "Set" && hasSlot(Set.prototype.has, o))) return undefined;
    if (open.has(o)) throw new TypeError("canonicalJson: the value has a cycle.");
    open.add(o);
    const parts: string[] = [];
    if (map) for (const [k, item] of Map.prototype.entries.call(o) as Iterable<[unknown, unknown]>) parts.push(`[${write(k, "")},${write(item, "")}]`);
    else for (const item of Set.prototype.values.call(o) as Iterable<unknown>) parts.push(write(item, ""));
    open.delete(o);
    return `${map ? "Map" : "Set"}(${parts.sort().join(",")})`;
  };
  // This function gives the text of the TypeError for an object that keeps its content out of its own keys.
  const lost = (brand: string): string => {
    const fix = !typed && tagged.has(brand) ? 'Use the option tags: "typed", or give the object a method toJSON.' : "Give the object a method toJSON.";
    return `canonicalJson: the type ${brand} has no JSON form. JSON.stringify keeps only its own keys, so two of them with other contents can get the same hash. ${fix}`;
  };
  const write = (v: unknown, key: string): string => {
    if (typed && isObject(v)) {
      const tag = tagOf(v);
      if (tag !== undefined) return tag;
    }
    if (isObject(v) && typeof (v as { toJSON?: unknown }).toJSON === "function") {
      v = (v as { toJSON(key: string): unknown }).toJSON(key);
      // A method toJSON can give a Map or a Set. With tags, it gets its tag.
      if (typed && isObject(v)) {
        const tag = tagOf(v);
        if (tag !== undefined) return tag;
      }
    }
    let brand = "Object";
    if (isObject(v)) {
      brand = brandOf(v);
      if (brand !== "Object") v = unboxed(v, brand);
    }
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
    if (brand !== "Object" && brand !== "Arguments" && !Array.isArray(o) && typedArrayName.call(o) === undefined) throw new TypeError(lost(brand));
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
