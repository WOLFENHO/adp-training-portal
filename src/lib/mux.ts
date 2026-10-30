import Mux from '@mux/ts'
export const mux = new Mux({ tokenId: process.env.MUX_TOKEN_ID!, tokenSecret: process.env.MUX_TOKEN_SECRET!, jwtSigningKey: process.env.MUX_SIGNING_KEY_ID!, jwtPrivateKey: process.env.MUX_SIGNING_PRIVATE_KEY! })

const expiry = (durationSeconds: number) => `${Math.max(15, Math.ceil(durationSeconds / 60) + 2)}m`
export function playbackToken(playbackId: string, durationSeconds = 0) { return mux.jwt.signPlaybackId(playbackId, { type: 'video', expiration: expiry(durationSeconds) }) }
export function thumbnailToken(playbackId: string, durationSeconds = 0) { return mux.jwt.signPlaybackId(playbackId, { type: 'thumbnail', expiration: expiry(durationSeconds), params: { time: '1' } }) }
