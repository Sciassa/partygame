# 🎡 Ruota Party

Party game multiplayer per 2–12 giocatori, ispirato ai game show e ai party game da tavolo, ambientato in un pub: ogni giocatore è una birra. Tutto gira nel browser come **PWA** su GitHub Pages: **non c'è un backend**. La rete è peer-to-peer (WebRTC tramite [PeerJS](https://peerjs.com/)) e la Ruota è in 3D con [Three.js](https://threejs.org/).

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
│   ├── HostCore.js          cervello headless: connessioni, turni, spin, heartbeat, log in console
│   ├── net/HostPeer.js      peer PeerJS con ID derivato dal codice stanza
│   ├── state/GameState.js   stato della partita (giocatori, birre, monete, ruota)
│   ├── physics/WheelPhysics.js  forza → velocità iniziale, risoluzione dello spicchio (mod 2π)
│   └── screen/HostScreen.js UI dello schermo Salotto (palco 3D, QR, giocatori)
├── client/                  ── CONTROLLER: telefono del giocatore ──
│   ├── ClientApp.js         UI giocatore e riconnessione automatica
│   ├── net/ClientPeer.js    connessione WebRTC verso l'host
│   ├── ui/SpinPad.js        swipe e "tieni premuto" → forza del lancio (0..1)
│   └── ui/BeerPicker.js     scelta della birra-avatar
├── pocket/startPocket.js    HostCore + ClientApp sullo stesso telefono (LocalLink)
├── shared/                  codice usato da entrambi i lati
│   ├── protocol.js          tipi di messaggio, fasi, versione del protocollo
│   ├── config.js            codice stanza, opzioni PeerJS/ICE, costanti
│   ├── net/Link.js          canale astratto: PeerLink (WebRTC) e LocalLink (in memoria)
│   ├── wheel/               kinematics (fisica ad attrito), WheelModel 3D, segmenti, texture
│   ├── avatars/             beers.js (12 birre), BeerAvatar 3D, AvatarLineup (bancone)
│   ├── stage/               StageRenderer (scena, luci, bloom, loop), PubSet, StageSync
│   └── ui/beerIcon.js       iconcina CSS del bicchiere
├── pwa/                     registrazione e template del Service Worker
└── styles/                  CSS "Modern Pub" dark (token in base.css)
```

### Fisica della ruota e sincronizzazione

1. **Lancio (client):** lo swipe o il tasto "tieni premuto" producono una forza 0..1. Il telefono invia solo `spin:req { force }`.
2. **Velocità iniziale (host):** `WheelPhysics.planSpin` trasforma la forza in velocità angolare ω0 (9–28 rad/s) e aggiunge ±12% di variazione casuale crittografica. La forza conta davvero (più giri, più durata), ma nessuno può "mirare" uno spicchio.
3. **Attrito:** la ruota rallenta per un attrito viscoso (frena tanto ad alta velocità) più uno radente (la ferma in un tempo finito): `dω/dt = -mu - k·ω`. Il moto è risolto **in forma chiusa** in `shared/wheel/kinematics.js`, quindi la posizione è una funzione del tempo e non dipende dal frame rate.
4. **Animazione:** `requestAnimationFrame` campiona `angleAt(plan, t)` a ogni frame, sulla TV e su ogni telefono. Il piano (ω0, attriti, angolo finale) viaggia **una volta sola** in rete, e chi si collega a metà spin riparte dal punto giusto grazie a `spin.elapsed`.
5. **Risoluzione:** `resolveStop` porta il puntatore (fisso in alto) nello spazio della ruota con `mod(-angolo, 2π)` e divide per l'ampiezza dello spicchio. L'host stampa in console lancio e risultato, per esempio:

```
[ruota] lancio #1: forza 64% → ω0 18.39 rad/s, arresto previsto in 6.47 s dopo 6.41 giri
[ruota] lancio #1 FERMO sullo spicchio #4 → MINIGIOCO (lanciato da Marco) | angolo ruota -40.2929 rad, puntatore a 148.61° sulla ruota, 95.4% dentro lo spicchio
```

Con un passo di Eulero dentro `requestAnimationFrame`, una TV a 60 Hz e un telefono a 120 Hz finirebbero su angoli diversi. Con la forma chiusa l'angolo finale è lo stesso ovunque.

### Avatar: le birre

`shared/avatars/beers.js` definisce 12 birre: Lager, IPA, Stout, Weiss, Pilsner, Red Ale, Sour, Bock, NEIPA, Porter, Blanche, Barley Wine. Ognuna ha il colore del liquido, quello della schiuma, la forma del bicchiere e un colore "identità" per la UI. Le birre sono uniche nella stanza (12 birre per 12 posti).

- Chi entra riceve una birra libera **a caso**. Al primo ingresso il telefono propone il selettore; la birra si può cambiare in ogni momento toccando il proprio nome (`avatar:pick { beerId }`, l'host verifica che sia libera).
- Sul palco 3D ogni giocatore è un bicchiere "designer toy" (LatheGeometry, faccina, schiuma) che atterra sul bancone con un rimbalzo elastico. Chi è di turno saltella con un anello luminoso, chi si disconnette sbiadisce e crolla di lato, chi vince monete fa una giravolta.
- È un placeholder procedurale: `BeerAvatar` ha un'API minima (`setBeer`, `setDimmed`, `dispose`), così si può sostituire con modelli GLB senza toccare il resto.

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

## Limiti noti

- **Pocket:** se il telefono host va in background o si blocca lo schermo, la partita si ferma per tutti. Non esiste ancora la migrazione dell'host.
- **Reti 4G/5G:** dietro NAT simmetrico serve un server TURN, configurabile via `.env.local`. Solo con STUN alcune connessioni possono fallire.
- **Eventi della ruota:** gli spicchi sono placeholder. Fortuna assegna monete, Trivia e Minigioco arriveranno nei prossimi step, insieme a negozio e adesivi.
