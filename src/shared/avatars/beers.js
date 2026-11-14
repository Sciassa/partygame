/**
 * Le 12 birre-avatar dei giocatori (una per giocatore: 12 birre = 12 posti).
 * File di soli dati, senza Three.js: lo usano anche i controller sui telefoni (UI, colori).
 *
 *  - liquid: colore del liquido (avatar 3D)
 *  - foam:   colore della schiuma
 *  - accent: colore "identità" del giocatore (UI, etichette, anello del turno): 12 tinte ben
 *            distinte tra loro, perché due liquidi possono essere quasi uguali (Stout/Porter).
 *  - glass:  famiglia del bicchiere (pint | mug | tulip | weiss), la stessa del modello 3D
 *            (vedi BEER_PROFILE in src/three/BeerAvatarBuilder.ts)
 */
export const BEERS = Object.freeze([
  { id: 'lager', name: 'Lager', liquid: '#f2b232', foam: '#fff8e7', accent: '#f7c548', glass: 'mug', tagline: 'Classica, fresca, affidabile.' },
  { id: 'ipa', name: 'IPA', liquid: '#e2861c', foam: '#fff3dc', accent: '#ff8a3d', glass: 'tulip', tagline: 'Amara e piena di luppolo.' },
  { id: 'stout', name: 'Stout', liquid: '#1b0f0a', foam: '#e6cfa6', accent: '#ecdcc0', glass: 'pint', tagline: 'Nera, cremosa, misteriosa.' },
  { id: 'weiss', name: 'Weiss', liquid: '#f3bf55', foam: '#fffaf0', accent: '#c8e65a', glass: 'weiss', tagline: 'Velata, banana e chiodi di garofano.' },
  { id: 'pilsner', name: 'Pilsner', liquid: '#f6d34a', foam: '#ffffff', accent: '#57d982', glass: 'weiss', tagline: 'Dorata e frizzante.' },
  { id: 'redale', name: 'Red Ale', liquid: '#a3321c', foam: '#f7e6cc', accent: '#ff5050', glass: 'pint', tagline: 'Rossa, maltata, irlandese dentro.' },
  { id: 'sour', name: 'Sour', liquid: '#d9446f', foam: '#ffe3ec', accent: '#ff6fae', glass: 'tulip', tagline: 'Acida, fruttata, imprevedibile.' },
  { id: 'bock', name: 'Bock', liquid: '#7a3a12', foam: '#f3dfbf', accent: '#9b7bff', glass: 'mug', tagline: 'Robusta e caramellata.' },
  { id: 'neipa', name: 'NEIPA', liquid: '#f5a63a', foam: '#fff6e0', accent: '#2fd6c3', glass: 'weiss', tagline: 'Torbida come un succo tropicale.' },
  { id: 'porter', name: 'Porter', liquid: '#2c1610', foam: '#dcc3a0', accent: '#5f7dff', glass: 'pint', tagline: 'Tostata, cioccolato e caffè.' },
  { id: 'blanche', name: 'Blanche', liquid: '#f4e2a2', foam: '#ffffff', accent: '#5cc8ff', glass: 'weiss', tagline: 'Chiara, agrumi e coriandolo.' },
  { id: 'barleywine', name: 'Barley Wine', liquid: '#8a2a10', foam: '#efd2a8', accent: '#e05cff', glass: 'tulip', tagline: 'Forte e da meditazione.' },
]);

const BY_ID = new Map(BEERS.map((b) => [b.id, b]));

export function getBeer(id) {
  return BY_ID.get(id) ?? BEERS[0];
}

export function isBeerId(id) {
  return BY_ID.has(id);
}
