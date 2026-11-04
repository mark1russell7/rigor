/**
 * The validator of the format `response-records/1`. The functions here read unknown data and write faults. Thus a page
 * can show the reason that a file is bad.
 */
import { RESPONSE_RECORDS_SCHEMA, type ResponseData, type ResponseDimension, type ResponseMeasure, type ResponsePoint, type ResponseRecord, type RidgeInput, groupKey, isNumberDimension, valueFault, whenHolds } from "./response.ts";

/** The largest power of a factor. A larger power of a coordinate from -1 to 1 adds almost nothing to a model. */
export const RESPONSE_MAX_POWER = 8;

/** One fault of a record. */
export interface ResponseFault {
  /** The place of the fault, for example `points[3].values.size`. An empty string is the record itself. */
  readonly path: string;
  /** What is wrong, and what the format needs. */
  readonly message: string;
}

/** The result of `parseResponseRecord`: the record, or each fault that the validator found. */
export type ParsedResponseRecord = { readonly ok: true; readonly record: ResponseRecord } | { readonly ok: false; readonly faults: readonly ResponseFault[] };

type Fields = Readonly<Record<string, unknown>>;

/** The list that the checks write to. */
type Faults = ResponseFault[];

/** This function gives an unknown value as short text for a message. */
function shown(value: unknown): string {
  if (value === undefined) return "nothing";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

/** This function gives a path with one more key. */
const at = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** This function gives the field `key` of an unknown value, or `undefined` for a value that is not an object. */
const peek = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? (value as Fields)[key] : undefined);

/** This function writes a fault when a test fails. */
function need(ok: boolean, path: string, message: string, faults: Faults): void {
  if (!ok) faults.push({ path, message });
}

/** This function gives the fields of a plain object. It writes a fault for another value, and for each wrong key. */
function fields(value: unknown, path: string, keys: readonly string[], optional: readonly string[], faults: Faults): Fields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    faults.push({ path, message: `this is an object, not ${shown(value)}.` });
    return undefined;
  }
  const object = value as Fields;
  for (const key of keys) need(Object.hasOwn(object, key), at(path, key), "this field is missing.", faults);
  for (const key of Object.keys(object)) need(keys.includes(key) || optional.includes(key), at(path, key), `${RESPONSE_RECORDS_SCHEMA} has no such field.`, faults);
  return object;
}

/** This function gives the items of a list. It writes a fault for another value, and for a short list. */
function list(value: unknown, path: string, least: number, faults: Faults): readonly unknown[] {
  if (!Array.isArray(value)) {
    faults.push({ path, message: `this is a list, not ${shown(value)}.` });
    return [];
  }
  need(value.length >= least, path, `this list has ${value.length} items, and it needs ${least} or more.`, faults);
  return value as readonly unknown[];
}

/** This function examines a field when it is present. A missing field already has a fault, or it is optional. */
function check(object: Fields, key: string, path: string, test: (value: unknown) => boolean, wanted: string, faults: Faults): void {
  if (Object.hasOwn(object, key)) need(test(object[key]), at(path, key), `this is ${wanted}, not ${shown(object[key])}.`, faults);
}

const isId = (v: unknown): boolean => typeof v === "string" && v !== "";
const isString = (v: unknown): boolean => typeof v === "string";
const isPositive = (v: unknown): boolean => isNumber(v) && v > 0;
const isNotNegative = (v: unknown): boolean => isNumber(v) && v >= 0;

/** This function writes a fault for each id that is a duplicate, and it gives the set of the ids. */
function uniqueIds(items: readonly unknown[], path: string, faults: Faults): Set<string> {
  const ids = new Set<string>();
  items.forEach((item, i) => {
    const id = peek(item, "id");
    if (typeof id !== "string") return;
    need(!ids.has(id), `${path}[${i}].id`, `an earlier item has the id ${shown(id)}.`, faults);
    ids.add(id);
  });
  return ids;
}

