import { describe, expect, it } from 'vitest'

import {
  apiHeaders,
  apiNoContent,
  apiNoRequestBody,
  apiOpenApiHttpResponse,
  apiOpenApiNoContent,
  apiOpenApiRawResponse,
  apiQuery,
  apiRequest,
  apiRequestContract,
  apiResponse,
  apiSseFrame,
} from './api-response-contract.mts'

describe('api-response-contract', () => {
  it('returns identity values for payload markers', () => {
    const body = { a: 1 }
    expect(apiResponse('k', body)).toBe(body)
    expect(apiRequest('k', body)).toBe(body)
    expect(apiOpenApiRawResponse('k', 'text/plain', body)).toBe(body)
    const response = new Response(null)
    expect(apiOpenApiHttpResponse('k', response)).toBe(response)
  })

  it('has no runtime effect for documentation markers', () => {
    expect(apiNoContent('k')).toBeUndefined()
    expect(apiOpenApiNoContent('k', 204)).toBeUndefined()
    expect(apiRequestContract('k')).toBeUndefined()
    expect(apiNoRequestBody('k')).toBeUndefined()
    expect(apiQuery('k', {}, {})).toBeUndefined()
    expect(apiHeaders('k', { request: { 'x-id': { type: 'string' } } })).toBeUndefined()
  })

  it('formats SSE frames', () => {
    expect(apiSseFrame('k', { event: 'tick', data: { n: 1 } })).toBe(
      'event: tick\ndata: {"n":1}\n\n',
    )
  })
})
