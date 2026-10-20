# FootballshirtsNL

Statische catalogus voor GitHub Pages met dagelijkse synchronisatie van de geautoriseerde bron.

## Publiceren
1. Upload de volledige inhoud van deze map naar de root van een GitHub repository.
2. Ga in GitHub naar Settings > Pages.
3. Kies onder Build and deployment bij Source: GitHub Actions.
4. Open Actions en voer "Daily sync and deploy FootballshirtsNL" eenmaal handmatig uit, of push een wijziging naar main.

De website leest `data/catalog.json` rechtstreeks. Er is geen Node-server nodig voor bezoekers.