/** This function examines the levels of a categorical or ordinal dimension. */
function checkLevels(value: unknown, path: string, numbersToo: boolean, log: boolean, faults: Faults): void {
  const levels = list(value, path, 1, faults);
  const numbers = numbersToo && levels.every(isNumber);
  need(numbers || levels.every(isString), path, numbersToo ? "these levels are all text or all finite numbers." : "these levels are all text.", faults);
  need(new Set(levels).size === levels.length, path, "these levels have a duplicate.", faults);
  if (numbers) need(levels.every((v, i) => i === 0 || (levels[i - 1] as number) < (v as number)), path, "these number levels are not in ascending order.", faults);
  if (log) need(levels.every(isPositive), path, "a log dimension has number levels above 0.", faults);
}

/** This function examines one dimension. */
function checkDimension(value: unknown, path: string, faults: Faults): void {
  const kind = peek(value, "kind");
  const object = fields(value, path, ["id", "label", "kind", "unit"], ["range", "levels", "log", "when"], faults);
  if (object === undefined) return;
  check(object, "id", path, isId, "text with one character or more", faults);
  check(object, "label", path, isString, "text", faults);
  check(object, "unit", path, isString, "text", faults);
  check(object, "log", path, (v) => typeof v === "boolean", "true or false", faults);
  const log = object["log"] === true;
  if (kind === "continuous") {
    need(!Object.hasOwn(object, "levels"), at(path, "levels"), "a continuous dimension has a range, not levels.", faults);
    need(!Object.hasOwn(object, "range") || !log || !isNumber(peek(object["range"], "0")) || (peek(object["range"], "0") as number) > 0, at(path, "range"), "a log dimension has a range above 0.", faults);
    need(Object.hasOwn(object, "range"), at(path, "range"), "this field is missing.", faults);
    if (Object.hasOwn(object, "range")) checkRange(object["range"], at(path, "range"), faults);
  } else if (kind === "ordinal" || kind === "categorical") {
    need(!Object.hasOwn(object, "range"), at(path, "range"), `a dimension of the kind ${kind} has levels, not a range.`, faults);
    need(kind === "ordinal" || !Object.hasOwn(object, "log"), at(path, "log"), "a categorical dimension has no log scale.", faults);
    need(Object.hasOwn(object, "levels"), at(path, "levels"), "this field is missing.", faults);
    if (Object.hasOwn(object, "levels")) checkLevels(object["levels"], at(path, "levels"), kind === "ordinal", log, faults);
  } else if (Object.hasOwn(object, "kind")) faults.push({ path: at(path, "kind"), message: `this is "continuous", "ordinal" or "categorical", not ${shown(kind)}.` });
}

/** This function examines the condition of one dimension against all the dimensions. */
function checkWhen(value: unknown, path: string, dimensions: readonly unknown[], faults: Faults): void {
  const object = fields(value, path, ["dimension", "levels"], [], faults);
  if (object === undefined) return;
  const levels = Object.hasOwn(object, "levels") ? list(object["levels"], at(path, "levels"), 1, faults) : [];
  need(new Set(levels).size === levels.length, at(path, "levels"), "these levels have a duplicate.", faults);
  if (!Object.hasOwn(object, "dimension")) return;
  const id = object["dimension"];
  const parent = dimensions.find((d) => peek(d, "id") === id);
  if (parent === undefined) {
    faults.push({ path: at(path, "dimension"), message: `the record has no dimension ${shown(id)}.` });
    return;
  }
  const kind = peek(parent, "kind");
  need(kind === "categorical" || kind === "ordinal", at(path, "dimension"), `the parent ${shown(id)} is ${shown(kind)}, and a parent is categorical or ordinal.`, faults);
  need(peek(parent, "when") === undefined, at(path, "dimension"), `the parent ${shown(id)} is itself conditional.`, faults);
  const known = peek(parent, "levels");
  if (!Array.isArray(known)) return;
  levels.forEach((level, i) => need(known.includes(level), `${at(path, "levels")}[${i}]`, `the dimension ${shown(id)} has no level ${shown(level)}.`, faults));
}

