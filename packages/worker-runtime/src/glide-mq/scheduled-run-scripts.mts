/**
 * Lua for the scheduled-run lease. The source ships as strings so the package needs no native
 * dependency: the application loads each one through its own script registry (for
 * example `createScriptRegistry` from `@vouchington/utils/script-registry`) and runs it with `ScheduledRunLeaseClient.runScript`.
 */

/**
 * KEYS: lease, job hash, metrics hash. ARGV: job id, scheduler name, admitted field, skipped field,
 * lease ttl in ms, skipped-overlap metric field.
 *
 * Returns 0 fresh overlapping tick (skip), 1 acquired, 2 same job re-acquiring its own lease,
 * 3 admitted retained work that must defer, 4 previously skipped tick (skip, already counted),
 * 5 skip whose metric increment failed.
 */
export const ADMIT_SCHEDULED_RUN_LUA = String.raw`-- A durable decision is returned with the lease operation. A response lost after a collision
-- must not let a fresh tick retry after the holder finishes and execute work known to overlap.
if redis.call('HGET', KEYS[2], ARGV[4]) == ARGV[2] then
  return 4 -- previously skipped tick; do not count it again
end

local holder = redis.call('GET', KEYS[1])
if holder then
  if holder == ARGV[1] then
    redis.call('HSET', KEYS[2], ARGV[3], ARGV[2])
    return 2 -- same job retrying its own lease
  end
  if redis.call('HGET', KEYS[2], ARGV[3]) == ARGV[2] then
    return 3 -- admitted retained page must defer, not disappear
  end
  redis.call('HSET', KEYS[2], ARGV[4], ARGV[2])
  -- Record the fresh collision in the same atomic decision. A lost reply then retries as
  -- decision 4 without double-counting. A damaged metrics key cannot turn a skip into work.
  local counted = pcall(redis.call, 'HINCRBY', KEYS[3], ARGV[6], 1)
  if not counted then return 5 end -- durable skip; caller reports the metric failure
  return 0 -- fresh overlapping tick
end

redis.call('HSET', KEYS[2], ARGV[3], ARGV[2])
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[5])
return 1 -- acquired
`

/** KEYS: lease, previous-holder marker. ARGV: job id. Returns 1 when this job held the lease. */
export const RELEASE_SCHEDULED_RUN_LUA = String.raw`if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('UNLINK', KEYS[1], KEYS[2])
  return 1
end
return 0
`
