import { db } from '@/db';
import { messages, chats } from '@/db/schema';
import {
  Message,
  CreateMessageData,
  UpdateMessageData,
  GetMessageByIdOptions,
  GetAllMessagesOptions,
  MessageFilterOptions,
  // UpdateManyMessagesData, // Removed as per user feedback
  MessageWithIncludes,
} from './messages.types';
import { and, count, eq, ilike, inArray, desc, asc, gte, lte, sql } from 'drizzle-orm';

export class MessagesService {
  constructor() {}

  async createMessage(data: CreateMessageData): Promise<Message> {
    // When a new message is created, update the lastMessageAt field in the parent chat
    const [newMessage] = await db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(messages)
        .values(data) // timestamp is handled by default in schema or db
        .returning();
      
      if (msg) {
        await tx
          .update(chats)
          .set({ lastMessageAt: new Date() }) // Update chat's lastMessageAt
          .where(eq(chats.chatId, msg.chatId));
      }
      return msg ? [msg] : []; // Ensure it returns an array or Drizzle might complain
    });
     if (!newMessage) {
      // This case should ideally not be reached if transaction is set up correctly
      // and data is valid. Consider more robust error handling or specific error type.
      throw new Error("Failed to create message or update chat.");
    }
    return newMessage;
  }

  async getMessageById(messageId: string, options?: GetMessageByIdOptions): Promise<MessageWithIncludes | null> {
    const query = db.query.messages.findFirst({
      where: eq(messages.messageId, messageId),
      with: {
        chat: options?.include?.chat ? true : undefined,
      }
    });
    const message = await query;
    return message || null;
  }

  async getAllMessages(options: GetAllMessagesOptions): Promise<{ data: MessageWithIncludes[]; total: number }> {
    const page = options.limit ?? 30; // Default to more messages for a chat
    const offset = options.offset ?? 0;

    const filter = options.filter; // chatId is mandatory in filter type
    const conditions = [eq(messages.chatId, filter.chatId)];

    if (filter.senderType) {
      conditions.push(eq(messages.senderType, filter.senderType));
    }
    if (filter.contentType) {
      conditions.push(eq(messages.contentType, filter.contentType));
    }
    if (filter.timestampBefore) {
      conditions.push(lte(messages.timestamp, filter.timestampBefore));
    }
    if (filter.timestampAfter) {
      conditions.push(gte(messages.timestamp, filter.timestampAfter));
    }

    let orderByClause = [desc(messages.timestamp)]; // Default order
    if (options.orderBy) {
        const { field, direction } = options.orderBy;
        if (field in messages) { // Basic check if field is a key of messages schema
             orderByClause = [direction === 'asc' ? asc(messages[field as keyof typeof messages.$inferSelect]) : desc(messages[field as keyof typeof messages.$inferSelect])];
        }
    }


    const messagesQuery = db.query.messages.findMany({
      where: and(...conditions),
      limit: page,
      offset: offset,
      with: {
        chat: options.include?.chat ? true : undefined,
      },
      orderBy: orderByClause,
    });

    const totalQuery = db.select({ value: count() }).from(messages).where(and(...conditions));

    const [data, totalResult] = await Promise.all([messagesQuery, totalQuery]);
    
    return { data, total: totalResult[0]?.value ?? 0 };
  }

  async updateMessage(messageId: string, data: UpdateMessageData): Promise<Message | null> {
    // Messages are often immutable, but allow content update as an example
    const [updatedMessage] = await db
      .update(messages)
      .set(data)
      .where(eq(messages.messageId, messageId))
      .returning();
    return updatedMessage || null;
  }

  // deleteMessage and deleteManyMessages are often not implemented or are soft deletes
  // due to the nature of chat histories.
  async deleteMessage(messageId: string): Promise<boolean> {
    // Consider implications: this is a hard delete.
    const result = await db.delete(messages).where(eq(messages.messageId, messageId));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteManyMessages(filter: MessageFilterOptions): Promise<{ count: number }> {
     if (!filter.ids || filter.ids.length === 0) {
        if (filter.chatId) { // Allow deleting all messages for a chat
            const result = await db.delete(messages).where(eq(messages.chatId, filter.chatId));
            return { count: result.rowCount ?? 0 };
        }
      return { count: 0 };
    }
    const result = await db.delete(messages).where(inArray(messages.messageId, filter.ids as string[]));
    return { count: result.rowCount ?? 0 };
  }

  async getPendingMessages(chatId: string): Promise<(Message &  {sender_type?: string, message_id: string})[] > {
    const query = sql`
      WITH pending_messages AS (
        SELECT *
        FROM ${messages}
        WHERE ${messages.chatId} = ${chatId} AND ${messages.status} = 'PENDING'
      ),
      messages_before_pending AS (
        SELECT *
        FROM ${messages}
        WHERE ${messages.chatId} = ${chatId} AND ${messages.timestamp} < (SELECT MIN(timestamp) FROM pending_messages)
        ORDER BY ${messages.timestamp} DESC
        LIMIT 20
      )
      SELECT * FROM messages_before_pending
      UNION ALL
      SELECT * FROM pending_messages
      ORDER BY timestamp ASC;
    `;

    // Execute the raw query
    const result = await db.execute(query);
    console.log((result as unknown as { rows: Message[] }).rows)
    // The query is designed to return an empty result set if no pending messages are found.
    // The `result` from `db.execute` (with node-postgres) is an object with a `rows` property.
    // This avoids the extra database call from the previous implementation.
    return (result as unknown as { rows: (Message &  {sender_type?: string, message_id: string})[]  }).rows;
  }

  async updateMessageStatus(messageIds: string[], status: (typeof messages.status.enumValues)[number]): Promise<void> {
    if (messageIds.length === 0) return;
    await db.update(messages).set({ status }).where(inArray(messages.messageId, messageIds));
  }
}

export const messagesService = new MessagesService();
