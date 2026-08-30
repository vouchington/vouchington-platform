export interface ExpiringStateStore {
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>
  get<T>(key: string): Promise<T | null>
  consume<T>(key: string): Promise<T | null>
}

export interface AttemptLimiter<Input> {
  isLimited?(input: Input): Promise<boolean>
  record(input: Input): Promise<boolean>
}

export type Authenticated<User, Session> = {
  status: 'authenticated'
  user: User
  session: Session
}

export type MfaRequired = {
  status: 'mfa_required'
  attemptId: string
}

export type AuthenticationResult<User, Session> = Authenticated<User, Session> | MfaRequired

export interface AuthenticationFlowOptions<Identity, User, Session, Context> {
  resolveUser(identity: Identity, context: Context): Promise<User>
  isSuspended(user: User, context: Context): Promise<boolean> | boolean
  hasMfa(user: User, context: Context): Promise<boolean>
  createMfaAttempt(user: User, context: Context): Promise<string>
  issueSession(user: User, context: Context): Promise<Session>
}
