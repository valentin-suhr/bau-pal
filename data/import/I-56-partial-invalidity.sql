BEGIN TRANSACTION;

INSERT INTO sources (source_key,title,publisher,source_type,url,effective_from,retrieved_at,metadata_json)
VALUES (
  'ovg-bb-i56-2010',
  'OVG Berlin-Brandenburg judgment OVG 2 A 20.08',
  'Oberverwaltungsgericht Berlin-Brandenburg / Landesrechtsportal Brandenburg',
  'court_decision',
  'https://gerichtsentscheidungen.brandenburg.de/gerichtsentscheidung/9488',
  '2010-04-16',
  CURRENT_TIMESTAMP,
  '{"court":"OVG Berlin-Brandenburg","senate":"2. Senat","decisionDate":"2010-04-16","caseNumber":"OVG 2 A 20.08","documentType":"Urteil"}'
)
ON CONFLICT(source_key) DO UPDATE SET
  title=excluded.title,
  publisher=excluded.publisher,
  source_type=excluded.source_type,
  url=excluded.url,
  effective_from=excluded.effective_from,
  metadata_json=excluded.metadata_json;

UPDATE planning_documents
SET status='partially_in_force',
    notes=json_set(
      notes,
      '$.legalStatus','Teilweise unwirksam',
      '$.partialInvalidity',json('{"decisionDate":"2010-04-16","caseNumber":"OVG 2 A 20.08","effect":"The public-park designation is ineffective north of the transverse traffic area for Littenstraße 87-92 and part of former parcel 7; the remainder of I-56 survives.","sourceKey":"ovg-bb-i56-2010"}')
    ),
    updated_at=CURRENT_TIMESTAMP
WHERE plan_key='I-56';

DELETE FROM planning_rules
WHERE zone_id IN (
  SELECT z.id FROM planning_zones z JOIN planning_documents d ON d.id=z.document_id
  WHERE d.plan_key='I-56' AND z.geometry_method='judgment_current_cadastral_match_v1'
);
DELETE FROM planning_zones
WHERE document_id=(SELECT id FROM planning_documents WHERE plan_key='I-56')
  AND geometry_method='judgment_current_cadastral_match_v1';

INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,'I-56:surviving:parcel-512','I-56 remains controlling after partial invalidity',p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,'judgment_current_cadastral_match_v1','medium'
FROM planning_documents d JOIN parcels p ON p.id='11000181800512____'
WHERE d.plan_key='I-56';

INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,'I-56:invalid-park:parcel-563','I-56 public-park designation ineffective',p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,'judgment_current_cadastral_match_v1','medium'
FROM planning_documents d JOIN parcels p ON p.id='11000181800563____'
WHERE d.plan_key='I-56';

INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,'I-56:invalid-park:parcel-564','I-56 public-park designation ineffective',p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,'judgment_current_cadastral_match_v1','medium'
FROM planning_documents d JOIN parcels p ON p.id='11000181800564____'
WHERE d.plan_key='I-56';

INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,text_value,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator)
SELECT d.id,z.id,'zone_rule','legal_effect','bplan_survives_partial_invalidity',
  'OVG Berlin-Brandenburg, Urteil vom 16.04.2010 - OVG 2 A 20.08, Tenor und Rn. 43',
  'Current ALKIS parcel 512 lies south of the transverse traffic area and outside the judgment-defined invalid northern park extent. I-56 remains controlling, while its internal use and dimensional zones remain unresolved.',
  'official_judgment_manual_cadastral_match_v1','medium','manually_verified',s.id,s.url || '#tenor'
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.zone_key='I-56:surviving:parcel-512'
JOIN sources s ON s.source_key='ovg-bb-i56-2010'
WHERE d.plan_key='I-56';

INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,text_value,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator)
SELECT d.id,z.id,'zone_rule','legal_effect','bplan_public_park_designation_ineffective',
  'OVG Berlin-Brandenburg, Urteil vom 16.04.2010 - OVG 2 A 20.08, Tenor und Rn. 43',
  'Current ALKIS parcel 563 lies wholly north of the transverse traffic area inside the judgment-defined invalid public-park extent. The judgment does not itself determine the successor planning-law regime.',
  'official_judgment_manual_cadastral_match_v1','medium','manually_verified',s.id,s.url || '#tenor'
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.zone_key='I-56:invalid-park:parcel-563'
JOIN sources s ON s.source_key='ovg-bb-i56-2010'
WHERE d.plan_key='I-56';

INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,text_value,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator)
SELECT d.id,z.id,'zone_rule','legal_effect','bplan_public_park_designation_ineffective',
  'OVG Berlin-Brandenburg, Urteil vom 16.04.2010 - OVG 2 A 20.08, Tenor und Rn. 43',
  'Current ALKIS parcel 564 lies wholly north of the transverse traffic area inside the judgment-defined invalid public-park extent. The judgment does not itself determine the successor planning-law regime.',
  'official_judgment_manual_cadastral_match_v1','medium','manually_verified',s.id,s.url || '#tenor'
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.zone_key='I-56:invalid-park:parcel-564'
JOIN sources s ON s.source_key='ovg-bb-i56-2010'
WHERE d.plan_key='I-56';

UPDATE parcel_planning_segments
SET is_controlling=0,
    confidence='medium',
    assignment_method='official_judgment_manual_cadastral_match_v1',
    reviewed_at=CURRENT_TIMESTAMP
WHERE document_id=(SELECT id FROM planning_documents WHERE plan_key='I-56')
  AND parcel_id IN ('11000181800563____','11000181800564____');

UPDATE parcel_development_profiles
SET primary_regime='unresolved',
    controlling_plan_keys_json='[]',
    permitted_uses_json='[]',
    legal_grz=NULL,
    legal_gfz=NULL,
    legal_bmz=NULL,
    legal_storeys_min=NULL,
    legal_storeys_max=NULL,
    legal_height_max_m=NULL,
    building_form=NULL,
    building_depth_m=NULL,
    roof_rules=NULL,
    other_constraints_json='[]',
    max_principal_footprint_sqm=NULL,
    max_legal_floor_area_sqm=NULL,
    resolution_confidence='medium',
    review_status='manually_verified',
    unresolved_fields_json='["successor_planning_law_after_partial_bplan_invalidity","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]',
    notes='{"resolutionMethod":"i56_partial_invalidity_cadastral_match_v1","status":"bplan_designation_ineffective_successor_regime_unresolved","formerControllingPlan":"I-56","decisionDate":"2010-04-16","caseNumber":"OVG 2 A 20.08","caveat":"The court judgment removes the I-56 public-park designation but does not itself establish whether BauGB section 34 or section 35 supplies the successor regime."}',
    legal_basis='unresolved',
    legal_land_use_code=NULL,
    legal_land_use_label=NULL,
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN ('11000181800563____','11000181800564____');

UPDATE parcel_jurisdiction_contexts
SET workflow='section_34_35_unresolved',
    reason='OVG Berlin-Brandenburg judgment OVG 2 A 20.08 invalidated the I-56 public-park designation for this parcel; the successor regime requires separate section 34/35 assessment.',
    assignment_method='official_judgment_manual_cadastral_match_v1',
    confidence='medium',
    source_id=(SELECT id FROM sources WHERE source_key='ovg-bb-i56-2010'),
    source_locator='https://gerichtsentscheidungen.brandenburg.de/gerichtsentscheidung/9488#tenor',
    evidence_json=json_set(evidence_json,'$.bplanScopeIntersection',0,'$.invalidatedPlanKey','I-56','$.partialInvalidityDecision','OVG 2 A 20.08','$.successorRegimeResolved',0),
    reviewed_at=CURRENT_TIMESTAMP,
    updated_at=CURRENT_TIMESTAMP
WHERE parcel_id IN ('11000181800563____','11000181800564____');

UPDATE parcel_development_profiles
SET review_status='manually_verified',
    unresolved_fields_json='["internal_zone","permitted_uses","grz","gfz","storeys","building_form","other_constraints"]',
    notes='{"resolutionMethod":"i56_surviving_extent_review_v1","status":"controlling_plan_survives_south_of_transverse_traffic_area","planKey":"I-56","decisionDate":"2010-04-16","caseNumber":"OVG 2 A 20.08","caveat":"Legal effect is resolved for this parcel, but the surviving public-park, mixed-use and traffic-zone geometry and substantive rules remain unresolved."}',
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id='11000181800512____';

COMMIT;
