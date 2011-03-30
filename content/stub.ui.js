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

Cu.import("resource:///modules/iteratorUtils.jsm"); // for fixIterator

function attachFile() {
  let filePicker = Cc["@mozilla.org/filepicker;1"]
    .createInstance(Ci.nsIFilePicker);
  filePicker.init(window, "Attach file(s)", Ci.nsIFilePicker.modeOpenMultiple);
  if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
    for each (file in fixIterator(filePicker.files, Ci.nsILocalFile)) {
      let uri = ioService.newFileURI(file);
      addAttachmentItem({ name: file.leafName, url: uri.spec, size: file.fileSize });
    }
  }
}

function addAttachmentItem(data) {
  let box = $(".attachments");
  let node = $("<option />")
    .data("file", data)
    .text(data.name+" ")
    .append($("<span style='color: gray' />")
      .text(gMessenger.formatFileSize(data.size)));
  box.append(node);
}

function removeFile() {
  $(".attachments").find(":selected").remove();
}

function closeTab() {
  let browser = window.frameElement;
  let tabmail = window.top.document.getElementById("tabmail");
  let tabs = tabmail.tabInfo;
  let candidates = tabs.filter(function (x) x.browser == browser);
  if (candidates.length == 1) {
    tabmail.closeTab(candidates[0]);
  } else {
    Log.error("Couldn't find a tab to close...");
  }
}

function onSend() {
  gComposeSession.send({
    k: function () {
      gComposeSession.cleanup(kReasonSent);
      closeTab();
    },
  });
}

function onDiscard() {
  gComposeSession.cleanup(kReasonDiscard);
  gComposeSession.modified = true;
  closeTab();
}

function onSave() {
  gComposeSession.send({
    deliverType: Ci.nsIMsgCompDeliverMode.SaveAsDraft,
    compType: Ci.nsIMsgCompType.Draft,
    k: function ({ folderUri, messageId, msgCompose }) {
      gComposeSession.modified = false;
      // We're called too early, and draftUri is not set yet...
      setTimeout(function () {
        let draftUri = msgCompose.compFields.draftId;
        Log.debug("Draft just saved!", draftUri);
        let msgKey = draftUri.substr(draftUri.indexOf('#') + 1);
        let folder = MailUtils.getFolderForURI(folderUri);
        let currentDraft = gComposeSession.currentDraft();
        if (currentDraft)
          msgHdrsDelete([currentDraft]);
        gComposeSession.currentDraft = function ()
          folder.GetMessageHeader(msgKey)
        ;
      }, 1000);
    },
  });
}

window.addEventListener("beforeunload", function (event) {
  // If there's unsaved data, prevent closing the window, otherwise, just
  // cleanup the original draft that we won't be needing anymore. This assumes
  // no one else is editing this draft right now.
  if (gComposeSession.modified)
    event.returnValue = "whatever";
  else
    gComposeSession.cleanup(kReasonClosed);
}, false);