/** This function examines a range. */
function checkRange(range: unknown, path: string, faults: Faults): void {
  const good = Array.isArray(range) && range.length === 2 && isNumber(range[0]) && isNumber(range[1]) && range[0] < range[1];
  need(good, path, `this is a low and a high finite number, with low less than high, not ${shown(range)}.`, faults);
}

/** This function examines one measure. */
function checkMeasure(value: unknown, path: string, faults: Faults): void {
  const object = fields(value, path, ["id", "label", "unit", "direction"], ["range"], faults);
  if (object === undefined) return;
  check(object, "id", path, isId, "text with one character or more", faults);
  check(object, "label", path, isString, "text", faults);
  check(object, "unit", path, isString, "text", faults);
  check(object, "direction", path, (v) => v === "higher" || v === "lower" || v === "none", `"higher", "lower" or "none"`, faults);
  if (Object.hasOwn(object, "range")) checkRange(object["range"], at(path, "range"), faults);
}

/** This function refuses a measured value outside the range of its measure. */
function checkMeasured(point: unknown, path: string, measures: readonly ResponseMeasure[], faults: Faults): void {
  for (const { id, range } of measures) {
    const value = peek(peek(point, "measures"), id);
    if (range === undefined || typeof value !== "number") continue;
    need(value >= range[0] && value <= range[1], at(at(path, "measures"), id), `this value is outside the range of the measure, [${range[0]}, ${range[1]}].`, faults);
  }
}

/** This function examines one declared reason. */
function checkReason(value: unknown, path: string, faults: Faults): void {
  const object = fields(value, path, ["id", "label"], [], faults);
  if (object === undefined) return;
  check(object, "id", path, isId, "text with one character or more", faults);
  check(object, "label", path, isString, "text", faults);
}

/** This function examines the reasons of a point: each has a declaration, and each is on a measure with no number. */
function checkAbsent(value: unknown, path: string, measuresOfPoint: unknown, measures: ReadonlySet<string>, reasons: ReadonlySet<string>, faults: Faults): void {
  const absent = fields(value, path, [], [...measures], faults);
  if (absent === undefined) return;
  for (const measure of measures) {
    if (!Object.hasOwn(absent, measure)) continue;
    need(reasons.has(absent[measure] as string), at(path, measure), `the record declares no reason ${shown(absent[measure])}.`, faults);
    need(typeof peek(measuresOfPoint, measure) !== "number", at(path, measure), "this measure has a number, so it has no reason.", faults);
  }
}

/** This function examines one point, with the dimensions, the measures and the reasons of the record. */
function checkPoint(value: unknown, path: string, dimensions: readonly ResponseDimension[], measures: ReadonlySet<string>, reasons: ReadonlySet<string>, faults: Faults): void {
  const object = fields(value, path, ["id", "values", "measures"], ["group", "absent"], faults);
  if (object === undefined) return;
  check(object, "id", path, isId, "text with one character or more", faults);
  check(object, "group", path, isId, "text with one character or more", faults);
  if (Object.hasOwn(object, "values")) {
    const inside = at(path, "values");
    const ids = dimensions.map((d) => d.id);
    const values = fields(object["values"], inside, ids, [], faults);
    for (const dimension of dimensions) {
      if (values === undefined || !Object.hasOwn(values, dimension.id)) continue;
      const value = values[dimension.id];
      const present = whenHolds(dimension, values);
      const parent = dimension.when?.dimension as string;
      if (value === null && dimension.when !== undefined) {
        need(!present, at(inside, dimension.id), `this needs a value when the dimension "${parent}" is ${shown(values[parent])}.`, faults);
        continue;
      }
      const fault = valueFault(dimension, value);
      if (fault !== undefined) faults.push({ path: at(inside, dimension.id), message: `${fault}.` });
      else need(present, at(inside, dimension.id), `this is null when the dimension "${parent}" is ${shown(values[parent])}.`, faults);
    }
  }
  if (Object.hasOwn(object, "absent")) checkAbsent(object["absent"], at(path, "absent"), object["measures"], measures, reasons, faults);
  if (Object.hasOwn(object, "measures")) {
    const inside = at(path, "measures");
    const values = fields(object["measures"], inside, [...measures], [], faults);
    if (values === undefined) return;
    for (const measure of measures) check(values, measure, inside, (v) => v === null || isNumber(v), "a finite number or null", faults);
  }
}

