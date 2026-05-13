(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var performanceConfig = config.performance || {};
  var datasetIndex = GH.DatasetLoader && GH.DatasetLoader.emptyIndex ? GH.DatasetLoader.emptyIndex() : { rows: [] };
  var mutationObserver = null;
  var runTimer = null;
  var captureTimer = null;
  var initialized = false;
  var isRunning = false;
  var pendingRun = false;
  var domVersion = 0;
  var cacheEpoch = 1;
  var lastRecordsCache = null;
  var lastRecordsDomVersion = -1;
  var lastHighlightSignature = "";
  var suggestionCacheByHash = new Map();
  var suggestionCacheByNormalized = new Map();
  var lastSuggestionDebugRows = [];
  var hostAllowed = isCurrentHostAllowed();

  function debug() {
    if (GH.log) {
      GH.log.apply(GH, arguments);
    }
  }

  function normalizeText(text) {
    return GH.Utils && GH.Utils.normalizeText ? GH.Utils.normalizeText(text) : String(text || "").toLowerCase().trim();
  }

  function hostMatchesRule(host, rule) {
    var normalizedHost = normalizeText(host);
    var normalizedRule = normalizeText(rule);
    if (!normalizedRule || normalizedRule === "*") {
      return true;
    }
    if (normalizedRule.indexOf("*.") === 0) {
      var suffix = normalizedRule.slice(1);
      return normalizedHost.endsWith(suffix) && normalizedHost !== suffix.slice(1);
    }
    return normalizedHost === normalizedRule;
  }

  function isCurrentHostAllowed() {
    var scope = config.siteScope || {};
    if (scope.enabled === false || scope.allowAllHosts === true) {
      return true;
    }
    var allowed = scope.allowedHosts || [];
    if (allowed.indexOf("*") !== -1) {
      return true;
    }
    var host = location.hostname || "";
    return allowed.some(function (rule) {
      return hostMatchesRule(host, rule);
    });
  }

  function isRelevantControl(target) {
    return !!(target && target.matches && target.matches("input, select, textarea"));
  }

  function isSubmitLike(target) {
    if (!target || !target.closest) {
      return false;
    }
    var element = target.closest("button, input[type='submit'], input[type='button'], a, [role='button']");
    if (!element) {
      return false;
    }
    var tag = element.tagName.toLowerCase();
    var type = (element.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && type === "submit") {
      return true;
    }
    if (tag === "button" && (!type || type === "submit")) {
      return true;
    }
    var text = normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || "");
    return (config.submitButtonKeywords || []).some(function (keyword) {
      return text.indexOf(normalizeText(keyword)) !== -1;
    });
  }

  function runWhenIdle(callback) {
    if (performanceConfig.useRequestIdleCallback !== false && window.requestIdleCallback) {
      window.requestIdleCallback(callback, { timeout: 1000 });
    } else {
      window.setTimeout(callback, 0);
    }
  }

  function getRecords() {
    if (lastRecordsCache && lastRecordsDomVersion === domVersion && GH.Parser && GH.Parser.refreshRecords) {
      var refreshed = GH.Parser.refreshRecords(lastRecordsCache);
      if (refreshed) {
        return refreshed;
      }
    }
    var records = GH.Parser ? GH.Parser.parseCurrentPage() : [];
    lastRecordsCache = records;
    lastRecordsDomVersion = domVersion;
    return records;
  }

  function buildCombinedIndex() {
    var indexes = [datasetIndex];
    if (config.useLocalLearning !== false && GH.Learner) {
      indexes.push(GH.Learner.getDatasetIndex());
    }
    return GH.Matcher && GH.Matcher.createCombinedIndex ? GH.Matcher.createCombinedIndex.apply(GH.Matcher, indexes) : datasetIndex;
  }

  function buildLocalIndex() {
    if (config.useLocalLearning === false || !GH.Learner || !GH.Learner.getDatasetIndex) {
      return GH.DatasetLoader && GH.DatasetLoader.emptyIndex ? GH.DatasetLoader.emptyIndex() : { rows: [] };
    }
    return GH.Learner.getDatasetIndex();
  }

  function recordCacheKey(record) {
    return [
      cacheEpoch,
      record.hash,
      record.normalizedQuestion,
      record.canonicalQuestion,
      (record.inputTypes || []).join(","),
      (record.options || []).join("|")
    ].join("::");
  }

  function cloneSuggestion(suggestion) {
    return suggestion ? Object.assign({}, suggestion) : null;
  }

  function getCachedSuggestion(record) {
    if (performanceConfig.cacheSuggestions === false) {
      return undefined;
    }
    var hashKey = recordCacheKey(record);
    if (suggestionCacheByHash.has(hashKey)) {
      return cloneSuggestion(suggestionCacheByHash.get(hashKey));
    }
    var normalizedKey = cacheEpoch + "::" + (record.normalizedQuestion || "");
    if (!(record.options || []).length && suggestionCacheByNormalized.has(normalizedKey)) {
      return cloneSuggestion(suggestionCacheByNormalized.get(normalizedKey));
    }
    return undefined;
  }

  function setCachedSuggestion(record, suggestion) {
    if (performanceConfig.cacheSuggestions === false) {
      return;
    }
    var value = suggestion ? Object.assign({}, suggestion) : null;
    suggestionCacheByHash.set(recordCacheKey(record), value);
    if (record.normalizedQuestion) {
      suggestionCacheByNormalized.set(cacheEpoch + "::" + record.normalizedQuestion, value);
    }
    if (suggestionCacheByHash.size > 500) {
      suggestionCacheByHash.clear();
    }
    if (suggestionCacheByNormalized.size > 500) {
      suggestionCacheByNormalized.clear();
    }
  }

  function clearSuggestionCaches() {
    cacheEpoch += 1;
    suggestionCacheByHash.clear();
    suggestionCacheByNormalized.clear();
  }

  function suggestionSignature(suggestions) {
    return suggestions.map(function (suggestion) {
      return [
        suggestion.recordIndex,
        suggestion.answerText,
        suggestion.explicitRawText || "",
        Math.round((suggestion.confidence || 0) * 1000),
        suggestion.source,
        (suggestion.wrongAnswers || []).join("|")
      ].join("|");
    }).join(";;");
  }

  function computeSuggestionForRecord(record, indexes, includeDebug) {
    var cached = includeDebug ? undefined : getCachedSuggestion(record);
    if (cached !== undefined) {
      return {
        ruleSuggestion: null,
        datasetSuggestion: null,
        localSuggestion: null,
        finalSuggestion: cached,
        cached: true
      };
    }

    var ruleSuggestion = null;
    var datasetSuggestion = null;
    var localSuggestion = null;
    if (config.useRulesEngine !== false && GH.RulesEngine) {
      ruleSuggestion = GH.Matcher && GH.Matcher.getRuleSuggestion ? GH.Matcher.getRuleSuggestion(record) : GH.RulesEngine.solve(record);
    }
    if (GH.Matcher && config.useDataset !== false) {
      datasetSuggestion = GH.Matcher.getDatasetSuggestion ? GH.Matcher.getDatasetSuggestion(record, indexes.datasetIndex) : GH.Matcher.match(record, indexes.datasetIndex);
    }
    if (GH.Matcher && config.useLocalLearning !== false) {
      localSuggestion = GH.Matcher.getLocalMemorySuggestion ? GH.Matcher.getLocalMemorySuggestion(record, indexes.localIndex) : null;
    }
    var finalSuggestion = GH.Matcher && GH.Matcher.combineSuggestions
      ? GH.Matcher.combineSuggestions(ruleSuggestion, datasetSuggestion, localSuggestion, record)
      : (ruleSuggestion || localSuggestion || datasetSuggestion);

    if (!includeDebug) {
      setCachedSuggestion(record, finalSuggestion && finalSuggestion.confidence >= (config.confidenceThreshold || 0.70) ? finalSuggestion : null);
    }

    return {
      ruleSuggestion: ruleSuggestion,
      datasetSuggestion: datasetSuggestion,
      localSuggestion: localSuggestion,
      finalSuggestion: finalSuggestion
    };
  }

  async function runHighlighter(reason) {
    if (!hostAllowed) {
      return { hostAllowed: false, records: [], suggestions: [] };
    }
    if (isRunning) {
      pendingRun = true;
      return { pending: true };
    }
    if (!GH.Parser || !GH.Highlighter) {
      return { records: [], suggestions: [] };
    }

    isRunning = true;
    if (config.DEBUG) {
      console.time("gamedayHighlighter");
    }

    try {
      var finalResult = GH.Learner && config.useLocalLearning !== false
        ? await GH.Learner.checkFinalPageAndLearn(reason || "run")
        : { isFinal: false };
      if (finalResult && finalResult.isFinal) {
        clearSuggestionCaches();
        GH.Highlighter.clearPreviousHighlights();
        return { finalPage: finalResult, records: [], suggestions: [] };
      }

      var records = getRecords();
      if (GH.Learner && config.useLocalLearning !== false) {
        var learnedChanged = await GH.Learner.observe(records, reason || "run");
        if (learnedChanged) {
          clearSuggestionCaches();
        }
        var errorsChanged = await GH.Learner.detectErrorsAndLearn(records, reason || "run");
        if (errorsChanged) {
          clearSuggestionCaches();
        }
      }

      var localIndex = buildLocalIndex();
      var combinedIndex = buildCombinedIndex();
      if (GH.Matcher && GH.Matcher.setDatasetIndex) {
        GH.Matcher.setDatasetIndex(combinedIndex);
      }
      var indexes = {
        datasetIndex: datasetIndex,
        localIndex: localIndex,
        combinedIndex: combinedIndex
      };

      var suggestions = [];
      lastSuggestionDebugRows = [];

      records.forEach(function (record) {
        var result = computeSuggestionForRecord(record, indexes, false);
        var finalSuggestion = result.finalSuggestion;
        if (finalSuggestion && finalSuggestion.answerText && finalSuggestion.confidence >= (config.confidenceThreshold || 0.70)) {
          finalSuggestion.recordIndex = record.index;
          suggestions.push(finalSuggestion);
        }
        lastSuggestionDebugRows.push(buildSuggestionDebugRow(record, result.ruleSuggestion, result.datasetSuggestion, result.localSuggestion, finalSuggestion));
      });

      var highlightSignature = domVersion + "::" + suggestionSignature(suggestions);
      if (highlightSignature !== lastHighlightSignature) {
        GH.Highlighter.apply(records, suggestions);
        lastHighlightSignature = highlightSignature;
      }

      if (GH.Learner && config.useLocalLearning !== false) {
        await GH.Learner.observeSuggestions(records, suggestions, reason || "run");
      }

      debug("Run completato", reason, records.length, "domande", suggestions.length, "suggerimenti");
      return { records: records, suggestions: suggestions };
    } finally {
      if (config.DEBUG) {
        console.timeEnd("gamedayHighlighter");
      }
      isRunning = false;
      if (pendingRun) {
        pendingRun = false;
        scheduleRun("pending");
      }
    }
  }

  function buildSuggestionDebugRow(record, ruleSuggestion, datasetSuggestion, localSuggestion, finalSuggestion) {
    return {
      index: record.index,
      questionText: record.questionText,
      inputTypes: (record.inputTypes || []).join(","),
      options: (record.options || []).join(" | "),
      ruleSuggestion: ruleSuggestion && ruleSuggestion.answerText ? ruleSuggestion.answerText : "",
      datasetSuggestion: datasetSuggestion && datasetSuggestion.answerText ? datasetSuggestion.answerText : "",
      localSuggestion: localSuggestion && localSuggestion.answerText ? localSuggestion.answerText : "",
      finalSuggestion: finalSuggestion && finalSuggestion.answerText ? finalSuggestion.answerText : "",
      confidence: finalSuggestion && typeof finalSuggestion.confidence === "number" ? Number(finalSuggestion.confidence.toFixed(3)) : 0,
      source: finalSuggestion && finalSuggestion.source ? finalSuggestion.source : "",
      answerKind: finalSuggestion && finalSuggestion.answerKind ? finalSuggestion.answerKind : "",
      reason: finalSuggestion && finalSuggestion.reason ? finalSuggestion.reason : "",
      rejectedReason: finalSuggestion && finalSuggestion.rejectedReason ? finalSuggestion.rejectedReason : (localSuggestion && localSuggestion.rejectedReason ? localSuggestion.rejectedReason : (datasetSuggestion && datasetSuggestion.rejectedReason ? datasetSuggestion.rejectedReason : ""))
    };
  }

  function scheduleRun(reason, delay) {
    if (!hostAllowed) {
      return;
    }
    window.clearTimeout(runTimer);
    runTimer = window.setTimeout(function () {
      runWhenIdle(function () {
        runHighlighter(reason).catch(function (error) {
          debug("Errore runHighlighter", error);
        });
      });
    }, delay == null ? Math.max(500, performanceConfig.debounceMs || 700) : delay);
  }

  function scheduleCapture(reason) {
    if (!hostAllowed) {
      return;
    }
    window.clearTimeout(captureTimer);
    captureTimer = window.setTimeout(function () {
      if (!GH.Learner || !GH.Parser || config.useLocalLearning === false) {
        return;
      }
      GH.Learner.captureAttempt(getRecords(), reason || "snapshot").catch(function (error) {
        debug("Errore snapshot", error);
      });
    }, 120);
  }

  function attachListeners() {
    document.addEventListener("change", function (event) {
      if (!isRelevantControl(event.target)) {
        return;
      }
      scheduleCapture("input_changed");
      scheduleRun("input_changed");
    }, true);

    document.addEventListener("submit", function () {
      if (GH.Learner && GH.Parser && config.useLocalLearning !== false) {
        GH.Learner.captureAttempt(getRecords(), "form_submitted").catch(function (error) {
          debug("Errore snapshot submit", error);
        });
      }
    }, true);

    document.addEventListener("click", function (event) {
      if (!isSubmitLike(event.target) || !GH.Learner || !GH.Parser || config.useLocalLearning === false) {
        return;
      }
      GH.Learner.captureAttempt(getRecords(), "submit_or_next_clicked").catch(function (error) {
        debug("Errore snapshot click", error);
      });
    }, true);

    window.addEventListener("gamedayPersonalDataUpdated", function () {
      clearSuggestionCaches();
      scheduleRun("personal_data_updated", 50);
    });
  }

  function attachMutationObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }
    if (!window.MutationObserver || !document.documentElement) {
      return;
    }
    mutationObserver = new MutationObserver(function (mutations) {
      if (mutations && mutations.length) {
        domVersion += 1;
        lastRecordsDomVersion = -1;
        scheduleRun("mutation", performanceConfig.mutationDebounceMs || 700);
      }
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  async function reloadDataset() {
    if (!hostAllowed || !GH.DatasetLoader) {
      return datasetIndex;
    }
    datasetIndex = await GH.DatasetLoader.load(true);
    clearSuggestionCaches();
    await runHighlighter("reload_dataset");
    return datasetIndex;
  }

  async function debugDataset() {
    if (GH.DatasetLoader && !datasetIndex.stats) {
      datasetIndex = await GH.DatasetLoader.load();
    }
    var stats = datasetIndex.stats || {};
    return {
      datasetLoaded: !!stats.datasetLoaded,
      totalRows: stats.totalRows || stats.rowCount || (datasetIndex.allRows || datasetIndex.rows || []).length,
      usableRows: stats.usableRows || stats.reliableRows || (datasetIndex.rows || []).length,
      ignoredRows: stats.ignoredRows || 0,
      correctAnswersRows: stats.correctAnswersRows || stats.withCorrectAnswers || 0,
      wrongAnswersRows: stats.wrongAnswersRows || 0,
      lowQualityRows: stats.lowQualityRows || 0,
      aggregatedRows: stats.aggregatedRows || 0,
      badQuestionTextRows: stats.badQuestionTextRows || 0,
      cautionRows: stats.cautionRows || 0,
      lastSelectedRows: stats.lastSelectedRows || stats.withLastSelectedAnswers || 0,
      parseErrors: stats.parseErrors || []
    };
  }

  async function debugSuggestions() {
    if (!hostAllowed) {
      return [];
    }
    var records = getRecords();
    var indexes = {
      datasetIndex: datasetIndex,
      localIndex: buildLocalIndex(),
      combinedIndex: buildCombinedIndex()
    };
    var rows = records.map(function (record) {
      var result = computeSuggestionForRecord(record, indexes, true);
      return buildSuggestionDebugRow(record, result.ruleSuggestion, result.datasetSuggestion, result.localSuggestion, result.finalSuggestion);
    });
    console.table(rows);
    return rows;
  }

  async function debugExplicitAnswers() {
    if (!hostAllowed || !GH.Parser || !GH.RulesEngine) {
      return [];
    }
    var records = getRecords();
    var rows = records.map(function (record) {
      var details = GH.RulesEngine.debugExplicitAnswer
        ? GH.RulesEngine.debugExplicitAnswer(record)
        : { chosen: GH.RulesEngine.extractExplicitAnswerFromQuestion(record) };
      return {
        index: record.index,
        questionText: record.questionText,
        options: (record.options || []).join(" | "),
        searchTexts: (details.searchTexts || []).join(" || "),
        candidates: (details.candidates || []).map(function (candidate) { return candidate.value || candidate.raw || ""; }).join(" | "),
        chosen: details.chosen && details.chosen.answerText ? details.chosen.answerText : "",
        rejectedReason: details.rejectedReason || (details.chosen && details.chosen.rejectedReason) || ""
      };
    });
    console.table(rows);
    return rows;
  }

  async function debugFinalPage() {
    var rawMemory = GH.Learner && GH.Learner.getRawMemory ? await GH.Learner.getRawMemory() : {};
    var lastAttempt = rawMemory && rawMemory.lastAttempt;
    var bodyText = document.body ? normalizeText(document.body.innerText || document.body.textContent || "") : "";
    var finalDetectionResult = GH.Learner && GH.Learner.isFinalPage ? GH.Learner.isFinalPage() : { isFinal: false, reason: "learner unavailable", matched: "" };
    return {
      href: location.href,
      pathname: location.pathname,
      hash: location.hash,
      bodyTextSample: bodyText.slice(0, 500),
      finalDetectionResult: finalDetectionResult,
      hasLastAttempt: !!lastAttempt,
      lastAttemptQuestionCount: lastAttempt && lastAttempt.questions ? lastAttempt.questions.length : 0,
      lastAttemptSelectedAnswerCount: lastAttempt && lastAttempt.questions ? lastAttempt.questions.reduce(function (sum, question) {
        return sum + ((question.selectedAnswers || []).length ? 1 : 0);
      }, 0) : 0
    };
  }

  async function debugAll() {
    var memoryStats = GH.Learner && GH.Learner.readMemory ? await GH.Learner.readMemory() : null;
    var dataset = await debugDataset();
    var records = hostAllowed && GH.Parser ? getRecords() : [];
    var suggestions = hostAllowed ? await debugSuggestions() : [];
    var finalPage = await debugFinalPage();
    return {
      hostAllowed: hostAllowed,
      datasetRows: dataset.totalRows,
      parsedQuestions: records.length,
      suggestions: suggestions,
      finalPage: finalPage.finalDetectionResult,
      memoryStats: memoryStats
    };
  }

  function exposeConsoleCommands() {
    window.gamedayHighlighter = {
      parseNow: function () {
        return hostAllowed && GH.Parser ? GH.Parser.parseCurrentPage() : [];
      },
      debugParse: function () {
        return hostAllowed && GH.Parser ? GH.Parser.debugParse() : [];
      },
      debugAll: debugAll,
      debugDataset: debugDataset,
      debugSuggestions: debugSuggestions,
      debugExplicitAnswers: debugExplicitAnswers,
      debugFinalPage: debugFinalPage,
      reloadDataset: reloadDataset,
      readMemory: function () {
        return GH.Learner ? GH.Learner.readMemory() : Promise.resolve(null);
      },
      exportMemoryToConsole: function () {
        return GH.Learner ? GH.Learner.exportMemoryToConsole() : Promise.resolve(null);
      },
      clearMemory: function () {
        return GH.Learner ? GH.Learner.clearMemory().then(function (value) {
          clearSuggestionCaches();
          scheduleRun("memory_cleared", 50);
          return value;
        }) : Promise.resolve(null);
      },
      readPersonalData: function () {
        return GH.PersonalData ? GH.PersonalData.readData() : Promise.resolve(null);
      },
      refreshPersonalData: function () {
        return GH.PersonalData ? GH.PersonalData.captureFromPage("console").then(function (value) {
          clearSuggestionCaches();
          scheduleRun("personal_data_refreshed", 50);
          return value;
        }) : Promise.resolve(null);
      },
      run: function () {
        return runHighlighter("console");
      },
      isCurrentHostAllowed: isCurrentHostAllowed
    };
  }

  async function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    exposeConsoleCommands();
    if (!hostAllowed) {
      debug("Host non autorizzato da config.js", location.hostname);
      return;
    }
    if (GH.DatasetLoader && config.useDataset !== false) {
      datasetIndex = await GH.DatasetLoader.load();
    }
    if (GH.PersonalData && (config.personalData || {}).enabled !== false) {
      await GH.PersonalData.init();
    }
    if (GH.Learner && config.useLocalLearning !== false) {
      await GH.Learner.init();
    }
    attachListeners();
    attachMutationObserver();
    await runHighlighter("init");
  }

  GH.Content = {
    init: init,
    runHighlighter: runHighlighter,
    reloadDataset: reloadDataset,
    isCurrentHostAllowed: isCurrentHostAllowed
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init().catch(function (error) {
        debug("Errore inizializzazione", error);
      });
    }, { once: true });
  } else {
    init().catch(function (error) {
      debug("Errore inizializzazione", error);
    });
  }
})();
