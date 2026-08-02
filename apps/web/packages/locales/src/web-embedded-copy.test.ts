import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import enUS from "./en-US.json";
import esUS from "./es-US.json";
import frFR from "./fr-FR.json";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const embeddedDirectory = sourceDirectory.includes(`${path.sep}apps${path.sep}web${path.sep}`)
  ? sourceDirectory
  : path.resolve(sourceDirectory, "../../../apps/web/packages/locales/src");

function readEmbeddedLocale(fileName: string) {
  return JSON.parse(
    readFileSync(path.join(embeddedDirectory, fileName), "utf8"),
  ) as unknown;
}

describe("web embedded locale package", () => {
  it("stays synchronized with the shared locale source", () => {
    expect(readEmbeddedLocale("fr-FR.json")).toEqual(frFR);
    expect(readEmbeddedLocale("en-US.json")).toEqual(enUS);
    expect(readEmbeddedLocale("es-US.json")).toEqual(esUS);
  });
});