/**
 * This function examines the data of a record: all but its models and its folds. It gives each fault that it finds.
 * It examines the points only when the dimensions and the measures have no fault, because the points refer to them.
 * `required` and `optional` name the other top-level fields.
 */
export function responseDataFaults(value: unknown, required: readonly string[], optional: readonly string[]): readonly ResponseFault[] {
  const faults: Faults = [];
  const object = fields(value, "", ["schema", "name", "dimensions", "measures", "points", ...required], ["reasons", ...optional], faults);
  if (object === undefined) return faults;
  check(object, "schema", "", (v) => v === RESPONSE_RECORDS_SCHEMA, `"${RESPONSE_RECORDS_SCHEMA}"`, faults);
  check(object, "name", "", isId, "text with one character or more", faults);
  const dimensions = Object.hasOwn(object, "dimensions") ? list(object["dimensions"], "dimensions", 1, faults) : [];
  dimensions.forEach((d, i) => checkDimension(d, `dimensions[${i}]`, faults));
  uniqueIds(dimensions, "dimensions", faults);
  dimensions.forEach((d, i) => {
    if (peek(d, "when") !== undefined) checkWhen(peek(d, "when"), `dimensions[${i}].when`, dimensions, faults);
  });
  const measures = Object.hasOwn(object, "measures") ? list(object["measures"], "measures", 1, faults) : [];
  measures.forEach((m, i) => checkMeasure(m, `measures[${i}]`, faults));
  const measureIds = uniqueIds(measures, "measures", faults);
  const reasons = Object.hasOwn(object, "reasons") ? list(object["reasons"], "reasons", 0, faults) : [];
  reasons.forEach((r, i) => checkReason(r, `reasons[${i}]`, faults));
  const reasonIds = uniqueIds(reasons, "reasons", faults);
  if (faults.length > 0) return faults;
  const points = list(object["points"], "points", 1, faults);
  points.forEach((p, i) => checkPoint(p, `points[${i}]`, dimensions as readonly ResponseDimension[], measureIds, reasonIds, faults));
  uniqueIds(points, "points", faults);
  if (faults.length > 0) return faults;
  points.forEach((p, i) => checkMeasured(p, `points[${i}]`, measures as readonly ResponseMeasure[], faults));
  return faults;
}

/** This function examines one input of a ridge model against the dimensions of the record. */
function checkInput(value: unknown, path: string, dimensions: ReadonlyMap<string, ResponseDimension>, faults: Faults): void {
  const kind = peek(value, "kind");
  if (kind !== "number" && kind !== "rank" && kind !== "level") {
    faults.push({ path: at(path, "kind"), message: `this is "number", "rank" or "level", not ${shown(kind)}.` });
    return;
  }
  const keys = { number: ["center", "spread"], rank: ["levels", "center", "spread"], level: ["levels"] }[kind];
  const object = fields(value, path, ["kind", "dimension", ...keys], kind === "number" ? ["log", "conditional"] : ["conditional"], faults);
  if (object === undefined) return;
  check(object, "center", path, isNumber, "a finite number", faults);
  check(object, "spread", path, isPositive, "a finite number above 0", faults);
  check(object, "log", path, (v) => typeof v === "boolean", "true or false", faults);
  check(object, "conditional", path, (v) => typeof v === "boolean", "true or false", faults);
  const dimension = dimensions.get(object["dimension"] as string);
  if (dimension === undefined) {
    faults.push({ path: at(path, "dimension"), message: `the record has no dimension ${shown(object["dimension"])}.` });
    return;
  }
  const want = isNumberDimension(dimension) ? "number" : dimension.kind === "categorical" ? "level" : "rank";
  need(kind === want, at(path, "kind"), `the dimension "${dimension.id}" needs an input of the kind "${want}".`, faults);
  need((object["conditional"] ?? false) === (dimension.when !== undefined), at(path, "conditional"), `this does not agree with the condition of the dimension "${dimension.id}".`, faults);
  if (kind === "number" && dimension.kind !== "categorical") {
    need((object["log"] ?? false) === (dimension.log ?? false), at(path, "log"), `this does not agree with the log scale of the dimension "${dimension.id}".`, faults);
  }
  if (kind !== "number" && dimension.kind !== "continuous") {
    need(JSON.stringify(object["levels"]) === JSON.stringify(dimension.levels), at(path, "levels"), `these are not the levels of the dimension "${dimension.id}".`, faults);
  }
}

