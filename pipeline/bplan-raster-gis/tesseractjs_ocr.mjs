#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createWorker, OEM, PSM } from "tesseract.js";
import germanData from "@tesseract.js-data/deu";

const [imagePath, outputPath] = process.argv.slice(2);
if (!imagePath || !outputPath) {
  throw new Error("Usage: node tesseractjs_ocr.mjs <image> <output.tsv>");
}

const worker = await createWorker("deu", OEM.LSTM_ONLY, {
  langPath: germanData.langPath,
  gzip: germanData.gzip,
  cachePath: path.resolve(".cache/tesseract"),
  logger: () => {},
});

try {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    user_defined_dpi: "300",
  });
  const result = await worker.recognize(imagePath, {}, { text: true, tsv: true });
  if (!result.data.tsv) throw new Error("Tesseract.js returned no TSV word data");
  fs.writeFileSync(outputPath, result.data.tsv, "utf8");
} finally {
  await worker.terminate();
}
