// guard.js — makes failures visible.
//
// Loaded as a CLASSIC script before the module bundles, so it is installed
// before anything can throw, and so it still catches errors that stop a
// module from parsing at all.
//
// This matters more than usual here: the overlay is a transparent,
// click-through window. If its script dies, the result is not an error
// message, it is simply nothing at all on screen, which is impossible to
// tell apart from "the app did not start". The banner turns that into
// something you can read and screenshot.

(function () {
  "use strict";

  var shown = 0;

  function banner(kind, message, detail) {
    if (shown > 3) return; // never carpet the screen in red
    shown++;

    var box = document.createElement("div");
    box.setAttribute("data-peeceemons-error", "1");
    var s = box.style;
    s.position = "fixed";
    s.left = "0";
    s.right = "0";
    s.bottom = shown * 0 + (shown - 1) * 44 + "px";
    s.zIndex = "2147483647";
    s.background = "rgba(150,20,20,0.94)";
    s.color = "#fff";
    s.font = "12px ui-monospace, Consolas, monospace";
    s.padding = "6px 10px";
    s.whiteSpace = "pre-wrap";
    s.pointerEvents = "none";
    box.textContent =
      "PEECEEMONS " + kind + ": " + message + (detail ? "\n" + detail : "");

    if (document.body) {
      document.body.appendChild(box);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        document.body.appendChild(box);
      });
    }

    // Also stash it on the title, which can be read from outside the webview.
    try {
      document.title = "ERR " + message.slice(0, 120);
    } catch (e) {
      /* nothing sensible to do */
    }
  }

  // Exposed so code that catches its own errors can still surface them.
  window.__peeceemonsReport = function (kind, message, detail) {
    banner(kind, String(message), detail ? String(detail) : "");
  };

  window.addEventListener(
    "error",
    function (e) {
      // Resource errors (a failed <script src>) have a target but no message.
      if (e.target && e.target !== window && e.target.src) {
        banner("LOAD FAILED", String(e.target.src));
        return;
      }
      banner(
        "ERROR",
        e.message || "unknown",
        e.filename ? e.filename + ":" + e.lineno : ""
      );
    },
    true
  );

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    banner("PROMISE", (r && (r.message || r.toString())) || "unknown", r && r.stack ? String(r.stack).split("\n")[1] : "");
  });
})();
