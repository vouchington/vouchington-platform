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

export function createEmailOtpHandlers(operations: EmailOtpOperations) {
  return { request: jsonHandler(operations.request), continue: jsonHandler(operations.continue) }
}

export function createPasskeyHandlers(operations: PasskeyOperations) {
  return mapHandlers(operations)
}

export function createMfaHandlers(operations: MfaOperations) {
  return {
    status: contextHandler(operations.status),
    ...(operations.totpVerification
      ? { totpVerification: jsonHandler(operations.totpVerification) }
      : {}),
    ...(operations.passkeyOptions
      ? { passkeyOptions: jsonHandler(operations.passkeyOptions) }
      : {}),
    ...(operations.passkeyVerification
      ? { passkeyVerification: jsonHandler(operations.passkeyVerification) }
      : {}),
    ...(operations.reauthentication
      ? { reauthentication: jsonHandler(operations.reauthentication) }
      : {}),
  }
}

export function createOAuthHandlers(operations: OAuthOperations) {
  return { connect: jsonHandler(operations.connect), continue: jsonHandler(operations.continue) }
}

function mapHandlers<T extends object>(
  operations: T & { [Key in keyof T]: JsonAuthOperation },
): { [Key in keyof T]: Handler } {
  return Object.fromEntries(
    Object.entries(operations as Record<string, JsonAuthOperation>).map(([name, operation]) => [
      name,
      jsonHandler(operation),
    ]),
  ) as { [Key in keyof T]: Handler }
}

function jsonHandler(operation: JsonAuthOperation): Handler {
  return async (context) => {
    context.assert(context.request.is('json'), 415, 'Invalid Content-Type')
    const body = await context.request.json('100kb')
    const result = await operation.execute(body, context)
    if (operation.respond) await operation.respond(result, context)
    else context.json(result)
  }
}

function contextHandler(operation: ContextAuthOperation): Handler {
  return async (context) => context.json(await operation.execute(context))
}
