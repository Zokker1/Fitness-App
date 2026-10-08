// T023: staattisen hostauksen SPA-fallback-dokumentaatio.
// Selaimen syvälinkki (esim. /tasks) on palveltava index.html:nä,
// muuten suora avaus/reload alireitillä antaa 404:n staattisessa hostingissa.
// Tuotantohostaus (B17) konfiguroidaan tarjoilemaan index.html kaikille
// app-reiteille; alla yleiset esimerkit (ei ajeta, dokumentaatio):
//
// nginx:   try_files $uri $uri/ /index.html;
// Apache:  FallbackResource /index.html
// Static:  "rewrites": [{ "source": "**", "destination": "/index.html" }]
export {};
