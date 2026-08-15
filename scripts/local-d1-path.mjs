import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function localD1Path() {
  const directory = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const names = await readdir(directory);
  const databases = names.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (databases.length !== 1) throw new Error(`Expected one local D1 database, found ${databases.length}`);
  return resolve(directory, databases[0]);
}
