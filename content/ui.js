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

const msgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                            .QueryInterface(Ci.nsIMsgComposeService);
const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                        .getService(Ci.nsIMsgHeaderParser);
const msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                            .getService(Ci.nsIMsgAccountManager);
const mCompType = Ci.nsIMsgCompType;

Log.debug("Kompose loaded", data.url, data.msgHdr, data.originalUrl, data.type,
  data.format, data.identity, data.msgWindow, data.KomposeManager);

function onShowAdvancedFields() {
  $("#cc").closest("tr").fadeIn("slow");
  $("#bcc").closest("tr").fadeIn("slow");
  $("#moar").closest("td").fadeOut("slow");
}

function onSendMsg() {
  let body = CKEDITOR.instances.editor.getData();
  let iframe = document.getElementsByTagName("iframe")[0];
  // We're Thunderbird, so make sure we send 1999-style HTML!
  body = 
    "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\">\n"+
    "<html>\n"+
    "  <head>\n"+
    "    <meta http-equiv=\"content-type\" content=\"text/html;\n"+
    "      charset=ISO-8859-1\">\n"+
    "  </head>\n"+
    "  <body bgcolor=\"#ffffff\" text=\"#000000\">\n"+
    "    "+body+"\n"+
    "  </body>\n"+
    "</html>\n";
  // Never, EVER, forget the trailing newline. I mean it, man.

  // XXX is it even useful to pass the body at that point? We're overriding
  // m_composeHTML anyway, which means nsMsgSend gets the body from the editor.
  sendMessage(
    {
      identity: gIdentities[$("#from").val()],
      to: $("#to").val(),
      cc: $("#cc").val(),
      bcc: $("#bcc").val(),
      subject: $("#subject").val(),
      body: body,
    }, data, iframe, progressListener);
}

let gIdentities = [];

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

function parse(aMimeLine) {
  let emails = {};
  let fullNames = {};
  let names = {};
  let numAddresses = gHeaderParser.parseHeadersWithArray(aMimeLine, emails, names, fullNames);
  return [names.value, emails.value];
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

  if (isReplyToOwnMsg) {
    prePopulateData.to = [asToken(null, r, recipientsEmailAddresses[i], null)
      for each ([i, r] in Iterator(recipients))];
  } else {
    prePopulateData.to = [asToken(null, author, authorEmailAddress, null)];
  }
  prePopulateData.cc = [asToken(null, cc, ccListEmailAddresses[i], null)
    for each ([i, cc] in Iterator(ccList))];
  prePopulateData.bcc = [asToken(null, bcc, bccListEmailAddresses[i], null)
    for each ([i, bcc] in Iterator(bccList))];

  try {
    quoteMessage(
      data.msgHdr,
      document.getElementById("secret"),
      function (aHtml) {
        document.getElementById("editor").textContent =
          "<p><span id='startMarker'></span></p><blockquote type='cite'>"+aHtml+"</blockquote>";
        replaceEditor();
      }
    );
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
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

function replaceEditor() {
  $("#editor").ckeditor(function _on_ckeditor_ready() {
    return;
    // Try to move the caret BEFORE the quoted text...
    let p = self.document.getElementsByTag("p")[0];
    self.getSelection().selectElement(p);
  });
}

function setupEditor() {
  try {
    setupIdentities();

    let prePopulateData = { to: null, cc: null, bcc: null };
    switch (data.type) {
      case mCompType.New:
        replaceEditor();
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
    }
    setupAutocomplete(prePopulateData);
    setupProgressDialog();
    $("#to").focus();
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

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
    onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus)
    {
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

    onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress)
    {
      Log.debug("onProgressChange", aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress);
      // Calculate percentage.
      var percent;
      if ( aMaxTotalProgress > 0 ) {
        percent = Math.round( (aCurTotalProgress*100)/aMaxTotalProgress );
        if ( percent > 100 )
          percent = 100;

        // Advance progress meter.
        pValue(percent);
      } else {
        // Progress meter should be barber-pole in this case.
        pUndetermined();
      }
    },

    onLocationChange: function(aWebProgress, aRequest, aLocation)
    {
      // we can ignore this notification
    },

    onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage)
    {
      pText(aMessage);
    },

    onSecurityChange: function(aWebProgress, aRequest, state)
    {
      // we can ignore this notification
    },

    QueryInterface: XPCOMUtils.generateQI([
      Ci.nsIWebProgressListener,
      Ci.nsISupportsWeakReference,
      Ci.nsISupports
    ]),
};

function setupProgressDialog() {
  $("#progress").dialog({
    autoOpen: false,
    title: "Sending message...",
    minHeight: 10,
  });
  $("#progressBar").progressbar();
}

window.addEventListener("load", setupEditor, false);
