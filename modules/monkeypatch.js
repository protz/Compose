var EXPORTED_SYMBOLS = ['MonkeyPatch']

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource://kompose/stdlib/misc.js");
Cu.import("resource://kompose/log.js");
Cu.import("resource://kompose/stdlib/msgHdrUtils.js");

let Log = setupLogging("Compose.MonkeyPatch");
let kComposeUrl = "chrome://kompose/content/stub.html";

function MonkeyPatch (aWindow) {
  getMail3Pane(true);
  this.window = aWindow;  
}

MonkeyPatch.prototype = {
  install: function _MonkeyPatch_install () {
    let self = this;

    // Register our new tab type...
    this.tabmail = this.window.document.getElementById("tabmail");  

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
      let params = {
        // url: aUrl, // unused
        msgHdr: aMsgHdr,
        originalUrl: aOriginalUrl,
        type: aType,
        // format: aFormat, // unused
        identity: aIdentity,
        // msgWindow: aMsgWindow, // unused
        // monkeyPatch: self, // unused
      };
      params.msgHdr = msgHdrGetUri(params.msgHdr);
      params.identity = params.identity.email;
      let url = kComposeUrl+"?"+encodeUrlParameters(params);
      let newTab = this.tabmail.openTab("chromeTab", {
        chromePage: url,
      });
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  },
};
