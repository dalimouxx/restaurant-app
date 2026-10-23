const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Category = sequelize.define('Category', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  /** Nom arabe, facultatif : vide, la carte arabe garde le nom d'origine. */
  nameAr: { type: DataTypes.STRING },
  displayOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'categories',
  timestamps: true,
});

module.exports = Category;
