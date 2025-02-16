import type { SubscribeRequest } from '@triton-one/yellowstone-grpc'
import { BaseError } from './base-error'

export class GeyserRequestError extends BaseError {
    public declare readonly request?: SubscribeRequest

    public withRequest(request?: SubscribeRequest) {
        return this.withValue('request', request)
    }
}
