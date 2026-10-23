export { ApiError, apiClient, createApiClient } from './client'
export type {
  ApiClient,
  ApiClientOptions,
  ApiErrorKind,
  ApiListResult,
  ApiQueryValue,
  ApiRequestOptions,
} from './client'
export { readEventStream } from './sse'
export type { ServerSentEvent } from './sse'

/* 从后端 OpenAPI 生成的接口类型。entities 从这里取类型，不深链 generated 目录。 */
export type * from './generated'
