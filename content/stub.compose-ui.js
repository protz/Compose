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

let gComposeSession;

function initialize (aComposeParams) {
  let doStuff = function () {
    // Create the new composition session
    gComposeSession = new ComposeSession(aComposeParams);
    gComposeSession.setupIdentities();
    gComposeSession.setupMiscFields();
    gComposeSession.setupAutocomplete();
    gComposeSession.setupQuote();
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
  $(window).keydown(function (event) {
    if (event.metaKey && event.which == 13) {
      Log.debug("Triggered the keyboard shortcut, sending...");
      gComposeSession.send();
      return false; // otherwise it gets fired twice
    }
  });
}

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
}

ComposeSession.prototype = {
  setupIdentities: function () {
    let $select = $("#from");
    let wantedId = this.iComposeParams.identity || gMsgComposeService.defaultIdentity;
    for each (let [email, id] in Iterator(gIdentities)) {
      if (email == "default")
        continue;
      let selected = (id.email == wantedId.email) ? "selected" : "";
      let v = id.fullName + " <"+id.email+">";
      $select.append($("<option></option>")
        .attr("selected", selected)
        .attr("value", id.email)
        .text(v)
      );
    }
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
        break;

      default:
        break;
    }
    $("#subject").val(v);
  },

  setupAutocomplete: function () {
    let k = function (to, cc, bcc) {
      // defined in stub.completion-ui.js
      setupAutocomplete(to, cc, bcc);
    };
    switch (this.iComposeParams.type) {
      case gCompType.New:
      case gCompType.ForwardAsAttachment:
      case gCompType.ForwardInline:
      case gCompType.NewsPost:
      case gCompType.Template:
      case gCompType.Redirect:
        setupAutocomplete([], [], []);
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

      case gCompType.ReplyWithTemplate:
      case gCompType.ReplyToGroup:
      case gCompType.ReplyToSenderAndGroup:
      case gCompType.ReplyAll:
      case gCompType.Draft:
        this._setupAutocomplete(true, k);
        break;
    }
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
    let params = replyAllParams(identity, msgHdr);
    let to = [asToken(null, name, email, null) for each ([name, email] in params.to)];
    let cc = [asToken(null, name, email, null) for each ([name, email] in params.cc)];
    let bcc = [asToken(null, name, email, null) for each ([name, email] in params.bcc)];

    let mimeMsg = this.iComposeParams.mimeMsg;
    if ("reply-to" in mimeMsg.headers) {
      let [{ name, email }] = parseMimeLine(mimeMsg.headers["reply-to"]);
      if (email) {
        to = [asToken(null, name, email, null)];
      }
    }
    if (aReplyAll)
      k(to, cc, bcc);
    else
      k(to, [], []);
  },

  setupQuote: function () {
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
    let quoteAndWrap = function (aText, k) {
      quoteMsgHdr(this.iComposeParams.msgHdr, function (body) {
        let html =
          wrapWithFormatting("<p></p>")
          + aText +
          "<blockquote type='cite'>"
            + extractBody(body) +
          "</blockquote>"
        ;
        k(html);
      });
    }.bind(this);

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
        let body;
        try {
          (function search (obj) {
            if (obj instanceof MimeBody) {
              body = obj.body;
              throw null;
            } else if ("parts" in obj) {
              [search(x) for each (x in obj.parts)];
            }
          })(mimeMsg);
        } catch (e) {
        }
        setupEditor(body);
        break;
      }

      default:
        setupEditor(wrapWithFormatting(""), {
          focus: false
        });
        break;
    }
  },

  send: function (event, options) {
    let identity = gIdentities[$("#from").val()];
    let iframe = document.getElementsByTagName("iframe")[0];
    let to = $("#to").val();
    let cc = $("#cc").val();
    let bcc = $("#bcc").val();
    Log.debug("To:", to, "Cc:", cc, "Bcc:", bcc);
    let deliverType = Ci.nsIMsgCompDeliverMode.Now;
    let attachments = $(".attachments")
      .children()
      .map(function () createAttachment($(this).data("file")))
      .get();
    let urls = this.iComposeParams.originalUrl.split(",");
    return sendMessage({
        urls: urls,
        identity: identity,
        to: to,
        cc: cc,
        bcc: bcc,
        subject: $("#subject").val(),
        attachments: attachments,
      }, {
        compType: this.iComposeParams.type, // XXX check if this is really meaningful
        deliverType: deliverType,
      }, { match: function (x) {
        x.editor(iframe);
      }}, {
        progressListener: progressListener,
        sendListener: sendListener,
        stateListener: createStateListener(deliverType),
      }, {
        popOut: false,
        archive: false,
      });
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
  Log.debug(v+"%");
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
  Log.debug(t);
  return;
  $(".statusMessage").text(t);
}

