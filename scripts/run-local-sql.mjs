#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { localD1Path } from "./local-d1-path.mjs";

const sqlFile = process.argv[2];
if (!sqlFile) throw new Error("Usage: node scripts/run-local-sql.mjs <file.sql>");
const database = await localD1Path();
const result = spawnSync("sqlite3", [database, `.read ${resolve(sqlFile)}`], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
