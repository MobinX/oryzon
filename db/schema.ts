import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  boolean,
  integer,
  decimal,
  jsonb,
  pgEnum,
  unique, // Added unique
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ENUMs
export const loginProviderEnum = pgEnum('login_provider', ['EMAIL', 'GOOGLE', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'INSTAGRAM']);
export const platformTypeEnum = pgEnum('platform_type', ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'LINKEDIN_PAGE', 'TWITTER_PROFILE']);
export const orderStatusEnum = pgEnum('order_status', ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'CANCELLED']);
export const chatStatusEnum = pgEnum('chat_status', ['OPEN', 'PROCESSING', 'CLOSED_BY_BOT', 'CLOSED_BY_AGENT', 'ARCHIVED']);
export const messageSenderTypeEnum = pgEnum('message_sender_type', ['BOT', 'CUSTOMER', 'AGENT']);
export const messageContentTypeEnum = pgEnum('message_content_type', ['TEXT', 'IMAGE', 'AUDIO',]);
export const chatTypeEnum = pgEnum('chat_type', ['real', 'test']);
export const messageStatusEnum = pgEnum('message_status', ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED']);
// Tables
export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().defaultRandom(), // Primary internal ID
  name: text('name').notNull(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  // businessName removed
  loginProvider: loginProviderEnum('login_provider'),
  providerUserId: text('provider_user_id').unique(), // Nullable, from OAuth provider
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const businesses = pgTable('businesses', {
  businessId: uuid('business_id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.userId), // Link to primary user ID
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  name: text('name').notNull(),
  description: text('description'), // New field
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const connectedChannels = pgTable('connected_channels', {
  channelId: uuid('channel_id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.businessId),
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  platformType: platformTypeEnum('platform_type').notNull(),
  platformSpecificId: text('platform_specific_id').notNull(),
  description: text('description'),
  channelName: text('channel_name'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customers = pgTable('customers', {
  customerId: uuid('customer_id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.businessId),
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  channelId: uuid('channel_id').references(() => connectedChannels.channelId),
  platformCustomerId: text('platform_customer_id').notNull(),
  fullName: text('full_name'),
  address: text('address').default(""),
  contact: text('contact').default(""),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  profilePictureUrl: text('profile_picture_url'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueConstraints: {
    platformUniqueConstraint: unique('customer_platform_idx').on(table.businessId, table.channelId, table.platformCustomerId),
  }
}));

export const products = pgTable('products', {
  productId: uuid('product_id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.businessId),
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  sku: text('sku'),
  imageUrl: text('image_url'),
  imageId: text('image_id'),
  shortId: text('short_id'),
  isAvailable: boolean('is_available').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  orderId: uuid('order_id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.businessId),
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  customerId: uuid('customer_id').notNull().references(() => customers.customerId),
  channelId: uuid('channel_id').references(() => connectedChannels.channelId),
  orderStatus: orderStatusEnum('order_status').default('PENDING').notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  shippingAddress: text('shipping_address').notNull(),
  customerContact: text('customer_contact').notNull(),
  customerName: text('customer_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  orderItemId: uuid('order_item_id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.orderId),
  productId: uuid('product_id').notNull().references(() => products.productId),
  quantity: integer('quantity').notNull(),
  priceAtPurchase: decimal('price_at_purchase', { precision: 10, scale: 2 }).notNull(),
  currencyAtPurchase: varchar('currency_at_purchase', { length: 3 }).notNull(),
});

export const chats = pgTable('chats', {
  chatId: uuid('chat_id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.businessId), // Added businessId
  platformCustomerId: text('platform_customer_id').notNull(), // Changed from customerId
  channelId: uuid('channel_id').references(() => connectedChannels.channelId),
  providerUserId: text('provider_user_id').references(() => users.providerUserId), // Denormalized, nullable
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
  status: chatStatusEnum('status').default('OPEN').notNull(),
  chatType: chatTypeEnum("chat_type").default("real").notNull() // Removed explicit foreignKey block
});
export const messages = pgTable('messages', {
  messageId: uuid('message_id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull().references(() => chats.chatId),
  senderType: messageSenderTypeEnum('sender_type').notNull(),
  contentType: messageContentTypeEnum('content_type').notNull(),
  content: text('content').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  platformMessageId: text('platform_message_id'),
  status: messageStatusEnum('status').default('PENDING').notNull(),
  totalTimeTaken: decimal("total_time_taken", { precision: 10, scale: 2 }).default("0"),
  cost: decimal("cost", { precision: 10, scale: 2 }).default("0"),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  businesses: many(businesses),
  // Denormalized direct links via providerUserId for easier querying if needed
  denormalizedConnectedChannels: many(connectedChannels, { relationName: 'userToChannelsDenorm' }),
  denormalizedProducts: many(products, { relationName: 'userToProductsDenorm' }),
  denormalizedOrders: many(orders, { relationName: 'userToOrdersDenorm' }),
  denormalizedCustomers: many(customers, { relationName: 'userToCustomersDenorm' }),
  denormalizedChats: many(chats, { relationName: 'userToChatsDenorm' }),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  user: one(users, { // Primary user link
    fields: [businesses.userId],
    references: [users.userId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [businesses.providerUserId],
    references: [users.providerUserId],
    relationName: 'businessToUserViaProviderIdDenorm',
  }),
  connectedChannels: many(connectedChannels),
  products: many(products),
  customers: many(customers),
  orders: many(orders),
}));

export const connectedChannelsRelations = relations(connectedChannels, ({ one, many }) => ({
  business: one(businesses, {
    fields: [connectedChannels.businessId],
    references: [businesses.businessId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [connectedChannels.providerUserId],
    references: [users.providerUserId],
    relationName: 'channelToUserViaProviderIdDenorm',
  }),
  customers: many(customers),
  orders: many(orders),
  chats: many(chats),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [customers.businessId],
    references: [businesses.businessId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [customers.providerUserId],
    references: [users.providerUserId],
    relationName: 'customerToUserViaProviderIdDenorm',
  }),
  connectedChannel: one(connectedChannels, {
    fields: [customers.channelId],
    references: [connectedChannels.channelId],
  }),
  orders: many(orders),
  chats: many(chats),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  business: one(businesses, {
    fields: [products.businessId],
    references: [businesses.businessId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [products.providerUserId],
    references: [users.providerUserId],
    relationName: 'productToUserViaProviderIdDenorm',
  }),
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  business: one(businesses, {
    fields: [orders.businessId],
    references: [businesses.businessId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [orders.providerUserId],
    references: [users.providerUserId],
    relationName: 'orderToUserViaProviderIdDenorm',
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.customerId],
  }),
  connectedChannel: one(connectedChannels, {
    fields: [orders.channelId],
    references: [connectedChannels.channelId],
  }),
  orderItems: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.orderId],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.productId],
  }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  business: one(businesses, { // Added business relation
    fields: [chats.businessId],
    references: [businesses.businessId],
  }),
  customer: one(customers, {
    fields: [chats.businessId, chats.channelId, chats.platformCustomerId],
    references: [customers.businessId, customers.channelId, customers.platformCustomerId],
  }),
  connectedChannel: one(connectedChannels, {
    fields: [chats.channelId],
    references: [connectedChannels.channelId],
  }),
  userViaProviderId: one(users, { // Denormalized link
    fields: [chats.providerUserId],
    references: [users.providerUserId],
    relationName: 'chatToUserViaProviderIdDenorm',
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.chatId],
  }),
}));
