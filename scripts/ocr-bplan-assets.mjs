import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createWorker, OEM } from "tesseract.js";
import germanData from "@tesseract.js-data/deu";

const value = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const inputs = value("inputs", "data/import/bplan-assets-batch200-text-[0-9]*.ndjson");
const output = path.resolve(value("output", "data/import/bplan-assets-ocr.ndjson"));
const textDir = path.resolve(value("text-dir", "data/documents/bplan-text-ocr"));
const dpi = Number(value("dpi", "180"));
const start = Number(value("start", "0"));
const limit = Number(value("limit", "0"));
const assetType = value("asset-type", "");

const safeName = (input) => String(input).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "") || "asset";
const expandInputs = (pattern) => {
  const directory = path.dirname(pattern);
  const basename = path.basename(pattern);
  const expression = new RegExp(`^${basename.replace(/[.+^${}()|\\]/g, "\\$&").replace("[0-9]*", "[0-9]+")}$`);
  return fs.readdirSync(directory).filter((name) => expression.test(name)).sort().map((name) => path.join(directory, name));
};

const assets = new Map();
for (const filename of expandInputs(inputs)) {
  for (const line of fs.readFileSync(filename, "utf8").split("\n")) {
    if (line.trim()) {
      const row = JSON.parse(line);
      assets.set(row.url, row);
    }
  }
}
let queue = [...assets.values()]
  .filter((row) => row.retrievalStatus === "downloaded" && row.ocrStatus === "pending" && (!assetType || row.assetType === assetType))
  .sort((a, b) => (a.priorityRank ?? Number.MAX_SAFE_INTEGER) - (b.priorityRank ?? Number.MAX_SAFE_INTEGER)
    || `${a.planKey}|${a.assetType}|${a.url}`.localeCompare(`${b.planKey}|${b.assetType}|${b.url}`));
queue = queue.slice(start, limit ? start + limit : undefined);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(textDir, { recursive: true });
const destination = fs.openSync(output, "w");
const worker = await createWorker("deu", OEM.LSTM_ONLY, {
  langPath: germanData.langPath,
  gzip: germanData.gzip,
  cachePath: path.resolve(".cache/tesseract"),
  logger: () => {},
});
const counts = { complete: 0, failed: 0 };

for (const row of queue) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bplan-ocr-"));
  try {
    const prefix = path.join(temporary, "page");
    execFileSync("pdftoppm", ["-r", String(dpi), "-png", row.localPath, prefix], { stdio: "ignore" });
    const pages = fs.readdirSync(temporary).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (!pages.length) throw new Error("PDF renderer produced no pages");
    const texts = [];
    for (const page of pages) {
      const result = await worker.recognize(path.join(temporary, page));
      texts.push(result.data.text.trim());
    }
    const text = texts.map((pageText, index) => `--- page ${index + 1} ---\n${pageText}`).join("\n\n");
    const textPath = path.join(textDir, `${safeName(row.planKey)}--${row.assetType}.txt`);
    fs.writeFileSync(textPath, text, "utf8");
    Object.assign(row, {
      pageCount: texts.length,
      textPath,
      textCharacterCount: texts.reduce((sum, pageText) => sum + pageText.replace(/\s/g, "").length, 0),
      ocrStatus: "complete",
      extractionStatus: "machine_extracted",
      extractionVersion: `tesseract.js-deu-lstm-v1@${dpi}dpi`,
      error: null,
    });
    counts.complete += 1;
  } catch (error) {
    Object.assign(row, { ocrStatus: "failed", extractionStatus: "failed", error: String(error?.message ?? error) });
    counts.failed += 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  fs.writeSync(destination, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify({ planKey: row.planKey, assetType: row.assetType, ocrStatus: row.ocrStatus }));
}
await worker.terminate();
fs.closeSync(destination);
console.log(JSON.stringify({ queued: queue.length, ...counts }));
console.log(`Wrote OCR metadata to ${output}`);
