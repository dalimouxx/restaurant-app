# Déploiement sur Render — pas à pas

Durée : environ 20 minutes, dont 5 à 8 minutes de compilation.

---

## L'architecture retenue

| Brique | Hébergeur | Pourquoi |
|---|---|---|
| Application et API | Render | HTTPS automatique, déploiement depuis GitHub |
| Base PostgreSQL | **Neon** | Les données ne sont pas supprimées au bout de 30 jours, contrairement à la base Render gratuite |

### Ce que le plan gratuit implique

| Contrainte | Conséquence concrète |
|---|---|
| Render endort le service après **15 min** sans trafic, réveil ~1 min | L'écran cuisine cesse de recevoir les tickets ; la première visite est lente |
| Neon suspend le calcul après **5 min** sans requête | La requête suivante réveille la base. Le code gère ce réveil : réessais automatiques et message « réessayez » plutôt qu'une panne |
| Neon : 1 Go de stockage, **100 heures de calcul** par mois | Largement assez pour tester. Attention : tant qu'un écran reste ouvert, il interroge l'API toutes les 15 à 20 secondes, donc la base ne dort jamais et le quota s'épuise en continu |
| Neon : les données ne sont **jamais supprimées** | C'est l'avantage décisif sur la base Render |

Pour un usage réel : passez `plan: free` en `starter` dans `render.yaml`, et
prenez un plan payant chez Neon.

**Le bon côté :** Render fournit le HTTPS. Le scan de QR code et la
géolocalisation, bloqués par les navigateurs en HTTP, fonctionnent donc
immédiatement.

---

## Étape 1 — Créer la base chez Neon

1. Allez sur [neon.com](https://neon.com), créez un compte (connexion GitHub
   possible).
2. **New Project**.
   - Nom : `restaurant`
   - Région : **Europe (Frankfurt)** — la plus proche de la Tunisie, et la
     même que le service Render
   - Version de PostgreSQL : laissez celle proposée
3. Neon affiche une chaîne de connexion. **Copiez-la**, elle ressemble à :

   ```
   postgresql://restaurant_owner:xxxxx@ep-cool-name-123456.eu-central-1.aws.neon.tech/restaurant?sslmode=require
   ```

   ⚠️ **Prenez la version sans `-pooler` dans le nom d'hôte.** Neon en
   propose deux : celle avec `-pooler` est destinée aux fonctions
   serverless, pas à un serveur Node qui garde ses connexions ouvertes.
   Si vous ne voyez que la version « pooled », décochez l'option
   *Connection pooling* au-dessus de la chaîne.

Gardez cette chaîne sous la main pour l'étape suivante.

---

## Étape 2 — Créer le Blueprint sur Render

Le code est déjà sur GitHub : `dalimouxx/restaurant-app`.

1. Allez sur [render.com](https://render.com) et connectez-vous avec GitHub.
2. **New** → **Blueprint**.
3. Sélectionnez le dépôt `restaurant-app`. Autorisez Render à y accéder s'il
   le demande (le dépôt est privé).
4. Render lit `render.yaml` et propose de créer le service
   `service-restaurant`.

5. Render demande trois valeurs :

   | Variable | Quoi mettre |
   |---|---|
   | `DATABASE_URL` | La chaîne Neon copiée à l'étape 1 |
   | `ADMIN_EMAIL` | Votre email de connexion, par exemple `mohamed@monrestaurant.tn` |
   | `ADMIN_PASSWORD` | Un mot de passe **d'au moins 10 caractères** |

   Le compte administrateur est créé au premier démarrage, uniquement si la
   base est vide. Notez le mot de passe : il n'est affiché nulle part ensuite.

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
| Première visite très lente | Service Render endormi | Normal, ~1 minute. Disparaît en plan payant |
| « Base de données momentanément indisponible » (503) | Neon réveillait son calcul | Réessayez : la requête suivante passe. Le serveur ne tombe pas |
| `Base injoignable (tentative 1/5)` au démarrage | Neon dormait pendant le déploiement | Normal : le serveur réessaie et démarre seul |
| `password authentication failed` | Chaîne Neon incomplète ou expirée | Recopiez-la depuis le tableau de bord Neon |
| Quota Neon épuisé en milieu de mois | Les écrans ouverts interrogent l'API en continu, la base ne dort jamais | Fermez les écrans inutilisés, ou passez à un plan payant |
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

### Comportement face à une base suspendue (le cas Neon)

Rejoué en coupant réellement la base en cours de service :

| Moment | Résultat |
|---|---|
| Base coupée au démarrage | Le serveur réessaie (1 s, 2 s, 4 s, 8 s) et démarre dès qu'elle répond |
| Requête pendant la suspension | **503** avec un message clair — auparavant, le processus Node mourait |
| `/health` pendant la suspension | **200** : le service reste debout |
| Après le réveil | **200** sans aucun redémarrage |
