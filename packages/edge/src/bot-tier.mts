export type BotTierClassifierOptions<Known, Unknown> = {
  /** Generic bot detector, such as the `isbot` package. */
  isBot: (userAgent: string) => boolean
  /** Case-insensitive User-Agent substrings that identify known, useful bots. */
  knownUserAgentSubstrings: readonly string[]
  knownTier: Known
  unknownTier: Unknown
}

export type BotTierInput = {
  /** Trusted platform signal; User-Agent substrings alone are spoofable. */
  verifiedBot?: boolean
}

/** Reads Cloudflare Bot Management's verified-bot flag from a Workers request. */
export function isVerifiedBotRequest(request: Request): boolean {
  const { cf } = request as Request & { cf?: { botManagement?: { verifiedBot?: boolean } } }
  return cf?.botManagement?.verifiedBot === true
}

/**
 * Builds a classifier returning the known tier only for a detected bot whose User-Agent matches a
 * known substring and whose verified flag is true, the unknown tier for any other detected bot, and
 * null for humans and missing User-Agents.
 */
export function createBotTierClassifier<Known, Unknown>(
  options: BotTierClassifierOptions<Known, Unknown>,
): (userAgent: string | null, input?: BotTierInput) => Known | Unknown | null {
  const substrings = options.knownUserAgentSubstrings.map((value) => value.toLowerCase())
  return (userAgent, input = {}) => {
    if (!userAgent || !options.isBot(userAgent)) return null
    const ua = userAgent.toLowerCase()
    const matched = substrings.some((substring) => ua.includes(substring))
    return matched && input.verifiedBot === true ? options.knownTier : options.unknownTier
  }
}
