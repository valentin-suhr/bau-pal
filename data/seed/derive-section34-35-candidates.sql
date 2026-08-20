BEGIN TRANSACTION;

DELETE FROM parcel_planning_observations
WHERE observation_type='legal_regime_candidate'
  AND extraction_method='combined_official_context_screen_v1';

WITH evidence AS (
  SELECT f.parcel_id, f.text_value AS fnp_land_use,
    json_extract(s.evidence_json,'$.within50m') AS within_50m,
    json_extract(s.evidence_json,'$.within100m') AS within_100m,
    json_extract(s.evidence_json,'$.nearestBuildingDistanceM') AS nearest_m,
    json_extract(s.evidence_json,'$.medianObservedStoreys100m') AS median_storeys,
    f.source_locator AS fnp_source_locator,
    json_extract(f.evidence_json,'$.sourceUpdatedAt') AS fnp_source_updated_at
  FROM parcel_planning_observations f
  JOIN parcel_planning_observations s ON s.parcel_id=f.parcel_id
    AND s.observation_type='settlement_context'
  JOIN parcel_jurisdiction_contexts j ON j.parcel_id=f.parcel_id
    AND j.workflow='section_34_35_unresolved'
  WHERE f.observation_type='fnp_land_use_candidate'
), classified AS (
  SELECT *, CASE
    WHEN (fnp_land_use LIKE 'Wohnbaufläche%'
      OR fnp_land_use LIKE 'Gemischte Baufläche%'
      OR fnp_land_use='Gewerbliche Baufläche')
      AND within_50m>=5 AND within_100m>=20 AND nearest_m<=50
      THEN 'section_34_candidate'
    WHEN fnp_land_use IN ('Landwirtschaftsfläche','Wald','Grünfläche','Wasserfläche')
      AND within_50m=0 AND within_100m<=2
      AND (nearest_m IS NULL OR nearest_m>100)
      THEN 'section_35_candidate'
    ELSE NULL END AS candidate
  FROM evidence
)
INSERT INTO parcel_planning_observations (
  parcel_id, observation_type, text_value, extraction_method, confidence,
  review_status, source_locator, evidence_json
)
SELECT parcel_id, 'legal_regime_candidate', candidate,
  'combined_official_context_screen_v1', 'low', 'machine_checked',
  'Official FNP centroid overlay plus ALKIS building-centre metrics within 100 m',
  json_object(
    'fnpLandUse',fnp_land_use,'fnpSourceLocator',fnp_source_locator,
    'fnpSourceUpdatedAt',fnp_source_updated_at,'within50m',within_50m,
    'within100m',within_100m,'nearestBuildingDistanceM',nearest_m,
    'medianObservedStoreys100m',median_storeys,
    'criteriaVersion','section34_35_screen_v1',
    'warning','Screening candidate only. Settlement continuity, legal context, privileges, public interests and competent-authority assessment remain unresolved.'
  )
FROM classified WHERE candidate IS NOT NULL;

COMMIT;
