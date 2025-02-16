import Client from '@triton-one/yellowstone-grpc'

export const createClient = (url: string, token?: string) => new Client['default'](url, token, {
    'grpc.max_send_message_length': -1,
    'grpc.max_receive_message_length': -1,
    'grpc.keepalive_permit_without_calls': 1,
})
