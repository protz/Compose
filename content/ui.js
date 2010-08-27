let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;
let data = window.frameElement.data;

Cu.import("resource:///modules/iteratorUtils.jsm"); // for fixIterator
Cu.import("resource://kompose/compose.js");
Cu.import("resource://kompose/log.js");
let msgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                           .QueryInterface(Ci.nsIMsgComposeService);

Log.debug(data.url, data.msgHdr, data.originalUrl, data.type,
  data.format, data.identity, data.msgWindow, data.KomposeManager);

let mCompType = Ci.nsIMsgCompType;

function onShowAdvancedFields() {
  $("#cc").closest("tr").fadeIn("slow");
  $("#bcc").closest("tr").fadeIn("slow");
  $("#moar").closest("td").fadeOut("slow");
}

function onSendMsg() {
  Log.debug(
      "identity", gIdentities[$("#from").val()],
      "from", $("#from").val(),
      "to", $("#to").val(),
      "cc", $("#cc").val(),
      "bcc", $("#bcc").val(),
      "subject", $("#subject").val(),
      "body", CKEDITOR.instances.editor.getData());
  sendMessage(
    {
      identity: gIdentities[$("#from").val()],
      to: $("#to").val(),
      cc: $("#cc").val(),
      bcc: $("#bcc").val(),
      subject: $("#subject").val(),
      body: CKEDITOR.instances.editor.getData(),
    }, {
      onSuccess: null,
      onFailure: null,
    });
}

let gIdentities = [];

function setupIdentities() {
  let msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                            .getService(Ci.nsIMsgAccountManager);
  let $select = $("#from");
  let wantedId = data.identity || msgComposeService.defaultIdentity;
  let i = 0;
  for each (let id in fixIterator(msgAccountManager.allIdentities, Ci.nsIMsgIdentity)) {
    let selected = (id == wantedId) ? "selected" : "";
    $select.append($("<option></option>")
      .attr("selected", selected)
      .attr("value", i++)
      .text(id.fullName + " <"+id.email+">")
    );
    gIdentities.push(id);
  }
}

function setupReply() {
  Log.assert(data.msgHdr, "How can I reply to an empty MsgHdr?");

  try {
    quoteMessage(
      data.msgHdr,
      document.getElementById("secret"),
      function (aHtml) {
        document.getElementById("editor").textContent =
          "<p></p><blockquote type='cite'>"+aHtml+"</blockquote>";
        CKEDITOR.replace("editor");
      });
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

function setupEditor() {
  try {
    Log.debug("data.type is", data.type);
    switch (data.type) {
      case mCompType.New:
        CKEDITOR.replace("editor");
        break;

      case mCompType.Reply:
      case mCompType.ReplyAll:
      case mCompType.ReplyToSender:
      case mCompType.ReplyToGroup:
      case mCompType.ReplyToSenderAndGroup:
      case mCompType.ReplyWithTemplate:
      case mCompType.ReplyToList:
        setupReply();
        break;
    }
    setupIdentities();
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

window.addEventListener("load", setupEditor, false);
