import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  if (!env.DB) return Response.json({ error: "Parcel database is not configured" }, { status: 503 });
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    return Response.json({ error: "Invalid parcel identifier" }, { status: 400 });
  }

  try {
    const parcel = await env.DB.prepare(`
      SELECT id, cadastral_district AS cadastralDistrict, flur, numerator,
        denominator, borough, area_sqm AS areaSqm
      FROM parcels WHERE id = ?
    `).bind(id).first();
    if (!parcel) return Response.json({ error: "Parcel not found" }, { status: 404 });

    const candidates = await env.DB.prepare(`
      SELECT s.id AS segmentId, d.plan_key AS planKey, d.title, d.plan_type AS planType,
        d.status, d.effective_from AS effectiveFrom, d.notes AS planMetadata,
        z.zone_key AS zoneKey, z.label AS zoneLabel, z.geometry_method AS geometryMethod,
        zr.rms_residual_m AS geometryRmsResidualM, zr.max_residual_m AS geometryMaxResidualM,
        zr.review_status AS geometryReviewStatus,
        dzr.scope_partition_complete AS scopePartitionComplete,
        dzr.land_use_complete AS landUseComplete, dzr.density_complete AS densityComplete,
        dzr.height_complete AS heightComplete, dzr.building_form_complete AS buildingFormComplete,
        dzr.other_constraints_complete AS otherConstraintsComplete,
        dzr.notes_json AS zoneReviewNotesJson, s.legal_regime AS legalRegime,
        s.coverage_ratio AS coverageRatio, s.intersection_area_sqm AS intersectionAreaSqm,
        s.precedence_rank AS precedenceRank, s.is_controlling AS isControlling,
        s.assignment_method AS assignmentMethod, s.confidence,
        so.title AS sourceTitle, so.url AS sourceUrl,
        so.retrieved_at AS sourceRetrievedAt
      FROM parcel_planning_segments s
      JOIN planning_documents d ON d.id = s.document_id
      JOIN planning_zones z ON z.id = s.zone_id
      LEFT JOIN planning_zone_geometry_reviews zr ON zr.zone_id = z.id
      LEFT JOIN planning_document_zone_reviews dzr ON dzr.document_id = d.id
      LEFT JOIN sources so ON so.id = d.source_id
      WHERE s.parcel_id = ?
      ORDER BY s.is_controlling DESC, s.precedence_rank DESC, s.coverage_ratio DESC, d.plan_key
    `).bind(id).all();

    const rules = await env.DB.prepare(`
      SELECT DISTINCT d.plan_key AS planKey, z.zone_key AS zoneKey, r.rule_type AS ruleType,
        r.numeric_value AS numericValue, r.text_value AS textValue, r.unit,
        r.legal_citation AS legalCitation, r.interpretation,
        r.extraction_method AS extractionMethod, r.confidence,
        r.review_status AS reviewStatus, r.source_locator AS sourceLocator,
        so.title AS sourceTitle, so.url AS sourceUrl, so.retrieved_at AS sourceRetrievedAt
      FROM parcel_planning_segments s
      JOIN planning_documents d ON d.id = s.document_id
      JOIN planning_zones z ON z.id = s.zone_id
      JOIN planning_rules r ON r.document_id = d.id AND (r.zone_id IS NULL OR r.zone_id = z.id)
      LEFT JOIN sources so ON so.id = r.source_id
      WHERE s.parcel_id = ?
      ORDER BY d.plan_key, r.rule_type, r.id
    `).bind(id).all();

    const observations = await env.DB.prepare(`
      SELECT o.observation_type AS observationType, o.numeric_value AS numericValue,
        o.text_value AS textValue, o.extraction_method AS extractionMethod,
        o.confidence, o.review_status AS reviewStatus, o.source_locator AS sourceLocator,
        o.evidence_json AS evidenceJson, d.plan_key AS planKey,
        so.title AS sourceTitle, so.url AS sourceUrl, so.retrieved_at AS sourceRetrievedAt
      FROM parcel_planning_observations o
      LEFT JOIN planning_documents d ON d.id = o.document_id
      LEFT JOIN sources so ON so.id = o.source_id
      WHERE o.parcel_id = ?
      ORDER BY o.observation_type, o.confidence, o.id
    `).bind(id).all();

    const planningLines = await env.DB.prepare(`
      SELECT l.official_id AS officialId, l.line_type AS lineType,
        l.official_line_type AS officialLineType, l.approval_kind AS approvalKind,
        l.approval_date AS approvalDate, l.approval_date_end AS approvalDateEnd,
        l.borough, l.geometry_geojson AS geometryGeojson,
        p.relation, p.distance_m AS distanceM, p.assignment_method AS assignmentMethod,
        p.confidence, l.source_updated_at AS sourceUpdatedAt,
        so.title AS sourceTitle, so.url AS sourceUrl, so.retrieved_at AS sourceRetrievedAt
      FROM parcel_planning_lines p
      JOIN planning_line_features l ON l.id = p.line_id
      LEFT JOIN sources so ON so.id = l.source_id
      WHERE p.parcel_id = ?
      ORDER BY l.line_type, p.distance_m, l.official_id
    `).bind(id).all();

    const jurisdiction = await env.DB.prepare(`
      SELECT j.locality, j.historical_sector AS historicalSector,
        j.workflow, j.reason, j.assignment_method AS assignmentMethod,
        j.confidence, j.source_locator AS sourceLocator,
        j.evidence_json AS evidenceJson, j.reviewed_at AS reviewedAt,
        j.updated_at AS updatedAt, so.title AS sourceTitle,
        so.url AS sourceUrl, so.retrieved_at AS sourceRetrievedAt
      FROM parcel_jurisdiction_contexts j
      LEFT JOIN sources so ON so.id = j.source_id
      WHERE j.parcel_id = ?
    `).bind(id).first<Record<string, unknown>>();

    const assets = await env.DB.prepare(`
      SELECT DISTINCT d.plan_key AS planKey, a.asset_type AS assetType,
        a.url, a.mime_type AS mimeType, a.content_hash_sha256 AS contentHashSha256,
        a.byte_size AS byteSize, a.page_count AS pageCount,
        a.source_modified_at AS sourceModifiedAt, a.retrieved_at AS retrievedAt,
        a.retrieval_status AS retrievalStatus, a.ocr_status AS ocrStatus,
        a.extraction_status AS extractionStatus, a.extraction_version AS extractionVersion,
        a.error, a.metadata_json AS metadataJson, a.updated_at AS statusUpdatedAt
      FROM parcel_planning_segments s
      JOIN planning_documents d ON d.id = s.document_id
      JOIN planning_document_assets a ON a.document_id = d.id
      WHERE s.parcel_id = ?
      ORDER BY d.plan_key, a.asset_type, a.url
    `).bind(id).all();

    return Response.json({
      parcel,
      jurisdiction: jurisdiction ? {
        ...jurisdiction,
        evidence: jurisdiction.evidenceJson ? JSON.parse(String(jurisdiction.evidenceJson)) : {},
        evidenceJson: undefined,
      } : null,
      planningCandidates: (candidates.results ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        zoneReviewNotes: row.zoneReviewNotesJson ? JSON.parse(String(row.zoneReviewNotesJson)) : {},
        zoneReviewNotesJson: undefined,
      })),
      rules: rules.results ?? [],
      observations: (observations.results ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        evidence: row.evidenceJson ? JSON.parse(String(row.evidenceJson)) : {},
        evidenceJson: undefined,
      })),
      planningLines: (planningLines.results ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        geometry: row.geometryGeojson ? JSON.parse(String(row.geometryGeojson)) : null,
        geometryGeojson: undefined,
      })),
      documentAssets: (assets.results ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        metadata: row.metadataJson ? JSON.parse(String(row.metadataJson)) : {},
        metadataJson: undefined,
      })),
      interpretationStatus: candidates.results?.length
        ? "Candidate official plan scopes found; controlling law and internal rules may still require resolution."
        : "No imported B-Plan scope found; evaluate Baunutzungsplan, building lines, and sections 34/35 BauGB.",
      caveat: "Plan boundaries are screening evidence. Only the original legal instruments and competent authority are binding.",
    });
  } catch (error) {
    return Response.json({
      error: "Planning evidence query failed",
      detail: error instanceof Error ? error.message : "Unknown database error",
    }, { status: 500 });
  }
}
