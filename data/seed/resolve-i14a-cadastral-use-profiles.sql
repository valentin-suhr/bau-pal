BEGIN TRANSACTION;

DELETE FROM planning_zone_geometry_reviews WHERE NOT EXISTS (SELECT 1 FROM planning_zones z WHERE z.id=planning_zone_geometry_reviews.zone_id);
DELETE FROM planning_rules WHERE extraction_method='manual_i14a_cadastral_overlay_v1';
DELETE FROM planning_zone_geometry_reviews WHERE zone_id IN (SELECT id FROM planning_zones WHERE geometry_method='manual_i14a_cadastral_overlay_v1');
DELETE FROM planning_zones WHERE geometry_method='manual_i14a_cadastral_overlay_v1';

INSERT INTO planning_zones (
  document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence
)
SELECT d.id,
  'I-14a:parcel:' || p.numerator || ':' || CASE WHEN p.numerator='295' THEN 'wa2' ELSE 'wa1' END,
  CASE WHEN p.numerator='295' THEN 'Allgemeines Wohngebiet WA 2' ELSE 'Allgemeines Wohngebiet WA 1' END,
  p.geometry_geojson,p.bbox_west,p.bbox_south,p.bbox_east,p.bbox_north,
  'manual_i14a_cadastral_overlay_v1','medium'
FROM planning_documents d
JOIN parcel_planning_segments ps ON ps.document_id=d.id AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99
JOIN parcels p ON p.id=ps.parcel_id
WHERE d.plan_key='I-14a' AND p.flur='619' AND p.numerator IN ('293','295','296','297','298','299');

INSERT INTO planning_zone_geometry_reviews (
  zone_id,source_asset_id,source_page,trace_version,render_json,control_points_json,transform_json,
  residuals_json,rms_residual_m,max_residual_m,qa_thresholds_json,review_status,reviewed_at,updated_at
)
SELECT z.id,a.id,1,'manual_i14a_cadastral_overlay_v1',
  '{"dpi":200,"width":7087,"height":5356,"renderer":"pdftoppm","controlGridCrs":"EPSG:3068 DHDN / Soldner Berlin","controlArtifact":"data/georeferencing/bplans/I-14a.soldner-controls.json","geometryBasis":"current ALKIS parcel boundary visually matched to plan WA boundary"}',
  '[{"label":"25100_20200","pixel":[2544.406398316751,1904.8686821264018],"world":[13.405975821755325,52.50871329239038]},{"label":"25100_20100","pixel":[2544.484750961048,2691.6622624288366],"world":[13.405980320868338,52.507814640391004]},{"label":"25100_20000","pixel":[2544.5633028843613,3480.4569424020465],"world":[13.405984819743725,52.50691598825445]},{"label":"25100_19900","pixel":[2544.6416044514035,4266.73762033957],"world":[13.405989318381504,52.50601733598067]},{"label":"25200_20200","pixel":[3331.9129169792386,1905.613254112916],"world":[13.407448638718058,52.50871602848555]},{"label":"25200_20100","pixel":[3331.962520410267,2692.5952206991205],"world":[13.407453107792353,52.5078173763979]},{"label":"25200_20000","pixel":[3332.0121600334355,3480.1513927595715],"world":[13.407457576630607,52.50691872417305]},{"label":"25200_19900","pixel":[3332.0617407789973,4266.773443657086],"world":[13.407462045232847,52.506020071810994]},{"label":"25300_20200","pixel":[4118.562087503208,1906.35701549356],"world":[13.408921455863346,52.50871874625149]},{"label":"25300_20100","pixel":[4118.790015716902,2693.527408562082],"world":[13.408925894898912,52.50782009407614]},{"label":"25300_20000","pixel":[4119.017697292544,3479.846015136184],"world":[13.408930333700022,52.50692144176359]},{"label":"25300_19900","pixel":[4119.245565524587,4266.809256223714],"world":[13.408934772266704,52.506022789313846]},{"label":"25400_20200","pixel":[4906.328369039715,1907.1018330807829],"world":[13.410394273189981,52.508721445688195]},{"label":"25400_20100","pixel":[4906.345162907981,2694.460458505054],"world":[13.410398682186791,52.50782279342573]},{"label":"25400_20000","pixel":[4906.361908175604,3479.5405060990497],"world":[13.410403090950743,52.50692414102606]},{"label":"25400_19900","pixel":[4906.378700890697,4266.845066484254],"world":[13.410407499481845,52.50602548848922]}]',
  '{"longitude":[0.0000018708007510906052,5.4382617755820845e-9,13.401205383224962],"latitude":[3.962473028515379e-9,-0.000001141964196340467,52.51087926374692]}',
  '[0.08469345349150906,0.10285810301278112,0.13364486664018208,0.05217461295621727,0.044957716763181256,0.03620830239449968,0.054767333005920946,0.01636747557404454,0.050150687324876105,0.05511080451992417,0.0334821613377886,0.029024405218205637,0.06687355089306286,0.1189356906079159,0.11716157149644864,0.0704133671146273]',
  0.07489739371703986,0.13364486664018208,'{"maximumRmsResidualMetres":0.25,"maximumResidualMetres":0.5}',
  'manually_verified',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM planning_zones z
