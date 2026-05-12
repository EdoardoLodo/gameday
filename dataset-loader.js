(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var utils = GH.Utils || {};
  var datasetIndex = emptyIndex();
  var loadedOnce = false;
  var loadPromise = null;
  var parseErrors = [];

  function debug() {
    if (GH.log) {
      GH.log.apply(GH, arguments);
    }
  }

  function normalizeText(text) {
    return utils.normalizeText ? utils.normalizeText(text) : String(text || "").toLowerCase().trim();
  }

  function normalizeQuestion(text) {
    return utils.normalizeQuestion ? utils.normalizeQuestion(text) : normalizeText(text);
  }

  function canonicalQuestionText(text) {
    return utils.canonicalQuestionText ? utils.canonicalQuestionText(text) : normalizeQuestion(text);
  }

  function normalizeAnswer(text) {
    return utils.normalizeAnswer ? utils.normalizeAnswer(text) : normalizeText(text);
  }

  function answerKey(text) {
    return utils.canonicalAnswerKey ? utils.canonicalAnswerKey(text) : normalizeAnswer(text);
  }

  function splitStoredList(value) {
    return utils.splitStoredList ? utils.splitStoredList(value) : String(value || "").split(/\s+\|\s+|\r?\n|;\s*/g).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function stableHash(value) {
    return utils.stableHash ? utils.stableHash(value) : "q_" + String(value || "").length;
  }

  function stableQuestionHash(questionText, inputTypes) {
    return stableHash([canonicalQuestionText(questionText), (inputTypes || []).join(",")].join("::"));
  }

  function emptyIndex() {
    return {
      byHash: new Map(),
      byNormalizedQuestion: new Map(),
      byCanonicalQuestion: new Map(),
      byFirstTokens: new Map(),
      byKeyword: new Map(),
      bySignature: new Map(),
      byNumbers: new Map(),
      byUrls: new Map(),
      rows: [],
      allRows: [],
      stats: {
        datasetLoaded: false,
        totalRows: 0,
        rowCount: 0,
        usableRows: 0,
        reliableRows: 0,
        ignoredRows: 0,
        correctAnswersRows: 0,
        wrongAnswersRows: 0,
        lastSelectedRows: 0,
        lowQualityRows: 0,
        aggregatedRows: 0,
        badQuestionTextRows: 0,
        cautionRows: 0,
        withCorrectAnswers: 0,
        withLastSelectedAnswers: 0,
        parseErrors: []
      }
    };
  }

  function parseBoolean(value) {
    return ["true", "1", "yes", "si", "sì"].indexOf(String(value || "").toLowerCase().trim()) !== -1;
  }

  function trustConfig() {
    return config.datasetTrust || config.csvTrust || {};
  }

  function parseCsv(csvText) {
    parseErrors = [];
    var text = String(csvText || "");
    if (!text.trim()) {
      return [];
    }

    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      var next = text.charAt(i + 1);

      if (ch === "\"") {
        if (inQuotes && next === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") {
          i += 1;
        }
        row.push(cell);
        if (row.some(function (value) { return String(value || "").trim() !== ""; })) {
          rows.push(row);
        }
        row = [];
        cell = "";
        continue;
      }

      cell += ch;
    }

    if (inQuotes) {
      parseErrors.push("CSV con virgolette non chiuse");
    }

    row.push(cell);
    if (row.some(function (value) { return String(value || "").trim() !== ""; })) {
      rows.push(row);
    }

    if (!rows.length) {
      return [];
    }

    var headers = rows.shift().map(function (header) {
      return String(header || "").trim();
    });

    return rows.map(function (values) {
      var out = {};
      headers.forEach(function (header, index) {
        out[header] = values[index] == null ? "" : values[index];
      });
      return out;
    });
  }

  function tokenizeForIndex(text) {
    var stop = new Set(["della", "dello", "degli", "delle", "sono", "come", "alla", "allo", "nelle", "negli", "con", "per", "del", "dei", "gli", "una", "uno", "che"]);
    var seen = new Set();
    return normalizeText(text)
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
      .split(/\s+/)
      .map(function (token) { return token.trim(); })
      .filter(function (token) { return token.length >= 3 && !stop.has(token); })
      .filter(function (token) {
        if (seen.has(token)) {
          return false;
        }
        seen.add(token);
        return true;
      });
  }

  function firstTokensForText(text) {
    return tokenizeForIndex(text).slice(0, 5);
  }

  function keywordsForText(text) {
    return tokenizeForIndex(text).filter(function (token) {
      return token.length >= 5;
    }).slice(0, 12);
  }

  function extractUrls(text) {
    return (String(text || "").match(/\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi) || []).map(function (url) {
      return normalizeText(url).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;:!?]+$/, "");
    });
  }

  function extractNumbers(text) {
    return (String(text || "").match(/[-+]?\d+(?:[.,]\d+)?/g) || []).map(function (value) {
      return value.replace(",", ".");
    });
  }

  function extractCodes(text) {
    return (String(text || "").match(/[+@#]?[a-zA-Z0-9][a-zA-Z0-9._-]{3,}/g) || []).map(function (code) {
      return normalizeAnswer(code.replace(/[.,;:!?]+$/, ""));
    }).filter(function (code) {
      return /[0-9+@#._-]/.test(code) || code.length >= 8;
    });
  }

  function signatureForText(text) {
    var pieces = extractNumbers(text).concat(extractUrls(text)).concat(extractCodes(text)).concat(keywordsForText(text).slice(0, 8));
    if (!pieces.length) {
      pieces = firstTokensForText(text).slice(0, 3);
    }
    return pieces.map(normalizeText).filter(Boolean).sort().join("|");
  }

  function isGenericQuestionText(questionText) {
    var normalized = normalizeQuestion(questionText);
    if (!normalized || normalized.length < 12) {
      return true;
    }
    if (normalized.split(/\s+/).filter(Boolean).length < 3) {
      return true;
    }
    if (/compilare i seguenti campi/.test(normalized)) {
      return true;
    }
    if (/^per procedere con l'?invio/.test(normalized)) {
      return true;
    }
    return /^(selezionare|seleziona|scegliere|scegli|indicare|inserire)$/.test(normalized);
  }

  function hasAggregatedGenericAnswers(item) {
    var normalized = normalizeQuestion(item.questionText);
    return /compilare i seguenti campi/.test(normalized) &&
      (item.correctAnswers || []).length > 1 &&
      String(item.raw && item.raw.correctAnswers || "").indexOf(" | ") !== -1;
  }

  function optionsLookTechnical(options) {
    var values = options || [];
    if (!values.length) {
      return false;
    }
    var technical = values.filter(function (value) {
      return /^risposte?\[\d+\]$/i.test(String(value || "").trim()) || /^option-\d+$/i.test(String(value || "").trim());
    }).length;
    return technical === values.length;
  }

  function answerPresentInQuestion(item, answers) {
    var question = normalizeText(item.questionText || "");
    return (answers || []).some(function (answer) {
      var key = answerKey(answer);
      return key && question.indexOf(key) !== -1;
    });
  }

  function isCsvRowReliable(item) {
    var datasetTrust = trustConfig();
    var candidateAnswers = item.correctAnswers.length ? item.correctAnswers : item.lastSelectedAnswers;
    var quality = normalizeAnswer(item.recordQuality);
    var exportFlag = normalizeAnswer(item.exportUsableForGamedayExt);

    if (!candidateAnswers.length && !item.wrongAnswers.length) {
      item.rejectedReason = "nessuna risposta candidata";
      return false;
    }
    if (exportFlag === "no") {
      item.rejectedReason = "exportUsableForGamedayExt=no";
      return false;
    }
    if (quality === "aggregated_group" && datasetTrust.ignoreAggregatedRows !== false) {
      item.rejectedReason = "recordQuality aggregated_group";
      return false;
    }
    if (quality === "bad_question_text" && datasetTrust.ignoreBadQuestionTextRows !== false) {
      item.rejectedReason = "recordQuality bad_question_text";
      return false;
    }
    if (hasAggregatedGenericAnswers(item)) {
      item.rejectedReason = "riga generica aggregata";
      return false;
    }
    if ((datasetTrust.ignoreGenericRows !== false || datasetTrust.ignoreBadQuestionTextRows !== false) && isGenericQuestionText(item.questionText)) {
      item.rejectedReason = "domanda generica";
      return false;
    }
    if (optionsLookTechnical(item.optionsSeen)) {
      item.rejectedReason = "opzioni tecniche";
      return false;
    }
    if (!candidateAnswers.length) {
      item.rejectedReason = "solo wrongAnswers";
      return datasetTrust.useWrongAnswers !== false;
    }
    if (utils.isTextInputType && utils.isTextInputType(item.inputTypes) &&
        !item.correctAnswers.length &&
        item.lastSelectedAnswers.length &&
        datasetTrust.ignoreTextRowsUnlessAnswerInQuestion !== false &&
        !answerPresentInQuestion(item, item.lastSelectedAnswers)) {
      item.rejectedReason = "text input con sola lastSelectedAnswers non esplicita";
      return false;
    }

    item.rejectedReason = "";
    return true;
  }

  function computeConfidenceBase(item) {
    var datasetTrust = trustConfig();
    var quality = normalizeAnswer(item.recordQuality);
    var exportFlag = normalizeAnswer(item.exportUsableForGamedayExt);
    var multiplier = exportFlag === "caution" ? 0.78 : 1;
    if (!item.isReliable) {
      return 0.30;
    }
    if (item.correctAnswers.length && quality === "confirmed_correct_low_quality_text") {
      return 0.78 * multiplier;
    }
    if (item.correctAnswers.length && quality === "confirmed_correct" && !item.hasConflict) {
      return (datasetTrust.correctAnswerBaseConfidence || 0.96) * multiplier;
    }
    if (item.correctAnswers.length && !item.hasConflict) {
      return (datasetTrust.correctAnswerBaseConfidence || 0.96) * multiplier;
    }
    if (item.correctAnswers.length && item.hasConflict) {
      return 0.72 * multiplier;
    }
    if (!item.correctAnswers.length && item.lastSelectedAnswers.length && datasetTrust.useLastSelectedAnswersAsFallback !== false) {
      return (datasetTrust.lastSelectedBaseConfidence || 0.68) * multiplier;
    }
    if (item.wrongAnswers.length) {
      return 0.30;
    }
    return 0.45;
  }

  function rowToItem(row) {
    var questionText = utils.deMojibake ? utils.deMojibake(row.questionText || "") : String(row.questionText || "");
    var inputTypes = String(row.inputTypes || "")
      .split(/\s+\|\s+|,\s*|\r?\n|;\s*/g)
      .map(function (value) { return normalizeAnswer(value); })
      .filter(Boolean);

    var normalizedQuestion = normalizeQuestion(row.normalizedQuestion || questionText);
    var canonicalQuestion = canonicalQuestionText(row.normalizedQuestion || questionText);
    var item = {
      source: "csv",
      hash: String(row.hash || "").trim(),
      legacyHash: String(row.hash || "").trim(),
      stableHash: stableQuestionHash(questionText, inputTypes),
      questionText: questionText,
      normalizedQuestion: normalizedQuestion,
      canonicalQuestion: canonicalQuestion,
      inputTypes: inputTypes,
      optionsSeen: splitStoredList(row.optionsSeen || ""),
      correctAnswers: splitStoredList(row.correctAnswers || ""),
      wrongAnswers: splitStoredList(row.wrongAnswers || ""),
      lastSelectedAnswers: splitStoredList(row.lastSelectedAnswers || ""),
      timesCorrect: Number(row.timesCorrect || 0) || 0,
      timesWrong: Number(row.timesWrong || 0) || 0,
      recordQuality: String(row.recordQuality || "").trim(),
      exportUsableForGamedayExt: String(row.exportUsableForGamedayExt || "").trim(),
      confidenceBase: 0.30,
      hasConflict: parseBoolean(row.hasConflict),
      lastUrl: String(row.lastUrl || "").trim(),
      updatedAt: String(row.updatedAt || "").trim(),
      usable: true,
      warnings: [],
      isReliable: true,
      rejectedReason: "",
      raw: row
    };
    item.isReliable = isCsvRowReliable(item);
    item.usable = item.isReliable;
    if (!item.usable && item.rejectedReason) {
      item.warnings.push(item.rejectedReason);
    }
    item.confidenceBase = computeConfidenceBase(item);
    return item;
  }

  function addToMapList(map, key, item) {
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  }

  function addItemToIndexes(index, item) {
    addToMapList(index.byHash, item.hash, item);
    addToMapList(index.byHash, item.stableHash, item);
    addToMapList(index.byNormalizedQuestion, item.normalizedQuestion, item);
    addToMapList(index.byCanonicalQuestion, item.canonicalQuestion, item);
    firstTokensForText(item.canonicalQuestion || item.normalizedQuestion || item.questionText).forEach(function (token) {
      addToMapList(index.byFirstTokens, token, item);
    });
    keywordsForText(item.canonicalQuestion || item.normalizedQuestion || item.questionText).forEach(function (token) {
      addToMapList(index.byKeyword, token, item);
    });
    addToMapList(index.bySignature, signatureForText(item.questionText), item);
    extractNumbers(item.questionText).forEach(function (number) {
      addToMapList(index.byNumbers, number, item);
    });
    extractUrls(item.questionText).forEach(function (url) {
      addToMapList(index.byUrls, url, item);
    });
  }

  function buildIndex(rows) {
    var index = emptyIndex();
    (rows || []).forEach(function (row) {
      var item = row.source ? row : rowToItem(row);
      index.allRows.push(item);
      index.stats.totalRows += 1;
      index.stats.rowCount += 1;
      if (item.correctAnswers && item.correctAnswers.length) {
        index.stats.correctAnswersRows += 1;
        index.stats.withCorrectAnswers += 1;
      }
      if (item.wrongAnswers && item.wrongAnswers.length) {
        index.stats.wrongAnswersRows += 1;
      }
      if (item.lastSelectedAnswers && item.lastSelectedAnswers.length) {
        index.stats.lastSelectedRows += 1;
        index.stats.withLastSelectedAnswers += 1;
      }
      if (normalizeAnswer(item.recordQuality) === "confirmed_correct_low_quality_text") {
        index.stats.lowQualityRows += 1;
      }
      if (normalizeAnswer(item.recordQuality) === "aggregated_group") {
        index.stats.aggregatedRows += 1;
      }
      if (normalizeAnswer(item.recordQuality) === "bad_question_text") {
        index.stats.badQuestionTextRows += 1;
      }
      if (normalizeAnswer(item.exportUsableForGamedayExt) === "caution") {
        index.stats.cautionRows += 1;
      }
      if (item.isReliable) {
        index.rows.push(item);
        index.stats.usableRows += 1;
        index.stats.reliableRows += 1;
        addItemToIndexes(index, item);
      } else {
        index.stats.ignoredRows += 1;
      }
    });
    index.stats.datasetLoaded = true;
    index.stats.parseErrors = parseErrors.slice();
    return index;
  }

  async function loadDataset(force) {
    if (config.useDataset === false) {
      datasetIndex = emptyIndex();
      return datasetIndex;
    }
    if (!force && loadedOnce) {
      return datasetIndex;
    }
    if (!force && loadPromise) {
      return loadPromise;
    }

    loadPromise = (async function () {
      try {
        var url = chrome.runtime.getURL("dataset.csv");
        var response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          debug("dataset.csv non disponibile", response.status);
          datasetIndex = emptyIndex();
          loadedOnce = true;
          return datasetIndex;
        }
        var text = await response.text();
        var rows = parseCsv(text);
        datasetIndex = buildIndex(rows);
        loadedOnce = true;
        debug("Dataset CSV caricato", datasetIndex.stats);
        return datasetIndex;
      } catch (error) {
        parseErrors.push(String(error && error.message ? error.message : error));
        debug("Impossibile caricare dataset.csv", error);
        datasetIndex = emptyIndex();
        datasetIndex.stats.parseErrors = parseErrors.slice();
        loadedOnce = true;
        return datasetIndex;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  function getIndex() {
    return datasetIndex;
  }

  function getStats() {
    return datasetIndex.stats || emptyIndex().stats;
  }

  function reset() {
    datasetIndex = emptyIndex();
    loadedOnce = false;
    loadPromise = null;
    parseErrors = [];
    return datasetIndex;
  }

  GH.DatasetLoader = {
    load: loadDataset,
    getIndex: getIndex,
    getStats: getStats,
    parseCsv: parseCsv,
    buildIndex: buildIndex,
    rowToItem: rowToItem,
    splitStoredList: splitStoredList,
    normalizeText: normalizeText,
    normalizeQuestion: normalizeQuestion,
    normalizeAnswer: normalizeAnswer,
    canonicalQuestionText: canonicalQuestionText,
    firstTokensForText: firstTokensForText,
    keywordsForText: keywordsForText,
    signatureForText: signatureForText,
    extractNumbers: extractNumbers,
    extractUrls: extractUrls,
    isCsvRowReliable: isCsvRowReliable,
    emptyIndex: emptyIndex,
    reset: reset
  };
})();
