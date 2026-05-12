(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var performanceConfig = config.performance || {};
  var utils = GH.Utils || {};
  var STORAGE_KEY = "gamedayHighlighterMemory";
  var memory = defaultMemory();
  var initialized = false;
  var seenThisPage = new Set();
  var suggestedThisPage = new Set();
  var acceptedThisPage = new Set();

  function now() {
    return new Date().toISOString();
  }

  function defaultMemory() {
    return {
      version: 1,
      learnedQuestions: {},
      currentSession: null,
      lastAttempt: null,
      events: []
    };
  }

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

  function splitList(value) {
    return utils.splitStoredList ? utils.splitStoredList(value) : String(value || "").split(/\s+\|\s+|\r?\n|;\s*/g).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function stableHash(value) {
    return utils.stableHash ? utils.stableHash(value) : "q_" + String(value || "").length;
  }

  function stableQuestionHash(question) {
    return stableHash([canonicalQuestionText(question.questionText || ""), (question.inputTypes || []).join(",")].join("::"));
  }

  function storageGet() {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(STORAGE_KEY, function (result) {
        resolve(result ? result[STORAGE_KEY] : null);
      });
    });
  }

  function storageSet(value) {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      var payload = {};
      payload[STORAGE_KEY] = value;
      chrome.storage.local.set(payload, resolve);
    });
  }

  function uniquePush(target, values, limit) {
    target = Array.isArray(target) ? target : [];
    splitList(values).forEach(function (value) {
      var key = normalizeText(value);
      if (!key) {
        return;
      }
      target = target.filter(function (item) {
        return normalizeText(item) !== key;
      });
      target.push(value);
    });
    if (limit && target.length > limit) {
      target = target.slice(target.length - limit);
    }
    return target;
  }

  function removeFromList(target, values) {
    var remove = new Set(splitList(values).map(normalizeText));
    return (target || []).filter(function (item) {
      return !remove.has(normalizeText(item));
    });
  }

  function addEvent(type, payload) {
    memory.events = memory.events || [];
    memory.events.push(Object.assign({
      type: type,
      url: location.href,
      createdAt: now()
    }, payload || {}));
    var maxEvents = performanceConfig.maxEvents || 200;
    if (memory.events.length > maxEvents) {
      memory.events = memory.events.slice(memory.events.length - maxEvents);
    }
  }

  function pruneLearnedQuestions() {
    var learned = memory.learnedQuestions || {};
    var maxQuestions = performanceConfig.maxLearnedQuestions || 1000;
    var hashes = Object.keys(learned);
    if (hashes.length <= maxQuestions) {
      return;
    }
    hashes.sort(function (a, b) {
      var left = learned[a] || {};
      var right = learned[b] || {};
      var leftScore = (left.timesSeen || 0) + (left.timesCorrect || 0) * 5 + (left.timesAccepted || 0) * 3;
      var rightScore = (right.timesSeen || 0) + (right.timesCorrect || 0) * 5 + (right.timesAccepted || 0) * 3;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return String(left.updatedAt || "").localeCompare(String(right.updatedAt || ""));
    });
    hashes.slice(0, hashes.length - maxQuestions).forEach(function (hash) {
      delete learned[hash];
    });
  }

  async function save() {
    pruneLearnedQuestions();
    await storageSet(memory);
  }

  async function init() {
    if (initialized) {
      return memory;
    }
    var stored = await storageGet();
    memory = Object.assign(defaultMemory(), stored || {});
    memory.learnedQuestions = memory.learnedQuestions || {};
    memory.events = memory.events || [];
    initialized = true;
    return memory;
  }

  function ensureQuestion(record) {
    if (!record || !record.hash) {
      return null;
    }
    var learned = memory.learnedQuestions[record.hash];
    if (!learned) {
      learned = {
        hash: record.hash,
        stableHash: record.hash,
        questionText: record.questionText || "",
        normalizedQuestion: record.normalizedQuestion || normalizeQuestion(record.questionText || ""),
        canonicalQuestion: record.canonicalQuestion || canonicalQuestionText(record.questionText || ""),
        inputTypes: record.inputTypes || [],
        correctAnswers: [],
        wrongAnswers: [],
        candidateAnswers: [],
        timesSeen: 0,
        timesSuggested: 0,
        timesAccepted: 0,
        timesCorrect: 0,
        timesWrong: 0,
        hasConflict: false,
        updatedAt: now()
      };
      memory.learnedQuestions[record.hash] = learned;
    }
    learned.questionText = learned.questionText || record.questionText || "";
    learned.normalizedQuestion = learned.normalizedQuestion || record.normalizedQuestion || normalizeQuestion(record.questionText || "");
    learned.canonicalQuestion = learned.canonicalQuestion || record.canonicalQuestion || canonicalQuestionText(record.questionText || "");
    learned.inputTypes = record.inputTypes || learned.inputTypes || [];
    learned.updatedAt = now();
    return learned;
  }

  function markSeen(record) {
    var learned = ensureQuestion(record);
    if (!learned) {
      return;
    }
    var key = location.href + "|" + record.hash;
    if (!seenThisPage.has(key)) {
      learned.timesSeen += 1;
      seenThisPage.add(key);
    }
  }

  function markCandidate(record) {
    if (!record || !record.selectedAnswers || !record.selectedAnswers.length) {
      return false;
    }
    var learned = ensureQuestion(record);
    if (!learned) {
      return false;
    }
    var before = (learned.candidateAnswers || []).join("|");
    learned.candidateAnswers = uniquePush(learned.candidateAnswers, record.selectedAnswers, performanceConfig.maxCandidateAnswersPerQuestion || 20);
    learned.updatedAt = now();
    return before !== learned.candidateAnswers.join("|");
  }

  function markSuggested(record) {
    var learned = ensureQuestion(record);
    if (!learned) {
      return;
    }
    var key = location.href + "|" + record.hash;
    if (!suggestedThisPage.has(key)) {
      learned.timesSuggested += 1;
      suggestedThisPage.add(key);
    }
  }

  function markAccepted(record, suggestion) {
    if (!record || !suggestion || !record.selectedAnswers || !record.selectedAnswers.length || !GH.Matcher || !GH.Matcher.answersSimilarity) {
      return;
    }
    if (GH.Matcher.answersSimilarity(record.selectedAnswers.join(" | "), suggestion.answerText) < 0.88) {
      return;
    }
    var learned = ensureQuestion(record);
    var key = location.href + "|" + record.hash + "|accepted";
    if (learned && !acceptedThisPage.has(key)) {
      learned.timesAccepted += 1;
      acceptedThisPage.add(key);
    }
  }

  function markCorrectFromQuestion(question) {
    if (!question || !question.hash || !question.selectedAnswers || !question.selectedAnswers.length) {
      return;
    }
    var learned = memory.learnedQuestions[question.hash] || ensureQuestion(question);
    if (!learned) {
      return;
    }
    learned.correctAnswers = uniquePush(learned.correctAnswers, question.selectedAnswers, performanceConfig.maxCorrectAnswersPerQuestion || 10);
    learned.wrongAnswers = removeFromList(learned.wrongAnswers, question.selectedAnswers);
    learned.timesCorrect = (learned.timesCorrect || 0) + 1;
    learned.hasConflict = learned.correctAnswers.some(function (answer) {
      return (learned.wrongAnswers || []).map(normalizeText).indexOf(normalizeText(answer)) !== -1;
    });
    learned.updatedAt = now();
  }

  function markWrong(record, answers) {
    var selected = splitList(answers);
    if (!record || !selected.length) {
      return;
    }
    var learned = ensureQuestion(record);
    if (!learned) {
      return;
    }
    learned.wrongAnswers = uniquePush(learned.wrongAnswers, selected, performanceConfig.maxWrongAnswersPerQuestion || 20);
    learned.correctAnswers = removeFromList(learned.correctAnswers, selected);
    learned.timesWrong = (learned.timesWrong || 0) + 1;
    learned.hasConflict = learned.correctAnswers.some(function (answer) {
      return (learned.wrongAnswers || []).map(normalizeText).indexOf(normalizeText(answer)) !== -1;
    });
    learned.updatedAt = now();
  }

  function snapshotRecord(record) {
    return {
      hash: record.hash,
      stableHash: record.hash,
      questionText: record.questionText,
      normalizedQuestion: record.normalizedQuestion,
      canonicalQuestion: record.canonicalQuestion || canonicalQuestionText(record.questionText || ""),
      inputTypes: record.inputTypes,
      selectedAnswers: record.selectedAnswers || [],
      options: record.options || []
    };
  }

  function selectedAnswerCount(questions) {
    return (questions || []).reduce(function (sum, question) {
      return sum + ((question.selectedAnswers || []).length ? 1 : 0);
    }, 0);
  }

  function isReviewOnlyQuestion(question) {
    var text = normalizeText(question && question.questionText || "");
    return /^(accetto|informativa|togliere la spunta|sono consapevole|dichiaro|presa visione|non essere robot)/.test(text) ||
      /cliccare sul pulsante modifica|cliccare sul pulsante invia|riepilogo dati inseriti/.test(text);
  }

  function meaningfulQuestionCount(questions) {
    return (questions || []).filter(function (question) {
      return question && question.hash && !isReviewOnlyQuestion(question);
    }).length;
  }

  function isReviewPage() {
    var text = pageText();
    return text.indexOf("riepilogo dati inseriti") !== -1 ||
      (text.indexOf("cliccare sul pulsante modifica") !== -1 && text.indexOf("cliccare sul pulsante invia") !== -1);
  }

  function shouldPreservePreviousAttempt(questions) {
    var previous = memory.lastAttempt;
    if (!previous || !previous.questions || !previous.questions.length || !isReviewPage()) {
      return false;
    }
    return meaningfulQuestionCount(previous.questions) > meaningfulQuestionCount(questions) ||
      selectedAnswerCount(previous.questions) > selectedAnswerCount(questions);
  }

  async function captureAttempt(records, reason) {
    await init();
    var questions = (records || []).map(snapshotRecord);
    questions.forEach(function (question) {
      ensureQuestion(question);
      if (question.selectedAnswers && question.selectedAnswers.length) {
        memory.learnedQuestions[question.hash].candidateAnswers = uniquePush(memory.learnedQuestions[question.hash].candidateAnswers, question.selectedAnswers, performanceConfig.maxCandidateAnswersPerQuestion || 20);
      }
    });
    if (shouldPreservePreviousAttempt(questions)) {
      addEvent("snapshot_preserved", {
        reason: reason || "snapshot",
        count: questions.length,
        preservedAttemptId: memory.lastAttempt.id
      });
      await save();
      return;
    }
    memory.lastAttempt = {
      id: "attempt_" + Date.now(),
      createdAt: now(),
      url: location.href,
      reason: reason || "snapshot",
      questions: questions
    };
    addEvent("snapshot", { reason: reason || "snapshot", count: questions.length });
    await save();
  }

  function pageText() {
    return normalizeText(document.body ? (document.body.innerText || document.body.textContent || "") : "");
  }

  function isFinalPage() {
    var detection = config.finalPageDetection || {};
    if (detection.enabled === false) {
      return { isFinal: false, reason: "disabled", matched: "" };
    }

    var href = normalizeText(location.href || "");
    var pathname = normalizeText(location.pathname || "");
    var hash = normalizeText(location.hash || "");
    var urlText = [href, pathname, hash].join(" ");
    var urlIncludes = detection.urlIncludes || [];
    for (var i = 0; i < urlIncludes.length; i += 1) {
      var needle = normalizeText(urlIncludes[i]);
      if (needle && urlText.indexOf(needle) !== -1) {
        return { isFinal: true, reason: "url", matched: urlIncludes[i] };
      }
    }

    var text = pageText();
    var pairs = detection.strongTextPairs || [];
    for (var j = 0; j < pairs.length; j += 1) {
      var left = normalizeText(pairs[j][0]);
      var right = normalizeText(pairs[j][1]);
      if (text.indexOf(left) !== -1 && text.indexOf(right) !== -1) {
        return { isFinal: true, reason: "strongTextPair", matched: pairs[j].join(" + ") };
      }
    }

    var includes = (detection.textIncludes || []).concat(config.finalPageKeywords || []);
    for (var k = 0; k < includes.length; k += 1) {
      var keyword = normalizeText(includes[k]);
      if (["esci", "secondi", "risultato"].indexOf(keyword) !== -1) {
        continue;
      }
      if (keyword && text.indexOf(keyword) !== -1) {
        return { isFinal: true, reason: "keyword", matched: includes[k] };
      }
    }

    debug("final page not detected: keyword missing or visible controls still present");
    return { isFinal: false, reason: "keyword missing", matched: "" };
  }

  async function checkFinalPageAndLearn(reason) {
    await init();
    var finalResult = isFinalPage();
    if (!finalResult.isFinal) {
      return finalResult;
    }
    var attempt = memory.lastAttempt;
    if (attempt && attempt.questions && attempt.questions.length) {
      attempt.questions.forEach(function (question) {
        markCorrectFromQuestion(question);
      });
      addEvent("final_page_detected", {
        reason: finalResult.reason,
        matched: finalResult.matched,
        lastAttemptId: attempt.id,
        questionCount: attempt.questions.length
      });
      memory.lastAttempt = null;
      await save();
    } else {
      addEvent("final_page_detected", {
        reason: finalResult.reason,
        matched: finalResult.matched,
        lastAttemptId: "",
        questionCount: 0
      });
      await save();
    }
    return finalResult;
  }

  function recordHasError(record) {
    if (!record || !record.container) {
      return false;
    }
    var selectors = config.errorSelectors || [];
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (record.container.matches(selectors[i]) || record.container.querySelector(selectors[i])) {
          return true;
        }
      } catch (error) {
        // Ignore invalid selectors.
      }
    }
    var text = normalizeText(record.container.innerText || record.container.textContent || "");
    return (config.errorTextKeywords || []).some(function (keyword) {
      return text.indexOf(normalizeText(keyword)) !== -1;
    });
  }

  async function detectErrorsAndLearn(records, reason) {
    await init();
    var errored = (records || []).filter(recordHasError);
    if (!errored.length) {
      if (config.DEBUG) {
        debug("error selectors checked, no mapped field errors", config.errorSelectors || []);
      }
      return false;
    }
    var attemptByHash = new Map();
    if (memory.lastAttempt && memory.lastAttempt.questions) {
      memory.lastAttempt.questions.forEach(function (question) {
        attemptByHash.set(question.hash, question);
      });
    }
    errored.forEach(function (record) {
      var previous = attemptByHash.get(record.hash);
      var answers = record.selectedAnswers && record.selectedAnswers.length ? record.selectedAnswers : (previous ? previous.selectedAnswers : []);
      if (answers && answers.length) {
        markWrong(record, answers);
      }
    });
    addEvent("wrong_answers_detected", { reason: reason || "error", count: errored.length });
    await save();
    return true;
  }

  async function observe(records, reason) {
    await init();
    var changed = false;
    (records || []).forEach(function (record) {
      markSeen(record);
      changed = markCandidate(record) || changed;
    });
    addEvent("observe", { reason: reason || "run", records: (records || []).length });
    await save();
    return changed;
  }

  async function observeSuggestions(records, suggestions, reason) {
    await init();
    var byIndex = new Map();
    (suggestions || []).forEach(function (suggestion) {
      byIndex.set(suggestion.recordIndex, suggestion);
    });
    (records || []).forEach(function (record) {
      var suggestion = byIndex.get(record.index);
      if (suggestion) {
        markSuggested(record);
        markAccepted(record, suggestion);
      }
    });
    addEvent("suggestions", { reason: reason || "run", suggestions: (suggestions || []).length });
    await save();
  }

  function localItemFromQuestion(question) {
    var hasCorrect = splitList(question.correctAnswers).length > 0;
    var hasCandidate = splitList(question.candidateAnswers).length > 0;
    var hasWrong = splitList(question.wrongAnswers).length > 0;
    var useCandidateAnswers = !!(config.localLearning && config.localLearning.useCandidateAnswersForSuggestions);
    var hasConflict = hasCorrect && hasWrong && question.correctAnswers.some(function (answer) {
      return (question.wrongAnswers || []).map(normalizeText).indexOf(normalizeText(answer)) !== -1;
    });
    var confidenceBase = hasCorrect && !hasConflict
      ? ((config.localLearning || {}).correctAnswerBaseConfidence || 0.96)
      : (hasCorrect ? 0.72 : (hasCandidate && useCandidateAnswers ? ((config.localLearning || {}).candidateBaseConfidence || 0.64) : 0.30));
    var trainingCandidates = useCandidateAnswers && !hasCorrect ? (question.candidateAnswers || []) : [];
    return {
      source: "local",
      hash: question.hash,
      stableHash: question.stableHash || stableQuestionHash(question),
      questionText: question.questionText || "",
      normalizedQuestion: question.normalizedQuestion || normalizeQuestion(question.questionText || ""),
      canonicalQuestion: question.canonicalQuestion || canonicalQuestionText(question.questionText || ""),
      inputTypes: question.inputTypes || [],
      optionsSeen: question.options || [],
      correctAnswers: question.correctAnswers || [],
      wrongAnswers: question.wrongAnswers || [],
      lastSelectedAnswers: trainingCandidates,
      candidateAnswers: trainingCandidates,
      confidenceBase: confidenceBase,
      hasConflict: hasConflict,
      isReliable: hasCorrect || !!trainingCandidates.length,
      confirmedOnly: !useCandidateAnswers
    };
  }

  function getTrainingItems() {
    return Object.keys(memory.learnedQuestions || {}).map(function (hash) {
      return localItemFromQuestion(memory.learnedQuestions[hash]);
    }).filter(function (item) {
      return item.isReliable;
    });
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

  function getDatasetIndex() {
    var rows = getTrainingItems();
    if (GH.Matcher && GH.Matcher.createCombinedIndex) {
      return GH.Matcher.createCombinedIndex(rows);
    }
    var index = {
      byHash: new Map(),
      byNormalizedQuestion: new Map(),
      byCanonicalQuestion: new Map(),
      rows: rows
    };
    rows.forEach(function (item) {
      addToMapList(index.byHash, item.hash, item);
      addToMapList(index.byHash, item.stableHash, item);
      addToMapList(index.byNormalizedQuestion, item.normalizedQuestion, item);
      addToMapList(index.byCanonicalQuestion, item.canonicalQuestion, item);
    });
    return index;
  }

  function getLearningStats() {
    var questions = Object.keys(memory.learnedQuestions || {}).map(function (hash) {
      return memory.learnedQuestions[hash];
    });
    return {
      learnedQuestionsTotal: questions.length,
      withCandidateAnswers: questions.filter(function (q) { return (q.candidateAnswers || []).length > 0; }).length,
      withCorrectAnswers: questions.filter(function (q) { return (q.correctAnswers || []).length > 0; }).length,
      withWrongAnswers: questions.filter(function (q) { return (q.wrongAnswers || []).length > 0; }).length,
      trainingUsableQuestions: questions.filter(function (q) { return (q.correctAnswers || []).length > 0; }).length,
      candidateAnswersUsedForSuggestions: !!(config.localLearning && config.localLearning.useCandidateAnswersForSuggestions),
      lastAttemptPresent: !!memory.lastAttempt,
      eventsCount: (memory.events || []).length
    };
  }

  async function readMemory() {
    await init();
    return getLearningStats();
  }

  async function exportMemoryToConsole() {
    await init();
    console.log(memory);
    return memory;
  }

  async function clearMemory() {
    memory = defaultMemory();
    seenThisPage = new Set();
    suggestedThisPage = new Set();
    acceptedThisPage = new Set();
    await save();
    return getLearningStats();
  }

  async function getRawMemory() {
    await init();
    return memory;
  }

  GH.Learner = {
    init: init,
    observe: observe,
    observeSuggestions: observeSuggestions,
    captureAttempt: captureAttempt,
    checkFinalPageAndLearn: checkFinalPageAndLearn,
    detectErrorsAndLearn: detectErrorsAndLearn,
    recordHasError: recordHasError,
    isFinalPage: isFinalPage,
    getLearningStats: getLearningStats,
    readMemory: readMemory,
    exportMemoryToConsole: exportMemoryToConsole,
    clearMemory: clearMemory,
    getRawMemory: getRawMemory,
    getTrainingItems: getTrainingItems,
    getDatasetIndex: getDatasetIndex
  };
})();
