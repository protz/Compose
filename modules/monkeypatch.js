var EXPORTED_SYMBOLS = ['MonkeyPatch']

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource://kompose/log.js");
Cu.import("resource://kompose/stdlib/msgHdrUtils.js");

let Log = setupLogging("Compose.MonkeyPatch");
let kComposeUrl = "chrome://kompose/content/stub.html";

let composeTabType = {
  name: "composeTab",
  perTabPanel: "vbox",
  lastId: 0,

  modes: {
    composeTab: {
      type: "composeTab",
      maxTabs: 10
    }
  },

  // Always open new conversation windows. Not true if we try to edit a draft that
  // already has an associated conversation window open, but that's for later...
  shouldSwitchTo: function onSwitchTo() {
    return -1;
  },

  openTab: function onTabOpened(aTab, aArgs) {
    let window = getMail3Pane();

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
    aTab.title = "Conversation View";
    browser.addEventListener("load", function _onload (event) {
      browser.removeEventListener("load", _onload, true);
      aArgs.onLoad(event, browser);
    }, true);
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
      getMail3Pane()
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
        
        getMail3Pane()
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
};

function MonkeyPatch (aWindow) {
  getMail3Pane(true);
  this.window = aWindow;  
}

MonkeyPatch.prototype = {
  install: function _MonkeyPatch_install () {
    let self = this;

    // Register our new tab type...
    this.tabmail = this.window.document.getElementById("tabmail");  
    this.tabmail.registerTabType(composeTabType);

    // Ideally, we would replace the nsMsgComposeService with our own, but for the
    //  time being, let's just stick to that monkey-patch. When it's about time,
    //  we'll just register a new XPCOM component with the same contract-id
    //  (@messenger/compose;1) and it'll be fine.
    // This is just a copy/paste of the code from the original function. Simply,
    //  we pass the control flow to the old ComposeMessage function in the case
    //  of newsgroups.
    let oldComposeMessage = this.window.ComposeMessage;
    this.window.ComposeMessage = function _ComposeMessage_patched (type, format, folder, messageArray) {
      let msgComposeType = Ci.nsIMsgCompType;
      let identity = null;
      let newsgroup = null;
      let server;

      // dump("ComposeMessage folder=" + folder + "\n");
      try {
        if (folder) {
          // Get the incoming server associated with this uri.
          server = folder.server;

          // We don't handle newsgroups, period.
          if (!folder.isServer && server.type == "nntp") {
            oldComposeMessage.call(this, type, format, folder, messageArray);
            return;
          }

          identity = folder.customIdentity;
          if (!identity)
            identity = self.window.getIdentityForServer(server);
          // dump("identity = " + identity + "\n");
        }
      } catch (ex) {
        dump("failed to get an identity to pre-select: " + ex + "\n");
      }

      // dump("\nComposeMessage from XUL: " + identity + "\n");
      var uri = null;

      if (!self.window.msgComposeService) {
        dump("### msgComposeService is invalid\n");
        return;
      }

      if (type == msgComposeType.New) {
        // New message.

        // dump("OpenComposeWindow with " + identity + "\n");

        // If the addressbook sidebar panel is open and has focus, get
        // the selected addresses from it.
        // XXX shouldn't we handle that case as well?
        let document = self.window.document;
        if (document.commandDispatcher.focusedWindow &&
            document.commandDispatcher.focusedWindow
                    .document.documentElement.hasAttribute("selectedaddresses"))
          self.window.NewMessageToSelectedAddresses(type, format, identity);
        else
          self.OpenComposeWindow(null, null, null, type, format, identity, msgWindow);
        return;
      } else if (type == msgComposeType.NewsPost) {
        // dump("OpenComposeWindow with " + identity + " and " + newsgroup + "\n");
        self.window.OpenComposeWindow(null, null, newsgroup, type, format, identity, msgWindow);
        return;
      }

      let msgWindow = self.window.msgWindow;
      self.window.messenger.setWindow(self.window, msgWindow);

      let object = null;

      if (messageArray && messageArray.length > 0) {
        uri = "";
        for (let i = 0; i < messageArray.length; ++i) {
          let messageUri = messageArray[i];

          let hdr = self.window.messenger.msgHdrFromURI(messageUri);
          identity = self.window.getIdentityForHeader(hdr, type);
          if (/^https?:/.test(hdr.messageId))
            self.window.openComposeWindowForRSSArticle(hdr, type);
          else if (type == msgComposeType.Reply ||
                   type == msgComposeType.ReplyAll ||
                   type == msgComposeType.ReplyToList ||
                   type == msgComposeType.ForwardInline ||
                   type == msgComposeType.ReplyToGroup ||
                   type == msgComposeType.ReplyToSender ||
                   type == msgComposeType.ReplyToSenderAndGroup ||
                   type == msgComposeType.Template ||
                   type == msgComposeType.Redirect ||
                   type == msgComposeType.Draft) {
            self.OpenComposeWindow(null, hdr, messageUri, type, format, identity, msgWindow);
            // Limit the number of new compose windows to 8. Why 8 ? I like that number :-)
            if (i == 7)
              break;
          }
          else
          {
            if (i)
              uri += ","
            uri += messageUri;
          }
        }
        // If we have more than one ForwardAsAttachment then pass null instead
        // of the header to tell the compose service to work out the attachment
        // subjects from the URIs.
        if (type == msgComposeType.ForwardAsAttachment && uri)
          self.OpenComposeWindow(null,
                                              messageArray.length > 1 ? null : hdr,
                                              uri, type, format,
                                              identity, msgWindow);
      } else {
        dump("### nodeList is invalid\n");
      }
    };

    Log.debug("Monkey-patch applied");
  },

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
      let self = this;
      let newTab = this.tabmail.openTab("composeTab", {
        onLoad: function (event, browser) {
          browser.contentWindow.initialize({
            url: aUrl,
            msgHdr: aMsgHdr,
            originalUrl: aOriginalUrl,
            type: aType,
            format: aFormat,
            identity: aIdentity,
            msgWindow: aMsgWindow,
            monkeyPatch: self,
          });
        }
      });
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  },
};
