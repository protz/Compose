/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Compose in a tab
 *
 * The Initial Developer of the Original Code is
 * Mozilla messaging
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let Ci = Components.interfaces;
let Cc = Components.classes;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm"); // for generateQI
Cu.import("resource:///modules/MailUtils.js"); // for getFolderForURI
Cu.import("resource:///modules/gloda/mimemsg.js"); // For MsgHdrToMimeMessage

const gMsgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                            .QueryInterface(Ci.nsIMsgComposeService);
const gMessenger = Cc["@mozilla.org/messenger;1"]
                   .createInstance(Ci.nsIMessenger);
const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                      .getService(Ci.nsIMsgHeaderParser);
const ioService = Cc["@mozilla.org/network/io-service;1"]
                  .getService(Ci.nsIIOService);
// Various composition types:
//  New                      = 0;
//  Reply                    = 1;
//  ReplyAll                 = 2;
//  ForwardAsAttachment      = 3;
//  ForwardInline            = 4;
//  NewsPost                 = 5;
//  ReplyToSender            = 6;
//  ReplyToGroup             = 7;
//  ReplyToSenderAndGroup    = 8;
//  Draft                    = 9;
//  Template                 = 10;
//  MailToUrl                = 11;
//  ReplyWithTemplate        = 12;
//  ReplyToList              = 13;
//  Redirect                 = 14;
const gCompType = Ci.nsIMsgCompType;

Cu.import("resource://kompose/stdlib/msgHdrUtils.js");
Cu.import("resource://kompose/stdlib/misc.js");
Cu.import("resource://kompose/stdlib/send.js");
Cu.import("resource://kompose/stdlib/compose.js");
Cu.import("resource://kompose/misc.js");
Cu.import("resource://kompose/log.js");

let Log = setupLogging("Compose.Stub");

const kReasonSent = 0;
const kReasonClosed = 1;
const kReasonDiscard = 2;

let isOSX = ("nsILocalFileMac" in Components.interfaces);
function isAccel (event) (isOSX && event.metaKey || event.ctrlKey)

let gComposeSession;

function initialize () {
  // Rebuild the various compose parameters from the URI.
  let aComposeParams = decodeUrlParameters(document.location.href);
  aComposeParams.identity = aComposeParams.identity
    ? gIdentities[aComposeParams.identity]
    : gIdentities["default"];
  aComposeParams.msgHdr = aComposeParams.msgHdr.length
    ? msgUriToMsgHdr(aComposeParams.msgHdr)
    : null;
  aComposeParams.type = parseInt(aComposeParams.type);

  let doStuff = function () {
    // Create the new composition session
    gComposeSession = new ComposeSession(aComposeParams);
    gComposeSession.setupIdentities();
    gComposeSession.setupMiscFields();
    gComposeSession.setupAutocomplete();
    gComposeSession.setupQuote();
    // Once these four have completed, they'll run gComposeSession.setupFinal()
  };
  if (aComposeParams.msgHdr) {
    MsgHdrToMimeMessage(aComposeParams.msgHdr, this, function (aMsgHdr, aMimeMessage) {
      aComposeParams.mimeMsg = aMimeMessage;
      doStuff();
    }, true);
  } else {
    doStuff();
  }

  // Register extra event listeners
  window.addEventListener("keydown", function (event) {
    switch (event.keyCode) {
      case KeyEvent.DOM_VK_RETURN:
        if (isAccel(event))
          onSend();
        break;

      case 'S'.charCodeAt(0):
        if (isAccel(event))
          onSave();
        break;
    }
  }, false);
}

$(document).ready(function () {
  initialize();
});

function ComposeSession (aComposeParams) {
  // Initial composition parameters.
  //  aComposeParams = {
  //    url,
  //    msgHdr,
  //    originalUrl,
  //    type,
  //    format,
  //    identity,
  //    msgWindow,
  //    monkeyPatch,
  //  }
  this.iComposeParams = aComposeParams;
  this.originalDraft = null;
  // This is a function, because by the time we get the information about the
  // newly saved draft (right after saving it), the message header might not be
  // ready yet... so we need to delay access to it.
  this.currentDraft = function () null;
  this._modified = false;
  this._count = 4; // setupIdentities, setupMiscFields, setupQuote, setupAutocomplete
}

