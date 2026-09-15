import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { transaction, consumeTransaction, verifyTokens } from './oidc.mjs';

test('PKCE transactions are unique, bound to the browser, expiring, and single-use', () => {
  const a = transaction(); const b = transaction();
  assert.notEqual(a.verifier,b.verifier); assert.equal(a.challenge.length,43);
  const pending = new Map([['cookie',a]]);
  assert.throws(() => consumeTransaction(pending,'wrong',a.state));
  assert.equal(consumeTransaction(pending,'cookie',a.state),a);
  assert.throws(() => consumeTransaction(pending,'cookie',a.state));
  pending.set('cookie',{...a,expires:0}); assert.throws(() => consumeTransaction(pending,'cookie',a.state));
});

test('OIDC rejects wrong nonce, issuer, audience, client, and expired tokens', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const issuer = 'https://example.supabase.co/auth/v1'; const client = 'owned-app';
  const signed = (claims,aud,iss=issuer,expiry='5m') => new SignJWT(claims).setProtectedHeader({alg:'ES256'}).setIssuer(iss).setAudience(aud).setSubject('member').setExpirationTime(expiry).sign(privateKey);
  const access = { role:'authenticated',client_id:client,session_id:'session' };
  const tokens = { access_token:await signed(access,'authenticated'),id_token:await signed({nonce:'nonce'},client) };
  assert.equal((await verifyTokens(tokens,publicKey,issuer,client,'nonce')).sub,'member');
  await assert.rejects(verifyTokens(tokens,publicKey,issuer,client,'wrong'));
  await assert.rejects(verifyTokens(tokens,publicKey,'https://wrong',client,'nonce'));
  await assert.rejects(verifyTokens(tokens,publicKey,issuer,'another-app','nonce'));
  await assert.rejects(verifyTokens({...tokens,access_token:await signed(access,'wrong')},publicKey,issuer,client,'nonce'));
  await assert.rejects(verifyTokens({...tokens,access_token:await signed(access,'authenticated',issuer,'-1s')},publicKey,issuer,client,'nonce'));
  await assert.rejects(verifyTokens({...tokens,access_token:await signed({...access,client_id:'other'},'authenticated')},publicKey,issuer,client,'nonce'));
});
