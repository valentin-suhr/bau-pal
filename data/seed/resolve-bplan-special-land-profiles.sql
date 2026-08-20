BEGIN TRANSACTION;

DELETE FROM planning_rules WHERE extraction_method='manual_plan_sheet_special_land_profile_v1';
DELETE FROM planning_zones WHERE geometry_method='manual_plan_sheet_special_land_parcel_match_v1';

INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,'reviewed-special-land-parcel',
  CASE d.plan_key WHEN '12-1' THEN 'Private Dauerkleingärten' WHEN 'I-9' THEN 'Öffentliche Straßenverkehrsfläche' ELSE 'Straßenverkehrsfläche - Bundesstraße B 96' END,
  p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,
  'manual_plan_sheet_special_land_parcel_match_v1','high'
FROM planning_documents d
JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99
JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key IN ('12-1','I-9','II-200ib')
  AND (SELECT count(DISTINCT x.parcel_id) FROM parcel_planning_segments x WHERE x.document_id=d.id AND x.is_controlling=1)=1;

INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator)
SELECT d.id,z.id,'parcel_rule',v.rule_type,v.numeric_value,v.text_value,v.unit,v.legal_citation,v.interpretation,
  'manual_plan_sheet_special_land_profile_v1','high','manually_verified',d.source_id,
  a.url || '#page=1; visually reviewed cadastral parcel match; sha256 ' || a.content_hash_sha256
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_plan_sheet_special_land_parcel_match_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT '12-1' plan_key,'land_use' rule_type,NULL numeric_value,'private_permanent_allotments' text_value,NULL unit,'Plan drawing: Grünfläche - Private Dauerkleingärten' legal_citation,'The parcel is fixed as private permanent allotments, not ordinary residential building land.' interpretation UNION ALL
  SELECT '12-1','permitted_uses',NULL,'["non-residential one-storey allotment huts","one-storey clubhouse consistent with the allotment purpose"]',NULL,'Text stipulation 2','Huts may not serve residential purposes; a purpose-compatible one-storey clubhouse may be admitted.' UNION ALL
  SELECT '12-1','storeys_max',1,NULL,'full storey','Text stipulation 2','Maximum applies to allotment huts and the potentially admissible clubhouse, not to ordinary residential buildings.' UNION ALL
  SELECT '12-1','allotment_hut_footprint_max',24,NULL,'sqm per allotment','Text stipulation 2','Includes ancillary structures such as a small-animal stall, canopy, enclosed veranda, equipment room and covered open seat.' UNION ALL
  SELECT '12-1','residential_use',NULL,'prohibited',NULL,'Text stipulation 2','Allotment huts may not serve residential purposes.' UNION ALL
  SELECT '12-1','surface_permeability',NULL,'paths and access routes must use water- and air-permeable construction',NULL,'Text stipulation 1','Concrete substructure, joint sealing, asphalt and concrete paving are prohibited.' UNION ALL
  SELECT '12-1','public_access_easement',NULL,'area C',NULL,'Text stipulation 4','Area C must be burdened with a pedestrian right for the general public.' UNION ALL
  SELECT 'I-9','land_use',NULL,'public_traffic_area',NULL,'Plan drawing: Straßenverkehrsfläche; cadastral parcel 43','Cadastral parcel 43 is visibly labelled within the yellow public street-traffic area.' UNION ALL
  SELECT 'I-9','permitted_uses',NULL,'["public street and traffic infrastructure"]',NULL,'Plan drawing: Straßenverkehrsfläche','The parcel is not designated as building land.' UNION ALL
  SELECT 'I-9','street_layout',NULL,'internal division is not fixed by the plan',NULL,'Text stipulation 8','The internal allocation of street traffic areas is expressly outside the plan determination.' UNION ALL
  SELECT 'I-9','planting_strip',NULL,'retain plan-drawn planting strip at the eastern boundary',NULL,'Plan drawing','A narrow planting strip is drawn along the eastern boundary; exact subarea geometry remains unresolved.' UNION ALL
  SELECT 'II-200ib','land_use',NULL,'federal_road_traffic_area',NULL,'Plan drawing: Straßenverkehrsfläche - Bundesstraße B 96; cadastral parcel 383','Cadastral parcel 383 is visibly contained by the plan scope fixed as federal-road traffic area.' UNION ALL
  SELECT 'II-200ib','permitted_uses',NULL,'["federal road and traffic infrastructure"]',NULL,'Plan drawing: Straßenverkehrsfläche - Bundesstraße B 96','The parcel is not designated as building land.' UNION ALL
  SELECT 'II-200ib','street_layout',NULL,'internal division is not fixed by the plan',NULL,'Text stipulation 1','The internal allocation of the street traffic area is expressly outside the plan determination.' UNION ALL
  SELECT 'II-200ib','underground_transport_infrastructure',NULL,'plan-approved road and railway tunnel facilities beneath the parcel',NULL,'Nachrichtliche Übernahme and Hinweis','Underground tunnel facilities are shown as informational carry-overs; construction work must be coordinated with the responsible operators.'
) v ON v.plan_key=d.plan_key
WHERE d.plan_key IN ('12-1','I-9','II-200ib');

UPDATE parcel_development_profiles
SET legal_land_use_code=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_special_land_profile_v1' AND r.rule_type='land_use'),
    legal_land_use_label=(SELECT z.label FROM parcel_planning_segments ps JOIN planning_zones z ON z.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND z.geometry_method='manual_plan_sheet_special_land_parcel_match_v1'),
    permitted_uses_json=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_special_land_profile_v1' AND r.rule_type='permitted_uses'),
    legal_storeys_max=(SELECT CAST(r.numeric_value AS INTEGER) FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_special_land_profile_v1' AND r.rule_type='storeys_max'),
    other_constraints_json=(SELECT json_group_array(json_object('type',r.rule_type,'value',coalesce(r.numeric_value,r.text_value),'unit',r.unit,'citation',r.legal_citation,'sourceLocator',r.source_locator)) FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_special_land_profile_v1' AND r.rule_type NOT IN ('land_use','permitted_uses','storeys_max')),
    resolution_confidence='high',review_status='manually_verified',
    unresolved_fields_json=CASE parcel_id
      WHEN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key='12-1') THEN '["internal_allotment_and_easement_geometry","clubhouse_location_and_admission","authority_confirmation"]'
      WHEN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key='I-9') THEN '["internal_street_and_planting_geometry","authority_confirmation"]'
      ELSE '["internal_street_and_tunnel_geometry","authority_confirmation"]' END,
    notes=(SELECT json_object('resolutionMethod','bplan_manual_special_land_profile_v1','status','non_building_land_use_manually_verified','planKey',d.plan_key,'scopeCoverageRatio',ps.coverage_ratio,'caveat',CASE d.plan_key WHEN '12-1' THEN 'Official sheet visually reviewed. The allotment designation and auxiliary one-storey limits are parcel-matched; this is not ordinary residential development permission.' WHEN 'I-9' THEN 'Official sheet visually reviewed. Cadastral parcel 43 is visibly matched to the public street-traffic area; internal street and planting geometry remains unresolved.' ELSE 'Official sheet visually reviewed. Cadastral parcel 383 is visibly matched to the B 96 federal-road traffic area; internal street and tunnel geometry remains unresolved.' END) FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND d.plan_key IN ('12-1','I-9','II-200ib')),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key IN ('12-1','I-9','II-200ib'));

COMMIT;
