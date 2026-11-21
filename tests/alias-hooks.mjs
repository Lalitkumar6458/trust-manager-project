import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
// "@/lib/x" → src/lib/x.js, and "./constants" (no extension, as Next.js allows) → ./constants.js
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    let p = path.join(SRC, specifier.slice(2));
    if (!path.extname(p)) p += '.js';
    return next(pathToFileURL(p).href, context);
  }
  if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith(pathToFileURL(SRC).href)) {
    return next(`${specifier}.js`, context);
  }
  return next(specifier, context);
}