ComposeSession.prototype = {
  set modified (v) {
    Log.debug("Setting this.modified to", v);
    dumpCallStack();
    this._modified = v;
  },

  get modified () {
    return this._modified;
  },

  _top: function () {
    if (!--this._count)
      this.setupFinal();
  },

  setupIdentities: function () {
    let $select = $("#from");
    let wantedId = this.iComposeParams.identity || gMsgComposeService.defaultIdentity;
    for each (let [email, id] in Iterator(gIdentities)) {
      if (email == "default")
        continue;
      let selected = (id.email == wantedId.email) ? "selected" : "";
      let v = formatIdentity(id);
      $select.append($("<option></option>")
        .attr("selected", selected)
        .attr("value", id.email)
        .text(v)
      );
    }
    let self = this;
    $select.change(function () {
      self.modified = true;
    });
    this._top();
  },

  /**
   * This function sets up various fields, such as subject, attachments, etc.
   */
  setupMiscFields: function () {
    let subject;
    if (this.iComposeParams.msgHdr)
      subject = this.iComposeParams.msgHdr.mime2DecodedSubject;
    let v = "";
    switch (this.iComposeParams.type) {
      case gCompType.Reply:
      case gCompType.ReplyAll:
      case gCompType.ReplyToSender:
      case gCompType.ReplyToGroup:
      case gCompType.ReplyToSenderAndGroup:
      case gCompType.ReplyWithTemplate:
      case gCompType.ReplyToList:
        v = "Re: "+subject;
        break;

      case gCompType.ForwardAsAttachment: {
        let uris = this.iComposeParams.originalUrl.split(",");
        for each (let [i, uri] in Iterator(uris)) {
          let msgHdr = msgUriToMsgHdr(uri);
          addAttachmentItem({
            name: msgHdr.mime2DecodedSubject+".eml",
            url: uri,
            size: 0,
          });
          subject = msgHdr.mime2DecodedSubject;
        }
        // FALL-THROUGH
      }
      case gCompType.ForwardInline:
        v = "Fwd: "+subject;
        break;

      case gCompType.Draft:
        v = subject;
        for each (let att in this.iComposeParams.mimeMsg.allUserAttachments) {
          // XXX this means we can't delete the original draft until we're done.
          addAttachmentItem(att); // Magically works. Hurray!
        }
        this.originalDraft = this.iComposeParams.msgHdr;
        break;

      default:
        break;
    }
    $("#subject").val(v);
    let self = this;
    $("#subject").change(function () {
      self.modified = true;
    });
    this._top();
  },

  setupAutocomplete: function () {
    let self = this;
    let k = function (to, cc, bcc) {
      // defined in stub.completion-ui.js
      setupAutocomplete(to, cc, bcc);
      $("#to, #cc, #bcc").change(function () {
        self.modified = true;
      });
      self._top();
    };
    switch (this.iComposeParams.type) {
      case gCompType.New:
      case gCompType.ForwardAsAttachment:
      case gCompType.ForwardInline:
      case gCompType.NewsPost:
      case gCompType.Template:
      case gCompType.Redirect:
        k([], [], []);
        $("#to").focus();
        break;

      case gCompType.MailToUrl:
        this._setupAutocompleteMailto(k);
        break;

      case gCompType.ReplyToList:
        this._setupAutocompleteList(k);
        break;

      case gCompType.Reply:
      case gCompType.ReplyToSender:
        this._setupAutocomplete(false, k);
        break;

      case gCompType.Draft:
        this._setupAutocompleteDraft(k);
        break;

      case gCompType.ReplyWithTemplate:
      case gCompType.ReplyToGroup:
      case gCompType.ReplyToSenderAndGroup:
      case gCompType.ReplyAll:
        this._setupAutocomplete(true, k);
        break;
    }
  },

  RE_LIST_POST: /<mailto:([^>]+)>/,

  _setupAutocompleteList: function (k) {
    let aMimeMsg = this.iComposeParams.mimeMsg;
    if (aMimeMsg && aMimeMsg.has("list-post")) {
      let match = this.RE_LIST_POST.exec(aMimeMsg.get("list-post"));
      if (match) {
        let listAddress = match[1];
        k([asToken(null, "", listAddress, null)], [], []);
      }
    }
  },

  _setupAutocompleteDraft: function (k) {
    let from = parseToPairs(this.iComposeParams.msgHdr.mime2DecodedAuthor);
    let to = parseToPairs(this.iComposeParams.msgHdr.mime2DecodedRecipients);
    let cc = parseToPairs(this.iComposeParams.msgHdr.ccList);
    let bcc = parseToPairs(this.iComposeParams.msgHdr.bccList);

    let fromEmail = from[0][1];
    $("#from").val(fromEmail);
    let pTo = [asToken(null, name, email, null) for each([name, email] in to)];
    let pCc = [asToken(null, name, email, null) for each([name, email] in cc)];
    let pBcc = [asToken(null, name, email, null) for each([name, email] in bcc)];
    k(pTo, pCc, pBcc);
  },

  /**
   * This function takes care of determining who should be the recipient, who
   *  should be cc'd, bcc'd, what happens if I'm replying to my own message, what
   *  happens if there's a reply-to header...
   */
  _setupAutocomplete: function (aReplyAll, k) {
    let msgHdr = this.iComposeParams.msgHdr;
    let identity = this.iComposeParams.identity;
    // Do the whole shebang to find out who to send to...
    replyAllParams(identity, msgHdr, function (params) {
      let to = [asToken(null, name, email, null) for each ([name, email] in params.to)];
      let cc = [asToken(null, name, email, null) for each ([name, email] in params.cc)];
      let bcc = [asToken(null, name, email, null) for each ([name, email] in params.bcc)];
      if (aReplyAll)
        k(to, cc, bcc);
      else
        k(to, [], []);
    });
  },

  setupQuote: function () {
    let self = this;
    let msgHdr = this.iComposeParams.msgHdr;
    let date = msgHdr && (new Date(msgHdr.date/1000)).toLocaleString();
    let from = msgHdr && escapeHtml(msgHdr.mime2DecodedAuthor);
    let to = msgHdr && escapeHtml(msgHdr.mime2DecodedRecipients);
    let cc = msgHdr && escapeHtml(msgHdr.ccList);
    let editor = document.getElementById("editor");

    let setupEditor = function (aHtml, aOpts) {
      let focus = !aOpts || aOpts.focus;

      editor.textContent = aHtml;
      // Let's say we just implement reply on top for the moment...
      $("#editor").ckeditor(function _on_ckeditor_ready(editorInstance) {
        let sel = this.window.$.getSelection(),
            doc = this.document.$,
            rng = doc.createRange();
        sel.removeAllRanges();
        rng.selectNode(doc.body.firstChild);
        rng.collapse(true);
        sel.addRange(rng);
        if (focus)
          this.focus();
        let iframe = document.getElementsByTagName("iframe")[0];
        // AFAIK, ckeditor has no "onchange" event, see
        // http://dev.ckeditor.com/ticket/900
        let html = iframe.contentDocument.body.innerHTML;
        (function poll () {
          let newHtml = iframe.contentDocument.body.innerHTML;
          if (newHtml != html)
            self.modified = true;
          html = newHtml;
          // 250ms is too much, it slows things down when you are typing
          setTimeout(poll, 1000);
        })();
        self._top();
      });
    };
    // Don't know why, but the Thunderbird quoting code sometimes just appends
    // </body>\n</html> at the end of the string, without the opening tags... so
    // do some regexp-foo to get rid of them.
    let extractBody = function (aHtml)
      aHtml
      // aHtml.replace(/(?:.|\s)*<body>((.|\s)*)<\/body>(?:.|\s)*/m, "$1")
      //   .replace(/<\/body>\s*<\/html>\s*/m, "")
    ;
    let self = this;
    let quoteAndWrap = function (aText, k) {
      quoteMsgHdr(self.iComposeParams.msgHdr, function (body) {
        let html =
          wrapWithFormatting("<p></p>")
          + aText +
          "<blockquote type='cite'>"
            + extractBody(body) +
          "</blockquote>"
        ;
        k(html);
      });
    };

    switch (this.iComposeParams.type) {
      case gCompType.ForwardAsAttachment:
        setupEditor("");
        break;

      case gCompType.ForwardInline: {
        let ccLine = cc.length ?  "  Cc: " + cc + "<br />\n" : "";
        let header = [
          "---------- Original Message ----------\n",
          "<div class='forwarded_header_block'>\n",
          "  From: ", from, "<br />\n",
          "  To: ", to, "<br />\n",
          ccLine,
          "  Date: ", date, "\n",
          "</div>"
        ].join("");
        quoteAndWrap(header, setupEditor);
        break;
      }

      case gCompType.ReplyToList:
      case gCompType.Reply:
      case gCompType.ReplyToSender:
      case gCompType.ReplyWithTemplate:
      case gCompType.ReplyToGroup:
      case gCompType.ReplyToSenderAndGroup:
      case gCompType.ReplyAll: {
        let header = "On " + date + ", " + from + " wrote:";
        quoteAndWrap(header, setupEditor);
        break;
      }

      case gCompType.Draft: {
        let mimeMsg = this.iComposeParams.mimeMsg;
        let bodies = [];
        (function search (obj) {
          if (obj instanceof MimeBody && bodies.length < 2) {
            bodies.push(obj);
          } else if ("parts" in obj) {
            [search(x) for each (x in obj.parts)];
          }
        })(mimeMsg);
        if (bodies.length > 0 && bodies[0].contentType == "text/html")
          setupEditor(bodies[0].body);
        else if (bodies.length > 1 && bodies[1].contentType == "text/html")
          setupEditor(bodies[1].body);
        else if (bodies.length > 0)
          setupEditor("<pre>"+bodies[0].body+"</pre>");
        break;
      }

      default:
        setupEditor(wrapWithFormatting(""), {
          focus: false
        });
        break;
    }
  },

  setupFinal: function () {
    let compType = this.iComposeParams.type;
    if (compType == gCompType.Draft) {
      // We want to create a working draft. If we close the window immediately,
      // after opening it, because it hasn't been modified, the original draft
      // will be deleted, so we have to have the working draft.
      onSave(true);
    }
  },

  send: function (options) {
    let identity = gIdentities[$("#from").val()];
    let iframe = document.getElementsByTagName("iframe")[0];
    let to = $("#to").val();
    let cc = $("#cc").val();
    let bcc = $("#bcc").val();
    let deliverType = Ci.nsIMsgCompDeliverMode.Now;
    if (options && ("deliverType" in options))
      deliverType = options.deliverType;
    let compType = this.iComposeParams.type;
    if (options && ("compType" in options))
      compType = options.compType;
    let k = function () {};
    if (options && ("k" in options))
      k = options.k;
    let attachments = $(".attachments")
      .children()
      .map(function () createAttachment($(this).data("file")))
      .get();
    let urls = this.iComposeParams.originalUrl
      ? this.iComposeParams.originalUrl.split(",")
      : []
    ;
    // The various listeners will enrich obj with several pieces of inforamtion,
    // and then the state listener will call k and pass it obj, so that the UI
    // code can act upon that and whatever it needs to do.
    let obj = {};
    obj.msgCompose = sendMessage({
        urls: urls,
        identity: identity,
        to: to,
        cc: cc,
        bcc: bcc,
        subject: $("#subject").val(),
        attachments: attachments,
      }, {
        compType: compType,
        deliverType: deliverType,
      }, { match: function (x) {
        x.editor(iframe);
      }}, {
        progressListener: progressListener,
        sendListener: createSendListener(obj),
        stateListener: createStateListener(obj, k),
      }, {
        popOut: false,
        archive: false,
      });
  },

  cleanup: function (aReason) {
    switch (aReason) {
      case kReasonSent:
      case kReasonDiscard:
        if (this.originalDraft)
          msgHdrsDelete([this.originalDraft]);
        let currentDraft = this.currentDraft();
        if (currentDraft)
          msgHdrsDelete([currentDraft]);
        break;

      case kReasonClosed:
        // We assume whoever called us made sure everything was saved properly.
        // Now the new draft is this.currentDraft, which of course don't want to
        // delete.
        if (this.originalDraft)
          msgHdrsDelete([this.originalDraft]);
    }
  },

};

