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
 * The Original Code is Gmail Conversation View
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

let KomposeManager = null;

window.addEventListener("load", function _overlay_eventListener () {
  let NS = {};
  try {
    Components.utils.import("resource://kompose/log.js", NS);
  } catch (e) {
    dump(e+"\n");
  }
  try {
    Components.utils.import("resource://kompose/main.js", NS);
    KomposeManager = new NS.KomposeManager();
  } catch (e) {
    NS.Log.error(e);
    NS.dumpCallStack(e);
  }

  // Ideally, we would replace the nsMsgComposeService with our own, but for the
  // time being, let's just stick to that monkey-patch. When it's about time,
  // we'll just register a new XPCom components with the same contract-id
  // (@messenger/compose;1) and it'll be fine.
  ComposeMessage = function _ComposeMessage_patched (type, format, folder, messageArray) {
    var msgComposeType = Components.interfaces.nsIMsgCompType;
    var identity = null;
    var newsgroup = null;
    var server;

    // dump("ComposeMessage folder=" + folder + "\n");
    try
    {
      if (folder)
      {
        // Get the incoming server associated with this uri.
        server = folder.server;

        // If they hit new or reply and they are reading a newsgroup,
        // turn this into a new post or a reply to group.
        if (!folder.isServer && server.type == "nntp" && type == msgComposeType.New)
        {
          type = msgComposeType.NewsPost;
          newsgroup = folder.folderURL;
        }

        identity = folder.customIdentity;
        if (!identity)
          identity = getIdentityForServer(server);
        // dump("identity = " + identity + "\n");
      }
    }
    catch (ex)
    {
      dump("failed to get an identity to pre-select: " + ex + "\n");
    }

    // dump("\nComposeMessage from XUL: " + identity + "\n");
    var uri = null;

    if (!msgComposeService)
    {
      dump("### msgComposeService is invalid\n");
      return;
    }

    if (type == msgComposeType.New)
    {
      // New message.

      // dump("OpenComposeWindow with " + identity + "\n");

      // If the addressbook sidebar panel is open and has focus, get
      // the selected addresses from it.
      if (document.commandDispatcher.focusedWindow &&
          document.commandDispatcher.focusedWindow
                  .document.documentElement.hasAttribute("selectedaddresses"))
        NewMessageToSelectedAddresses(type, format, identity);
      else
        KomposeManager.OpenComposeWindow(null, null, null, type, format, identity, msgWindow);
      return;
    }
    else if (type == msgComposeType.NewsPost)
    {
      // dump("OpenComposeWindow with " + identity + " and " + newsgroup + "\n");
      KomposeManager.OpenComposeWindow(null, null, newsgroup, type, format, identity, msgWindow);
      return;
    }

    messenger.setWindow(window, msgWindow);

    var object = null;

    if (messageArray && messageArray.length > 0)
    {
      uri = "";
      for (var i = 0; i < messageArray.length; ++i)
      {
        var messageUri = messageArray[i];

        var hdr = messenger.msgHdrFromURI(messageUri);
        identity = getIdentityForHeader(hdr, type);
        if (/^https?:/.test(hdr.messageId))
          openComposeWindowForRSSArticle(hdr, type);
        else if (type == msgComposeType.Reply ||
                 type == msgComposeType.ReplyAll ||
                 type == msgComposeType.ReplyToList ||
                 type == msgComposeType.ForwardInline ||
                 type == msgComposeType.ReplyToGroup ||
                 type == msgComposeType.ReplyToSender ||
                 type == msgComposeType.ReplyToSenderAndGroup ||
                 type == msgComposeType.Template ||
                 type == msgComposeType.Redirect ||
                 type == msgComposeType.Draft)
        {
          KomposeManager.OpenComposeWindow(null, hdr, messageUri, type, format, identity, msgWindow);
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
        KomposeManager.OpenComposeWindow(null,
                                            messageArray.length > 1 ? null : hdr,
                                            uri, type, format,
                                            identity, msgWindow);
    }
    else
      dump("### nodeList is invalid\n");
  };
}, false);
