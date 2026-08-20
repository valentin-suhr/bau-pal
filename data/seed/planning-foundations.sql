BEGIN TRANSACTION;

INSERT INTO sources (source_key,title,publisher,source_type,url,licence,effective_from,metadata_json)
VALUES
  ('berlin-alkis-flurstuecke-wfs','ALKIS Flurstücke Berlin','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/alkis_flurstuecke','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official parcel geometry and attributes"}'),
  ('berlin-alkis-ortsteile-wfs','ALKIS Ortsteile Berlin','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/alkis_ortsteile','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official locality polygons; historical East/West routing derived as a non-legal proxy"}'),
  ('berlin-alkis-buildings-wfs','ALKIS Gebäude Berlin','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/alkis_gebaeude','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official building footprints and attributes used for non-binding settlement-context observations"}'),
  ('berlin-bplan-wfs','Bebauungsplanverfahren in Berlin','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/bplan','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official B-Plan scopes and procedure metadata"}'),
  ('berlin-plu-bplan-wfs','Geplante Bodennutzung im INSPIRE-Datenmodell (Bebauungspläne)','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/plu_bplan','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official INSPIRE SpatialPlan and OfficialDocumentation citations; does not expose internal zoning elements"}'),
  ('berlin-wall-1989-wfs','Verlauf der Berliner Mauer, 1989','Forum für Geschichte und Gegenwart e.V. / Geoportal Berlin','wfs','https://gdi.berlin.de/services/wfs/berlinermauer','Datenlizenz Deutschland - Zero - Version 2.0','2007-07-04','{"role":"independent historical East/West routing check; linework is explicitly not parcel-accurate and is not a legal BNP boundary"}'),
  ('berlin-fnp-current-wfs','FNP Berlin, aktuelle Arbeitskarte','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/fnp_ak','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official preparatory land-use evidence; does not determine BauGB section 34 or 35"}'),
  ('berlin-bnp-atom','Baunutzungsplan 1958/60 - georeferenced download','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','atom','https://gdi.berlin.de/data/bnp/atom/','Datenlizenz Deutschland - Zero - Version 2.0','1961-06-30','{"crs":"EPSG:25833","pixel_size_m":1.5875,"content_sha256":"bede1e55d682a283304149fd5877010e06804586baf01ab26fa6fb0601f0faef"}'),
  ('berlin-bnp-wms','Baunutzungsplan 1958/60 WMS','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wms','https://gdi.berlin.de/services/wms/bnp','Datenlizenz Deutschland - Zero - Version 2.0','1961-06-30','{"layer":"bnp","crs":"EPSG:25833"}'),
  ('berlin-bo58-continuing','Fortgeltende städtebauliche Vorschriften der Bauordnung für Berlin von 1958','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','pdf','https://www.berlin.de/sen/stadt/_assets/service/rechtsvorschriften/bereich-bauen/bo-58.pdf',NULL,'1958-11-21','{"role":"official continuing BO 1958 planning provisions used with the Baunutzungsplan","content_sha256":"6495312f8b7a7c029953b572dc5a15669d3bed08a8023cfd74757035d2e55ac5","byte_size":41767}'),
  ('berlin-fluchtlinien-wms','Fluchtlinien Berlin WMS','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wms','https://gdi.berlin.de/services/wms/fluchtlinien','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"informational georeferenced building and street lines; district confirmation may be required"}')
  ,('berlin-fluchtlinien-wfs','Fluchtlinien Berlin WFS','Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin','wfs','https://gdi.berlin.de/services/wfs/fluchtlinien','Datenlizenz Deutschland - Zero - Version 2.0',NULL,'{"role":"official vector line features published as an informational georeferenced dataset; district confirmation may be required"}')
ON CONFLICT(source_key) DO UPDATE SET title=excluded.title,publisher=excluded.publisher,source_type=excluded.source_type,url=excluded.url,licence=excluded.licence,effective_from=excluded.effective_from,metadata_json=excluded.metadata_json,retrieved_at=CURRENT_TIMESTAMP;

INSERT INTO planning_documents (plan_key,title,plan_type,status,effective_from,source_id,notes)
SELECT 'BNP-1958-60','Baunutzungsplan Berlin 1958/60','baunutzungsplan','in_force','1961-06-30',id,'Applies in former West Berlin where not displaced; must be evaluated with BO 1958, surviving building/street lines, later transition plans and any other amendments.'
FROM sources WHERE source_key='berlin-bnp-atom'
ON CONFLICT(plan_key) DO UPDATE SET title=excluded.title,plan_type=excluded.plan_type,status=excluded.status,effective_from=excluded.effective_from,source_id=excluded.source_id,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP;

