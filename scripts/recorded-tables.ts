// This script rebuilds the numbers of `packages/generators/src/recorded.ts` from the two sources, and prints them as JSON.
//
//   git clone https://github.com/eclipse-elk/elk-models.git elk
//   git -C elk checkout ac5af2ba511c0037e4f347e8bd91f013950951c7
//   gh api 'repos/microsoft/vscode/git/trees/aace354316214ca620b7c809a3da1ed59bf942dd?recursive=1' > tree.json
//   node scripts/recorded-tables.ts elk tree.json
//
// The script does not fetch a source, so the two reads stay at the commits of the tables.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ElkNode {
  readonly width?: number;
  readonly height?: number;
  readonly children?: readonly ElkNode[];
}

interface TreeEntry {
  readonly type: string;
  readonly size?: number;
}

/** This function adds the area of each box under a node. A box has a width and a height. A graph root has no box. */
function addAreas(node: ElkNode, areas: number[]): void {
  for (const child of node.children ?? []) {
    if (child.width !== undefined && child.height !== undefined) areas.push(child.width * child.height);
    addAreas(child, areas);
  }
}

/** This function gives the 100 midpoint quantiles of the values. */
function midpoints(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: 100 }, (_, i) => Math.round(sorted[Math.floor((sorted.length * (i + 0.5)) / 100)]!));
}

/** This function gives the median of the values. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const [elk, treeFile] = process.argv.slice(2);
if (elk === undefined || treeFile === undefined) throw new RangeError("Give the folder of elk-models and the file of the git tree.");

const flattened = join(elk, "realworld", "ptolemy", "flattened");
const areas: number[] = [];
for (const file of readdirSync(flattened).filter((name) => name.endsWith(".json"))) {
  addAreas(JSON.parse(readFileSync(join(flattened, file), "utf8")) as ElkNode, areas);
}

const tree = JSON.parse(readFileSync(treeFile, "utf8")) as { readonly tree: readonly TreeEntry[] };
const sizes = tree.tree.flatMap((entry) => (entry.type === "blob" && (entry.size ?? 0) > 0 ? [entry.size ?? 0] : []));

const table = (values: readonly number[]): object => ({ count: values.length, median: medianOf(values), quantiles: midpoints(values) });
console.log(JSON.stringify({ "diagram-box-area": table(areas), "git-blob-bytes": table(sizes) }, null, 2));
