// Dependency-free so /ses and /sqs do not pull in the optional @smithy/node-http-handler.
// Opt supported clients into dual-stack endpoints explicitly instead of AWS_USE_DUALSTACK_ENDPOINT.
export const AWS_DUALSTACK_CLIENT_CONFIG = { useDualstackEndpoint: true } as const