/** This function examines the factors of one term against the inputs of a model. `fitResponse` also uses it. */
export function factorFaults(value: unknown, path: string, inputs: ReadonlyMap<string, RidgeInput>, dimensions: ReadonlyMap<string, ResponseDimension>): readonly ResponseFault[] {
  const faults: Faults = [];
  list(value, path, 1, faults).forEach((item, i) => {
    const inside = `${path}[${i}]`;
    const isLevel = peek(item, "level") !== undefined;
    const factor = fields(item, inside, ["dimension", isLevel ? "level" : "power"], [], faults);
    if (factor === undefined) return;
    const input = inputs.get(factor["dimension"] as string);
    if (input === undefined) {
      faults.push({ path: at(inside, "dimension"), message: `the model has no input ${shown(factor["dimension"])}.` });
    } else if (isLevel) {
      const dimension = dimensions.get(input.dimension);
      const levels: readonly unknown[] = dimension === undefined || dimension.kind === "continuous" ? [] : dimension.levels;
      need(levels.includes(factor["level"]), at(inside, "level"), `the input "${input.dimension}" has no level ${shown(factor["level"])}.`, faults);
    } else {
      need(input.kind !== "level", inside, `the categorical input "${input.dimension}" takes a level, not a power.`, faults);
      const good = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= RESPONSE_MAX_POWER;
      check(factor, "power", inside, good, `a whole number from 1 to ${RESPONSE_MAX_POWER}`, faults);
    }
  });
  return faults;
}

/** This function examines the fields of a ridge model after its common fields. */
function checkRidge(object: Fields, path: string, dimensions: ReadonlyMap<string, ResponseDimension>, faults: Faults): void {
  check(object, "lambda", path, isNotNegative, "a finite number of 0 or more", faults);
  check(object, "intercept", path, isNumber, "a finite number", faults);
  const inputs = Object.hasOwn(object, "inputs") ? list(object["inputs"], at(path, "inputs"), 0, faults) : [];
  const known = new Map<string, RidgeInput>();
  inputs.forEach((input, i) => {
    const inside = `${at(path, "inputs")}[${i}]`;
    checkInput(input, inside, dimensions, faults);
    const dimension = peek(input, "dimension");
    if (typeof dimension !== "string") return;
    need(!known.has(dimension), at(inside, "dimension"), `an earlier input has the dimension "${dimension}".`, faults);
    known.set(dimension, input as RidgeInput);
  });
  const terms = Object.hasOwn(object, "terms") ? list(object["terms"], at(path, "terms"), 0, faults) : [];
  terms.forEach((term, i) => {
    const inside = `${at(path, "terms")}[${i}]`;
    const fieldsOfTerm = fields(term, inside, ["factors", "weight"], [], faults);
    if (fieldsOfTerm === undefined) return;
    check(fieldsOfTerm, "weight", inside, isNumber, "a finite number", faults);
    if (Object.hasOwn(fieldsOfTerm, "factors")) faults.push(...factorFaults(fieldsOfTerm["factors"], at(inside, "factors"), known, dimensions));
  });
}

