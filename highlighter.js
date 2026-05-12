(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var appliedByRecord = new Map();

  function splitAnswerText(text) {
    return GH.Matcher && GH.Matcher.splitAnswerText ? GH.Matcher.splitAnswerText(text) : (GH.Utils && GH.Utils.splitStoredList ? GH.Utils.splitStoredList(text) : [String(text || "").trim()].filter(Boolean));
  }

  function optionText(control) {
    if (GH.Parser && GH.Parser.optionTextForControl) {
      return GH.Parser.optionTextForControl(control);
    }
    return String(control && control.value || "").trim();
  }

  function scoreAnswerToOption(answer, option) {
    return GH.Matcher && GH.Matcher.scoreAnswerToOption ? GH.Matcher.scoreAnswerToOption(answer, option) : (String(answer || "").trim().toLowerCase() === String(option || "").trim().toLowerCase() ? 1 : 0);
  }

  function isTextRecord(record) {
    return GH.Utils && GH.Utils.isTextInputType ? GH.Utils.isTextInputType(record.inputTypes || []) : false;
  }

  function controlKind(record) {
    return (record.inputTypes || [])[0] || "";
  }

  function restoreTitle(element) {
    if (!element || !element.hasAttribute("data-gameday-original-title")) {
      return;
    }
    var original = element.getAttribute("data-gameday-original-title") || "";
    if (original) {
      element.setAttribute("title", original);
    } else {
      element.removeAttribute("title");
    }
    element.removeAttribute("data-gameday-original-title");
    element.removeAttribute("data-gameday-suggestion");
  }

  function unwrapExplicitSpan(span) {
    if (!span || !span.parentNode) {
      return;
    }
    var text = document.createTextNode(span.textContent || "");
    span.parentNode.replaceChild(text, span);
    if (text.parentNode) {
      text.parentNode.normalize();
    }
  }

  function clearPreviousHighlights(root) {
    var scope = root || document;
    Array.prototype.slice.call(scope.querySelectorAll(".gameday-suggested-answer, .gameday-wrong-answer, .gameday-text-answer-field")).forEach(function (element) {
      element.classList.remove("gameday-suggested-answer", "gameday-wrong-answer", "gameday-text-answer-field");
    });
    Array.prototype.slice.call(scope.querySelectorAll(".gameday-explicit-answer")).forEach(unwrapExplicitSpan);
    Array.prototype.slice.call(scope.querySelectorAll(".gameday-text-answer-hint")).forEach(function (element) {
      element.remove();
    });
    Array.prototype.slice.call(scope.querySelectorAll("[data-gameday-original-title], [data-gameday-suggestion]")).forEach(restoreTitle);
    appliedByRecord = new Map();
  }

  function clearElements(elements) {
    (elements || []).forEach(function (entry) {
      var element = entry && entry.element ? entry.element : entry;
      var type = entry && entry.type ? entry.type : "";
      if (!element) {
        return;
      }
      if (type === "explicit") {
        unwrapExplicitSpan(element);
        return;
      }
      if (type === "textHint") {
        element.remove();
        return;
      }
      if (element.classList) {
        element.classList.remove("gameday-suggested-answer", "gameday-wrong-answer", "gameday-text-answer-field");
      }
      restoreTitle(element);
    });
  }

  function decorationElementForControl(control) {
    if (!control) {
      return null;
    }
    var label = GH.Parser && GH.Parser.labelForControl ? GH.Parser.labelForControl(control) : null;
    if (label) {
      return label;
    }
    return control.closest(".form-check, .form-option, .option, .radio, .checkbox") || control.parentElement || control;
  }

  function bestControlForAnswer(record, answer) {
    var scored = (record.controls || []).map(function (control) {
      return {
        control: control,
        text: optionText(control),
        score: scoreAnswerToOption(answer, optionText(control))
      };
    }).sort(function (a, b) {
      return b.score - a.score;
    });
    if (!scored.length || scored[0].score < 0.78) {
      return null;
    }
    if (scored.length > 1) {
      var margin = scored[0].score - scored[1].score;
      if (scored[0].score < 0.94 && margin < 0.12) {
        return null;
      }
      if (scored[0].score >= 0.94 && margin < 0.03) {
        return null;
      }
    }
    return scored[0].control;
  }

  function bestOptionForAnswer(select, answer) {
    var options = Array.prototype.slice.call(select.options || []);
    var scored = options.map(function (option) {
      return {
        option: option,
        score: scoreAnswerToOption(answer, option.textContent || option.label || option.value || "")
      };
    }).sort(function (a, b) {
      return b.score - a.score;
    });
    if (!scored.length || scored[0].score < 0.78) {
      return null;
    }
    if (scored.length > 1 && scored[0].score < 0.94 && scored[0].score - scored[1].score < 0.12) {
      return null;
    }
    return scored[0].option;
  }

  function applyChoice(record, suggestion) {
    var parts = suggestion.answerTexts && suggestion.answerTexts.length ? suggestion.answerTexts : splitAnswerText(suggestion.answerText);
    var type = controlKind(record);
    if (!parts.length || (type === "radio" && parts.length > 1)) {
      return [];
    }

    var elements = [];
    var greenControls = [];

    parts.forEach(function (part) {
      var control = bestControlForAnswer(record, part);
      if (control && greenControls.indexOf(control) === -1) {
        greenControls.push(control);
      }
    });

    if (greenControls.length !== parts.length) {
      return [];
    }

    greenControls.forEach(function (control) {
      var element = decorationElementForControl(control);
      if (element) {
        element.classList.add("gameday-suggested-answer");
        elements.push(element);
      }
    });

    if (type === "checkbox") {
      elements = elements.concat(applyCheckboxWrongHints(record, suggestion, greenControls));
    }

    return elements;
  }

  function applyCheckboxWrongHints(record, suggestion, greenControls) {
    var behavior = config.checkboxBehavior || {};
    var strong = config.strongConfidenceThreshold || 0.88;
    var elements = [];
    var greenSet = new Set(greenControls || []);
    var wrongAnswers = suggestion.wrongAnswers || [];

    if (behavior.markKnownWrongRed !== false && wrongAnswers.length) {
      wrongAnswers.forEach(function (wrong) {
        var control = bestControlForAnswer(record, wrong);
        if (control && !greenSet.has(control)) {
          var element = decorationElementForControl(control);
          if (element) {
            element.classList.add("gameday-wrong-answer");
            elements.push(element);
          }
        }
      });
    }

    if (behavior.markOtherOptionsRedWhenAnswerSetIsCertain !== false &&
        suggestion.confidence >= strong &&
        suggestion.answerSetCertain) {
      (record.controls || []).forEach(function (control) {
        if (greenSet.has(control)) {
          return;
        }
        var element = decorationElementForControl(control);
        if (element && !element.classList.contains("gameday-wrong-answer")) {
          element.classList.add("gameday-wrong-answer");
          elements.push(element);
        }
      });
    }

    return elements;
  }

  function applySelect(record, suggestion) {
    var select = (record.controls || [])[0];
    if (!select) {
      return [];
    }
    var elements = [];
    var parts = splitAnswerText(suggestion.answerText);
    if (parts.length === 1) {
      var option = bestOptionForAnswer(select, parts[0]);
      if (option) {
        option.classList.add("gameday-suggested-answer");
        elements.push(option);
      }
    }
    return elements;
  }

  function normalizeText(text) {
    return GH.Utils && GH.Utils.normalizeText ? GH.Utils.normalizeText(text) : String(text || "").toLowerCase().trim();
  }

  function findCaseInsensitive(haystack, needle) {
    haystack = String(haystack || "");
    needle = String(needle || "");
    if (!needle) {
      return -1;
    }
    return haystack.toLowerCase().indexOf(needle.toLowerCase());
  }

  function addNeedle(needles, text, isRaw) {
    text = String(text || "");
    if (!text) {
      return;
    }
    if (needles.some(function (needle) { return needle.text === text; })) {
      return;
    }
    needles.push({
      text: text,
      isRaw: !!isRaw
    });
  }

  function findTextNodeMatchWithNeedles(root, answer, needles) {
    var rawFallback = null;
    var normalizedNeedles = needles.map(function (needle) {
      return normalizeText(needle.text);
    }).filter(Boolean);
    if (!normalizedNeedles.length) {
      return null;
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || parent.closest("script, style, option, input, textarea, select, button, .gameday-explicit-answer")) {
          return NodeFilter.FILTER_REJECT;
        }
        var normalizedNode = normalizeText(node.nodeValue || "");
        return normalizedNeedles.some(function (needle) {
          return normalizedNode.indexOf(needle) !== -1;
        }) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue || "";
      for (var i = 0; i < needles.length; i += 1) {
        var needle = needles[i];
        var index = findCaseInsensitive(raw, needle.text);
        if (index === -1) {
          continue;
        }
        if (needle.isRaw) {
          var rawSlice = raw.slice(index, index + needle.text.length);
          var innerIndex = findCaseInsensitive(rawSlice, answer);
          if (innerIndex !== -1) {
            return { node: node, index: index + innerIndex, length: String(answer || "").length };
          }
          rawFallback = rawFallback || { node: node, index: index, length: needle.text.length };
          continue;
        }
        return { node: node, index: index, length: needle.text.length };
      }
      var compact = raw.replace(/\s+/g, " ");
      var index = findCaseInsensitive(compact, answer);
      if (index !== -1) {
        var rawIndex = findCaseInsensitive(raw, answer);
        if (rawIndex !== -1) {
          return { node: node, index: rawIndex, length: String(answer || "").length };
        }
      }
    }
    return rawFallback;
  }

  function findTextNodeMatch(root, answer, rawText) {
    if (!root || !answer || !normalizeText(answer)) {
      return null;
    }
    var rawNeedles = [];
    addNeedle(rawNeedles, rawText, true);
    var rawMatch = findTextNodeMatchWithNeedles(root, answer, rawNeedles);
    if (rawMatch) {
      return rawMatch;
    }
    var answerNeedles = [];
    addNeedle(answerNeedles, answer, false);
    return findTextNodeMatchWithNeedles(root, answer, answerNeedles);
  }

  function applyExplicitText(record, suggestion) {
    var answer = suggestion.explicitAnswerText || suggestion.answerText;
    var rawText = suggestion.explicitRawText || "";
    var root = record.container || document.body;
    var match = findTextNodeMatch(root, answer, rawText);
    if (!match || !match.node || match.index < 0) {
      return [];
    }
    var node = match.node;
    var raw = node.nodeValue || "";
    var before = raw.slice(0, match.index);
    var middle = raw.slice(match.index, match.index + match.length);
    var after = raw.slice(match.index + match.length);
    var span = document.createElement("span");
    span.className = "gameday-explicit-answer";
    span.textContent = middle;
    var fragment = document.createDocumentFragment();
    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }
    fragment.appendChild(span);
    if (after) {
      fragment.appendChild(document.createTextNode(after));
    }
    node.parentNode.replaceChild(fragment, node);
    return [{ element: span, type: "explicit" }];
  }

  function applyTextHint(record, suggestion) {
    var control = (record.controls || [])[0];
    var answer = suggestion.answerText || "";
    if (!control || !answer) {
      return [];
    }
    var elements = [];
    if (!control.hasAttribute("data-gameday-original-title")) {
      control.setAttribute("data-gameday-original-title", control.getAttribute("title") || "");
    }
    control.setAttribute("title", "Risposta suggerita: " + answer);
    control.setAttribute("data-gameday-suggestion", answer);
    control.classList.add("gameday-text-answer-field");
    elements.push(control);

    var hint = document.createElement("span");
    hint.className = "gameday-text-answer-hint";
    hint.textContent = "Risposta: " + answer;
    hint.setAttribute("role", "button");
    hint.setAttribute("tabindex", "0");
    hint.setAttribute("title", "Clicca per inserire questa risposta nel campo");
    function dateToIso(value) {
      var text = String(value || "").trim();
      var dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
      if (dmy) {
        var year = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
        return year + "-" + ("0" + dmy[2]).slice(-2) + "-" + ("0" + dmy[1]).slice(-2);
      }
      var dayMonth = text.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
      if (dayMonth) {
        return new Date().getFullYear() + "-" + ("0" + dayMonth[2]).slice(-2) + "-" + ("0" + dayMonth[1]).slice(-2);
      }
      var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      return iso ? iso[1] + "-" + ("0" + iso[2]).slice(-2) + "-" + ("0" + iso[3]).slice(-2) : "";
    }
    function setControlValue(value) {
      var nextValue = control.type === "date" ? (dateToIso(value) || value) : value;
      var descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(control, nextValue);
      } else {
        control.value = nextValue;
      }
    }
    function fillControl() {
      control.focus();
      setControlValue(answer);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    hint.addEventListener("click", fillControl);
    hint.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fillControl();
      }
    });
    if (control.parentNode) {
      if (control.nextSibling) {
        control.parentNode.insertBefore(hint, control.nextSibling);
      } else {
        control.parentNode.appendChild(hint);
      }
      elements.push({ element: hint, type: "textHint" });
    }
    return elements;
  }

  function signatureForSuggestion(record, suggestion) {
    return [
      record.hash,
      record.index,
      suggestion.answerText || "",
      suggestion.explicitRawText || "",
      Math.round((suggestion.confidence || 0) * 1000),
      suggestion.source || "",
      (suggestion.wrongAnswers || []).join("|")
    ].join("|");
  }

  function apply(records, suggestions) {
    var byIndex = new Map();
    (records || []).forEach(function (record) {
      byIndex.set(record.index, record);
    });

    var desired = new Map();
    (suggestions || []).forEach(function (suggestion) {
      var record = byIndex.get(suggestion.recordIndex);
      if (record) {
        desired.set(record.index, {
          record: record,
          suggestion: suggestion,
          signature: signatureForSuggestion(record, suggestion)
        });
      }
    });

    appliedByRecord.forEach(function (entry, index) {
      var next = desired.get(index);
      if (!next || next.signature !== entry.signature) {
        clearElements(entry.elements);
        appliedByRecord.delete(index);
      }
    });

    desired.forEach(function (entry, index) {
      var existing = appliedByRecord.get(index);
      if (existing && existing.signature === entry.signature && (existing.elements || []).every(function (item) {
        var element = item && item.element ? item.element : item;
        return element && element.isConnected;
      })) {
        return;
      }
      if (existing) {
        clearElements(existing.elements);
      }

      var record = entry.record;
      var suggestion = entry.suggestion;
      var type = controlKind(record);
      var elements = [];

      if (suggestion.explicitAnswer) {
        elements = elements.concat(applyExplicitText(record, suggestion));
      }

      if (type === "radio" || type === "checkbox") {
        elements = elements.concat(applyChoice(record, suggestion));
      } else if (type === "select") {
        elements = elements.concat(applySelect(record, suggestion));
      } else if (isTextRecord(record)) {
        elements = elements.concat(applyTextHint(record, suggestion));
      }

      if (elements.length) {
        appliedByRecord.set(index, {
          signature: entry.signature,
          elements: elements
        });
      } else {
        appliedByRecord.delete(index);
      }
    });
  }

  GH.Highlighter = {
    clearPreviousHighlights: clearPreviousHighlights,
    apply: apply,
    bestControlForAnswer: bestControlForAnswer,
    bestOptionForAnswer: bestOptionForAnswer
  };
})();
