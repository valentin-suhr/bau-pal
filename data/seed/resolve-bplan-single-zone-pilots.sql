BEGIN TRANSACTION;

-- Two official, visually reviewed plan sheets whose in-force scope covers one
-- cadastral parcel at >=99% and contains one substantive special-use zone.
-- The parcel geometry is used as the matched dashboard zone, not as a claim
-- that it reproduces every drawn line on the plan sheet.
DELETE FROM planning_rules
WHERE extraction_method='manual_plan_sheet_single_zone_match_v1';

DELETE FROM planning_zones
WHERE geometry_method='manual_plan_sheet_single_zone_parcel_match_v1';

INSERT INTO planning_zones (
  document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,
  geometry_method,confidence
)
SELECT d.id,'single-special-use-zone',
  CASE d.plan_key WHEN '1-38VE' THEN 'SO Verbrauchermarkt' WHEN '1-45VE' THEN 'Großmarkt für Gastronomiebedarf und Lebensmittel' WHEN '1-16VE' THEN 'SO Bau- und Heimwerkermarkt mit Gartencenter' ELSE 'Gemeinbedarf Schule / Sporthalle' END,
  p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,
  'manual_plan_sheet_single_zone_parcel_match_v1','medium'
FROM planning_documents d
JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99
JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key IN ('1-16VE','1-38VE','1-45VE','I-20')
  AND (SELECT count(DISTINCT x.parcel_id) FROM parcel_planning_segments x WHERE x.document_id=d.id AND x.is_controlling=1)=1;

INSERT INTO planning_rules (
  document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,
  interpretation,extraction_method,confidence,review_status,source_id,source_locator
)
SELECT d.id,z.id,'zone_rule',v.rule_type,v.numeric_value,v.text_value,v.unit,v.legal_citation,
  v.interpretation,'manual_plan_sheet_single_zone_match_v1','medium','manually_verified',d.source_id,
  a.url || '#page=1; visually reviewed single-zone parcel match; sha256 ' || a.content_hash_sha256
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_plan_sheet_single_zone_parcel_match_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT '1-38VE' plan_key,'land_use' rule_type,NULL numeric_value,'special_retail_consumer_market' text_value,NULL unit,'Plan drawing and text stipulation 1' legal_citation,'SO Verbrauchermarkt; one substantive use zone across the matched parcel.' interpretation UNION ALL
  SELECT '1-38VE','permitted_uses',NULL,'["retail selling daily-needs goods (food, beverages, drugstore goods and pet food) and other consumer goods","other non-disruptive commercial businesses under BauNVO §4(3)(2)","restaurants and catering establishments"]',NULL,'Text stipulation 1','Total retail sales area max 4,700 m²; daily-needs goods must comprise at least 70%.' UNION ALL
  SELECT '1-38VE','sales_area_max',4700,NULL,'sqm','Text stipulation 1','Maximum total retail sales area.' UNION ALL
  SELECT '1-38VE','floor_area_max',6900,NULL,'sqm','Plan drawing: GF 6.900 m²','Absolute Geschossfläche maximum; this is not a GFZ.' UNION ALL
  SELECT '1-38VE','ancillary_total_coverage_cap',0.9,NULL,'ratio','Text stipulation 2','Cap applies after garages, parking, access, ancillary uses and below-ground structures; not treated as principal-building GRZ.' UNION ALL
  SELECT '1-38VE','height_absolute_max',50.6,NULL,'m NHN','Plan drawing: OK 50,6 m ü. NHN','Absolute elevation, not building height.' UNION ALL
  SELECT '1-16VE','land_use',NULL,'special_hardware_home_improvement_market_garden_centre',NULL,'Plan drawing and text stipulation 1','SO Bau- und Heimwerkermarkt mit Gartencenter; one substantive use zone across the matched parcel.' UNION ALL
  SELECT '1-16VE','permitted_uses',NULL,'["large-format hardware and home-improvement retail market with garden centre","listed ancillary ranges including automotive accessories, food entrance-area bakery, workwear and shoes, lighting, household goods, ceramics and glassware, pet supplies, bicycles and sporting/camping goods, antiques and musical instruments, subject to the plan-specific assortment limits"]',NULL,'Text stipulation 1','Absolute GF max 11,000 m²; enumerated central retail assortments together may not exceed 10% of total floor area.' UNION ALL
  SELECT '1-16VE','floor_area_max',11000,NULL,'sqm','Text stipulation 1 and plan drawing: GF 11.000 m²','Absolute Geschossfläche maximum; not converted to GFZ.' UNION ALL
  SELECT '1-16VE','total_footprint_cap',18390,NULL,'sqm','Text stipulation 4','Total permitted footprint after parking/access; not treated as principal-building GRZ.' UNION ALL
  SELECT '1-16VE','height_absolute_max',49,NULL,'m NHN','Plan drawing: OK 49,0 m ü. NHN','Absolute elevation; advertising structures may exceed by up to 3.5 m under stipulation 5.' UNION ALL
  SELECT '1-16VE','green_roof_min',3000,NULL,'sqm','Text stipulation 7','Extensive green-roof minimum.' UNION ALL
  SELECT 'I-20','land_use',NULL,'community_facility_school_sports_hall',NULL,'Plan drawing and text stipulation 1','Gemeinbedarfsfläche with purpose Schule / Sporthalle.' UNION ALL
  SELECT 'I-20','permitted_uses',NULL,'["school use","sports hall use excluding spectator sports events"]',NULL,'Text stipulation 1','Sports hall use for spectator events is expressly excluded.' UNION ALL
  SELECT 'I-20','height_subareas',NULL,'["OK 40 m above terrain","OK 45 m above terrain"]',NULL,'Plan drawing','Relative height subareas are retained without collapsing them into a parcel-wide building height.' UNION ALL
  SELECT 'I-20','green_roof_threshold',100,NULL,'sqm roof area','Text stipulation 3','Roofs larger than 100 m² must be greened, excluding technical equipment, lighting surfaces and terraces.' UNION ALL
  SELECT '1-45VE','land_use',NULL,'special_wholesale_market_food_gastronomy',NULL,'Plan drawing and text stipulation 1','Großmarkt für Gastronomiebedarf und Lebensmittel; one substantive use zone with named subareas.' UNION ALL
  SELECT '1-45VE','permitted_uses',NULL,'["wholesale market for gastronomy supplies and food","sales to businesses and other authorised commercial customers","one advertising installation within area W subject to the stated height limit"]',NULL,'Text stipulation 1','Maximum sales area 14,700 m²; retail sales to the general public are not permitted.' UNION ALL
  SELECT '1-45VE','sales_area_max',14700,NULL,'sqm','Text stipulation 1','Maximum total sales area.' UNION ALL
  SELECT '1-45VE','floor_area_max',24000,NULL,'sqm','Plan drawing: GF 24.000 qm','Absolute Geschossfläche maximum; this is not a GFZ.' UNION ALL
  SELECT '1-45VE','ancillary_total_coverage_cap',0.97,NULL,'ratio','Text stipulation 3','Cap applies after parking, access, ancillary uses and below-ground structures; not treated as principal-building GRZ.' UNION ALL
  SELECT '1-45VE','height_absolute_max',48,NULL,'m NHN','Plan drawing: OK 48,0 m über NHN','Main maximum elevation; subareas carry additional elevations and noise-wall rules.'
) v ON v.plan_key=d.plan_key
WHERE d.plan_key IN ('1-16VE','1-38VE','1-45VE','I-20');

