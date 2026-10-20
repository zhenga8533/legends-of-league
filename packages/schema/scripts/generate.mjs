import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const schemaUrl = new URL("../json/canonical.schema.json", import.meta.url);
const outUrl = new URL("../src/generated.ts", import.meta.url);

const schema = JSON.parse(await readFile(schemaUrl, "utf8"));

const ts = await compile(schema, schema.title, {
  bannerComment:
    "/* Generated from ingest/src/lol_ingest/models by `pnpm schema:gen`. Do not edit by hand. */",
  // The root schema only holds $defs, so every definition is "unreachable" from it.
  unreachableDefinitions: true,
  additionalProperties: false,
});

await writeFile(outUrl, ts);
console.log(`Wrote ${fileURLToPath(outUrl)}`);
