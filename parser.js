(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var performanceConfig = config.performance || {};
  var utils = GH.Utils || {};
  var elementIds = new WeakMap();
  var nextElementId = 1;

  var TEXT_INPUT_TYPES = {
    text: true,
    number: true,
    date: true,
    time: true,
    url: true,
    tel: true,
    search: true
  };

  function debug() {
    if (GH.log) {
      GH.log.apply(GH, arguments);
    }
  }

  function getElementId(element) {
    if (!elementIds.has(element)) {
      elementIds.set(element, "e" + nextElementId);
      nextElementId += 1;
    }
    return elementIds.get(element);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function compactText(text) {
    if (utils.compactText) {
      return utils.compactText(text);
    }
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();
  }

  function normalizeText(text) {
    if (utils.normalizeText) {
      return utils.normalizeText(text);
    }
    return compactText(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalQuestionText(text) {
    if (utils.canonicalQuestionText) {
      return utils.canonicalQuestionText(text);
    }
    return normalizeText(text).replace(/^\s*[*#\d.)-]+\s*/, "").trim();
  }

  function stableHash(text) {
    if (utils.stableHash) {
      return utils.stableHash(text);
    }
    var value = String(text || "");
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "q_" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function stableQuestionHash(recordLike) {
    var canonical = canonicalQuestionText(recordLike.questionText || recordLike.normalizedQuestion || "");
    var types = (recordLike.inputTypes || []).join(",");
    return stableHash([canonical, types].join("::"));
  }

  function isButtonLike(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    var tag = element.tagName.toLowerCase();
    if (tag === "button") {
      return true;
    }
    if (tag === "input") {
      var type = (element.getAttribute("type") || "text").toLowerCase();
      return ["submit", "button", "reset", "image"].indexOf(type) !== -1;
    }
    return false;
  }

  function isElementVisible(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    var style = window.getComputedStyle(element);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    var rects = element.getClientRects();
    return rects && rects.length > 0;
  }

  function getInputType(input) {
    if (!input || input.tagName.toLowerCase() !== "input") {
      return "";
    }
    return (input.getAttribute("type") || "text").toLowerCase();
  }

  function getControlKind(control) {
    var tag = control.tagName.toLowerCase();
    if (tag === "select") {
      return "select";
    }
    if (tag === "textarea") {
      return "textarea";
    }
    if (tag === "input") {
      var type = getInputType(control);
      if (type === "radio") {
        return "radio";
      }
      if (type === "checkbox") {
        return "checkbox";
      }
      if (TEXT_INPUT_TYPES[type] || !control.getAttribute("type")) {
        return type || "text";
      }
    }
    return "";
  }

  function isSupportedControl(control) {
    if (!control || control.disabled) {
      return false;
    }
    var tag = control.tagName.toLowerCase();
    if (tag === "select" || tag === "textarea") {
      return true;
    }
    if (tag !== "input") {
      return false;
    }
    var type = getInputType(control);
    if ((config.ignoredTextInputTypes || []).indexOf(type) !== -1) {
      return false;
    }
    return type === "radio" || type === "checkbox" || TEXT_INPUT_TYPES[type] || !control.getAttribute("type");
  }

  function labelForControl(control) {
    if (!control) {
      return null;
    }
    if (control.id) {
      var explicit = document.querySelector("label[for=\"" + cssEscape(control.id) + "\"]");
      if (explicit) {
        return explicit;
      }
    }
    return control.closest("label");
  }

  function isControlVisibleOrLabelVisible(control) {
    if (isElementVisible(control)) {
      return true;
    }
    var label = labelForControl(control);
    return !!(label && isElementVisible(label));
  }

  function getVisibleControls() {
    var roots = getScanRoots();
    var seen = new Set();
    var controls = [];

    roots.forEach(function (root) {
      Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("input, select, textarea") : []).forEach(function (control) {
        if (!seen.has(control)) {
          seen.add(control);
          controls.push(control);
        }
      });
    });

    controls = controls
      .filter(isSupportedControl)
      .filter(isControlVisibleOrLabelVisible);

    var maxControls = performanceConfig.maxVisibleControls || 150;
    if (controls.length > maxControls) {
      debug("Troppi controlli visibili, parsing interrotto", controls.length, "max", maxControls);
      return [];
    }

    return controls;
  }

  function getScanRoots() {
    var roots = [];
    Array.prototype.slice.call(document.querySelectorAll("form")).forEach(function (form) {
      if (isElementVisible(form)) {
        roots.push(form);
      }
    });

    (config.questionBlockSelectors || []).forEach(function (selector) {
      try {
        Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (element) {
          if (isElementVisible(element)) {
            roots.push(element);
          }
        });
      } catch (error) {
        debug("Selector root non valido", selector, error);
      }
    });

    var unique = [];
    roots.forEach(function (root) {
      if (unique.some(function (existing) { return existing === root || existing.contains(root); })) {
        return;
      }
      unique = unique.filter(function (existing) { return !root.contains(existing); });
      unique.push(root);
    });

    return unique.length ? unique : [document];
  }

  function controlGroupName(control) {
    var name = control.getAttribute("name") || "";
    if (name) {
      return name;
    }
    if (control.id) {
      return control.id;
    }
    return getElementId(control);
  }

  function matchesAny(element, selectors) {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (element.matches(selectors[i])) {
          return true;
        }
      } catch (error) {
        debug("Selector non valido", selectors[i], error);
      }
    }
    return false;
  }

  function relevantControlCount(container) {
    if (!container || !container.querySelectorAll) {
      return 0;
    }
    return Array.prototype.slice.call(container.querySelectorAll("input, select, textarea"))
      .filter(isSupportedControl).length;
  }

  function nearestQuestionBlock(control) {
    var selectors = config.questionBlockSelectors || [];
    var current = control.parentElement;
    var depth = 0;
    while (current && current !== document.body && depth < 10) {
      if (matchesAny(current, selectors)) {
        var count = relevantControlCount(current);
        if (count <= 24) {
          return current;
        }
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function commonAncestor(elements) {
    if (!elements.length) {
      return null;
    }
    var ancestor = elements[0];
    while (ancestor) {
      var containsAll = elements.every(function (element) {
        return ancestor === element || ancestor.contains(element);
      });
      if (containsAll) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function chooseContainer(controls) {
    var common = commonAncestor(controls);
    var selectors = config.questionBlockSelectors || [];
    if (common && controls.indexOf(common) !== -1) {
      common = common.parentElement;
    }

    if (common && common !== document.body && matchesAny(common, selectors) && relevantControlCount(common) <= Math.max(controls.length + 6, 12)) {
      return common;
    }

    var current = controls[0] ? controls[0].parentElement : null;
    var depth = 0;
    while (current && current !== document.body && depth < 10) {
      if (matchesAny(current, selectors) && controls.every(function (control) { return current.contains(control); })) {
        var count = relevantControlCount(current);
        if (count <= Math.max(controls.length + 6, 12)) {
          return current;
        }
      }
      current = current.parentElement;
      depth += 1;
    }

    if (controls.length === 1) {
      var label = labelForControl(controls[0]);
      if (label) {
        return label;
      }
    }

    return common && common !== document.body ? common : (controls[0] ? controls[0].parentElement : null);
  }

  function elementTextWithoutButtons(element) {
    if (!element) {
      return "";
    }
    var clone = element.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll("script, style, button, input[type='submit'], input[type='button'], input[type='reset'], input[type='file'], option")).forEach(function (node) {
      node.remove();
    });
    return compactText(clone.innerText || clone.textContent || "");
  }

  function optionTextForControl(control) {
    if (!control) {
      return "";
    }
    var label = labelForControl(control);
    if (label) {
      var clone = label.cloneNode(true);
      Array.prototype.slice.call(clone.querySelectorAll("input, select, textarea, button")).forEach(function (node) {
        node.remove();
      });
      var labelText = compactText(clone.innerText || clone.textContent || "");
      if (labelText) {
        return labelText;
      }
    }
    return compactText(control.getAttribute("aria-label") || control.getAttribute("title") || control.value || "");
  }

  function selectOptions(select) {
    return Array.prototype.slice.call(select.options || [])
      .map(function (option) {
        return compactText(option.textContent || option.label || option.value || "");
      })
      .filter(Boolean);
  }

  function selectedAnswersForControls(controls) {
    if (!controls.length) {
      return [];
    }
    var kind = getControlKind(controls[0]);
    if (kind === "radio") {
      return controls.filter(function (control) { return control.checked; }).map(optionTextForControl).filter(Boolean);
    }
    if (kind === "checkbox") {
      return controls.filter(function (control) { return control.checked; }).map(optionTextForControl).filter(Boolean);
    }
    if (kind === "select") {
      return Array.prototype.slice.call(controls[0].selectedOptions || [])
        .map(function (option) {
          return compactText(option.textContent || option.label || option.value || "");
        })
        .filter(Boolean);
    }
    var value = compactText(controls[0].value || "");
    return value ? [value] : [];
  }

  function isOptionLabel(label, controls) {
    if (!label) {
      return false;
    }
    return controls.some(function (control) {
      if (label.contains(control)) {
        return true;
      }
      return !!(control.id && label.getAttribute("for") === control.id);
    });
  }

  function textFromAriaLabelledBy(control) {
    var ids = String(control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    return ids.map(function (id) {
      var element = document.getElementById(id);
      return elementTextWithoutButtons(element);
    }).filter(Boolean).join(" ");
  }

  function textBeforeFirstControl(container, controls) {
    if (!container || !controls.length || !container.contains(controls[0])) {
      return "";
    }
    var first = controls.slice().sort(function (a, b) {
      if (a === b) {
        return 0;
      }
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    })[0];
    var parts = [];
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || isButtonLike(parent) || parent.tagName.toLowerCase() === "option") {
          return NodeFilter.FILTER_REJECT;
        }
        if (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest("label") && controls.some(function (control) {
          var label = parent.closest("label");
          return isOptionLabel(label, controls);
        })) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var text = compactText(node.nodeValue || "");
      if (text) {
        parts.push(text);
      }
    }
    return compactText(parts.join(" "));
  }

  function lastQuestionFragment(text) {
    var value = compactText(text);
    var star = Math.max(value.lastIndexOf(" * "), value.lastIndexOf("* "));
    if (star >= 0) {
      value = compactText(value.slice(star).replace(/^\*\s*/, ""));
    }
    return value;
  }

  function textBetweenPreviousAndFirstControl(container, controls) {
    if (!container || !controls.length || !container.contains(controls[0])) {
      return "";
    }
    var sorted = controls.slice().sort(function (a, b) {
      if (a === b) {
        return 0;
      }
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    var first = sorted[0];
    var allControls = Array.prototype.slice.call(container.querySelectorAll("input, select, textarea")).filter(isSupportedControl);
    var firstIndex = allControls.indexOf(first);
    var previous = null;
    for (var i = firstIndex - 1; i >= 0; i -= 1) {
      if (controls.indexOf(allControls[i]) === -1) {
        previous = allControls[i];
        break;
      }
    }
    if (!previous) {
      return lastQuestionFragment(textBeforeFirstControl(container, controls));
    }

    var parts = [];
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || isButtonLike(parent) || parent.tagName.toLowerCase() === "option") {
          return NodeFilter.FILTER_REJECT;
        }
        if (!(previous.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return NodeFilter.FILTER_REJECT;
        }
        var label = parent.closest("label");
        if (label && (isOptionLabel(label, controls) || label.contains(previous))) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var text = compactText(node.nodeValue || "");
      if (text) {
        parts.push(text);
      }
    }
    return lastQuestionFragment(parts.join(" "));
  }

  function findQuestionText(container, controls) {
    var first = controls[0];
    var kind = first ? getControlKind(first) : "";

    if (container) {
      var dataQuestion = compactText(container.getAttribute("data-question") || container.getAttribute("data-question-id") || "");
      if (dataQuestion) {
        return dataQuestion;
      }
    }

    var ariaText = first ? textFromAriaLabelledBy(first) : "";
    if (ariaText) {
      return ariaText;
    }

    if (container) {
      var legend = container.querySelector("legend");
      if (legend && isElementVisible(legend)) {
        var legendText = elementTextWithoutButtons(legend);
        if (legendText) {
          return legendText;
        }
      }
    }

    if (controls.length === 1 && (kind === "select" || kind === "textarea" || TEXT_INPUT_TYPES[kind] || kind === "checkbox")) {
      var label = labelForControl(first);
      if (label) {
        var labelText = elementTextWithoutButtons(label);
        if (labelText) {
          return labelText;
        }
      }
    }

    if (container) {
      var contextual = textBetweenPreviousAndFirstControl(container, controls);
      if (contextual && normalizeText(contextual).length > 2 && contextual.length < 600) {
        return contextual;
      }

      var selectors = config.questionTextSelectors || [];
      for (var i = 0; i < selectors.length; i += 1) {
        var candidates = [];
        try {
          candidates = Array.prototype.slice.call(container.querySelectorAll(selectors[i]));
        } catch (error) {
          debug("Selector testo domanda non valido", selectors[i], error);
        }
        for (var j = 0; j < candidates.length; j += 1) {
          var candidate = candidates[j];
          if (!isElementVisible(candidate) || isButtonLike(candidate)) {
            continue;
          }
          if (candidate.tagName.toLowerCase() === "label" && isOptionLabel(candidate, controls) && controls.length > 1) {
            continue;
          }
          var candidateText = elementTextWithoutButtons(candidate);
          if (candidateText && normalizeText(candidateText).length > 2) {
            return candidateText;
          }
        }
      }

      var before = textBeforeFirstControl(container, controls);
      if (before) {
        return lastQuestionFragment(before);
      }

      var fallback = elementTextWithoutButtons(container);
      if (fallback) {
        controls.forEach(function (control) {
          var optionText = optionTextForControl(control);
          if (optionText) {
            fallback = fallback.replace(optionText, " ");
          }
        });
        fallback = compactText(fallback);
      }
      if (fallback) {
        return fallback;
      }
    }

    return first ? compactText(first.getAttribute("aria-label") || first.getAttribute("placeholder") || first.name || first.id || "") : "";
  }

  function checkboxLooksAutonomous(control) {
    var text = normalizeText(optionTextForControl(control));
    return /^(accetto|confermo|ho letto|dichiaro|presa visione|autorizzo|consenso)/.test(text);
  }

  function buildGroups(controls) {
    var groups = [];
    var radioByKey = new Map();
    var checkboxByKey = new Map();

    controls.forEach(function (control) {
      var kind = getControlKind(control);
      var block = nearestQuestionBlock(control);
      var blockId = block ? getElementId(block) : "page";
      var name = controlGroupName(control);

      if (kind === "radio") {
        var radioKey = "radio:" + blockId + ":" + name;
        if (!radioByKey.has(radioKey)) {
          radioByKey.set(radioKey, []);
        }
        radioByKey.get(radioKey).push(control);
        return;
      }

      if (kind === "checkbox") {
        if (!control.getAttribute("name") || checkboxLooksAutonomous(control)) {
          groups.push([control]);
          return;
        }
        var checkboxKey = "checkbox:" + blockId + ":" + name;
        if (!checkboxByKey.has(checkboxKey)) {
          checkboxByKey.set(checkboxKey, []);
        }
        checkboxByKey.get(checkboxKey).push(control);
        return;
      }

      groups.push([control]);
    });

    radioByKey.forEach(function (items) {
      groups.push(items);
    });
    checkboxByKey.forEach(function (items) {
      if (items.length === 1) {
        groups.push(items);
      } else {
        groups.push(items);
      }
    });

    return groups.sort(function (a, b) {
      return a[0].compareDocumentPosition(b[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function recordFromGroup(group, index) {
    var warnings = [];
    var container = chooseContainer(group);
    var inputTypes = group.map(getControlKind).filter(Boolean).filter(function (type, i, all) {
      return all.indexOf(type) === i;
    });
    var kind = inputTypes[0] || "";
    var options = [];

    if (kind === "radio" || kind === "checkbox") {
      options = group.map(optionTextForControl).filter(Boolean);
    } else if (kind === "select") {
      options = selectOptions(group[0]);
    }

    if (container && relevantControlCount(container) > Math.max(group.length + 10, 20)) {
      warnings.push("container ampio: possibile domanda dinamica o markup non segmentato");
    }
    if (!options.length && (kind === "radio" || kind === "checkbox" || kind === "select")) {
      warnings.push("opzioni non leggibili");
    }

    var questionText = findQuestionText(container, group);
    var normalizedQuestion = utils.normalizeQuestion ? utils.normalizeQuestion(questionText) : normalizeText(questionText);
    var canonicalQuestion = canonicalQuestionText(questionText);
    if (!normalizedQuestion) {
      warnings.push("testo domanda non trovato");
    }

    var hash = stableQuestionHash({
      questionText: questionText,
      normalizedQuestion: normalizedQuestion,
      inputTypes: inputTypes
    });

    return {
      index: index,
      hash: hash,
      questionText: questionText,
      normalizedQuestion: normalizedQuestion,
      canonicalQuestion: canonicalQuestion,
      inputTypes: inputTypes,
      controls: group,
      options: options,
      selectedAnswers: selectedAnswersForControls(group),
      container: container,
      warnings: warnings
    };
  }

  function parseCurrentPage() {
    var controls = getVisibleControls();
    var groups = buildGroups(controls);
    var records = groups.map(recordFromGroup).filter(function (record) {
      if (!record.controls.length) {
        return false;
      }
      if (!record.questionText && !record.options.length) {
        return false;
      }
      return true;
    });
    var maxQuestions = performanceConfig.maxQuestionsPerPage || 80;
    if (records.length > maxQuestions) {
      debug("Troppe domande rilevate, limito il parsing", records.length, "max", maxQuestions);
      records = records.slice(0, maxQuestions);
    }
    return records.map(function (record, index) {
      record.index = index;
      return record;
    });
  }

  function refreshRecords(records) {
    if (!records || !records.length) {
      return records || [];
    }
    var valid = records.every(function (record) {
      return record.controls && record.controls.length && record.controls.every(function (control) {
        return control && control.isConnected;
      });
    });
    if (!valid) {
      return null;
    }
    records.forEach(function (record) {
      record.selectedAnswers = selectedAnswersForControls(record.controls);
    });
    return records;
  }

  function debugParse() {
    var records = parseCurrentPage();
    console.table(records.map(function (record) {
      return {
        index: record.index,
        hash: record.hash,
        questionText: record.questionText,
        canonicalQuestion: record.canonicalQuestion,
        inputTypes: record.inputTypes.join(","),
        optionCount: record.options.length,
        selectedAnswers: record.selectedAnswers.join(" | "),
        warnings: record.warnings.join("; ")
      };
    }));
    return records;
  }

  GH.Parser = {
    parseCurrentPage: parseCurrentPage,
    refreshRecords: refreshRecords,
    debugParse: debugParse,
    normalizeText: normalizeText,
    canonicalQuestionText: canonicalQuestionText,
    stableHash: stableHash,
    stableQuestionHash: stableQuestionHash,
    compactText: compactText,
    getControlKind: getControlKind,
    optionTextForControl: optionTextForControl,
    labelForControl: labelForControl,
    isElementVisible: isElementVisible
  };
})();
