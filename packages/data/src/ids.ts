// T027: ID-generaattori. §32 vaatii UUID/ULID-tyyppiset globaalisti uniikit
// ID:t — tuotanto-ULID T030:n yhteydessä (sama generaattori koko kannalle);
// testit injektoivat deterministisen sarjan. Muoto: 26 merkkiä Crockford
// base32 (ULID-yhteensopiva, lajiteltava aikajärjestykseen).

import type { EntityId } from "@lifeos/domain";

export interface IdGenerator {
  next(): EntityId;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(timeMs: number): string {
  let value = Math.floor(timeMs);
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    const char = CROCKFORD[value % 32] ?? "0";
    out = char + out;
    value = Math.floor(value / 32);
  }
  return out;
}

export function ulidLikeId(timeMs: number, randomBytes: Uint8Array): EntityId {
  if (randomBytes.length < 16) {
    throw new Error("ulidLikeId vaatii vähintään 16 satunnaistavua.");
  }
  let out = encodeTime(timeMs);
  for (let i = 0; i < 16; i += 1) {
    const byte = randomBytes[i] ?? 0;
    out += CROCKFORD[byte % 32] ?? "0";
  }
  return out;
}

/** Deterministinen sarja testeihin: id-0001, id-0002, ... */
export function sequentialIdGenerator(prefix = "id"): IdGenerator {
  let counter = 0;
  return {
    next(): EntityId {
      counter += 1;
      return `${prefix}-${String(counter).padStart(4, "0")}`;
    },
  };
}

export function isValidEntityId(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}
