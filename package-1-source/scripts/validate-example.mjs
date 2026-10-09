import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateMission } from "../shared/dist/validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "../shared/schemas/mission.v1.schema.json");
const examplePath = path.resolve(here, "../shared/schemas/mission.v1.example.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const example = JSON.parse(await readFile(examplePath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaValidator = ajv.compile(schema);
const schemaOk = schemaValidator(example);
const runtime = validateMission(example);
if (!schemaOk || !runtime.ok) {
  console.error("Mission v1 example failed validation.");
  if (!schemaOk) console.error("JSON Schema:", schemaValidator.errors);
  if (!runtime.ok) console.error("Runtime validator:", runtime.issues);
  process.exitCode = 1;
} else {
  console.log("Mission v1 example passes JSON Schema and runtime validation.");
}
