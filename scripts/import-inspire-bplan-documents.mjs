#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL="https://gdi.berlin.de/services/wfs/plu_bplan";const TYPE_NAME="plu_bplan:OfficialDocumentation";
function option(name,fallback){const p=`--${name}=`;return process.argv.find((v)=>v.startsWith(p))?.slice(p.length)??fallback}
function values(value){return value==null?[]:Array.isArray(value)?value:[value]}
function citationDate(citation){return citation?.date?.CI_Date?.date??null}
function cleanDate(value){const text=String(value??"").trim();return /^\d{4}-\d{2}-\d{2}Z?$/.test(text)?text.replace(/Z$/,""):null}
function cleanUrl(value){try{return new URL(String(value)).toString()}catch{return null}}
export function normalizeOfficialDocumentation(feature,collectionTimestamp){const p=feature.properties??{};const rows=[];
  for(const wrapped of values(p.planDocument)){const c=wrapped?.DocumentCitation??wrapped;const planKey=String(c?.name??"").trim();const url=cleanUrl(c?.link);if(planKey&&url)rows.push({planKey,assetType:"plan_sheet",url,retrievalStatus:"pending",ocrStatus:"pending",extractionStatus:"pending",metadata:{sourceKey:"berlin-plu-bplan-wfs",sourceFeatureId:feature.id,officialDocumentDate:cleanDate(citationDate(c)),collectionTimestamp}})}
  for(const wrapped of values(p.legislationCitation)){const c=wrapped?.LegislationCitation??wrapped;const fallbackPlan=rows[0]?.planKey??String(feature.id??"").match(/SP_(.+)_$/)?.[1]?.replaceAll("_","/");const url=cleanUrl(c?.link);if(fallbackPlan&&url)rows.push({planKey:fallbackPlan,assetType:"rationale",url,retrievalStatus:"pending",ocrStatus:"pending",extractionStatus:"pending",dateEnteredIntoForce:cleanDate(c?.dateEnteredIntoForce),metadata:{sourceKey:"berlin-plu-bplan-wfs",sourceFeatureId:feature.id,legislationName:c?.name??null,legislationDate:cleanDate(citationDate(c)),dateEnteredIntoForce:cleanDate(c?.dateEnteredIntoForce),collectionTimestamp}})}
  return rows;
}
async function fetchPage(startIndex,count){const url=new URL(WFS_URL);url.search=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:TYPE_NAME,outputFormat:"application/json",startIndex:String(startIndex),count:String(count)}).toString();const response=await fetch(url,{headers:{"user-agent":"Grounded-Berlin-INSPIRE-document-import/1.0"}});if(!response.ok)throw new Error(`INSPIRE B-Plan WFS returned ${response.status}`);return response.json()}
async function main(){const outputPath=resolve(option("output","data/import/inspire-bplan-documents.ndjson"));const pageSize=Number(option("page-size","1000"));await mkdir(dirname(outputPath),{recursive:true});const output=createWriteStream(outputPath,{encoding:"utf8"});let start=0,matched=Infinity,features=0,assets=0;const seen=new Set();
  while(start<matched){const page=await fetchPage(start,pageSize);matched=Number(page.numberMatched??page.totalFeatures??0);for(const feature of page.features??[]){features+=1;for(const row of normalizeOfficialDocumentation(feature,page.timeStamp)){if(seen.has(row.url))continue;seen.add(row.url);output.write(`${JSON.stringify(row)}\n`);assets+=1}}if(!page.features?.length)break;start+=page.features.length;process.stderr.write(`Imported ${start} of ${matched} INSPIRE document records\r`)}
  await new Promise((done,reject)=>{output.end(done);output.on("error",reject)});process.stderr.write(`\nWrote ${assets} assets from ${features} official documentation records\n`)}
if(import.meta.url===`file://${process.argv[1]}`)main().catch((error)=>{console.error(error.message);process.exitCode=1});
