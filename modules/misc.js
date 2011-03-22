var EXPORTED_SYMBOLS = ['wrapWithFormatting', 'parseToArrays', 'parseToPairs',
	'formatIdentity', 'encodeUrlParameters', 'decodeUrlParameters',
];

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://kompose/stdlib/misc.js");

const msgComposePrefs = Cc["@mozilla.org/preferences-service;1"]
                          .getService(Ci.nsIPrefService)
                          .getBranch("msgcompose.");
const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                      .getService(Ci.nsIMsgHeaderParser);

/**
 * Take some HTML and wrap it with the right body with the right style on it.
 * The style is taken from the composition preferences.
 * @param {String} aHtml The HTML to be enclosed in &lt;body&gt; tags.
 * @return {String}
 */
function wrapWithFormatting (aHtml) {
  let fgColor = msgComposePrefs.getCharPref("text_color");
  let bgColor = msgComposePrefs.getCharPref("background_color");
  let fontFace = msgComposePrefs.getCharPref("font_face");
  let fontSize = msgComposePrefs.getCharPref("font_size");
  let style =
    "font-family: '"+fontFace+"'; " +
    "font-size: "+fontSize+"; " +
    "color: "+fgColor+"; " +
    "background-color: "+bgColor+";"
  ;
  return ('<div style="'+style+'">'+aHtml+'</div>');
}

function parseToArrays(aMimeLine) {
  let emails = {};
  let fullNames = {};
  let names = {};
  let numAddresses = gHeaderParser.parseHeadersWithArray(aMimeLine, emails, names, fullNames);
  return [names.value, emails.value];
}

function parseToPairs(aMimeLine) {
	let [names, emails] = parseToArrays(aMimeLine);
	return [[names[i], emails[i]] for each (i in range(0, names.length))];
}

function formatIdentity(id) {
	return (id.fullName + " <"+id.email+">");
}

function encodeUrlParameters(aObj) {
	let kv = [];
	for each (let [k, v] in Iterator(aObj)) {
		kv.push(k+"="+encodeURIComponent(v));
	}
	return kv.join("&");
}

function decodeUrlParameters(aStr) {
	let params = {};
	let i = aStr.indexOf("?");
	if (i >= 0) {
		let query = aStr.substring(i+1, aStr.length);
		let keyVals = query.split("&");
		for each (let [, keyVal] in Iterator(keyVals)) {
			let [key, val] = keyVal.split("=");
			val = decodeURIComponent(val);
			params[key] = val;
		}
	}
	return params;
}
