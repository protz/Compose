let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;
let data = window.frameElement.data;

Cu.import("resource:///modules/iteratorUtils.jsm"); // for fixIterator
Cu.import("resource:///modules/XPCOMUtils.jsm"); // for generateQI
Cu.import("resource://kompose/compose.js");
Cu.import("resource://kompose/log.js");
Cu.import("resource://people/modules/people.js");
Cu.import("resource://kompose/conv/MsgHdrUtils.jsm"); // for getMessageBody

const msgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                            .QueryInterface(Ci.nsIMsgComposeService);
const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                        .getService(Ci.nsIMsgHeaderParser);
const msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                            .getService(Ci.nsIMsgAccountManager);
const msgComposePrefs = Cc["@mozilla.org/preferences-service;1"]
                          .getService(Ci.nsIPrefService)
                          .getBranch("msgcompose.");
const mCompType = Ci.nsIMsgCompType;

let KomposeManager = data.KomposeManager;
Log.debug("Kompose loaded", data.url, data.msgHdr, data.originalUrl, data.type,
  data.format, data.identity, data.msgWindow, data.KomposeManager);

// --- UI callbacks

function deferSendMsg(aCompType) {
  let iframe = document.getElementsByTagName("iframe")[0];
  sendMessage( {
      identity: gIdentities[$("#from").val()],
      to: $("#to").val(),
      cc: $("#cc").val(),
      bcc: $("#bcc").val(),
      subject: $("#subject").val(),
    }, data, iframe, {
      progressListener: progressListener,
      sendListener: sendListener,
    }, aCompType);
}

function onSendMsg() {
  deferSendMsg(Ci.nsIMsgCompDeliverMode.Now);
}

function onSaveAsDraft() {
  deferSendMsg(Ci.nsIMsgCompDeliverMode.SaveAsDraft);
}

$(window).keydown(function (event) {
  if (event.metaKey && event.which == 13) {
    Log.debug("Triggered the keyboard shortcut, sending...");
    onSendMsg();
    return false; // otherwise it gets fired twice
  }
});

// --- Stuff that fills composition fields, including body, properly

let gIdentities = [];
let gOldDraftToDelete = null;

// Fill the dropdown with all available identities
function setupIdentities() {
  let $select = $("#from");
  let wantedId = data.identity || msgComposeService.defaultIdentity;
  let i = 0;
  for each (let id in fixIterator(msgAccountManager.allIdentities, Ci.nsIMsgIdentity)) {
    let selected = (id == wantedId) ? "selected" : "";
    $select.append($("<option></option>")
      .attr("selected", selected)
      .attr("value", i)
      .text(id.fullName + " <"+id.email+">")
    );
    gIdentities[i] = id;
    i++;
  }
}

function wrapFormatting(aHtml) {
  let fgColor = msgComposePrefs.getCharPref("text_color");
  let bgColor = msgComposePrefs.getCharPref("background_color");
  let fontFace = msgComposePrefs.getCharPref("font_face");
  let fontSize = msgComposePrefs.getCharPref("font_size");
  let style =
    "font-family: "+fontFace+"; " +
    "font-size: "+fontSize+"; " +
    "color: "+fgColor+"; " +
    "background-color: "+bgColor+";"
  ;
  return ('<body style="'+style+'">'+aHtml+'</body>');
}

// Just get the email and/or name from a MIME-style "John Doe <john@blah.com>"
//  line.
function parse(aMimeLine) {
  let emails = {};
  let fullNames = {};
  let names = {};
  let numAddresses = gHeaderParser.parseHeadersWithArray(aMimeLine, emails, names, fullNames);
  return [names.value, emails.value];
}

