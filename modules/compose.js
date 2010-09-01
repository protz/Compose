var EXPORTED_SYMBOLS = ['sendMessage', 'quoteMessage']

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource:///modules/XPCOMUtils.jsm"); // for generateQI
Cu.import("resource://kompose/log.js");

const msgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                           .QueryInterface(Ci.nsIMsgComposeService);
const messenger = Cc["@mozilla.org/messenger;1"].createInstance()
                   .QueryInterface(Ci.nsIMessenger);
const msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"].createInstance()
                   .QueryInterface(Ci.nsIMsgWindow);
const accountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                        .getService(Ci.nsIMsgAccountManager);
const mCompType = Ci.nsIMsgCompType;

const kCharsetFromMetaTag = 10;

/**
 * Get a nsIURI from a nsIMsgDBHdr
 * @param {nsIMsgDbHdr} aMsgHdr The message header
 * @return {nsIURI}
 */
function msgHdrToNeckoURL(aMsgHdr) {
  let uri = aMsgHdr.folder.getUriForMsg(aMsgHdr);
  let neckoURL = {};
  let msgService = messenger.messageServiceFromURI(uri);
  msgService.GetUrlForUri(uri, neckoURL, null);
  return neckoURL.value;
}

function range(begin, end) {
  for (let i = begin; i < end; ++i) {
    yield i;
  }
}

function FakeEditor (aIframe) {
  this.iframe = aIframe;
}

FakeEditor.prototype = {
  getEmbeddedObjects: function _FakeEditor_getEmbeddedObjects () {
    try {
      let objects = Cc["@mozilla.org/supports-array;1"]
                      .createInstance(Ci.nsISupportsArray);
      for each (let [, o] in Iterator(this.iframe.contentDocument.getElementsByTagName("img")))
        objects.AppendElement(o, false);
      return objects;
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  },

  outputToString: function _FakeEditor_outputToString (formatType, flags) {
    let r =
      "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\">\n"+
      "<html>\n"+
      "  <head>\n"+
      "    <meta http-equiv=\"content-type\" content=\"text/html;\n"+
      "      charset=ISO-8859-1\">\n"+
      "  </head>\n"+
      "  <body bgcolor=\"#ffffff\" text=\"#000000\">\n"+
      "    "+this.iframe.contentDocument.body.innerHTML+"\n"+
      "  </body>\n"+
      "</html>\n"
    ;
    return r;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIEditor, Ci.nsIEditorMailSupport]),
}

/**
 * Actually send the message based on the given parameters.
 */
function sendMessage({ identity, to, cc, bcc, subject, body },
    { url, msgHdr, originalUrl, type, format, msgWindow, KomposeManager },
    aIframe, { progressListener, sendListener }) {

  // Here is the part where we do all the stuff related to filling proper
  //  headers, adding references, making sure all the composition fields are
  //  properly set before assembling the message.
  let fields = Cc["@mozilla.org/messengercompose/composefields;1"]
                  .createInstance(Ci.nsIMsgCompFields);
  fields.from = identity.fullName + " <" + identity.email + ">";
  fields.to = to;
  fields.cc = cc;
  fields.bcc = bcc;
  fields.subject = subject;
  fields.body = body;

  let references = [];
  switch (type) {
    case mCompType.New:
      break;

    case mCompType.Reply:
    case mCompType.ReplyAll:
    case mCompType.ReplyToSender:
    case mCompType.ReplyToGroup:
    case mCompType.ReplyToSenderAndGroup:
    case mCompType.ReplyWithTemplate:
    case mCompType.ReplyToList:
      references = [msgHdr.getStringReference(i)
        for each (i in range(0, msgHdr.numReferences))];
      references.push(msgHdr.messageId);
      break;

    case mCompType.ForwardAsAttachment:
    case mCompType.ForwardInline:
      references.push(msgHdr.messageId);
      break;
  }
  references = ["<"+x+">" for each ([, x] in Iterator(references))];
  fields.references = references.join(", ");

  // TODO:
  // - fields.addAttachment (when attachments taken into account)

  //fields.forcePlainText = true;
  //fields.useMultipartAlternative = true;
  //fields.ConvertBodyToPlainText();

  // We probably want to change the format to be always HTML so that we don't
  //  need to override m_composeHTML later on.
  let params = Cc["@mozilla.org/messengercompose/composeparams;1"]
                  .createInstance(Ci.nsIMsgComposeParams);
  params.composeFields = fields;
  params.identity = identity;
  params.type = Ci.nsIMsgCompType.New;
  params.format = Ci.nsIMsgCompFormat.Default;
  params.sendListener = sendListener;

  // This part initializes a nsIMsgCompose instance. This is useless, because
  //  that component is supposed to talk to the "real" compose window, set the
  //  encoding, set the composition mode... we're only doing that because we
  //  can't send the message ourselves because of too many [noscript]s.
  let msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                            .getService(Ci.nsIMsgAccountManager);

  let msgCompose = msgComposeService.InitCompose (null, params);
  let fakeEditor = new FakeEditor(aIframe, body);
  msgCompose.composeHTML = true;
  msgCompose.editor = fakeEditor;

  // We create a progress listener...
  var progress = Cc["@mozilla.org/messenger/progress;1"]
                   .createInstance(Ci.nsIMsgProgress);
  if (progress) {
    progress.registerListener(progressListener);
  }
  //msgCompose.RegisterStateListener(stateListener);

  try {
    msgCompose.SendMsg (Ci.nsIMsgCompDeliverMode.Now, identity, "", null, progress);
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
  return true;
}

const kXulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * Find out what's the quoted HTML for the given message header. This is done by
 * inserting a XUL iframe into the div, getting its innerHTML, removing it and
 * and calling k when done.
 */
function quoteMessage(msgHdr, div, k) {
  let iframe = div.ownerDocument.createElementNS(kXulNs, "iframe");
  iframe.setAttribute("type", "content");

  iframe.addEventListener("load", function f_temp2(event, aCharset) {
    try {
      iframe.removeEventListener("load", f_temp2, true);

      // The second load event is triggered by loadURI with the URL
      // being the necko URL to the given message.
      iframe.addEventListener("load", function f_temp1(event) {
        try {
          iframe.removeEventListener("load", f_temp1, true);
          k(iframe.contentDocument.body.innerHTML);
          iframe.parentNode.removeChild(iframe);
        } catch (e) {
          Log.error(e);
          dumpCallStack(e);
        }
      }, true); /* end iframe.addEventListener */

      let url = msgHdrToNeckoURL(msgHdr);
      let uri = msgHdr.folder.getUriForMsg(msgHdr);

      /* These steps are mandatory. Basically, the code that loads the
       * messages will always output UTF-8 as the OUTPUT ENCODING, so
       * we need to tell the iframe's docshell about it. */
      let cv = iframe.docShell.contentViewer;
      cv.QueryInterface(Ci.nsIMarkupDocumentViewer);
      cv.hintCharacterSet = "UTF-8";
      cv.hintCharacterSetSource = kCharsetFromMetaTag;
      iframe.docShell.appType = Components.interfaces.nsIDocShell.APP_TYPE_MAIL;

      let messageService = messenger.messageServiceFromURI(url.spec);
      let urlListener = {
        OnStartRunningUrl: function () {},
        OnStopRunningUrl: function () {},
        QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIUrlListener])
      };
      iframe.webNavigation.loadURI(url.spec+"?header=quotebody",
        iframe.webNavigation.LOAD_FLAGS_IS_LINK, null, null, null);
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  }, true); /* end document.addEventListener */

  div.appendChild(iframe);
}
