const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  fullName: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, unique: true },
  email: { type: DataTypes.STRING, unique: true },
  passwordHash: { type: DataTypes.STRING }, // pour admin/manager/cashier/cook (login classique)
  loginCode: { type: DataTypes.STRING, unique: true }, // code court utilise par caissier
  qrToken: { type: DataTypes.STRING, unique: true }, // token encode dans le QR code du badge
  role: {
    type: DataTypes.ENUM('super_admin', 'admin', 'manager', 'cashier', 'cook', 'driver', 'customer'),
    allowNull: false,
    defaultValue: 'customer',
  },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'users',
  timestamps: true,
});

module.exports = User;
