BEGIN TRANSACTION;

WITH segment_summary AS (
  SELECT parcel_id, count(*) AS segment_count, max(coverage_ratio) AS max_coverage
  FROM parcel_planning_segments
  GROUP BY parcel_id
), only_segment AS (
  SELECT s.parcel_id, s.legal_regime
  FROM parcel_planning_segments s
  JOIN segment_summary x ON x.parcel_id = s.parcel_id AND x.segment_count = 1
), controlling_keys AS (
  SELECT s.parcel_id, json_group_array(d.plan_key) AS keys_json
  FROM parcel_planning_segments s
  JOIN planning_documents d ON d.id=s.document_id
  JOIN segment_summary x ON x.parcel_id=s.parcel_id
    AND x.segment_count=1 AND x.max_coverage>=0.99
  GROUP BY s.parcel_id
)
INSERT INTO parcel_development_profiles (
  parcel_id, primary_regime, legal_basis, controlling_plan_keys_json,
  legal_land_use_code, legal_land_use_label, permitted_uses_json, other_constraints_json, resolution_confidence,
  review_status, unresolved_fields_json, notes
)
SELECT
  p.id,
  CASE
    WHEN j.workflow = 'bplan_scope_candidate' AND x.segment_count = 1
      AND x.max_coverage >= 0.99 THEN o.legal_regime
    ELSE 'unresolved'
  END,
  CASE
    WHEN j.workflow = 'bplan_scope_candidate' THEN 'bplan'
    WHEN j.workflow = 'baunutzungsplan_stack_candidate' THEN 'baunutzungsplan_stack'
    ELSE 'unresolved'
  END,
  coalesce(k.keys_json, '[]'), NULL, NULL, '[]', '[]',
  CASE
    WHEN j.workflow = 'bplan_scope_candidate' AND x.segment_count = 1
      AND x.max_coverage >= 0.99 THEN 'medium'
    WHEN j.workflow = 'baunutzungsplan_stack_candidate' THEN 'low'
    ELSE 'unknown'
  END,
  'unreviewed',
  CASE
    WHEN j.workflow = 'bplan_scope_candidate' AND x.segment_count = 1
      AND x.max_coverage >= 0.99
      THEN '["internal_zone","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]'
    WHEN j.workflow = 'bplan_scope_candidate'
      THEN '["controlling_plan_precedence","internal_zone","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]'
    WHEN j.workflow = 'baunutzungsplan_stack_candidate'
      THEN '["baustufe_boundary","land_use_verification","bo_1958_interpretation","surviving_fluchtlinien","grz","gfz","storeys","building_form","other_constraints"]'
    ELSE '["section_34_or_35","permitted_uses","contextual_scale","grz_not_normatively_fixed","gfz_not_normatively_fixed","storeys","building_form","other_constraints"]'
  END,
  CASE
    WHEN j.workflow = 'bplan_scope_candidate' AND x.segment_count = 1 AND x.max_coverage >= 0.99
      THEN 'Exactly one official in-force B-Plan scope covers at least 99% of the parcel. The document is controlling at scope level; internal zoning and substantive rules remain unresolved.'
    WHEN j.workflow = 'bplan_scope_candidate'
      THEN 'One or more official B-Plan scopes intersect the parcel. The controlling document, partial coverage and internal zoning remain unresolved.'
    WHEN j.workflow = 'baunutzungsplan_stack_candidate'
      THEN 'Former-West Ortsteil routing proxy corroborated by the official 1989 wall line, more than 150 m from that non-parcel-accurate line, and with no imported in-force B-Plan scope. BNP raster readings remain observations until Baustufe, BO 1958 and surviving lines are resolved.'
    ELSE 'No imported in-force B-Plan scope. ALKIS building metrics describe context but do not determine BauGB section 34 or 35.'
  END
FROM parcels p
JOIN parcel_jurisdiction_contexts j ON j.parcel_id = p.id
LEFT JOIN controlling_keys k ON k.parcel_id = p.id
LEFT JOIN segment_summary x ON x.parcel_id = p.id
LEFT JOIN only_segment o ON o.parcel_id = p.id
ON CONFLICT(parcel_id) DO UPDATE SET
  primary_regime=excluded.primary_regime,
  legal_basis=excluded.legal_basis,
  controlling_plan_keys_json=excluded.controlling_plan_keys_json,
  legal_land_use_code=excluded.legal_land_use_code,
  legal_land_use_label=excluded.legal_land_use_label,
  permitted_uses_json=excluded.permitted_uses_json,
  other_constraints_json=excluded.other_constraints_json,
  resolution_confidence=excluded.resolution_confidence,
  review_status=excluded.review_status,
  unresolved_fields_json=excluded.unresolved_fields_json,
  resolved_at=CURRENT_TIMESTAMP,
  notes=excluded.notes;

COMMIT;
