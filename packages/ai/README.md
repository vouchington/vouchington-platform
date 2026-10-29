# @vouchington/ai

Provider-neutral model-call primitives. Subpath-only (there is no root export). Prompts, models,
price tables, budgets, transports, persistence, retries, and spend caps are all injected by the
application. This package ships pure functions, builders, parsers, validators, and typed errors; it
never loops, retries, or sequences steps. `@anthropic-ai/sdk` is a peer dependency (the app owns the
client). Tests use fakes and recorded-shape fixtures only; no live provider call runs in CI.

## `@vouchington/ai/providers`

- Types: `ModelUsage`, `GenerateJsonRequest`, `BilledModelResponse`, `ModelCallResult`.
- `ModelProviderError` and `classifyAnthropicError(error)`: one transient/permanent classification
  with `retryAfterMs`, `ambiguousBilled`, and the `billedResponse` of a billed-but-unusable answer.
- `isModelProviderError(value)`: type guard that recognizes a `ModelProviderError` (and subclasses)
  from any installed copy of the package. Errors carry the `Symbol.for('@vouchington/ai/ModelProviderError')`
  brand, and `instanceof ModelProviderError` also checks it, so pnpm duplicating the package across
  optional-peer contexts no longer breaks billing or reservation-release handling.
- `OpenAIInputItem` is the `openai` SDK's `ResponseInputItem`, so `OpenAIToolTurnParams` (plus a
  `model`) is assignable to `client.responses.create` without casts, and an SDK create function is
  assignable to `CreateOpenAIToolTurnResponse`. Types are checked against `openai` 7.43 (the peer
  range is `^7.39.0`); the type import means `openai` types must be installed to use these types.
- `anthropicUsageToModelUsage`, `openAIUsageToModelUsage`: normalize usage (whole-prompt
  `inputTokens`, cache reads/writes, reasoning tokens).
- `calcCostMicrounits(prices, provider, model, tier, usage)`, `getReportedCostMicrounits`,
  `normalizeModelAlias`, `isPricedModel`: pricing over an injected `PriceTable`.
- `assertSupportedRequest(selection, request, { prices, rejectsSamplingParameters })`.
- `buildAnthropicJsonParams` / `parseAnthropicJsonMessage` / `callAnthropicJson(createMessage, ...)`
  and `buildOpenAIJsonParams` / `parseOpenAIJsonResponse` / `callOpenAIJson(createResponse, ...)`:
  one schema-validated JSON call through an injected client function. OpenRouter is the same
  Responses shape; the app maps the model name and picks the endpoint inside `createResponse`.
- `parseSchemaValidJson(text, { schema, parse })`.
- Tool turns: `buildAnthropicToolTurnParams` / `parseAnthropicToolTurn` / `callAnthropicToolTurn` and
  `buildOpenAIToolTurnParams` / `parseOpenAIToolTurn` / `callOpenAIToolTurn` turn one provider-neutral
  transcript (`AgentTurnMessage[]`) into one required-tool-call turn. The agent loop, tool
  execution, and validation of tool input stay with the application.
- `openAIBilledResponse` and `assertCompletedOpenAIResponse`: shared response bookkeeping.

## `@vouchington/ai/openai`

Pure OpenAI/OpenRouter Responses error semantics (`openai` is an optional peer).

- `OpenAIResponseNotCompletedError`, `OpenAIResponseStreamIterationError`, `validateCompletedResponse`,
  `computeOutputText`: a non-completed response keeps its usage for the ledger.
  `validateCompletedResponse` guarantees a string `id` (a completed response without one throws
  `OpenAIResponseNotCompletedError`), so its result is a valid `OpenAIResponseLike`.
- `isOpenAIResponseNotCompletedError(value)`, `isOpenAIResponseStreamIterationError(value)`: guards
  that recognize these errors from any installed copy of the package; both classes carry a
  `Symbol.for` brand that `instanceof` also checks, as `ModelProviderError` does.
- Predicates: `isOpenAIRateLimitError`, `isOpenAIServerError`, `isOpenAIFlexResourceUnavailableError`,
  `isOpenAIFlexCapacityFailedResponseError`, `isExplicitClientCancelError`,
  `isOpenAIMissingPreviousResponseError`, `isOpenAINotFoundError`,
  `shouldLatchUnknownBilledOpenAIAttempt`, `describeOpenAIUpstreamFailure`.
- `getOpenAIRetryAfterMs(error, fallbackMs)`.
- `getOpenAIFlexFallback(params, error)` returns the default-tier resend params and trigger, or null.
  Resending (and re-checking spend caps first) is the application's call; `toOpenRouterModel` maps names.

Moderation and Bedrock embedding helpers have no third-party dependency, so they live in
`@vouchington/utils`: `ai-moderation`, `bedrock-embeddings`, and `bedrock-embedding-batches`.

## `@vouchington/ai/usage`

- `getUsageCostMicrounits(input, prices)`: a provider-reported cost, else list price from an injected
  price table, else null (never silently zero). Ledger columns and status are the app's.
- `parseUtcIsoTime`: exact UTC report-window edges.

Ledger SQL, idempotency keys and response-id rules, spend-cap policy, the uncertainty latch, and
classifier-run workflows are product policy and stay in the application.

## `@vouchington/ai/structured-decisions`

- `validateRequest`, `buildDecisionTransportRequest` (URL, model, and routing injected), `decodeResult`
  / `decodeAnswer` (strict; model and provider identity checks injected), `parseBilledUsage`.
- OpenAI `/v1/decisions` dialect: `buildOpenAIDecisionRequest` (URL and model injected; at most 400
  questions, 10 score levels) and `decodeOpenAIResult` (strict; a refusal is a permanent
  `invalid-response`). `parseBilledUsage` reads its usage as well.
- `readProviderErrorDetail` / `parseProviderErrorDetail` / `describeProviderErrorDetail`: bounded,
  user-content-free error bodies.
- `classifyByStatus`, `classifyOpenRouterFailure`, `classifyOpenAIFailure`, `classifyProviderResponse`: retry classes.
- `StructuredDecisionError` and `isStructuredDecisionError(value)`: branded like
  `ModelProviderError`, so the guard and `instanceof` work across installed package copies.

## Example sequence (owned by the application)

```ts
validateRequest(request)
const dispatch = buildDecisionTransportRequest({ url, provider, apiKey, model }, request)
await beforeSpendCapCheck()
const response = await fetch(dispatch.url, {
  method: 'POST',
  headers: dispatch.headers,
  body: JSON.stringify(dispatch.body),
})
if (!response.ok) {
  const detail = await readProviderErrorDetail(response)
  throw new StructuredDecisionError('provider-error', 'failed', response.status, {
    failure: classifyProviderResponse(classifyOpenRouterFailure, response, detail),
  })
}
const raw = await response.json()
await recordUsage(parseBilledUsage(raw))
return decodeResult(raw, request, { fallbackProvider: dispatch.provider })
```
