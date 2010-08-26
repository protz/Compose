var EXPORTED_SYMBOLS = ['sendMessage', 'quoteMessage']

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
let Cr = Components.results;

Cu.import("resource:///modules/XPCOMUtils.jsm"); // for generateQI
Cu.import("resource://kompose/log.js");

let msgComposeService = Cc["@mozilla.org/messengercompose;1"].getService()
                           .QueryInterface(Ci.nsIMsgComposeService);
let messenger = Cc["@mozilla.org/messenger;1"].createInstance()
                   .QueryInterface(Ci.nsIMessenger);
let msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"].createInstance()
                   .QueryInterface(Ci.nsIMsgWindow);
let accountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                        .getService(Ci.nsIMsgAccountManager);

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

/**
 * Actually send the message based on the given parameters.
 */
function sendMessage({ to, cc, bcc, subject, body }, { onSuccess, onFailure }) {
  let fields = Cc["@mozilla.org/messengercompose/composefields;1"]
                  .createInstance(Ci.nsIMsgCompFields);
  fields.to = to;
  fields.cc = cc;
  fields.bcc = bcc;
  fields.subject = subject;
  fields.body = body;

  // we'll get this from the UI eventually
  fields.from = msgComposeService.defaultIdentity.email;

  //fields.forcePlainText = true;
  fields.useMultipartAlternative = true;

  let params = Cc["@mozilla.org/messengercompose/composeparams;1"]
                  .createInstance(Ci.nsIMsgComposeParams);
  params.composeFields = fields;
  params.identity = msgComposeService.defaultIdentity;
  params.type = Ci.nsIMsgCompType.New;
  params.format = Ci.nsIMsgCompFormat.Default;

  let msgAccountManager = Cc["@mozilla.org/messenger/account-manager;1"]
                            .getService(Ci.nsIMsgAccountManager);

  let compose = msgComposeService.InitCompose (null, params);
  compose.SendMsg (Ci.nsIMsgCompDeliverMode.Now,
                   msgAccountManager.defaultAccount.defaultIdentity,
                   "", null, null);
  return true;
}

const kXulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * Find out what's the quoted HTML for the given message header. This is done by
 * inserting a XUL iframe into the div and calling k when done.
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
      // messageService.DisplayMessage(uri, iframe.docShell, msgWindow,
      //                            urlListener, aCharset, {});
      iframe.webNavigation.loadURI(url.spec+"?header=quotebody",
        iframe.webNavigation.LOAD_FLAGS_IS_LINK, null, null, null);
    } catch (e) {
      Log.error(e);
      dumpCallStack(e);
    }
  }, true); /* end document.addEventListener */

  div.appendChild(iframe);
}
