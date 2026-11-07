import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type Schema = Record<string, any>;

/** Hoist repeated schemas, including partial variants, into local draft-7 definitions. */
export function toolSchema(shape: z.ZodRawShape): Schema & { type: 'object' } {
  const schema = zodToJsonSchema(z.object(shape), { $refStrategy: 'none' }) as Schema;
  const counts = new Map<string, number>(), definitions: Record<string, Schema> = {}, names = new Map<string, string>();
  const children = (node: Schema, visit: (s: Schema) => Schema): Schema => {
    const out = { ...node };
    for (const key of ['properties', 'patternProperties', 'definitions']) if (node[key]) out[key] = Object.fromEntries(Object.entries(node[key]).map(([k, v]) => [k, visit(v as Schema)]));
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(node[key])) out[key] = node[key].map(visit);
    for (const key of ['items', 'additionalProperties', 'not']) if (node[key] && typeof node[key] === 'object') out[key] = Array.isArray(node[key]) ? node[key].map(visit) : visit(node[key]);
    return out;
  };
  const count = (node: Schema): Schema => {
    const key = JSON.stringify(node);
    if (key.length >= 180) counts.set(key, (counts.get(key) ?? 0) + 1);
    children(node, count);
    return node;
  };
  count(schema);
  const compact = (node: Schema): Schema => {
    const key = JSON.stringify(node);
    if ((counts.get(key) ?? 0) < 2) return children(node, compact);
    let name = names.get(key);
    if (!name) {
      name = `s${names.size + 1}`;
      names.set(key, name);
      definitions[name] = children(node, compact);
    }
    return { $ref: `#/definitions/${name}` };
  };
  return { ...children(schema, compact), type: 'object', definitions };
}
