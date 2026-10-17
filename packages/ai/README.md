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

- `priceUsageLedgerRow(input, prices)`: cost columns (`priced`/`unpriced`, microunits, currency) from a
  provider-reported cost or an injected price table; unpriced is never silently zero.
- `parseUtcIsoTime`: exact UTC report-window edges.

Ledger SQL, idempotency keys and response-id rules, spend-cap policy, the uncertainty latch, and
classifier-run workflows are product policy and stay in the application.

## `@vouchington/ai/structured-decisions`

- `validateRequest`, `buildDecisionTransportRequest` (URL, model, and routing injected), `decodeResult`
  / `decodeAnswer` (strict; model and provider identity checks injected), `parseBilledUsage`.
- `readProviderErrorDetail` / `parseProviderErrorDetail` / `describeProviderErrorDetail`: bounded,
  user-content-free error bodies.
- `classifyByStatus`, `classifyOpenRouterFailure`, `classifyProviderResponse`: retry classes.
- `StructuredDecisionError`.

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
