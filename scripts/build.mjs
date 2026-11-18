import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
const assets = {};
for (const [path, file, type] of [
  ["/", "index.html", "text/html"],
  ["/app.js", "app.js", "text/javascript"],
  ["/style.css", "style.css", "text/css"],
]) {
  assets[path] = [type, await readFile("web/" + file, "utf8")];
}
const server = (
  await Promise.all(
    ["provider", "api", "entry"].map((name) =>
      readFile("server/" + name + ".js", "utf8"),
    ),
  )
).join("\n");
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile(
  "dist/server/index.js",
  "const assets=" + JSON.stringify(assets) + ";\n" + server,
);
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
