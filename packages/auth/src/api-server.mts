import type { Context, Handler } from '@jongleberry/api-server'

export interface JsonAuthOperation {
  execute(body: unknown, context: Context): Promise<unknown>
  respond?(result: unknown, context: Context): Promise<void> | void
}

export interface ContextAuthOperation {
  execute(context: Context): Promise<unknown>
}

export interface EmailOtpOperations {
  request: JsonAuthOperation
  continue: JsonAuthOperation
}

export interface PasskeyOperations {
  registrationOptions: JsonAuthOperation
  registrationVerification: JsonAuthOperation
  authenticationOptions: JsonAuthOperation
  authenticationVerification: JsonAuthOperation
  discoverableOptions: JsonAuthOperation
  discoverableVerification: JsonAuthOperation
}

export interface MfaOperations {
  status: ContextAuthOperation
  totpVerification?: JsonAuthOperation
  passkeyOptions?: JsonAuthOperation
  passkeyVerification?: JsonAuthOperation
  reauthentication?: JsonAuthOperation
}

export interface OAuthOperations {
  connect: JsonAuthOperation
  continue: JsonAuthOperation
}

export interface JsonHandlerOptions {
  bodyLimit: string | number
}

export function createEmailOtpHandlers(
  operations: EmailOtpOperations,
  options: JsonHandlerOptions,
) {
  return {
    request: jsonHandler(operations.request, options),
    continue: jsonHandler(operations.continue, options),
  }
}

export function createPasskeyHandlers(operations: PasskeyOperations, options: JsonHandlerOptions) {
  return mapHandlers(operations, options)
}

export function createMfaHandlers(operations: MfaOperations, options: JsonHandlerOptions) {
  return {
    status: contextHandler(operations.status),
    ...(operations.totpVerification
      ? { totpVerification: jsonHandler(operations.totpVerification, options) }
      : {}),
    ...(operations.passkeyOptions
      ? { passkeyOptions: jsonHandler(operations.passkeyOptions, options) }
      : {}),
    ...(operations.passkeyVerification
      ? { passkeyVerification: jsonHandler(operations.passkeyVerification, options) }
      : {}),
    ...(operations.reauthentication
      ? { reauthentication: jsonHandler(operations.reauthentication, options) }
      : {}),
  }
}

export function createOAuthHandlers(operations: OAuthOperations, options: JsonHandlerOptions) {
  return {
    connect: jsonHandler(operations.connect, options),
    continue: jsonHandler(operations.continue, options),
  }
}

function mapHandlers<T extends object>(
  operations: T & { [Key in keyof T]: JsonAuthOperation },
  options: JsonHandlerOptions,
): { [Key in keyof T]: Handler } {
  return Object.fromEntries(
    Object.entries(operations as Record<string, JsonAuthOperation>).map(([name, operation]) => [
      name,
      jsonHandler(operation, options),
    ]),
  ) as { [Key in keyof T]: Handler }
}

function jsonHandler(operation: JsonAuthOperation, options: JsonHandlerOptions): Handler {
  return async (context) => {
    context.assert(context.request.is('json'), 415, 'Invalid Content-Type')
    const body = await context.request.json(options.bodyLimit)
    const result = await operation.execute(body, context)
    if (operation.respond) await operation.respond(result, context)
    else context.json(result)
  }
}

function contextHandler(operation: ContextAuthOperation): Handler {
  return async (context) => context.json(await operation.execute(context))
}
