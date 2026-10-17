import { DROP, transformRecord } from './observability-records.mts'

export const REQUEST_BODY_SPAN_ATTRIBUTE = 'http.request.body.data'

/** Drop the request body attribute from span or breadcrumb data. */
export function dropSpanRequestBody<T extends Record<string, unknown>>(data: T): T {
  return transformRecord(data, (key, value) => (key === REQUEST_BODY_SPAN_ATTRIBUTE ? DROP : value))
}

/** Drop the body (`data`) from an event request. */
export function dropRequestBody<T extends object>(request: T | undefined): T | undefined {
  return request && transformRecord(request, (key, value) => (key === 'data' ? DROP : value))
}
