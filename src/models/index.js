const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config');

const { host, port, user, password, database } = config.db;

const sequelize = new Sequelize(database, user, password, {
  host,
  port,
  dialect: 'mysql',
  logging: false,
  timezone: '+00:00',
  pool: { max: 20, min: 0, acquire: 30000, idle: 10000 },
  define: { underscored: true }, // camelCase in JS <-> snake_case columns in DB
});

const Endpoint = sequelize.define(
  'Endpoint',
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    url: { type: DataTypes.STRING(2048), allowNull: false },
  },
  { tableName: 'webhook_endpoints', updatedAt: false }
);

const Subscription = sequelize.define(
  'Subscription',
  {
    endpointId: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
    eventType: { type: DataTypes.STRING(64), primaryKey: true },
  },
  { tableName: 'endpoint_subscriptions', timestamps: false }
);

const Event = sequelize.define(
  'Event',
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    eventId: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    eventType: { type: DataTypes.STRING(64), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
  },
  { tableName: 'events', updatedAt: false }
);

const Delivery = sequelize.define(
  'Delivery',
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    eventPk: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    endpointId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.ENUM('pending', 'succeeded', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    lastStatusCode: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
    lastError: { type: DataTypes.STRING(512), allowNull: true },
    lastAttemptAt: { type: DataTypes.DATE(3), allowNull: true },
  },
  { tableName: 'deliveries' }
);

// Relations
Endpoint.hasMany(Subscription, { foreignKey: 'endpointId', as: 'subscriptions' });
Subscription.belongsTo(Endpoint, { foreignKey: 'endpointId' });

Event.hasMany(Delivery, { foreignKey: 'eventPk', as: 'deliveries' });
Delivery.belongsTo(Event, { foreignKey: 'eventPk', as: 'event' });

Endpoint.hasMany(Delivery, { foreignKey: 'endpointId', as: 'deliveries' });
Delivery.belongsTo(Endpoint, { foreignKey: 'endpointId', as: 'endpoint' });

module.exports = { sequelize, Endpoint, Subscription, Event, Delivery };
