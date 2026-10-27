import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录。src 与编译后的 dist 都在根下一级。 */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
