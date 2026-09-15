import { randomBytes, createHash } from 'node:crypto';
import { jwtVerify } from 'jose';

export function transaction() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), expires: Date.now() + 300000 };
}

export async function verifyTokens(tokens, jwks, issuer, clientId, nonce, expectedSub) {
  if (!tokens.access_token) throw new Error('Missing access token');
  const { payload: access } = await jwtVerify(tokens.access_token, jwks, { issuer, audience: 'authenticated', algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'sub', 'session_id', 'client_id'] });
  if (access.client_id !== clientId || access.role !== 'authenticated' || (expectedSub && access.sub !== expectedSub)) throw new Error('Invalid app token');
  if (nonce) {
    if (!tokens.id_token) throw new Error('Missing ID token');
    const { payload: identity } = await jwtVerify(tokens.id_token, jwks, { issuer, audience: clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'sub', 'nonce'] });
    if (identity.nonce !== nonce || identity.sub !== access.sub) throw new Error('Invalid login response');
  }
  return access;
}

export function consumeTransaction(transactions, cookie, returnedState) {
  const tx = transactions.get(cookie);
  transactions.delete(cookie);
  if (!tx || tx.expires <= Date.now() || !returnedState || tx.state !== returnedState) throw new Error('Login expired. Please try again.');
  return tx;
}
