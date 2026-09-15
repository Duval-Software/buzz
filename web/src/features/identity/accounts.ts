/** Credential transport and browser-native encryption; no passwords or secrets in storage. */
import { setOnboardingStatus } from "@/features/onboarding/onboarding-state";
import { toast } from "sonner";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { loadIdentity, unlockAccount } from "@/shared/lib/identity";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

type Vault = { version: 1; salt: string; iv: string; ciphertext: string };
type AccountResponse = {
  username: string;
  pubkey: string;
  vault: Vault;
  session_token: string;
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function decode(value: string, size: number): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== size) throw new Error("The account backup is invalid.");
  return bytes;
}

async function vaultKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(
  password: string,
  secret: Uint8Array,
  username: string,
): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(username) },
    await vaultKey(password, salt),
    new Uint8Array(secret),
  );
  return {
    version: 1,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}

async function request(
  path: string,
  payload: object,
  secretKey?: Uint8Array,
): Promise<AccountResponse> {
  const body = JSON.stringify(payload);
  const base = relayHttpBaseUrl().replace(/\/$/, "");
  const endpoint = `${base}/api/accounts/${path}`;
  const url = import.meta.env.DEV ? `/api/accounts/${path}` : endpoint;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secretKey)
    headers.Authorization = await makeNip98AuthHeader(endpoint, "POST", {
      body,
      secretKey,
    });
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    credentials: "omit",
  });
  let data: AccountResponse & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Account login is not available on this community server yet.",
    );
  }
  if (!response.ok)
    throw new Error(data.error || "Could not access your account. Try again.");
  if (
    !data.username ||
    !/^[0-9a-f]{64}$/.test(data.pubkey) ||
    data.vault?.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(data.session_token)
  )
    throw new Error("The server returned an invalid account.");
  return data;
}

/** Create credentials for the existing identity, or generate one for a new member. */
export async function registerAccount(
  username: string,
  password: string,
): Promise<void> {
  const name = username.trim().toLowerCase();
  const existing = loadIdentity();
  if (existing?.managed)
    throw new Error("Use your CreatorHive account settings.");
  const secret = existing?.secretKey ?? generateSecretKey();
  const vault = await encrypt(password, secret, name);
  const account = await request(
    "register",
    { username: name, password, vault },
    secret,
  );
  if (account.pubkey !== getPublicKey(secret) || account.username !== name)
    throw new Error("The account did not match your profile.");
  if (existing)
    toast.success(
      "Your login is ready. Your profile and memberships are unchanged.",
    );
  if (!existing) setOnboardingStatus(account.pubkey, "pending");
  unlockAccount(secret, name, account.session_token);
  getSocket(relayWsUrl()).reconnect();
}

/** Recover the same membership and message identity on any device using credentials. */
export async function loginAccount(
  username: string,
  password: string,
): Promise<void> {
  const account = await request("login", {
    username: username.trim().toLowerCase(),
    password,
  });
  const vault = account.vault;
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(vault.iv, 12),
          additionalData: new TextEncoder().encode(account.username),
        },
        await vaultKey(password, decode(vault.salt, 16)),
        decode(vault.ciphertext, 48),
      ),
    );
    if (getPublicKey(secret) !== account.pubkey)
      throw new Error("Identity mismatch");
  } catch {
    throw new Error(
      "Could not unlock this account. Check your password and try again.",
    );
  }
  unlockAccount(secret, account.username, account.session_token);
  getSocket(relayWsUrl()).reconnect();
}

/** Password and encrypted backup change together; current password is checked server-side. */
export async function changeAccountPassword(
  password: string,
  newPassword: string,
): Promise<void> {
  const identity = loadIdentity();
  if (!identity?.username || identity.managed)
    throw new Error("Create a login first.");
  const vault = await encrypt(
    newPassword,
    identity.secretKey,
    identity.username,
  );
  const account = await request(
    "password",
    { username: identity.username, password, new_password: newPassword, vault },
    identity.secretKey,
  );
  toast.success("Password updated. Other devices have been signed out.");
  unlockAccount(identity.secretKey, identity.username, account.session_token);
  getSocket(relayWsUrl()).reconnect();
}

/** Resolve a registered username before an administrator reviews an access change. */
export async function resolveAccount(
  username: string,
): Promise<{ username: string; pubkey: string }> {
  const identity = loadIdentity();
  if (!identity) throw new Error("Sign in first.");
  const body = JSON.stringify({ username: username.trim().toLowerCase() });
  const endpoint = `${relayHttpBaseUrl().replace(/\/$/, "")}/api/accounts/resolve`;
  const response = await fetch(
    import.meta.env.DEV ? "/api/accounts/resolve" : endpoint,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: await makeNip98AuthHeader(endpoint, "POST", {
          body,
          secretKey: identity.secretKey,
        }),
      },
      body,
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not find that account.");
  if (!/^[0-9a-f]{64}$/.test(data.pubkey))
    throw new Error("Invalid account response.");
  return data;
}

/** Revoke this server session before removing local access. */
export async function logoutAccount(): Promise<void> {
  const identity = loadIdentity();
  if (!identity?.sessionToken) return;
  const endpoint = `${relayHttpBaseUrl().replace(/\/$/, "")}/api/accounts/logout`;
  const body = "{}";
  const response = await fetch(
    import.meta.env.DEV ? "/api/accounts/logout" : endpoint,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: await makeNip98AuthHeader(endpoint, "POST", {
          body,
          secretKey: identity.secretKey,
        }),
      },
      body,
    },
  );
  if (!response.ok && response.status !== 401)
    throw new Error("Could not sign out on the server. Try again.");
}
