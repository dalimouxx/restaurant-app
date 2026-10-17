# Déploiement sur Render — pas à pas

Durée : environ 20 minutes, dont 5 à 8 minutes de compilation.

---

## Avant de commencer : ce que vous devez savoir

Le plan gratuit de Render convient **pour tester**, pas pour servir un vrai
restaurant :

| Contrainte du plan gratuit | Conséquence concrète |
|---|---|
| La base de données est **supprimée 30 jours** après sa création (14 jours de grâce pour migrer) | Toutes les données partent |
| Le service **s'endort après 15 minutes** sans trafic, réveil en ~1 minute | L'écran cuisine cesse de recevoir les tickets ; la première visite est lente |
| 1 Go de stockage, 750 heures d'instance par mois | Suffisant pour tester |

Pour une mise en service réelle, passez les deux `plan: free` du fichier
`render.yaml` en `starter`. C'est le seul changement nécessaire.

**Le bon côté :** Render fournit le HTTPS automatiquement. Le scan de QR code
et la géolocalisation, bloqués par les navigateurs en HTTP, fonctionneront
immédiatement.

---

## Étape 1 — Mettre le code sur GitHub

Render déploie depuis un dépôt Git.

```bash
cd restaurant-app
git init
git add .
git commit -m "Application web de gestion de restaurant"
```

Créez un dépôt **privé** sur GitHub, puis :

```bash
git remote add origin https://github.com/dalimouxx/restaurant-app.git
git branch -M main
git push -u origin main
```

Le fichier `.gitignore` exclut déjà `node_modules`, `dist` et `.env` :
aucun mot de passe ne part sur GitHub.

---

## Étape 2 — Créer le Blueprint sur Render

