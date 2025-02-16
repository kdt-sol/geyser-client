import { resolveNestedOptions } from '@kdt310722/utils/object'
import { Emitter } from '@kdt310722/utils/event'
import { type DeferredPromise, createDeferred, sleep, withTimeout } from '@kdt310722/utils/promise'
import { transform } from '@kdt310722/utils/function'
import { notNullish } from '@kdt310722/utils/common'
import type Client from '@triton-one/yellowstone-grpc'
import type { GeyserMethod, GeyserMethodParams, GeyserSubscribeRequest, GeyserSubscribeUpdate, GeyserSubscription, SubscriptionStream } from './types'
import { buildSubscribeRequest, createClient, ping, send } from './utils'

export interface GeyserSubscribeOptions {
    id?: string
}

export interface GeyserTimeoutOptions {
    connect?: number
    disconnect?: number
    request?: number
}

export interface GeyserHeartbeatOptions {
    enabled?: boolean
    interval?: number
    timeout?: number
}

export interface GeyserReconnectOptions {
    enabled?: boolean
    delay?: number
    maxAttempts?: number
    resubscribe?: boolean
    resetMaxAttemptsAfterConnected?: boolean
}

export interface GeyserClientOptions {
    token?: string
    timeout?: GeyserTimeoutOptions
    heartbeat?: GeyserHeartbeatOptions | boolean
    disconnectOnErrors?: boolean
    resetPingId?: number
    reconnect?: GeyserReconnectOptions | boolean
}

export interface GeyserDataContext {
    receivedAt: number
}

export type GeyserClientEvents = {
    connect: () => void
    reconnect: (attempt: number, retriesLeft: number) => void
    reconnectFailed: (error: unknown) => void
    connected: () => void
    disconnected: (isExplicitly: boolean, subscriptions: Record<string, GeyserSubscription>) => void
    resubscribe: (subscriptions: Record<string, GeyserSubscription>) => void
    resubscribed: (subscriptions: Record<string, GeyserSubscription>) => void
    ping: (id: number) => void
    pong: (id: number) => void
    error: (error: unknown) => void
    data: (subscriptionId: string, data: GeyserSubscribeUpdate, context: GeyserDataContext) => void
    unhandledMessage: (message: unknown) => void
    updated: (request: GeyserSubscribeRequest) => void
}

export class GeyserClient extends Emitter<GeyserClientEvents, true> {
    protected readonly client: Client
    protected readonly subscriptions = new Map<string, GeyserSubscription>()

    protected readonly timeout: Required<GeyserTimeoutOptions>
    protected readonly heartbeat: Required<GeyserHeartbeatOptions>
    protected readonly disconnectOnErrors: boolean
    protected readonly resetPingId: number
    protected readonly reconnect: Required<GeyserReconnectOptions>

    protected stream?: SubscriptionStream
    protected isExplicitlyDisconnected = false

    protected pingTimer?: NodeJS.Timeout
    protected pongTimer?: NodeJS.Timeout

    protected pingId = 0
    protected requestId = 0
    protected reconnectAttempts = 0

    protected connectPromise?: Promise<void>
    protected disconnectPromise?: DeferredPromise<void>
    protected abortController: AbortController

    public constructor(public readonly url: string, options: GeyserClientOptions = {}) {
        super()

        const { token, timeout = {}, heartbeat = true, disconnectOnErrors = true, resetPingId = 1e6, reconnect = true } = options
        const { connect: connectTimeout = 10_000, disconnect: disconnectTimeout = 10_000, request: requestTimeout = 10_000 } = timeout
        const { enabled: heartbeatEnabled = true, timeout: heartbeatTimeout = 10_000, interval: heartbeatInterval = 30_000 } = resolveNestedOptions(heartbeat) || { enabled: false }
        const { enabled: reconnectEnabled = true, delay: reconnectDelay = 0, maxAttempts: reconnectMaxAttempts = 5, resubscribe: resubscribeOnReconnect = true, resetMaxAttemptsAfterConnected = true } = resolveNestedOptions(reconnect) || { enabled: false }

        this.client = createClient(url, token)
        this.timeout = { connect: connectTimeout, disconnect: disconnectTimeout, request: requestTimeout }
        this.heartbeat = { enabled: heartbeatEnabled, timeout: heartbeatTimeout, interval: heartbeatInterval }
        this.reconnect = { enabled: reconnectEnabled, delay: reconnectDelay, maxAttempts: reconnectMaxAttempts, resubscribe: resubscribeOnReconnect, resetMaxAttemptsAfterConnected }
        this.disconnectOnErrors = disconnectOnErrors
        this.resetPingId = resetPingId
        this.abortController = new AbortController()
    }

