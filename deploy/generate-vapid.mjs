// Run once on a trusted machine: node deploy/generate-vapid.mjs
// Save the output in the private .env / shared/.env.prod. Do not commit or log the private key.
import { generateKeyPairSync } from 'node:crypto'

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const publicJwk = pair.publicKey.export({ format: 'jwk' })
const privateJwk = pair.privateKey.export({ format: 'jwk' })
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x, 'base64url'), Buffer.from(publicJwk.y, 'base64url')])
process.stdout.write(`VAPID_PUBLIC_KEY=${publicKey.toString('base64url')}\nVAPID_PRIVATE_KEY=${privateJwk.d}\nVAPID_SUBJECT=mailto:replace-with-your-real-contact@example.com\n`)
