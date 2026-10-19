const sequelize = require('../config/database');

const User = require('./User');
const Category = require('./Category');
const Ingredient = require('./Ingredient');
const Product = require('./Product');
const ProductIngredient = require('./ProductIngredient');
const ProductOption = require('./ProductOption');
const Order = require('./Order');
const OrderItem = require('./OrderItem');
const CashSession = require('./CashSession');
const StockMovement = require('./StockMovement');
const DriverLocation = require('./DriverLocation');
const { Setting } = require('./Setting');
const AuditLog = require('./AuditLog');

// --- Associations ---

Category.hasMany(Product, { foreignKey: 'categoryId' });
Product.belongsTo(Category, { foreignKey: 'categoryId' });

Product.belongsToMany(Ingredient, { through: ProductIngredient, foreignKey: 'productId' });
Ingredient.belongsToMany(Product, { through: ProductIngredient, foreignKey: 'ingredientId' });

Product.hasMany(ProductOption, { foreignKey: 'productId', as: 'options' });
ProductOption.belongsTo(Product, { foreignKey: 'productId' });
ProductOption.belongsTo(Ingredient, { foreignKey: 'ingredientId' });

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });
OrderItem.belongsTo(Product, { foreignKey: 'productId' });

User.hasMany(Order, { foreignKey: 'customerId', as: 'customerOrders' });
User.hasMany(Order, { foreignKey: 'cashierId', as: 'cashierOrders' });
User.hasMany(Order, { foreignKey: 'driverId', as: 'driverOrders' });
Order.belongsTo(User, { foreignKey: 'customerId', as: 'customer' });
Order.belongsTo(User, { foreignKey: 'cashierId', as: 'cashier' });
Order.belongsTo(User, { foreignKey: 'driverId', as: 'driver' });

User.hasMany(CashSession, { foreignKey: 'cashierId' });
CashSession.belongsTo(User, { foreignKey: 'cashierId' });

Ingredient.hasMany(StockMovement, { foreignKey: 'ingredientId' });
StockMovement.belongsTo(Ingredient, { foreignKey: 'ingredientId' });

User.hasOne(DriverLocation, { foreignKey: 'driverId' });
DriverLocation.belongsTo(User, { foreignKey: 'driverId' });

module.exports = {
  sequelize,
  User,
  Category,
  Ingredient,
  Product,
  ProductIngredient,
  ProductOption,
  Order,
  OrderItem,
  CashSession,
  StockMovement,
  DriverLocation,
  Setting,
  AuditLog,
};
