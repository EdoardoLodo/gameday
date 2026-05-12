(function () {
  "use strict";

  window.GAMEDAY_CONFIG = {
    DEBUG: false,

    confidenceThreshold: 0.72,
    strongConfidenceThreshold: 0.88,

    useDataset: true,
    useRulesEngine: true,
    useLocalLearning: true,

    highlightOnly: true,
    neverAutofill: true,
    neverAutoclick: true,
    neverAutosubmit: true,

    siteScope: {
      enabled: true,
      allowedHosts: [
        "app.simulatoreclickday.it",
        "simulatoreclickday.it",
        "*.simulatoreclickday.it"
      ],
      allowAllHosts: false
    },

    datasetTrust: {
      useCorrectAnswers: true,
      useWrongAnswers: true,
      useLastSelectedAnswersAsFallback: true,
      correctAnswerBaseConfidence: 0.96,
      lastSelectedBaseConfidence: 0.68,
      lastSelectedExactQuestionConfidence: 0.80,
      neverLetLastSelectedOverrideExplicit: true,
      ignoreAggregatedRows: true,
      ignoreBadQuestionTextRows: true,
      useLowQualityRowsWithLowerConfidence: true
    },

    explicitAnswerDetection: {
      enabled: true,
      searchContainerText: true,
      maxContainerTextLength: 2500,
      requireOptionMatchForChoiceInputs: true,
      allowTextHighlightForTextInputs: true,
      ignoreExamples: true,
      treatColonValueAsExplicit: true,
      treatQuestionTailAfterColonAsExplicit: true
    },

    checkboxBehavior: {
      markPositiveGreen: true,
      markKnownWrongRed: true,
      markOtherOptionsRedWhenAnswerSetIsCertain: true
    },

    localLearning: {
      promoteCandidatesOnlyAfterFinalPage: false,
      useCandidateAnswersForSuggestions: true,
      candidateBaseConfidence: 0.64,
      correctAnswerBaseConfidence: 0.96
    },

    performance: {
      debounceMs: 500,
      mutationDebounceMs: 700,
      maxDatasetCandidates: 40,
      maxVisibleControls: 150,
      maxQuestionsPerPage: 100,
      maxLearnedQuestions: 1500,
      maxEvents: 300,
      maxCandidateAnswersPerQuestion: 20,
      maxCorrectAnswersPerQuestion: 20,
      maxWrongAnswersPerQuestion: 20,
      useRequestIdleCallback: true,
      cacheSuggestions: true,
      cacheDatasetIndexes: true,
      avoidFullBodyScan: true
    },

    questionBlockSelectors: [
      "fieldset",
      ".question",
      ".domanda",
      ".quesito",
      ".form-question",
      ".form-group",
      ".field",
      ".mb-3",
      "[data-question]",
      "[data-question-id]",
      "[role='group']"
    ],

    dangerousGenericSelectors: [
      "div",
      "li"
    ],

    questionTextSelectors: [
      "legend",
      ".question-title",
      ".domanda-titolo",
      ".question-text",
      ".form-label",
      ".label",
      "label",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p"
    ],

    errorSelectors: [
      ".error",
      ".invalid",
      ".wrong",
      ".danger",
      ".is-invalid",
      ".errata",
      ".sbagliata",
      "[aria-invalid='true']"
    ],

    errorTextKeywords: [
      "risposta errata",
      "risposta sbagliata",
      "non corretta",
      "errore",
      "campo non valido",
      "modifica la risposta",
      "controlla la risposta"
    ],

    submitButtonKeywords: [
      "avanti",
      "continua",
      "invia",
      "conferma",
      "prosegui",
      "termina",
      "esci"
    ],

    finalPageKeywords: [
      "termine form",
      "form terminato",
      "simulazione terminata",
      "completato",
      "conclusa",
      "grazie",
      "operazione completata",
      "invio completato",
      "simulazione eseguita",
      "hai impiegato",
      "secondi",
      "risultato-isi-inail",
      "domanda inviata con successo",
      "domanda e stata inserita correttamente",
      "la domanda e stata inserita correttamente",
      "il tuo tempo",
      "cliccare sul pulsante esci",
      "risultato"
    ],

    finalPageDetection: {
      enabled: true,

      urlIncludes: [
        "risultato",
        "risultato-isi-inail",
        "/risultato",
        "#/risultato",
        "risultato#"
      ],

      textIncludes: [
        "simulazione eseguita",
        "hai impiegato",
        "secondi",
        "torna alla home",
        "prossima simulazione",
        "domanda inviata con successo",
        "domanda e stata inserita correttamente",
        "la domanda e stata inserita correttamente",
        "il tuo tempo",
        "cliccare sul pulsante esci",
        "esci"
      ],

      strongTextPairs: [
        ["simulazione eseguita", "hai impiegato"],
        ["hai impiegato", "secondi"],
        ["torna alla home", "prossima simulazione"],
        ["domanda inviata con successo", "domanda e stata inserita correttamente"],
        ["domanda inviata con successo", "il tuo tempo"],
        ["la domanda e stata inserita correttamente", "cliccare sul pulsante esci"],
        ["il tuo tempo", "esci"]
      ]
    },

    ignoredTextInputTypes: [
      "hidden",
      "password",
      "submit",
      "button",
      "reset",
      "file"
    ],

    knownSites: {
      google: "https://www.google.com",
      yahoo: "https://www.yahoo.com",
      instagram: "https://www.instagram.com",
      facebook: "https://www.facebook.com",
      youtube: "https://www.youtube.com",
      linkedin: "https://www.linkedin.com"
    }
  };

  window.GamedayHighlighter = window.GamedayHighlighter || {};
  window.GamedayHighlighter.config = window.GAMEDAY_CONFIG;

  function compactText(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function deMojibake(text) {
    return String(text || "")
      .replace(/Ã¨|ÃƒÂ¨/g, "e")
      .replace(/Ã©|ÃƒÂ©/g, "e")
      .replace(/Ã |Ãƒ /g, "a")
      .replace(/Ã²|ÃƒÂ²/g, "o")
      .replace(/Ã¹|ÃƒÂ¹/g, "u")
      .replace(/Ã¬|ÃƒÂ¬/g, "i")
      .replace(/â€™|Ã¢â‚¬â„¢/g, "'")
      .replace(/â€˜|Ã¢â‚¬Ëœ/g, "'")
      .replace(/â€œ|â€|Ã¢â‚¬Å“/g, "\"")
      .replace(/â€“|â€”/g, "-");
  }

  function normalizeText(text) {
    return compactText(deMojibake(text))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[`´’‘]/g, "'")
      .replace(/[“”„]/g, "\"")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripQuestionPrefix(text) {
    return normalizeText(text)
      .replace(/^\s*[*•]+\s*/, "")
      .replace(/^\s*#?\d+\s*[\.)\-:]\s*/, "")
      .replace(/^\s*(domanda|quesito)\s+#?\d+\s*[\.)\-:]?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeQuestion(text) {
    return stripQuestionPrefix(text);
  }

  function canonicalQuestionText(text) {
    return normalizeQuestion(text)
      .replace(/[?!]+$/g, "")
      .replace(/\s*[:;]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAnswer(text) {
    return normalizeText(text)
      .replace(/^\s*[*•:\-]+\s*/, "")
      .replace(/\s*[*•:\-]+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalAnswerKey(text) {
    return normalizeAnswer(text)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[^\p{L}\p{N}@._+/:/-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function noPunctuationKey(text) {
    return normalizeAnswer(text)
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim();
  }

  function stableHash(value) {
    var text = String(value || "");
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "q_" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function splitStoredList(value) {
    var raw = String(value || "").trim();
    if (!raw) {
      return [];
    }
    if ((raw.charAt(0) === "[" && raw.charAt(raw.length - 1) === "]") ||
        (raw.charAt(0) === "{" && raw.charAt(raw.length - 1) === "}")) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(function (item) { return String(item || "").trim(); }).filter(Boolean);
        }
      } catch (error) {
        // Fall back to textual splitting.
      }
    }
    return raw.split(/\s+\|\s+|\r?\n|;\s*/g).map(function (item) {
      return String(item || "").trim();
    }).filter(Boolean);
  }

  function isTextInputType(types) {
    return (types || []).some(function (type) {
      return ["text", "textarea", "number", "date", "time", "url", "tel", "search"].indexOf(String(type || "").toLowerCase()) !== -1;
    });
  }

  window.GamedayHighlighter.Utils = {
    compactText: compactText,
    deMojibake: deMojibake,
    normalizeText: normalizeText,
    normalizeQuestion: normalizeQuestion,
    normalizeAnswer: normalizeAnswer,
    canonicalQuestionText: canonicalQuestionText,
    canonicalAnswerKey: canonicalAnswerKey,
    noPunctuationKey: noPunctuationKey,
    stableHash: stableHash,
    splitStoredList: splitStoredList,
    isTextInputType: isTextInputType
  };

  window.GamedayHighlighter.log = function () {
    if (!window.GAMEDAY_CONFIG || !window.GAMEDAY_CONFIG.DEBUG) {
      return;
    }
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[GamedayHighlighter]");
    console.log.apply(console, args);
  };
})();
