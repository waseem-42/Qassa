import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// workspace packages from source, not via node_modules links (a renamed/moved repo keeps working)
const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));
export default defineConfig({ resolve: { alias: { '@edit/shared': src('shared'), '@edit/render': src('render') } } });
