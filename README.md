# 🎡 Ruota Party

Party game multiplayer per 2–12 giocatori, ispirato ai game show e ai party game da tavolo. Tutto gira nel browser come **PWA** su GitHub Pages: **non c'è un backend**. La rete è peer-to-peer (WebRTC tramite [PeerJS](https://peerjs.com/)) e la Ruota è in 3D con [Three.js](https://threejs.org/).

## Modalità

| Modalità | Chi fa da host | Chi vede la ruota 3D | Telefoni |
| --- | --- | --- | --- |
| 📺 **Salotto** | PC/TV/tablet (schermo grande) | solo lo schermo grande | controller leggeri: niente Three.js |
| 📱 **Pocket** | il telefono di chi crea la stanza, in modo invisibile | tutti, ognuno sul proprio telefono | controller + ruota sincronizzata |

I giocatori entrano scansionando il QR code (`?room=ABCD`) oppure scrivendo il codice di 4 lettere.

## Sviluppo

Requisiti: Node 22 e pnpm 10. Se non hai pnpm, `corepack enable` lo attiva.

```bash
pnpm install
```

```bash
pnpm dev
```

Vite parte con `--host`, quindi i telefoni sulla stessa Wi-Fi possono aprire `http://<ip-del-pc>:5173`.

| Comando | Cosa fa |
| --- | --- |
| `pnpm dev` | server di sviluppo con HMR (il Service Worker è disattivato) |
| `pnpm build` | build di produzione in `dist/` e generazione di `dist/sw.js` |
| `pnpm preview` | serve la build per provare la PWA e il Service Worker |
| `pnpm icons` | rigenera le icone PNG in `public/icons/` |

### Trucchi per il debug

- **SPAZIO** sullo schermo Salotto gira la ruota anche senza telefoni. **F** attiva lo schermo intero.
- `?debug` nell'URL mostra il contatore FPS sulla ruota.
- `?multi` nell'URL dà a ogni scheda un'identità diversa, così puoi simulare più giocatori nello stesso browser.

### Signaling server

Di default si usa il cloud pubblico gratuito di PeerJS (`0.peerjs.com`). Serve solo per l'handshake iniziale; dopo, i dati di gioco viaggiano P2P. Per usare un PeerServer tuo, o aggiungere un server TURN per le reti mobili con NAT restrittivo, copia `.env.example` in `.env.local` e compilalo.

## Architettura

```
src/
├── main.js                  router: landing oppure rientro automatico in una stanza
├── app/Landing.js           schermata iniziale (Salotto / Pocket / Entra)
├── host/                    ── AUTORITATIVO: gira solo sul dispositivo host ──
│   ├── HostCore.js          cervello headless: connessioni, turni, spin, heartbeat
│   ├── net/HostPeer.js      peer PeerJS con ID derivato dal codice stanza
│   ├── state/GameState.js   stato della partita (giocatori, monete, ruota)
│   ├── physics/WheelPhysics.js  decide l'esito (random crittografico) e pianifica lo spin
│   └── screen/HostScreen.js UI dello schermo Salotto (ruota, QR, giocatori)
├── client/                  ── CONTROLLER: telefono del giocatore ──
│   ├── ClientApp.js         UI giocatore e riconnessione automatica
│   ├── net/ClientPeer.js    connessione WebRTC verso l'host
│   └── ui/SpinPad.js        swipe e "tieni premuto" per girare la ruota
├── pocket/startPocket.js    HostCore + ClientApp sullo stesso telefono (LocalLink)
├── shared/                  codice usato da entrambi i lati
│   ├── protocol.js          tipi di messaggio, fasi, versione del protocollo
│   ├── config.js            codice stanza, opzioni PeerJS/ICE, costanti
│   ├── net/Link.js          canale astratto: PeerLink (WebRTC) e LocalLink (in memoria)
│   └── wheel/               WheelRenderer (Three.js), kinematics, segmenti, texture
├── pwa/                     registrazione e template del Service Worker
└── styles/                  CSS neon (tema base, da rifinire sulle reference)
```

### Come resta sincronizzata la ruota

1. Il client invia solo un'intenzione: `spin:req { power }`.
2. L'host sceglie lo spicchio vincente con `crypto.getRandomValues` e calcola un piano `{ from, to, duration }` che atterra esattamente lì.
3. Il piano viene inviato **una volta sola** a tutti. Ogni dispositivo anima la ruota con la stessa funzione pura `angleAt(plan, t)` in `shared/wheel/kinematics.js`.

Non c'è uno stream di posizioni e il risultato è identico ovunque. Chi entra a ruota già in movimento la riprende dal punto giusto grazie a `spin.elapsed` nello snapshot di stato.

### Robustezza di rete

- **Heartbeat ping/pong** ogni 2 s: le connessioni silenziose da 7 s vengono chiuse, perché Safari non sempre segnala la chiusura.
- **Riconnessione automatica** sul client con backoff, più un tentativo immediato quando l'app torna in primo piano.
- **Identità persistente** (`clientId` in localStorage): chi rientra recupera posto, colore e monete. Ricaricare la pagina riporta direttamente nella stanza.
- Se il giocatore di turno cade, ha 8 s per rientrare, poi il turno passa al successivo.

### PWA

- `public/manifest.json` usa `display: fullscreen` con fallback `standalone`, icone normali e maskable e `start_url` relativo.
- Meta tag iOS: `apple-mobile-web-app-capable`, status bar `black-translucent` e `viewport-fit=cover` con gestione delle safe area.
- `src/pwa/sw.js` è un template. In build un piccolo plugin Vite (`vite.config.js`) inietta la lista dei file e una versione basata sull'hash. Le pagine usano network-first, gli asset cache-first.
- Un aggiornamento non viene attivato a metà partita: la home mostra "Aggiorna".
- Lo schermo resta acceso con la Wake Lock API. Su Android, nel browser, si passa a schermo intero al primo tap.

## Deploy

Il workflow `.github/workflows/deploy.yml` esegue la build e pubblica su GitHub Pages a ogni push su `main`. Prima va attivato una volta da **Settings → Pages → Source: GitHub Actions**. La configurazione `base: './'` funziona sia su `utente.github.io/partygame/` sia su un dominio custom.

## Limiti noti (step 1)

- **Pocket:** se il telefono host va in background o si blocca lo schermo, la partita si ferma per tutti. Non esiste ancora la migrazione dell'host.
- **Reti 4G/5G:** dietro NAT simmetrico serve un server TURN, configurabile via `.env.local`. Solo con STUN alcune connessioni possono fallire.
- **Eventi della ruota:** gli spicchi sono placeholder. Fortuna assegna monete, Trivia e Minigioco arriveranno nei prossimi step, insieme a negozio e adesivi.
