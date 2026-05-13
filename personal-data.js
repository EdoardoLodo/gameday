(function () {
  "use strict";

  var GH = window.GamedayHighlighter = window.GamedayHighlighter || {};
  var config = window.GAMEDAY_CONFIG || {};
  var utils = GH.Utils || {};
  var profile = defaultProfile();
  var initialized = false;
  var observer = null;
  var captureTimer = null;

  function now() {
    return new Date().toISOString();
  }

  function personalConfig() {
    return config.personalData || {};
  }

  function storageKey() {
    return personalConfig().storageKey || "gamedayPersonalData";
  }

  function compactText(text) {
    return utils.compactText ? utils.compactText(text) : String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeText(text) {
    return utils.normalizeText ? utils.normalizeText(text) : compactText(text).toLowerCase();
  }

  function splitList(value) {
    return utils.splitStoredList ? utils.splitStoredList(value) : String(value || "").split(/\s+\|\s+|\r?\n|;\s*/g).map(function (item) {
      return item.trim();
    }).filter(Boolean);
  }

  function uniquePush(list, value, max) {
    value = compactText(value);
    if (!value) {
      return list || [];
    }
    list = Array.isArray(list) ? list : [];
    var key = normalizeText(value);
    list = list.filter(function (item) {
      return normalizeText(item) !== key;
    });
    list.push(value);
    if (max && list.length > max) {
      list = list.slice(list.length - max);
    }
    return list;
  }

  function defaultProfile() {
    return {
      version: 1,
      updatedAt: "",
      sourceUrl: "",
      fields: {},
      values: [],
      rawText: ""
    };
  }

  function storageGet() {
    return new Promise(function (resolve) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(storageKey(), function (result) {
        resolve(result ? result[storageKey()] : null);
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
      payload[storageKey()] = value;
      chrome.storage.local.set(payload, resolve);
    });
  }

  function isDataPage() {
    if (personalConfig().enabled === false) {
      return false;
    }
    var href = String(location.href || "");
    return (personalConfig().sourceUrlIncludes || []).some(function (needle) {
      return needle && href.indexOf(needle) !== -1;
    });
  }

  function getVisibleText(element) {
    if (!element) {
      return "";
    }
    var clone = element.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll("script, style, noscript, button")).forEach(function (node) {
      node.remove();
    });
    return compactText(clone.innerText || clone.textContent || "");
  }

  function getReadableText(element) {
    if (!element) {
      return "";
    }
    var clone = element.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll("script, style, noscript, button")).forEach(function (node) {
      node.remove();
    });
    return String(clone.innerText || clone.textContent || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/g)
      .map(compactText)
      .filter(Boolean)
      .join("\n");
  }

  function canonicalFieldKey(label) {
    var text = normalizeText(label).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    if (!text) {
      return "";
    }
    if (/codice\s+ditta\s+inail/.test(text)) {
      return "codiceDittaInail";
    }
    if (/\bcodice\s+fiscale\b|\bcf\b/.test(text)) {
      return "codiceFiscale";
    }
    if (/\bpartita\s+iva\b|\bpiva\b|\bp\.?\s*iva\b/.test(text)) {
      return "partitaIva";
    }
    if (/\bpec\b/.test(text)) {
      return "pec";
    }
    if (/\be\s*mail\b|\bemail\b|posta elettronica/.test(text)) {
      return "email";
    }
    if (/codice\s+identificativo|identificativo|codice\s+azienda|token|codice\s+domanda/.test(text)) {
      return "codiceIdentificativo";
    }
    if (/data\s+del\s+click\s+day|click\s+day/.test(text)) {
      return "dataClickDay";
    }
    if (/data\s+di\s+apertura|apertura\s+inserimento\s+domande/.test(text)) {
      return "dataAperturaDomande";
    }
    if (/data\s+di\s+chiusura|chiusura\s+inserimento\s+domande/.test(text)) {
      return "dataChiusuraDomande";
    }
    var momento = text.match(/\bmomento\s+([1-6])\b/);
    if (momento) {
      return "momento" + momento[1];
    }
    if (/anno\s+di\s+uscita\s+del\s+bando|anno\s+bando/.test(text)) {
      return "annoBando";
    }
    if (/fondi\s+stanziati|stanziamento/.test(text)) {
      return "fondiStanziati";
    }
    if (/assi\s+di\s+finanziamento\s+totali|assi\s+totali/.test(text)) {
      return "assiTotali";
    }
    if (/assi\s+di\s+finanziamento\s+principali|assi\s+principali/.test(text)) {
      return "assiPrincipali";
    }
    if (/sotto\s+assi|sottoassi|sotto\s+assi\s+di\s+finanziamento/.test(text)) {
      return "sottoAssi";
    }
    if (/telefono\s+di\s+emergenza|referente\s+azienda/.test(text)) {
      return "telefonoEmergenza";
    }
    if (/cellulare|telefono|tel\b|numero\s+di\s+telefono/.test(text)) {
      return "telefono";
    }
    if (/ragione\s+sociale|denominazione|impresa|richiedente/.test(text)) {
      return "azienda";
    }
    if (/data\s+di\s+nascita|nato\s+il|nata\s+il/.test(text)) {
      return "dataNascita";
    }
    if (/data\s+iscrizione|data\s+registrazione/.test(text)) {
      return "dataRegistrazione";
    }
    if (/comune\s+di\s+nascita|luogo\s+di\s+nascita/.test(text)) {
      return "luogoNascita";
    }
    if (/\bcognome\s+partecipante\b/.test(text)) {
      return "cognome";
    }
    if (/\bnome\s+partecipante\b/.test(text)) {
      return "nome";
    }
    if (/cognome\s+e\s+nome|cognome\s+nome/.test(text)) {
      return "cognomeNome";
    }
    if (/nome\s+e\s+cognome|nome\s+cognome/.test(text)) {
      return "nomeCognome";
    }
    if (/\bcognome\b/.test(text)) {
      return "cognome";
    }
    if (/\bnome\b/.test(text)) {
      return "nome";
    }
    if (/\bindirizzo\b/.test(text)) {
      return "indirizzo";
    }
    return "";
  }

  function addField(target, label, value) {
    label = compactText(label);
    value = compactText(value);
    if (!label || !value || value.length > 500) {
      return;
    }
    var key = canonicalFieldKey(label);
    if (!key) {
      return;
    }
    target.fields[key] = {
      key: key,
      label: label,
      value: value,
      updatedAt: now()
    };
    target.values = uniquePush(target.values, value, personalConfig().maxValues || 250);
  }

  function isPositionGuideLine(value) {
    var text = compactText(value);
    return /^\d{25,}$/.test(text) && (/^0+1+2+3+4+5+6*$/.test(text) || /^1234567890{0,1}123456789/.test(text));
  }

  function isPlaceholderValue(value) {
    return /^[-–—]+$/.test(compactText(value));
  }

  function looksLikeFieldLabel(value) {
    return !!canonicalFieldKey(value);
  }

  function addAdjacentLinePairs(target, text) {
    var lines = String(text || "").split(/\r?\n/g).map(compactText).filter(Boolean);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var embeddedDate = line.match(/^(.{3,120}?)(\d{4}-\d{1,2}-\d{1,2})$/);
      if (embeddedDate && looksLikeFieldLabel(embeddedDate[1])) {
        addField(target, embeddedDate[1], embeddedDate[2]);
        continue;
      }
      if (!looksLikeFieldLabel(line)) {
        continue;
      }
      var values = [];
      for (var j = i + 1; j < lines.length && values.length < 3; j += 1) {
        var candidate = lines[j];
        if (looksLikeFieldLabel(candidate)) {
          break;
        }
        if (isPositionGuideLine(candidate) || isPlaceholderValue(candidate)) {
          continue;
        }
        values.push(candidate);
        if (canonicalFieldKey(line) !== "codiceIdentificativo") {
          break;
        }
      }
      if (!values.length) {
        continue;
      }
      var value = values[0];
      if (canonicalFieldKey(line) === "codiceIdentificativo") {
        value = values.filter(function (item) {
          return /[+@#._-]/.test(item) || /[a-zA-Z]/.test(item);
        }).sort(function (a, b) {
          return b.length - a.length;
        })[0] || values[0];
      }
      addField(target, line, value);
    }
  }

  function addLinePairs(target, text) {
    String(text || "").split(/\r?\n| {2,}/g).forEach(function (line) {
      line = compactText(line);
      var match = line.match(/^(.{2,80}?)(?:\s*[:=]\s*|\s{2,})(.{1,300})$/);
      if (match) {
        addField(target, match[1], match[2]);
      }
    });
  }

  function addTablePairs(target) {
    Array.prototype.slice.call(document.querySelectorAll("tr")).forEach(function (row) {
      var cells = Array.prototype.slice.call(row.children || []).map(getVisibleText).filter(Boolean);
      if (cells.length >= 2) {
        addField(target, cells[0], cells.slice(1).join(" "));
      }
    });
    Array.prototype.slice.call(document.querySelectorAll("dt")).forEach(function (term) {
      var next = term.nextElementSibling;
      if (next && next.tagName && next.tagName.toLowerCase() === "dd") {
        addField(target, getVisibleText(term), getVisibleText(next));
      }
    });
  }

  function addLabelPairs(target) {
    Array.prototype.slice.call(document.querySelectorAll("label")).forEach(function (label) {
      var value = "";
      if (label.htmlFor) {
        var control = document.getElementById(label.htmlFor);
        value = control ? compactText(control.value || control.textContent || "") : "";
      }
      if (!value) {
        var sibling = label.nextElementSibling;
        value = sibling ? getVisibleText(sibling) || compactText(sibling.value || "") : "";
      }
      addField(target, getVisibleText(label), value);
    });
  }

  function extractStandaloneValues(target, text) {
    var max = personalConfig().maxValues || 250;
    (String(text || "").match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).forEach(function (value) {
      target.values = uniquePush(target.values, value, max);
      if (!target.fields.email) {
        addField(target, "email", value);
      }
    });
    (String(text || "").match(/\b(?:\+39\s*)?\d[\d\s./-]{6,}\d\b/g) || []).forEach(function (value) {
      var cleaned = compactText(value);
      target.values = uniquePush(target.values, cleaned, max);
      if (!target.fields.telefono && cleaned.replace(/\D/g, "").length >= 7) {
        addField(target, "telefono", cleaned);
      }
    });
    (String(text || "").match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/g) || []).forEach(function (value) {
      target.values = uniquePush(target.values, value, max);
    });
    (String(text || "").match(/[+@#]?[a-zA-Z0-9][a-zA-Z0-9._-]{7,}/g) || []).forEach(function (value) {
      var normalized = normalizeText(value);
      if (/^(https?|www|email|telefono|cellulare|codice|identificativo)$/.test(normalized)) {
        return;
      }
      target.values = uniquePush(target.values, value, max);
      if (!target.fields.codiceIdentificativo && /[0-9+@#._-]/.test(value) && value.length >= 16) {
        addField(target, "codice identificativo", value);
      }
    });
  }

  function deriveFields(target) {
    var fields = target.fields || {};
    if (!fields.nomeCognome && fields.nome && fields.cognome) {
      addField(target, "nome e cognome", fields.nome.value + " " + fields.cognome.value);
    }
    if (!fields.cognomeNome && fields.nome && fields.cognome) {
      addField(target, "cognome nome", fields.cognome.value + " " + fields.nome.value);
    }
    if (!fields.nome && fields.nomeCognome) {
      var parts = fields.nomeCognome.value.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        addField(target, "nome", parts[0]);
        addField(target, "cognome", parts.slice(1).join(" "));
      }
    }
  }

  async function captureFromPage(reason) {
    if (!isDataPage() || !document.body) {
      return profile;
    }
    var rawText = getReadableText(document.body);
    var next = defaultProfile();
    next.updatedAt = now();
    next.sourceUrl = location.href;
    next.rawText = rawText.slice(0, personalConfig().maxRawTextLength || 20000);
    addTablePairs(next);
    addLabelPairs(next);
    addLinePairs(next, rawText);
    addAdjacentLinePairs(next, rawText);
    extractStandaloneValues(next, rawText);
    deriveFields(next);
    profile = next;
    await storageSet(profile);
    if (GH.log) {
      GH.log("Dati cliccatore salvati", reason || "capture", Object.keys(profile.fields));
    }
    return profile;
  }

  function scheduleCapture(reason) {
    window.clearTimeout(captureTimer);
    captureTimer = window.setTimeout(function () {
      captureFromPage(reason || "mutation").catch(function () {});
    }, 400);
  }

  function attachObserver() {
    if (!isDataPage() || observer || !window.MutationObserver || !document.documentElement) {
      return;
    }
    observer = new MutationObserver(function () {
      scheduleCapture("mutation");
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function init() {
    if (initialized) {
      return profile;
    }
    initialized = true;
    var stored = await storageGet();
    profile = Object.assign(defaultProfile(), stored || {});
    profile.fields = profile.fields || {};
    profile.values = profile.values || [];
    if (isDataPage()) {
      await captureFromPage("init");
      attachObserver();
    }
    attachStorageListener();
    return profile;
  }

  function attachStorageListener() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged || attachStorageListener.attached) {
      return;
    }
    attachStorageListener.attached = true;
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      var change = changes && changes[storageKey()];
      if (areaName !== "local" || !change || !change.newValue) {
        return;
      }
      profile = Object.assign(defaultProfile(), change.newValue || {});
      profile.fields = profile.fields || {};
      profile.values = profile.values || [];
      window.dispatchEvent(new CustomEvent("gamedayPersonalDataUpdated", {
        detail: {
          updatedAt: profile.updatedAt,
          sourceUrl: profile.sourceUrl
        }
      }));
    });
  }

  function fieldValue(key) {
    return profile && profile.fields && profile.fields[key] ? compactText(profile.fields[key].value) : "";
  }

  function bestCodeValue() {
    var direct = fieldValue("codiceIdentificativo");
    if (direct) {
      return direct;
    }
    var values = (profile.values || []).filter(function (value) {
      return /[0-9+@#._-]/.test(value) && value.length >= 12;
    }).sort(function (a, b) {
      return b.length - a.length;
    });
    return values[0] || "";
  }

  function chooseBaseValue(record) {
    var text = normalizeText(record.questionText || "");
    if (/codice\s+identificativo|identificativo|codice\s+azienda|codice\s+domanda|token/.test(text)) {
      return bestCodeValue();
    }
    if (!profile || !profile.updatedAt) {
      return "";
    }
    var momento = text.match(/\bmomento\s+([1-6])\b/);
    if (momento) {
      return fieldValue("momento" + momento[1]);
    }
    if (/codice\s+ditta\s+inail|codice\s+ditta/.test(text)) {
      return fieldValue("codiceDittaInail");
    }
    if (/codice\s+fiscale|\bcf\b/.test(text)) {
      return fieldValue("codiceFiscale");
    }
    if (/partita\s+iva|\bpiva\b|p\.?\s*iva/.test(text)) {
      return fieldValue("partitaIva");
    }
    if (/\bpec\b/.test(text)) {
      return fieldValue("pec") || fieldValue("email");
    }
    if (/email|e-mail|posta elettronica/.test(text)) {
      return fieldValue("email") || fieldValue("pec");
    }
    if (/telefono|cellulare|tel\b|numero\s+di\s+telefono/.test(text)) {
      return /emergenza|referente/.test(text) ? (fieldValue("telefonoEmergenza") || fieldValue("telefono")) : fieldValue("telefono");
    }
    if (/data\s+del\s+click\s+day|click\s+day/.test(text)) {
      return fieldValue("dataClickDay");
    }
    if (/data\s+di\s+apertura|apertura\s+inserimento\s+domande/.test(text)) {
      return fieldValue("dataAperturaDomande");
    }
    if (/data\s+di\s+chiusura|chiusura\s+inserimento\s+domande/.test(text)) {
      return fieldValue("dataChiusuraDomande");
    }
    if (/data\s+di\s+nascita|nato\s+il|nata\s+il/.test(text)) {
      return fieldValue("dataNascita");
    }
    if (/data\s+registrazione|data\s+iscrizione/.test(text)) {
      return fieldValue("dataRegistrazione");
    }
    if (/luogo\s+di\s+nascita|comune\s+di\s+nascita/.test(text)) {
      return fieldValue("luogoNascita");
    }
    if (/cognome\s+e\s+nome|cognome\s+nome/.test(text)) {
      return fieldValue("cognomeNome") || [fieldValue("cognome"), fieldValue("nome")].filter(Boolean).join(" ");
    }
    if (/nome\s+e\s+cognome|nome\s+cognome|partecipante\s+registrato|persona\s+registrata/.test(text)) {
      return fieldValue("nomeCognome") || [fieldValue("nome"), fieldValue("cognome")].filter(Boolean).join(" ");
    }
    if (/\bcognome\b/.test(text)) {
      return fieldValue("cognome");
    }
    if (/\bnome\b/.test(text)) {
      return fieldValue("nome");
    }
    if (/azienda|ragione\s+sociale|denominazione|richiedente|impresa/.test(text)) {
      return fieldValue("azienda");
    }
    if (/anno\s+di\s+uscita|anno\s+bando/.test(text)) {
      return fieldValue("annoBando");
    }
    if (/fondi\s+stanziati|stanziamento/.test(text)) {
      return fieldValue("fondiStanziati");
    }
    if (/assi\s+di\s+finanziamento\s+totali|assi\s+totali/.test(text)) {
      return fieldValue("assiTotali");
    }
    if (/assi\s+di\s+finanziamento\s+principali|assi\s+principali/.test(text)) {
      return fieldValue("assiPrincipali");
    }
    if (/sotto\s+assi|sottoassi/.test(text)) {
      return fieldValue("sottoAssi");
    }
    return "";
  }

  var ORDINALS = {
    primo: 1,
    prima: 1,
    secondo: 2,
    seconda: 2,
    terzo: 3,
    terza: 3,
    quarto: 4,
    quarta: 4,
    quinto: 5,
    quinta: 5,
    sesto: 6,
    sesta: 6,
    settimo: 7,
    settima: 7,
    ottavo: 8,
    ottava: 8,
    nono: 9,
    nona: 9,
    decimo: 10,
    decima: 10,
    undicesimo: 11,
    undicesima: 11,
    dodicesimo: 12,
    dodicesima: 12,
    tredicesimo: 13,
    tredicesima: 13,
    quattordicesimo: 14,
    quattordicesima: 14,
    quindicesimo: 15,
    quindicesima: 15,
    sedicesimo: 16,
    sedicesima: 16,
    diciassettesimo: 17,
    diciassettesima: 17,
    diciottesimo: 18,
    diciottesima: 18,
    diciannovesimo: 19,
    diciannovesima: 19,
    ventesimo: 20,
    ventesima: 20
  };

  var CARDINALS = {
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
    dieci: 10,
    undici: 11,
    dodici: 12,
    tredici: 13,
    quattordici: 14,
    quindici: 15,
    sedici: 16,
    diciassette: 17,
    diciotto: 18,
    diciannove: 19,
    venti: 20
  };

  function parsePosition(value) {
    value = normalizeText(value).replace(/[^\p{L}\p{N}]/gu, "");
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
    value = value.replace(/esimo$|esima$|mo$|ma$/g, function (suffix) {
      return suffix === "mo" || suffix === "ma" ? "" : suffix;
    });
    return ORDINALS[value] || null;
  }

  function parseRange(text) {
    var normalized = normalizeText(text);
    var digitRange = normalized.match(/\b(?:dal|dalla)\s+(\d{1,3})(?:\s*[a-z\u00b0\u00ba]*)?(?:\s+carattere)?\s+(?:al|alla)\s+(\d{1,3})(?:\s*[a-z\u00b0\u00ba]*)?\b/);
    if (digitRange) {
      return {
        start: Number(digitRange[1]),
        end: Number(digitRange[2])
      };
    }
    var token = "(\\d{1,3}(?:esim[oa]|[oa]|[\\u00b0\\u00ba])?|primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|sesto|sesta|settimo|settima|ottavo|ottava|nono|nona|decimo|decima|undicesimo|undicesima|dodicesimo|dodicesima|tredicesimo|tredicesima|quattordicesimo|quattordicesima|quindicesimo|quindicesima|sedicesimo|sedicesima|diciassettesimo|diciassettesima|diciottesimo|diciottesima|diciannovesimo|diciannovesima|ventesimo|ventesima)";
    var range = normalized.match(new RegExp("\\b(?:dal|dalla)\\s+" + token + "(?:\\s+carattere)?\\s+(?:al|alla)\\s+" + token + "\\b"));
    if (range) {
      return {
        start: parsePosition(range[1]),
        end: parsePosition(range[2])
      };
    }
    return null;
  }

  function parseCount(text, wordsBeforeNumber) {
    var normalized = normalizeText(text);
    var digit = normalized.match(new RegExp("\\b(?:" + wordsBeforeNumber + ")\\s+(\\d{1,3})\\b"));
    if (digit) {
      return Number(digit[1]);
    }
    var word = normalized.match(new RegExp("\\b(?:" + wordsBeforeNumber + ")\\s+(" + Object.keys(CARDINALS).join("|") + ")\\b"));
    if (word) {
      return CARDINALS[word[1]];
    }
    var trailing = normalized.match(new RegExp("\\b(\\d{1,3}|" + Object.keys(CARDINALS).join("|") + ")\\s+(?:caratteri|lettere)\\s+(?:" + wordsBeforeNumber + ")\\b"));
    if (trailing) {
      return CARDINALS[trailing[1]] || Number(trailing[1]);
    }
    return null;
  }

  function parseSinglePosition(text) {
    var normalized = normalizeText(text);
    var ordinal = normalized.match(/\b(?:il\s+|al\s+|alla\s+|posizione\s+|carattere\s+)(primo|prima|secondo|seconda|terzo|terza|quarto|quarta|quinto|quinta|sesto|sesta|settimo|settima|ottavo|ottava|nono|nona|decimo|decima|undicesimo|undicesima|dodicesimo|dodicesima|tredicesimo|tredicesima|quattordicesimo|quattordicesima|quindicesimo|quindicesima|sedicesimo|sedicesima|diciassettesimo|diciassettesima|diciottesimo|diciottesima|diciannovesimo|diciannovesima|ventesimo|ventesima)\s+(?:carattere|posizione)?\b/);
    if (ordinal) {
      return { position: parsePosition(ordinal[1]), human: true };
    }
    var suffixed = normalized.match(/\b(\d{1,3})(?:esimo|esima|o|a)\s+carattere\b/);
    if (suffixed) {
      return { position: Number(suffixed[1]), human: true };
    }
    var digit = normalized.match(/\b(?:posizione|carattere)\s+(\d{1,3})\b/);
    if (digit) {
      return {
        position: Number(digit[1]),
        human: !/griglia|tabella|coordinate|orizzontale|verticale|riga|colonna/.test(normalized)
      };
    }
    return null;
  }

  function parseGridCoordinate(text) {
    var normalized = normalizeText(text);
    var horizontal = normalized.match(/\b(?:orizzontale|colonna|x)\s*[:=]?\s*(\d{1,3})\b/);
    var vertical = normalized.match(/\b(?:verticale|riga|y)\s*[:=]?\s*(\d{1,3})\b/);
    if (horizontal && vertical) {
      var h = Number(horizontal[1]);
      var v = Number(vertical[1]);
      return (v >= 10 ? v : v * 10) + h;
    }
    var pair = normalized.match(/\b(?:coordinate|posizione|casella)\s*[:=]?\s*(\d{1,3})\s*[,;\/\-]\s*(\d{1,3})\b/);
    if (pair) {
      var first = Number(pair[1]);
      var second = Number(pair[2]);
      return (first >= 10 ? first : first * 10) + second;
    }
    return null;
  }

  function removeVowels(text) {
    return String(text || "").replace(/[aeiouAEIOU\u00e0\u00e8\u00e9\u00ec\u00f2\u00f3\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d3\u00d9]/g, "");
  }

  function onlyVowels(text) {
    return (String(text || "").match(/[aeiouAEIOU\u00e0\u00e8\u00e9\u00ec\u00f2\u00f3\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d3\u00d9]/g) || []).join("");
  }

  function withoutSpaces(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function withoutSymbols(text) {
    return String(text || "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  }

  function dateToDmy(value) {
    var text = String(value || "");
    var dmy = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (dmy) {
      var dmyYear = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
      return ("0" + dmy[1]).slice(-2) + "/" + ("0" + dmy[2]).slice(-2) + "/" + dmyYear;
    }
    var iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return ("0" + iso[3]).slice(-2) + "/" + ("0" + iso[2]).slice(-2) + "/" + iso[1];
    }
    return "";
  }

  function dateToIso(value) {
    var text = String(value || "");
    var iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return iso[1] + "-" + ("0" + iso[2]).slice(-2) + "-" + ("0" + iso[3]).slice(-2);
    }
    var dmy = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (dmy) {
      var year = dmy[3].length === 2 ? "20" + dmy[3] : dmy[3];
      return year + "-" + ("0" + dmy[2]).slice(-2) + "-" + ("0" + dmy[1]).slice(-2);
    }
    return "";
  }

  function timeValue(value) {
    var match = String(value || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    return match ? ("0" + match[1]).slice(-2) + ":" + match[2] : "";
  }

  function transformAnswer(record, value) {
    var text = normalizeText(record.questionText || "");
    var kind = (record.inputTypes || [])[0] || "";
    var chars = Array.from(String(value || ""));
    var range = parseRange(record.questionText || "");
    var coordinate = parseGridCoordinate(record.questionText || "");
    var position = parseSinglePosition(record.questionText || "");
    var n;
    if (/\bora\b|hh:mm|orario/.test(text)) {
      var time = timeValue(value);
      if (time) {
        return time;
      }
    }
    if (/\bdata\b|gg\/mm\/aaaa|dd\/mm\/yyyy/.test(text)) {
      var date = kind === "date" ? dateToIso(value) : dateToDmy(value);
      if (date) {
        return date;
      }
    }
    if (coordinate !== null && coordinate >= 0 && coordinate < chars.length) {
      return chars[coordinate];
    }
    if (/solo\s+il\s+carattere\s+dopo\s+il\s+segno|carattere\s+dopo\s+il\s+segno/.test(text)) {
      var signIndex = Array.from(String(value || "")).findIndex(function (ch) {
        return /[^\p{L}\p{N}]/u.test(ch);
      });
      if (signIndex >= 0 && signIndex + 1 < chars.length) {
        return chars[signIndex + 1];
      }
    }
    if (/senza\s+simboli|senza\s+punteggiatura|escludendo\s+i\s+segni/.test(text)) {
      value = withoutSymbols(value);
      chars = Array.from(String(value || ""));
    }
    if (/senza\s+spazi|ignorando\s+gli\s+spazi|non\s+considerando\s+gli\s+spazi/.test(text)) {
      value = withoutSpaces(value);
      chars = Array.from(String(value || ""));
    }
    if (range && range.start && range.end && range.end >= range.start) {
      return chars.slice(range.start - 1, range.end).join("");
    }
    if (position && position.position != null) {
      var index = position.human ? position.position - 1 : position.position;
      if (index >= 0 && index < chars.length) {
        return chars[index];
      }
    }
    if (/(prim[ie].*partendo dalla fine|partendo dalla fine.*prim[ie]|dalla fine.*prim[ie])/.test(text)) {
      n = parseCount(record.questionText || "", "primi|prime");
      if (n) {
        return chars.slice().reverse().slice(0, n).join("");
      }
    }
    if (/ultim[ie]|caratteri finali|lettere finali/.test(text)) {
      n = parseCount(record.questionText || "", "ultimi|ultime|finali|caratteri finali|lettere finali");
      if (n) {
        return chars.slice(-n).join("");
      }
    }
    if (/prim[ie]|caratteri iniziali|lettere iniziali|carattere iniziale/.test(text)) {
      n = parseCount(record.questionText || "", "primi|prime|iniziali|caratteri iniziali|lettere iniziali") || (/carattere iniziale/.test(text) ? 1 : null);
      if (n) {
        return chars.slice(0, n).join("");
      }
    }
    if (/carattere finale|ultimo carattere|ultima lettera/.test(text)) {
      return chars.slice(-1).join("");
    }
    if (/senza\s+vocali/.test(text)) {
      value = removeVowels(value);
    }
    if (/senza\s+consonanti|solo\s+vocali/.test(text)) {
      value = onlyVowels(value);
    }
    if (/minuscol/.test(text)) {
      value = String(value).toLowerCase();
    }
    if (/maiuscol/.test(text)) {
      value = String(value).toUpperCase();
    }
    if (/al\s+contrario|ordine\s+inverso|invert/.test(text)) {
      value = Array.from(String(value)).reverse().join("");
    }
    return compactText(value);
  }

  function isChoiceRecord(record) {
    var types = record.inputTypes || [];
    return types.indexOf("radio") !== -1 || types.indexOf("checkbox") !== -1 || types.indexOf("select") !== -1;
  }

  function buildSuggestion(record, answer) {
    if (!answer) {
      return null;
    }
    if (isChoiceRecord(record)) {
      if (!GH.Matcher || !GH.Matcher.scoreAnswerPresenceInCurrentOptions) {
        return null;
      }
      var presence = GH.Matcher.scoreAnswerPresenceInCurrentOptions(record, answer);
      if (presence.score < 0.78 || presence.ambiguous) {
        return null;
      }
      return {
        source: "personalData",
        answerText: answer,
        answerTexts: splitList(answer),
        confidence: 0.95,
        reason: "dati cliccatore salvati / opzione presente",
        targetOptions: presence.targetOptions,
        answerSetCertain: true,
        textAnswerHint: false
      };
    }
    return {
      source: "personalData",
      answerText: answer,
      answerTexts: [answer],
      confidence: 0.95,
      reason: "dati cliccatore salvati",
      answerSetCertain: true,
      textAnswerHint: true
    };
  }

  function solve(record) {
    if (personalConfig().enabled === false || !record) {
      return null;
    }
    var base = chooseBaseValue(record);
    if (!base) {
      return null;
    }
    return buildSuggestion(record, transformAnswer(record, base));
  }

  async function readData() {
    await init();
    return profile;
  }

  GH.PersonalData = {
    init: init,
    captureFromPage: captureFromPage,
    isDataPage: isDataPage,
    readData: readData,
    getProfile: function () { return profile; },
    getFieldValue: fieldValue,
    chooseBaseValue: chooseBaseValue,
    transformAnswer: transformAnswer,
    solve: solve
  };
})();