UPDATE parcel_development_profiles
SET legal_land_use_code=(SELECT r.text_value FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND r.rule_type='land_use' AND r.extraction_method='manual_plan_sheet_single_zone_match_v1'),
    legal_land_use_label=(SELECT z.label FROM parcel_planning_segments ps JOIN planning_zones z ON z.document_id=ps.document_id WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1 AND z.geometry_method='manual_plan_sheet_single_zone_parcel_match_v1'),
    permitted_uses_json=(SELECT r.text_value FROM parcel_planning_segments ps
      JOIN planning_rules r ON r.document_id=ps.document_id AND r.rule_type='permitted_uses'
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_single_zone_match_v1'),
    max_legal_floor_area_sqm=(SELECT r.numeric_value FROM parcel_planning_segments ps
      JOIN planning_rules r ON r.document_id=ps.document_id AND r.rule_type='floor_area_max'
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_single_zone_match_v1'),
    other_constraints_json=(SELECT json_group_array(json_object(
      'type',r.rule_type,'value',coalesce(r.numeric_value,r.text_value),'unit',r.unit,
      'citation',r.legal_citation,'sourceLocator',r.source_locator))
      FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND r.extraction_method='manual_plan_sheet_single_zone_match_v1'
        AND r.rule_type NOT IN ('land_use','permitted_uses','floor_area_max')),
    resolution_confidence='medium', review_status='manually_verified',
    unresolved_fields_json='["principal_buildable_footprint","grz_not_expressly_fixed","gfz_not_expressly_fixed","storeys","building_form","subarea_constraints_confirmation"]',
    notes=(SELECT json_object(
      'resolutionMethod','bplan_manual_single_zone_pilot_v1',
      'status','parcel_matched_plan_sheet_rules_manual_confirmation_recommended',
      'planKey',d.plan_key,'scopeCoverageRatio',ps.coverage_ratio,
      'caveat','Official sheet visually reviewed. The controlling scope covers one parcel at >=99%; absolute GF and special use are resolved, while drawn footprint, storeys, form and subarea constraints remain unresolved.'
    ) FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id
      WHERE ps.parcel_id=parcel_development_profiles.parcel_id AND ps.is_controlling=1
        AND d.plan_key IN ('1-16VE','1-38VE','1-45VE','I-20')),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (
  SELECT ps.parcel_id FROM parcel_planning_segments ps JOIN planning_documents d ON d.id=ps.document_id
  WHERE ps.is_controlling=1 AND d.plan_key IN ('1-16VE','1-38VE','1-45VE','I-20')
);

COMMIT;
