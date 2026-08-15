import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const measures = `
  count(*) AS total,
  sum(p.geometry_geojson IS NOT NULL AND p.centroid_lng IS NOT NULL AND p.centroid_lat IS NOT NULL AND p.borough IS NOT NULL) AS geometryLocation,
  sum(j.parcel_id IS NOT NULL) AS workflowRouted,
  sum(d.primary_regime!='unresolved') AS statutoryRegimeResolved,
  sum(d.legal_basis!='unresolved') AS legalBasisRouted,
  sum(d.legal_land_use_code IS NOT NULL AND d.legal_land_use_label IS NOT NULL) AS landUse,
  sum(d.permitted_uses_json!='[]') AS permittedUses,
  sum(d.legal_grz IS NOT NULL) AS grz,
  sum(d.legal_gfz IS NOT NULL) AS gfz,
  sum(d.legal_storeys_max IS NOT NULL) AS storeys,
  sum(d.building_form IS NOT NULL) AS buildingForm,
  sum(d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL) AS completeCoreProfile`;
const joins = `FROM parcels p
  LEFT JOIN parcel_jurisdiction_contexts j ON j.parcel_id=p.id
  LEFT JOIN parcel_development_profiles d ON d.parcel_id=p.id`;

export async function GET() {
  if (!env.DB) return Response.json({ error: "Parcel database is not configured" }, { status: 503 });
  try {
    const [citywideResult, boroughResult, workflowResult] = await env.DB.batch([
      env.DB.prepare(`SELECT ${measures} ${joins}`),
      env.DB.prepare(`SELECT p.borough,${measures} ${joins} GROUP BY p.borough ORDER BY p.borough`),
      env.DB.prepare("SELECT workflow,count(*) AS parcels FROM parcel_jurisdiction_contexts GROUP BY workflow ORDER BY parcels DESC"),
    ]);
    return Response.json({
      citywide: citywideResult.results?.[0] ?? null,
      boroughs: boroughResult.results ?? [],
      workflows: workflowResult.results ?? [],
      definitions: {
        workflowRouted: "Sourced routing to a planning-law workflow; not necessarily a final statutory determination.",
        completeCoreProfile: "Resolved land use and permitted uses plus legal GRZ, GFZ, maximum storeys and building form.",
      },
      caveat: "Coverage describes existing evidence fields. Missing values remain unresolved; populated screening values are not a building-permit assessment.",
    });
  } catch (error) {
    return Response.json({ error: "Coverage query failed", detail: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}
