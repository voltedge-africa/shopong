"""Generate packages/events/vectors/golden.json.

This is a second, independent implementation of the ocn-jcs-1 canonical
profile (Python stdlib only), so the TypeScript implementation is checked
against a different language, JSON parser, sort and SHA-512. Run it with:

    python3 -I scripts/gen_vectors.py vectors/golden.json

Only edit the vector inputs below; never hand-edit the expected values in the
JSON file.
"""

import hashlib
import hmac
import json
import math
import re
import sys

MAX_SAFE = 2**53 - 1
MAX_DEPTH = 64


class Reject(Exception):
    pass


def esc(s):
    out = ['"']
    for ch in s:
        c = ord(ch)
        if 0xD800 <= c <= 0xDFFF:
            raise Reject("lone surrogate")
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif c < 0x20:
            out.append({8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r"}.get(c, "\\u%04x" % c))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def utf16_key(s):
    # Ordering by UTF-16BE bytes is ordering by UTF-16 code units (RFC 8785 3.2.3).
    return s.encode("utf-16-be", "surrogatepass")


def canon(v, depth=0):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float):
        # JSON text like 1.0 or 1E3 parses to an integral float; JavaScript sees the same integer.
        if not math.isfinite(v) or not v.is_integer():
            raise Reject("not an integer")
        v = int(v)
    if isinstance(v, int):
        if abs(v) > MAX_SAFE:
            raise Reject("not a safe integer")
        return str(v)
    if isinstance(v, str):
        return esc(v)
    if depth >= MAX_DEPTH:
        raise Reject("too deep")
    if isinstance(v, list):
        return "[" + ",".join(canon(x, depth + 1) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v.keys(), key=utf16_key)
        return "{" + ",".join(esc(k) + ":" + canon(v[k], depth + 1) for k in keys) + "}"
    raise Reject("not JSON")


def sha512_hex(text):
    return hashlib.sha512(text.encode("utf-8")).hexdigest()


def parse(text):
    # Like JSON.parse, keeps the last duplicate key and accepts lone surrogate escapes.
    return json.loads(text)


# ---------------------------------------------------------------------------
# Canonicalisation vectors. `input` is JSON text; platforms parse it with their
# own JSON parser, canonicalise, and compare text and SHA-512.

CANONICAL_ACCEPT = [
    ("empty object", "{}"),
    ("empty array", "[]"),
    ("empty string", '""'),
    ("literals", "[null, true, false]"),
    ("empty containers nested", '{"c": [{}, [], [[]]], "b": [], "a": {}}'),
    ("key order simple", '{"b": 2, "a": 1, "c": 3}'),
    ("key order case digits underscore", '{"a": 1, "B": 2, "_": 3, "1": 4, "aa": 5, "A": 6}'),
    ("key order prefixes", '{"abc": 1, "ab": 2, "a": 3, "": 4}'),
    (
        "rfc8785 3.2.3 sorting",
        '{"\\u20ac": "Euro Sign", "\\r": "Carriage Return", "\\ufb33": "Hebrew Letter Dalet With Dagesh",'
        ' "1": "One", "\\ud83d\\ude00": "Emoji: Grinning Face", "\\u0080": "Control",'
        ' "\\u00f6": "Latin Small Letter O With Diaeresis"}',
    ),
    (
        "rfc8785 3.2.2 strings and literals",
        '{"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    ),
    ("nesting", '{"z": {"y": {"x": [1, [2, [3, {"b": null, "a": true}]]]}}, "a": [{"d": {"c": {}}}]}'),
    (
        "unicode literal output",
        '{"name": "Thandiwe M\\u00fcller \\u2013 Spaza \\u00f1 \\u65e5\\u672c \\ud83d\\ude00", "zu": "Sawubona", "xh": "Molo"}',
    ),
    (
        "all control characters",
        '"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f'
        '\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f"',
    ),
    ("escapes not needed", '"\\/ \\u007f \\u2028 \\u2029 \\u00a0 </script> \' `"'),
    ("quote and backslash", '{"\\"\\\\": "\\\\\\"\\\\"}'),
    (
        "safe integer limits",
        "[9007199254740991, -9007199254740991, 0, -0, 1, -1, 1000000000000]",
    ),
    ("number spellings that parse to integers", "[1E3, 1.0, -0.0, 0e5, 2.5e1]"),
    (
        "bigint as decimal string",
        '{"amountCents": "123456789012345678901234567890", "negative": "-9007199254740993"}',
    ),
    ("proto key is plain data", '{"__proto__": {"x": 1}, "constructor": "c"}'),
]

CANONICAL_REJECT = [
    ("float", '{"a": 1.5}'),
    ("small float", "0.1"),
    ("2^53", "9007199254740992"),
    ("-2^53", "-9007199254740992"),
    ("large integer loses precision", "12345678901234567890"),
    ("overflow to infinity", "1e400"),
    ("rfc8785 3.2.2 numbers", "[333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001]"),
    ("lone high surrogate", '"\\ud800"'),
    ("lone low surrogate key", '{"\\udc00": 1}'),
    ("reversed surrogate pair", '"\\udc00\\ud800"'),
    ("too deep", "[" * 65 + "]" * 65),
]

# ---------------------------------------------------------------------------
# Event vectors.

SPACE = "5f0c" + "ab" * 30
ACTOR = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
PROOF = [
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsInVjdiI6IjAuOC4xIn0.eyJpc3MiOiJkaWQ6a2V5OnoifQ.c2lnbmF0dXJl",
]
NONCE = "000102030405060708090a0b0c0d0e0f"


def env(**over):
    e = {
        "v": 1,
        "type": "order.proposed",
        "space": SPACE,
        "actor": ACTOR,
        "proof": PROOF,
        "claimedAt": 1793001600000,
        "nonce": NONCE,
        "payload": {},
    }
    e.update(over)
    return e


def pretty(obj):
    # Deliberately non-canonical input text: indentation and insertion order.
    return json.dumps(obj, indent=2, ensure_ascii=True)


EVENT_ACCEPT = [
    (
        "known agent.action (loose payload)",
        "known",
        None,
        pretty(
            env(
                type="agent.action",
                payload={
                    "title": "Month-end bulk order \u2013 maize meal",
                    "lines": [
                        {"sku": "MAIZE-10KG", "qty": 20, "unitPriceCents": 12999},
                        {"sku": "OIL-2L", "qty": 10, "unitPriceCents": 6499},
                    ],
                    "totalCents": "324970",
                    "closesAt": 1793606400000,
                    "notes": "Collect at Mam' Dlamini's \U0001f6d2",
                }
            )
        ),
    ),
    (
        "known member.invited with commitment",
        "known",
        None,
        pretty(env(type="member.invited", payload={"phone": "c" * 128, "role": "member", "invitation": "bafyinvitation", "invitee": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "expiresAt": 1793606400000})),
    ),
    (
        "known root event without proof",
        "known",
        None,
        pretty(
            env(
                type="role.granted",
                proof=[],
                payload={"role": "driver", "grantee": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "expiresAt": 1793606400000},
            )
        ),
    ),
    (
        "unknown type",
        "opaque",
        "unknown-type",
        pretty(env(type="stokvel.rotation-scheduled", payload={"round": 3, "order": ["a", "b"]})),
    ),
    (
        "future version with extra fields",
        "opaque",
        "future-version",
        pretty(dict(env(v=2, payload={"x": {"y": [1, 2, 3]}}), sig="AAEC", meta={"z": None})),
    ),
    ("future version of known type", "opaque", "future-version", pretty(env(v=7, type="order.proposed"))),
]


def without(key):
    e = env()
    del e[key]
    return e


EVENT_REJECT = [
    ("missing nonce", pretty(without("nonce"))),
    ("missing payload", pretty(without("payload"))),
    ("v zero", pretty(env(v=0))),
    ("v as string", pretty(env(v="1"))),
    ("id field inside v1 envelope", pretty(dict(env(), id="0" * 128))),
    ("type not dotted", pretty(env(type="order"))),
    ("type uppercase", pretty(env(type="Order.Proposed"))),
    ("space not hex", pretty(env(space="space-1"))),
    ("actor not did:key", pretty(env(actor="did:web:example.org"))),
    ("proof not array", pretty(env(proof=PROOF[0]))),
    ("proof item not string", pretty(env(proof=[1]))),
    ("claimedAt negative", pretty(env(claimedAt=-1))),
    ("claimedAt float", pretty(env(claimedAt=1.5))),
    ("nonce too short", pretty(env(nonce="00ff"))),
    ("nonce uppercase", pretty(env(nonce=NONCE.upper()))),
    ("payload array", pretty(env(payload=[]))),
    ("float in payload", pretty(env(payload={"price": 129.99}))),
    ("future version missing field", pretty(dict(without("space"), v=2))),
    ("not an object", "[]"),
]


def wire_hex(text):
    return text.encode("utf-8").hex()


_CANON_EVENT = canon(env())
assert '"payload":{}' in _CANON_EVENT and '"v":1}' in _CANON_EVENT


def bad_payload_string(raw):
    """Canonical event bytes with payload {"a":"<raw bytes>"}; raw is not valid UTF-8."""
    good = _CANON_EVENT.encode("utf-8")
    return good.replace(b'"payload":{}', b'"payload":{"a":"' + raw + b'"}').hex()


DECODE_REJECT = [
    ("whitespace", wire_hex(pretty(env()))),
    ("unsorted keys", wire_hex(json.dumps(env(), separators=(",", ":"), ensure_ascii=False))),
    ("duplicate key", wire_hex(_CANON_EVENT[:-1] + ',"v":1}')),
    ("needless escape", wire_hex(_CANON_EVENT.replace('"order.proposed"', '"order\\u002eproposed"'))),
    ("number spelled 1.0", wire_hex(_CANON_EVENT.replace('"v":1}', '"v":1.0}'))),
    ("byte order mark", "efbbbf" + wire_hex(_CANON_EVENT)),
    ("invalid utf-8 byte", bad_payload_string(b"\xff")),
    ("overlong utf-8 slash", bad_payload_string(b"\xc0\xaf")),
    ("encoded surrogate", bad_payload_string(b"\xed\xa0\x80")),
    ("truncated", wire_hex(_CANON_EVENT)[:-2]),
]

# ---------------------------------------------------------------------------
# Phone normalisation and commitment vectors.

PHONE_ACCEPT = [
    ("082 123 4567", "+27821234567"),
    ("0821234567", "+27821234567"),
    ("+27 82 123 4567", "+27821234567"),
    ("+27 (0)82 123 4567", "+27821234567"),
    ("+27 082 123 4567", "+27821234567"),
    ("27821234567", "+27821234567"),
    ("0027821234567", "+27821234567"),
    ("082-123-4567", "+27821234567"),
    ("(082) 123.4567", "+27821234567"),
    ("\u202a+27\u00a082\u202f123\u20114567\u202c", "+27821234567"),
    ("011 555 0123", "+27115550123"),
    ("  +27115550123  ", "+27115550123"),
    ("+263 77 123 4567", "+263771234567"),
    ("00 44 20 7946 0958", "+442079460958"),
]

PHONE_REJECT = [
    "",
    "821234567",
    "082 123 456",
    "082 123 45678",
    "+27 82 123 456",
    "+27 0 82 123 456",
    "+27 0082 123 4567",
    "082 123 4567 ext 2",
    "+27-82-123-4567x",
    "++27821234567",
    "+0821234567",
    "+44 (0)20 7946 0958",
    "+1234567",
    "+1234567890123456",
    "\uff10\uff18\uff12\uff11\uff12\uff13\uff14\uff15\uff16\uff17",
]

COMMITMENT_SECRET = bytes(range(32))
OTHER_COMMUNITY_SECRET = bytes(range(1, 33))
# (secret, normalised value). Values are already normalised: phone numbers to E.164, ID numbers to 13 digits.
COMMITMENTS = [
    (COMMITMENT_SECRET, "+27821234567"),
    (COMMITMENT_SECRET, "+263771234567"),
    (COMMITMENT_SECRET, "8001015009087"),
    (OTHER_COMMUNITY_SECRET, "+27821234567"),
    (OTHER_COMMUNITY_SECRET, "8001015009087"),
]


def luhn_ok(digits):
    """Luhn check over a digit string, the rule South African ID numbers use for their 13th digit."""
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


ID_ACCEPT = [
    ("8001015009087", "8001015009087"),
    ("800101 5009 087", "8001015009087"),
    ("800101-5009-087", "8001015009087"),
    ("  8001015009087  ", "8001015009087"),
]

ID_REJECT = [
    "",
    "800101500908",
    "80010150090877",
    "8001015009088",
    "800101500908A",
    "800101 5009 08",
    "+27821234567",
    "\uff18\uff10\uff10\uff11\uff10\uff11\uff15\uff10\uff10\uff19\uff10\uff18\uff17",  # fullwidth digits, valid check digit
]

# Plain SHA-512 of attachment bytes (Hyperdrive later stores the same bytes under the same hash).
ATTACHMENT_FILES = [
    ("empty file", b""),
    ("price list text", "Maize meal 10kg R129.99\n".encode("utf-8")),
    ("every byte value", bytes(range(256))),
]


def build():
    out = {
        "description": "Golden vectors for @shopong/events. Generated by scripts/gen_vectors.py; do not hand-edit.",
        "profile": "ocn-jcs-1",
        "canonical": {"accept": [], "reject": []},
        "events": {"accept": [], "reject": [], "decodeReject": []},
        "phone": {"accept": [], "reject": PHONE_REJECT},
        "commitments": [],
    }
    for name, text in CANONICAL_ACCEPT:
        c = canon(parse(text))
        assert canon(parse(c)) == c, name
        out["canonical"]["accept"].append({"name": name, "input": text, "canonical": c, "sha512": sha512_hex(c)})
    for name, text in CANONICAL_REJECT:
        try:
            canon(parse(text))
        except Reject:
            out["canonical"]["reject"].append({"name": name, "input": text})
        else:
            raise SystemExit(f"reject vector accepted: {name}")
    for name, status, reason, text in EVENT_ACCEPT:
        c = canon(parse(text))
        out["events"]["accept"].append(
            {"name": name, "status": status, "reason": reason, "input": text, "canonical": c, "eventId": sha512_hex(c)}
        )
    for name, text in EVENT_REJECT:
        out["events"]["reject"].append({"name": name, "input": text})
    for name, hx in DECODE_REJECT:
        out["events"]["decodeReject"].append({"name": name, "wireHex": hx})
    for raw, norm in PHONE_ACCEPT:
        out["phone"]["accept"].append({"input": raw, "normalised": norm})
    for secret, value in COMMITMENTS:
        out["commitments"].append(
            {
                "secretHex": secret.hex(),
                "value": value,
                "commitment": hmac.new(secret, value.encode("utf-8"), hashlib.sha512).hexdigest(),
            }
        )
    out["id"] = {"accept": [], "reject": ID_REJECT}
    for raw, norm in ID_ACCEPT:
        assert luhn_ok(norm) and len(norm) == 13, raw
        out["id"]["accept"].append({"input": raw, "normalised": norm})
    for bad in ID_REJECT:
        digits = bad.replace(" ", "").replace("-", "")
        assert not (re.fullmatch("[0-9]{13}", digits) and luhn_ok(digits)), bad
    out["attachments"] = []
    for name, data in ATTACHMENT_FILES:
        out["attachments"].append({"name": name, "bytesHex": data.hex(), "sha512": hashlib.sha512(data).hexdigest()})
    return out


if __name__ == "__main__":
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(build(), f, indent=2, ensure_ascii=True)
        f.write("\n")
