/** Random crittografico (equo per l'host, non prevedibile dai client). */
export function randomFloat() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export function randomInt(min, maxInclusive) {
  return min + Math.floor(randomFloat() * (maxInclusive - min + 1));
}

export function randomString(length, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(randomFloat() * alphabet.length)];
  return out;
}
