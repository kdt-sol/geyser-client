import { z } from 'zod'
import { nullish } from './nullish'

export const heartbeat = z.object({
    enabled: nullish(z.boolean()),
    interval: nullish(z.number().int().nonnegative()),
    timeout: nullish(z.number().int().nonnegative()),
})