// ----- Main logic

function createAttachment({ name, url, size }) {
  let attachment = Cc["@mozilla.org/messengercompose/attachment;1"]
                   .createInstance(Ci.nsIMsgAttachment);
  attachment.url = url;
  attachment.name = name;
  Log.debug(url, name);
  return attachment;
}


// ----- Listeners.
//
// These are notified about the outcome of the send process and take the right
//  action accordingly (close window on success, etc. etc.)

function pValue (v) {
  //Log.debug(v+"%");
  return;
  $(".statusPercentage")
    .show()
    .text(v+"%");
  $(".statusThrobber").hide();
}

function pUndetermined () {
  return;
  $(".statusPercentage").hide();
  $(".statusThrobber").show();
}

function pText (t) {
  //Log.debug(t);
  return;
  $(".statusMessage").text(t);
}

// all progress notifications are done through the nsIWebProgressListener implementation...
let progressListener = {
  onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
    //Log.debug("onStateChange", aWebProgress, aRequest, aStateFlags, aStatus);
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
      pUndetermined();
      $(".quickReplyHeader").show();
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      pValue(0);
      pText('');
    }
  },

  onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
    //Log.debug("onProgressChange", aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress);
    // Calculate percentage.
    var percent;
    if (aMaxTotalProgress > 0) {
      percent = Math.round( (aCurTotalProgress*100)/aMaxTotalProgress );
      if (percent > 100)
        percent = 100;

      // Advance progress meter.
      pValue(percent);
    } else {
      // Progress meter should be barber-pole in this case.
      pUndetermined();
    }
  },

  onLocationChange: function(aWebProgress, aRequest, aLocation) {
    // we can ignore this notification
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
    pText(aMessage);
  },

  onSecurityChange: function(aWebProgress, aRequest, state) {
    // we can ignore this notification
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebProgressListener,
    Ci.nsISupports
  ]),
};

