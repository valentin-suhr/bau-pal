import fs from "node:fs";
import path from "node:path";
import polygonClipping from "polygon-clipping";

const root = process.cwd();
const exportDir = path.join(root, "data", "exports");
const qaDir = path.join(root, "data", "qa");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...values] = rows.filter((candidate) => candidate.length > 1);
  return values.map((candidate) =>
    Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])),
  );
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function readNdjson(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function cleanTargetPlanKey(relation) {
  const parenthetical = relation.raw?.match(/\(([^)]+)\)/)?.[1];
  return parenthetical ?? relation.targetPlanKey ?? "";
}

function polygonCoordinates(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function intersects(leftGeometry, rightGeometry) {
  try {
    return polygonClipping.intersection(
      polygonCoordinates(leftGeometry),
      polygonCoordinates(rightGeometry),
    ).length > 0;
  } catch {
    return false;
  }
}

const allRelevant = parseCsv(
  fs.readFileSync(path.join(exportDir, "lichterfelde-all-relevant-bplans.csv"), "utf8"),
);
const enactedMetrics = parseCsv(
  fs.readFileSync(path.join(exportDir, "lichterfelde-relevant-bplans.csv"), "utf8"),
);
const fixed = readNdjson(path.join(root, "data", "import", "bplans-fixed.ndjson"));
const repealed = readNdjson(path.join(root, "data", "import", "bplans-repealed.ndjson"));
const lichterfelde = readNdjson(path.join(root, "data", "import", "ortsteile.ndjson")).find(
  (locality) => locality.name === "Lichterfelde",
);
const manual = JSON.parse(
  fs.readFileSync(path.join(qaDir, "bplan-manual-review-dispositions.json"), "utf8"),
).dispositions;

const relevantEnactedKeys = new Set(
  allRelevant.filter((plan) => plan.status === "in_force").map((plan) => plan.planKey),
);
const pending = allRelevant.filter((plan) => plan.status === "in_process");
const metricByKey = new Map(enactedMetrics.map((plan) => [plan.plan_key, plan]));
const manualByKey = new Map(manual.map((item) => [item.planKey, item]));

const enactedClassifications = fixed
  .filter((plan) => relevantEnactedKeys.has(plan.planKey))
  .map((plan) => {
    const metric = metricByKey.get(plan.planKey);
    const disposition = manualByKey.get(plan.planKey);
    const successors = plan.relations
      .filter((relation) => relation.direction === "target_to_current")
      .map(cleanTargetPlanKey)
      .filter(Boolean);

    let validityClass = "up_to_date_in_force";
    let validityBasis = "Berlin WFS: In Kraft getreten; no successor or invalidity flag in the local evidence set.";
    let legalReviewRequired = 0;

    if (plan.planKey === "I-56" && disposition?.reason.includes("invalidated")) {
      validityClass = "partially_invalid_still_in_force";
      validityBasis = disposition.reason;
      legalReviewRequired = 1;
    } else if (plan.legalStatus === "Teilweise untergegangen" || successors.length > 0) {
      validityClass = "partially_outdated_still_in_force";
      validityBasis =
        plan.legalStatus === "Teilweise untergegangen"
          ? `Berlin WFS: Teilweise untergegangen${successors.length ? `; successor plan(s): ${successors.join(" | ")}` : ""}.`
          : `Berlin WFS successor relation: partially replaced by ${successors.join(" | ")}; remaining scope is still listed as in force.`;
    }

    const controllingParcels = Number(metric?.controlling_parcels ?? 0);
    const operationalFlag = controllingParcels === 0 ? "no_controlling_parcel_assigned" : "controls_current_parcels";

    return {
      plan_key: plan.planKey,
      title: plan.title,
      validity_class: validityClass,
      official_legal_status: plan.legalStatus,
      successor_plans: successors.join(" | "),
      effective_from: metric?.effective_from ?? plan.effectiveFrom ?? "",
      plan_type: plan.planType,
      intersecting_parcels: metric?.intersecting_parcels ?? "",
      controlling_parcels: metric?.controlling_parcels ?? "",
      operational_assignment: operationalFlag,
      legal_review_required: legalReviewRequired,
      validity_basis: validityBasis,
      plan_sheet_url: plan.scanUrl ?? metric?.plan_sheet_url ?? "",
      source_feature_id: plan.sourceFeatureId,
      source_timestamp: plan.sourceTimestamp,
    };
  });

const lichterfeldeGeometry = JSON.parse(lichterfelde.geometryGeojson);
const repealedIntersecting = repealed
  .filter((plan) => intersects(JSON.parse(plan.geometryGeojson), lichterfeldeGeometry))
  .map((plan) => ({
    plan_key: plan.planKey,
    title: plan.title,
    validity_class: "outdated_repealed",
    official_legal_status: plan.legalStatus,
    successor_plans: plan.relations
      .filter((relation) => relation.direction === "target_to_current")
      .map(cleanTargetPlanKey)
      .filter(Boolean)
      .join(" | "),
    effective_from: plan.effectiveFrom ?? "",
    plan_type: plan.planType,
    intersecting_parcels: "",
    controlling_parcels: 0,
    operational_assignment: "excluded_repealed",
    legal_review_required: 0,
    validity_basis: "Berlin WFS: Außer Kraft/untergegangen. Excluded from the controlling-plan queue.",
    plan_sheet_url: plan.scanUrl ?? "",
    source_feature_id: plan.sourceFeatureId,
    source_timestamp: plan.sourceTimestamp,
  }));

const classifications = [...enactedClassifications, ...repealedIntersecting];

const order = new Map([
  ["outdated_repealed", 0],
  ["partially_invalid_still_in_force", 1],
  ["partially_outdated_still_in_force", 2],
  ["up_to_date_in_force", 3],
]);
const planCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
classifications.sort(
  (left, right) =>
    order.get(left.validity_class) - order.get(right.validity_class) ||
    planCollator.compare(left.plan_key, right.plan_key),
);

const columns = [
  "plan_key",
  "title",
  "validity_class",
  "official_legal_status",
  "successor_plans",
  "effective_from",
  "plan_type",
  "intersecting_parcels",
  "controlling_parcels",
  "operational_assignment",
  "legal_review_required",
  "validity_basis",
  "plan_sheet_url",
  "source_feature_id",
  "source_timestamp",
];

writeCsv(path.join(exportDir, "lichterfelde-bplans-by-validity.csv"), classifications, columns);

writeCsv(
  path.join(qaDir, "lichterfelde-bplans-excluded-pending.csv"),
  pending.sort((left, right) => planCollator.compare(left.planKey, right.planKey)),
  [
    "planKey",
    "title",
    "status",
    "planType",
    "borough",
    "scopeDescription",
    "sourceFeatureId",
    "sourceTimestamp",
  ],
);

const classCounts = Object.fromEntries(
  [...order.keys()].map((validityClass) => [
    validityClass,
    classifications.filter((plan) => plan.validity_class === validityClass).length,
  ]),
);
const summary = {
  schemaVersion: "lichterfelde-bplan-validity-v1",
  generatedAt: new Date().toISOString(),
  locality: "Lichterfelde",
  intendedUse: "MVP processing queue; not a substitute for a parcel-specific planning-law opinion",
  classificationRule: {
    upToDate: "Official Berlin WFS status is in force and no partial-supersession or invalidity evidence is present in the local evidence set.",
    partiallyOutdated: "The plan remains in the official fixed-plan layer, but Berlin marks it partially obsolete or provides a successor relation.",
    partiallyInvalid: "A court decision or reviewed legal evidence invalidates a defined portion while another portion remains effective.",
    fullyOutdated: "Official repealed/undergegangen geometry intersects Lichterfelde; these records are excluded from the controlling-plan queue.",
    pending: "Official status is Im Verfahren. Excluded from the enacted-plan working list.",
  },
  counts: {
    enactedIncluded: enactedClassifications.length,
    ...classCounts,
    fully_outdated_repealed_intersecting: repealedIntersecting.length,
    pending_excluded: pending.length,
    no_controlling_parcel_assigned: enactedClassifications.filter(
      (plan) => plan.operational_assignment === "no_controlling_parcel_assigned",
    ).length,
  },
  sourceSnapshot: {
    source: "Berlin Bebauungsplanverfahren WFS plus local reviewed legal dispositions",
    latestFeatureTimestamp: classifications
      .map((plan) => plan.source_timestamp)
      .filter(Boolean)
      .sort()
      .at(-1),
  },
  caveats: [
    "Plan age is not a validity test: an older plan can remain legally binding.",
    "A partially superseded plan remains relevant for its surviving spatial extent and must not be dropped wholesale.",
    "The operational-assignment flag describes the current parcel-processing model; it does not itself revoke a plan.",
    "The WFS often omits effective dates, so the export is sorted by legal validity class and plan key rather than enactment age.",
  ],
};
fs.writeFileSync(
  path.join(qaDir, "lichterfelde-bplan-validity-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log(JSON.stringify(summary.counts, null, 2));
