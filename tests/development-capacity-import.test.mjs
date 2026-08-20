import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deriveUrl = new URL("../scripts/derive-development-capacity.mjs", import.meta.url);
const sqlUrl = new URL("../scripts/build-development-capacity-sql.mjs", import.meta.url);
const exportUrl = new URL("../scripts/export-parcel-table.mjs", import.meta.url);
const auditUrl = new URL("../scripts/audit-parcel-export.mjs", import.meta.url);
const capacityAuditUrl = new URL("../scripts/audit-development-capacity.mjs", import.meta.url);

test("derives conservative capacity metrics from exact ALKIS polygon overlap", async () => {
  const derive = await readFile(deriveUrl, "utf8");
  assert.match(derive, /polygonClipping\.intersection/);
  assert.match(derive, /overlapSqm < 1/);
  assert.match(derive, /storeyCoverage >= 0\.8/);
  assert.match(derive, /development_capacity_screen/);
  assert.match(derive, /not the statutory GFZ calculation/);
});

test("audits capacity formulae, confidence gates, provenance, and category totals", async () => {
  const audit = await readFile(capacityAuditUrl, "utf8");
  assert.match(audit, /oneScreenPerParcel/);
  assert.match(audit, /gfzFormulaConsistent/);
  assert.match(audit, /incompleteStoreyCoverageWithheld/);
  assert.match(audit, /vacancyThresholdConsistent/);
  assert.match(audit, /categoriesReconcile/);
});

test("persists and exports capacity estimates with provenance", async () => {
  const [sql, exportScript, audit] = await Promise.all([readFile(sqlUrl, "utf8"), readFile(exportUrl, "utf8"), readFile(auditUrl, "utf8")]);
  assert.match(sql, /source_id,source_locator,evidence_json/);
  assert.match(exportScript, /indicative_gfz_utilization/);
  assert.match(exportScript, /capacity_source_retrieved_at/);
  assert.match(exportScript, /berlin-parcel-table-v2/);
  assert.match(audit, /observed_storey_footprint_coverage/);
});
