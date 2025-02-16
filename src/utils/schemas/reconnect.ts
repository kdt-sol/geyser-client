import { z } from 'zod'
import { nullish } from './nullish'

export const reconnect = z.object({
    enabled: nullish(z.boolean()),
    delay: nullish(z.number().int().nonnegative()),
    maxAttempts: nullish(z.number().int().nonnegative()),
    resubscribe: nullish(z.boolean()),
    resetMaxAttemptsAfterConnected: nullish(z.boolean()),
})
