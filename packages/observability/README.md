# @vouchington/observability

SDK-free observability scrubbing. Supply `credentialHeaders` for `scrubEvent`,
`scrubSpanAttributes`, or `composeBeforeSend`; the package strips URL query/fragment values and
filters only caller-selected credentials. Environments and spike thresholds remain caller policy.
