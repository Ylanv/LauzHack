# **AXA Smart Property — Étude des données et plan complet du projet**

Étude des sources suisses publiques · 21 novembre 2026 · Hackathon AXA B2B

## **1. Conclusion de la recherche**

**Votre projet est réalisable avec des données publiques gratuites, et il y a suffisamment de sources suisses pour produire un rapport intéressant sans demander plus de trois informations au client.**

En revanche, il faut distinguer deux types d'informations :

- **Les informations objectives**, qu'on peut récupérer automatiquement : caractéristiques du bâtiment, géolocalisation, dangers naturels, certaines données de construction.
- **Les informations privées ou difficilement observables**, comme la présence de sprinklers, les stocks de gaz, la valeur exacte du bâtiment ou l'historique des sinistres.

Votre produit doit maximiser la première catégorie et rechercher intelligemment des indices fiables sur la deuxième.

### **Les sources les plus intéressantes**

| Source                                | Informations                                                      | Gratuité / accès                                    | Priorité |
| ------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- | -------- |
| **swisstopo / geo.admin.ch**          | Adresse, coordonnées, données géographiques                       | Gratuit, API publique                               | P0       |
| **RegBL — OFS**                       | EGID, catégorie, année, étages, autres caractéristiques publiques | Gratuit, API / téléchargement                       | P0       |
| **OFEV — Ruissellement**              | Exposition cartographique aux eaux de surface                     | Gratuit, données nationales                         | P0       |
| **OFEV — Séismes**                    | Zone sismique et classes de sol disponibles                       | Gratuit, géodonnées                                 | P0       |
| **MétéoSuisse — Grêle**               | Intensité de référence et cartes de danger                        | Gratuit, données ouvertes                           | P0       |
| **SWISSIMAGE**                        | Photographies aériennes                                           | Gratuit, géoservices et téléchargement              | P0       |
| **Zefix**                             | Raison sociale, identifiant d'entreprise, siège                   | Gratuit ; API REST avec accès à demander            | P1       |
| **Cartes cantonales de dangers**      | Crues, glissements, avalanches, chutes de pierres                 | Accès et formats variables                          | P1       |
| **swissBUILDINGS3D**                  | Géométrie, volume et toiture selon disponibilité                  | Gratuit, traitement technique nécessaire            | P1       |
| **Sites et documents d'entreprises**  | Procédés industriels, équipements, activités                      | Publics, mais conditions de réutilisation variables | P1       |
| **SwissPRTR / registres industriels** | Certains sites industriels et rejets déclarés                     | Publics, couverture limitée                         | P2       |

Les interfaces fédérales de géodonnées sont gratuites sous règles d'utilisation équitable, et les données standards de swisstopo sont ouvertes. L'OFEV confirme la disponibilité de plusieurs couches de dangers ; les cartes détaillées de crues et de mouvements de terrain sont toutefois principalement cantonales.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.geo.admin.ch\&sz=32)

\*.geo.admin.ch+4



**Premier résultat important de la recherche :** une plateforme existante, le *Naturgefahren-Check* suisse, exploite déjà les interfaces geo.admin.ch pour analyser des dangers à partir d'une adresse. Cela confirme la faisabilité du cœur géographique de votre projet.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.protection-dangers-naturels.ch\&sz=32)

Protection dangers naturels



Votre différenciation face à ces outils existants sera donc l'**enrichissement industriel, l'analyse multimodale, la consolidation des preuves et le rapport adapté à l'équipe AXA**, plutôt que la simple présentation de cartes de dangers.

## **2. Recherche détaillée — Sources à utiliser**

### **A. Identifier l'entreprise — Zefix Linked Data**

Gratuit

Recommandé pour le MVP

Il y a une alternative intéressante à l'API REST Zefix avec identifiants : **les données Zefix publiées en Linked Data**.

Elles permettent de rechercher des informations sur les entreprises actives, notamment leur raison sociale, leur siège et leur adresse. Le jeu est référencé sur opendata.swiss et fournit des exemples de requêtes SPARQL.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://opendata.swiss\&sz=32)

opendata.swiss+2



**Liens :** [Jeu de données Zefix](https://opendata.swiss/fr/dataset/zefix-zentraler-firmenindex?utm_source=chatgpt.com) · [Interface SPARQL](https://ld.admin.ch/sparql/?utm_source=chatgpt.com)

Vous pourrez utiliser cela pour :

- Vérifier que la raison sociale existe.
- Identifier plus précisément l'entreprise.
- Retrouver son siège officiel et certains renseignements légaux.

En revanche, Zefix ne prouve pas que l'entreprise occupe le bâtiment renseigné. Pour le secteur industriel et les procédés de fabrication, il faudra des recherches complémentaires.

### **B. Identifier précisément le bâtiment — geo.admin.ch + RegBL**

Gratuit

P0

C'est probablement votre source la plus importante.

L'API fédérale propose notamment un service de recherche d'adresses avec des liens vers les entités cadastrales et le registre des bâtiments.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.geo.admin.ch\&sz=32)

\*.geo.admin.ch+1



Voici un exemple de requête documenté :

```
GET https://api3.geo.admin.ch/rest/services/ech/SearchServer
    ?searchText=Landstrasse%208595%20Altnau
    &type=locations
```

L'agent récupère les coordonnées, résout l'identifiant EGID lorsqu'il est disponible, puis interroge la fiche du bâtiment.