    public get isConnected() {
        return this.stream?.readable ?? false
    }

    public get subscriptionsCount() {
        return this.subscriptions.size
    }

    public get subscriptionIds() {
        return [...this.subscriptions.keys()]
    }

    public isSubscribed(id: string) {
        return this.subscriptions.has(id)
    }

    public async connect(isReconnect = false) {
        if (this.isConnected) {
            return
        }

        await this.disconnectPromise

        if (!isReconnect) {
            this.emit('connect')
        }

        await (this.connectPromise ??= this.createStream(isReconnect).then(() => void 0).finally(() => (this.connectPromise = undefined)))
    }

    public async disconnect(isExplicitly = true) {
        await this.connectPromise

        if (!this.isConnected) {
            return
        }

        if (this.disconnectPromise) {
            return this.disconnectPromise
        }

        this.isExplicitlyDisconnected = isExplicitly
        this.disconnectPromise = createDeferred()

        this.stream!.once('close', () => this.disconnectPromise!.resolve())
        this.stream!.cancel()

        await withTimeout(this.disconnectPromise, this.timeout.disconnect, 'Disconnect timeout').catch((error) => this.stream!.destroy(error)).finally(() => {
            this.disconnectPromise = undefined
        })
    }

    public async subscribe<TMethod extends GeyserMethod>(method: TMethod, params: GeyserMethodParams<TMethod>, options: GeyserSubscribeOptions = {}) {
        if (notNullish(options.id) && this.subscriptions.has(options.id)) {
            throw new Error(`Subscription with id ${options.id} already exists`)
        }

        const id = options.id ?? String(++this.requestId)
        const subscription: GeyserSubscription = { method, params }

        this.subscriptions.set(id, subscription)

        try {
            await this.update()
        } catch (error) {
            this.subscriptions.delete(id)
            throw error
        }

        return id
    }

    public async unsubscribe(id: string) {
        const subscription = this.subscriptions.get(id)

        if (!subscription) {
            return
        }

        this.subscriptions.delete(id)

        if (this.stream) {
            try {
                await this.update()
            } catch (error) {
                this.stream.destroy(new Error('Unsubscribe failed', { cause: error }))
            }
        }
    }

    protected async update() {
        if (!this.stream) {
            throw new Error('Client is not connected')
        }

        const request = buildSubscribeRequest(Object.fromEntries(this.subscriptions))

        return send(this.stream, request, { timeout: this.timeout.request, abortSignal: this.abortController.signal }).then(() => {
            this.emit('updated', request)
        })
    }

    protected handleData(stream: SubscriptionStream, data: GeyserSubscribeUpdate, receivedAt: number) {
        this.resolveHeartbeat()

        if (notNullish(data.pong)) {
            return this.emit('pong', data.pong.id)
        }

        if (notNullish(data.ping)) {
            return this.update().catch((error) => stream.destroy(new Error('Pong failed', { cause: error })))
        }

        return this.handleSubscription(data, receivedAt)
    }

    protected handleSubscription(data: GeyserSubscribeUpdate, receivedAt: number) {
        for (const filter of data.filters) {
            if (this.subscriptions.has(filter)) {
                this.emit('data', filter, data, { receivedAt })
            } else {
                this.emit('unhandledMessage', data)
            }
        }
    }

