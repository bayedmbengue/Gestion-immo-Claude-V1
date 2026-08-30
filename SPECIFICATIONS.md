# ImmoGestion — Spécification fonctionnelle et technique

Ce document décrit fidèlement l'application **ImmoGestion** (gestion des immobilisations,
norme comptable **SYSCOHADA/OHADA**, marché francophone — Sénégal) telle qu'implémentée
dans le fichier source fourni. Il sert de référence pour reproduire à l'identique les
fonctionnalités, le design et les règles métier, indépendamment du code lui-même.

> ⚠️ Note technique sur la source fournie : le fichier HTML original se termine par un
> fragment corrompu (`</html>,\n    observations: soObs`) après la balise `</html>`.
> Le code JS et HTML est par ailleurs parfaitement équilibré (accolades/parenthèses
> comptées et égales), donc **aucune fonctionnalité n'est manquante** — ce fragment est
> un résidu de copier-coller sans effet dans un navigateur. Les fichiers `source/`
> fournis à côté de ce document ont été nettoyés de ce résidu.

---

## 1. Nature de l'application

- **Type** : application web monopage (SPA), **JavaScript vanilla**, sans framework
  (pas de React/Vue/Angular), sans étape de build, sans dépendance npm.
- **Fichiers** : un seul fichier HTML à l'origine (HTML + `<style>` + `<script>` inline).
  Il a été séparé ici en 3 fichiers équivalents pour plus de clarté :
  `index.html`, `style.css`, `app.js`.
- **Police** : Google Fonts — `DM Sans` (texte courant) et `DM Mono` (chiffres, code,
  identifiants).
- **Persistance** : **`localStorage`** du navigateur uniquement (aucun backend serveur
  requis pour fonctionner). Toutes les données (actifs, utilisateurs, journal, paramètres…)
  vivent dans un seul objet JS `DB`, sérialisé en JSON puis **chiffré avec un XOR simple
  + Base64** (clé codée en dur `ImmoG3st10n#S3cur3!`) avant écriture dans `localStorage`
  sous la clé `immogestion_v5`. Une migration automatique récupère les anciennes clés
  (`immogestion_v2/v3/v4`) si elles existent.
- **Option Cloud** : une couche de synchronisation optionnelle (push/pull vers un backend
  distant type REST, avec écran de connexion et guide de configuration) permet de
  sauvegarder/récupérer `DB` hors du navigateur. Elle est facultative : l'app fonctionne
  intégralement en local sans elle.
