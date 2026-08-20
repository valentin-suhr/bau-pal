BEGIN TRANSACTION;

UPDATE parcel_planning_segments SET precedence_rank=0, is_controlling=0;

WITH segment_summary AS (
  SELECT parcel_id, count(*) AS segment_count, max(coverage_ratio) AS max_coverage
  FROM parcel_planning_segments s
  JOIN planning_zones z ON z.id=s.zone_id
  WHERE z.geometry_method='official_vector'
  GROUP BY parcel_id
)
UPDATE parcel_planning_segments
SET precedence_rank=1, is_controlling=1
WHERE zone_id IN (SELECT id FROM planning_zones WHERE geometry_method='official_vector')
  AND parcel_id IN (
  SELECT parcel_id FROM segment_summary
  WHERE segment_count=1 AND max_coverage>=0.99
);

-- Resolve overlapping scopes only when one near-total-coverage plan is the
-- unique successor of every other plan on that parcel according to Berlin's
-- official ersetzt/ersetzt teilweise relation graph. Partial supersession is
-- sufficient here because the successor itself covers at least 99% of this
-- parcel; no claim is made outside that parcel intersection.
WITH RECURSIVE relation_reach(newer_document_id, older_document_id) AS (
  SELECT from_document_id, to_document_id
  FROM planning_document_relations
  WHERE relation IN ('supersedes', 'partially_supersedes')
  UNION
  SELECT r.newer_document_id, x.to_document_id
  FROM relation_reach r
  JOIN planning_document_relations x ON x.from_document_id=r.older_document_id
  WHERE x.relation IN ('supersedes', 'partially_supersedes')
), candidate AS (
  SELECT s.parcel_id, s.id AS segment_id
  FROM parcel_planning_segments s
  JOIN planning_zones sz ON sz.id=s.zone_id AND sz.geometry_method='official_vector'
  WHERE s.coverage_ratio>=0.99
    AND (SELECT count(DISTINCT x.document_id) FROM parcel_planning_segments x JOIN planning_zones xz ON xz.id=x.zone_id WHERE x.parcel_id=s.parcel_id AND xz.geometry_method='official_vector')>1
    AND NOT EXISTS (
      SELECT 1
      FROM parcel_planning_segments other
      JOIN planning_zones oz ON oz.id=other.zone_id AND oz.geometry_method='official_vector'
      WHERE other.parcel_id=s.parcel_id
        AND other.document_id!=s.document_id
        AND NOT EXISTS (
          SELECT 1 FROM relation_reach r
          WHERE r.newer_document_id=s.document_id
            AND r.older_document_id=other.document_id
        )
    )
), unique_candidate AS (
  SELECT parcel_id, min(segment_id) AS segment_id
  FROM candidate
  GROUP BY parcel_id
  HAVING count(*)=1
)
UPDATE parcel_planning_segments
SET precedence_rank=1, is_controlling=1
WHERE id IN (SELECT segment_id FROM unique_candidate);

UPDATE parcel_development_profiles
SET primary_regime=coalesce((
      SELECT s.legal_regime
      FROM parcel_planning_segments s
      WHERE s.parcel_id=parcel_development_profiles.parcel_id AND s.is_controlling=1
      LIMIT 1
    ), primary_regime),
    legal_basis=CASE
      WHEN parcel_id IN (SELECT parcel_id FROM parcel_planning_segments WHERE is_controlling=1) THEN 'bplan'
      ELSE legal_basis
    END,
    resolution_confidence=CASE
      WHEN parcel_id IN (SELECT parcel_id FROM parcel_planning_segments WHERE is_controlling=1) THEN 'medium'
      ELSE resolution_confidence
    END,
    controlling_plan_keys_json=coalesce((
      SELECT json_group_array(d.plan_key)
      FROM parcel_planning_segments s
      JOIN planning_documents d ON d.id=s.document_id
      WHERE s.parcel_id=parcel_development_profiles.parcel_id AND s.is_controlling=1
    ), '[]'),
    unresolved_fields_json=CASE
      WHEN parcel_id IN (SELECT parcel_id FROM parcel_planning_segments WHERE is_controlling=1)
        THEN '["internal_zone","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]'
      WHEN legal_basis='bplan'
        THEN '["controlling_plan_precedence","internal_zone","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]'
      ELSE unresolved_fields_json
    END,
    notes=CASE
      WHEN parcel_id IN (SELECT parcel_id FROM parcel_planning_segments WHERE is_controlling=1)
        THEN CASE
          WHEN (SELECT count(DISTINCT s.document_id) FROM parcel_planning_segments s JOIN planning_zones z ON z.id=s.zone_id WHERE s.parcel_id=parcel_development_profiles.parcel_id AND z.geometry_method='official_vector')=1
            THEN 'Exactly one official in-force B-Plan scope covers at least 99% of the parcel. The document is controlling at scope level; internal zoning and substantive rules remain unresolved.'
          ELSE 'One official in-force B-Plan scope covers at least 99% of the parcel and is the unique successor of every overlapping scope according to Berlin official supersession relations. Scope-level precedence is resolved; internal zoning and substantive rules remain unresolved.'
        END
      ELSE notes
    END,
    resolved_at=CURRENT_TIMESTAMP;

UPDATE parcel_jurisdiction_contexts
SET reason=CASE
      WHEN (SELECT count(DISTINCT s.document_id) FROM parcel_planning_segments s JOIN planning_zones z ON z.id=s.zone_id WHERE s.parcel_id=parcel_jurisdiction_contexts.parcel_id AND z.geometry_method='official_vector')=1
        THEN 'Exactly one official in-force B-Plan scope covers at least 99% of the parcel. Scope-level precedence is resolved; internal zoning and substantive rules remain unresolved.'
      ELSE 'One official in-force B-Plan scope covers at least 99% of the parcel and is the unique successor of every overlapping scope according to Berlin official supersession relations. Scope-level precedence is resolved; internal zoning and substantive rules remain unresolved.'
    END,
    updated_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT parcel_id FROM parcel_planning_segments WHERE is_controlling=1);

COMMIT;
