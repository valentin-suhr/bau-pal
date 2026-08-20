BEGIN TRANSACTION;

DELETE FROM planning_rules WHERE extraction_method='manual_plan_sheet_qualified_single_zone_v1';
DELETE FROM planning_zones WHERE geometry_method='manual_plan_sheet_qualified_single_zone_parcel_match_v1';

INSERT INTO planning_zones (
  document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,
  geometry_method,confidence
)
SELECT d.id,'wa-single-zone','WA II / GRZ 0.2 / GFZ 0.4 / o',p.geometry_geojson,
  p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,
  'manual_plan_sheet_qualified_single_zone_parcel_match_v1','high'
FROM planning_documents d
JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99
JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key='XX-247-1'
  AND (SELECT count(DISTINCT x.parcel_id) FROM parcel_planning_segments x WHERE x.document_id=d.id AND x.is_controlling=1)=1;

INSERT INTO planning_rules (
  document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,
  interpretation,extraction_method,confidence,review_status,source_id,source_locator
)
SELECT d.id,z.id,'zone_rule',v.rule_type,v.numeric_value,v.text_value,v.unit,v.legal_citation,
  v.interpretation,'manual_plan_sheet_qualified_single_zone_v1','high','manually_verified',d.source_id,
  a.url || '#page=1; visually reviewed WA matrix and text stipulations; sha256 ' || a.content_hash_sha256
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_plan_sheet_qualified_single_zone_parcel_match_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT 'land_use' rule_type,NULL numeric_value,'general_residential' text_value,NULL unit,'Plan drawing: WA' legal_citation,'Allgemeines Wohngebiet across the parcel.' interpretation UNION ALL
  SELECT 'permitted_uses',NULL,'["residential buildings","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities"]',NULL,'Text stipulation 1 with BauNVO §4(2)','Only the uses listed in §4(2) are permitted; §4(3) exceptions are excluded.' UNION ALL
  SELECT 'grz',0.2,NULL,'ratio','Plan drawing: 0.2','Principal-building Grundflächenzahl.' UNION ALL
  SELECT 'gfz',0.4,NULL,'ratio','Plan drawing: 0.4','Geschossflächenzahl.' UNION ALL
  SELECT 'storeys_max',2,NULL,'full storeys','Plan drawing: II','Maximum number of full storeys.' UNION ALL
  SELECT 'building_form',NULL,'open','category','Plan drawing: o','Open construction.' UNION ALL
  SELECT 'house_type',NULL,'single_or_double_houses_only',NULL,'Text stipulation 2','Only detached or semi-detached houses.' UNION ALL
  SELECT 'eaves_absolute_max',47.3,NULL,'m NHN','Text stipulation 4','Absolute eaves elevation; not building height.' UNION ALL
  SELECT 'ridge_absolute_max',48.8,NULL,'m NHN','Text stipulation 4','Absolute ridge elevation; not building height.' UNION ALL
  SELECT 'tree_planting_rate',1,NULL,'tree per 250 sqm parcel area','Text stipulation 7','Hermsdorf woodland-character species; existing qualifying trees count.'
) v
WHERE d.plan_key='XX-247-1';

UPDATE parcel_development_profiles
SET legal_land_use_code='general_residential',legal_land_use_label='Allgemeines Wohngebiet (WA)',
    permitted_uses_json=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_qualified_single_zone_v1' AND r.rule_type='permitted_uses'),
    legal_grz=0.2,legal_gfz=0.4,legal_storeys_max=2,building_form='open',
    max_principal_footprint_sqm=round((SELECT p.area_sqm*0.2 FROM parcels p WHERE p.id=parcel_development_profiles.parcel_id),2),
    max_legal_floor_area_sqm=round((SELECT p.area_sqm*0.4 FROM parcels p WHERE p.id=parcel_development_profiles.parcel_id),2),
    other_constraints_json=(SELECT json_group_array(json_object('type',r.rule_type,'value',coalesce(r.numeric_value,r.text_value),'unit',r.unit,'citation',r.legal_citation,'sourceLocator',r.source_locator)) FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_qualified_single_zone_v1' AND r.rule_type NOT IN ('land_use','permitted_uses','grz','gfz','storeys_max','building_form')),
    resolution_confidence='high',review_status='manually_verified',
    unresolved_fields_json='["exact_buildable_footprint","setback_lines","authority_confirmation","other_constraints"]',
    notes=(SELECT json_object('resolutionMethod','bplan_manual_qualified_single_zone_v1','status','core_zone_rules_manually_verified','planKey',d.plan_key,'scopeCoverageRatio',ps.coverage_ratio,'caveat','Official sheet visually reviewed. Core WA, GRZ, GFZ, storeys and building form are parcel-matched; exact drawn building envelope and authority confirmation remain outstanding.') FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND d.plan_key='XX-247-1'),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key='XX-247-1');

COMMIT;
