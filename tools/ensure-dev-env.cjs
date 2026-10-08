// T035-apuri: luo .env .env.examplesta jos puuttuu. Ei koskaan ylikirjoita
// olemassa olevaa. Ei tulosta arvoja (vain tilan). CommonJS jotta toimii
// sellaisenaan Windows PowerShellistä ilman lainausmerkkiongelmia.
const fs = require("node:fs");

if (!fs.existsSync(".env")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("[verify]   .env luotu .env.examplesta");
} else {
  console.log("[verify]   .env löytyy, ei kosketa");
}
