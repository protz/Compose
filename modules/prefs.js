var EXPORTED_SYMBOLS = ["Prefs"]

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

const prefsService = Cc["@mozilla.org/preferences-service;1"]
  .getService(Ci.nsIPrefService)
  .getBranch("conversations.");
const gPrefBranch = Cc["@mozilla.org/preferences-service;1"]
  .getService(Ci.nsIPrefService)
  .getBranch(null);

function PrefManager() {
  this.register();
}

PrefManager.prototype = {

  split: function (s) Array.map(s.split(","), String.trim).filter(String.trim),

  register: function mpo_register (observer) {
    prefsService.QueryInterface(Components.interfaces.nsIPrefBranch2);
    if (observer)
      prefsService.addObserver("", observer, false);
    else
      prefsService.addObserver("", this, false);
  },

  unregister: function mpo_unregister () {
    if (!prefsService)
      return;
    prefsService.removeObserver("", this);
  },

  observe: function mpo_observe (aSubject, aTopic, aData) {
    if (aTopic != "nsPref:changed")
      return;

    switch (aData) {
    }
  },

  getChar: function (p) {
    return gPrefBranch.getCharPref(p);
  },

  getInt: function (p) {
    return gPrefBranch.getIntPref(p);
  },

  getBool: function (p) {
    return gPrefBranch.getBoolPref(p);
  },

  getString: function (p) {
    return gPrefBranch.getComplexValue(p, Ci.nsISupportsString).data;
  },

  setChar: function (p, v) {
    return gPrefBranch.setCharPref(p, v);
  },

  setInt: function (p, v) {
    return gPrefBranch.setIntPref(p, v);
  },

  setBool: function (p, v) {
    return gPrefBranch.setBoolPref(p, v);
  },

  setString: function (p, v) {
    let str = Cc["@mozilla.org/supports-string;1"]
              .createInstance(Ci.nsISupportsString);
    str.data = v;
    return gPrefBranch.setComplexValue(p, Ci.nsISupportsString, str);
  },
}

// Prefs is a singleton.
let Prefs = new PrefManager();