    protected handleOpen(stream: any, isReconnect = false) {
        this.stream = stream

        if (this.heartbeat.enabled) {
            this.startHeartbeat(stream)
        }

        this.emit('connected')

        if (isReconnect && this.reconnect.enabled && this.reconnect.resubscribe && this.subscriptionsCount > 0) {
            const subscriptions = Object.fromEntries(this.subscriptions)

            const onResubscribed = () => {
                if (this.reconnect.resetMaxAttemptsAfterConnected) {
                    this.reconnectAttempts = 0
                }

                this.emit('resubscribed', subscriptions)
            }

            this.emit('resubscribe', subscriptions)
            this.update().then(onResubscribed).catch((error) => stream.destroy(new Error('Resubscribe failed', { cause: error })))
        } else if (this.reconnect.resetMaxAttemptsAfterConnected) {
            this.reconnectAttempts = 0
        }
    }

    protected handleClose(emit = true) {
        if (!this.isConnected) {
            return
        }

        const isExplicitly = this.isExplicitlyDisconnected
        const subscriptions = Object.fromEntries(this.subscriptions)

        this.reset()

        if (emit) {
            this.emit('disconnected', isExplicitly, subscriptions)
        }

        if (isExplicitly) {
            this.subscriptions.clear()
        } else {
            this.handleReconnect()
        }
    }

    protected handleReconnect() {
        if (this.reconnect.enabled && this.reconnectAttempts < this.reconnect.maxAttempts) {
            this.emit('reconnect', ++this.reconnectAttempts, this.reconnect.maxAttempts - this.reconnectAttempts)

            sleep(this.reconnect.delay).then(async () => this.connect(true)).catch((error) => {
                this.emit('reconnectFailed', error)
                this.handleClose(false)
            })
        }
    }

    protected handleError(stream: SubscriptionStream, error: unknown) {
        if (error instanceof Error && 'details' in error && error.details === 'Cancelled on client') {
            return
        }

        this.emit('error', error)

        if (this.disconnectOnErrors && this.isConnected) {
            stream.destroy()
        }
    }

    protected async createStream(isReconnect = false) {
        if (this.isConnected) {
            throw new Error('Already connected')
        }

        this.stream = undefined
        this.isExplicitlyDisconnected = false

        const promise = createDeferred<unknown>()
        const stream = await this.client.subscribe()
        const handleEnd = () => (promise.isSettled ? stream.destroy() : new promise.reject(new Error('Stream ended unexpectedly')))

        stream.on('error', (error) => (promise.isSettled ? this.handleError(stream, error) : promise.reject(error)))
        stream.on('end', handleEnd)
        stream.on('finish', handleEnd)
        stream.on('close', () => (promise.isSettled ? this.handleClose() : promise.reject(new Error('Stream closed unexpectedly'))))

        stream.on('data', (data) => {
            const receivedAt = Date.now()

            if (!promise.isSettled) {
                promise.resolve(true)
            }

            this.handleData(stream, data, receivedAt)
        })

        this.ping(stream).catch((error) => {
            stream.destroy(error)
        })

        return withTimeout(promise, this.timeout.connect, 'Connect timeout').then(() => this.handleOpen(stream, isReconnect)).then(() => stream)
    }

    protected startHeartbeat(stream: SubscriptionStream) {
        this.pingTimer = setInterval(this.runHeartbeat.bind(this, stream), this.heartbeat.interval)
    }

    protected stopHeartbeat() {
        clearInterval(this.pingTimer)
        clearTimeout(this.pongTimer)

        this.pingTimer = undefined
        this.pongTimer = undefined
    }

    protected async runHeartbeat(stream: SubscriptionStream) {
        const success = await this.ping(stream).then(() => true).catch((error) => transform(stream.destroy(error), () => false))

        if (success) {
            this.pongTimer = setTimeout(() => stream.destroy(new Error('Heartbeat timeout')), this.heartbeat.timeout)
        }
    }

    protected resolveHeartbeat() {
        clearTimeout(this.pongTimer)
    }

    protected async ping(stream: SubscriptionStream) {
        const id = ++this.pingId

        if (id >= this.resetPingId) {
            this.pingId = 0
        }

        await Promise.resolve(this.emit('ping', id)).then(async () => ping(stream, { id, timeout: this.timeout.request, abortSignal: this.abortController.signal }))
    }

    protected reset() {
        this.stream?.removeAllListeners()
        this.stream = undefined
        this.isExplicitlyDisconnected = false
        this.stopHeartbeat()
        this.abortController.abort()
        this.abortController = new AbortController()
        this.pingId = 0
    }
}
