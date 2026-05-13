(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var performanceConfig = config.performance || {};
  var utils = GH.Utils || {};
  var activeIndex = GH.DatasetLoader && GH.DatasetLoader.emptyIndex ? GH.DatasetLoader.emptyIndex() : { rows: [], byHash: new Map(), byNormalizedQuestion: new Map(), byCanonicalQuestion: new Map() };

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

  function canonicalAnswerKey(text) {
    return utils.canonicalAnswerKey ? utils.canonicalAnswerKey(text) : normalizeAnswer(text);
  }

  function noPunctuationKey(text) {
    return utils.noPunctuationKey ? utils.noPunctuationKey(text) : normalizeAnswer(text).replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function trustConfig() {
    return config.datasetTrust || config.csvTrust || {};
  }

  function list(value) {
    return utils.splitStoredList ? utils.splitStoredList(value) : String(value || "").split(/\s+\|\s+|\r?\n|;\s*/g).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function isChoiceRecord(record) {
    var types = record.inputTypes || [];
    return types.indexOf("radio") !== -1 || types.indexOf("checkbox") !== -1 || types.indexOf("select") !== -1;
  }

  function isTextRecord(record) {
    return !isChoiceRecord(record);
  }

  function tokenize(text) {
    var stop = new Set(["della", "dello", "degli", "delle", "sono", "come", "alla", "allo", "nelle", "negli", "con", "per", "del", "dei", "gli", "una", "uno", "che"]);
    var seen = new Set();
    return normalizeText(text)
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
      .split(/\s+/)
      .map(function (token) { return token.trim(); })
      .filter(function (token) { return token.length > 1 && !stop.has(token); })
      .filter(function (token) {
        if (seen.has(token)) {
          return false;
        }
        seen.add(token);
        return true;
      });
  }

  function jaccardSimilarity(a, b) {
    var left = Array.isArray(a) ? a : tokenize(a);
    var right = Array.isArray(b) ? b : tokenize(b);
    if (!left.length && !right.length) {
      return 1;
    }
    if (!left.length || !right.length) {
      return 0;
    }
    var setA = new Set(left);
    var setB = new Set(right);
    var hits = 0;
    setA.forEach(function (token) {
      if (setB.has(token)) {
        hits += 1;
      }
    });
    return hits / (setA.size + setB.size - hits);
  }

  function trigrams(text) {
    var clean = normalizeText(text).replace(/\s+/g, " ");
    if (!clean) {
      return [];
    }
    if (clean.length <= 3) {
      return [clean];
    }
    var out = [];
    for (var i = 0; i <= clean.length - 3; i += 1) {
      out.push(clean.slice(i, i + 3));
    }
    return out;
  }

  function trigramSimilarity(a, b) {
    return jaccardSimilarity(trigrams(a), trigrams(b));
  }

  function normalizeUrl(url) {
    var raw = String(url || "").trim().replace(/[.,;:!?]+$/, "");
    if (!raw) {
      return "";
    }
    try {
      var withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
      var parsed = new URL(withProtocol);
      return (parsed.hostname.replace(/^www\./i, "") + parsed.pathname.replace(/\/$/, "") + parsed.search).toLowerCase();
    } catch (error) {
      return canonicalAnswerKey(raw).replace(/^https?:\/\//, "").replace(/^www\./, "");
    }
  }

  function urlProtocol(text) {
    var match = String(text || "").trim().match(/^(https?):\/\//i);
    return match ? match[1].toLowerCase() : "";
  }

  function extractUrls(text) {
    return (String(text || "").match(/\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi) || []).map(normalizeUrl).filter(Boolean);
  }

  function extractNumbers(text) {
    return (String(text || "").match(/[-+]?\d+(?:[.,]\d+)?/g) || []).map(function (value) {
      return value.replace(",", ".");
    });
  }

  function extractCodes(text) {
    var commonWords = new Set(["indicare", "inserire", "seleziona", "selezionare", "codice", "identificativo", "risposta", "domanda", "caratteri", "iniziali", "finali", "lettere", "minuscole", "maiuscole", "senza", "vocali", "consonanti"]);
    return (String(text || "").match(/[+@#]?[a-zA-Z0-9][a-zA-Z0-9._-]{3,}/g) || [])
      .map(function (code) { return normalizeAnswer(code.replace(/[.,;:!?]+$/, "")); })
      .filter(function (code) {
        return !commonWords.has(code) && (/[0-9+@#._-]/.test(code) || code.length >= 8);
      });
  }

  function overlapScore(left, right) {
    if (!left.length || !right.length) {
      return 0;
    }
    var set = new Set(right.map(normalizeAnswer));
    var hits = left.filter(function (item) {
      return set.has(normalizeAnswer(item));
    }).length;
    return hits / Math.max(left.length, right.length);
  }

  function firstTokensForText(text) {
    if (GH.DatasetLoader && GH.DatasetLoader.firstTokensForText) {
      return GH.DatasetLoader.firstTokensForText(text);
    }
    return tokenize(text).slice(0, 5);
  }

  function scoreAnswerToOption(answer, option) {
    var left = canonicalAnswerKey(answer);
    var right = canonicalAnswerKey(option);
    if (!left || !right) {
      return 0;
    }
    var leftProtocol = urlProtocol(answer);
    var rightProtocol = urlProtocol(option);
    if (left === right && leftProtocol && rightProtocol && leftProtocol !== rightProtocol) {
      return 0.80;
    }
    if (left === right) {
      return 1;
    }
    var numberWords = {
      zero: "0",
      uno: "1",
      una: "1",
      due: "2",
      tre: "3",
      quattro: "4",
      cinque: "5",
      sei: "6",
      sette: "7",
      otto: "8",
      nove: "9",
      dieci: "10"
    };
    if ((numberWords[left] && numberWords[left] === right) || (numberWords[right] && numberWords[right] === left)) {
      return 0.98;
    }
    if ((left === "si" && right === "sì") || (left === "sì" && right === "si")) {
      return 1;
    }
    if (noPunctuationKey(left) && noPunctuationKey(left) === noPunctuationKey(right)) {
      return 0.96;
    }
    var leftDigits = normalizeAnswer(answer).replace(/[.\s]/g, "").replace(",", ".");
    var rightDigits = normalizeAnswer(option).replace(/[.\s]/g, "").replace(",", ".");
    if (/^\d+(?:\.\d+)?$/.test(leftDigits) && /^\d+(?:\.\d+)?$/.test(rightDigits) && Number(leftDigits) === Number(rightDigits)) {
      return 0.97;
    }
    var leftNum = parseFloat(normalizeAnswer(answer).replace(",", "."));
    var rightNum = parseFloat(normalizeAnswer(option).replace(",", "."));
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(normalizeAnswer(answer)) &&
        /^[-+]?\d+(?:[.,]\d+)?$/.test(normalizeAnswer(option)) &&
        Math.abs(leftNum - rightNum) < 0.000001) {
      return 0.95;
    }
    var leftUrls = extractUrls(answer);
    var rightUrls = extractUrls(option);
    if (leftUrls.length && rightUrls.length && leftUrls[0] === rightUrls[0]) {
      if (leftProtocol && rightProtocol && leftProtocol !== rightProtocol) {
        return 0.80;
      }
      return 0.97;
    }
    var leftDate = normalizeDate(answer);
    var rightDate = normalizeDate(option);
    if (leftDate && rightDate && leftDate === rightDate) {
      return 0.97;
    }
    if (left.length >= 4 && right.indexOf(left) !== -1) {
      return 0.86;
    }
    if (right.length >= 4 && left.indexOf(right) !== -1) {
      return 0.82;
    }
    return Math.max(trigramSimilarity(left, right) * 0.74, jaccardSimilarity(left, right) * 0.84);
  }

  function normalizeDate(text) {
    var value = String(text || "").trim();
    var dmy = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (dmy) {
      var year = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
      return ("0" + dmy[1]).slice(-2) + "/" + ("0" + dmy[2]).slice(-2) + "/" + year;
    }
    var iso = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return ("0" + iso[3]).slice(-2) + "/" + ("0" + iso[2]).slice(-2) + "/" + iso[1];
    }
    return "";
  }

  function splitAnswerText(answerText) {
    return list(answerText);
  }

  function answersSimilarity(left, right) {
    var leftParts = splitAnswerText(left);
    var rightParts = splitAnswerText(right);
    if (!leftParts.length || !rightParts.length) {
      return 0;
    }
    var scores = leftParts.map(function (leftPart) {
      return Math.max.apply(null, rightParts.map(function (rightPart) {
        return scoreAnswerToOption(leftPart, rightPart);
      }));
    });
    return scores.reduce(function (sum, score) { return sum + score; }, 0) / scores.length;
  }

  function scoreAnswerPresenceInCurrentOptions(record, answerText) {
    var parts = splitAnswerText(answerText);
    var options = record.options || [];
    if (!parts.length || !options.length) {
      return {
        score: 0,
        targetOptions: [],
        ambiguous: false
      };
    }

    var targetOptions = [];
    var scores = [];
    var ambiguous = false;

    parts.forEach(function (part) {
      var ranked = options.map(function (option, index) {
        return {
          index: index,
          optionText: option,
          score: scoreAnswerToOption(part, option)
        };
      }).sort(function (a, b) {
        return b.score - a.score;
      });

      if (!ranked.length) {
        scores.push(0);
        return;
      }
      var best = ranked[0];
      var second = ranked[1];
      if (best.score >= 0.78) {
        if (second && best.score < 0.94 && best.score - second.score < 0.12) {
          ambiguous = true;
        }
        targetOptions.push(best);
        scores.push(best.score);
      } else {
        scores.push(best.score);
      }
    });

    return {
      score: scores.length ? scores.reduce(function (sum, score) { return sum + score; }, 0) / scores.length : 0,
      targetOptions: targetOptions,
      ambiguous: ambiguous
    };
  }

  function answerInWrongAnswers(answer, item) {
    var wrong = list(item.wrongAnswers).map(canonicalAnswerKey);
    if (!wrong.length) {
      return false;
    }
    return splitAnswerText(answer).some(function (part) {
      var key = canonicalAnswerKey(part);
      return wrong.indexOf(key) !== -1 || wrong.indexOf(noPunctuationKey(part)) !== -1;
    });
  }

  function answerPresentInQuestion(record, answerText) {
    var question = normalizeText(record.questionText || "");
    return splitAnswerText(answerText).some(function (part) {
      var key = canonicalAnswerKey(part);
      return key && question.indexOf(key) !== -1;
    });
  }

  function exactQuestionMatch(record, item) {
    var currentNormalized = record.normalizedQuestion || normalizeQuestion(record.questionText || "");
    var currentCanonical = record.canonicalQuestion || canonicalQuestionText(record.questionText || "");
    var itemNormalized = item.normalizedQuestion || normalizeQuestion(item.questionText || "");
    var itemCanonical = item.canonicalQuestion || canonicalQuestionText(item.questionText || "");
    return !!(record.hash && (record.hash === item.hash || record.hash === item.stableHash)) ||
      !!(currentNormalized && itemNormalized && currentNormalized === itemNormalized) ||
      !!(currentCanonical && itemCanonical && currentCanonical === itemCanonical);
  }

  function isDatasetItemUsableForRecord(record, item) {
    if (!item || item.isReliable === false) {
      return false;
    }
    if (utils.isTextInputType && utils.isTextInputType(record.inputTypes)) {
      var answers = item.correctAnswers && item.correctAnswers.length ? item.correctAnswers : (item.lastSelectedAnswers || item.candidateAnswers || []);
      return answerPresentInQuestion(record, answers.join(" | ")) || exactQuestionMatch(record, item);
    }
    return true;
  }

  function getDatasetAnswerCandidate(item, record) {
    if (!isDatasetItemUsableForRecord(record, item)) {
      return {
        rejectedReason: item && item.rejectedReason ? item.rejectedReason : "dataset item non utilizzabile"
      };
    }

    var answers = list(item.correctAnswers);
    var kind = "correct";
    if (!answers.length) {
      if (trustConfig().useLastSelectedAnswersAsFallback === false && item.source === "csv") {
        return { rejectedReason: "lastSelectedAnswers non fidate da config" };
      }
      answers = list(item.lastSelectedAnswers || item.candidateAnswers);
      kind = item.source === "local" ? "candidate" : "lastSelected";
    }
    if (!answers.length) {
      return { rejectedReason: "nessuna risposta candidata" };
    }

    answers = answers.filter(function (answer) {
      return !answerInWrongAnswers(answer, item);
    });
    if (!answers.length) {
      return { rejectedReason: "risposta presente in wrongAnswers" };
    }

    if (kind === "candidate" && isChoiceRecord(record)) {
      var recentMatches = answers.slice().reverse().map(function (answer) {
        return {
          answer: answer,
          presence: scoreAnswerPresenceInCurrentOptions(record, answer)
        };
      }).filter(function (entry) {
        return entry.presence.score >= 0.78 && !entry.presence.ambiguous;
      });
      if (recentMatches.length) {
        answers = [recentMatches[0].answer];
      }
    }

    if (isChoiceRecord(record)) {
      var optionPresence = scoreAnswerPresenceInCurrentOptions(record, answers.join(" | "));
      if (optionPresence.score < 0.78) {
        return {
          rejectedReason: "risposta dataset assente dalle opzioni correnti",
          answerText: answers.join(" | "),
          optionPresence: optionPresence
        };
      }
      if (optionPresence.ambiguous) {
        return {
          rejectedReason: "opzioni correnti ambigue",
          answerText: answers.join(" | "),
          optionPresence: optionPresence
        };
      }
    }

    return {
      answerText: answers.join(" | "),
      answerTexts: answers,
      answerKind: kind,
      optionPresence: scoreAnswerPresenceInCurrentOptions(record, answers.join(" | "))
    };
  }

  function scoreCandidate(record, item) {
    var currentNormalized = record.normalizedQuestion || normalizeQuestion(record.questionText || "");
    var currentCanonical = record.canonicalQuestion || canonicalQuestionText(record.questionText || "");
    var itemNormalized = item.normalizedQuestion || normalizeQuestion(item.questionText || "");
    var itemCanonical = item.canonicalQuestion || canonicalQuestionText(item.questionText || "");
    var exactHash = !!(record.hash && (record.hash === item.hash || record.hash === item.stableHash));
    var exactNormalized = !!(currentNormalized && itemNormalized && currentNormalized === itemNormalized);
    var exactCanonical = !!(currentCanonical && itemCanonical && currentCanonical === itemCanonical);

    var jaccard = jaccardSimilarity(currentCanonical, itemCanonical);
    var trigram = trigramSimilarity(currentCanonical, itemCanonical);
    var urls = overlapScore(extractUrls(record.questionText), extractUrls(item.questionText));
    var numbers = overlapScore(extractNumbers(record.questionText), extractNumbers(item.questionText));
    var codes = overlapScore(extractCodes(record.questionText), extractCodes(item.questionText));
    var score = Math.max(jaccard * 0.44 + trigram * 0.34 + urls * 0.08 + numbers * 0.08 + codes * 0.06, jaccard, trigram * 0.92);
    var reason = "fuzzy";

    if (exactHash) {
      score = 1;
      reason = "hash esatto";
    } else if (exactNormalized) {
      score = Math.max(score, 0.98);
      reason = "normalizedQuestion esatta";
    } else if (exactCanonical) {
      score = Math.max(score, 0.97);
      reason = "canonicalQuestion esatta";
    }

    if (!exactHash && !exactNormalized && !exactCanonical) {
      var ratio = Math.max(currentCanonical.length || 1, itemCanonical.length || 1) / Math.max(1, Math.min(currentCanonical.length || 1, itemCanonical.length || 1));
      if (ratio > 2.6 && jaccard < 0.70) {
        score -= 0.10;
        reason += ", penalita lunghezza";
      }
      if (jaccard < 0.34 && trigram < 0.45 && urls === 0 && numbers === 0) {
        score -= 0.12;
        reason += ", testo diverso";
      }
    }
    if (item.hasConflict) {
      score -= 0.08;
      reason += ", conflitto";
    }

    return {
      score: Math.max(0, Math.min(1, score)),
      reason: reason,
      exactHash: exactHash,
      exactNormalized: exactNormalized,
      exactCanonical: exactCanonical,
      details: {
        jaccard: jaccard,
        trigram: trigram,
        urls: urls,
        numbers: numbers,
        codes: codes
      }
    };
  }

  function addUnique(out, seen, items) {
    (items || []).forEach(function (item) {
      var key = (item.source || "") + "|" + (item.hash || "") + "|" + (item.stableHash || "") + "|" + (item.canonicalQuestion || item.normalizedQuestion || "");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    });
  }

  function findDatasetCandidates(record, index) {
    var sourceIndex = index || activeIndex;
    var maxCandidates = performanceConfig.maxDatasetCandidates || 50;
    var candidates = [];
    var seen = new Set();
    var normalized = record.normalizedQuestion || normalizeQuestion(record.questionText || "");
    var canonical = record.canonicalQuestion || canonicalQuestionText(record.questionText || "");

    addUnique(candidates, seen, sourceIndex.byHash && sourceIndex.byHash.get(record.hash));
    addUnique(candidates, seen, sourceIndex.byNormalizedQuestion && sourceIndex.byNormalizedQuestion.get(normalized));
    addUnique(candidates, seen, sourceIndex.byCanonicalQuestion && sourceIndex.byCanonicalQuestion.get(canonical));

    if (candidates.length) {
      return candidates.slice(0, maxCandidates);
    }

    extractUrls(record.questionText).forEach(function (url) {
      addUnique(candidates, seen, sourceIndex.byUrls && sourceIndex.byUrls.get(url));
    });
    extractNumbers(record.questionText).forEach(function (number) {
      addUnique(candidates, seen, sourceIndex.byNumbers && sourceIndex.byNumbers.get(number));
    });
    var signature = (GH.DatasetLoader && GH.DatasetLoader.signatureForText)
      ? GH.DatasetLoader.signatureForText(record.questionText || canonical)
      : firstTokensForText(canonical).join("|");
    addUnique(candidates, seen, sourceIndex.bySignature && sourceIndex.bySignature.get(signature));
    firstTokensForText(canonical).forEach(function (token) {
      addUnique(candidates, seen, sourceIndex.byFirstTokens && sourceIndex.byFirstTokens.get(token));
    });
    tokenize(canonical).filter(function (token) { return token.length >= 5; }).slice(0, 4).forEach(function (token) {
      addUnique(candidates, seen, sourceIndex.byKeyword && sourceIndex.byKeyword.get(token));
    });

    if (!candidates.length && (sourceIndex.rows || []).length <= maxCandidates) {
      addUnique(candidates, seen, sourceIndex.rows || []);
    }

    return candidates.map(function (item) {
      return {
        item: item,
        score: scoreCandidate(record, item).score
      };
    }).filter(function (entry) {
      return entry.score >= 0.40;
    }).sort(function (a, b) {
      return b.score - a.score;
    }).slice(0, maxCandidates).map(function (entry) {
      return entry.item;
    });
  }

  function getBestDatasetMatch(record, index) {
    var candidates = findDatasetCandidates(record, index);
    var best = null;

    candidates.forEach(function (item) {
      var candidate = getDatasetAnswerCandidate(item, record);
      if (!candidate.answerText) {
        if (!best) {
          best = {
            source: item && item.source === "local" ? "local" : "dataset",
            confidence: 0,
            rejectedReason: candidate.rejectedReason,
            matchedQuestionText: item && item.questionText,
            matchedHash: item && (item.hash || item.stableHash)
          };
        }
        return;
      }

      var scoring = scoreCandidate(record, item);
      var base = typeof item.confidenceBase === "number" ? item.confidenceBase : 0.55;
      var optionScore = candidate.optionPresence ? candidate.optionPresence.score : 0;
      var confidence = Math.max(0, Math.min(0.99, base * (0.30 + scoring.score * 0.70)));
      var reason = scoring.reason + " / " + candidate.answerKind;

      if (candidate.answerKind === "lastSelected" && (scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical)) {
        confidence = Math.max(confidence, trustConfig().lastSelectedExactQuestionConfidence || 0.80);
      }
      if (isTextRecord(record) && (scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical)) {
        if (candidate.answerKind === "correct") {
          confidence = Math.max(confidence, 0.96);
        } else if (item.source === "local") {
          confidence = Math.max(confidence, candidate.answerKind === "candidate" ? 0.86 : 0.82);
        }
        reason += " / domanda testo esatta";
      }
      if (isChoiceRecord(record) && optionScore >= 0.92) {
        confidence = Math.min(0.99, confidence + (candidate.answerKind === "lastSelected" ? 0.04 : 0.08));
        if (scoring.score >= 0.55) {
          confidence = Math.max(confidence, 0.78);
        }
        if (scoring.score >= 0.80) {
          confidence = Math.max(confidence, 0.88);
        }
        if (candidate.answerKind !== "lastSelected" && (scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical)) {
          confidence = Math.max(confidence, 0.92);
        }
        reason += " / opzione presente";
      }
      if (candidate.answerKind === "lastSelected") {
        confidence = Math.min(confidence, (scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical) ? (trustConfig().lastSelectedExactQuestionConfidence || 0.80) : 0.74);
      }
      if ((candidate.answerKind === "lastSelected" || candidate.answerKind === "candidate") &&
          !(scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical)) {
        confidence = Math.min(confidence, 0.68);
        reason += " / fallback debole solo fuzzy";
      }
      if (isChoiceRecord(record) && optionScore < 0.78) {
        confidence = Math.min(confidence, 0.35);
        reason += " / opzione assente";
      }
      if (item.hasConflict && candidate.answerKind !== "correct") {
        confidence = Math.min(confidence, 0.62);
      }

      var suggestion = {
        source: item.source === "local" ? "local" : "dataset",
        answerText: candidate.answerText,
        answerTexts: candidate.answerTexts,
        confidence: confidence,
        answerKind: candidate.answerKind,
        reason: reason,
        matchedQuestionText: item.questionText,
        matchedHash: item.hash || item.stableHash,
        targetOptions: candidate.optionPresence ? candidate.optionPresence.targetOptions : [],
        wrongAnswers: list(item.wrongAnswers),
        answerSetCertain: candidate.answerKind === "correct" || confidence >= (config.strongConfidenceThreshold || 0.88),
        exactQuestion: scoring.exactHash || scoring.exactNormalized || scoring.exactCanonical,
        textAnswerHint: isTextRecord(record),
        datasetItem: item
      };

      if (!best || suggestion.confidence > best.confidence) {
        best = suggestion;
      }
    });

    return best;
  }

  function match(record, index) {
    return getBestDatasetMatch(record, index);
  }

  function getRuleSuggestion(record) {
    return GH.RulesEngine && GH.RulesEngine.solve ? GH.RulesEngine.solve(record) : null;
  }

  function getDatasetSuggestion(record, index) {
    var sourceIndex = index || activeIndex;
    return getBestDatasetMatch(record, sourceIndex);
  }

  function getLocalMemorySuggestion(record, index) {
    if (index) {
      return getBestDatasetMatch(record, index);
    }
    if (!GH.Learner || !GH.Learner.getDatasetIndex) {
      return null;
    }
    return getBestDatasetMatch(record, GH.Learner.getDatasetIndex());
  }

  function validSuggestion(suggestion) {
    return !!(suggestion && suggestion.answerText && suggestion.confidence >= (config.confidenceThreshold || 0.72));
  }

  function combineSuggestions(ruleSuggestion, datasetSuggestion, localSuggestion, record) {
    if (arguments.length === 3) {
      record = localSuggestion;
      localSuggestion = null;
    }
    var threshold = config.confidenceThreshold || 0.70;
    var strong = config.strongConfidenceThreshold || 0.88;

    if (ruleSuggestion && ruleSuggestion.explicitAnswer && ruleSuggestion.confidence >= 0.90) {
      return Object.assign({}, ruleSuggestion, {
        recordIndex: record.index,
        reason: (ruleSuggestion.reason || "risposta esplicita") + " / priorita massima"
      });
    }

    if (ruleSuggestion && ruleSuggestion.currentPageLiteral && ruleSuggestion.confidence >= threshold) {
      return Object.assign({}, ruleSuggestion, {
        recordIndex: record.index,
        reason: (ruleSuggestion.reason || "valore letterale pagina") + " / preferito al dataset"
      });
    }

    if (isTextRecord(record)) {
      if (ruleSuggestion && ruleSuggestion.answerText && ruleSuggestion.confidence >= threshold) {
        return Object.assign({}, ruleSuggestion, {
          recordIndex: record.index,
          textAnswerHint: true
        });
      }
      var textOrdered = [localSuggestion, datasetSuggestion].filter(function (suggestion) {
        return suggestion && suggestion.answerText && suggestion.exactQuestion && suggestion.confidence >= threshold;
      }).sort(function (a, b) {
        function priority(suggestion) {
          if (suggestion.source === "local" && suggestion.answerKind === "correct") {
            return 40;
          }
          if (suggestion.source === "dataset" && suggestion.answerKind === "correct") {
            return 30;
          }
          if (suggestion.source === "local") {
            return 20;
          }
          return 10;
        }
        return (priority(b) + (b.confidence || 0)) - (priority(a) + (a.confidence || 0));
      });
      if (textOrdered.length) {
        return Object.assign({}, textOrdered[0], {
          recordIndex: record.index,
          textAnswerHint: true,
          reason: (textOrdered[0].reason || "memoria testo") + " / suggerimento testo esatto"
        });
      }
      return {
        confidence: 0,
        rejectedReason: "text input: nessun highlight da dataset o regole non esplicite",
        recordIndex: record.index
      };
    }

    if (localSuggestion && datasetSuggestion && localSuggestion.answerText && datasetSuggestion.answerText) {
      var localDatasetSimilarity = answersSimilarity(localSuggestion.answerText, datasetSuggestion.answerText);
      if (localDatasetSimilarity >= 0.86) {
        return {
          answerText: localSuggestion.answerText,
          answerTexts: localSuggestion.answerTexts || datasetSuggestion.answerTexts,
          confidence: Math.min(0.99, Math.max(localSuggestion.confidence, datasetSuggestion.confidence) + 0.07),
          source: "combined",
          answerKind: localSuggestion.answerKind || datasetSuggestion.answerKind,
          reason: "memoria locale e CSV concordano",
          targetOptions: localSuggestion.targetOptions && localSuggestion.targetOptions.length ? localSuggestion.targetOptions : datasetSuggestion.targetOptions,
          wrongAnswers: (localSuggestion.wrongAnswers || []).concat(datasetSuggestion.wrongAnswers || []),
          answerSetCertain: !!(localSuggestion.answerSetCertain || datasetSuggestion.answerSetCertain),
          recordIndex: record.index
        };
      }
    }

    if (ruleSuggestion && datasetSuggestion && datasetSuggestion.answerText) {
      if (ruleSuggestion.source === "personalData" && ruleSuggestion.confidence >= threshold) {
        return Object.assign({}, ruleSuggestion, {
          reason: (ruleSuggestion.reason || "dati cliccatore salvati") + " / preferito al dataset",
          recordIndex: record.index
        });
      }
      var similarity = answersSimilarity(ruleSuggestion.answerText, datasetSuggestion.answerText);
      if (similarity >= 0.86) {
        return {
          answerText: ruleSuggestion.confidence >= datasetSuggestion.confidence ? ruleSuggestion.answerText : datasetSuggestion.answerText,
          answerTexts: ruleSuggestion.answerTexts || datasetSuggestion.answerTexts,
          confidence: Math.min(0.99, Math.max(ruleSuggestion.confidence, datasetSuggestion.confidence) + 0.08),
          source: "combined",
          reason: "rules e dataset concordano: " + ruleSuggestion.reason + " + " + datasetSuggestion.reason,
          targetOptions: ruleSuggestion.targetOptions && ruleSuggestion.targetOptions.length ? ruleSuggestion.targetOptions : datasetSuggestion.targetOptions,
          wrongAnswers: datasetSuggestion.wrongAnswers || [],
          answerSetCertain: !!(ruleSuggestion.answerSetCertain || datasetSuggestion.answerSetCertain),
          explicitAnswer: !!ruleSuggestion.explicitAnswer,
          explicitAnswerText: ruleSuggestion.explicitAnswerText,
          explicitRawText: ruleSuggestion.explicitRawText,
          recordIndex: record.index
        };
      }
      if (!ruleSuggestion.explicitAnswer && datasetSuggestion.source === "local" && datasetSuggestion.confidence >= threshold) {
        return Object.assign({}, datasetSuggestion, {
          reason: datasetSuggestion.reason + " / memoria locale preferita a regola non esplicita",
          recordIndex: record.index
        });
      }
      if (ruleSuggestion.confidence >= strong && ruleSuggestion.confidence >= datasetSuggestion.confidence) {
        return Object.assign({}, ruleSuggestion, {
          reason: ruleSuggestion.reason + " / dataset divergente ignorato",
          recordIndex: record.index
        });
      }
      if (datasetSuggestion.confidence >= strong && datasetSuggestion.confidence > ruleSuggestion.confidence) {
        return Object.assign({}, datasetSuggestion, {
          reason: datasetSuggestion.reason + " / regola divergente ignorata",
          recordIndex: record.index
        });
      }
      debug("Suggerimenti divergenti sotto soglia forte", record.questionText, ruleSuggestion, datasetSuggestion);
      return {
        confidence: 0,
        rejectedReason: "rules e dataset divergono sotto soglia forte",
        recordIndex: record.index
      };
    }

    var ordered = [ruleSuggestion, localSuggestion, datasetSuggestion].filter(Boolean).sort(function (a, b) {
      function priority(suggestion) {
        if (suggestion.explicitAnswer) {
          return 100;
        }
        if (suggestion.source === "rules") {
          return 80;
        }
        if (suggestion.source === "personalData") {
          return 75;
        }
        if (suggestion.source === "local" && suggestion.answerKind === "correct") {
          return 70;
        }
        if (suggestion.source === "dataset" && suggestion.answerKind === "correct") {
          return 60;
        }
        if (suggestion.answerKind === "lastSelected") {
          return 30;
        }
        if (suggestion.answerKind === "candidate") {
          return 20;
        }
        return 10;
      }
      return (priority(b) + (b.confidence || 0)) - (priority(a) + (a.confidence || 0));
    });
    var single = ordered[0];
    if (!single || !single.answerText) {
      return {
        confidence: 0,
        rejectedReason: single && single.rejectedReason ? single.rejectedReason : "nessun suggerimento",
        recordIndex: record.index
      };
    }
    if (single.confidence < threshold) {
      return Object.assign({}, single, {
        rejectedReason: "confidence sotto soglia",
        recordIndex: record.index
      });
    }
    if ((single.answerKind === "lastSelected" || single.answerKind === "candidate") && ruleSuggestion && ruleSuggestion.confidence >= threshold) {
      return Object.assign({}, ruleSuggestion, {
        recordIndex: record.index,
        reason: (ruleSuggestion.reason || "regola") + " / fallback debole ignorato"
      });
    }
    return Object.assign({}, single, {
      recordIndex: record.index
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

  function createCombinedIndex() {
    var rows = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var index = arguments[i];
      if (index && Array.isArray(index.rows)) {
        rows = rows.concat(index.rows);
      } else if (Array.isArray(index)) {
        rows = rows.concat(index);
      }
    }

    var combined = {
      byHash: new Map(),
      byNormalizedQuestion: new Map(),
      byCanonicalQuestion: new Map(),
      byFirstTokens: new Map(),
      byKeyword: new Map(),
      bySignature: new Map(),
      byNumbers: new Map(),
      byUrls: new Map(),
      rows: rows,
      allRows: rows
    };

    rows.forEach(function (item) {
      addToMapList(combined.byHash, item.hash, item);
      addToMapList(combined.byHash, item.stableHash, item);
      addToMapList(combined.byNormalizedQuestion, item.normalizedQuestion, item);
      addToMapList(combined.byCanonicalQuestion, item.canonicalQuestion || canonicalQuestionText(item.questionText), item);
      firstTokensForText(item.canonicalQuestion || item.normalizedQuestion || item.questionText).forEach(function (token) {
        addToMapList(combined.byFirstTokens, token, item);
      });
      tokenize(item.canonicalQuestion || item.normalizedQuestion || item.questionText).filter(function (token) { return token.length >= 5; }).slice(0, 12).forEach(function (token) {
        addToMapList(combined.byKeyword, token, item);
      });
      var signature = (GH.DatasetLoader && GH.DatasetLoader.signatureForText)
        ? GH.DatasetLoader.signatureForText(item.canonicalQuestion || item.normalizedQuestion || item.questionText)
        : firstTokensForText(item.canonicalQuestion || item.normalizedQuestion || item.questionText).join("|");
      addToMapList(combined.bySignature, signature, item);
      extractNumbers(item.questionText).forEach(function (number) {
        addToMapList(combined.byNumbers, number, item);
      });
      extractUrls(item.questionText).forEach(function (url) {
        addToMapList(combined.byUrls, url, item);
      });
    });
    return combined;
  }

  function setDatasetIndex(index) {
    activeIndex = index || activeIndex;
  }

  GH.Matcher = {
    normalizeText: normalizeText,
    normalizeQuestion: normalizeQuestion,
    normalizeAnswer: normalizeAnswer,
    canonicalAnswerKey: canonicalAnswerKey,
    tokenize: tokenize,
    jaccardSimilarity: jaccardSimilarity,
    trigramSimilarity: trigramSimilarity,
    extractUrls: extractUrls,
    extractNumbers: extractNumbers,
    extractCodes: extractCodes,
    scoreAnswerPresenceInCurrentOptions: scoreAnswerPresenceInCurrentOptions,
    getRuleSuggestion: getRuleSuggestion,
    getDatasetSuggestion: getDatasetSuggestion,
    getLocalMemorySuggestion: getLocalMemorySuggestion,
    isDatasetItemUsableForRecord: isDatasetItemUsableForRecord,
    getDatasetAnswerCandidate: getDatasetAnswerCandidate,
    findDatasetCandidates: findDatasetCandidates,
    scoreCandidate: scoreCandidate,
    getBestDatasetMatch: getBestDatasetMatch,
    match: match,
    combineSuggestions: combineSuggestions,
    combine: combineSuggestions,
    setDatasetIndex: setDatasetIndex,
    createCombinedIndex: createCombinedIndex,
    scoreAnswerToOption: scoreAnswerToOption,
    splitAnswerText: splitAnswerText,
    answersSimilarity: answersSimilarity,
    normalizeUrl: normalizeUrl
  };
})();
