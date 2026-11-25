// Whether the person's Chrome has remote debugging on, which SNCF Connect's prices are read through (tools/sncf-api): Chrome
// writes its debugging port in a file of its profile while it is on, and the Python client reads that same file.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { trains } from "@/config";

export function chromeDebuggingOn({ home = homedir(), files = trains.sncfConnect.chromePortFiles }: { home?: string; files?: readonly string[] } = {}): boolean {
  return files.some((file) => existsSync(path.join(home, file)));
}
