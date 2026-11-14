# 🎡 Ruota Party

Party game multiplayer per 2–12 giocatori, ispirato ai game show e ai party game da tavolo, ambientato in un pub: ogni giocatore è una birra. Tutto gira nel browser come **PWA** su GitHub Pages: **non c'è un backend**. La rete è peer-to-peer (WebRTC tramite [PeerJS](https://peerjs.com/)) e la Ruota è in 3D con [Three.js](https://threejs.org/).

## Modalità

| Modalità | Chi fa da host | Chi vede la ruota 3D | Telefoni |
| --- | --- | --- | --- |
| 📺 **Salotto** | PC/TV/tablet (schermo grande) | solo lo schermo grande | controller leggeri: niente Three.js |
| 📱 **Pocket** | il telefono di chi crea la stanza, in modo invisibile | tutti, ognuno sul proprio telefono | controller + ruota sincronizzata |

I giocatori entrano scansionando il QR code (`?room=ABCD`) oppure scrivendo il codice di 4 lettere.

## Regolamento «Spin & Sip»

Si vince con le **Pinte d'Oro**; a parità di Pinte contano i **Tappi**. La partita dura 12, 15 o 20 turni (si sceglie in lobby); ogni turno è un lancio della ruota.

**Un turno**
1. **Negozio (25 s):** chi è di turno vede 3 adesivi a caso dal catalogo di 30 (`src/data/stickers.ts`) e può incollarne uno su uno spicchio. Se in lobby è attiva l'opzione, nel negozio può anche comprare una Pinta d'Oro.
2. **Scommesse (8 s):** gli altri puntano 0, 15 o 30 Tappi sulla categoria dove si fermerà la ruota (paga x3) e/o sull'esito del turno per chi lancia, guadagno o perdita (paga x2).
3. **Lancio:** swipe o tasto, con la fisica ad attrito di sempre. Il **Top Slot** estrae uno spicchio e un moltiplicatore (x2, x3 o +100 di jackpot): se la ruota si ferma proprio lì, i premi del turno si moltiplicano.
4. **Atterraggio:** si pagano le scommesse sulla categoria, il Top Slot, le royalties (15 Tappi al proprietario dell'adesivo), poi scatta l'effetto dell'adesivo.
5. **Evento dello spicchio:**
   - **Trivia:** per tutti, a scelta multipla o a risposta aperta; la velocità dà Tappi extra.
   - **Minigioco:** uno tra Impostore Flash, Spillatura Perfetta, Asta al Buio e Higher/Lower.
   - **Fortuna:** Tappi in più o in meno per chi ha lanciato.
   - **Fusto d'Oro:** si convertono Tappi in una Pinta; costa 250 e sale di 50 a ogni acquisto.
6. **Fine turno:** si pagano le scommesse sull'esito, poi riepilogo.

**Adesivi**
- Prendono il bordo del colore della birra del proprietario.
- Incollarne uno su un proprio spicchio lo porta al Lv.2, con effetto raddoppiato.
- Sovrascrivere l'adesivo di un altro costa +50%; il Lucchetto lo impedisce.
- Ci sono 4 famiglie: Economia, Strategia, Manipolazione ruota e Sabotaggi. L'Espansione allarga davvero lo spicchio sulla ruota 3D.
- I sabotaggi (Blackout, Dito Tremante, Fuso Orario, Sabotaggio, Dislessia) cambiano l'interfaccia dei telefoni nel prossimo evento e colpiscono tutti tranne il proprietario. La Dittatura fa scegliere la categoria del prossimo Trivia.

**🍻 Bancone & Sottobanco** (dal tasto *Bancone* sul telefono, aperto a inizio turno: negozio, scommesse, lancio):
- **🎯 Taglia (40 Tappi):** metti una taglia su un avversario per 2 turni; sulla sua birra 3D compare il cartellino *TAGLIA*. Chi lo batte (Sfida 1v1, Asta al Buio) o gli fa perdere Tappi (con un suo adesivo, smascherandolo da Impostore) incassa **60 Tappi** dalla banca.
- **🤫 Sottobanco:** passi 20 o 50 Tappi a un amico, uno per turno. Sulla TV compare solo «Movimento sospetto al bancone!».
- **🥃 Shot** (uno alla volta nel taschino, si usa nel proprio turno prima di lanciare):
  - **Assenzio (60):** il prossimo lancio ignora le trappole nemiche e non paga royalties.
  - **Tequila Bum Bum (50):** i guadagni del prossimo evento valgono x2.5; se non guadagni nulla, -50.
  - **Birra Analcolica (45):** la lanci su un avversario. La sua birra 3D diventa grigia e bagnata, e al suo prossimo Trivia le risposte sono coperte di schiuma: servono 2 tocchi per scoppiarla.

**Emote:** dal telefono CIN CIN · AHAHAH · BUUU · DAJE (ricarica di 2.5 s). La birra del giocatore salta sulla TV con un fumetto, uno spruzzo di schiuma e il suo suono.

**Happy Hour:** negli ultimi 3 turni le luci 3D passano al neon viola e oro e tutti i Tappi vinti o persi valgono doppio.

**Fine partita:** 3 Bonus Segreti, +1 Pinta d'Oro ciascuno, poi la classifica.
- **Fulmine del Pub:** il tempo medio più veloce nelle risposte giuste ai Trivia.
- **Architetto del Caos:** chi ha piazzato più adesivi.
- **Bersaglio Umano:** chi ha subito più malus.

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
| `pnpm simulate [n] [seed]` | simula n partite complete con bot, senza browser, e controlla le regole |
| `pnpm test:rules` | test mirati del regolamento (adesivi, Happy Hour, Fusto, premi) |
| `pnpm validate:questions` / `pnpm typecheck` | controllo del database Trivia e dei tipi |

### Trucchi per il debug

- Sullo schermo Salotto: **INVIO** avvia la partita, **SPAZIO** fa un lancio di prova quando tocca a qualcuno, **F** attiva lo schermo intero.
- `?speed=4` sullo schermo host accelera tutti i timer di gioco, ma non le animazioni della ruota: utile per provare una partita intera in pochi minuti.
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
│   ├── HostCore.js          rete: connessioni, heartbeat, stato pubblico + dati privati per giocatore
│   ├── game/GameEngine.js   regolamento Spin & Sip: fasi, timer, economia, scommesse, Top Slot, Happy Hour
│   ├── game/stickerEngine.js  negozio e i 30 adesivi (piazzamento, Calamita, Jackpot, effetti)
│   ├── game/events/         trivia + sfida 1v1, impostore, spillatura, asta, higher/lower
│   ├── game/awards.js       Bonus Segreti di fine partita
│   ├── game/counter.js      Bancone & Sottobanco (taglie, passaggi, shot) e cooldown delle emote
│   ├── net/HostPeer.js      peer PeerJS con ID derivato dal codice stanza
│   ├── state/GameState.js   stato della partita (giocatori, birre, monete, ruota)
│   ├── state/BeerPoolManager.ts  registro Map<peerId, beerId>: birre uniche, cambi validati
│   ├── physics/WheelPhysics.js  forza → velocità iniziale, risoluzione dello spicchio (mod 2π)
│   └── screen/HostScreen.js UI dello schermo Salotto (palco 3D, QR, giocatori)
├── client/                  ── CONTROLLER: telefono del giocatore ──
│   ├── ClientApp.js         UI giocatore e riconnessione automatica
│   ├── net/ClientPeer.js    connessione WebRTC verso l'host
│   ├── ui/SpinPad.js        swipe e "tieni premuto" → forza del lancio (0..1)
│   ├── ui/panels.js         un pannello per ogni fase/minigioco (+ sabotaggi e schiuma sull'interfaccia)
│   ├── ui/BeerPicker.js     «🍺 Cambia Birra»: griglia 3×4 in vetro smerigliato, aggiornata in tempo reale
│   ├── ui/ReactionBar.js    barra delle emote con ricarica
│   └── ui/CounterSheet.js   foglio «Bancone & Sottobanco»
├── three/                   ── 3D in TypeScript ──
│   ├── BeerAvatarBuilder.ts bicchieri per rotazione (LatheGeometry) da 4 profili + getRadiusAtY
│   └── JuiceDirector.ts     respiro/palpebre/bollicine, pedana di lancio, puntatore fisico, regia camera, emote
├── audio/SoundEngine.ts     tutti i suoni sintetizzati con Web Audio (clack, adesivi, emote, buzzer...)
├── pocket/startPocket.js    HostCore + ClientApp sullo stesso telefono (LocalLink)
├── shared/                  codice usato da entrambi i lati
│   ├── protocol.js          tipi di messaggio, fasi, versione del protocollo
│   ├── config.js            codice stanza, opzioni PeerJS/ICE, costanti
│   ├── net/Link.js          canale astratto: PeerLink (WebRTC) e LocalLink (in memoria)
│   ├── wheel/               kinematics (fisica ad attrito), WheelModel 3D, segmenti, texture
│   ├── avatars/             beers.js (12 birre), AvatarLineup (anfiteatro sul bancone)
│   ├── game/                display, regole condivise del Bancone, emote
│   ├── stage/               StageRenderer (scena, luci, bloom, loop), PubSet, StageSync
│   └── ui/beerIcon.js       iconcina CSS del bicchiere
├── data/                    domande Trivia, 30 adesivi, 50 parole dell'Impostore, 44 curiosità numeriche
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

`shared/avatars/beers.js` definisce 12 birre: Lager, IPA, Stout, Weiss, Pilsner, Red Ale, Sour, Bock, NEIPA, Porter, Blanche, Barley Wine. Ognuna ha il colore del liquido, quello della schiuma, la famiglia del bicchiere e un colore "identità" per la UI.

**Birre uniche: `BeerPoolManager`** (`host/state/BeerPoolManager.ts`) tiene `assignedBeers: Map<peerId, beerId>`.
- Chi entra riceve una birra libera **a caso**. Chi esce la libera, e quando rientra riprende la sua se è ancora libera.
- La stanza è piena con 12 giocatori connessi, uno per birra.
- **Cambio birra** dal tasto «🍺 Cambia Birra» (in lobby e finché la ruota non ha girato la prima volta). Il telefono invia `{ type: 'REQUEST_BEER_CHANGE', peerId, newBeerId }`. L'host usa l'id della sessione, non quello scritto nel messaggio, controlla che la birra sia libera, aggiorna la mappa e trasmette a tutti `{ type: 'BEER_POOL_SYNC', assigned, free }`.
- Nel selettore le birre occupate sono semitrasparenti (opacità 0.35), non cliccabili e mostrano il nome di chi le beve. La propria ha il bordo ambra.
- In 3D il vecchio avatar viene smontato (geometrie e materiali liberati) e il nuovo entra crescendo da 0.01 a 1 in 350 ms, con un ease *backOut*.

**Geometria** (`three/BeerAvatarBuilder.ts`): ogni bicchiere è una `LatheGeometry` (32 segmenti) generata da uno di 4 profili.

| Profilo | Birre | Forma |
| --- | --- | --- |
| `PINT_GLASS` | Stout, Red Ale, Porter | Base r 0.28 fino a y 1.1, rigonfiamento nonic r 0.38 a y 0.85 |
| `MUG_STEIN` | Lager, Bock | Cilindro r 0.36 con manico `Torus(0.18, 0.04, 12, 24, π)` |
| `TULIP_STEM` | IPA, Sour, Barley Wine | Piede r 0.25, stelo r 0.07 fino a y 0.35, coppa r 0.37 a y 0.65, bocca r 0.30 |
| `WEISS_TALL` | Weiss, Pilsner, Blanche, NEIPA | Alto 1.25: base 0.24, vita 0.22, bocca 0.34 |

`getRadiusAtY(profilo, yNormalizzata)` guida tutto il resto, così niente fluttua e niente compenetra:
- liquido e schiuma (cilindro smussato più 5 sfere) seguono il profilo;
- occhi (`Sphere(0.038)` schiacciate, con riflesso) e bocca stanno a raggio(y) + 0.025;
- le spalle sono a raggio(y) + 0.04 (sul boccale le braccia vanno avanti di 25°, per non toccare il manico);
- il bicchiere è sollevato di 0.14 su gambette con scarpette rivolte verso la camera.

**Disposizione ad anfiteatro** davanti alla ruota.
- Fino a 6 giocatori stanno su un arco (R 3.2) da -70° a +70°; oltre, su due archi sfalsati (R 3.2 e 4.1).
- La finestra centrale -18°..+18° resta libera: lì c'è la **Pedana di Lancio**, dove cammina chi è di turno, sotto un occhio di bue caldo.
- Sulla TV l'arco si allarga, sui telefoni si stringe. Le birre guardano la camera.

**Vita** (`AvatarLineup` + `three/JuiceDirector.ts`):
- **Respiro:** squash & stretch `s = sin(t·3.2 + i·1.37)·0.035`, a volume costante.
- **Dondolio:** `sin(t·1.6 + φ)·0.04`.
- **Palpebre:** ogni 3.5 + (i mod 3) s, chiuse per 120 ms.
- **Bollicine:** 18 per birra, in un `InstancedMesh`, salgono nel liquido.
- **Comportamenti:** azioni casuali in attesa, tifo durante lo spin, applausi, esultanze. Chi è di turno ha le braccia al doppio della velocità.
- **Segni sul bicchiere:** cartellino 🎯 TAGLIA, bicchiere grigio e gocciolante per la Birra Analcolica.

### Regia, puntatore e audio

- **Puntatore fisico** (`FlapperPhysics`).
  - Vengono contati **tutti** i confini di spicchio attraversati in un frame, anche a ruota velocissima.
  - A ogni piolo: `vel = min(velocità·1.8, 12)`, nel verso della rotazione.
  - Molla: `angolo += vel·dt; vel += (-angolo·180 - vel·14)·dt`, integrata a passi di 1/240 s.
  - A ogni piolo suona `SoundEngine.playPegClack(velocità)`.
- **Telecamera dinamica** (`CameraDirector`, inseguimento `lerp(dt·3.5)`):
  - campo largo in attesa;
  - leggera carrellata indietro con orbita lenta durante il lancio;
  - sotto 1.8 rad/s, zoom di suspense sulla metà alta della ruota e sul puntatore, poi ritorno al campo largo.
- **Inquadrature automatiche:** sono calcolate con una ricerca binaria sulla proiezione dei punti chiave (ruota, lampada, posti, pedana), quindi funzionano in ogni formato. Sulla TV, quando c'è la carta evento a destra, la scena scivola nello spazio libero (`camera.setViewOffset`).
- **Audio procedurale** (`audio/SoundEngine.ts`, zero file). Si sblocca al primo tocco e un compressore sul master evita la saturazione. Effetti:
  - clack del puntatore: rumore bianco passa-banda a 950 Hz, inviluppo di 35 ms, più acuto con la velocità;
  - adesivo bonus: arpeggio a onda triangolare Do5-Mi5-Sol5-Do6;
  - trappola: discesa cromatica a dente di sega con passa-basso da 180 a 70 Hz;
  - CIN CIN: tintinnio di vetro con parziali a 1800 e 2400 Hz;
  - poi risata, pernacchia, DAJE, buzzer, lancio, vincita, monete, splash, shot, bolle che scoppiano.

### Telefono (~6", iPhone con Dynamic Island)

- `viewport-fit=cover` e padding con `env(safe-area-inset-*)`: niente sotto la Dynamic Island né sotto la barra Home.
- In Pocket il palco 3D ha un'**altezza per fase**:
  - 56% dello schermo quando la ruota gira e si ferma;
  - circa 40% in lobby, al lancio e nei riepiloghi;
  - 27% quando servono spazio per rispondere o comprare.
- Il Top Slot sta in una riga compatta sotto la ruota, non sopra.
- In basso c'è il dock con le emote e il tasto Bancone; il pannello si scorre senza tagliare la cima.
- Sotto i 700 px di altezza (iPhone SE, Safari con le barre) tutto si compatta ancora.

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

### Database Trivia (`src/data/questions/`)

Ci sono **361 domande** in italiano su 7 categorie, a difficoltà media/alta da pub quiz, pensate per ventenni. Le categorie pop (sport, musica, cinema e serie, internet/gaming/tech) parlano solo del periodo **dal 2012 a oggi**. Storia, geografia, arte e letteratura spaziano su qualsiasi epoca.

| File | Categoria | Domande |
| --- | --- | --- |
| `sport.ts` | Calcio, tennis, F1, atletica, NBA, moto | 52 |
| `musica.ts` | Sanremo, rap/urban italiano, tormentoni, pop internazionale | 50 |
| `storia.ts` | Battaglie, personaggi, date, curiosità | 52 |
| `geografia.ts` | Capitali infide, confini, fiumi, bandiere, record | 52 |
| `arte_letteratura.ts` | Opere, musei, correnti, romanzi, autori | 52 |
| `cinema_serie.ts` | Oscar, registi, serie cult, cinema italiano | 51 |
| `pop_tech.ts` | Videogiochi, meme, social, streamer, tech, IA | 52 |

- **Doppio formato:** ogni domanda ha `answer`, 3 `wrongAnswers` plausibili per `TRIVIA_CHOICE` (mescolati da `toChoiceRound`) e `acceptedAnswers` per `TRIVIA_OPEN` (cognome, grafie senza accenti, numeri in lettere).
- **Risposta aperta** (`checkOpenAnswer`): tollera maiuscole, accenti, punteggiatura, articoli e qualche refuso in proporzione alla lunghezza. Numeri e numeri romani devono coincidere esattamente, e una risposta vicina a un distrattore viene rifiutata (es. «Roman Roy» non vale per «Logan Roy»).
- **Niente ripetizioni:** `getUsedQuestionsTracker({ rng })` va creato a inizio partita e non ripesca mai una domanda già uscita. Si può filtrare per categoria o difficoltà, e ha `usedIds()` e `markUsed()` per salvare e riprendere una partita.
- **Controllo qualità:** `pnpm validate:questions` verifica id e testi univoci, opzioni distinte, che il fuzzy accetti tutte le varianti e non accetti mai un distrattore, e casi reali di battitura. Gira anche nella CI prima del deploy, insieme a `pnpm typecheck`.
- **Per aggiungere domande:** si aggiungono **in fondo** all'array del file di categoria, così gli id già esistenti non cambiano.

### Look "vinyl toy" e luci

- **Materiali** (`shared/stage/vinyl.js`): MeshStandardMaterial con metalness 0 e roughness alta, più una luce di taglio ambra calcolata nello shader (Fresnel) che accende sempre le sagome dal lato della luce.
- **Ruota** (`shared/wheel/WheelModel.js`): come la reference, con corpo blu notte spesso, anello e borchie oro (le borchie sono i pioli del puntatore), filo neon ambra a segmenti (rincorsa durante lo spin, lampeggio sullo spicchio vincente), mozzo a cupola con mezzaluna ambra, puntatore con lampada che "scatta" a ogni borchia e piedistallo con bordo oro, mezza cupola luminosa e LED.
- **Luci e ambiente** (`shared/stage/PubSet.js`): faretto caldo principale, due controluce arancio radenti, fill freddo debolissimo, lampade calde ai lati, fondale di pub fuori fuoco (bokeh), foschia leggera e environment map da studio.
- **Ombre:** solo in qualità alta, dal faretto, con `PCFShadowMap` e `shadow.radius` (penombra larga). In three r187 `PCFSoftShadowMap` è stato rimosso e ripiega su PCF con un avviso. Sotto ogni bicchiere c'è anche un'ombra di contatto sfumata, che resta attiva sui telefoni.
- **60 fps:** se la media scende sotto 50 fps, `StageRenderer` toglie nell'ordine ombre, bloom e risoluzione.

## Deploy

Il workflow `.github/workflows/deploy.yml` esegue la build e pubblica su GitHub Pages a ogni push sul **branch di default** del repo, perché l'ambiente `github-pages` accetta deploy solo da lì. Non serve nessun server: GitHub Pages ospita i file statici e il signaling passa dal cloud pubblico di PeerJS. La configurazione `base: './'` funziona sia su `utente.github.io/partygame/` sia su un dominio custom.

## Limiti noti

- **Pocket:** se il telefono host va in background o si blocca lo schermo, la partita si ferma per tutti. Non esiste ancora la migrazione dell'host.
- **Reti 4G/5G:** dietro NAT simmetrico serve un server TURN, configurabile via `.env.local`. Solo con STUN alcune connessioni possono fallire.
- **Bilanciamento:** prezzi degli adesivi, premi dei minigiochi e costo delle Pinte sono una prima taratura, verificata con il simulatore ma non ancora con persone vere.