/** This function examines the dimensions of a table model, and it gives the good ones. */
function tableDimensions(object: Fields, path: string, dimensions: ReadonlyMap<string, ResponseDimension>, faults: Faults): readonly ResponseDimension[] {
  const table: ResponseDimension[] = [];
  const ids = Object.hasOwn(object, "dimensions") ? list(object["dimensions"], at(path, "dimensions"), 1, faults) : [];
  ids.forEach((id, i) => {
    const dimension = dimensions.get(id as string);
    const inside = `${at(path, "dimensions")}[${i}]`;
    if (dimension === undefined) faults.push({ path: inside, message: `the record has no dimension ${shown(id)}.` });
    else if (dimension.kind === "continuous") faults.push({ path: inside, message: `a table cannot read the continuous dimension "${dimension.id}".` });
    else {
      need(!table.includes(dimension), inside, `an earlier item is the dimension "${dimension.id}".`, faults);
      table.push(dimension);
    }
  });
  return table;
}

/** This function examines the fields of a table model after its common fields. */
function checkTable(object: Fields, path: string, dimensions: ReadonlyMap<string, ResponseDimension>, faults: Faults): void {
  check(object, "fallback", path, isNumber, "a finite number", faults);
  const table = tableDimensions(object, path, dimensions, faults);
  const conditional = table.filter((d) => d.when !== undefined).map((d) => d.id);
  need(JSON.stringify(object["conditional"] ?? []) === JSON.stringify(conditional), at(path, "conditional"), `this does not agree with the conditions of the dimensions of the table: ${shown(conditional)}.`, faults);
  const cells = Object.hasOwn(object, "cells") ? list(object["cells"], at(path, "cells"), 1, faults) : [];
  const seen = new Set<string>();
  cells.forEach((cell, i) => {
    const inside = `${at(path, "cells")}[${i}]`;
    const fieldsOfCell = fields(cell, inside, ["at", "value", "n"], [], faults);
    if (fieldsOfCell === undefined) return;
    check(fieldsOfCell, "value", inside, isNumber, "a finite number", faults);
    check(fieldsOfCell, "n", inside, (v) => Number.isSafeInteger(v) && (v as number) >= 1, "a whole number of 1 or more", faults);
    if (!Object.hasOwn(fieldsOfCell, "at")) return;
    const values = list(fieldsOfCell["at"], at(inside, "at"), 0, faults);
    need(values.length === table.length, at(inside, "at"), `this list has ${values.length} values, and the table has ${table.length} dimensions.`, faults);
    table.forEach((dimension, j) => {
      const absent = values[j] === null && dimension.when !== undefined;
      const fault = j < values.length && !absent ? valueFault(dimension, values[j]) : undefined;
      if (fault !== undefined) faults.push({ path: `${at(inside, "at")}[${j}]`, message: `${fault}.` });
    });
    const key = JSON.stringify(values);
    need(!seen.has(key), at(inside, "at"), `an earlier cell has the values ${shown(values)}.`, faults);
    seen.add(key);
  });
}

