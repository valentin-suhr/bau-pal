import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queue = JSON.parse(await readFile(new URL("../data/qa/bplan-zone-review-queue.json", import.meta.url), "utf8"));
const dispositions = JSON.parse(await readFile(new URL("../data/qa/bplan-manual-review-dispositions.json", import.meta.url), "utf8"));

test("routes only one-parcel plans to visual single-zone review", () => {
  const candidates = queue.rows.filter((row) => row.review_route === "priority_visual_single_zone_review");
  assert.ok(candidates.every((row) => row.controlling_parcels === 1 && row.near_total_parcels === 1));
});

test("retains every manual B-Plan review disposition in the generated queue", () => {
  assert.equal(queue.manualDispositionCount, dispositions.dispositions.length);
  for (const disposition of dispositions.dispositions) {
    const row = queue.rows.find((candidate) => candidate.plan_key === disposition.planKey);
    assert.ok(row, `missing reviewed plan ${disposition.planKey}`);
    assert.equal(row.review_route, disposition.route);
    assert.equal(row.manual_review.source_pdf, disposition.sourcePdf);
    assert.equal(row.manual_review.reason, disposition.reason);
  }
});

test("queue summary exactly reconciles to its plan rows", () => {
  const recomputed = queue.rows.reduce((summary, row) => {
    summary[row.review_route] = (summary[row.review_route] ?? 0) + 1;
    return summary;
  }, {});
  assert.deepEqual(queue.summary, recomputed);
  assert.equal(queue.planCount, queue.rows.length);
});

test("routes I-56 to partial georeferencing after its invalid extent is reconstructed", () => {
  const row = queue.rows.find((candidate) => candidate.plan_key === "I-56");
  assert.equal(row?.review_route, "partially_georeferenced");
  assert.match(row?.manual_review?.reason ?? "", /parcels 563 and 564/);
});

test("does not call a plan resolved when only some constraint families are georeferenced", () => {
  for (const planKey of ["I-203", "I-8"]) {
    const row = queue.rows.find((candidate) => candidate.plan_key === planKey);
    assert.equal(row?.review_route, "partially_georeferenced");
  }
});
