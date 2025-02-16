import { z } from 'zod'
import { nullish } from './nullish'

export const timeout = z.object({
    connect: nullish(z.number().int().nonnegative()),
    disconnect: nullish(z.number().int().nonnegative()),
    request: nullish(z.number().int().nonnegative()),
})