1. Allez sur [render.com](https://render.com) et connectez-vous avec GitHub.
2. **New** → **Blueprint**.
3. Sélectionnez le dépôt `restaurant-app`.
4. Render lit `render.yaml` et propose de créer deux ressources :
   - `service-restaurant` — l'application
   - `restaurant-db` — la base PostgreSQL

5. Render demande deux valeurs. **Choisissez-les maintenant :**

   | Variable | Quoi mettre |
   |---|---|
   | `ADMIN_EMAIL` | Votre email de connexion, par exemple `mohamed@monrestaurant.tn` |
   | `ADMIN_PASSWORD` | Un mot de passe **d'au moins 10 caractères** |

   Ce compte est créé au premier démarrage, uniquement si la base est vide.
   Notez le mot de passe : il n'est affiché nulle part ensuite.

6. **Apply**.

Render compile l'interface puis démarre le serveur. Comptez 5 à 8 minutes
pour le premier déploiement.

---

## Étape 3 — Vérifier que tout est parti

Dans l'onglet **Logs** du service, vous devez voir :

```
Application web servie depuis web/dist
Connexion a la base de donnees reussie.
Compte administrateur cree : mohamed@monrestaurant.tn
Carte de demonstration creee : 5 produits, 7 ingredients.
Serveur demarre sur le port 10000
```

Si vous lisez `JWT_SECRET manquant`, c'est que le Blueprint n'a pas été
utilisé : ajoutez la variable à la main dans **Environment**.

Votre adresse est affichée en haut de la page, du type :

```
https://service-restaurant.onrender.com
```

---

## Étape 4 — Première connexion

| Poste | Adresse |
|---|---|
| Accueil | `https://votre-adresse.onrender.com/` |
| Gestion | `/gestion` — votre email et mot de passe |
| Borne | `/borne` — aucune connexion |
| Commande en ligne | `/commander` |
| Caisse | `/caisse` |
| Cuisine | `/cuisine` |
| Livreur | `/livreur` |

### Créer vos employés

Allez dans **Gestion → Équipe**, bouton **Ajouter** :

- **Caissier** : donnez-lui un code à 4 chiffres. Il s'en servira sur `/caisse`.
- **Cuisinier** : email et mot de passe, pour `/cuisine`.
- **Livreur** : son badge QR est généré automatiquement. Cliquez sur l'icône
  QR pour l'afficher, puis **Imprimer**. Le livreur le scanne pour se
  connecter sur `/livreur`.

---

## Étape 5 — Tester le circuit complet

Ouvrez plusieurs onglets, ou mieux : la borne sur un PC, la cuisine sur un
autre écran, le livreur sur un téléphone.

1. **`/borne`** — composez une commande, validez. Notez le numéro affiché.
2. **`/caisse`** — connectez-vous avec le code du caissier, saisissez un fond
   de caisse, la commande apparaît. Encaissez.
3. **`/cuisine`** — le ticket arrive seul en quelques secondes. Faites
   « Commencer » puis « Marquer prête ».
4. **`/gestion`** — le stock a baissé tout seul, le chiffre d'affaires a bougé.

### Tester la livraison

1. **`/commander`** sur un téléphone — choisissez « Livraison », autorisez la
   géolocalisation, validez.
2. **`/caisse`** — encaissez la commande.
3. **`/cuisine`** — marquez-la prête : elle bascule en attente de livreur.
4. **`/livreur`** sur un second téléphone — la course apparaît avec la
   distance. Acceptez.
5. Sur le téléphone du client, l'écran de suivi montre le livreur **se
   déplacer sur la carte en direct**.
6. Le client affiche son QR, le livreur le scanne : la course se clôture et sa
   commission apparaît dans ses gains.

---

## Avant d'ouvrir à de vrais clients

1. **Passez en plan payant.** Sans cela, la base disparaît au bout de 30 jours
   et le service s'endort toutes les 15 minutes.

2. **Désactivez la carte de démonstration.** Dans **Environment**, passez
   `SEED_DEMO` à `false`. Sans cela, une base vide serait repeuplée de pizzas
   de test au prochain démarrage.

3. **Saisissez votre vraie carte.** Point important : l'interface permet de
   gérer le stock et l'équipe, mais **pas encore de créer vos produits et
   catégories**. Trois possibilités :
   - faire construire l'écran « Carte » (le plus propre) ;
   - modifier le menu de démonstration dans `backend/src/bootstrap.js` pour y
     mettre vos vrais plats avant le premier déploiement ;
   - saisir les produits directement en base via le shell Render.

4. **Vérifiez les recettes.** Le stock ne se déduit que si chaque produit est
   relié à ses ingrédients avec les bonnes quantités. Sans recette, le plat se
   vend mais le stock ne bouge pas.

5. **Ajustez les frais de livraison.** Ils sont fixés à 7 DT dans
   `backend/src/routes/order.routes.js`. La commission livreur (70 %) se règle
   par la variable `DRIVER_COMMISSION_PERCENT`.

6. **Remplacez `sequelize.sync()` par des migrations** avant toute évolution du
   schéma sur une base contenant de vraies données.

---

## Mettre à jour l'application

```bash
git add .
git commit -m "Description du changement"
git push
```

Render redéploie automatiquement. Les écrans ouverts reprennent la nouvelle
version au rafraîchissement — rien à réinstaller sur les appareils.

---

## Problèmes courants

| Symptôme | Cause | Solution |
|---|---|---|
| Page blanche, erreur `JWT_SECRET manquant` dans les logs | Variable absente | Ajoutez-la dans **Environment** |
| `Origine non autorisee` (403) | Un autre domaine appelle l'API | Ajoutez-le à `ALLOWED_ORIGINS`, séparé par des virgules |
| Première visite très lente | Service endormi (plan gratuit) | Normal, ~1 minute. Disparaît en plan payant |
| La caméra ne s'ouvre pas | Navigateur sans l'API de lecture de code | Utilisez Chrome ou Edge ; la saisie manuelle du code reste possible |
| La cuisine ne reçoit plus rien | Service endormi, WebSocket coupé | Rafraîchissez. L'indicateur rouge « Hors ligne » le signale |
| Échec de compilation | Lockfile absent | Vérifiez que `package-lock.json` est bien poussé sur GitHub |

---

## Ce qui a été vérifié

Avant livraison, l'ensemble a été exécuté dans les conditions de Render
(`NODE_ENV=production`, `DATABASE_URL`, base vierge) :

- refus de démarrer sans `JWT_SECRET` ;
- création du compte administrateur sur base vide, **sans doublon** au
  redémarrage ;
- absence de tout identifiant de démonstration (`admin123` renvoie 401) ;
- CORS : 403 pour une origine externe, 200 en même origine ;
- routage des pages : `/caisse`, `/gestion/stock` et les autres répondent au
  rechargement direct ;
- **132 contrôles automatisés** : commandes, encaissement, stock, attribution
  d'une course à un seul livreur, commissions, cloisonnement des rôles.