function setupDraft(prePopulateData) {
  let [recipients, recipientsEmailAddresses] = parse(data.msgHdr.mime2DecodedRecipients);
  let [ccList, ccListEmailAddresses] = parse(data.msgHdr.ccList);
  let [bccList, bccListEmailAddresses] = parse(data.msgHdr.bccList);
  prePopulateData.to = [asToken(null, r, recipientsEmailAddresses[i], null)
    for each ([i, r] in Iterator(recipients))];
  prePopulateData.cc = [asToken(null, cc, ccListEmailAddresses[i], null)
    for each ([i, cc] in Iterator(ccList))];
  prePopulateData.bcc = [asToken(null, bcc, bccListEmailAddresses[i], null)
    for each ([i, bcc] in Iterator(bccList))];
  gOldDraftToDelete = data.msgHdr;

  try {
    quoteMessage(
      data.msgHdr,
      document.getElementById("secret"),
      function (aHtml) {
        document.getElementById("editor").textContent = wrapFormatting(aHtml);
        replaceEditor();
      }
    );
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

function setupForwardInline() {
  let from = data.msgHdr.mime2DecodedAuthor;
  let to = data.msgHdr.mime2DecodedRecipients;
  let cc = data.msgHdr.ccList;
  let date = (new Date(data.msgHdr.date/1000)).toLocaleString();
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
  $("#subject").val("Fwd: "+data.msgHdr.mime2DecodedSubject);
  try {
    quoteMessage(
      data.msgHdr,
      document.getElementById("secret"),
      function (aHtml) {
        document.getElementById("editor").textContent =
          wrapFormatting(quoteSigAndStart(header + aHtml,false,true));
        replaceEditor({cursorOnTop:1});
      }
    );
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

function setupReply(prePopulateData) {
  Log.assert(data.msgHdr, "How can I reply to an empty MsgHdr?");

  $("#subject").val("Re: "+data.msgHdr.mime2DecodedSubject);

  let [author, authorEmailAddress] = parse(data.msgHdr.mime2DecodedAuthor);
  let [recipients, recipientsEmailAddresses] = parse(data.msgHdr.mime2DecodedRecipients);
  let [ccList, ccListEmailAddresses] = parse(data.msgHdr.ccList);
  let [bccList, bccListEmailAddresses] = parse(data.msgHdr.bccList);

  let isReplyToOwnMsg = false;
  for each (let [i, identity] in Iterator(gIdentities)) {
    let email = identity.email;
    if (email == authorEmailAddress)
      isReplyToOwnMsg = true;
    if (recipientsEmailAddresses.filter(function (x) x == email).length)
      isReplyToOwnMsg = false;
    if (ccListEmailAddresses.filter(function (x) x == email).length)
      isReplyToOwnMsg = false;
  }

  // Actually we are implementing the "Reply all" logic... that's better, no one
  //  wants to really use reply anyway ;-)
  if (isReplyToOwnMsg) {
    Log.debug("Replying to our own message...");
    prePopulateData.to = [asToken(null, r, recipientsEmailAddresses[i], null)
      for each ([i, r] in Iterator(recipients))];
  } else {
    prePopulateData.to = [asToken(null, author, authorEmailAddress, null)];
  }
  prePopulateData.cc = [asToken(null, cc, ccListEmailAddresses[i], null)
    for each ([i, cc] in Iterator(ccList))
    if (ccListEmailAddresses[i] != data.identity.email)];
  if (!isReplyToOwnMsg)
    prePopulateData.cc = prePopulateData.cc.concat
      ([asToken(null, r, recipientsEmailAddresses[i], null)
        for each ([i, r] in Iterator(recipients))
        if (recipientsEmailAddresses[i] != data.identity.email)]);
  prePopulateData.bcc = [asToken(null, bcc, bccListEmailAddresses[i], null)
    for each ([i, bcc] in Iterator(bccList))];

  try {
    quoteMessage(
      data.msgHdr,
      document.getElementById("secret"),
      function (aHtml) {
        document.getElementById("editor").textContent =
          wrapFormatting(quoteSigAndStart(aHtml,true));
        replaceEditor();
      }
    );
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

function quoteSigAndStart(quote, wrap_quote, top_cursor) {
  ///pre/post-pends a blank paragraph depending on settings
  ///TODO: include signature in the right place, too
  var front = '', back='';
  if (wrap_quote) {
    quote = "<blockquote type='cite'>"+quote+"</blockquote>";
  }
  if (data.identity.replyOnTop > 0 || top_cursor) {
    front += '<p class="start"></p>\n';
  }
  if (data.identity.replyOnTop !== 1) {
    back += '\n<p class="start"></p>';
  }
  return (front + quote + back);
}

function asToken(thumb, name, email, guid) {
  let hasName = name && (String.trim(name).length > 0);
  let data = hasName ? name + " <" + email + ">" : email;
  let thumbStr = thumb ? "<img class='autocomplete-thumb' src=\""+thumb+"\" /> " : "";
  let nameStr = hasName ? name + " &lt;" + email + "&gt;" : email;
  let listItem = thumbStr + nameStr;
  let id = guid;
  let displayName = hasName ? name : email;
  return { name: displayName, listItem: listItem, data: data, id: guid }
}

function peopleAutocomplete(query, callback) {
  let results = [];
  let dupCheck = {};
  let add = function(person) {
    let photos = person.getProperty("photos");
    let thumb;
    for each (let photo in photos) {
      if (photo.type == "thumbnail") {
        thumb = photo.value;
        break;
      }
    }

    let suggestions = person.getProperty("emails");
    for each (let suggestion in suggestions)
    {
      if (dupCheck[suggestion.value])
        continue;
      dupCheck[suggestion.value] = 1;
      results.push(asToken(thumb, person.displayName, suggestion.value, person.guid));
    }
  };
  try {
    // Contacts doesn't seem to allow a OR, so run two queries... (longer)
    People.find({ displayName: query }).forEach(add);
    People.find({ emails: query }).forEach(add);
  } catch(e) {
    Log.error(e);
    dumpCallStack(e);
  }
  if (!results.length)
    results.push(asToken(null, null, query, query));
  callback(results);
}

let autoCompleteClasses = {
  tokenList: "token-input-list-facebook",
  token: "token-input-token-facebook",
  tokenDelete: "token-input-delete-token-facebook",
  selectedToken: "token-input-selected-token-facebook",
  highlightedToken: "token-input-highlighted-token-facebook",
  dropdown: "token-input-dropdown-facebook",
  dropdownItem: "token-input-dropdown-item-facebook",
  dropdownItem2: "token-input-dropdown-item2-facebook",
  selectedDropdownItem: "token-input-selected-dropdown-item-facebook",
  inputToken: "token-input-input-token-facebook"
}

function setupAutocomplete(prePopulateData) {
  $("#to").tokenInput(peopleAutocomplete, {
    classes: autoCompleteClasses,
    prePopulate: prePopulateData.to,
  });
  $("#cc").tokenInput(peopleAutocomplete, {
    classes: autoCompleteClasses,
    prePopulate: prePopulateData.cc,
  });
  $("#bcc").tokenInput(peopleAutocomplete, {
    classes: autoCompleteClasses,
    prePopulate: prePopulateData.bcc,
  });
}

function replaceEditor(opts) {
  $("#editor").ckeditor(function _on_ckeditor_ready(editorInstance) {
    let sel = this.window.$.getSelection(),
        doc = this.document.$,
        rng = doc.createRange(),
        cursorOnTop = opts && opts.cursorOnTop || data.identity.replyOnTop;
    sel.removeAllRanges();
    switch (cursorOnTop) {
    case 0:
      var n = doc.getElementsByClassName('start');
      if (n.length) {
	var bottom = n[n.length-1];
	rng.selectNode(bottom);
	rng.collapse(true);
	doc.body.scrollTop = bottom.offsetTop + parseInt(this.window.$.innerHeight / 2);
      }
      break;
    case 1:
      rng.selectNode(doc.body.firstChild);
      rng.collapse(true);
      break;
    case 2:
      var n = doc.getElementsByTagName('blockquote');
      if (n.length) {
	rng.selectNode(n[0]);
      }
      break;
    }
    sel.addRange(rng);

    if (!opts || opts.focus) {
      this.focus();
    }

  });
}

function setupEditor() {
  try {
    setupIdentities();

    let prePopulateData = { to: null, cc: null, bcc: null };
    switch (data.type) {
      case mCompType.New:
        document.getElementById("editor").textContent = wrapFormatting("");
        replaceEditor({focus:false});
        break;

      case mCompType.Reply:
      case mCompType.ReplyAll:
      case mCompType.ReplyToSender:
      case mCompType.ReplyToGroup:
      case mCompType.ReplyToSenderAndGroup:
      case mCompType.ReplyWithTemplate:
      case mCompType.ReplyToList:
        setupReply(prePopulateData);
        break;

      case mCompType.ForwardInline:
        setupForwardInline();
        break;

      case mCompType.Draft:
        setupDraft(prePopulateData);
        break;

      default:
        document.getElementById("editor").textContent =
          "mCompType: " + data.type + " (unsupported)";
        replaceEditor();
    }
    setupAutocomplete(prePopulateData);
    setupProgressDialog();
    $("#to").focus();
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

// --- Listeners.
//
// These are notified about the outcome of the send process and take the right
//  action accordingly (close window on success, etc. etc.)

function pValue (v) {
  $("#progressBar")
    .progressbar("value", v)
    .find(".ui-progressbar-value")
    .css("background-image", "none");
}

function pUndetermined () {
  $("#progressBar")
    .progressbar("value", 100)
    .find(".ui-progressbar-value")
    .css("background-image", "url(chrome://kompose/content/jquery-ui/css/ui-lightness/images/pbar-ani.gif)");
}

function pText (t) {
  $("#progressText").text(t);
}

// all progress notifications are done through the nsIWebProgressListener implementation...
let progressListener = {
  onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
    Log.debug("onStateChange", aWebProgress, aRequest, aStateFlags, aStatus);
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
      pUndetermined();
      $("#progress").dialog('open');
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      pValue(0);
      pText('');
      $("#progress").dialog('close');
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

function closeTab() {
  window.top.document.getElementById("tabmail").closeTab(data.tabObject);
}

let sendListener = {
  /**
   * Notify the observer that the message has started to be delivered. This method is
   * called only once, at the beginning of a message send operation.
   *
   * @return The return value is currently ignored.  In the future it may be
   * used to cancel the URL load..
   */
  onStartSending: function (aMsgID, aMsgSize) {
  },

  /**
   * Notify the observer that progress as occurred for the message send
   */
  onProgress: function (aMsgID, aProgress, aProgressMax) {
  },

  /**
   * Notify the observer with a status message for the message send
   */
  onStatus: function (aMsgID, aMsg) {
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
    // This function is called only when the actual send has been performed,
    //  i.e. is not called when saving a draft (although msgCompose.SendMsg is
    //  called...)
    if (!(aStatus & 0x80000000)) {
      // NS_SUCCEEDED
      if (gOldDraftToDelete)
        msgHdrsDelete([gOldDraftToDelete]);
      closeTab();
    } else {
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
    if (!(aStatus & 0x80000000)) {
      // NS_SUCCEEDED
      if (gOldDraftToDelete)
        msgHdrsDelete(gOldDraftToDelete);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIMsgCopyServiceListener,
    Ci.nsISupports
  ]),
}

function setupProgressDialog() {
  $("#progress").dialog({
    autoOpen: false,
    title: "Sending message...",
    minHeight: 10,
  });
  $("#progressBar").progressbar();
}

window.addEventListener("load", setupEditor, false);