JOIN planning_documents d ON d.id=z.document_id
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
WHERE d.plan_key='I-14a' AND z.geometry_method='manual_i14a_cadastral_overlay_v1';

INSERT INTO planning_rules (
  document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,
  interpretation,extraction_method,confidence,review_status,source_id,source_locator
)
SELECT d.id,z.id,'zone_rule',v.rule_type,v.numeric_value,
  CASE WHEN v.rule_type='land_use' THEN CASE WHEN z.zone_key LIKE '%:wa2' THEN 'general_residential_wa2' ELSE 'general_residential_wa1' END
    WHEN v.rule_type='permitted_uses' THEN CASE WHEN z.zone_key LIKE '%:wa2'
      THEN '["socially funded residential buildings","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities","other non-disruptive commercial businesses and administrative facilities only where exceptionally permitted"]'
      ELSE '["residential buildings subject to WA1 occupancy and social-housing conditions","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities","other non-disruptive commercial businesses and administrative facilities only where exceptionally permitted"]' END
    ELSE CASE WHEN z.zone_key LIKE '%:wa2'
      THEN 'Only residential buildings constructed with social-housing funding are permitted.'
      ELSE 'At least one fifth of dwellings must be offered to older people with an occupancy right; the remaining plan-specific social-housing conditions and exception apply.' END END,
  v.unit,v.legal_citation,
  CASE WHEN v.rule_type='land_use' THEN 'The 0.13 m maximum-residual Soldner registration shows the current cadastral parcel wholly within the named WA subarea; parcel 295 is WA2 and parcels 293, 296, 297, 298 and 299 are WA1.'
    WHEN v.rule_type='permitted_uses' THEN 'BauNVO §4 use catalogue as narrowed by text stipulation 1; lodging businesses, garden businesses and filling stations are excluded.'
    ELSE CASE WHEN z.zone_key LIKE '%:wa2' THEN 'Plan-specific WA2 residential eligibility condition from text stipulation 15.' ELSE 'Plan-specific WA1 occupancy/funding condition from text stipulation 14; authority confirmation remains appropriate.' END END,
  'manual_i14a_cadastral_overlay_v1','medium','manually_verified',d.source_id,
  a.url || '#page=1; Soldner Berlin Netz 88, 16 controls, RMS 0.075 m, max residual 0.134 m; cadastral overlay visually reviewed; sha256 ' || a.content_hash_sha256
FROM planning_documents d
JOIN planning_zones z ON z.document_id=d.id AND z.geometry_method='manual_i14a_cadastral_overlay_v1'
JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
JOIN (
  SELECT 'land_use' rule_type,NULL numeric_value,NULL unit,'Plan drawing: WA 1 / WA 2' legal_citation UNION ALL
  SELECT 'permitted_uses',NULL,NULL,'Plan drawing WA; text stipulation 1; BauNVO §4' UNION ALL
  SELECT 'use_restriction',NULL,NULL,'Text stipulations 14-15'
) v
WHERE d.plan_key='I-14a';

