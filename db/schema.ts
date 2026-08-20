import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * The database deliberately stores geometry as GeoJSON rather than relying on
 * a spatial SQLite extension. D1 can filter the indexed bounding-box columns;
 * exact intersections are calculated during the import/normalisation job.
 */

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dataset: text("dataset").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceVersion: text("source_version"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  status: text("status", {
    enum: ["running", "complete", "failed", "partial"],
  }).notNull().default("running"),
  recordsRead: integer("records_read").notNull().default(0),
  recordsWritten: integer("records_written").notNull().default(0),
  error: text("error"),
});

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull(),
  title: text("title").notNull(),
  publisher: text("publisher").notNull(),
  sourceType: text("source_type", {
    enum: ["wfs", "wms", "atom", "pdf", "legal_text", "manual_review", "derived"],
  }).notNull(),
  url: text("url").notNull(),
  licence: text("licence"),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  retrievedAt: text("retrieved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  uniqueIndex("sources_source_key_unique").on(table.sourceKey),
]);

export const parcels = sqliteTable("parcels", {
  // Berlin's 18-character ALKIS Flurstueckskennzeichen (fsko).
  id: text("id").primaryKey(),
  alkisUuid: text("alkis_uuid").notNull(),
  numerator: text("numerator").notNull(),
  denominator: text("denominator"),
  cadastralDistrictCode: text("cadastral_district_code").notNull(),
  cadastralDistrict: text("cadastral_district").notNull(),
  flur: text("flur").notNull(),
  borough: text("borough").notNull(),
  locality: text("locality"),
  areaSqm: real("area_sqm").notNull(),
  centroidLng: real("centroid_lng").notNull(),
  centroidLat: real("centroid_lat").notNull(),
  bboxWest: real("bbox_west").notNull(),
  bboxSouth: real("bbox_south").notNull(),
  bboxEast: real("bbox_east").notNull(),
  bboxNorth: real("bbox_north").notNull(),
  geometryGeojson: text("geometry_geojson").notNull(),
  sourceId: integer("source_id").references(() => sources.id),
  sourceFeatureTimestamp: text("source_feature_timestamp"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("parcels_alkis_uuid_unique").on(table.alkisUuid),
  index("parcels_borough_idx").on(table.borough),
  index("parcels_centroid_idx").on(table.centroidLng, table.centroidLat),
  index("parcels_bbox_west_east_idx").on(table.bboxWest, table.bboxEast),
  index("parcels_bbox_south_north_idx").on(table.bboxSouth, table.bboxNorth),
]);

export const parcelAddresses = sqliteTable("parcel_addresses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parcelId: text("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  street: text("street").notNull(),
  houseNumber: text("house_number"),
  postcode: text("postcode"),
  city: text("city").notNull().default("Berlin"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  sourceId: integer("source_id").references(() => sources.id),
}, (table) => [
  uniqueIndex("parcel_addresses_unique").on(table.parcelId, table.street, table.houseNumber),
  index("parcel_addresses_street_idx").on(table.street, table.houseNumber),
]);

export const planningDocuments = sqliteTable("planning_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planKey: text("plan_key").notNull(),
  title: text("title").notNull(),
  planType: text("plan_type", {
    enum: [
      "qualified_bplan",
      "project_bplan",
      "simple_bplan",
      "transition_plan",
      "baunutzungsplan",
      "section_34",
      "section_35",
      "other",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["in_force", "in_process", "partially_superseded", "superseded", "unknown"],
  }).notNull().default("unknown"),
  borough: text("borough"),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  sourceId: integer("source_id").references(() => sources.id),
  notes: text("notes"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("planning_documents_plan_key_unique").on(table.planKey),
  index("planning_documents_borough_idx").on(table.borough),
]);

export const planningDocumentRelations = sqliteTable("planning_document_relations", {
  fromDocumentId: integer("from_document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  toDocumentId: integer("to_document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  relation: text("relation", {
    enum: ["amends", "partially_supersedes", "supersedes", "supplements", "references"],
  }).notNull(),
  notes: text("notes"),
}, (table) => [
  primaryKey({ columns: [table.fromDocumentId, table.toDocumentId, table.relation] }),
]);

export const planningDocumentAssets = sqliteTable("planning_document_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  assetType: text("asset_type", {
    enum: ["plan_sheet", "text_stipulations", "rationale", "announcement", "detail_page", "other"],
  }).notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  contentHashSha256: text("content_hash_sha256"),
  byteSize: integer("byte_size"),
  pageCount: integer("page_count"),
  sourceModifiedAt: text("source_modified_at"),
  retrievedAt: text("retrieved_at"),
  retrievalStatus: text("retrieval_status", {
    enum: ["pending", "downloaded", "not_found", "forbidden", "failed", "superseded"],
  }).notNull().default("pending"),
  localPath: text("local_path"),
  ocrStatus: text("ocr_status", {
    enum: ["not_needed", "pending", "complete", "partial", "failed"],
  }).notNull().default("pending"),
  extractionStatus: text("extraction_status", {
    enum: ["pending", "machine_extracted", "needs_review", "verified", "failed"],
  }).notNull().default("pending"),
  extractionVersion: text("extraction_version"),
  error: text("error"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("planning_document_assets_url_unique").on(table.url),
  index("planning_document_assets_document_idx").on(table.documentId),
  index("planning_document_assets_queue_idx").on(table.retrievalStatus, table.extractionStatus),
]);

export const planningZones = sqliteTable("planning_zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  zoneKey: text("zone_key").notNull(),
  label: text("label"),
  geometryGeojson: text("geometry_geojson").notNull(),
  bboxWest: real("bbox_west").notNull(),
  bboxSouth: real("bbox_south").notNull(),
  bboxEast: real("bbox_east").notNull(),
  bboxNorth: real("bbox_north").notNull(),
  geometryMethod: text("geometry_method", {
    enum: ["official_vector", "georeferenced_scan", "manual_trace", "inferred"],
  }).notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
}, (table) => [
  uniqueIndex("planning_zones_document_zone_unique").on(table.documentId, table.zoneKey),
  index("planning_zones_bbox_west_east_idx").on(table.bboxWest, table.bboxEast),
  index("planning_zones_bbox_south_north_idx").on(table.bboxSouth, table.bboxNorth),
]);

