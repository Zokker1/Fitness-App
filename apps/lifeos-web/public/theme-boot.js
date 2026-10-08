// Set the persisted UI language and theme before styles load to avoid FOUC.
// The default Trusted Types policy only blesses same-origin JavaScript URLs,
// which the browser requires for Vite's worker and service-worker loaders.
(function () {
  try {
    if (window.trustedTypes !== undefined) {
      window.trustedTypes.createPolicy("default", {
        createScriptURL: function (input) {
          try {
            var url = new URL(input, window.location.href);
            var appScript = url.origin === window.location.origin && /\.m?js$/i.test(url.pathname);
            var googleIdentityScript =
              url.origin === "https://accounts.google.com" && url.pathname === "/gsi/client";
            return appScript || googleIdentityScript ? url.href : null;
          } catch {
            return null;
          }
        },
      });
    }

    var language = localStorage.getItem("lifeos.language.v1");
    if (language === "fi" || language === "en") {
      document.documentElement.lang = language;
    }
    var theme = localStorage.getItem("lifeos.theme.v1");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Browser storage may be unavailable; keep the default language and theme.
  }
})();
