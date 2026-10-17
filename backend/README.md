# Backend — Système de gestion de restaurant

API centrale utilisée par : borne de commande, caisse, écran cuisine, application manager,
application client mobile, application livreur, super admin.

## Prérequis
- Node.js 18+
- PostgreSQL 14+ installé (localement ou hébergé — ex: Railway, Render, Supabase)

## Installation

```bash
cd backend
npm install
cp .env.example .env
```

Ouvre `.env` et renseigne les identifiants de ta base PostgreSQL (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc.)
et une valeur longue et aléatoire pour `JWT_SECRET`.

## Créer les tables + données de démarrage

```bash
npm run seed
```

Cela crée : un compte super admin, un manager, un caissier (code `1234`), un livreur,
2 catégories, 2 produits et leurs ingrédients en stock.

⚠️ `npm run seed` **efface toutes les données existantes** (à utiliser uniquement au début).

## Démarrer le serveur

```bash
npm run dev
```

Le serveur écoute par défaut sur `http://localhost:4000`.
Vérifie qu'il tourne : `http://localhost:4000/health`

## Structure du projet

```
src/
  config/database.js      -> connexion PostgreSQL (Sequelize)
  models/                 -> tables : User, Product, Ingredient, Order, etc.
  routes/                 -> endpoints API par domaine
  middleware/auth.js       -> vérification JWT + rôles
  sockets/socketHandler.js -> événements temps réel (Socket.io)
  server.js                -> point d'entrée
  seed.js                  -> données de démarrage
```

## Principaux endpoints

| Domaine | Endpoint | Rôle requis |
|---|---|---|
| Auth | `POST /api/auth/login` | public |
| Auth | `POST /api/auth/login-code` | public (caissier) |
| Auth | `POST /api/auth/login-qr` | public |
| Produits | `GET /api/products` | public |
| Commande | `POST /api/orders/kiosk` | public (borne) |
| Commande | `POST /api/orders/online` | client connecté |
| Caisse | `POST /api/orders/:id/pay` | cashier |
| Cuisine | `POST /api/orders/:id/kitchen-status` | cook |
| Livraison | `GET /api/delivery/available` | driver |
| Livraison | `POST /api/delivery/:id/accept` | driver |
| Livraison | `POST /api/delivery/:id/confirm-delivery` | driver |
| Rapports | `GET /api/reports/net-profit` | manager |

## Prochaine étape

Une fois ce backend démarré et testé (avec un outil comme Postman ou Thunder Client),
on connecte les applications Flutter (borne, mobile client, livreur) et l'app desktop
caissier/manager à cette API.
