import type { AnyObject } from '@kdt310722/utils/object'
import type { SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc'
import type { ClientDuplexStream } from '@grpc/grpc-js'

export type SubscriptionStream = ClientDuplexStream<SubscribeRequest, SubscribeUpdate>

export type GeyserSubscribeRequest = SubscribeRequest

export type GeyserMethods = {
    [K in keyof SubscribeRequest]: SubscribeRequest[K] extends Record<string, AnyObject> ? K : never
}

export type GeyserMethod = keyof GeyserMethods

export type GeyserMethodParams<T extends GeyserMethod> = SubscribeRequest[T] extends Record<string, AnyObject> ? SubscribeRequest[T][string] : AnyObject

export interface GeyserSubscription {
    method: GeyserMethod
    params: AnyObject
}
