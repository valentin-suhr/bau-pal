#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { dirname, extname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}
function nonnegativeInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new Error(`${name} must be a nonnegative integer`);
  return result;
}
function safeName(value) {
  return String(value).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "asset";
}
function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function extension(url, mimeType) {
  if (mimeType?.includes("pdf")) return ".pdf";
  if (mimeType?.includes("html")) return ".html";
  const ext = extname(new URL(url).pathname).toLowerCase();
  return [".pdf", ".html", ".htm", ".txt"].includes(ext) ? ext : ".bin";
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
async function readRows(path) {
  const rows = [];
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}

async function retrieve(row, root) {
  const base = `${safeName(row.planKey)}--${row.assetType}`;
  const known = [".pdf", ".html", ".htm", ".txt", ".bin"].map((ext) => resolve(root, `${base}${ext}`));
  let prior = null;
  for (const path of known) {
    if (await exists(path)) { prior = path; break; }
  }
  if (prior && await exists(prior)) {
    const buffer = await readFile(prior);
    const priorExtension = extname(prior).toLowerCase();
    const inferredMimeType = priorExtension === ".pdf" ? "application/pdf"
      : [".html", ".htm"].includes(priorExtension) ? "text/html"
        : priorExtension === ".txt" ? "text/plain" : "application/octet-stream";
    return {
      ...row,
      retrievalStatus: "downloaded",
      mimeType: row.mimeType || inferredMimeType,
      localPath: prior,
      byteSize: buffer.length,
      contentHashSha256: sha256(buffer),
      error: null,
    };
  }
  try {
    const retries = positiveInteger(option("retries", "3"), "retries");
    let response, attempts = 0;
    while (attempts < retries) {
      attempts += 1;
      response = await fetch(row.url, {
        redirect: "follow",
        headers: { "user-agent": "Grounded-Berlin-legal-document-archive/1.0" },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status !== 429 || attempts >= retries) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : Math.min(2 ** attempts * 1000, 10_000);
      await response.body?.cancel(); await wait(delay);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || null;
    if (!response.ok) {
      return { ...row, retrievalStatus: response.status === 404 ? "not_found" : response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "failed", mimeType, retrievalAttempts: attempts, error: `HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const localPath = resolve(root, `${base}${extension(response.url || row.url, mimeType)}`);
    await writeFile(localPath, buffer);
    return {
      ...row, url: response.url || row.url, retrievalStatus: "downloaded", mimeType,
      contentHashSha256: sha256(buffer), byteSize: buffer.length, localPath,
      sourceModifiedAt: response.headers.get("last-modified"), retrievedAt: new Date().toISOString(), retrievalAttempts: attempts, error: null,
    };
  } catch (error) {
    try {
      // Node fetch does not inherit every desktop/network proxy configuration.
      // Curl is the deterministic fallback available in the workspace runtime.
      const { stdout } = await execFileAsync("curl", [
        "--location", "--fail", "--silent", "--show-error",
        "--max-time", "90", row.url,
      ], { encoding: null, maxBuffer: 256 * 1024 * 1024 });
      const buffer = Buffer.from(stdout);
      const mimeType = row.mimeType || (new URL(row.url).pathname.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      const localPath = resolve(root, `${base}${extension(row.url, mimeType)}`);
      await writeFile(localPath, buffer);
      return {
        ...row,
        retrievalStatus: "downloaded",
        mimeType,
        contentHashSha256: sha256(buffer),
        byteSize: buffer.length,
        localPath,
        retrievedAt: new Date().toISOString(),
        retrievalAttempts: 1,
        metadata: { ...(row.metadata ?? {}), retrievalMethod: "curl_fallback_after_fetch_failure" },
        error: null,
      };
    } catch (fallbackError) {
      const primary = error instanceof Error ? error.message : String(error);
      const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return { ...row, retrievalStatus: "failed", error: `fetch: ${primary}; curl fallback: ${fallback}` };
    }
  }
}

async function main() {
  const input = option("input", "data/import/bplan-assets.ndjson");
  const output = resolve(option("output", "data/import/bplan-assets-enriched.ndjson"));
  const root = resolve(option("documents", "data/documents/bplans"));
  const concurrency = positiveInteger(option("concurrency", "4"), "concurrency");
  const delayMs = nonnegativeInteger(option("delay-ms", "0"), "delay-ms");
  const limitText = option("limit", "");
  const limit = limitText ? positiveInteger(limitText, "limit") : Infinity;
  const types = new Set(option("types", "plan_sheet,rationale").split(",").filter(Boolean));
  await mkdir(root, { recursive: true });
  await mkdir(dirname(output), { recursive: true });
  const rows = (await readRows(input)).filter((row) => types.has(row.assetType)).slice(0, limit);
  const results = new Array(rows.length);
  let cursor = 0;
  let checkpoint = Promise.resolve();
  const saveCheckpoint = () => {
    checkpoint = checkpoint.then(() => {
      const completed = results.filter(Boolean);
      return writeFile(output, completed.map((row) => JSON.stringify(row)).join("\n") + (completed.length ? "\n" : ""));
    });
    return checkpoint;
  };
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await retrieve(rows[index], root);
      await saveCheckpoint();
      if ((index + 1) % 25 === 0 || index + 1 === rows.length) process.stderr.write(`Retrieved ${index + 1} of ${rows.length}\r`);
      if (delayMs > 0 && cursor < rows.length) await wait(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  await checkpoint;
  const status = results.reduce((counts, row) => ({ ...counts, [row.retrievalStatus]: (counts[row.retrievalStatus] ?? 0) + 1 }), {});
  process.stderr.write(`\n${JSON.stringify(status)}\nWrote ${results.length} asset records to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
