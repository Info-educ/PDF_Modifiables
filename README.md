# PDF Modifiables — Champs PDF, Collège Joliot Curie

Outil web pour transformer un PDF en formulaire remplissable :
chargement d'un PDF, placement de champs (texte, date, case à cocher,
liste déroulante, signature) par glisser-déposer, export d'un PDF
remplissable compatible Acrobat Reader/Pro, Foxit, Chrome et lecteurs mobiles.

## Structure

- `index.html` — structure de la page
- `css/styles.css` — styles
- `js/app.js` — logique de l'application (rendu PDF, édition des champs, export)

## Dépendances (CDN)

- [pdf-lib](https://pdf-lib.js.org/) — génération du PDF remplissable
- [pdf.js](https://mozilla.github.io/pdf.js/) — rendu du PDF dans le navigateur

## Utilisation

1. Ouvrir `index.html` (ou la page hébergée sur GitHub Pages).
2. Charger un PDF.
3. Ajouter et positionner les champs.
4. Exporter le PDF remplissable.
