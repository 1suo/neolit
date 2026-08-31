import { readFileSync, writeFileSync } from "node:fs";
import { renderSolutionRoleMermaid } from "../src/solution-lod/roles.js";

const file = new URL("../src/solution-lod/README.md", import.meta.url);
const start = "<!-- BEGIN GENERATED SOLUTION ROLE GRAPH -->";
const end = "<!-- END GENERATED SOLUTION ROLE GRAPH -->";
const current = readFileSync(file, "utf8");
const generated = `${start}\n\`\`\`mermaid\n${renderSolutionRoleMermaid()}\n\`\`\`\n${end}`;
const next = current.replace(new RegExp(`${start}[\\s\\S]*?${end}`), generated);

if (next === current && !current.includes(generated)) throw new Error("src/solution-lod/README.md has no generated solution role graph block");
if (process.argv.includes("--check")) {
  if (current !== next) throw new Error("src/solution-lod/README.md solution role graph is stale; run npm run graph:write");
} else {
  writeFileSync(file, next);
}
