#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

const LAND_USES = [
  ["reines wohngebiet", "WR"],
  ["allgemeines wohngebiet", "WA"],
  ["besonderes wohngebiet", "WB"],
  ["kleinsiedlungsgebiet", "WS"],
  ["dörfliches wohngebiet", "MDW"],
  ["dorfgebiet", "MD"],
  ["mischgebiet", "MI"],
  ["urbanes gebiet", "MU"],
  ["kerngebiet", "MK"],
  ["gewerbegebiet", "GE"],
  ["industriegebiet", "GI"],
  ["sondergebiet", "SO"],
  ["gemeinbedarf", "GEMEINBEDARF"],
  ["grünfläche", "GRUENFLAECHE"],
  ["verkehrsfläche", "VERKEHRSFLAECHE"],
];

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function usesFromSummary(summary) {
  const normalized = String(summary ?? "").toLocaleLowerCase("de-DE");
  return LAND_USES.filter(([label]) => normalized.includes(label)).map(([label, code]) => ({ label, code }));
}

async function main() {
  const input = resolve(option("input", "data/import/bplans-fixed.ndjson"));
  const output = resolve(option("output", "data/import/bplan-wfs-rules.ndjson"));
  await mkdir(dirname(output), { recursive: true });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let plans = 0;
  let rules = 0;
  let withoutClassifiedUse = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const plan = JSON.parse(line);
    plans += 1;
    const uses = usesFromSummary(plan.contents);
    if (!uses.length) withoutClassifiedUse += 1;
    for (const use of uses) {
      writer.write(`${JSON.stringify({
        planKey: plan.planKey,
        zoneKey: null,
        applicability: "document_summary",
        ruleType: "land_use",
        numericValue: null,
        textValue: use.code,
        interpretation: `The WFS summary states that the plan contains ${use.label}; it does not prove that this use applies to every parcel in the plan scope.`,
        extractionMethod: "official_structured",
        confidence: "official",
        reviewStatus: "machine_checked",
        sourceKey: "berlin-bplan-wfs",
        sourceLocator: `feature ${plan.sourceFeatureId ?? plan.officialPlanId ?? plan.planKey}; field inhalt`,
      })}\n`);
      rules += 1;
    }
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`${JSON.stringify({ plans, rules, withoutClassifiedUse })}\nWrote document-summary rules to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