INSERT INTO planning_document_zone_reviews (
  document_id,source_asset_id,trace_version,scope_partition_complete,land_use_complete,density_complete,
  height_complete,building_form_complete,other_constraints_complete,review_status,notes_json,reviewed_at,updated_at
)
SELECT d.id,a.id,'manual_i14a_cadastral_overlay_v1',0,0,0,0,0,0,'manually_verified',
  '{"resolved":["WA1 versus WA2 assignment for six controlling current ALKIS parcels using a 16-point Soldner registration"],"remaining":["full plan scope partition including traffic land","building-envelope/storey subareas","absolute NHN height subareas","roof, parking, easement and planting overlays","interpretation of GRZ exception clauses"]}',
  CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM planning_documents d JOIN planning_document_assets a ON a.document_id=d.id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
WHERE d.plan_key='I-14a'
ON CONFLICT(document_id) DO UPDATE SET
  source_asset_id=excluded.source_asset_id,trace_version=excluded.trace_version,
  scope_partition_complete=excluded.scope_partition_complete,land_use_complete=excluded.land_use_complete,
  density_complete=excluded.density_complete,height_complete=excluded.height_complete,
  building_form_complete=excluded.building_form_complete,other_constraints_complete=excluded.other_constraints_complete,
  review_status=excluded.review_status,notes_json=excluded.notes_json,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at;

UPDATE parcel_development_profiles
SET legal_land_use_code=CASE WHEN parcel_id='11000161900295____' THEN 'general_residential_wa2' ELSE 'general_residential_wa1' END,
    legal_land_use_label=CASE WHEN parcel_id='11000161900295____' THEN 'Allgemeines Wohngebiet WA 2' ELSE 'Allgemeines Wohngebiet WA 1' END,
    permitted_uses_json=CASE WHEN parcel_id='11000161900295____'
      THEN '["socially funded residential buildings","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities","other non-disruptive commercial businesses and administrative facilities only where exceptionally permitted"]'
      ELSE '["residential buildings subject to WA1 occupancy and social-housing conditions","shops, restaurants and non-disruptive craft businesses serving the area","church, cultural, social, health and sports facilities","other non-disruptive commercial businesses and administrative facilities only where exceptionally permitted"]' END,
    other_constraints_json=json_array(json_object('type','use_restriction','value',CASE WHEN parcel_id='11000161900295____' THEN 'Only residential buildings constructed with social-housing funding are permitted.' ELSE 'At least one fifth of dwellings must be offered to older people with an occupancy right; additional plan-specific social-housing conditions apply.' END,'citation',CASE WHEN parcel_id='11000161900295____' THEN 'Text stipulation 15' ELSE 'Text stipulation 14' END)),
    resolution_confidence='medium',review_status='manually_verified',
    unresolved_fields_json='["grz_base_value_and_exception_interpretation","gfz_not_expressly_fixed","building_envelope_geometry","storey_subareas","absolute_nhn_height_subareas","building_form","roof_parking_easement_and_planting_overlays","authority_confirmation"]',
    notes=json_object('resolutionMethod','manual_i14a_cadastral_overlay_v1','status','parcel_land_use_and_use_restriction_verified','planKey','I-14a','registrationRmsMetres',0.074897,'registrationMaxResidualMetres',0.133645,'caveat','Official sheet and registered ALKIS overlay visually reviewed. WA1/WA2 is parcel-matched; density, storeys, envelopes, absolute heights and other overlays remain unresolved.'),
    resolved_at=CURRENT_TIMESTAMP
WHERE parcel_id IN (
  SELECT p.id FROM parcels p JOIN parcel_planning_segments ps ON ps.parcel_id=p.id
  JOIN planning_documents d ON d.id=ps.document_id
  WHERE d.plan_key='I-14a' AND ps.is_controlling=1 AND ps.coverage_ratio>=0.99 AND p.flur='619' AND p.numerator IN ('293','295','296','297','298','299')
);

COMMIT;
