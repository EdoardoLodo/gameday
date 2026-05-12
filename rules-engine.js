(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var utils = GH.Utils || {};

  var NUMBER_WORDS = {
    zero: 0,
    uno: 1,
    una: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10
  };

  function normalizeText(text) {
    return utils.normalizeText ? utils.normalizeText(text) : String(text || "").toLowerCase().trim();
  }

  function compactText(text) {
    return utils.compactText ? utils.compactText(text) : String(text || "").replace(/\s+/g, " ").trim();
  }

  function isChoiceRecord(record) {
    var types = record.inputTypes || [];
    return types.indexOf("radio") !== -1 || types.indexOf("checkbox") !== -1 || types.indexOf("select") !== -1;
  }

  function isTextRecord(record) {
    return !isChoiceRecord(record);
  }

  function splitAnswerText(text) {
    return GH.Matcher && GH.Matcher.splitAnswerText ? GH.Matcher.splitAnswerText(text) : (utils.splitStoredList ? utils.splitStoredList(text) : [String(text || "").trim()].filter(Boolean));
  }

  function scoreAnswerToOption(answer, option) {
    return GH.Matcher && GH.Matcher.scoreAnswerToOption ? GH.Matcher.scoreAnswerToOption(answer, option) : (normalizeText(answer) === normalizeText(option) ? 1 : 0);
  }

  function optionPresence(record, answerText) {
    if (GH.Matcher && GH.Matcher.scoreAnswerPresenceInCurrentOptions) {
      return GH.Matcher.scoreAnswerPresenceInCurrentOptions(record, answerText);
    }
    return { score: 0, targetOptions: [], ambiguous: false };
  }

  function compatibleSuggestion(record, answerText, confidence, reason, meta) {
    var answer = compactText(answerText);
    meta = meta || {};
    if (!answer) {
      return null;
    }

    if (isChoiceRecord(record)) {
      var presence = optionPresence(record, answer);
      var requiredScore = meta.explicitAnswer ? 0.78 : 0.88;
      if (presence.score >= requiredScore && !presence.ambiguous) {
        return {
          source: "rules",
          answerText: answer,
          answerTexts: splitAnswerText(answer),
          confidence: Math.min(0.99, confidence),
          reason: reason + " / opzione presente",
          targetOptions: presence.targetOptions,
          answerSetCertain: confidence >= (config.strongConfidenceThreshold || 0.88),
          explicitAnswer: !!meta.explicitAnswer,
          explicitAnswerText: meta.explicitAnswerText || answer,
          explicitRawText: meta.explicitRawText || ""
        };
      }
      return {
        source: "rules",
        answerText: answer,
        confidence: 0,
        reason: reason,
        rejectedReason: presence.ambiguous ? "opzione ambigua" : "risposta regola assente dalle opzioni"
      };
    }

    if (isTextRecord(record)) {
      return {
        source: "rules",
        answerText: answer,
        answerTexts: [answer],
        confidence: Math.min(0.99, confidence),
        reason: reason,
        explicitAnswer: !!meta.explicitAnswer,
        explicitAnswerText: meta.explicitAnswerText || answer,
        explicitRawText: meta.explicitRawText || "",
        textAnswerHint: true,
        textHighlightOnly: !!meta.explicitAnswer
      };
    }

    return null;
  }

  function isExampleHint(text, forcedByKeyword) {
    var normalized = normalizeText(text);
    if (forcedByKeyword) {
      return false;
    }
    return /^(es|esempio|ad esempio|formato|formato:|es:|esempio:)\b/.test(normalized) ||
      /\bformato\s+(gg|aaaa|mm|dd)/.test(normalized);
  }

  function cleanExplicitCandidate(value) {
    return compactText(String(value || "")
      .replace(/^(risposta|soluzione|valore corretto|ovvero|cioe|cioè)\s*[:\-]?\s*/i, "")
      .replace(/[?.!,;:]+$/g, ""));
  }

  cleanExplicitCandidate = function (value) {
    var cleaned = compactText(String(value || ""));
    var previous;
    do {
      previous = cleaned;
      if (cleaned.charAt(0) === "(" && cleaned.charAt(cleaned.length - 1) === ")") {
        cleaned = compactText(cleaned.slice(1, -1));
      }
      if ((cleaned.charAt(0) === "\"" && cleaned.charAt(cleaned.length - 1) === "\"") ||
          (cleaned.charAt(0) === "'" && cleaned.charAt(cleaned.length - 1) === "'") ||
          (cleaned.charAt(0) === "\u201c" && cleaned.charAt(cleaned.length - 1) === "\u201d") ||
          (cleaned.charAt(0) === "\u2018" && cleaned.charAt(cleaned.length - 1) === "\u2019")) {
        cleaned = compactText(cleaned.slice(1, -1));
      }
      cleaned = compactText(cleaned.replace(/^[\-\u2013\u2014]+\s*([\s\S]*?)\s*[\-\u2013\u2014]+$/, "$1"));
      cleaned = compactText(cleaned.replace(/^(?:(?:risposta|soluzione|valore corretto)\s*:\s*|(?:ovvero|cioe|cio\u00e8)\s*:?\s+)/i, ""));
    } while (cleaned && cleaned !== previous);
    return cleaned;
  };

  // Verification cases:
  // cleanExplicitCandidate("(otto)") === "otto"
  // cleanExplicitCandidate("'otto'") === "otto"
  // cleanExplicitCandidate('"otto"') === "otto"
  // cleanExplicitCandidate("- otto -") === "otto"
  // cleanExplicitCandidate("(risposta: 8)") === "8"
  // cleanExplicitCandidate("(ovvero AZIENDA DI ESEMPIO S.R.L.)") === "AZIENDA DI ESEMPIO S.R.L."
  // cleanExplicitCandidate("(19/06/2026)") === "19/06/2026"
  // cleanExplicitCandidate("(https://www.ggl.cm)") === "https://www.ggl.cm"

  function addExplicitCandidate(candidates, value, source, forced, rawText) {
    var raw = compactText(rawText == null ? value : rawText);
    var cleaned = cleanExplicitCandidate(value);
    if (!cleaned || isExampleHint(value, !!forced)) {
      return;
    }
    candidates.push({
      raw: raw,
      value: cleaned,
      source: source
    });
  }

  function bestExplicitCandidateForRecord(record, candidates) {
    if (!candidates.length) {
      return null;
    }
    if (!isChoiceRecord(record)) {
      return candidates[candidates.length - 1];
    }
    var ranked = candidates.map(function (candidate) {
      var presence = optionPresence(record, candidate.value);
      return {
        candidate: candidate,
        score: presence.score,
        ambiguous: presence.ambiguous
      };
    }).filter(function (entry) {
      return !entry.ambiguous;
    }).sort(function (a, b) {
      return b.score - a.score;
    });
    return ranked.length && ranked[0].score >= 0.78 ? ranked[0].candidate : candidates[candidates.length - 1];
  }

  function extractExplicitAnswerFromQuestion(record) {
    var text = record.questionText || "";
    var normalized = normalizeText(text);
    var candidates = [];
    var match;

    var parenRegex = /\(([^()]{2,100})\)/g;
    while ((match = parenRegex.exec(text))) {
      var raw = compactText(match[1]);
      var forced = /\b(risposta|soluzione|valore corretto|ovvero|cioe|cioè)\b/i.test(raw);
      if (!isExampleHint(raw, forced)) {
        candidates.push({
          value: cleanExplicitCandidate(raw),
          source: "parentesi"
        });
      }
    }

    var quoteRegex = /["'“”‘’]([^"'“”‘’]{2,100})["'“”‘’]/g;
    while ((match = quoteRegex.exec(text))) {
      candidates.push({
        value: cleanExplicitCandidate(match[1]),
        source: "virgolette"
      });
    }

    var dashMatch = text.match(/\s-\s([^-]{2,80})\s-\s?/);
    if (dashMatch) {
      candidates.push({
        value: cleanExplicitCandidate(dashMatch[1]),
        source: "trattini"
      });
    }

    var keywordRegexes = [
      /\bovvero\s+["']?([^"'?.;,\n]{2,80})["']?/i,
      /\bcio[eè]\s+["']?([^"'?.;,\n]{2,80})["']?/i,
      /\brisposta\s*:\s*([^?.;,\n]{2,100})/i,
      /\bvalore corretto\s*:\s*([^?.;,\n]{2,100})/i,
      /\bsoluzione\s*:\s*([^?.;,\n]{2,100})/i
    ];
    keywordRegexes = [
      /\bovvero\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,120})["'\u201c\u201d\u2018\u2019]?/i,
      /\bcio[e\u00e8]\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,120})["'\u201c\u201d\u2018\u2019]?/i,
      /\brisposta\s*:\s*([^"',;\n()]{2,120})/i,
      /\bvalore corretto\s*:\s*([^"',;\n()]{2,120})/i,
      /\bsoluzione\s*:\s*([^"',;\n()]{2,120})/i
    ];
    keywordRegexes.forEach(function (regex) {
      var keywordMatch = text.match(regex);
      if (keywordMatch) {
        candidates.push({
          value: cleanExplicitCandidate(keywordMatch[1]),
          source: "keyword"
        });
      }
    });

    candidates = candidates.filter(function (candidate) {
      if (!candidate.value) {
        return false;
      }
      var value = normalizeText(candidate.value);
      if (value.length < 2) {
        return false;
      }
      if (/^(gg[\/-]mm[\/-]aaaa|dd[\/-]mm[\/-]yyyy|gg[\/-]mm|dd[\/-]mm|03[\/-]06[\/-]2026|123456789j)$/.test(value) && candidate.source !== "keyword") {
        return false;
      }
      return normalized.indexOf(value) !== -1 || candidate.source === "keyword";
    });

    if (!candidates.length) {
      return null;
    }

    var best = candidates[candidates.length - 1];
    var suggestion = compatibleSuggestion(record, best.value, 0.97, "risposta esplicita nella domanda (" + best.source + ")", {
      explicitAnswer: true,
      explicitAnswerText: best.value
    });
    if (suggestion && suggestion.confidence > 0) {
      return suggestion;
    }
    return suggestion;
  }

  function explicitSearchText(record) {
    var text = record.questionText || "";
    if (record && record.container && containerLooksScoped(record)) {
      var containerText = compactText(record.container.innerText || record.container.textContent || "");
      if (containerText && containerText.indexOf(text) === -1) {
        text = compactText(text + " " + containerText);
      }
    }
    return text;
  }

  function containerLooksScoped(record) {
    if (!record || !record.container || !record.container.querySelectorAll) {
      return false;
    }
    var controls = record.controls || [];
    var count = record.container.querySelectorAll("input, select, textarea").length;
    return count <= Math.max(controls.length + 2, 3);
  }

  extractExplicitAnswerFromQuestion = function (record) {
    var text = explicitSearchText(record);
    var normalized = normalizeText(text);
    var candidates = [];
    var match;

    var parenRegex = /\(([^()]{2,100})\)/g;
    while ((match = parenRegex.exec(text))) {
      var raw = compactText(match[1]);
      addExplicitCandidate(candidates, raw, "parentesi", /\b(risposta|soluzione|valore corretto|ovvero|cioe|cioè)\b/i.test(raw));
    }

    var quoteRegex = /["'“”‘’]([^"'“”‘’]{2,100})["'“”‘’]/g;
    while ((match = quoteRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "virgolette", true);
    }

    var dashRegex = /(?:^|\s)[\-–—]\s*([^\-–—]{2,80}?)\s*[\-–—](?:\s|$)/g;
    while ((match = dashRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "trattini", true);
    }

    var keywordRegexes = [
      /\bovvero\s+["'“”‘’]?([^"'“”‘’?.;,\n()\-–—]{2,80})["'“”‘’]?/i,
      /\bcio[eè]\s+["'“”‘’]?([^"'“”‘’?.;,\n()\-–—]{2,80})["'“”‘’]?/i,
      /\brisposta\s*:\s*([^?.;,\n()\-–—]{2,100})/i,
      /\bvalore corretto\s*:\s*([^?.;,\n()\-–—]{2,100})/i,
      /\bsoluzione\s*:\s*([^?.;,\n()\-–—]{2,100})/i
    ];
    keywordRegexes.forEach(function (regex) {
      var keywordMatch = text.match(regex);
      if (keywordMatch) {
        addExplicitCandidate(candidates, keywordMatch[1], "keyword", true);
      }
    });

    candidates = candidates.filter(function (candidate) {
      if (!candidate.value) {
        return false;
      }
      var value = normalizeText(candidate.value);
      if (value.length < 2) {
        return false;
      }
      if (/^(gg[\/-]mm[\/-]aaaa|dd[\/-]mm[\/-]yyyy|gg[\/-]mm|dd[\/-]mm|03[\/-]06[\/-]2026|123456789j)$/.test(value) && candidate.source !== "keyword") {
        return false;
      }
      return normalized.indexOf(value) !== -1 || candidate.source === "keyword" || candidate.source === "trattini";
    });

    var best = bestExplicitCandidateForRecord(record, candidates);
    if (!best) {
      return null;
    }
    return compatibleSuggestion(record, best.value, 0.97, "risposta esplicita nella domanda (" + best.source + ")", {
      explicitAnswer: true,
      explicitAnswerText: best.value
    });
  };

  function getCleanContainerText(container, record) {
    if (!container) {
      return "";
    }
    var explicitConfig = config.explicitAnswerDetection || {};
    var maxLength = explicitConfig.maxContainerTextLength || 2500;
    var clone = container.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll("input, select, textarea, button, option, script, style")).forEach(function (node) {
      node.remove();
    });

    var optionKeys = new Set((record.options || []).map(function (option) {
      return normalizeText(option);
    }).filter(Boolean));

    Array.prototype.slice.call(clone.querySelectorAll("label")).forEach(function (label) {
      var text = normalizeText(label.textContent || "");
      if (optionKeys.has(text)) {
        label.remove();
      }
    });

    var text = compactText(clone.innerText || clone.textContent || "");
    (record.options || []).forEach(function (option) {
      var optionText = compactText(option);
      if (!optionText) {
        return;
      }
      var escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = compactText(text.replace(new RegExp("(^|\\s)" + escaped + "(?=\\s|$)", "g"), " "));
    });
    return text.slice(0, maxLength);
  }

  function getExplicitSearchTexts(record) {
    var explicitConfig = config.explicitAnswerDetection || {};
    var texts = [];
    function add(text) {
      text = compactText(text);
      if (text && texts.indexOf(text) === -1) {
        texts.push(text);
      }
    }
    add(record.questionText || "");
    add(record.canonicalQuestion || "");
    add(record.normalizedQuestion || "");
    if (explicitConfig.searchContainerText !== false && containerLooksScoped(record)) {
      add(getCleanContainerText(record.container, record));
    }
    return texts;
  }

  function looksLikeForbiddenHint(value, forcedByKeyword) {
    if (forcedByKeyword) {
      return false;
    }
    var normalized = normalizeText(value);
    return /^(es|esempio|ad esempio|formato|facoltativo|obbligatorio|opzionale)\b/.test(normalized) ||
      /\bformato\s*:?\s*(gg|aaaa|mm|dd)/.test(normalized);
  }

  function collectExplicitCandidatesFromText(text) {
    var candidates = [];
    var match;

    function add(value, source, forced, rawText) {
      var raw = compactText(rawText == null ? value : rawText);
      var cleaned = cleanExplicitCandidate(value);
      if (!cleaned || looksLikeForbiddenHint(value, !!forced)) {
        return;
      }
      candidates.push({
        raw: raw,
        value: cleaned,
        source: source
      });
    }

    var parenRegex = /\(([^()]{1,160})\)/g;
    while ((match = parenRegex.exec(text))) {
      add(match[1], "parentesi", /\b(risposta|soluzione|valore corretto|ovvero|cioe|cio\u00e8)\b/i.test(match[1]), match[0]);
    }

    var quoteRegex = /["'\u201c\u201d\u2018\u2019]([^"'\u201c\u201d\u2018\u2019]{1,160})["'\u201c\u201d\u2018\u2019]/g;
    while ((match = quoteRegex.exec(text))) {
      add(match[1], "virgolette", true, match[0]);
    }

    var dashRegex = /(?:^|\s)([\-\u2013\u2014]\s*[^\-\u2013\u2014]{1,120}?\s*[\-\u2013\u2014])(?:\s|$)/g;
    while ((match = dashRegex.exec(text))) {
      add(match[1], "trattini", true, match[1]);
    }

    [
      /\bovvero\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,140})["'\u201c\u201d\u2018\u2019]?/i,
      /\bcio[e\u00e8]\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,140})["'\u201c\u201d\u2018\u2019]?/i,
      /\brisposta\s*:\s*([^"',;\n()]{1,140})/i,
      /\bvalore corretto\s*:\s*([^"',;\n()]{1,140})/i,
      /\bsoluzione\s*:\s*([^"',;\n()]{1,140})/i
    ].forEach(function (regex) {
      var keywordMatch = text.match(regex);
      if (keywordMatch) {
        add(keywordMatch[1], "keyword", true, keywordMatch[0]);
      }
    });

    if ((config.explicitAnswerDetection || {}).treatColonValueAsExplicit !== false) {
      var colonMatches = text.match(/:\s*([^"',;\n()]{1,160})/g) || [];
      colonMatches.forEach(function (raw) {
        var value = raw.replace(/^:\s*/, "");
        add(value, "dopo due punti", false, raw);
      });
    }

    return candidates.filter(function (candidate) {
      var value = normalizeText(candidate.value);
      return value && value.length >= 1 && !looksLikeForbiddenHint(candidate.value, candidate.source === "keyword");
    });
  }

  function analyzeExplicitAnswer(record) {
    var searchTexts = getExplicitSearchTexts(record);
    var candidates = [];
    searchTexts.forEach(function (text) {
      collectExplicitCandidatesFromText(text).forEach(function (candidate) {
        if (!candidates.some(function (existing) {
          return normalizeText(existing.value) === normalizeText(candidate.value) && existing.source === candidate.source;
        })) {
          candidates.push(candidate);
        }
      });
    });

    var best = bestExplicitCandidateForRecord(record, candidates);
    if (!best) {
      return {
        searchTexts: searchTexts,
        candidates: candidates,
        chosen: null,
        rejectedReason: candidates.length ? "nessun candidato matcha le opzioni correnti" : "nessun candidato esplicito"
      };
    }

    var suggestion = compatibleSuggestion(record, best.value, 0.99, "risposta esplicita nella domanda (" + best.source + ")", {
      explicitAnswer: true,
      explicitAnswerText: best.value,
      explicitRawText: best.raw
    });

    if (suggestion && suggestion.confidence > 0) {
      suggestion.currentPageLiteral = true;
    }

    return {
      searchTexts: searchTexts,
      candidates: candidates,
      chosen: suggestion,
      rejectedReason: suggestion && suggestion.rejectedReason ? suggestion.rejectedReason : ""
    };
  }

  extractExplicitAnswerFromQuestion = function (record) {
    if ((config.explicitAnswerDetection || {}).enabled === false) {
      return null;
    }
    var details = analyzeExplicitAnswer(record);
    return details.chosen && details.chosen.confidence > 0 ? details.chosen : null;
  };

  extractExplicitAnswerFromQuestion = function (record) {
    var text = explicitSearchText(record);
    var normalized = normalizeText(text);
    var candidates = [];
    var match;

    var parenRegex = /\(([^()]{1,120})\)/g;
    while ((match = parenRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "parentesi", /\b(risposta|soluzione|valore corretto|ovvero|cioe|cio\u00e8)\b/i.test(match[1]), match[0]);
    }

    var quoteRegex = /["'\u201c\u201d\u2018\u2019]([^"'\u201c\u201d\u2018\u2019]{1,120})["'\u201c\u201d\u2018\u2019]/g;
    while ((match = quoteRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "virgolette", true, match[0]);
    }

    var dashRegex = /(?:^|\s)[\-\u2013\u2014]\s*([^\-\u2013\u2014]{2,100}?)\s*[\-\u2013\u2014](?:\s|$)/g;
    while ((match = dashRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "trattini", true, match[0]);
    }

    var keywordRegexes = [
      /\bovvero\s+["'\u201c\u201d\u2018\u2019]?([^"'\u201c\u201d\u2018\u2019?.;,\n()\-–—]{2,100})["'\u201c\u201d\u2018\u2019]?/i,
      /\bcio[e\u00e8]\s+["'\u201c\u201d\u2018\u2019]?([^"'\u201c\u201d\u2018\u2019?.;,\n()\-–—]{2,100})["'\u201c\u201d\u2018\u2019]?/i,
      /\brisposta\s*:\s*([^?.;,\n()\-–—]{2,120})/i,
      /\bvalore corretto\s*:\s*([^?.;,\n()\-–—]{2,120})/i,
      /\bsoluzione\s*:\s*([^?.;,\n()\-–—]{2,120})/i
    ];
    keywordRegexes.forEach(function (regex) {
      var keywordMatch = text.match(regex);
      if (keywordMatch) {
        addExplicitCandidate(candidates, keywordMatch[1], "keyword", true, keywordMatch[0]);
      }
    });

    var colonMatch = text.match(/:\s*([^?.;,\n()\-–—]{2,120})/);
    if (colonMatch) {
      addExplicitCandidate(candidates, colonMatch[1], "dopo due punti", false, colonMatch[0]);
    }

    candidates = candidates.filter(function (candidate) {
      if (!candidate.value) {
        return false;
      }
      var value = normalizeText(candidate.value);
      if (value.length < 2) {
        return false;
      }
      if (/^(gg[\/-]mm[\/-]aaaa|dd[\/-]mm[\/-]yyyy|gg[\/-]mm|dd[\/-]mm|03[\/-]06[\/-]2026|123456789j)$/.test(value) && candidate.source !== "keyword") {
        return false;
      }
      return normalized.indexOf(value) !== -1 || candidate.source === "keyword" || candidate.source === "trattini" || candidate.source === "dopo due punti";
    });

    var best = bestExplicitCandidateForRecord(record, candidates);
    if (!best) {
      return null;
    }
    return compatibleSuggestion(record, best.value, 0.98, "risposta esplicita nella domanda (" + best.source + ")", {
      explicitAnswer: true,
      explicitAnswerText: best.value,
      explicitRawText: best.raw
    });
  };

  extractExplicitAnswerFromQuestion = function (record) {
    var text = explicitSearchText(record);
    var normalized = normalizeText(text);
    var candidates = [];
    var match;

    function hasContainingRaw(raw) {
      raw = compactText(raw);
      return candidates.some(function (candidate) {
        return candidate.raw && candidate.raw !== raw && candidate.raw.indexOf(raw) !== -1;
      });
    }

    var parenRegex = /\(([^()]{1,120})\)/g;
    while ((match = parenRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "parentesi", /\b(risposta|soluzione|valore corretto|ovvero|cioe|cio\u00e8)\b/i.test(match[1]), match[0]);
    }

    var quoteRegex = /["'\u201c\u201d\u2018\u2019]([^"'\u201c\u201d\u2018\u2019]{1,120})["'\u201c\u201d\u2018\u2019]/g;
    while ((match = quoteRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "virgolette", true, match[0]);
    }

    var dashRegex = /(?:^|\s)([\-\u2013\u2014]\s*[^\-\u2013\u2014]{1,100}?\s*[\-\u2013\u2014])(?:\s|$)/g;
    while ((match = dashRegex.exec(text))) {
      addExplicitCandidate(candidates, match[1], "trattini", true, match[1]);
    }

    [
      /\bovvero\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,120})["'\u201c\u201d\u2018\u2019]?/i,
      /\bcio[e\u00e8]\s+["'\u201c\u201d\u2018\u2019]?([^"',;\n()]{1,120})["'\u201c\u201d\u2018\u2019]?/i,
      /\brisposta\s*:\s*([^"',;\n()]{1,120})/i,
      /\bvalore corretto\s*:\s*([^"',;\n()]{1,120})/i,
      /\bsoluzione\s*:\s*([^"',;\n()]{1,120})/i
    ].forEach(function (regex) {
      var keywordMatch = text.match(regex);
      if (keywordMatch && !hasContainingRaw(keywordMatch[0])) {
        addExplicitCandidate(candidates, keywordMatch[1], "keyword", true, keywordMatch[0]);
      }
    });

    var colonMatch = text.match(/:\s+([^"',;\n()]{2,120})/);
    if (colonMatch && !hasContainingRaw(colonMatch[0])) {
      addExplicitCandidate(candidates, colonMatch[1], "dopo due punti", false, colonMatch[0]);
    }

    candidates = candidates.filter(function (candidate) {
      if (!candidate.value) {
        return false;
      }
      var value = normalizeText(candidate.value);
      if (value.length < 1) {
        return false;
      }
      if (/^(gg[\/-]mm[\/-]aaaa|dd[\/-]mm[\/-]yyyy|gg[\/-]mm|dd[\/-]mm|03[\/-]06[\/-]2026|123456789j)$/.test(value) && candidate.source !== "keyword") {
        return false;
      }
      return normalized.indexOf(value) !== -1 || candidate.source === "keyword" || candidate.source === "trattini" || candidate.source === "dopo due punti";
    });

    var best = bestExplicitCandidateForRecord(record, candidates);
    if (!best) {
      return null;
    }
    return compatibleSuggestion(record, best.value, 0.98, "risposta esplicita nella domanda (" + best.source + ")", {
      explicitAnswer: true,
      explicitAnswerText: best.value,
      explicitRawText: best.raw
    });
  };

  extractExplicitAnswerFromQuestion = function (record) {
    if ((config.explicitAnswerDetection || {}).enabled === false) {
      return null;
    }
    var details = analyzeExplicitAnswer(record);
    return details.chosen && details.chosen.confidence > 0 ? details.chosen : null;
  };

  function extractUrls(text) {
    return String(text || "").match(/\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi) || [];
  }

  function extractCodes(text) {
    return GH.Matcher && GH.Matcher.extractCodes ? GH.Matcher.extractCodes(text) : (String(text || "").match(/[+@#]?[a-zA-Z0-9][a-zA-Z0-9._-]{3,}/g) || []);
  }

  function knownSiteTarget(text) {
    var normalized = normalizeText(text);
    var sites = config.knownSites || {};
    var names = Object.keys(sites);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (new RegExp("\\b" + name + "\\b").test(normalized) && /\bsito|indirizzo|url|web|pagina|portale\b/.test(normalized)) {
        return sites[name];
      }
    }
    return "";
  }

  function extractQuoted(text) {
    var out = [];
    var regex = /["\u201c\u201d]([^"\u201c\u201d]{1,160})["\u201c\u201d]|(?:^|[^\p{L}\p{N}])['\u2018\u2019]([^'\u2018\u2019]{1,160})['\u2018\u2019](?=$|[^\p{L}\p{N}])/gu;
    var match;
    while ((match = regex.exec(text))) {
      out.push(compactText(match[1] || match[2]));
    }
    return out;
  }

  function extractTarget(record, kind) {
    var text = explicitSearchText(record);
    var site = knownSiteTarget(text);
    if (site) {
      return site;
    }

    var urls = extractUrls(text);
    if (urls.length && (kind === "url" || kind === "domain" || /url|sito|indirizzo|web|pagina|portale/.test(normalizeText(text)))) {
      return urls[0].replace(/[.,;:!?]+$/, "");
    }

    var namedQuoted = text.match(/\b(?:scritta|stringa|parola|testo|codice|url|sito|indirizzo|di)\s+["'\u201c\u201d\u2018\u2019]([^"'\u201c\u201d\u2018\u2019]{1,160})["'\u201c\u201d\u2018\u2019]/i);
    if (namedQuoted) {
      return compactText(namedQuoted[1]);
    }

    var quoted = extractQuoted(text);
    if (quoted.length) {
      return quoted[quoted.length - 1];
    }

    var wordAfterKeyword = text.match(/\b(?:parola|nome|stringa|testo|codice)\s+([a-zA-Z0-9+@#._-]{1,80})\b/i);
    if (wordAfterKeyword && !/^(senza|con|non|considerando|ignorando|partendo)$/i.test(wordAfterKeyword[1])) {
      return wordAfterKeyword[1];
    }

    var codes = extractCodes(text).filter(function (code) {
      return !/^(indicare|inserire|seleziona|selezionare|codice|identificativo|caratteri|lettere|primi|ultimi|senza|vocali|consonanti)$/.test(normalizeText(code));
    });
    if (codes.length) {
      return codes[codes.length - 1].replace(/[.,;:!?]+$/, "");
    }

    var afterColon = text.split(":").slice(1).join(":");
    if (afterColon) {
      afterColon = compactText(afterColon.replace(/[?!.]+$/, ""));
      if (afterColon && afterColon.length <= 80) {
        return afterColon;
      }
    }

    return "";
  }

  function removeVowels(text) {
    return String(text || "").replace(/[aeiouAEIOU\u00e0\u00e8\u00e9\u00ec\u00f2\u00f3\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d3\u00d9]/g, "");
  }

  function onlyVowels(text) {
    return (String(text || "").match(/[aeiouAEIOU\u00e0\u00e8\u00e9\u00ec\u00f2\u00f3\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d3\u00d9]/g) || []).join("");
  }

  function missingVowels(text) {
    var normalized = normalizeText(text);
    var present = new Set((normalized.match(/[aeiou]/g) || []));
    return ["a", "e", "i", "o", "u"].filter(function (vowel) {
      return !present.has(vowel);
    }).map(function (vowel) {
      return vowel.toUpperCase();
    }).join(" & ");
  }

  function reverseString(text) {
    return Array.from(String(text || "")).reverse().join("");
  }

  function wordInitials(text) {
    return String(text || "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(function (word) { return word.charAt(0).toUpperCase(); })
      .join("-");
  }

  function parseN(text) {
    var normalized = normalizeText(text);
    var digitMatch = normalized.match(/\b(?:primi|prime|ultimi|ultime|iniziali|finali|caratteri iniziali|caratteri finali)\s+(\d{1,2})\b/);
    if (digitMatch) {
      return Number(digitMatch[1]);
    }
    var wordMatch = normalized.match(/\b(?:primi|prime|ultimi|ultime|iniziali|finali|caratteri iniziali|caratteri finali)\s+(uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b/);
    if (wordMatch) {
      return NUMBER_WORDS[wordMatch[1]];
    }
    var trailing = normalized.match(/\b(\d{1,2}|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+caratteri\b/);
    if (trailing) {
      return NUMBER_WORDS[trailing[1]] || Number(trailing[1]);
    }
    var leading = normalized.match(/\b(\d{1,2}|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(?:caratteri|lettere|iniziali)\b/);
    if (leading) {
      return NUMBER_WORDS[leading[1]] || Number(leading[1]);
    }
    return null;
  }

  function charsByHumanParity(text, wantEven) {
    return Array.from(String(text || "")).filter(function (_ch, index) {
      var humanPosition = index + 1;
      return wantEven ? humanPosition % 2 === 0 : humanPosition % 2 === 1;
    }).join("");
  }

  function extractDomain(url) {
    try {
      var raw = /^https?:\/\//i.test(url) ? url : "https://" + url;
      return new URL(raw).hostname.replace(/^www\./i, "");
    } catch (error) {
      return "";
    }
  }

  function withoutSymbols(text) {
    return String(text || "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  }

  function withoutSpaces(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function tokenizeMathExpression(expression) {
    var clean = String(expression || "").replace(/,/g, ".").replace(/[xX\u00d7]/g, "*");
    if (!/^[\d+\-*/().\s]+$/.test(clean)) {
      return null;
    }
    var tokens = clean.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    return tokens && tokens.join("").replace(/\s+/g, "") === clean.replace(/\s+/g, "") ? tokens : null;
  }

  function safeMathEval(expression) {
    var tokens = tokenizeMathExpression(expression);
    if (!tokens || !tokens.length || tokens.indexOf("(") !== -1 || tokens.indexOf(")") !== -1) {
      return null;
    }
    var values = [];
    var ops = [];
    var expectNumber = true;
    tokens.forEach(function (token) {
      if (/^\d/.test(token)) {
        values.push(Number(token));
        expectNumber = false;
      } else if ("+-*/".indexOf(token) !== -1) {
        if (expectNumber) {
          values.push(0);
        }
        ops.push(token);
        expectNumber = true;
      }
    });
    if (!values.length || values.length !== ops.length + 1) {
      return null;
    }
    for (var i = 0; i < ops.length; i += 1) {
      if (ops[i] === "*" || ops[i] === "/") {
        if (ops[i] === "/" && values[i + 1] === 0) {
          return null;
        }
        var result = ops[i] === "*" ? values[i] * values[i + 1] : values[i] / values[i + 1];
        values.splice(i, 2, result);
        ops.splice(i, 1);
        i -= 1;
      }
    }
    var total = values[0];
    for (var j = 0; j < ops.length; j += 1) {
      total = ops[j] === "+" ? total + values[j + 1] : total - values[j + 1];
    }
    return Number.isFinite(total) ? total : null;
  }

  function formatNumber(number) {
    return Math.abs(number - Math.round(number)) < 0.0000001 ? String(Math.round(number)) : String(Number(number.toFixed(6))).replace(".", ",");
  }

  function solveMathFromOptions(record) {
    if (!(record.options || []).length) {
      return null;
    }
    for (var i = 0; i < record.options.length; i += 1) {
      var option = record.options[i];
      if (option.indexOf("=") !== -1) {
        var parts = option.split("=");
        if (parts.length === 2) {
          var left = safeMathEval(parts[0]);
          var right = safeMathEval(parts[1]);
          if (left !== null && right !== null && Math.abs(left - right) < 0.000001) {
            return compatibleSuggestion(record, option, 0.94, "uguaglianza matematica verificata");
          }
        }
      }
    }
    return null;
  }

  function solveMathFromText(record) {
    var text = record.questionText || "";
    var normalized = normalizeText(text);
    var expressionMatch = text.match(/(-?\d+(?:[.,]\d+)?\s*(?:[+*/xX\u00d7-]\s*-?\d+(?:[.,]\d+)?)+)/);
    if (expressionMatch) {
      var value = safeMathEval(expressionMatch[1]);
      if (value !== null) {
        return compatibleSuggestion(record, formatNumber(value), 0.94, "operazione matematica nella domanda");
      }
    }
    var numbers = (text.match(/-?\d+(?:[.,]\d+)?/g) || []).map(function (item) { return Number(item.replace(",", ".")); }).filter(Number.isFinite);
    if (numbers.length >= 2) {
      var result = null;
      var reason = "";
      if (/somma|addizion/.test(normalized)) {
        result = numbers[0] + numbers[1];
        reason = "somma";
      } else if (/sottrazion|differenza/.test(normalized)) {
        result = numbers[0] - numbers[1];
        reason = "sottrazione";
      } else if (/moltiplicazion|prodotto/.test(normalized)) {
        result = numbers[0] * numbers[1];
        reason = "moltiplicazione";
      } else if (/divisione|dividi|quoziente/.test(normalized) && numbers[1] !== 0) {
        result = numbers[0] / numbers[1];
        reason = "divisione";
      }
      if (result !== null) {
        return compatibleSuggestion(record, formatNumber(result), 0.93, reason + " calcolata");
      }
    }
    return null;
  }

  function normalizeDate(text) {
    var value = compactText(text);
    var match = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (match) {
      var year = match[3].length === 2 ? "20" + match[3] : match[3];
      return ("0" + match[1]).slice(-2) + "-" + ("0" + match[2]).slice(-2) + "-" + year;
    }
    var iso = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return ("0" + iso[3]).slice(-2) + "-" + ("0" + iso[2]).slice(-2) + "-" + iso[1];
    }
    var dayMonth = value.match(/\b(\d{1,2})[\/.-](\d{1,2})\b/);
    if (dayMonth) {
      return ("0" + dayMonth[1]).slice(-2) + "-" + ("0" + dayMonth[2]).slice(-2);
    }
    return "";
  }

  function solveDate(record) {
    if (!/\bdata\b/.test(normalizeText(record.questionText))) {
      return null;
    }
    var date = normalizeDate(record.questionText);
    return date ? compatibleSuggestion(record, date, 0.90, "data presente nella domanda") : null;
  }

  function solveIdentity(record) {
    var text = record.questionText || "";
    var normalized = normalizeText(text);
    if (/email|username/.test(normalized)) {
      var email = (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0];
      if (email) {
        return compatibleSuggestion(record, email, 0.94, "email presente nella domanda");
      }
    }
    if (/cellulare|telefono|tel\b/.test(normalized)) {
      var phone = (text.match(/\b\d{7,15}\b/) || [])[0];
      if (phone) {
        return compatibleSuggestion(record, phone, 0.92, "numero presente nella domanda");
      }
    }
    if (/nome partecipante|cognome nome|nome e cognome/.test(normalized)) {
      var quoted = extractQuoted(text);
      if (quoted.length) {
        return compatibleSuggestion(record, quoted[quoted.length - 1], 0.88, "nome presente nella domanda");
      }
    }
    return null;
  }

  function solveStringRule(record) {
    var text = record.questionText || "";
    var normalized = normalizeText(text);
    var target;
    var answer;
    var n;

    if (/indirizzo del sito|url richiesto|indirizzo sito|indirizzo web|pagina web/.test(normalized) &&
        !/senza vocali|vocali assenti|senza consonanti|al contrario|inverti|inverso|lettere minuscole|in minuscolo|lettere maiuscole|in maiuscolo|senza spazi|non considerando gli spazi|senza simboli|senza punteggiatura|ultim[ie]|prim[ie]|caratteri finali|caratteri iniziali|lettere pari|lettere dispari/.test(normalized)) {
      target = extractTarget(record, "url");
      return target ? compatibleSuggestion(record, target, 0.94, "indirizzo del sito") : null;
    }
    if (/\bdominio\b/.test(normalized)) {
      target = extractTarget(record, "domain");
      answer = extractDomain(target);
      return answer ? compatibleSuggestion(record, answer, 0.94, "dominio estratto da URL") : null;
    }
    if (/vocali assenti|vocali mancanti/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = missingVowels(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.94, "vocali assenti") : null;
    }
    if (/senza vocali/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = removeVowels(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.93, "rimozione vocali") : null;
    }
    if (/consonanti/.test(normalized) && /al contrario|inverti|inverso|ordine inverso/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = reverseString(removeVowels(target));
      return target && answer ? compatibleSuggestion(record, answer, 0.94, "consonanti al contrario") : null;
    }
    if (/senza consonanti/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = onlyVowels(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.92, "solo vocali") : null;
    }
    if (/al contrario|inverti|inverso/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = reverseString(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.92, "stringa invertita") : null;
    }
    if (/lettere minuscole|in minuscolo/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = target.toLowerCase();
      return target && answer ? compatibleSuggestion(record, answer, 0.91, "minuscole") : null;
    }
    if (/lettere maiuscole|in maiuscolo/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = target.toUpperCase();
      return target && answer ? compatibleSuggestion(record, answer, 0.91, "maiuscole") : null;
    }
    if (/senza spazi|non considerando gli spazi|ignorando gli spazi/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = withoutSpaces(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.91, "spazi rimossi") : null;
    }
    if (/senza simboli|senza punteggiatura/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = withoutSymbols(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.90, "simboli rimossi") : null;
    }
    if (/iniziali delle parole|iniziali di queste parole|iniziali delle seguenti parole/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = wordInitials(target);
      return target && answer ? compatibleSuggestion(record, answer, 0.94, "iniziali delle parole") : null;
    }
    if (/(prim[ie].*partendo dalla fine|partendo dalla fine.*prim[ie]|dalla fine.*prim[ie])/.test(normalized)) {
      n = parseN(text);
      target = extractTarget(record, /codice identificativo/.test(normalized) ? "code" : "string");
      answer = n && target ? Array.from(target).reverse().slice(0, n).join("") : "";
      return answer ? compatibleSuggestion(record, answer, 0.94, "primi " + n + " caratteri partendo dalla fine") : null;
    }
    if (/ultim[ie]|caratteri finali/.test(normalized)) {
      n = parseN(text);
      target = extractTarget(record, /codice identificativo/.test(normalized) ? "code" : "string");
      answer = n && target ? Array.from(target).slice(-n).join("") : "";
      return answer ? compatibleSuggestion(record, answer, 0.93, "ultimi " + n + " caratteri") : null;
    }
    if (/prim[ie]|caratteri iniziali|carattere iniziale/.test(normalized)) {
      n = parseN(text) || (/carattere iniziale/.test(normalized) ? 1 : null);
      target = extractTarget(record, /codice identificativo/.test(normalized) ? "code" : "string");
      answer = n && target ? Array.from(target).slice(0, n).join("") : "";
      return answer ? compatibleSuggestion(record, answer, 0.93, "primi " + n + " caratteri") : null;
    }
    if (/lettere pari|posizion[ei] pari|caratteri pari/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = charsByHumanParity(target, true);
      return target && answer ? compatibleSuggestion(record, answer, 0.90, "posizioni pari 1-based") : null;
    }
    if (/lettere dispari|posizion[ei] dispari|caratteri dispari/.test(normalized)) {
      target = extractTarget(record, "string");
      answer = charsByHumanParity(target, false);
      return target && answer ? compatibleSuggestion(record, answer, 0.90, "posizioni dispari 1-based") : null;
    }
    return null;
  }

  function solve(record) {
    if (!record || !record.questionText) {
      return null;
    }

    var normalized = normalizeText(record.questionText);
    var stringSuggestion = null;
    var hasStringTransform = /senza vocali|vocali assenti|vocali mancanti|senza consonanti|al contrario|inverti|inverso|lettere minuscole|in minuscolo|lettere maiuscole|in maiuscolo|senza spazi|non considerando gli spazi|ignorando gli spazi|senza simboli|senza punteggiatura|ultim[ie]|prim[ie]|caratteri finali|caratteri iniziali|carattere iniziale|iniziali delle parole|partendo dalla fine|lettere pari|lettere dispari|\bdominio\b/.test(normalized);
    var dateSuggestion = solveDate(record);
    if (dateSuggestion && dateSuggestion.confidence > 0 && isTextRecord(record) && !hasStringTransform) {
      return dateSuggestion;
    }

    if (hasStringTransform) {
      stringSuggestion = solveStringRule(record);
      if (stringSuggestion && stringSuggestion.confidence > 0) {
        return stringSuggestion;
      }
    }

    var explicit = extractExplicitAnswerFromQuestion(record);
    if (explicit && explicit.confidence > 0) {
      return explicit;
    }

    stringSuggestion = stringSuggestion || solveStringRule(record);
    if (stringSuggestion && stringSuggestion.confidence > 0) {
      return stringSuggestion;
    }

    if (/somma|sottrazion|moltiplicazion|divisione|prodotto|quoziente|addizion|[-+*/xX\u00d7]\s*\d/.test(normalized)) {
      return solveMathFromOptions(record) || solveMathFromText(record);
    }

    return dateSuggestion || solveIdentity(record);
  }

  GH.RulesEngine = {
    solve: solve,
    extractExplicitAnswerFromQuestion: extractExplicitAnswerFromQuestion,
    getExplicitSearchTexts: getExplicitSearchTexts,
    getCleanContainerText: getCleanContainerText,
    debugExplicitAnswer: analyzeExplicitAnswer,
    cleanExplicitCandidate: cleanExplicitCandidate,
    normalizeDate: normalizeDate,
    safeMathEval: safeMathEval,
    removeVowels: removeVowels,
    onlyVowels: onlyVowels,
    reverseString: reverseString,
    parseN: parseN
  };
})();
