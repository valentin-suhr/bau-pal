BEGIN TRANSACTION;

-- Reversible: clear only values written by this resolver before recalculating them.
UPDATE parcel_development_profiles
SET legal_land_use_code=NULL,legal_land_use_label=NULL,legal_grz=NULL, legal_gfz=NULL, legal_bmz=NULL,
    legal_storeys_min=NULL, legal_storeys_max=NULL, legal_height_max_m=NULL,
    building_form=NULL, building_depth_m=NULL, permitted_uses_json='[]',
    other_constraints_json='[]', max_principal_footprint_sqm=NULL,
    max_legal_floor_area_sqm=NULL, resolution_confidence='low',
    review_status='unreviewed',
    unresolved_fields_json='["baustufe_boundary","land_use_verification","bo_1958_interpretation","surviving_fluchtlinien","grz","gfz","storeys","building_form","other_constraints"]',
    notes='Former-West routing is corroborated, but substantive BNP raster readings remain candidates until the strict resolver gates pass.',
    resolved_at=CURRENT_TIMESTAMP
WHERE CASE WHEN json_valid(notes) THEN json_extract(notes,'$.resolutionMethod') END='bnp_strict_raster_bo58_v1';

DROP TABLE IF EXISTS temp.bnp_resolved;
CREATE TEMP TABLE bnp_resolved AS
SELECT p.id AS parcel_id, p.area_sqm,
  bo.text_value AS baustufe, bo.source_locator AS baustufe_source_locator,
  lo.text_value AS land_use_code, lo.source_locator AS land_use_source_locator,
  json_extract(lo.evidence_json,'$.sampleAgreement') AS sample_agreement,
  json_extract(lo.evidence_json,'$.classifiedPixelShare') AS classified_pixel_share,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='grz') AS grz,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='gfz') AS gfz,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='bmz') AS bmz,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='storeys_max') AS storeys_max,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='height_max_m') AS height_max_m,
  (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form') AS building_form,
  (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_land_use_permitted_use' AND c.code=lo.text_value AND c.rule_type='land_use') AS permitted_uses_json
FROM parcels p
JOIN parcel_jurisdiction_contexts j ON j.parcel_id=p.id
JOIN parcel_planning_observations bo ON bo.parcel_id=p.id
  AND bo.observation_type='baustufe_candidate'
  AND bo.extraction_method='raster_opposing_boundary_candidate_v1'
  AND bo.confidence='medium'
JOIN parcel_planning_observations lo ON lo.parcel_id=p.id
  AND lo.observation_type='land_use_candidate'
  AND lo.extraction_method='raster_colour_candidate_v1'
  AND lo.confidence='medium'
WHERE j.workflow='baunutzungsplan_stack_candidate'
  AND coalesce(json_extract(j.evidence_json,'$.historicalBoundaryReview'),0)=0
  AND lo.text_value NOT IN ('village_or_pure_residential','non_build_or_forest')
  AND json_extract(lo.evidence_json,'$.sampleAgreement')>=0.70
  AND json_extract(lo.evidence_json,'$.classifiedPixelShare')>=0.50
  AND (SELECT count(DISTINCT c.rule_type) FROM planning_codebook_entries c
       WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value
         AND c.rule_type IN ('grz','gfz','bmz','storeys_max','height_max_m','building_form'))=6
  AND EXISTS (SELECT 1 FROM planning_codebook_entries c
       WHERE c.codebook_key='bnp_land_use_permitted_use' AND c.code=lo.text_value
         AND c.rule_type='land_use' AND json_valid(c.text_value));

UPDATE parcel_development_profiles
SET legal_basis='baunutzungsplan_stack',
    legal_land_use_code=(SELECT land_use_code FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    legal_land_use_label=(SELECT CASE land_use_code WHEN 'general_residential' THEN 'Allgemeines Wohngebiet' WHEN 'mixed' THEN 'Gemischtes Gebiet' WHEN 'restricted_work' THEN 'Beschränktes Arbeitsgebiet' WHEN 'pure_work' THEN 'Reines Arbeitsgebiet' WHEN 'core' THEN 'Kerngebiet' END FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    legal_grz=(SELECT grz FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    legal_gfz=(SELECT gfz FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    legal_bmz=(SELECT bmz FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    legal_storeys_max=CAST((SELECT storeys_max FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id) AS INTEGER),
    legal_height_max_m=(SELECT height_max_m FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    building_form=(SELECT building_form FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    building_depth_m=(SELECT CASE
      WHEN land_use_code='general_residential' AND building_form='open' THEN 20
      WHEN land_use_code='general_residential' AND building_form='closed' THEN 13
      WHEN land_use_code='mixed' THEN 20 WHEN land_use_code='core' THEN 30
      ELSE NULL END FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    permitted_uses_json=(SELECT permitted_uses_json FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    other_constraints_json=json_array(json_object(
      'type','manual_confirmation_required',
      'detail','Confirm surviving Fluchtlinien, later amendments and parcel-specific boundary interpretation with the district authority.')),
    max_principal_footprint_sqm=round((SELECT area_sqm*grz FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),2),
    max_legal_floor_area_sqm=round((SELECT area_sqm*gfz FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),2),
    resolution_confidence='medium', review_status='machine_checked',
    unresolved_fields_json='["legal_boundary_confirmation","land_use_manual_verification","baustufe_manual_verification","surviving_fluchtlinien","other_constraints"]',
    notes=(SELECT json_object(
      'resolutionMethod','bnp_strict_raster_bo58_v1',
      'status','machine_resolved_manual_confirmation_required',
      'baustufe',baustufe,'landUseCode',land_use_code,
      'sampleAgreement',sample_agreement,'classifiedPixelShare',classified_pixel_share,
      'thresholds',json_object('sampleAgreement',0.70,'classifiedPixelShare',0.50),
      'baustufeSourceLocator',baustufe_source_locator,
      'landUseSourceLocator',land_use_source_locator,
      'ruleSources',json_array('Baunutzungsplan legend: Maß der Nutzung','BO 58 § 7','BO 58 § 9'),
      'caveat','Machine interpretation of official raster and BO 1958 codebook; not an official parcel-specific planning statement.'
    ) FROM bnp_resolved r WHERE r.parcel_id=parcel_development_profiles.parcel_id),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT parcel_id FROM bnp_resolved);

DROP TABLE temp.bnp_resolved;
COMMIT;
