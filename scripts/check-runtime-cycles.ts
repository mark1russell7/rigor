// This script is the gate of the runtime graph of the workspace packages. The graph has an edge for each entry of
// dependencies, peerDependencies and optionalDependencies that names a workspace package. Dev edges do not count.
// The gate fails when the graph has a cycle, and it names each cycle as a path of packages.
//
//   node scripts/check-runtime-cycles.ts
//
// The tests of generators and statistics use rigor-testkit (dev edges), and testkit depends on chaos. Thus pnpm finds a
// cycle, and pnpm-workspace.yaml sets ignoreWorkspaceCycles. After that setting, this gate is the only check of the
// runtime graph. The end of this script: a rule of @mark1russell7/conventions over the runtime graph
// (mark1russell7/template#364). Then the rule replaces this script.
//
// The check also takes a copy of the graph with an injected edge, the reverse of a real runtime edge. That copy must have
// a cycle, so a check that cannot fail ends with an error.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stronglyConnectedComponents } from "@mark1russell7/collections/graph";

type Graph = ReadonlyMap<string, readonly string[]>;

const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** This function gives the folders of the workspace packages, from the globs of pnpm-workspace.yaml. */
function packageFolders(root: string): string[] {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "packages:");
  if (start < 0) throw new Error("pnpm-workspace.yaml has no list packages.");
  const folders: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+["']?([^"']+)["']?\s*$/.exec(line);
    if (item === null) break;
    const glob = item[1] as string;
    if (glob.endsWith("/*")) {
      const parent = join(root, glob.slice(0, -2));
      for (const entry of readdirSync(parent, { withFileTypes: true })) if (entry.isDirectory()) folders.push(join(parent, entry.name));
    } else if (!glob.includes("*")) {
      folders.push(join(root, glob));
    } else {
      throw new Error(`This script reads only globs of the form <folder>/* and plain folders, not ${glob}.`);
    }
  }
  return folders.filter((folder) => existsSync(join(folder, "package.json")));
}

/** This function gives the runtime graph of the workspace packages: each package and the workspace packages it uses. */
function runtimeGraph(root: string): Graph {
  const manifests = packageFolders(root).map((folder) => JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as Record<string, unknown>);
  const names = new Set(manifests.map((manifest) => String(manifest.name)));
  const graph = new Map<string, string[]>();
  for (const manifest of manifests) {
    const targets = new Set<string>();
    for (const field of RUNTIME_FIELDS) {
      const entries = manifest[field];
      if (entries === null || typeof entries !== "object") continue;
      for (const name of Object.keys(entries)) if (names.has(name)) targets.add(name);
    }
    graph.set(String(manifest.name), [...targets].sort());
  }
  return new Map([...graph].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** This function gives one cycle of each strongly connected component with a cycle, as a path that ends at its start. */
function cycles(graph: Graph): string[][] {
  const successors = (name: string): readonly string[] => graph.get(name) ?? [];
  const out: string[][] = [];
  for (const component of stronglyConnectedComponents(graph.keys(), successors)) {
    const start = component[0] as string;
    if (component.length === 1 && !successors(start).includes(start)) continue;
    // The shortest way back to the start, inside the component
    const inside = new Set(component);
    const previous = new Map<string, string>();
    const queue = [start];
    let end: string | undefined;
    for (let index = 0; index < queue.length && end === undefined; index += 1) {
      const node = queue[index] as string;
      for (const next of successors(node)) {
        if (!inside.has(next)) continue;
        if (next === start) {
          end = node;
          break;
        }
        if (!previous.has(next)) {
          previous.set(next, node);
          queue.push(next);
        }
      }
    }
    const path = [start];
    for (let node = end; node !== undefined && node !== start; node = previous.get(node)) path.splice(1, 0, node);
    out.push([...path, start]);
  }
  return out;
}

const root = process.cwd();
const graph = runtimeGraph(root);
const edges = [...graph].flatMap(([from, targets]) => targets.map((to) => [from, to] as const));
const found = cycles(graph);
console.log(`The runtime graph has ${graph.size} packages, ${edges.length} edges and ${found.length} cycles.`);
for (const path of found) console.log(`A runtime cycle: ${path.join(" -> ")}`);

let canFail = true;
const first = edges[0];
if (first === undefined) {
  console.log("The runtime graph has no edge, so the copy with an injected edge is not possible.");
} else {
  const [from, to] = first;
  const copy = new Map(graph);
  copy.set(to, [...(graph.get(to) ?? []), from]);
  const injected = cycles(copy);
  console.log(`The copy with the injected edge ${to} -> ${from}: ${injected.map((path) => path.join(" -> ")).join(", ") || "no cycle"}.`);
  if (injected.length === 0) {
    console.log("The copy with the injected edge has no cycle, so this check cannot fail.");
    canFail = false;
  }
}
process.exitCode = found.length === 0 && canFail ? 0 : 1;
