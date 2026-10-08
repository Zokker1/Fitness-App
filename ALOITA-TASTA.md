# Fitness app – paikallinen versio

## Käynnistä

- **start.bat** käynnistää dev-palvelimen ja avaa selaimen. Ensikäytössä luot oman tunnuslauseen ja tallennat palautustiedoston sekä palautusavaimen. Kirjaukset säilyvät tämän selaimen paikallisessa salatussa tietokannassa.
- **start-DEMO.bat** avaa sovelluksen ilman tunnuslausetta muistimuodossa. Voit kokeilla ominaisuuksia; kirjaukset katoavat uudelleenlatauksessa tai sivun sulkemisessa. Muistimuoto tulee URL-parametrista `?storage=muisti`. SPA-navigointi säilyttää nykyisen istunnon, mutta osoitteen suora vaihto ilman parametria avaa normaalin tallentavan tilan.
- **AVAA-BUILD.bat** käynnistää valmiin tuotantobuildin paikallisen esikatselun ja avaa selaimen.

Osoite: http://127.0.0.1:5180/

Käytä yhtä käynnistystiedostoa kerrallaan. Palvelin pysyy käynnissä BAT-ikkunassa; pysäytä Ctrl+C:llä. Sovellus tarvitsee yhden Vite-palvelimen; erillistä backendia ei ole.

Riippuvuudet on asennettu valmiiksi. Jos node_modules puuttuu, käynnistystiedosto asentaa ne automaattisesti npm ci -komennolla (vaatii internetin). Node.js-vaatimus: vähintään 20.19; suositus 22.19 tai uudempi.

## Sisältö ja asetukset

Tämä on erillinen kopio lähdeprojektista. Alkuperäistä .env-tiedostoa, Git-historiaa, tietokantoja, palautusavaimia, selainprofiileja tai testien tallenteita ei ole kopioitu. .env sisältää vain paikallisen osoitteen ja arvon dev-placeholder-client-id. Sovellus alkaa ilman henkilökohtaisia kirjauksia. Selaintallennus on sidottu tämän kopion omaan porttiin 5180.

Google-kirjautuminen ja Drive-synkronointi eivät ole käytössä testiarvolla. Paikalliset ominaisuudet toimivat ilman Google-tiliä. Käytä demossa keksittyjä kirjauksia.

## Päivitä build koodimuutosten jälkeen

Avaa terminaali tässä kansiossa ja suorita npm run build. AVAA-BUILD.bat käyttää valmiiksi rakennettua apps/lifeos-web/dist-kansiota. Dev-palvelin näyttää lähdekoodimuutokset automaattisesti.

Projektin englanninkielinen esittely ja tekniset ohjeet: README.md. Alkuperäisiä projektisuunnitelmia ja sisäisiä tilamuistiinpanoja ei sisällytetty tähän kopioon.

## Tarkistus 8.10.2026

Tuotantobuild ja BAT-tiedostojen dev- ja preview-käynnistys testattu. Seitsemän Chromium-selaintestiä läpi. npm audit: 0 tunnettua haavoittuvuutta tarkistushetkellä. Kopiossa päivitettiin source-map-js-riippuvuus ja korjattiin tilakortin otsikon HTML-rakenne.
