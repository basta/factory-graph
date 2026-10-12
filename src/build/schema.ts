import { z } from 'zod';
import type { Build } from './types.ts';

/** The build as saved, shared and imported. See `graph/serialize.ts`. */

const dirSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const sideSchema = z.union([z.literal('left'), z.literal('right')]);

const placed = {
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  dir: dirSchema,
};

const entitySchema = z.discriminatedUnion('kind', [
  z.object({ ...placed, kind: z.literal('belt'), beltId: z.string() }),
  z.object({ ...placed, kind: z.literal('inserter'), inserterId: z.string() }),
  z.object({
    ...placed,
    kind: z.literal('machine'),
    machineId: z.string(),
    recipeId: z.string().nullable(),
  }),
  z.object({
    ...placed,
    kind: z.literal('source'),
    itemId: z.string(),
    perSec: z.number().finite().positive().nullable(),
  }),
  z.object({
    ...placed,
    kind: z.literal('sink'),
    target: z
      .object({ itemId: z.string(), perSec: z.number().finite().nonnegative() })
      .nullable()
      .optional(),
  }),
  z.object({ ...placed, kind: z.literal('chest') }),
  z.object({
    ...placed,
    kind: z.literal('underground'),
    beltId: z.string(),
    io: z.union([z.literal('in'), z.literal('out')]),
  }),
  z.object({
    ...placed,
    kind: z.literal('splitter'),
    beltId: z.string(),
    inputPriority: sideSchema.nullable(),
    outputPriority: sideSchema.nullable(),
    filter: z.string().nullable(),
  }),
]);

export const buildSchema = z.object({
  entities: z.array(entitySchema),
  hands: z.union([z.literal('base'), z.literal('researched')]),
});

// Keeps the schema and the hand-written type from drifting apart.
export type ParsedBuild = z.infer<typeof buildSchema>;
const _check: (build: ParsedBuild) => Build = (build) => build;
void _check;