export const planningZoneGeometryReviews = sqliteTable("planning_zone_geometry_reviews", {
  zoneId: integer("zone_id").primaryKey().references(() => planningZones.id, { onDelete: "cascade" }),
  sourceAssetId: integer("source_asset_id").references(() => planningDocumentAssets.id),
  sourcePage: integer("source_page").notNull().default(1),
  traceVersion: text("trace_version").notNull(),
  renderJson: text("render_json").notNull(),
  controlPointsJson: text("control_points_json").notNull(),
  transformJson: text("transform_json").notNull(),
  residualsJson: text("residuals_json").notNull(),
  qaThresholdsJson: text("qa_thresholds_json").notNull(),
  rmsResidualM: real("rms_residual_m").notNull(),
  maxResidualM: real("max_residual_m").notNull(),
  reviewStatus: text("review_status", {
    enum: ["machine_checked", "manually_verified", "rejected", "superseded"],
  }).notNull().default("machine_checked"),
  reviewedAt: text("reviewed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("planning_zone_geometry_review_asset_idx").on(table.sourceAssetId),
  index("planning_zone_geometry_review_status_idx").on(table.reviewStatus, table.rmsResidualM),
]);

export const planningDocumentZoneReviews = sqliteTable("planning_document_zone_reviews", {
  documentId: integer("document_id").primaryKey().references(() => planningDocuments.id, { onDelete: "cascade" }),
  sourceAssetId: integer("source_asset_id").references(() => planningDocumentAssets.id),
  traceVersion: text("trace_version").notNull(),
  scopePartitionComplete: integer("scope_partition_complete", { mode: "boolean" }).notNull().default(false),
  landUseComplete: integer("land_use_complete", { mode: "boolean" }).notNull().default(false),
  densityComplete: integer("density_complete", { mode: "boolean" }).notNull().default(false),
  heightComplete: integer("height_complete", { mode: "boolean" }).notNull().default(false),
  buildingFormComplete: integer("building_form_complete", { mode: "boolean" }).notNull().default(false),
  otherConstraintsComplete: integer("other_constraints_complete", { mode: "boolean" }).notNull().default(false),
  reviewStatus: text("review_status", {
    enum: ["machine_checked", "manually_verified", "rejected", "superseded"],
  }).notNull().default("machine_checked"),
  notesJson: text("notes_json").notNull().default("{}"),
  reviewedAt: text("reviewed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("planning_document_zone_review_status_idx").on(table.reviewStatus),
]);

export const planningRules = sqliteTable("planning_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  zoneId: integer("zone_id").references(() => planningZones.id, { onDelete: "cascade" }),
  applicability: text("applicability", {
    enum: ["document_summary", "document_rule", "zone_rule", "parcel_context"],
  }).notNull().default("zone_rule"),
  ruleType: text("rule_type", {
    enum: [
      "land_use",
      "permitted_uses",
      "grz",
      "gfz",
      "bmz",
      "storeys_min",
      "storeys_max",
      "height_max_m",
      "absolute_elevation_max_m",
      "eaves_height_max_m",
      "building_form",
      "building_depth_m",
      "floor_area_max_sqm",
      "footprint_max_sqm",
      "buildable_envelope",
      "roof_form",
      "parking",
      "landscaping",
      "use_restriction",
      "other",
    ],
  }).notNull(),
  numericValue: real("numeric_value"),
  textValue: text("text_value"),
  unit: text("unit"),
  legalCitation: text("legal_citation"),
  interpretation: text("interpretation"),
  extractionMethod: text("extraction_method", {
    enum: ["official_structured", "embedded_text_mention", "manual_read", "ocr", "derived", "context_estimate"],
  }).notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewStatus: text("review_status", {
    enum: ["unreviewed", "machine_checked", "manually_verified", "officially_confirmed", "conflict"],
  }).notNull().default("unreviewed"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceLocator: text("source_locator"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("planning_rules_document_idx").on(table.documentId),
  index("planning_rules_zone_type_idx").on(table.zoneId, table.ruleType),
]);

export const planningCodebookEntries = sqliteTable("planning_codebook_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  codebookKey: text("codebook_key").notNull(),
  code: text("code").notNull(),
  ruleType: text("rule_type", {
    enum: ["grz", "gfz", "bmz", "storeys_max", "height_max_m", "building_form", "building_depth_m", "land_use", "other"],
  }).notNull(),
  numericValue: real("numeric_value"),
  textValue: text("text_value"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceLocator: text("source_locator"),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewStatus: text("review_status", {
    enum: ["unreviewed", "machine_checked", "manually_verified", "officially_confirmed", "conflict"],
  }).notNull().default("unreviewed"),
}, (table) => [
  uniqueIndex("planning_codebook_entry_unique").on(table.documentId, table.codebookKey, table.code, table.ruleType),
  index("planning_codebook_lookup_idx").on(table.codebookKey, table.code),
]);

export const planningLineFeatures = sqliteTable("planning_line_features", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  officialId: text("official_id").notNull(),
  lineType: text("line_type", {
    enum: ["building_line", "street_line", "street_and_building_line", "open_space_boundary", "other"],
  }).notNull(),
  officialLineType: text("official_line_type").notNull(),
  approvalKind: text("approval_kind"),
  approvalDate: text("approval_date"),
  approvalDateEnd: text("approval_date_end"),
  borough: text("borough").notNull(),
  geometryGeojson: text("geometry_geojson").notNull(),
  bboxWest: real("bbox_west").notNull(),
  bboxSouth: real("bbox_south").notNull(),
  bboxEast: real("bbox_east").notNull(),
  bboxNorth: real("bbox_north").notNull(),
  sourceId: integer("source_id").references(() => sources.id),
  sourceUpdatedAt: text("source_updated_at"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("planning_line_features_official_id_unique").on(table.officialId),
  index("planning_line_features_type_idx").on(table.lineType),
  index("planning_line_features_bbox_idx").on(table.bboxWest, table.bboxEast, table.bboxSouth, table.bboxNorth),
]);

export const parcelPlanningLines = sqliteTable("parcel_planning_lines", {
  parcelId: text("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  lineId: integer("line_id").notNull().references(() => planningLineFeatures.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["intersects", "touches", "within_tolerance"] }).notNull(),
  distanceM: real("distance_m").notNull(),
  assignmentMethod: text("assignment_method").notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  primaryKey({ columns: [table.parcelId, table.lineId] }),
  index("parcel_planning_lines_parcel_idx").on(table.parcelId),
]);

export const parcelPlanningSegments = sqliteTable("parcel_planning_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parcelId: text("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  zoneId: integer("zone_id").notNull().references(() => planningZones.id, { onDelete: "cascade" }),
  documentId: integer("document_id").notNull().references(() => planningDocuments.id, { onDelete: "cascade" }),
  legalRegime: text("legal_regime", {
    enum: ["section_30_1", "section_30_2", "section_30_3", "section_34", "section_35", "unresolved"],
  }).notNull(),
  coverageRatio: real("coverage_ratio").notNull(),
  intersectionAreaSqm: real("intersection_area_sqm").notNull(),
  intersectionGeojson: text("intersection_geojson"),
  precedenceRank: integer("precedence_rank").notNull().default(0),
  isControlling: integer("is_controlling", { mode: "boolean" }).notNull().default(false),
  assignmentMethod: text("assignment_method", {
    enum: ["official_overlay", "spatial_intersection", "address_match", "manual", "inferred"],
  }).notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  uniqueIndex("parcel_planning_segment_unique").on(table.parcelId, table.documentId, table.zoneId),
  index("parcel_planning_segments_parcel_idx").on(table.parcelId),
  index("parcel_planning_segments_regime_idx").on(table.legalRegime),
]);

export const parcelPlanningObservations = sqliteTable("parcel_planning_observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parcelId: text("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  documentId: integer("document_id").references(() => planningDocuments.id, { onDelete: "cascade" }),
  observationType: text("observation_type", {
    enum: [
      "land_use_candidate", "baustufe_candidate", "building_line_candidate",
      "context_grz", "context_gfz", "context_storeys", "context_building_form",
      "settlement_context", "fnp_land_use_candidate", "legal_regime_candidate", "other",
    ],
  }).notNull(),
  numericValue: real("numeric_value"),
  textValue: text("text_value"),
  extractionMethod: text("extraction_method").notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewStatus: text("review_status", {
    enum: ["unreviewed", "machine_checked", "manually_verified", "officially_confirmed", "conflict"],
  }).notNull().default("unreviewed"),
  sourceId: integer("source_id").references(() => sources.id),
  sourceLocator: text("source_locator"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  observedAt: text("observed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("parcel_planning_observations_parcel_idx").on(table.parcelId),
  index("parcel_planning_observations_type_idx").on(table.observationType, table.confidence),
]);

export const heritageFeatures = sqliteTable("heritage_features", {
  officialId: text("official_id").primaryKey(),
  gisId: text("gis_id").notNull(),
  monumentType: text("monument_type").notNull(),
  detailUrl: text("detail_url"),
  geometryGeojson: text("geometry_geojson").notNull(),
  bboxWest: real("bbox_west").notNull(),
  bboxSouth: real("bbox_south").notNull(),
  bboxEast: real("bbox_east").notNull(),
  bboxNorth: real("bbox_north").notNull(),
  sourceId: integer("source_id").references(() => sources.id),
  sourceUpdatedAt: text("source_updated_at"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("heritage_features_type_idx").on(table.monumentType),
  index("heritage_features_bbox_west_east_idx").on(table.bboxWest, table.bboxEast),
  index("heritage_features_bbox_south_north_idx").on(table.bboxSouth, table.bboxNorth),
]);

export const parcelHeritageConstraints = sqliteTable("parcel_heritage_constraints", {
  parcelId: text("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  heritageId: text("heritage_id").notNull().references(() => heritageFeatures.officialId, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["direct_overlap", "nearby_50m"] }).notNull(),
  distanceM: real("distance_m").notNull(),
  assignmentMethod: text("assignment_method").notNull().default("official_geometry_spatial_cross_reference_v1"),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  primaryKey({ columns: [table.parcelId, table.heritageId] }),
  index("parcel_heritage_constraints_parcel_idx").on(table.parcelId),
  index("parcel_heritage_constraints_relation_idx").on(table.relation, table.parcelId),
]);

/**
 * Provenance-bearing routing context. This determines which legal research
 * workflow applies; it does not itself assert the final planning-law regime.
 */
export const parcelJurisdictionContexts = sqliteTable("parcel_jurisdiction_contexts", {
  parcelId: text("parcel_id").primaryKey().references(() => parcels.id, { onDelete: "cascade" }),
  locality: text("locality"),
  historicalSector: text("historical_sector", {
    enum: ["former_west_proxy", "former_east_proxy", "unknown"],
  }).notNull(),
  workflow: text("workflow", {
    enum: ["bplan_scope_candidate", "baunutzungsplan_stack_candidate", "section_34_35_unresolved"],
  }).notNull(),
  reason: text("reason").notNull(),
  assignmentMethod: text("assignment_method").notNull(),
  confidence: text("confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  sourceId: integer("source_id").references(() => sources.id),
  sourceLocator: text("source_locator"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  reviewedAt: text("reviewed_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("parcel_jurisdiction_workflow_idx").on(table.workflow, table.confidence),
  index("parcel_jurisdiction_sector_idx").on(table.historicalSector),
]);

/**
 * Dashboard-ready resolution of the legal stack. Null means "not established",
 * never zero. Observed context estimates are kept separate from legal values.
 */
export const parcelDevelopmentProfiles = sqliteTable("parcel_development_profiles", {
  parcelId: text("parcel_id").primaryKey().references(() => parcels.id, { onDelete: "cascade" }),
  primaryRegime: text("primary_regime", {
    enum: ["section_30_1", "section_30_2", "section_30_3", "section_34", "section_35", "unresolved"],
  }).notNull(),
  legalBasis: text("legal_basis", {
    enum: ["bplan", "baunutzungsplan_stack", "section_34_context", "section_35_outside", "mixed", "unresolved"],
  }).notNull().default("unresolved"),
  controllingPlanKeysJson: text("controlling_plan_keys_json").notNull().default("[]"),
  legalLandUseCode: text("legal_land_use_code"),
  legalLandUseLabel: text("legal_land_use_label"),
  permittedUsesJson: text("permitted_uses_json").notNull().default("[]"),
  legalGrz: real("legal_grz"),
  legalGfz: real("legal_gfz"),
  legalBmz: real("legal_bmz"),
  legalStoreysMin: integer("legal_storeys_min"),
  legalStoreysMax: integer("legal_storeys_max"),
  legalHeightMaxM: real("legal_height_max_m"),
  buildingForm: text("building_form"),
  buildingDepthM: real("building_depth_m"),
  roofRules: text("roof_rules"),
  otherConstraintsJson: text("other_constraints_json").notNull().default("[]"),
  observedContextGrz: real("observed_context_grz"),
  observedContextGfzMin: real("observed_context_gfz_min"),
  observedContextGfzMax: real("observed_context_gfz_max"),
  observedContextStoreysMin: integer("observed_context_storeys_min"),
  observedContextStoreysMax: integer("observed_context_storeys_max"),
  maxPrincipalFootprintSqm: real("max_principal_footprint_sqm"),
  maxLegalFloorAreaSqm: real("max_legal_floor_area_sqm"),
  resolutionConfidence: text("resolution_confidence", { enum: ["official", "high", "medium", "low", "unknown"] }).notNull(),
  reviewStatus: text("review_status", {
    enum: ["unreviewed", "machine_checked", "manually_verified", "officially_confirmed", "conflict"],
  }).notNull().default("unreviewed"),
  unresolvedFieldsJson: text("unresolved_fields_json").notNull().default("[]"),
  resolvedAt: text("resolved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
}, (table) => [
  index("parcel_profiles_regime_idx").on(table.primaryRegime),
  index("parcel_profiles_confidence_idx").on(table.resolutionConfidence, table.reviewStatus),
  index("parcel_profiles_grz_gfz_idx").on(table.legalGrz, table.legalGfz),
]);