// all progress notifications are done through the nsIWebProgressListener implementation...
let progressListener = {
  onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
    Log.debug("onStateChange", aWebProgress, aRequest, aStateFlags, aStatus);
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
    Log.debug("onProgressChange", aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress);
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

let sendListener = {
  /**
   * Notify the observer that the message has started to be delivered. This method is
   * called only once, at the beginning of a message send operation.
   *
   * @return The return value is currently ignored.  In the future it may be
   * used to cancel the URL load..
   */
  onStartSending: function (aMsgID, aMsgSize) {
    pText("Sending message...");
    $("textarea, #send, #sendArchive").attr("disabled", "disabled");
    Log.debug("onStartSending", aMsgID, aMsgSize);
  },

  /**
   * Notify the observer that progress as occurred for the message send
   */
  onProgress: function (aMsgID, aProgress, aProgressMax) {
    Log.debug("onProgress", aMsgID, aProgress, aProgressMax);
  },

  /**
   * Notify the observer with a status message for the message send
   */
  onStatus: function (aMsgID, aMsg) {
    Log.debug("onStatus", aMsgID, aMsg);
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
    // if (aExitCode == NS_ERROR_SMTP_SEND_FAILED_UNKNOWN_SERVER ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_UNKNOWN_REASON ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_REFUSED ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_INTERRUPTED ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_TIMEOUT ||
    //     aExitCode == NS_ERROR_SMTP_PASSWORD_UNDEFINED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_FAILURE ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_GSSAPI ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_MECH_NOT_SUPPORTED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_NOT_SUPPORTED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_ENCRYPT_TO_PLAIN_NO_SSL ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_ENCRYPT_TO_PLAIN_SSL ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_PLAIN_TO_ENCRYPT ||
    //     aExitCode == NS_ERROR_STARTTLS_FAILED_EHLO_STARTTLS)
    //
    // Moar in mailnews/compose/src/nsComposeStrings.h
    Log.debug("onStopSending", aMsgID, aStatus, aMsg, aReturnFile);
    $("textarea, #send, #sendArchive").attr("disabled", "");
    // This function is called only when the actual send has been performed,
    //  i.e. is not called when saving a draft (although msgCompose.SendMsg is
    //  called...)
    if (NS_SUCCEEDED(aStatus)) {
      //if (gOldDraftToDelete)
      //  msgHdrsDelete([gOldDraftToDelete]);
      pText("Message "+aMsgID+" sent successfully"); 
    } else {
      pText("Couldn't send the message.");
      Log.debug("NS_FAILED onStopSending");
    }
  },

  /**
   * Notify the observer with the folder uri before the draft is copied.
   */
  onGetDraftFolderURI: function (aFolderURI) {
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
}

let copyListener = {
  onStopCopy: function (aStatus) {
    Log.debug("onStopCopy", aStatus);
    if (NS_SUCCEEDED(aStatus)) {
      //if (gOldDraftToDelete)
      //  msgHdrsDelete(gOldDraftToDelete);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIMsgCopyServiceListener,
    Ci.nsISupports
  ]),
}

function createStateListener (aDeliverType) {
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
      switch (aDeliverType) { 
        case Ci.nsIMsgCompDeliverMode.Now:
          if (NS_SUCCEEDED(aResult)) {
            closeTab(); // defined from the outside, see monkeypatch.js
          } else {
            // The usual error handlers will notify the user for us.
          }
          break;

        default:
          Log.error("Send process completed without a handler.");
      }
    },

    SaveInFolderDone: function(folderURI) {
      // DisplaySaveFolderDlg(folderURI);
    }
  };
}
