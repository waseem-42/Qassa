import { expect, it } from 'vitest';
import { z } from 'zod';
import Ajv from 'ajv';
import { toolSchema } from '../src/tool-schema.ts';

it('hoists shared nested schemas once and preserves validation through local references', () => {
  const shared = z.object({ color: z.string(), keys: z.array(z.object({ t: z.number().min(0), v: z.number(), ease: z.enum(['smooth', 'hold']) })) });
  const schema = toolSchema({ ops: z.array(z.union([z.object({ op: z.literal('a'), value: shared }), z.object({ op: z.literal('b'), value: shared.optional() })])) });
  const validate = new Ajv({ strict: false }).compile(schema);
  expect(validate({ ops: [{ op: 'a', value: { color: 'red', keys: [{ t: 0, v: 1, ease: 'hold' }] } }, { op: 'b' }] })).toBe(true);
  expect(validate({ ops: [{ op: 'b', value: { color: 'red', keys: [{ t: -1, v: 1, ease: 'hold' }] } }] })).toBe(false);
  expect(JSON.stringify(schema).match(/"color"/g)).toHaveLength(2); // property + required, one definition
  expect(Object.keys(schema.definitions).length).toBeGreaterThan(0);
});
