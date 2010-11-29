var EXPORTED_SYMBOLS = ["Log", "dumpCallStack"]

// Because my log4moz-fix isn't in 3.1... doh
Components.utils.import("resource://kompose/log4moz.js");

let Log;

function setupLogging() {
  // The basic formatter will output lines like:
  // DATE/TIME	LoggerName	LEVEL	(log message) 
  let formatter = new Log4Moz.BasicFormatter();

  Log = Log4Moz.repository.getLogger("Kompose.Main");

  // Loggers are hierarchical, lowering this log level will affect all output
  let root = Log;
  root.level = Log4Moz.Level["All"];

  // A console appender outputs to the JS Error Console
  let capp = new Log4Moz.ConsoleAppender(formatter);
  capp.level = Log4Moz.Level["Warn"];
  root.addAppender(capp);

  // A dump appender outputs to standard out
  let dapp = new Log4Moz.DumpAppender(formatter);
  dapp.level = Log4Moz.Level["All"];
  root.addAppender(dapp);

  Log.assert = function (aBool, aStr) {
    if (!aBool)
      this.error(aStr);
  };

  Log.debug("Logging enabled");
}

setupLogging();

function dumpCallStack(e) {
  let frame = e ? e.stack : Components.stack;
  while (frame) {
    Log.debug("\n"+frame);
    frame = frame.caller;
  }
};
