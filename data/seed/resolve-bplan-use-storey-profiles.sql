BEGIN TRANSACTION;

DELETE FROM planning_rules WHERE extraction_method='manual_plan_sheet_use_storey_profile_v1';
DELETE FROM planning_zones WHERE geometry_method='manual_plan_sheet_use_storey_parcel_match_v1';

INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,'reviewed-use-storey-parcel',CASE d.plan_key WHEN 'I-55' THEN 'Kerngebiet (MK)' ELSE 'Allgemeines Wohngebiet (WA)' END,
  p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,'manual_plan_sheet_use_storey_parcel_match_v1','medium'
FROM planning_documents d JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99 JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key IN ('I-55','XX-264') AND (SELECT count(DISTINCT x.parcel_id) FROM parcel_planning_segments x WHERE x.document_id=d.id AND x.is_controlling=1)=1;

INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator)
SELECT d.id,z.id,'parcel_composite_rule',v.rule_type,v.numeric_value,v.text_value,v.unit,v.legal_citation,v.interpretation,
  'manual_plan_sheet_use_storey_profile_v1','medium','manually_verified',d.source_id,
  a.url || '#page=1; visually reviewed use and storey subareas; sha256 ' || a.content_hash_sha256
FROM planning_documents d JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_plan_sheet_use_storey_parcel_match_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT 'I-55' plan_key,'land_use' rule_type,NULL numeric_value,'core' text_value,NULL unit,'Plan drawing: MK' legal_citation,'Kerngebiet across the parcel.' interpretation UNION ALL
  SELECT 'I-55','permitted_uses',NULL,'["business, office and administrative buildings","retail businesses, restaurants and lodging businesses","other non-materially-disruptive commercial businesses","church, cultural, social, health and sports facilities","parking-related filling stations under the incorporated BauNVO conditions","supervisory and standby staff dwellings; other dwellings only where exceptionally permitted"]',NULL,'Plan drawing MK with incorporated BauNVO §7','Use catalogue retains regular versus exceptional conditions; no plan-specific use exclusion is stated on the sheet.' UNION ALL
  SELECT 'I-55','storeys_max',7,NULL,'full storeys','Plan drawing: VII','Maximum anywhere on parcel; a smaller portion is marked I.' UNION ALL
  SELECT 'I-55','arcade_easement',NULL,'arcade at the height of the first full storey',NULL,'Text stipulation 2','Arcade area is subject to a public pedestrian easement.' UNION ALL
  SELECT 'XX-264','land_use',NULL,'general_residential',NULL,'Plan drawing: WA','Allgemeines Wohngebiet across the parcel.' UNION ALL
  SELECT 'XX-264','permitted_uses',NULL,'["residential buildings","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities","lodging businesses, other non-disruptive commercial businesses, administrative facilities, garden businesses and qualifying filling stations only where exceptionally permitted"]',NULL,'Plan drawing WA with incorporated BauNVO §4','Use catalogue retains regular versus exceptional conditions; no plan-specific use exclusion is stated on the sheet.' UNION ALL
  SELECT 'XX-264','storeys_max',5,NULL,'full storeys','Plan drawing: V','Maximum anywhere on parcel; other drawn portions are III and IV.' UNION ALL
  SELECT 'XX-264','storey_subareas',NULL,'["III","IV","V"]',NULL,'Plan drawing and Nebenzeichnung','Exact subarea geometry remains unresolved.' UNION ALL
  SELECT 'XX-264','green_roof_share_min',0.5,NULL,'share','Text stipulation 3','At least 50% of roof area must have an 18 cm minimum rooted grass/herb build-up, subject to stated exclusions.' UNION ALL
  SELECT 'XX-264','tree_planting_rate',1,NULL,'tree per 150 sqm unbuilt parcel area','Text stipulation 5','Existing trees count toward the requirement.'
) v ON v.plan_key=d.plan_key WHERE d.plan_key IN ('I-55','XX-264');

UPDATE parcel_development_profiles
SET legal_land_use_code=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_use_storey_profile_v1' AND r.rule_type='land_use'),
    legal_land_use_label=(SELECT z.label FROM parcel_planning_segments ps JOIN planning_zones z ON z.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND z.geometry_method='manual_plan_sheet_use_storey_parcel_match_v1'),
    permitted_uses_json=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_use_storey_profile_v1' AND r.rule_type='permitted_uses'),
    legal_storeys_max=CAST((SELECT r.numeric_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_use_storey_profile_v1' AND r.rule_type='storeys_max') AS INTEGER),
    other_constraints_json=(SELECT json_group_array(json_object('type',r.rule_type,'value',coalesce(r.numeric_value,r.text_value),'unit',r.unit,'citation',r.legal_citation,'sourceLocator',r.source_locator)) FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_use_storey_profile_v1' AND r.rule_type NOT IN ('land_use','permitted_uses','storeys_max')),
    resolution_confidence='medium',review_status='manually_verified',
    unresolved_fields_json='["internal_storey_subarea_geometry","principal_buildable_footprint","grz_not_expressly_fixed","gfz_not_expressly_fixed","building_form","authority_confirmation"]',
    notes=(SELECT json_object('resolutionMethod','bplan_manual_use_storey_profile_v1','status','land_use_catalogue_and_max_storeys_manually_verified','planKey',d.plan_key,'scopeCoverageRatio',ps.coverage_ratio,'caveat','Official sheet visually reviewed. Land-use catalogue and maximum storeys are parcel-matched; internal storey subareas, footprint, GRZ, GFZ and form remain unresolved.') FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND d.plan_key IN ('I-55','XX-264')),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key IN ('I-55','XX-264'));

COMMIT;