La couche fédérale du registre porte l'identifiant :

`ch.bfs.gebaeude_wohnungs_register`

Vous pourrez afficher les champs effectivement renseignés : année de construction, catégorie, nombre de niveaux, etc. L'exhaustivité varie selon les bâtiments. Certaines surfaces ne sont pas toujours disponibles ou ne correspondent pas à la surface totale à assurer.

**Documentation :** [Search API](https://docs.geo.admin.ch/access-data/search.html?utm_source=chatgpt.com) · [Find Features API](https://docs.geo.admin.ch/access-data/find-features.html?utm_source=chatgpt.com) · [Données publiques RegBL](https://www.gwr.admin.ch/fr/data/supply/public_content.html?utm_source=chatgpt.com)

### **C. Risques naturels — couches directement exploitables**

J'ai identifié plusieurs couches techniques utilisables dans votre projet.

| Risque                           | Couche ou source                                        | Traitement                         |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| Ruissellement                    | `ch.bafu.gefaehrdungskarte-oberflaechenabfluss`         | Intersection avec le bâtiment      |
| Zone sismique                    | `ch.bafu.gefahren-gefaehrdungszonen`                    | Extraction de la zone SIA 261      |
| Sol sismique                     | `ch.bafu.gefahren-baugrundklassen`                      | Extraction de la classe disponible |
| Grêle (10 ans)                   | `ch.meteoschweiz.hagelgefaehrdung-korngroesse_10_jahre` | Valeur raster/cartographique       |
| Grêle (50 ans)                   | `ch.meteoschweiz.hagelgefaehrdung-korngroesse_50_jahre` | Valeur raster/cartographique       |
| Crues des cours d'eau            | geodienste.ch / géoportails cantonaux                   | Intersection avec zones de danger  |
| Glissements, pierres, avalanches | geodienste.ch / géoportails cantonaux                   | Intersection spatiale              |

Les identifiants des couches nationales ci-dessus sont publiés par geo.admin.ch.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://api3.geo.admin.ch\&sz=32)

api3.geo.admin.ch+3



Deux limites importantes :

**Les cartes de ruissellement ne sont pas des cartes de crues.** Il faut bien analyser les deux séparément.

**Les données cantonales ne sont pas toutes librement téléchargeables.** geodienste.ch propose plusieurs services, dont OGC API Features, mais l'accès dépend du canton. Certains imposent une autorisation ou des conditions spécifiques de réutilisation.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.geodienste.ch\&sz=32)

geodienste.ch+1



Pour le MVP, je privilégierais les cartes nationales et ajouterais l'analyse cantonale uniquement lorsque le jeu est accessible.

### **D. Grêle — des données particulièrement intéressantes pour AXA**

MétéoSuisse publie des données ouvertes de climatologie de la grêle, notamment des valeurs de référence pour différentes périodes de retour.

Les produits incluent des grilles d'environ 1 km et des périodes de retour de 2 à 100 ans. Les données sont téléchargeables via l'API STAC fédérale, notamment en COG GeoTIFF.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://opendatadocs.meteoswiss.ch\&sz=32)

Open Data Documentation+1



**Documentation :** [MétéoSuisse — Données climatologiques de grêle](https://opendatadocs.meteoswiss.ch/c-climate-data/c5-radar-based-climate-data?utm_source=chatgpt.com)

C'est idéal pour une approche sans LLM : le backend lit une valeur géographique dans une grille et la place dans le rapport avec sa définition et sa source.

### **E. Images aériennes — SWISSIMAGE**

Gratuit

Multimodal

SWISSIMAGE couvre la Suisse avec une résolution au sol de 10 cm dans les principales régions de plaine et de 20 à 25 cm dans les Alpes.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.swisstopo.admin.ch\&sz=32)

swisstopo.admin.ch



**Documentation :** [SWISSIMAGE 10 cm](https://www.swisstopo.admin.ch/fr/orthophotos-swissimage-10-cm?utm_source=chatgpt.com)

Votre agent pourra rechercher une image autour du bâtiment, la recadrer et l'envoyer à un modèle vision.

Il cherchera uniquement ce qui peut raisonnablement être observé : forme de toiture, panneaux solaires, installations apparentes, bâtiments proches, végétation et accès.

Une orthophoto ne permet pas de conclure que le bâtiment est équipé de sprinklers, qu'il utilise du gaz ou que sa structure est résistante au feu.

### **F. Données industrielles — la partie la plus incertaine**

Je retiendrais trois sources complémentaires :

| Source                         | Utilisation                                      | Limite                                        |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| Site officiel de l'entreprise  | Activités, produits, procédés, photos, rapports  | Informations parfois générales à l'entreprise |
| Documents publics et brochures | Technologies, équipements et procédés mentionnés | Rarement exhaustifs                           |
| SwissPRTR                      | Certains sites et rejets industriels déclarés    | Ne couvre pas toutes les usines               |

Le registre SwissPRTR de l'OFEV est public et propose une localisation des installations concernées.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.bafu.admin.ch\&sz=32)

bafu.admin.ch



**Lien :** [SwissPRTR — Registre suisse des polluants](https://www.bafu.admin.ch/fr/swissprtr-fr?utm_source=chatgpt.com)

Je ne ferais pas de promesse du type « identification automatique des bouteilles de gaz et des machines industrielles de toutes les usines suisses ». Ce n'est pas réaliste à partir des seules données publiques.

En revanche, vous pouvez produire un profil de risque industriel documenté, avec des inconnues clairement identifiées.

# **AXA Smart Property — Pipeline complète et sources de données**

Je propose une architecture **hybride : un agent IA qui pilote des outils spécialisés, mais qui ne gaspille pas de tokens sur des tâches réalisables en Python**.

Le principe :

**3 informations client → identification du bâtiment → enrichissement géographique et industriel → analyse multimodale → rapport de pré-tarification AXA.**

## **1. Schéma exact de la pipeline**

PIPELINE DE PRODUCTION — UN BÂTIMENT PAR ANALYSE

**CLIENT — 3 INPUTS**

Nom · Raison sociale légale · Adresse exacte

**1. Identity Resolver**

Zefix + geo.admin.ch + RegBL

Identifiant IDE · EGID · coordonnées · canton

0 token LLM

**2A. Building Data**

RegBL, swissBUILDINGS3D

Année, étages, géométrie, dimensions

0 token

**2B. Hazard Data**

OFEV, MétéoSuisse, cantons

Crues, séisme, grêle, ruissellement…

0 token

**2C. Vision**

SWISSIMAGE + modèle vision

Toiture, panneaux solaires, environnement

LLM ciblé

**2D. Industry Research**

Site web + documents publics

Activité, gaz, fours, procédés, inflammables

LLM conditionnel

**3. Evidence Store**

JSON structuré · sources · dates · confiance · inconnues

0 token LLM

**4. Risk Synthesis Agent**

Croisement des preuves · contradictions · informations critiques

1 appel LLM final

**5. AXA Property Risk Report**

Dossier de pré-souscription · sources consultables · export PDF

Les quatre branches d'enrichissement peuvent fonctionner en parallèle. Le modèle IA n'intervient que dans les branches où il apporte une véritable valeur.

## **2. Toutes les informations du rapport et leur source**

J'utiliserai les statuts suivants :

- &#x20;**Auto** : directement récupérable ou calculable depuis une source structurée.
- &#x20;**Partiel** : dépend du bâtiment, du canton ou d'une estimation multimodale.
- &#x20;**Inconnu possible** : non garanti avec vos trois champs.

### **A. Identité du client et de l'entreprise**

| Champ du rapport            | Source exacte                                       | Extraction                   |
| --------------------------- | --------------------------------------------------- | ---------------------------- |
| Nom du client               | Formulaire                                          | &#x20;Auto                   |
| Raison sociale              | Formulaire + Zefix Linked Data                      | &#x20;Auto                   |
| Identifiant IDE / UID       | Zefix / LINDAS                                      | &#x20;Auto si correspondance |
| Forme juridique             | Zefix / LINDAS                                      | &#x20;Auto                   |
| Siège social                | Zefix / LINDAS                                      | &#x20;Auto                   |
| Secteur d'activité          | Site officiel, description publique de l'entreprise | &#x20;Partiel                |
| Activité spécifique du site | Pages d'établissement, documents publics            | &#x20;Partiel                |
| Propriété du bâtiment       | Données foncières si publiquement accessibles       | &#x20;Souvent inconnue       |

Zefix est disponible sous forme de Linked Data avec requêtes SPARQL, sans nécessiter les identifiants de son API REST.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://opendata.swiss\&sz=32)

opendata.swiss+1



**Source :** [Zefix Open Data](https://opendata.swiss/fr/dataset/zefix-zentraler-firmenindex?utm_source=chatgpt.com)

### **B. Identification et caractéristiques du bâtiment**

| Champ du rapport             | Source exacte                                         | Extraction                       |
| ---------------------------- | ----------------------------------------------------- | -------------------------------- |
| Adresse                      | Formulaire + répertoire officiel des adresses         | &#x20;Auto                       |
| Coordonnées LV95 / GPS       | geo.admin.ch Search API                               | &#x20;Auto                       |
| Canton / commune             | geo.admin.ch / swissBOUNDARIES3D                      | &#x20;Auto                       |
| Identifiant EGID             | RegBL + répertoire des adresses                       | &#x20;Auto si bâtiment identifié |
| Catégorie du bâtiment        | RegBL, champ `gkat`                                   | &#x20;Selon renseignement        |
| Année de construction        | RegBL, champ `gbauj`                                  | &#x20;Selon renseignement        |
| Nombre de niveaux            | RegBL, champ `gastw`                                  | &#x20;Selon renseignement        |
| Empreinte au sol             | RegBL / géométrie swissBUILDINGS3D                    | &#x20;Partiel                    |
| Hauteur / géométrie du toit  | swissBUILDINGS3D                                      | &#x20;Partiel                    |
| Surface totale des planchers | RegBL si donnée appropriée disponible, sinon inconnue | &#x20;Partiel                    |
| Altitude du terrain          | API Height de geo.admin.ch                            | &#x20;Auto                       |
| Âge calculé                  | Année de construction                                 | &#x20;Calcul                     |
| Régime d'assurance cantonal  | Canton + règles AXA                                   | &#x20;Règle métier               |

Les attributs `gkat`, `gbauj` et `gastw` sont documentés dans l'API fédérale. swissBUILDINGS3D fournit une géométrie 3D, mais sa couverture EGID et la qualité de certaines altitudes nécessitent des vérifications.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.geo.admin.ch\&sz=32)

\*.geo.admin.ch+3



**Sources :** [GeoAdmin Search](https://docs.geo.admin.ch/access-data/search.html?utm_source=chatgpt.com) · [GeoAdmin Features](https://docs.geo.admin.ch/access-data/find-features.html?utm_source=chatgpt.com) · [swissBUILDINGS3D](https://www.swisstopo.admin.ch/fr/modele-du-territoire-swissbuildings3d-3-0-beta?utm_source=chatgpt.com)

Il faudra bien distinguer la **surface d'emprise au sol**, la surface habitable et la surface totale des planchers. Ce ne sont pas des valeurs interchangeables.

### **C. Risques naturels et externes**

| Champ du rapport                      | Source exacte                                         | Extraction                        |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Exposition au ruissellement           | OFEV, `ch.bafu.gefaehrdungskarte-oberflaechenabfluss` | &#x20;SIG                         |
| Profondeur modélisée du ruissellement | Données vectorielles OFEV lorsqu'accessibles          | &#x20;SIG                         |
| Zone de crue / inondation             | Cartes de dangers cantonales, geodienste.ch           | &#x20;Selon canton                |
| Zone sismique SIA 261                 | `ch.bafu.gefahren-gefaehrdungszonen`                  | &#x20;SIG                         |
| Classe de sol sismique                | `ch.bafu.gefahren-baugrundklassen`                    | &#x20;Selon couverture            |
| Taille de grêle de référence à 50 ans | MétéoSuisse, produits MESHS / LEHA                    | &#x20;Raster                      |
| Exposition au glissement de terrain   | Cartes cantonales / geodienste.ch                     | &#x20;Selon canton                |
| Exposition aux chutes de pierres      | Cartes cantonales / geodienste.ch                     | &#x20;Selon canton                |
| Exposition aux avalanches             | Cartes cantonales / geodienste.ch                     | &#x20;Selon canton                |
| Exposition au vent                    | Données climatiques disponibles, analyse limitée      | &#x20;Optionnel                   |
| Charge de neige                       | Références climatiques / normes et altitude           | &#x20;Optionnel                   |
| Foudre                                | Informations géographiques et protections connues     | &#x20;Pas de score fiable garanti |
| Dégâts d'eau par conduites            | État des installations privées                        | &#x20;Inconnu                     |

La carte nationale du ruissellement existe et ses données sont téléchargeables ; les zones de crues, glissements, chutes de pierres et avalanches nécessitent souvent des données cantonales. Les données de grêle à différentes périodes de retour sont publiées en grille par MétéoSuisse.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://vsa.ch\&sz=32)

vsa.ch+4



**Sources :** [OFEV — Ruissellement](https://www.bafu.admin.ch/fr/ruissellement?utm_source=chatgpt.com) · [Cartes de dangers cantonales](https://www.geodienste.ch/services/gefahrenkarten?locale=fr\&utm_source=chatgpt.com) · [MétéoSuisse — Grêle](https://opendatadocs.meteoswiss.ch/c-climate-data/c5-radar-based-climate-data?utm_source=chatgpt.com)

Point technique : certaines couches geo.admin.ch sont des couches d'affichage WMTS, pas des API qui retournent directement une valeur numérique. Pour un résultat quantitatif fiable, le backend doit utiliser le jeu vectoriel ou raster sous-jacent plutôt que déduire un niveau de danger de la couleur d'une carte.

### **D. Risques incendie et activité industrielle**

C'est la partie où l'agent apporte le plus de valeur, mais où il faut le plus surveiller la fiabilité.

| Champ du rapport                   | Source exacte                                                 | Extraction             |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------- |
| Activité industrielle              | Site officiel + publications de l'entreprise                  | &#x20;Partiel          |
| Procédés de fabrication            | Pages de production, brochures, rapports                      | &#x20;Partiel          |
| Fours / haute température          | Documents, photos, vidéos publiques du site                   | &#x20;Partiel          |
| Utilisation de gaz                 | Documents techniques et déclarations publiques                | &#x20;Souvent inconnue |
| Stockage inflammable               | Rapports industriels, documents de sécurité publics           | &#x20;Souvent inconnu  |
| Produits chimiques                 | SwissPRTR, publications industrielles                         | &#x20;Partiel          |
| Activité à risque majeur           | Données cantonales publiques sur les installations concernées | &#x20;Selon canton     |
| Sources potentielles d'ignition    | Inférence à partir des procédés documentés                    | &#x20;Analyse IA       |
| Matériaux de construction          | Registres ou documents techniques disponibles                 | &#x20;Souvent inconnus |
| Installations voisines dangereuses | Registres publics géolocalisés, si disponibles                | &#x20;Partiel          |

SwissPRTR est une source officielle de l'OFEV sur certaines installations et leurs rejets déclarés. Ce n'est toutefois pas un inventaire complet des produits chimiques ou des combustibles stockés.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.bafu.admin.ch\&sz=32)

bafu.admin.ch



**Source :** [OFEV — SwissPRTR](https://www.bafu.admin.ch/fr/swissprtr-fr?utm_source=chatgpt.com)

Je ferais travailler l'agent selon cette logique :

**Industrial Research Agent**

1\. Retrouver le domaine officiel de l'entreprise

2\. Identifier l'activité exercée à l'adresse précise

3\. Rechercher uniquement les procédés et équipements pertinents

4\. Extraire des affirmations courtes avec URL et citation précise

5\. Classer : confirmé sur le site / déclaré au niveau de l'entreprise / hypothèse / inconnu

**Exemple :** une entreprise fabrique des pièces automobiles. L'agent trouve une brochure parlant de fours de traitement thermique.

La présence de fours devient un **risque potentiel à investiguer**, mais ne devient un fait confirmé concernant le bâtiment que si la brochure ou une autre preuve rattache ces fours à ce site.

### **E. Informations extraites par analyse d'images**

Le client n'envoie aucune photo. Vous récupérez automatiquement l'orthophoto du bâtiment identifié.

| Champ du rapport                  | Source exacte                                | Extraction                             |
| --------------------------------- | -------------------------------------------- | -------------------------------------- |
| Image aérienne                    | SWISSIMAGE / swisstopo                       | &#x20;Auto                             |
| Date de prise de vue              | Métadonnées SWISSIMAGE                       | &#x20;Selon tuile                      |
| Forme de toiture                  | swissBUILDINGS3D + orthophoto                | &#x20;Partiel                          |
| Panneaux photovoltaïques visibles | Orthophoto + vision                          | &#x20;Estimation                       |
| Équipements apparents sur toiture | Orthophoto + vision                          | &#x20;Estimation                       |
| Végétation à proximité            | Orthophoto + géométrie                       | &#x20;Partiel                          |
| Espacement des bâtiments voisins  | Géométrie swisstopo / cadastre               | &#x20;Partiel                          |
| Accessibilité extérieure visible  | Orthophoto + voirie cartographique           | &#x20;Estimation                       |
| État réel de la toiture           | Inspection ou photographie détaillée récente | &#x20;Non vérifiable de manière fiable |

Les orthophotos SWISSIMAGE sont des données ouvertes de swisstopo, avec une résolution pouvant atteindre 10 cm dans les régions couvertes à cette précision.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.swisstopo.admin.ch\&sz=32)

swisstopo.admin.ch+1



**Source :** [SWISSIMAGE](https://www.swisstopo.admin.ch/fr/orthophotos-swissimage-10-cm?utm_source=chatgpt.com)

Ce que votre modèle vision verra

[Industrial warehouse building rooftop with skylights and solar panels from aerial view](https://images.openai.com/static-rsc-4/jS61her_W8JjFSLi3jF_aNrujWC3uHLr6xgTh9iIjFRCRVB41jycCdmr2yQdDOJ7d4qWu4lhq-2Jgml3dXPqT4S6bwBN4SugxmpGMtQOiCc44aQ39DF9seidn2toZZxWHf_YS3Td1BBhOZcpmUjIDDuVmqFslSOfhJzwsakng7Xo_nQZLZkctV8E7R_02Pmp?purpose=inline)

Exemple visuel de toiture industrielle

[Sold Industrial & Warehouse Property at 7/48 Hutchinson Street, Burleigh Heads, QLD 4220 - realcommercial](https://images.openai.com/static-rsc-4/mn99pRPB9shhxeAaPSs2Hd9N4VvKaUP8fgDIF19AmqvlTyh3hans7MKnBoPaI5MqyBpNdBluhlTxmictYkGLT_vR6QtGYspIDOxX0gqx0PQ07vQAWY3Tt5jEeiY3vZcctZrujZoPgyDi8ID3RY37mhOFAJVEB8ng_9vJ6DYj48A?purpose=inline)

Exemple visuel de l'environnement extérieur

Images illustratives, non issues d'une analyse de bâtiment réel.

Pour éviter le gaspillage de tokens, il faut **recadrer précisément l'image sur l'emprise du bâtiment**, avec une petite marge pour l'environnement.

Si vous analysez une grande image de quartier, vous augmentez le coût du modèle vision et le risque qu'il décrive un bâtiment voisin.

### **F. Protections, valeur assurée et informations contractuelles**

Cette catégorie est indispensable au dossier AXA, même si une grande partie ne peut pas être déduite automatiquement.

| Champ du rapport                        | Source exacte                                           | Extraction             |
| --------------------------------------- | ------------------------------------------------------- | ---------------------- |
| Sprinklers                              | Documents techniques / déclaration client               | &#x20;Inconnu possible |
| Détection incendie                      | Documents d'inspection / client                         | &#x20;Inconnu possible |
| Compartimentage coupe-feu               | Plans, inspections                                      | &#x20;Inconnu possible |
| Protection contre l'inondation          | Plans, documents ou inspections                         | &#x20;Inconnu possible |
| Historique des sinistres                | AXA / déclaration client autorisée                      | &#x20;Non public       |
| Valeur de reconstruction                | Expertise / données de valorisation validées            | &#x20;Non garantie     |
| Estimation indicative de reconstruction | Surface appropriée × coûts de construction de référence | &#x20;Optionnelle      |
| Garanties demandées                     | Client / AXA                                            | &#x20;Non renseignées  |
| Franchises                              | Client / AXA                                            | &#x20;Non renseignées  |
| Type de couverture cantonale            | Localisation + règles assurantielles                    | &#x20;Auto             |
| Prime d'assurance                       | Modèle tarifaire AXA                                    | &#x20;Non calculée     |

AXA précise que les bâtiments sont en principe assurés à la valeur à neuf, fondée sur les coûts de reconstruction. Les couvertures incendie et événements naturels dépendent aussi du régime cantonal.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.axa.ch\&sz=32)

AXA



**Source :** [AXA — Assurance des bâtiments commerciaux](https://www.axa.ch/fr/clients-entreprises/offres/inventaire-immobilier/assurance-batiments.html?utm_source=chatgpt.com)

Je ne donnerais pas de valeur de reconstruction chiffrée dans le MVP tant que vous n'avez pas choisi et validé une méthode d'estimation des coûts au m².

C'est préférable à une valeur qui semble précise, mais qui est fondamentalement arbitraire.

## **3. Implémentation exacte : les outils de l'agent**

Je créerais **7 tools**, mais seulement deux auraient réellement besoin d'un modèle IA.

| Tool Python              | Input                | Output                             | Tokens LLM     |
| ------------------------ | -------------------- | ---------------------------------- | -------------- |
| `resolve_company()`      | Raison sociale       | UID, forme juridique, siège        | 0              |
| `resolve_building()`     | Adresse              | EGID, coordonnées, canton          | 0              |
| `get_building_profile()` | EGID                 | Caractéristiques, géométrie        | 0              |
| `get_hazards()`          | Géométrie + canton   | Dangers naturels, sources          | 0              |
| `get_aerial_image()`     | Géométrie            | Image recadrée, date, attribution  | 0              |
| `investigate_company()`  | Entreprise + adresse | Activité, preuves industrielles    | Variable       |
| `analyze_roof()`         | Image aérienne       | Observations visuelles structurées | 1 appel vision |

Un huitième composant, `generate_report()`, transforme les résultats en rapport. Il utilise au maximum un appel LLM pour la synthèse, puis un moteur de rendu classique pour l'interface et le PDF.

### **Ordre d'exécution réel**

\#chatgpt-mermaid-\_r_1g5\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_1g5\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_1g5\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_1g5\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_1g5\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_1g5\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_1g5\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_1g5\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_1g5\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_1g5\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_1g5\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_1g5\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_1g5\_ p{margin:0;}#chatgpt-mermaid-\_r_1g5\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_1g5\_ .label text,#chatgpt-mermaid-\_r_1g5\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .node rect,#chatgpt-mermaid-\_r_1g5\_ .node circle,#chatgpt-mermaid-\_r_1g5\_ .node ellipse,#chatgpt-mermaid-\_r_1g5\_ .node polygon,#chatgpt-mermaid-\_r_1g5\_ .node path{fill:rgb(19, 33, 54);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .rough-node .label text,#chatgpt-mermaid-\_r_1g5\_ .node .label text,#chatgpt-mermaid-\_r_1g5\_ .image-shape .label,#chatgpt-mermaid-\_r_1g5\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_1g5\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .rough-node .label,#chatgpt-mermaid-\_r_1g5\_ .node .label,#chatgpt-mermaid-\_r_1g5\_ .image-shape .label,#chatgpt-mermaid-\_r_1g5\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_1g5\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_1g5\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_1g5\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_1g5\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_1g5\_ .edgeLabel{background-color:rgb(14, 14, 14);text-align:center;}#chatgpt-mermaid-\_r_1g5\_ .edgeLabel p{background-color:rgb(14, 14, 14);}#chatgpt-mermaid-\_r_1g5\_ .edgeLabel rect{opacity:0.5;background-color:rgb(14, 14, 14);fill:rgb(14, 14, 14);}#chatgpt-mermaid-\_r_1g5\_ .labelBkg{background-color:rgba(14, 14, 14, 0.5);}#chatgpt-mermaid-\_r_1g5\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_1g5\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_1g5\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_1g5\_ .icon-shape,#chatgpt-mermaid-\_r_1g5\_ .image-shape{background-color:rgb(14, 14, 14);text-align:center;}#chatgpt-mermaid-\_r_1g5\_ .icon-shape p,#chatgpt-mermaid-\_r_1g5\_ .image-shape p{background-color:rgb(14, 14, 14);padding:2px;}#chatgpt-mermaid-\_r_1g5\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_1g5\_ .image-shape .label rect{opacity:0.5;background-color:rgb(14, 14, 14);fill:rgb(14, 14, 14);}#chatgpt-mermaid-\_r_1g5\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_1g5\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_1g5\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_1g5\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_1g5\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_1g5\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_1g5\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_1g5\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_1g5\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_1g5\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_1g5\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_1g5\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_1g5\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_1g5\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .node rect,#chatgpt-mermaid-\_r_1g5\_ .node circle,#chatgpt-mermaid-\_r_1g5\_ .node ellipse,#chatgpt-mermaid-\_r_1g5\_ .node polygon,#chatgpt-mermaid-\_r_1g5\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_1g5\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_1g5\_ .mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_1g5\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_1g5\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_1g5\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}#chatgpt-mermaid-\_r_1g5\_ .clean rect{fill:rgb(231, 243, 235)!important;color:rgb(22, 92, 57)!important;stroke:rgb(125, 174, 145)!important;}#chatgpt-mermaid-\_r_1g5\_ .clean polygon{fill:rgb(231, 243, 235)!important;color:rgb(22, 92, 57)!important;stroke:rgb(125, 174, 145)!important;}#chatgpt-mermaid-\_r_1g5\_ .clean ellipse{fill:rgb(231, 243, 235)!important;color:rgb(22, 92, 57)!important;stroke:rgb(125, 174, 145)!important;}#chatgpt-mermaid-\_r_1g5\_ .clean circle{fill:rgb(231, 243, 235)!important;color:rgb(22, 92, 57)!important;stroke:rgb(125, 174, 145)!important;}#chatgpt-mermaid-\_r_1g5\_ .clean path{fill:rgb(231, 243, 235)!important;color:rgb(22, 92, 57)!important;stroke:rgb(125, 174, 145)!important;}#chatgpt-mermaid-\_r_1g5\_ .clean tspan{fill:rgb(22, 92, 57)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai rect{fill:rgb(247, 234, 213)!important;color:rgb(128, 82, 19)!important;stroke:rgb(199, 165, 108)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai polygon{fill:rgb(247, 234, 213)!important;color:rgb(128, 82, 19)!important;stroke:rgb(199, 165, 108)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai ellipse{fill:rgb(247, 234, 213)!important;color:rgb(128, 82, 19)!important;stroke:rgb(199, 165, 108)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai circle{fill:rgb(247, 234, 213)!important;color:rgb(128, 82, 19)!important;stroke:rgb(199, 165, 108)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai path{fill:rgb(247, 234, 213)!important;color:rgb(128, 82, 19)!important;stroke:rgb(199, 165, 108)!important;}#chatgpt-mermaid-\_r_1g5\_ .ai tspan{fill:rgb(128, 82, 19)!important;}Formulaire : 3 champsIdentification entreprise etbâtimentBâtiment unique identifié ?Signaler ambiguïté oudemander sélectionLancer 4 branches en parallèleRegBL et géométrieRisques naturelsImage aérienneRecherche entrepriseImage exploitable ?Analyse vision cibléeVision non disponibleActivité industrielle ou preuvesutiles ?Investigation cibléeArrêt de la rechercheEvidence StoreValidation déterministeSynthèse LLM compacteRapport AXA + sources +inconnuesNonOuiOuiNonOuiNon

## **4. Comment contrôler précisément les tokens ?**

Je fixerais un budget par composant, plutôt que de laisser un agent décider librement combien d'appels effectuer.

## **Token Budget — Objectifs de conception**

Budgets indicatifs à ajuster selon le modèle utilisé ; ce ne sont pas des mesures réelles.

| Géocodage, RegBL, SIG      | 0 token                          |
| -------------------------- | -------------------------------- |
| Recherche de pages web     | 0 token LLM pour les appels HTTP |
| Extraction industrielle IA | \~2 000 tokens input             |
| Analyse vision             | 1 image + \~300 tokens output    |
| Synthèse finale            | \~2 000 input + \~700 output     |

Le coût réel de la vision dépend notamment du fournisseur, du modèle, de la résolution et du mode de facturation. Il sera mesuré séparément.

### **Les optimisations qui comptent vraiment**

**1. API first, LLM last.** Aucun LLM pour récupérer une année de construction, effectuer une intersection spatiale ou lire une valeur raster.

**2. Recherche web en deux étapes.** D'abord uniquement titres, URL et extraits courts. L'agent ouvre au maximum 3 à 5 sources prioritaires, idéalement le site officiel et des documents propres au bâtiment.

**3. Extraction ciblée.** Si un PDF contient 80 pages, on repère d'abord les pages sur les équipements et les procédés industriels. On n'envoie pas les 80 pages au modèle.

**4. Vision unique.** Le bâtiment est découpé à partir de sa géométrie. Une seule analyse vision est effectuée, sauf si la première échoue et qu'une autre image pertinente est disponible.

**5. Cache.** Les données liées à l'EGID, les cartes de dangers et les résultats de recherche sont conservés avec leur date de récupération. Le nom du client ne doit jamais entrer dans la clé de cache partagée des données publiques.

**6. Stop condition.** Chaque recherche doit avoir une raison précise : répondre à une question critique. On arrête lorsqu'on a une preuve suffisante ou que le budget est atteint.

L'agent ne doit pas continuer à chercher simplement parce qu'il lui reste des tokens.

## **5. Format commun de toutes les données collectées**

Chaque tool doit retourner des données normalisées. Exemple fictif :

```

{
  "field": "industrial_heat_process",
  "value": "thermal_treatment",
  "status": "company_level_evidence",
  "building_confirmed": false,
  "source": {
    "type": "company_website",
    "url": "https://example.com/production",
    "retrieved_at": "2026-11-21"
  },
  "evidence": "Company describes thermal treatment.",
  "confidence": "medium",
  "requires_verification": true
}

```

J'utiliserais quatre statuts de fiabilité :

| Statut     | Signification                                                           |
| ---------- | ----------------------------------------------------------------------- |
| `verified` | Valeur issue d'une source officielle ou d'une preuve directe pertinente |
| `observed` | Élément visuel observé par le modèle, non confirmé techniquement        |
| `inferred` | Hypothèse issue d'informations indirectes                               |
| `unknown`  | Information absente, contradictoire ou insuffisante                     |

**Chaque champ du rapport doit conserver la provenance de sa valeur.** Si deux sources se contredisent, l'agent ne doit pas choisir silencieusement.

## **6. Structure finale du rapport AXA**

# **Property Underwriting Report**

AXA Smart Property · Pré-évaluation B2B

01 — Property identification

Client, entreprise, UID, adresse, EGID, canton et caractéristiques du bâtiment

02 — Building characteristics

Année, dimensions, étages, toiture, installations visibles et images aériennes

03 — Natural hazard assessment

Résultats par danger, valeurs cartographiques, carte annotée et source de chaque donnée

04 — Fire & industrial exposure

Activité du site, procédés thermiques, matières potentiellement dangereuses et preuves publiques

05 — Protection & insured value

Protections documentées, valeur assurée si connue et informations non vérifiées

06 — Underwriting recommendations

Principales expositions, facteurs aggravants, preuves déterminantes et vérifications prioritaires

07 — Evidence & efficiency appendix

Liens sources, dates, fiabilité, appels outils, tokens, coût et durée

Dans le rapport, je n'afficherais pas une note arbitraire « Incendie : 87/100 ». Sans modèle actuariel AXA, ce chiffre n'a pas de signification fiable.

Je préférerais : « Activité de traitement thermique documentée — présence sur ce site à confirmer — protections anti-incendie inconnues — revue recommandée ».

C'est beaucoup plus utile à un souscripteur.

## **7. Roadmap de réalisation du hackathon**

| Phase                           | Travail à accomplir                                  | Résultat attendu                     |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| **1 — Data foundation**         | Géocodage, EGID, RegBL, règles cantonales            | Fiche bâtiment fiable                |
| **2 — Natural hazards**         | Données OFEV et MétéoSuisse, intersections spatiales | Analyse ruissellement, séisme, grêle |
| **3 — Multimodal**              | Orthophoto, cadrage du bâtiment, modèle vision       | Observations visuelles justifiées    |
| **4 — Industrial intelligence** | Recherche web ciblée, extraction de preuves          | Profil incendie et activité          |
| **5 — Evidence store**          | Normalisation JSON, sources, incertitudes            | Données traçables                    |
| **6 — Report**                  | Génération de synthèse et rendu visuel/PDF           | Rapport AXA                          |
| **7 — Benchmark**               | Coût, tokens, rapidité, vérification de la qualité   | Démonstration token-efficient        |

Pour la stack, je prendrais **FastAPI + Python (GeoPandas, Shapely, Rasterio) + Next.js**. PostgreSQL/PostGIS est utile si vous stockez plusieurs analyses et des couches géographiques, mais SQLite avec des fichiers géospatiaux prétraités peut suffire pour une première démonstration.

### **Ce qui doit marcher absolument**

Le minimum que je voudrais voir fonctionner de bout en bout : les trois champs client, l'EGID, les caractéristiques RegBL, les risques de ruissellement/séisme/grêle, une image aérienne analysée, une recherche industrielle sourcée et le rapport final.

Les cartes cantonales plus complexes, l'estimation de reconstruction et l'investigation approfondie des protections seraient des extensions.

## **8. Ce qui prouvera la valeur du projet aux juges**

Je ferais une évaluation sur trois bâtiments réels aux activités différentes : bureaux, entrepôt et industrie.

| Métrique                                    | Comment la mesurer                                        |
| ------------------------------------------- | --------------------------------------------------------- |
| Nombre de champs complétés automatiquement  | Nombre de données valides / total de champs applicables   |
| Exactitude des informations                 | Vérification manuelle contre les sources                  |
| Précision des affirmations industrielles    | Proportion d'affirmations étayées par une preuve correcte |
| Informations critiques manquantes détectées | Comparaison avec une checklist définie à l'avance         |
| Coût par rapport                            | Facturation API + LLM                                     |
| Tokens par rapport                          | Comptage réel des tokens input/output                     |
| Temps total                                 | Mesure du lancement à la génération                       |
| Gain d'efficacité                           | Comparaison avec un agent généraliste non optimisé        |

Vous pourriez comparer deux pipelines sur les mêmes bâtiments : un agent classique qui reçoit de longs documents et un agent optimisé qui utilise des outils déterministes, de courtes preuves et un seul appel de synthèse.

**Important :** l'optimisation n'est réussie que si vous diminuez les coûts **sans dégrader la qualité ou la couverture des informations**.

## **Ma recommandation finale**

Je construirais votre projet autour de trois avantages concrets :

**Côté client :** un seul formulaire avec trois champs, sans questionnaire industriel compliqué.

**Côté AXA :** un dossier pré-rempli, avec des informations qu'un analyste aurait autrement dû rechercher dans plusieurs registres, cartes, sites web et documents.

**Côté hackathon :** une IA multimodale qui démontre sa valeur là où les données structurées ne suffisent pas, avec une consommation de tokens réellement mesurée.

Un dernier point à intégrer dès le départ : les données cartographiques publiques sont généralement gratuites sous conditions d'utilisation, mais **les appels à un modèle LLM/vision et à un éventuel service commercial de recherche web ne sont pas nécessairement gratuits**. geo.admin.ch impose également des limites *fair use*.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.geo.admin.ch\&sz=32)

geo.admin.ch+1



**Le livrable doit être un dossier de pré-tarification enrichi et traçable, pas une promesse de calculer la prime d'assurance définitive à partir de trois champs.** C'est le périmètre qui offre le meilleur équilibre entre ambition technique, crédibilité assurantielle et faisabilité du hackathon.
