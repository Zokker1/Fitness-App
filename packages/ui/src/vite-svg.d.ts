// T334: Viten no-inline SVG-assetti-URLien tsc-deklaraatiot (nav-ikonit).
// ui-paketilla ei ole vite/client-tyyppejä (ei Vite-depsiä); deklaraatio
// on paikallinen jotta typecheck toimii ilman bundler-tyyppejä.
declare module "*.svg?no-inline" {
  const url: string;
  export default url;
}
