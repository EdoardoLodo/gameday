# Gameday Answer Highlighter

Estensione Chrome Manifest V3 privata per il simulatore Gameday. Legge domande e opzioni visibili, confronta dataset CSV, regole deterministiche e memoria locale, poi evidenzia solo le risposte probabili.

Non compila campi, non clicca, non invia form, non modifica `value`, `checked`, `selectedIndex` o `placeholder`, non usa server/API esterne e non mostra popup, alert, badge o UI invasiva.

## Dataset CSV

Metti `dataset.csv` nella root dell'estensione, accanto a `manifest.json`. Il loader lo apre con:

```js
chrome.runtime.getURL("dataset.csv")
```

Il CSV puo contenere colonne mancanti e celle con virgole, virgolette o newline. Le colonne piu importanti sono `questionText`, `normalizedQuestion`, `inputTypes`, `optionsSeen`, `correctAnswers`, `wrongAnswers`, `lastSelectedAnswers`, `recordQuality` ed `exportUsableForGamedayExt`.

`correctAnswers` e la fonte forte perche arriva dalla pagina finale confermata. `lastSelectedAnswers` e invece solo un fallback debole: viene usato solo se non ci sono risposte esplicite/regole forti/correctAnswers migliori e se la risposta e presente tra le opzioni correnti.

## Qualita Righe

`recordQuality=confirmed_correct` usa `correctAnswers` con confidence alta. `confirmed_correct_low_quality_text` viene usato con confidence ridotta. `aggregated_group` e `bad_question_text` sono ignorate. `exportUsableForGamedayExt=no` e ignorato, `caution` viene usato con peso ridotto.

Le righe generiche tipo "compilare i seguenti campi" con molte risposte aggregate vengono scartate per evitare falsi positivi.

## Priorita

La priorita applicata e:

1. Risposta esplicita nella domanda corrente.
2. Regola deterministica sicura sulla domanda corrente.
3. `correctAnswers` dalla memoria locale.
4. `correctAnswers` dal CSV.
5. `wrongAnswers` per escludere o marcare rosso.
6. `lastSelectedAnswers` dal CSV solo come fallback debole.
7. `candidateAnswers` locali solo come fallback debole.

Una risposta scritta nella domanda corrente vince sempre su CSV, memoria e fuzzy matching.

## Installazione

1. Apri `chrome://extensions`.
2. Attiva `Modalita sviluppatore`.
3. Clicca `Carica estensione non pacchettizzata`.
4. Seleziona questa cartella, quella con `manifest.json`.
5. Ricarica la pagina del simulatore.

## Host Autorizzati

La configurazione e in `config.js`:

```js
siteScope: {
  enabled: true,
  allowedHosts: [
    "app.simulatoreclickday.it",
    "simulatoreclickday.it",
    "*.simulatoreclickday.it"
  ],
  allowAllHosts: true
}
```

La modalita attuale replica l'estensione di riferimento caricandosi su tutti gli URL. Per limitarla di nuovo ai soli ambienti autorizzati, imposta `allowAllHosts: false` e aggiungi eventuali domini in `allowedHosts`.

## Evidenziazioni

Radio e checkbox ricevono verde sulla risposta suggerita. Le checkbox possono ricevere rosso sulle risposte note errate o sulle altre opzioni solo quando il set e molto sicuro. I select provano a evidenziare solo la `option`; il `select` non viene colorato e non riceve `title`.

Textbox, textarea, number, date, time, url, tel e search non vengono mai compilati. Quando una regola, una risposta esplicita o una memoria locale trova la risposta, il campo riceve un bordo verde e un suggerimento testuale accanto al campo. Se la risposta e gia scritta nella domanda, viene evidenziato anche quel testo nella domanda.

## Training Locale

La memoria resta solo in `chrome.storage.local`:

- domanda vista: crea/aggiorna `learnedQuestions`;
- risposta selezionata manualmente: salva `candidateAnswers`;
- pagina finale positiva: le risposte dell'ultimo tentativo diventano `correctAnswers`;
- ritorno con errori visibili: le risposte selezionate diventano `wrongAnswers`.

Nei flussi multi-step, i click manuali su Avanti/Continua/Prosegui/Invia/Conferma salvano lo step corrente. Le pagine di riepilogo non sovrascrivono l'ultimo tentativo utile, cosi quando viene rilevata la pagina finale vengono promosse le risposte delle domande vere e non solo le checkbox di conferma.

## Debug Console

Apri DevTools sulla pagina e usa:

```js
await window.gamedayHighlighter.debugAll()
await window.gamedayHighlighter.debugDataset()
await window.gamedayHighlighter.debugSuggestions()
await window.gamedayHighlighter.debugExplicitAnswers()
await window.gamedayHighlighter.debugFinalPage()
await window.gamedayHighlighter.readMemory()
await window.gamedayHighlighter.clearMemory()
await window.gamedayHighlighter.run()
```

`debugDataset()` mostra dataset caricato, righe totali/usabili/ignorate, righe con `correctAnswers`, `wrongAnswers`, low quality e aggregate. `debugSuggestions()` mostra domanda, opzioni, suggerimento regole, CSV, memoria locale e risultato finale.

## Performance

Non usa `setInterval`. Usa `MutationObserver` con debounce, senza osservare `class`, `style` o `value`. Il parser parte dagli input/form visibili, evita scansioni complete del body, limita il fuzzy matching a `maxDatasetCandidates` e blocca run paralleli con `isRunning`/`pendingRun`.

## Sicurezza

L'estensione e solo un evidenziatore. Non fa autofill, autoclick, autosubmit, rete esterna, modelli cloud, popup, alert o badge.
