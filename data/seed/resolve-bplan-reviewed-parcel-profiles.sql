BEGIN TRANSACTION;

DELETE FROM planning_rules WHERE extraction_method='manual_plan_sheet_composite_parcel_match_v1';
DELETE FROM planning_zones WHERE geometry_method='manual_plan_sheet_composite_parcel_match_v1';

INSERT INTO planning_zones (
  document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,
  geometry_method,confidence
)
SELECT d.id,'reviewed-composite-parcel',
  CASE d.plan_key WHEN '1-89VE' THEN 'Areas A and B' ELSE 'Hotel und Boardinghouse with height subareas' END,
  p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,
  'manual_plan_sheet_composite_parcel_match_v1','medium'
FROM planning_documents d
JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99
JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key IN ('1-89VE','I-43bVE')
  AND (SELECT count(DISTINCT x.parcel_id) FROM parcel_planning_segments x WHERE x.document_id=d.id AND x.is_controlling=1)=1;

INSERT INTO planning_rules (
  document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,
  interpretation,extraction_method,confidence,review_status,source_id,source_locator
)
SELECT d.id,z.id,'parcel_composite_rule',v.rule_type,v.numeric_value,v.text_value,v.unit,v.legal_citation,
  v.interpretation,'manual_plan_sheet_composite_parcel_match_v1','medium','manually_verified',d.source_id,
  a.url || '#page=1; visually reviewed composite parcel match; sha256 ' || a.content_hash_sha256
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_plan_sheet_composite_parcel_match_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT '1-89VE' plan_key,'land_use' rule_type,NULL numeric_value,'residential_area_a_and_commercial_mixed_area_b' text_value,NULL unit,'Plan drawing and text stipulations 1-4' legal_citation,'Parcel contains distinct areas A and B; uses remain conditional by drawn subarea.' interpretation UNION ALL
  SELECT '1-89VE','permitted_uses',NULL,'["Area A: residential buildings; rooms for liberal professions exceptionally","Area B: business and office buildings","Area B: restaurants and lodging businesses","Area B: dwellings only on the sixth and seventh full storeys","Area B exceptional: retail, other commercial businesses, administrative facilities and entertainment venues under BauNVO §4a(3)(2)"]',NULL,'Text stipulations 1-4','Conditional use list; not every use applies to every part of the parcel.' UNION ALL
  SELECT '1-89VE','floor_area_max',24600,NULL,'sqm','Plan drawing: GF 24.600 m²','Parcel-wide absolute Geschossfläche maximum; not converted to GFZ.' UNION ALL
  SELECT '1-89VE','storeys_max',7,NULL,'full storeys','Plan drawing: VII','Maximum anywhere on parcel; area A/B and drawn footprint remain spatially distinct.' UNION ALL
  SELECT '1-89VE','ancillary_total_footprint_cap',6141,NULL,'sqm','Text stipulation 6','Total footprint cap after underground garages, access and ancillary uses; not principal-building GRZ.' UNION ALL
  SELECT '1-89VE','green_roof_min',2230,NULL,'sqm','Text stipulation 10','Extensive green-roof minimum; substrate at least 0.1 m.' UNION ALL
  SELECT '1-89VE','landscaped_garage_deck_min',1200,NULL,'sqm','Text stipulation 11','Area over underground garage to be landscaped; substrate at least 0.8 m.' UNION ALL
  SELECT 'I-43bVE','land_use',NULL,'special_hotel_and_boardinghouse',NULL,'Plan drawing and text stipulations 1-2','Single special use with distinct height/storey subareas.' UNION ALL
  SELECT 'I-43bVE','permitted_uses',NULL,'["hotel and boardinghouse lodging businesses","restaurants and catering establishments","conference and event rooms","fitness, health and recreation facilities","retail only on the first full storey up to 500 m² floor area","offices above the seventh full storey exceptionally, up to 5,000 m² floor area"]',NULL,'Text stipulations 1-2','Parcel-specific use list with express floor and storey conditions.' UNION ALL
  SELECT 'I-43bVE','floor_area_max',23400,NULL,'sqm','Plan drawing: GF 23.400 m²','Parcel-wide absolute Geschossfläche maximum; not converted to GFZ.' UNION ALL
  SELECT 'I-43bVE','storeys_max',21,NULL,'full storeys','Plan drawing: XXI','Maximum anywhere on parcel; other portions show IV, VII and XV.' UNION ALL
  SELECT 'I-43bVE','retail_floor_area_max',500,NULL,'sqm','Text stipulation 1.2','Retail only on first full storey.' UNION ALL
  SELECT 'I-43bVE','upper_office_floor_area_max',5000,NULL,'sqm','Text stipulation 2.1','Offices above seventh full storey only by exception.' UNION ALL
  SELECT 'I-43bVE','height_subareas',NULL,'["OK 21.5-22.5 m above pavement","OK 36.0 m above pavement","OK 48.5 m above pavement","OK 68.0 m above pavement"]',NULL,'Plan drawing and text stipulation 4','Relative elevation rules require subarea geometry and are not collapsed into legal_height_max_m.'
) v ON v.plan_key=d.plan_key
WHERE d.plan_key IN ('1-89VE','I-43bVE');

UPDATE parcel_development_profiles
SET legal_land_use_code=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.extraction_method='manual_plan_sheet_composite_parcel_match_v1' AND r.rule_type='land_use'),
    legal_land_use_label=(SELECT z.label FROM parcel_planning_segments ps JOIN planning_zones z ON z.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND z.geometry_method='manual_plan_sheet_composite_parcel_match_v1'),
    permitted_uses_json=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_composite_parcel_match_v1' AND r.rule_type='permitted_uses'),
    legal_storeys_max=CAST((SELECT r.numeric_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_composite_parcel_match_v1' AND r.rule_type='storeys_max') AS INTEGER),
    max_legal_floor_area_sqm=(SELECT r.numeric_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_composite_parcel_match_v1' AND r.rule_type='floor_area_max'),
    other_constraints_json=(SELECT json_group_array(json_object('type',r.rule_type,'value',coalesce(r.numeric_value,r.text_value),'unit',r.unit,'citation',r.legal_citation,'sourceLocator',r.source_locator))
      FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_composite_parcel_match_v1'
        AND r.rule_type NOT IN ('land_use','permitted_uses','floor_area_max','storeys_max')),
    resolution_confidence='medium',review_status='manually_verified',
    unresolved_fields_json='["internal_subarea_geometry","principal_buildable_footprint","grz_not_expressly_fixed","gfz_not_expressly_fixed","building_form","subarea_height_and_use_assignment"]',
    notes=(SELECT json_object('resolutionMethod','bplan_manual_composite_parcel_v1','status','parcel_wide_maxima_and_conditional_uses_manually_verified','planKey',d.plan_key,'scopeCoverageRatio',ps.coverage_ratio,'caveat','Official sheet visually reviewed. Parcel-wide absolute GF and maximum storeys are resolved; conditional uses and height rules retain their named/drawn subareas, whose geometry remains unresolved.')
      FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND d.plan_key IN ('1-89VE','I-43bVE')),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id WHERE ps.is_controlling=1 AND d.plan_key IN ('1-89VE','I-43bVE'));

COMMIT;
