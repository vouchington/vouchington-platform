import { signJwt, type JwtSignOptions } from '@vouchington/session-jwt'

type JwtPayload = Parameters<typeof signJwt>[0]

export interface JwtSessionIssuerOptions<User, Context> extends JwtSignOptions {
  subject(user: User, context: Context): string
  claims(user: User, context: Context): Promise<JwtPayload> | JwtPayload
}

export function createJwtSessionIssuer<User, Context>(
  options: JwtSessionIssuerOptions<User, Context>,
) {
  return async function issueSession(user: User, context: Context): Promise<string> {
    const subject = options.subject(user, context)
    if (!subject.trim()) throw new TypeError('JWT subject must not be empty')
    return signJwt(
      { ...(await options.claims(user, context)), sub: subject },
      {
        keySet: options.keySet,
        issuer: options.issuer,
        audience: options.audience,
        expiresIn: options.expiresIn,
        ...(options.issuedAt === undefined ? {} : { issuedAt: options.issuedAt }),
      },
    )
  }
}
