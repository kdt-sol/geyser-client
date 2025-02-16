import { z } from 'zod'
import { timeout } from './timeout'
import { heartbeat } from './heartbeat'
import { reconnect } from './reconnect'
import { nullish } from './nullish'

export const options = z.object({
    token: nullish(z.string()),
    timeout: nullish(timeout.default({})),
    heartbeat: nullish(z.union([z.boolean(), heartbeat.default({})])),
    disconnectOnErrors: nullish(z.boolean()),
    resetPingId: nullish(z.number().int().nonnegative()),
    reconnect: nullish(z.union([z.boolean(), reconnect.default({})])),
})
