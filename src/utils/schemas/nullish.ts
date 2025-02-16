import type { ZodTypeAny } from 'zod'

export const nullish = <T extends ZodTypeAny>(schema: T) => schema.nullish().transform((val) => val ?? undefined)
