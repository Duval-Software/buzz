#!/usr/bin/env python3
"""Post messages to a Buzz relay as a dedicated bot identity.

Pure stdlib: implements BIP-340 Schnorr signing, Nostr event IDs, and NIP-98
HTTP auth, so it runs on a bare GitHub Actions runner with no pip install.

Usage:
  BUZZ_BOT_NSEC=nsec1...  python3 buzz_bot.py post   --channel <uuid> --file body.md
  BUZZ_BOT_NSEC=nsec1...  python3 buzz_bot.py join   --channel <uuid>
  BUZZ_BOT_NSEC=nsec1...  python3 buzz_bot.py profile --name "Upstream Bot" --about "..."
  python3 buzz_bot.py selftest
"""

import base64
import hashlib
import json
import os
import sys
import time
import urllib.request

RELAY = os.environ.get("BUZZ_RELAY_HTTP", "https://chat.duvalsoftware.com")

# --- secp256k1 ---------------------------------------------------------------
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)


def point_add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], P - 2, P) % P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], P - 2, P) % P
    x = (lam * lam - a[0] - b[0]) % P
    return (x, (lam * (a[0] - x) - a[1]) % P)


def point_mul(k, point=None):
    point = G if point is None else point
    result = None
    while k:
        if k & 1:
            result = point_add(result, point)
        point = point_add(point, point)
        k >>= 1
    return result


def lift_x(x):
    """Recover the even-y point for an x-only pubkey."""
    if x >= P:
        return None
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if pow(y, 2, P) != y_sq:
        return None
    return (x, y if y % 2 == 0 else P - y)


def tagged_hash(tag, msg):
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def schnorr_sign(msg32, sk_bytes, aux=b"\x00" * 32):
    d0 = int.from_bytes(sk_bytes, "big")
    if not (1 <= d0 < N):
        raise ValueError("private key out of range")
    point = point_mul(d0)
    d = d0 if point[1] % 2 == 0 else N - d0
    px = point[0].to_bytes(32, "big")

    t = (d ^ int.from_bytes(tagged_hash("BIP0340/aux", aux), "big")).to_bytes(32, "big")
    k0 = int.from_bytes(tagged_hash("BIP0340/nonce", t + px + msg32), "big") % N
    if k0 == 0:
        raise ValueError("nonce is zero")
    r_point = point_mul(k0)
    k = k0 if r_point[1] % 2 == 0 else N - k0
    rx = r_point[0].to_bytes(32, "big")

    e = int.from_bytes(tagged_hash("BIP0340/challenge", rx + px + msg32), "big") % N
    return rx + ((k + e * d) % N).to_bytes(32, "big")


def schnorr_verify(msg32, pubkey32, sig):
    point = lift_x(int.from_bytes(pubkey32, "big"))
    if point is None or len(sig) != 64:
        return False
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:], "big")
    if r >= P or s >= N:
        return False
    e = int.from_bytes(tagged_hash("BIP0340/challenge", sig[:32] + pubkey32 + msg32), "big") % N
    big_r = point_add(point_mul(s), point_mul(N - e, point))
    return big_r is not None and big_r[1] % 2 == 0 and big_r[0] == r


# --- bech32 ------------------------------------------------------------------
CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values):
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def bech32_decode(s):
    hrp, data = s.rsplit("1", 1)
    vals = [CHARSET.index(c) for c in data][:-6]
    acc = bits = 0
    out = bytearray()
    for v in vals:
        acc = (acc << 5) | v
        bits += 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    return hrp, bytes(out)


def bech32_encode(hrp, payload):
    acc = bits = 0
    data = []
    for b in payload:
        acc = (acc << 8) | b
        bits += 8
        while bits >= 5:
            bits -= 5
            data.append((acc >> bits) & 31)
    if bits:
        data.append((acc << (5 - bits)) & 31)
    vals = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + data
    pm = _polymod(vals + [0] * 6) ^ 1
    checksum = [(pm >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(CHARSET[d] for d in data + checksum)


# --- nostr -------------------------------------------------------------------
def load_key():
    raw = os.environ.get("BUZZ_BOT_NSEC", "").strip()
    if not raw:
        sys.exit("BUZZ_BOT_NSEC is not set")
    if raw.startswith("nsec1"):
        _, sk = bech32_decode(raw)
    else:
        sk = bytes.fromhex(raw)
    pub = point_mul(int.from_bytes(sk, "big"))[0].to_bytes(32, "big")
    return sk, pub


def build_event(sk, pub, kind, tags, content, created_at=None):
    created_at = created_at or int(time.time())
    serialized = json.dumps(
        [0, pub.hex(), created_at, kind, tags, content],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    eid = hashlib.sha256(serialized.encode()).digest()
    return {
        "id": eid.hex(),
        "pubkey": pub.hex(),
        "created_at": created_at,
        "kind": kind,
        "tags": tags,
        "content": content,
        "sig": schnorr_sign(eid, sk).hex(),
    }


def nip98_header(sk, pub, url, method, body_bytes):
    """NIP-98: a signed kind-27235 event proving this exact request."""
    tags = [
        ["u", url],
        ["method", method],
        ["payload", hashlib.sha256(body_bytes).hexdigest()],
    ]
    ev = build_event(sk, pub, 27235, tags, "")
    token = base64.b64encode(json.dumps(ev).encode()).decode()
    return f"Nostr {token}"


def post_event(sk, pub, event):
    url = f"{RELAY}/events"
    body = json.dumps(event).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": nip98_header(sk, pub, url, "POST", body),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# --- commands ----------------------------------------------------------------
def cmd_selftest():
    sk = hashlib.sha256(b"buzz-bot-selftest").digest()
    pub = point_mul(int.from_bytes(sk, "big"))[0].to_bytes(32, "big")
    msg = hashlib.sha256(b"hello buzz").digest()
    sig = schnorr_sign(msg, sk)
    assert schnorr_verify(msg, pub, sig), "signature failed to verify"
    assert not schnorr_verify(hashlib.sha256(b"tampered").digest(), pub, sig), "verified a bad message"
    ev = build_event(sk, pub, 9, [["h", "test"]], "hi")
    assert schnorr_verify(bytes.fromhex(ev["id"]), pub, bytes.fromhex(ev["sig"])), "event sig invalid"
    # round-trip bech32
    assert bech32_decode(bech32_encode("nsec", sk))[1] == sk, "bech32 round-trip failed"
    print("selftest OK — schnorr sign/verify, event id/sig, bech32 all consistent")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "selftest"
    if cmd == "selftest":
        return cmd_selftest()

    args = dict(zip(sys.argv[2::2], sys.argv[3::2]))
    sk, pub = load_key()

    if cmd == "join":
        ev = build_event(sk, pub, 9021, [["h", args["--channel"]]], "")
    elif cmd == "profile":
        meta = {"display_name": args.get("--name", "Upstream Bot"),
                "about": args.get("--about", "")}
        ev = build_event(sk, pub, 0, [], json.dumps(meta))
    elif cmd == "post":
        content = open(args["--file"], encoding="utf-8").read() if "--file" in args else args["--text"]
        ev = build_event(sk, pub, 9, [["h", args["--channel"]]], content)
    else:
        sys.exit(f"unknown command: {cmd}")

    status, resp = post_event(sk, pub, ev)
    print(f"{cmd}: HTTP {status} {resp[:400]}")
    sys.exit(0 if status < 300 else 1)


if __name__ == "__main__":
    main()
