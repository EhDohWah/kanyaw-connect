import * as Crypto from 'expo-crypto'

/** A random UUID (version 4), for a message's `client_id`. */
export function uuid(): string {
  return Crypto.randomUUID()
}
