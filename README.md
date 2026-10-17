# Service — gestion de restaurant

Application **web unique** couvrant la salle, la caisse, la cuisine, la gestion
et la livraison, adossée à une API Node.js et une base PostgreSQL.

Un seul code, un seul déploiement, une URL par poste de travail.

---

## Les postes

| URL | Poste | Qui s'en sert | Connexion |
|---|---|---|---|
| `/` | Accueil | Tout le monde | — |
| `/borne` | Borne de commande | Client en salle | Aucune |
| `/commander` | Commande en ligne | Client à distance | Nom + téléphone |
| `/commande/:id` | Suivi de commande | Client | Session client |
| `/caisse` | Encaissement | Caissier | Code à 4 chiffres |
| `/cuisine` | Écran de préparation | Cuisine | Email + mot de passe |
| `/livreur` | Courses et gains | Livreur | Badge QR |
| `/gestion` | Finances, stock, équipe, caisses | Gérant | Email + mot de passe |

---

## Démarrage

### 1. Base de données

```sql
CREATE DATABASE restaurant_db;
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env     # renseignez DB_PASSWORD et JWT_SECRET
npm run seed             # crée les tables et les comptes de départ
```

### 3. Application web

```bash
cd ../web
npm install
npm run build
```

### 4. Lancer

```bash
cd ../backend
npm run dev
```

Ouvrez `http://localhost:4000`.

Le backend détecte `web/dist` et sert l'application lui-même : **un seul
serveur à démarrer**, pas de configuration CORS, pas d'hébergement séparé.

### Développement de l'interface

Pour travailler sur le web avec rechargement instantané, lancez les deux
en parallèle :

```bash
cd backend && npm run dev     # terminal 1, port 4000
cd web && npm run dev         # terminal 2, port 5173
```

L'interface sur `http://localhost:5173` parle automatiquement au backend du
port 4000. Sur un autre poste du réseau, créez `web/.env` avec
`VITE_API_URL=http://<ip-du-serveur>:4000`.

---

## Comptes de départ

| Poste | Identifiants |
|---|---|
| Gérant | `manager@restaurant.com` / `manager123` |
| Super admin | `admin@restaurant.com` / `admin123` |
| Caissier | code `1234` |
| Livreur | badge QR, à afficher depuis Gestion → Équipe |

**Changez ces mots de passe avant toute mise en service.**

---

## État de validation

### Backend et contrat d'API : vérifiés — 132 contrôles, 0 échec

Exécutés contre un vrai serveur Node.js connecté à PostgreSQL 16.

```bash
cd backend
npm run seed
node src/server.js &
node tests/integration.test.js      # 23 contrôles
node tests/delivery-race.test.js    # concurrence entre livreurs
node tests/e2e-delivery.test.js     # 21 contrôles, cycle complet
node tests/web-contract.test.js     # 85 contrôles, types attendus par le web
```

Couvert : connexion par mot de passe, code et badge QR ; création de commande
borne et en ligne ; encaissement puis envoi automatique en cuisine ; déduction
du stock selon la recette ; désactivation et réactivation automatique d'un plat
en rupture ; **attribution d'une course à un seul livreur** sur deux requêtes
simultanées ; refus d'un QR de livraison invalide ; commission livreur ; bénéfice
net ; cloisonnement des rôles.

### Interface web : compilée et typée, rendu non vérifié

`tsc` et `vite build` passent sans erreur, et chaque réponse de l'API a été
comparée aux types attendus par l'interface. En revanche **le rendu visuel n'a
pas pu être contrôlé dans un navigateur** pendant la construction : prévoyez une
passe d'ajustement visuel sur vos écrans réels.

---

## Ce qui a changé par rapport à la version Flutter

| Sujet | Avant | Maintenant |
|---|---|---|
| Déploiement | 6 applications à compiler et installer | Une URL, une mise à jour |
| iOS | Compte Apple à 299 $/an | Le navigateur suffit |
| Carte de suivi | Google Maps, clé API payante | Leaflet et OpenStreetMap, gratuit |
| Coordonnées GPS | Jamais envoyées | Envoyées et stockées |
| Scan QR en caisse | Non branché | Caméra du navigateur |
| Mise à jour | Réinstaller sur chaque appareil | Rafraîchir la page |

---

## Points à traiter avant la mise en service

1. **HTTPS obligatoire.** La caméra (scan QR) et la géolocalisation sont
   bloquées par les navigateurs hors HTTPS, sauf sur `localhost`. Un certificat
   gratuit Let's Encrypt suffit.
2. **Remplacer `sequelize.sync()`** par de vraies migrations, sinon un
   changement de modèle peut altérer les données en production.
3. **Notifications livreur.** Le temps réel passe par Socket.io : le livreur
   est prévenu tant que la page est ouverte. Pour une alerte écran éteint,
   ajoutez les notifications web push.
4. **Suppléments payants.** « Extra fromage » part bien en cuisine mais n'est
   pas facturé : le prix vient uniquement du produit. À ajouter si vous voulez
   les vendre.
5. **Numéro de commande** : compteur global modulo 999. Pour une remise à zéro
   quotidienne, filtrez par date dans `getNextOrderNumber`.
6. **Frais de livraison (7 DT)** codés dans `order.routes.js`, commission (70 %)
   dans `.env`. À rendre modifiables depuis l'écran de gestion.

---

## Structure

```
backend/        API Express, PostgreSQL, Socket.io — inchangé, déjà éprouvé
  src/routes/   authentification, produits, commandes, caisse, livraison, stock,
                rapports, employés
  tests/        4 suites exécutables contre un vrai serveur
web/
  src/lib/      client API typé, socket, formats, store
  src/components/  système de composants, carte, scanner QR
  src/screens/  un dossier par poste
```