/** This function examines the list of models: one model for each measure. */
function checkModels(value: unknown, data: ResponseData, faults: Faults): void {
  const dimensions = new Map(data.dimensions.map((d) => [d.id, d]));
  const measures = new Set(data.measures.map((m) => m.id));
  const covered = new Set<string>();
  list(value, "models", 0, faults).forEach((item, i) => {
    const path = `models[${i}]`;
    const kind = peek(item, "kind");
    if (kind !== "ridge" && kind !== "table") {
      faults.push({ path: at(path, "kind"), message: `this is "ridge" or "table", not ${shown(kind)}.` });
      return;
    }
    const keys = kind === "ridge" ? ["lambda", "inputs", "intercept", "terms"] : ["dimensions", "cells", "fallback"];
    const object = fields(item, path, ["kind", "measure", "scale", ...keys], kind === "ridge" ? ["floor"] : ["floor", "conditional"], faults);
    if (object === undefined) return;
    const measure = object["measure"];
    if (typeof measure !== "string" || !measures.has(measure)) faults.push({ path: at(path, "measure"), message: `the record has no measure ${shown(measure)}.` });
    else {
      need(!covered.has(measure), at(path, "measure"), `an earlier model has the measure "${measure}".`, faults);
      covered.add(measure);
    }
    check(object, "scale", path, (v) => v === "linear" || v === "log", `"linear" or "log"`, faults);
    check(object, "floor", path, isPositive, "a finite number above 0", faults);
    need(!Object.hasOwn(object, "floor") || object["scale"] === "log", at(path, "floor"), "only a model with the scale log has a floor.", faults);
    if (kind === "ridge") checkRidge(object, path, dimensions, faults);
    else checkTable(object, path, dimensions, faults);
  });
  for (const measure of measures) need(covered.has(measure), "models", `no model has the measure "${measure}".`, faults);
}

/** This function examines the error of one measure in one fold. */
function checkFoldError(value: unknown, path: string, count: number, faults: Faults): void {
  const object = fields(value, path, ["n", "mae", "rmse", "baselineMae"], [], faults);
  if (object === undefined) return;
  check(object, "n", path, (v) => v === count, `${count}, the held-out points of the fold with a value of this measure`, faults);
  for (const key of ["mae", "rmse", "baselineMae"]) check(object, key, path, isNotNegative, "a finite number of 0 or more", faults);
}

/** This function examines the stored predictions of a fold against its held-out points and its errors. */
function checkPredictions(value: unknown, path: string, held: readonly ResponsePoint[], errors: unknown, measures: readonly string[], faults: Faults): void {
  const predictions = fields(value, path, [], measures, faults);
  if (predictions === undefined) return;
  for (const measure of measures) {
    if (!Object.hasOwn(predictions, measure)) continue;
    const inside = at(path, measure);
    const stored = fields(predictions[measure], inside, [], Object.keys(peek(predictions, measure) ?? {}), faults);
    if (stored === undefined) continue;
    need(peek(errors, measure) !== undefined, inside, "this fold has no error of this measure.", faults);
    const scored = new Set(held.filter((p) => typeof p.measures[measure] === "number").map((p) => p.id));
    for (const id of Object.keys(stored)) {
      need(scored.has(id), at(inside, id), `this fold has no held-out point ${shown(id)} with a value of the measure.`, faults);
      check(stored, id, inside, isNumber, "a finite number", faults);
    }
    for (const id of scored) need(Object.hasOwn(stored, id), at(inside, id), "this held-out point has no prediction.", faults);
  }
}

/** This function adds the points of a fold to `foldOfPoint`, and it gives them. Each bad id gives a fault. */
function heldPoints(value: unknown, path: string, f: number, points: ReadonlyMap<string, ResponsePoint>, foldOfPoint: Map<string, number>, faults: Faults): readonly ResponsePoint[] {
  const held: ResponsePoint[] = [];
  list(value, path, 1, faults).forEach((id, i) => {
    const inside = `${path}[${i}]`;
    const point = points.get(id as string);
    const earlier = foldOfPoint.get(id as string);
    if (point === undefined) faults.push({ path: inside, message: `the record has no point ${shown(id)}.` });
    else if (earlier !== undefined) faults.push({ path: inside, message: `the point "${point.id}" is also in fold ${earlier}.` });
    else {
      foldOfPoint.set(point.id, f);
      held.push(point);
    }
  });
  return held;
}

/** This function gives the number of points of each group in a list. */
function groupSizes(points: readonly ResponsePoint[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const p of points) sizes.set(groupKey(p), (sizes.get(groupKey(p)) ?? 0) + 1);
  return sizes;
}