function createSendListener(obj) {
  return {
    /**
     * Notify the observer that the message has started to be delivered. This method is
     * called only once, at the beginning of a message send operation.
     *
     * @return The return value is currently ignored.  In the future it may be
     * used to cancel the URL load..
     */
    onStartSending: function (aMsgID, aMsgSize) {
      pText("Sending message...");
      //$("textarea, #send, #sendArchive").attr("disabled", "disabled");
      Log.debug("onStartSending", aMsgID, aMsgSize);
    },

    /**
     * Notify the observer that progress as occurred for the message send
     */
    onProgress: function (aMsgID, aProgress, aProgressMax) {
      //Log.debug("onProgress", aMsgID, aProgress, aProgressMax);
    },

    /**
     * Notify the observer with a status message for the message send
     */
    onStatus: function (aMsgID, aMsg) {
      //Log.debug("onStatus", aMsgID, aMsg);
    },

    /**
     * Notify the observer that the message has been sent.  This method is 
     * called once when the networking library has finished processing the 
     * message.
     * 
     * This method is called regardless of whether the the operation was successful.
     * aMsgID   The message id for the mail message
     * status   Status code for the message send.
     * msg      A text string describing the error.
     * returnFileSpec The returned file spec for save to file operations.
     */
    onStopSending: function (aMsgID, aStatus, aMsg, aReturnFile) {
      // Error codes in mailnews/compose/src/nsComposeStrings.h
      // Looks like this method is not called when saving as draft.
      Log.debug("onStopSending", aMsgID, aStatus, aMsg, aReturnFile);
      //$("textarea, #send, #sendArchive").attr("disabled", "");
      if (NS_SUCCEEDED(aStatus)) {
        pText("Message "+aMsgID+" sent successfully"); 
        obj.messageId = aMsgID;
      } else {
        pText("Couldn't send the message.");
        Log.debug("NS_FAILED onStopSending");
      }
    },

    /**
     * Notify the observer with the folder uri before the draft is copied.
     */
    onGetDraftFolderURI: function (aFolderURI) {
      obj.folderUri = aFolderURI;
      Log.debug("onGetDraftFolderURI", aFolderURI);
    },

    /**
     * Notify the observer when the user aborts the send without actually doing the send
     * eg : by closing the compose window without Send.
     */
    onSendNotPerformed: function (aMsgID, aStatus) {
      Log.debug("onSendNotPerformed", aMsgID, aStatus);
    },

    QueryInterface: XPCOMUtils.generateQI([
      Ci.nsIMsgSendListener,
      Ci.nsISupports
    ]),
  };
}

let copyListener = {
  onStopCopy: function (aStatus) {
    Log.debug("onStopCopy", aStatus);
    if (NS_SUCCEEDED(aStatus)) {
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIMsgCopyServiceListener,
    Ci.nsISupports
  ]),
}

function createStateListener (obj, k) {
  return {
    NotifyComposeFieldsReady: function() {
      // ComposeFieldsReady();
    },

    NotifyComposeBodyReady: function() {
      // if (gMsgCompose.composeHTML)
      //   loadHTMLMsgPrefs();
      // AdjustFocus();
    },

    ComposeProcessDone: function(aResult) {
      Log.debug("ComposeProcessDone", aResult, NS_SUCCEEDED(aResult));
      if (NS_SUCCEEDED(aResult)) {
        Log.debug("Calling k", k);
        k(obj);
      } else {
        // The usual error handlers will notify the user for us.
      }
    },

    SaveInFolderDone: function(folderURI) {
      Log.debug(folderURI);
      // DisplaySaveFolderDlg(folderURI);
    }
  };
}
