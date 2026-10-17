const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Derniere position connue de chaque livreur, mise a jour en continu pendant une livraison.
const DriverLocation = sequelize.define('DriverLocation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  driverId: { type: DataTypes.UUID, allowNull: false, unique: true },
  lat: { type: DataTypes.FLOAT, allowNull: false },
  lng: { type: DataTypes.FLOAT, allowNull: false },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'driver_locations',
  timestamps: false,
});

module.exports = DriverLocation;
