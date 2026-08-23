import { createHash } from 'node:crypto'

import { value } from './utils-local.mjs'

export const digest = createHash('sha256').update(value).digest('hex')
