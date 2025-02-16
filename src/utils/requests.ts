import type { SubscribeRequest } from '@triton-one/yellowstone-grpc'
import { abortable, createDeferred, withTimeout } from '@kdt310722/utils/promise'
import { notNullish } from '@kdt310722/utils/common'
import type { GeyserSubscription, SubscriptionStream } from '../types'
import { GeyserRequestError } from '../errors'

export const createEmptyRequest = () => ({
    transactions: {},
    accounts: {},
    slots: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
})

export function buildSubscribeRequest(subscriptions: Record<string, GeyserSubscription>) {
    const request = createEmptyRequest()

    for (const [id, { method, params }] of Object.entries(subscriptions)) {
        if (method in request) {
            if (!request[method]) {
                throw new Error(`Invalid method: ${method}`)
            }

            request[method][id] = params
        }
    }

    return request
}

export interface GeyserSendRequestOptions {
    timeout?: number
    abortSignal?: AbortSignal
}

export async function send(stream: SubscriptionStream, request: SubscribeRequest, { timeout = 10_000, abortSignal }: GeyserSendRequestOptions = {}) {
    const createError = (message: string, cause?: unknown) => new GeyserRequestError(message, { cause }).withRequest(request)
    const wrote = createDeferred<void>()

    stream.write(request, (error: unknown) => {
        return notNullish(error) ? wrote.reject(createError('Request error:', error)) : wrote.resolve()
    })

    return await abortable(withTimeout(wrote, timeout, () => createError('Request timeout')), abortSignal)
}

export async function ping(stream: SubscriptionStream, { id, ...options }: GeyserSendRequestOptions & { id?: number } = {}) {
    return send(stream, { ...createEmptyRequest(), ping: { id: id ?? 1 } }, options)
}