INSERT INTO planning_codebook_entries (document_id,codebook_key,code,rule_type,numeric_value,source_id,source_locator,confidence,review_status)
SELECT d.id,'bnp_baustufe',v.code,v.rule_type,v.numeric_value,s.id,'Baunutzungsplan legend: Maß der Nutzung','official','manually_verified'
FROM planning_documents d
JOIN sources s ON s.source_key='berlin-bnp-atom'
JOIN (
  SELECT 'II/1' code,'storeys_max' rule_type,2.0 numeric_value UNION ALL SELECT 'II/1','grz',0.1 UNION ALL SELECT 'II/1','gfz',0.2 UNION ALL SELECT 'II/1','bmz',0.8 UNION ALL
  SELECT 'II/2','storeys_max',2.0 UNION ALL SELECT 'II/2','grz',0.2 UNION ALL SELECT 'II/2','gfz',0.4 UNION ALL SELECT 'II/2','bmz',1.6 UNION ALL
  SELECT 'II/3','storeys_max',2.0 UNION ALL SELECT 'II/3','grz',0.3 UNION ALL SELECT 'II/3','gfz',0.6 UNION ALL SELECT 'II/3','bmz',2.4 UNION ALL
  SELECT 'III/3','storeys_max',3.0 UNION ALL SELECT 'III/3','grz',0.3 UNION ALL SELECT 'III/3','gfz',0.9 UNION ALL SELECT 'III/3','bmz',3.6 UNION ALL
  SELECT 'IV/3','storeys_max',4.0 UNION ALL SELECT 'IV/3','grz',0.3 UNION ALL SELECT 'IV/3','gfz',1.2 UNION ALL SELECT 'IV/3','bmz',4.8 UNION ALL
  SELECT 'V/3','storeys_max',5.0 UNION ALL SELECT 'V/3','grz',0.3 UNION ALL SELECT 'V/3','gfz',1.5 UNION ALL SELECT 'V/3','bmz',6.0 UNION ALL
  SELECT '6','grz',0.6 UNION ALL SELECT '6','bmz',8.4
) v
WHERE d.plan_key='BNP-1958-60'
ON CONFLICT(document_id,codebook_key,code,rule_type) DO UPDATE SET numeric_value=excluded.numeric_value,source_id=excluded.source_id,source_locator=excluded.source_locator,confidence=excluded.confidence,review_status=excluded.review_status;

INSERT INTO planning_codebook_entries (document_id,codebook_key,code,rule_type,numeric_value,text_value,source_id,source_locator,confidence,review_status)
SELECT d.id,'bnp_baustufe',v.code,v.rule_type,v.numeric_value,v.text_value,s.id,v.source_locator,'official','manually_verified'
FROM planning_documents d
JOIN sources s ON s.source_key='berlin-bo58-continuing'
JOIN (
  SELECT 'II/1' code,'building_form' rule_type,NULL numeric_value,'open' text_value,'BO 58 § 7 Nr. 16' source_locator UNION ALL
  SELECT 'II/2','building_form',NULL,'open','BO 58 § 7 Nr. 16' UNION ALL
  SELECT 'II/3','building_form',NULL,'closed','BO 58 § 7 Nr. 16' UNION ALL
  SELECT 'III/3','building_form',NULL,'closed','BO 58 § 7 Nr. 16' UNION ALL
  SELECT 'IV/3','building_form',NULL,'closed','BO 58 § 7 Nr. 16' UNION ALL
  SELECT 'V/3','building_form',NULL,'closed','BO 58 § 7 Nr. 16' UNION ALL
  SELECT '6','building_form',NULL,'closed','BO 58 § 7 Nr. 16' UNION ALL
  SELECT 'II/1','height_max_m',8.0,NULL,'BO 58 § 9 Nr. 5' UNION ALL
  SELECT 'II/2','height_max_m',8.0,NULL,'BO 58 § 9 Nr. 5' UNION ALL
  SELECT 'II/3','height_max_m',8.0,NULL,'BO 58 § 9 Nr. 5' UNION ALL
  SELECT 'III/3','height_max_m',12.0,NULL,'BO 58 § 9 Nr. 5' UNION ALL
  SELECT 'IV/3','height_max_m',16.0,NULL,'BO 58 § 9 Nr. 5' UNION ALL
  SELECT 'V/3','height_max_m',20.0,NULL,'BO 58 § 9 Nr. 5'
) v
WHERE d.plan_key='BNP-1958-60'
ON CONFLICT(document_id,codebook_key,code,rule_type) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,source_id=excluded.source_id,source_locator=excluded.source_locator,confidence=excluded.confidence,review_status=excluded.review_status;

INSERT INTO planning_codebook_entries (document_id,codebook_key,code,rule_type,text_value,source_id,source_locator,confidence,review_status)
SELECT d.id,'bnp_land_use_permitted_use',v.code,'land_use',v.uses_json,s.id,v.source_locator,'official','manually_verified'
FROM planning_documents d
JOIN sources s ON s.source_key='berlin-bo58-continuing'
JOIN (
  SELECT 'general_residential' code,'["residential buildings","shops","non-disruptive small businesses","restaurants","guesthouses","social, cultural, health, sports and public-administration buildings (discretionary)"]' uses_json,'BO 58 § 7 Nr. 8' source_locator UNION ALL
  SELECT 'mixed','["residential buildings","business and office buildings","shops","non-disruptive small businesses","social, cultural, health, sports and administration buildings","restaurants","hotels and guesthouses","entertainment and assembly venues","medium-sized commercial businesses (exceptional and non-disruptive)"]','BO 58 § 7 Nr. 9' UNION ALL
  SELECT 'restricted_work','["non-disruptive commercial businesses","administration buildings","business and office buildings","dwellings for supervisory and standby personnel"]','BO 58 § 7 Nr. 10' UNION ALL
  SELECT 'pure_work','["commercial and industrial businesses except uses prohibited throughout building areas","dwellings for supervisory and standby personnel"]','BO 58 § 7 Nr. 11' UNION ALL
  SELECT 'core','["business and office buildings including shops","social, cultural, health and sports buildings","restaurants","hotels and guesthouses","entertainment and assembly venues","dwellings for supervisory and standby personnel","other dwellings and non-disruptive businesses (discretionary)"]','BO 58 § 7 Nr. 12'
) v
WHERE d.plan_key='BNP-1958-60'
ON CONFLICT(document_id,codebook_key,code,rule_type) DO UPDATE SET text_value=excluded.text_value,source_id=excluded.source_id,source_locator=excluded.source_locator,confidence=excluded.confidence,review_status=excluded.review_status;

COMMIT;