- **Licence / mode démo** : un système de licence côté client limite le nombre
  d'immobilisations en mode démo (`DEMO_LIMIT = 10`) et se débloque via une clé de licence
  saisie dans une modale dédiée (validation par hash, pas d'appel serveur).
- **Impression / export** : de nombreux écrans génèrent des documents imprimables
  (fenêtre `window.open` + `window.print()`) et exportent en Excel (CSV/XLS) ou JSON.

---

## 2. Authentification, rôles et permissions

### 2.1 Écran de connexion
- Écran plein écran (fond dégradé sombre) avec carte centrale : logo, champ email,
  champ mot de passe, bouton **Se connecter**.
- 3 comptes de démonstration affichés à l'écran :
  - `a.diallo@org.sn` / `admin123` → rôle **Administrateur**
  - `f.mbaye@org.sn` / `compta123` → rôle **Comptable**
  - `o.seck@org.sn` / `gest123` → rôle **Gestionnaire**
- Bouton **« Accéder sans mot de passe (réinitialiser les accès) »** : recrée un compte
  admin unique et réinitialise l'accès (utile après migration/perte de mot de passe).
- Les mots de passe sont hachés côté client en **SHA-256** (Web Crypto API,
  `crypto.subtle.digest`) — aucun salage visible dans la source.
- Un compte désactivé (`statut:'inactif'`) ne peut pas se connecter.
- Un **minuteur de session** déconnecte automatiquement l'utilisateur après inactivité
  (session watcher réinitialisé à chaque interaction).

### 2.2 Rôles (4)
| Rôle | Écrire | Supprimer | Valider | Administration | Exporter |
|---|:---:|:---:|:---:|:---:|:---:|
| `admin` (Administrateur) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `comptable` (Comptable) | ✅ | ❌ | ✅ | ❌ | ✅ |
| `gestionnaire` (Gestionnaire) | ✅ | ❌ | ❌ | ❌ | ✅ |
| `consultation` (Lecture seule) | ❌ | ❌ | ❌ | ❌ | ❌ |

- Ces permissions pilotent l'affichage dynamique des boutons/actions via des attributs
  `data-need-write`, `data-need-delete`, `data-need-admin` et la classe `.nav-admin`
  (masqués/affichés en JS selon le rôle courant).
- Toute action sensible passe par des **garde-fous** (`guardWrite`, `guardDelete`,
  `guardAdmin`) qui affichent un toast d'erreur « Accès refusé » si le rôle est insuffisant,
  en plus du masquage UI (défense en profondeur).
- Seul un administrateur voit les sections **Paramètres** et **Utilisateurs & droits**.

---

## 3. Structure de navigation (barre latérale)

Barre latérale fixe (248px), dégradé bleu marine (`#0D3B6E → #0A2D56`), avec logo
« Immo**Gestion** » + version, organisée en sections :

**Tableau de bord**
- Vue d'ensemble (`dashboard`)

**Gestion des actifs**
- Fiches immobilisations (`fiches`)
- Inventaire (`inventaire`)
- Plans d'amortissement (`amortissements`)
- Affectations (`affectations`)
- Sorties d'actifs (`sorties`) — badge numérique si des sorties sont en attente

**Planification**
- Révision de plan (`revision`)
- Budget prévisionnel (`budget`)

**Comptabilité**
- Écritures comptables (`ecritures`)
- Rapports & états (`rapports`)
- Journal d'audit (`journal`) — badge si nouvelles entrées, réservé en lecture large mais
  section technique

**Administration** (visible uniquement aux `admin`)
- Paramètres (`parametres`)
- Utilisateurs & droits (`utilisateurs`)

Pied de barre latérale : boutons **Sauvegarde** / **Restaurer** (export/import JSON
complet), carte utilisateur courant (avatar initiales, nom, rôle), bouton changer mot de
passe, bouton déconnexion.

Barre supérieure (topbar, 52px) : titre de la vue courante + sous-titre, date du jour,
bouton changer mot de passe, bouton **Licence**, bouton **Sauvegarder**.

**Responsive** : sur mobile, la sidebar devient un tiroir (overlay) ouvert via un bouton
hamburger (`#btn-menu`), avec un fond semi-transparent cliquable pour la refermer.

---

## 4. Modèle de données (objet `DB`)

```js
DB = {
  immobilisations: [],  // les actifs (fiches)
  sorties: [],           // sorties d'actifs (cessions, rebuts, vols, sinistres)
  affectations: [],       // historique des affectations/mutations
  journal: [],             // journal d'audit
  categories: [ /* 5 catégories initiales, voir §4.2 */ ],
  utilisateurs: [ /* 3 comptes démo, voir §2.1 */ ],
  params: { /* paramétrage global, voir §4.3 */ }
}
```

### 4.1 Fiche « immobilisation » — champs principaux
- Identité : `id`, `code` (identifiant unique généré, voir §6), `designation`,
  `categorie`, `nature` (Unité / Véhicule / Licence / Meuble / Appareil / Lot…),
  `marque`, `fournisseur`.
- Financier : `vo` (valeur d'origine), `financement` (Fonds propres / Subventions / …),
  champs **TVA** (taux, régularisation lors d'une cession), champs **comptables**
  `ci`/`ca` (compte d'immobilisation / compte d'amortissement, repris de la catégorie).
- Amortissement : `methode` (`lin` linéaire / `deg` dégressif), `duree` (années),
  `taux`, `dateAcq` (date d'acquisition), `dateMis` (date de mise en service),
  `cal` (calendrier `360` ou `365` jours — voir §5.1).
- Statut / cycle de vie : `statut` (`actif` / `sorti`), `etat` (état physique constaté :
  bon / …), `affectation` (localisation/service/personne actuels).
- Approches avancées (optionnelles, activables par actif) :
  - `composants[]` — décomposition par composants (norme IAS 16), chaque composant a
    sa propre VO, VR (valeur résiduelle), durée, méthode → plan d'amortissement consolidé.
  - Unités d'œuvre (**UO**) — amortissement basé sur l'usage réel (ex. heures machine,
    kilomètres) plutôt que sur le temps.
  - `IFRS16` — bascule pour le traitement des contrats de location selon IFRS 16.
  - Amortissement fiscal séparé de l'amortissement comptable (`togFiscalAmort`) →
    permet de calculer un **amortissement dérogatoire** (écart fiscal/comptable).
  - `revisions[]` — historique des révisions de plan (changement de durée/VR en cours
    de vie, avec recalcul prospectif à partir de la date de révision).
- Pièces jointes : `pj[]` — fichiers (factures, photos…) stockés en base64 dans la fiche,
  avec aperçu image inline ou téléchargement.
- Suivi : `maintenance` (historique d'entretien) et `depenses[]` (dépenses ultérieures
  liées à l'actif).

### 4.2 Catégories initiales (préconfigurées, modifiables)
Chaque catégorie fixe une durée par défaut, une méthode, et les comptes SYSCOHADA
associés (immobilisation / amortissement / dotation) :

| Code | Libellé | Durée | Méthode | Cpte immo. | Cpte amort. | Cpte dotation |
|---|---|---|---|---|---|---|
| INFO | Matériel informatique | 5 ans | Linéaire | 2414 | 2814 | 6813 |
| MOB | Mobilier de bureau | 10 ans | Linéaire | 2441 | 2841 | 6813 |
| TRANS | Matériel de transport | 5 ans | Linéaire | 2245 | 2845 | 6813 |
| INCORP | Immobilisations incorporelles | 3 ans | Linéaire | 2111 | 2801 | 6811 |
| AUTRE | Autres matériels | 5 ans | Linéaire | 2498 | 2898 | 6813 |

Ces catégories, comptes et durées sont **entièrement modifiables** dans
Paramètres → Catégories.

### 4.3 Paramètres globaux (`DB.params`)
- `methode` : méthode d'amortissement par défaut.
- `cal` : calendrier par défaut (360 ou 365 jours).
- `coef1/coef2/coef3` : coefficients dégressifs par tranche de durée (défauts 1.5 / 2.0 / 2.5).
- Numérotation des codes actifs : `codifModel` (`sequential` / `charte` / libre),
  `pfx`/`pfx2` (préfixes), `sep`/`sep2` (séparateurs), `yr` (format de date),
  `len`/`lennum` (longueurs de troncature/padding), `incyr` (inclure l'année),
  `nxt` (compteur auto-incrémenté).
- `entite` : informations de l'organisation (raison sociale, adresse, téléphone, email,
  **NINEA** — identifiant fiscal sénégalais —, logo, exercice comptable en cours) —
  utilisées dans les en-têtes des documents imprimés/exportés.

### 4.4 Autres entités
- `sorties[]` : chaque sortie référence l'actif (`immoId`), le motif
  (`cession` / `rebut` / `vol` / `sinistre`), une date, un statut de workflow
  (`attente` → validé/rejeté), et, pour une cession, un prix de cession + calcul de la
  régularisation de TVA.
- `affectations[]` : historique des mutations d'un actif (ancien/nouveau lieu ou
  responsable, date, motif).
- `journal[]` : entrées d'audit `{action, entité, détail, méta, utilisateur, date}`
  générées automatiquement à chaque création/modification/suppression/validation.

---

## 5. Règles de calcul de l'amortissement (cœur métier)

### 5.1 Prorata temporis (première année incomplète)
Deux calendriers possibles, configurables par actif :
- **360 jours (calendrier financier / comptable)** : mois de 30 jours.
  `joursRestants = (mois_restants_après_acquisition × 30) + (30 − jour_acquisition + 1)`
- **365 jours (calendrier civil)** : nombre réel de jours entre la date d'acquisition et
  le 31/12 inclus.

La 1ʳᵉ dotation = `arrondi(VO × taux × joursRestants / base_calendrier)`.

### 5.2 Méthode linéaire
Dotation annuelle constante = `VO × taux` (taux = `1/durée`), sauf 1ʳᵉ et dernière année
proratisées.

### 5.3 Méthode dégressive
Taux dégressif = `taux linéaire × coefficient`, coefficient dépendant de la durée
d'utilité (barème SYSCOHADA classique, valeurs par défaut personnalisables) :
- Durée ≤ 4 ans → coefficient **1,5**
- Durée ≤ 6 ans → coefficient **2,0**
- Durée > 6 ans → coefficient **2,5**

Le calcul bascule automatiquement en linéaire sur la valeur nette comptable restante dès
que le taux linéaire résiduel devient supérieur au taux dégressif (règle classique de
crossover dégressif/linéaire).

### 5.4 Approche par composants (IAS 16)
Si l'actif a des `composants[]` définis, le plan global n'est **plus** calculé sur la
valeur d'origine unique : chaque composant a son propre plan (VO, VR, durée, méthode),
calculé aux mêmes dates que le bien parent, puis les plans sont **agrégés par exercice**
pour produire un plan consolidé (dotation totale, cumul, VNC globale par an).

### 5.5 Unités d'œuvre (amortissement variable)
Alternative au temps : la dotation d'une période est calculée au prorata d'une **unité
d'usage réelle** saisie période par période (ex. heures d'utilisation, unités produites)
plutôt qu'au prorata du temps écoulé.

### 5.6 Révision de plan
Un actif en cours de vie peut voir sa durée résiduelle ou sa valeur résiduelle
**révisée** (ex. changement d'estimation) : le plan est recalculé de façon
**prospective** (uniquement à partir de la date de révision), en conservant les dotations
déjà passées. L'historique de chaque révision est conservé sur la fiche.

### 5.7 Sortie d'actif en cours d'exercice
Lors d'une sortie, une dotation complémentaire (« dotation de sortie ») est calculée au
prorata des jours écoulés depuis le 1ᵉʳ janvier (ou la date de mise en service) jusqu'à
la date de sortie, avec le même principe de calendrier 360/365 que pour la 1ʳᵉ année.
Une régularisation de TVA est calculée lors d'une cession.

---

## 6. Numérotation automatique des immobilisations

Trois modèles au choix (paramétrables), appliqués à la création d'une fiche :

1. **Séquentiel** — `PRÉFIXE-ANNÉE-NNN` (ex. `IMM-2024-001`), compteur auto-incrémenté,
   année optionnelle, longueur du numéro paramétrable (padding avec des zéros).
2. **Charte** — motif personnalisé construit à partir des données de l'actif :
   `DESIG.MARQUE.jj/mm/aa.SEQ` (ex. `SERV.DELL.15/03/24.1`), où :
   - `DESIG` = 4 premières lettres (paramétrable) de la désignation, majuscules, accents
     retirés ;
   - `MARQUE` = marque nettoyée (alphanumérique), max 10 caractères ;
   - la date d'acquisition est formatée selon le paramètre choisi (jj/mm/aa ou
     jj/mm/aaaa, ou omise) ;
   - séparateurs personnalisables (`.` par défaut).
3. **Libre** — aucune génération automatique, saisie manuelle du code par l'utilisateur.

Le compteur (`nxt`) est incrémenté à chaque génération réussie et sauvegardé.

---

## 7. Détail des écrans / fonctionnalités

### 7.1 Tableau de bord
Indicateurs synthétiques (nombre d'actifs actifs, valeur d'origine totale, valeur nette
comptable totale, sorties en attente de validation…) + éventuellement des graphiques
de synthèse et une liste des dernières actions.

### 7.2 Fiches immobilisations
- Liste filtrable/triable (par statut : tous / actifs / amortis / sortis ; recherche
  texte) des actifs, avec badge de statut (Actif/Sorti).
- Création (**Nouvelle immobilisation**) et édition d'une fiche : formulaire complet
  (identité, financier, amortissement, options avancées composants/UO/IFRS16/fiscal),
  génération/aperçu automatique du code selon le modèle choisi.
- Fiche détail : onglets (informations, plan d'amortissement, composants, UO, TVA,
  révisions, maintenance, dépenses, pièces jointes).
- Impression de la fiche (document formaté A4) et génération/impression d'un **QR code**
  par actif (pour l'inventaire physique).
- Suppression (réservée aux rôles autorisés à supprimer).

### 7.3 Inventaire
- Génération de la liste d'inventaire à contrôler (avec QR code par ligne).
- **Inventaire contradictoire** : interface de pointage — cocher chaque actif trouvé,
  ajuster son état constaté, ajouter une observation ; possibilité de déclarer des
  **surplus** (biens physiquement trouvés mais non recensés) ; validation produit un
  rapport d'écarts (biens manquants / surplus / états divergents), imprimable et
  exportable.
- Sauvegarde de « situations d'inventaire » (snapshots datés), consultables et
  restaurables plus tard.

### 7.4 Plans d'amortissement
- Recherche/sélection d'un actif (recherche dynamique avec liste déroulante filtrée en
  temps réel).
- Affichage du plan d'amortissement complet (par exercice : dotation, cumul, VNC),
  compatible avec les cas composants/UO.
- Export Excel et PDF du plan, impression.

### 7.5 Affectations
- Recherche d'un actif, affectation/réaffectation à un lieu/service/personne, avec
  historique conservé.
- Vue de répartition des actifs par lieu d'affectation.

### 7.6 Sorties d'actifs
- Création d'une sortie : sélection de l'actif, motif (cession / mise au rebut / vol /
  sinistre), date, et si cession, prix de cession (calcul automatique de la plus/moins
  value et de la régularisation de TVA).
- Liste des sorties avec statut (**en attente** / validée / rejetée) ; badge dans la
  sidebar sur les sorties en attente.
- Validation ou rejet d'une sortie (réservé aux rôles habilités à valider) → génère les
  écritures comptables correspondantes et un document imprimable « Fiche de sortie ».

### 7.7 Révision de plan
- Recherche d'un actif, saisie des nouveaux paramètres (durée résiduelle et/ou valeur
  résiduelle révisées), aperçu de l'impact avant application, application définitive
  (recalcul prospectif du plan), export de l'historique des révisions.

### 7.8 Budget prévisionnel
- Vue par catégorie des dotations prévisionnelles sur plusieurs exercices futurs
  (graphique dotations existantes vs. planifiées).
- Gestion de lignes budgétaires (création/édition/suppression) pour des acquisitions
  futures prévues, avec calcul d'impact prévisionnel.
- Export du budget.

### 7.9 Écritures comptables
- Génération des écritures de dotation aux amortissements pour un exercice/une période
  donnée (mode prédéfini ou dates personnalisées), avec calcul d'aperçu avant génération.
- Export au format générique et au **format Sage**.
- Gestion de la **clôture d'exercice** (marquer un exercice comme clos) et historique
  des clôtures.

### 7.10 Rapports & états
Sept types de rapports, sélectionnables via des cartes, chacun avec filtres, tri de
colonnes, et export Excel/PDF/impression :
- **État des immobilisations** (`immo`)
- **Tableau des amortissements** (`amort`) — avec vue détaillée/synthétique et tri
- **Valeurs nettes comptables** (`vnc`)
- **État SYSCOHADA** normé (`syscoa`)
- **Amortissements dérogatoires** (`derog`) — écart fiscal/comptable
- **Répartition analytique** par axe (`analytique`) — voir §7.13
- **Rapport multi-exercices** (`multiyr`)

### 7.11 Journal d'audit
- Liste chronologique de toutes les actions (création, modification, suppression,
  validation…) avec utilisateur, horodatage, entité concernée et détail.
- Consultation des métadonnées d'une action, export, purge du journal (admin).

### 7.12 Paramètres (admin)
- **Catégories** : CRUD des catégories d'actifs (durée, méthode, comptes SYSCOHADA).
- **Numérotation** : choix du modèle de codification et de ses paramètres (voir §6),
  avec aperçu en direct du code généré.
- **Comptabilité** : configuration des comptes par défaut.
- **Entité** : informations de l'organisation + logo (glisser-déposer ou sélection de
  fichier, aperçu, suppression).
- **Sauvegarde/Restauration** : export/import JSON complet de `DB`.
- **Import CSV** : import en masse d'actifs, avec téléchargement d'un modèle CSV,
  aperçu des lignes avant import (erreurs bloquantes / avertissements non bloquants
  affichés distinctement), validation ligne à ligne.
- **Licence** : activation/désactivation d'une clé de licence.

### 7.13 Axes analytiques
- Une section permet de définir des **axes analytiques** (dimensions de reporting
  personnalisées, ex. par site/projet/service) et de générer un rapport de répartition
  des immobilisations selon ces axes.

### 7.14 Utilisateurs & droits (admin)
- Liste des utilisateurs, création/édition, activation/désactivation d'un compte,
  changement du mot de passe d'un utilisateur par l'admin, attribution du rôle.

---

## 8. Design system

### 8.1 Palette de couleurs (variables CSS `:root`)
```css
--bg:#F0F5FA;            /* fond général */
--surface:#FFFFFF;       /* cartes/panneaux */
--surface2:#EAF2FA;      /* fond secondaire (survols, zébrage) */
--surface3:#D6E8F5;
--text:#1A2B3C;  --text2:#2D4A63;  --text3:#5A7A96;   /* hiérarchie typographique */
--border:#C8DDF0;  --border2:#A0BDD6;
--blue:#0D47A1;  --blue-light:#E3F0FB;  --blue-dark:#0A3578;  --blue-mid:#1565C0; /* couleur de marque */
--green:#1B6E3C;  --green-light:#E3F5EB;   /* succès / actif */
--red:#B71C1C;    --red-light:#FDECEA;     /* erreur / suppression / sorti */
--amber:#BF6000;  --amber-light:#FEF3E2;   /* avertissement */
--purple:#4527A0; --purple-light:#EDE7F6;  /* accent secondaire */
--r:8px; --rl:12px; --rxl:16px;            /* rayons de bordure (petit/moyen/grand) */
--shadow / --shadow-md / --shadow-lg       /* ombres bleutées, 3 intensités */
--f:'DM Sans', sans-serif;   /* police texte */
--m:'DM Mono', monospace;    /* police chiffres/code */
```
- Sidebar : dégradé `linear-gradient(180deg, #0D3B6E 0%, #0A2D56 100%)`, texte blanc à
  opacité variable pour la hiérarchie, icônes SVG traits (stroke) en `currentColor`.
- Page de connexion : fond dégradé sombre `#1B1F24 → #22262C → #2C333B`, carte blanche
  centrale à coins très arrondis (20px) et ombre marquée.

### 8.2 Typographie
- Police principale **DM Sans** (300/400/500/600, + italique 400) pour toute l'UI.
- Police **DM Mono** (400/500) pour les nombres, montants, codes, identifiants — donne
  un rendu « tableau de bord financier » lisible et aligné.
- Taille de base `14px` sur `body`, `font-smoothing: antialiased`.

### 8.3 Composants récurrents (classes CSS)
- `.btn` (+ variantes `.btn.p` primaire, `.btn.d` danger/suppression, `.btn.sm` petit) :
  boutons à coins arrondis (`--r`), transitions douces au survol.
- `.fgr` (form group row) + `label` + `input/select` : champs de formulaire standardisés,
  regroupés dans `.fg` (grille de formulaire).
- `.ni` (nav item) : élément de navigation latérale, état `.active` mis en surbrillance,
  icône SVG + libellé, badge `.nbadge` optionnel (pastille numérique).
- `.mb` / `.modal` / `.mh` / `.mbody` / `.mf` : structure de fenêtre modale (overlay,
  conteneur, en-tête avec bouton fermer `.xbtn`, corps, pied avec actions).
- `.st` (statut) avec classes contextuelles (`actif` vert, `sorti` rouge, etc.) pour les
  badges de statut dans les tableaux.
- Tableaux de données : en-têtes en majuscules discrètes, cellules numériques alignées à
  droite en police mono, lignes zébrées légères, bordures fines `--border`.
- Barre supérieure fixe (52px) avec titre de vue + actions rapides.

### 8.4 Documents imprimés/exportés
Les documents générés (fiches, plans d'amortissement, rapports, fiches de sortie) suivent
une charte plus sobre orientée impression (Arial/sans-serif, tableaux à en-têtes bleu
clair `#EBF4FF`/texte bleu `#1B6EC2`, `@media print` dédié format A4).

---

## 9. Points d'attention pour la reproduction

1. **Fidélité du calcul d'amortissement** : c'est le cœur métier — reproduire exactement
   les règles de prorata temporis (360 vs 365), le barème dégressif, la logique
   composants/UO et la révision prospective de plan (§5).
2. **Système de rôles** : reproduire les 5 permissions × 4 rôles et le double
   verrouillage (masquage UI + garde-fous fonctionnels), pas seulement le masquage visuel.
3. **Numérotation configurable** : les 3 modèles de génération de code (§6) avec aperçu
   en temps réel dans le formulaire.
4. **Comptes SYSCOHADA** : les catégories par défaut avec leurs comptes 24xx/28xx/68xx
   doivent être respectées telles quelles (référentiel comptable OHADA).
5. **Persistance locale uniquement** : ne pas supposer de backend serveur — tout doit
   fonctionner avec `localStorage` (ou un équivalent), avec export/import JSON comme
   mécanisme de sauvegarde/portabilité.
6. ⚠️ **Sécurité** : le chiffrement XOR et le hachage SHA-256 sans salage sont une
   protection légère, pas un vrai chiffrement/hashing sécurisé — c'est un choix
   assumé pour une app 100% client-side sans serveur. À reproduire tel quel si l'objectif
   est la parité fonctionnelle exacte, mais à signaler si l'app doit un jour gérer des
   données réellement sensibles.
7. **Cohérence des libellés** : toute l'interface est en français (Sénégal/Afrique
   francophone) ; conserver la terminologie SYSCOHADA (« immobilisations », « dotations »,
   « valeur nette comptable », « exercice », etc.) sans la traduire ou la simplifier.
