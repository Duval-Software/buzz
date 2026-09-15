import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet } from 'jose';
import { transaction, verifyTokens, consumeTransaction } from './oidc.mjs';

function setting(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
const supabase = setting('SUPABASE_URL').replace(/\/$/, '');
const clientId = setting('CREATORHIVE_CLIENT_ID');
const community = setting('CREATORHIVE_COMMUNITY_ID');
const publishableKey = setting('SUPABASE_PUBLISHABLE_KEY');
const origin = process.env.SSO_ORIGIN ?? 'https://sso-demo.creatorhive.ai';
if (!supabase.startsWith('https://') || new URL(supabase).pathname !== '/' || !['https://sso-demo.creatorhive.ai', 'http://localhost:8788'].includes(origin)) throw new Error('Invalid deployment origins');
const issuer = `${supabase}/auth/v1`;
const redirectUri = `${origin}/callback`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const secure = origin.startsWith('https:');
const transactions = new Map();
const sessions = new Map();
const cookieName = secure ? '__Host-creatorhive-demo' : 'creatorhive-demo';
const newId = () => randomBytes(32).toString('base64url');
const cookie = (id, age = 3600) => `${cookieName}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CreatorHive shared login</title><style>body{font:1rem/1.6 system-ui;margin:0;background:#181b1a;color:#f1f0e9}main{max-width:36rem;margin:12vh auto;padding:1.5rem}h1{font-size:2rem;line-height:1.2}a,button{display:inline-block;background:#f3c564;color:#25241f;border:0;border-radius:.5rem;padding:.7rem 1rem;font:inherit;text-decoration:none}a:focus-visible,button:focus-visible{outline:3px solid white;outline-offset:4px}small{color:#abaea8}</style><main>${body}</main></html>`);
}
function redirect(res, location, sessionCookie) { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...(sessionCookie ? { 'Set-Cookie': sessionCookie } : {}) }); res.end(); }
async function tokenRequest(params) {
  const response = await fetch(`${issuer}/oauth/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...params }) });
  if (!response.ok) throw new Error('Login was not accepted. Please sign in again.');
  return response.json();
}
async function profile(session) {
  if (session.expires <= Date.now()) throw new Error('Session expired');
  if (session.claims.exp * 1000 <= Date.now() + 30000) {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token });
    session.claims = await verifyTokens(tokens, jwks, issuer, clientId, null, session.claims.sub);
    session.tokens = tokens;
  }
  // Required on EVERY authenticated request. JWT signature checks alone would
  // keep a revoked connected app signed in until the access token expired.
  const response = await fetch(`${supabase}/rest/v1/rpc/creatorhive_membership`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { apikey: publishableKey, Authorization: `Bearer ${session.tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ community_id: community }) });
  if (!response.ok) throw new Error('CreatorHive access ended. Sign in again to reconnect this app.');
  const member = await response.json();
  if (member.id !== session.claims.sub) throw new Error('Account mismatch');
  return member;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', origin);
  const id = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  for (const map of [sessions, transactions]) for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
  try {
    if (req.method === 'GET' && url.pathname === '/login') {
      // ponytail: bounded memory sessions suit one reference-app process. Use a
      // shared server-side store before running multiple replicas.
      if (transactions.size >= 2048) return send(res, 503, '<h1>Please try again shortly.</h1>');
      const tx = transaction(); const pending = newId(); transactions.set(pending, tx);
      const target = new URL(`${issuer}/oauth/authorize`);
      target.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid email profile', code_challenge: tx.challenge, code_challenge_method: 'S256', state: tx.state, nonce: tx.nonce }).toString();
      return redirect(res, target.href, cookie(pending, 300));
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      const tx = consumeTransaction(transactions, id, url.searchParams.get('state'));
      if (url.searchParams.has('error')) return send(res, 403, '<h1>Access wasn’t granted.</h1><a href="/login">Try again</a>');
      const code = url.searchParams.get('code'); if (!code) throw new Error('Missing authorization code');
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: tx.verifier });
      const claims = await verifyTokens(tokens, jwks, issuer, clientId, tx.nonce);
      if (sessions.size >= 2048) throw new Error('Please try again shortly.');
      const session = { tokens, claims, expires: Date.now() + 3600000 };
      await profile(session);
      const key = newId(); sessions.set(key, session); return redirect(res, '/', cookie(key));
    }
    if (req.method === 'POST' && url.pathname === '/logout') {
      if (req.headers.origin !== origin) return send(res, 403, '<h1>Request denied</h1>');
      sessions.delete(id); return redirect(res, '/', cookie('', 0));
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const session = sessions.get(id);
      if (!session) return send(res, 200, '<small>CreatorHive · Reference app</small><h1>One account. Your CreatorHive apps.</h1><p>Use your CreatorHive account to enter this separate app.</p><a href="/login">Sign in with CreatorHive</a>');
      const member = await profile(session);
      return send(res, 200, `<small>Signed in with CreatorHive</small><h1>Welcome, ${escape(member.display_name)}</h1><p>${escape(member.email)}</p><p>Community access: ${member.community_access ? 'Active' : 'Not active'}</p><p>This app can read your basic profile and community access only.</p><form method="post" action="/logout"><button>Sign out of this app</button></form>`);
    }
    send(res, 404, '<h1>Page not found</h1>');
  } catch {
    sessions.delete(id); res.setHeader('Set-Cookie', cookie('', 0));
    send(res, 401, '<h1>Please sign in again</h1><p>Your session expired, access was removed, or the account service could not be reached.</p><a href="/login">Sign in with CreatorHive</a>');
  }
}).listen(Number(process.env.PORT ?? 8788), '127.0.0.1', () => console.log('CreatorHive reference app ready'));
