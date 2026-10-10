/**
 * Resolve a dataset path shipped in the repo's datasets/ folder.
 *
 * Works whether the script runs from the repo root, from server/, or via
 * `npm run ... --workspace server`. Environment variables and explicit
 * CLI arguments always win; this only supplies the default.
 */
import fs from 'node:fs';
import path from 'node:path';

export function resolveDataset(fileName: string, envPath?: string): string {
  if (envPath) return envPath;
  const candidates = [
    // <root>/server/src/scripts/this-file.ts -> <root>/datasets/<file>
    path.resolve(import.meta.dirname, '../../../datasets', fileName),
    path.resolve(process.cwd(), 'datasets', fileName),
    path.resolve(process.cwd(), '../datasets', fileName),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}
