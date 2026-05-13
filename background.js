"use strict";

var CONTENT_FILES = [
  "config.js",
  "personal-data.js",
  "dataset-loader.js",
  "parser.js",
  "matcher.js",
  "rules-engine.js",
  "learner.js",
  "highlighter.js",
  "content.js"
];

function isTargetUrl(url) {
  return /^https?:\/\/([^/]+\.)?simulatoreclickday\.it\//i.test(String(url || ""));
}

async function injectIntoExistingTabs(reason) {
  if (!chrome.tabs || !chrome.scripting) {
    return;
  }
  var tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(function (tab) {
    return tab.id && isTargetUrl(tab.url);
  }).map(function (tab) {
    return chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_FILES
    }).catch(function () {
      // Some pages cannot receive extension scripts. Future navigations are covered by manifest content_scripts.
    });
  }));
}

chrome.runtime.onInstalled.addListener(function () {
  injectIntoExistingTabs("installed");
});

chrome.runtime.onStartup.addListener(function () {
  injectIntoExistingTabs("startup");
});
