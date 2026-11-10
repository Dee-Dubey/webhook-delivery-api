'use strict';

/**
 * Creates all 4 tables from a clean database.
 * Integrity rules live HERE (in the DB), not only in application code:
 *   - events.event_id            UNIQUE         -> duplicate events rejected, even under concurrency
 *   - deliveries(event_pk, endpoint_id) UNIQUE  -> one delivery record per event+endpoint
 *   - foreign keys on every link table
 *   - index (event_type, endpoint_id)           -> fast "who subscribes to this event type?" lookup
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP(3)');

    await queryInterface.createTable('webhook_endpoints', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      url: { type: DataTypes.STRING(2048), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now },
    });

    await queryInterface.createTable('endpoint_subscriptions', {
      endpoint_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        references: { model: 'webhook_endpoints', key: 'id' },
        onDelete: 'CASCADE',
      },
      event_type: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    });
    await queryInterface.addIndex('endpoint_subscriptions', ['event_type', 'endpoint_id'], {
      name: 'idx_subscriptions_event_type',
    });

    await queryInterface.createTable('events', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      event_id: { type: DataTypes.STRING(255), allowNull: false },
      event_type: { type: DataTypes.STRING(64), allowNull: false },
      payload: { type: DataTypes.JSON, allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('events', ['event_id'], {
      unique: true,
      name: 'uq_events_event_id',
    });

    await queryInterface.createTable('deliveries', {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      event_pk: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'events', key: 'id' },
        onDelete: 'CASCADE',
      },
      endpoint_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'webhook_endpoints', key: 'id' },
        onDelete: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM('pending', 'succeeded', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_status_code: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      last_error: { type: DataTypes.STRING(512), allowNull: true },
      last_attempt_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now },
    });
    await queryInterface.addIndex('deliveries', ['event_pk', 'endpoint_id'], {
      unique: true,
      name: 'uq_delivery_event_endpoint',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('deliveries');
    await queryInterface.dropTable('events');
    await queryInterface.dropTable('endpoint_subscriptions');
    await queryInterface.dropTable('webhook_endpoints');
  },
};
