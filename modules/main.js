var EXPORTED_SYMBOLS = ['Kompose']

function Kompose(aWindow) {
  this._window = aWindow;
}

Kompose.prototype = {
  new: function () {
    let tabmail = this._window.document.getElementById("tabmail");
    // so unsafe, OMG
    tabmail.openTab("chromeTab", {
      chromePage: "chrome://kompose/content/stub.html",
    });
  },
};