/** This function examines the list of folds. `parseResponseRecord` tells the rules. */
function checkFolds(value: unknown, data: ResponseData, faults: Faults): void {
  const points = new Map(data.points.map((p) => [p.id, p]));
  const measures = data.measures.map((m) => m.id);
  const sizes = groupSizes(data.points);
  const foldOfPoint = new Map<string, number>();
  const covered = new Set<string>();
  const folds = list(value, "folds", 1, faults);
  const predicted = measures.filter((m) => folds.some((fold) => peek(peek(fold, "predictions"), m) !== undefined));
  folds.forEach((item, f) => {
    const path = `folds[${f}]`;
    const object = fields(item, path, ["heldOut", "errors"], ["predictions"], faults);
    if (object === undefined) return;
    const held = Object.hasOwn(object, "heldOut") ? heldPoints(object["heldOut"], at(path, "heldOut"), f, points, foldOfPoint, faults) : [];
    for (const [group, count] of groupSizes(held)) {
      const size = sizes.get(group) as number;
      need(count === size, at(path, "heldOut"), `the ${group} has ${count} of its ${size} points in this fold, so it is on both sides of the split.`, faults);
    }
    if (Object.hasOwn(object, "predictions")) checkPredictions(object["predictions"], at(path, "predictions"), held, object["errors"], measures, faults);
    if (!Object.hasOwn(object, "errors")) return;
    const errors = fields(object["errors"], at(path, "errors"), [], measures, faults);
    if (errors === undefined) return;
    for (const measure of measures) {
      if (!Object.hasOwn(errors, measure)) continue;
      const count = held.filter((p) => p.measures[measure] !== null).length;
      checkFoldError(errors[measure], at(at(path, "errors"), measure), count, faults);
      if (count > 0) covered.add(measure);
      need(!predicted.includes(measure) || peek(object["predictions"], measure) !== undefined, at(path, "predictions"), `another fold has predictions of the measure "${measure}", so this fold needs them too.`, faults);
    }
  });
  for (const measure of measures) need(covered.has(measure), "folds", `no fold has a held-out error of the measure "${measure}".`, faults);
}

/**
 * This function examines unknown data, for example the result of `JSON.parse`, against `response-records/1`. It gives
 * `{ ok: true, record }`, with the same object as the record, or `{ ok: false, faults }`. Each fault has the path of
 * the bad field and a message. The function does not throw. Data that the checks cannot read, for example an object
 * with a loop, gives one fault.
 *
 * A field that the format does not have is a fault. Thus a wrong spelling of an optional field cannot go unseen.
 *
 * The function examines the models and the folds only when the data has no fault, because they refer to the data.
 * Thus a correction of the data can show more faults. These rules apply to the folds:
 * - A point is in one fold or in no fold.
 * - All the points of a group are in one fold, or all are in no fold. Thus no group is on both sides of a split.
 * - The count `n` of an error is the number of held-out points with a value of the measure.
 * - Each measure has an error in one fold or more.
 *
 * These rules apply to the predictions of a fold:
 * - Each prediction is a finite number of a held-out point of the fold with a value of the measure.
 * - The fold has a prediction of each such point, and an error of the measure.
 * - When one fold has predictions of a measure, each fold with an error of the measure has them.
 *
 * These rules apply to the reasons of a point:
 * - Each reason is on a known measure with no number. A measure with `null` and no reason is good.
 * - Each reason has a declaration in the field `reasons` of the record.
 */
export function parseResponseRecord(value: unknown): ParsedResponseRecord {
  try {
    const faults: Faults = [...responseDataFaults(value, ["models", "folds"], [])];
    if (faults.length === 0) {
      const record = value as ResponseRecord;
      checkModels(record.models, record, faults);
      checkFolds(record.folds, record, faults);
      if (faults.length === 0) return { ok: true, record };
    }
    return { ok: false, faults };
  } catch (error) {
    return { ok: false, faults: [{ path: "", message: `the validator cannot read this data: ${String(error)}.` }] };
  }
}
