var EXPORTED_SYMBOLS = ['KomposeManager']

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource://kompose/log.js");

let kComposeUrl = "chrome://kompose/content/stub.html";

function KomposeManager () {
  this.window = Cc["@mozilla.org/appshell/window-mediator;1"]  
                   .getService(Ci.nsIWindowMediator)  
                   .getMostRecentWindow("mail:3pane");  
  this.tabmail = this.window.document.getElementById("tabmail");  
  this.tabmail.registerTabType(this.composeTabType);
}

KomposeManager.prototype = {
  // /* we need a msg window because when we forward inline we may need progress */
  // void OpenComposeWindow(in string msgComposeWindowURL,
  //                        in nsIMsgDBHdr msgHdr,
  //                        in string originalMsgURI,
  //                        in MSG_ComposeType type, 
  //                        in MSG_ComposeFormat format,
  //                        in nsIMsgIdentity identity, 
  //                        in nsIMsgWindow aMsgWindow);
  OpenComposeWindow: function (aUrl, aMsgHdr, aOriginalUrl, aType, aFormat, aIdentity, aMsgWindow) {
    try {
      let newTab = this.tabmail.openTab("composeTab", {
        url: aUrl,
        msgHdr: aMsgHdr,
        originalUrl: aOriginalUrl,
        type: aType,
        format: aFormat,
        identity: aIdentity,
        msgWindow: aMsgWindow,
        KomposeManager: this,
      });
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  },

  composeTabType: {
    name: "composeTab",
    perTabPanel: "vbox",
    lastId: 0,

    modes: {
      composeTab: {
        type: "composeTab",
        maxTabs: 10
      }
    },

    // Always open new compose windows. Not true if we try to edit a draft that
    // already has an associated compose window open, but that's for later...
    shouldSwitchTo: function onSwitchTo() {
      return -1;
    },

    openTab: function onTabOpened(aTab, aArgs) {
      aTab.KomposeManager = aArgs.KomposeManager;
      let window = aTab.KomposeManager.window;

      // First clone the page and set up the basics.
      let browser = window.document.getElementById("dummychromebrowser").cloneNode(true);
      browser.setAttribute("tooltip", "aHTMLTooltip");
      browser.setAttribute("id", "composeTab-" + this.lastId);
      browser.setAttribute("onclick", "specialTabs.defaultClickHandler(event);");
      browser.data = aArgs;
      browser.data.tabObject = aTab;

      // Done.
      aTab.panel.appendChild(browser);
      aTab.browser = browser;

      // Now set up the listeners.
      this._setUpTitleListener(aTab);
      this._setUpCloseWindowListener(aTab);

      // Now start loading the content.
      aTab.title = "Compose";
      browser.loadURI(kComposeUrl);

      this.lastId++;
    },

    closeTab: function onTabClosed(aTab) {
      aTab.browser.removeEventListener("DOMTitleChanged",
                                       aTab.titleListener, true);
      aTab.browser.removeEventListener("DOMWindowClose",
                                       aTab.closeListener, true);
      aTab.browser.destroy();
    },

    saveTabState: function onSaveTabState(aTab) {
    },

    showTab: function onShowTab(aTab) {
    },

    persistTab: function onPersistTab(aTab) {
      // TODO save the current tab's status. Save the msgHdr through its URI
    },

    restoreTab: function onRestoreTab(aTabmail, aPersistedState) {
      // TODO create a new tab with the same status...
    },

    onTitleChanged: function onTitleChanged(aTab) {
      aTab.title = aTab.browser.contentDocument.title;
    },

    supportsCommand: function supportsCommand(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
        case "cmd_fullZoomEnlarge":
        case "cmd_fullZoomReset":
        case "cmd_fullZoomToggle":
        case "cmd_printSetup":
        case "cmd_print":
        case "button_print":
        // XXX print preview not currently supported - bug 497994 to implement.
        // case "cmd_printpreview":
          return true;
        default:
          return false;
      }
    },

    isCommandEnabled: function isCommandEnabled(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
        case "cmd_fullZoomEnlarge":
        case "cmd_fullZoomReset":
        case "cmd_fullZoomToggle":
        case "cmd_printSetup":
        case "cmd_print":
        case "button_print":
        // XXX print preview not currently supported - bug 497994 to implement.
        // case "cmd_printpreview":
          return true;
        default:
          return false;
      }
    },

    doCommand: function isCommandEnabled(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
          ZoomManager.reduce();
          break;
        case "cmd_fullZoomEnlarge":
          ZoomManager.enlarge();
          break;
        case "cmd_fullZoomReset":
          ZoomManager.reset();
          break;
        case "cmd_fullZoomToggle":
          ZoomManager.toggleZoom();
          break;
        case "cmd_printSetup":
          PrintUtils.showPageSetup();
          break;
        case "cmd_print":
          PrintUtils.print();
          break;
        // XXX print preview not currently supported - bug 497994 to implement.
        //case "cmd_printpreview":
        //  PrintUtils.printPreview();
        //  break;
      }
    },

    getBrowser: function getBrowser(aTab) {
      return aTab.browser;
    },

    // Internal function used to set up the title listener on a content tab.
    _setUpTitleListener: function setUpTitleListener(aTab) {
      function onDOMTitleChanged(aEvent) {
        aTab.KomposeManager.window
          .document.getElementById("tabmail").setTabTitle(aTab);
      }
      // Save the function we'll use as listener so we can remove it later.
      aTab.titleListener = onDOMTitleChanged;
      // Add the listener.
      aTab.browser.addEventListener("DOMTitleChanged",
                                    aTab.titleListener, true);
    },
    /**
     * Internal function used to set up the close window listener on a content
     * tab.
     */
    _setUpCloseWindowListener: function setUpCloseWindowListener(aTab) {
      function onDOMWindowClose(aEvent) {
        try {
          if (!aEvent.isTrusted)
            return;

          // Redirect any window.close events to closing the tab. As a 3-pane tab
          // must be open, we don't need to worry about being the last tab open.
          
          aTab.KomposeManager.window
            document.getElementById("tabmail").closeTab(aTab);
          aEvent.preventDefault();
        } catch (e) {
          logException(e);
        }
      }
      // Save the function we'll use as listener so we can remove it later.
      aTab.closeListener = onDOMWindowClose;
      // Add the listener.
      aTab.browser.addEventListener("DOMWindowClose",
                                    aTab.closeListener, true);
    }
  },
};
