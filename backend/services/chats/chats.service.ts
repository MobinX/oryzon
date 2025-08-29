import { db } from '@/db';
import { chats, messages, customers, connectedChannels, users, businesses } from '@/db/schema'; // Added businesses
import {
  Chat,
  NewChat, // Added NewChat
  CreateChatData,
  UpdateChatData,
  GetChatByIdOptions,
  GetAllChatsOptions,
  ChatFilterOptions,
  UpdateManyChatsData,
  ChatWithIncludes,
} from './chats.types';
import { and, count, eq, ilike, inArray, desc, asc, gte, lte } from 'drizzle-orm';

export class ChatsService {
  constructor() {}

  async createChat(data: CreateChatData): Promise<Chat> { // CreateChatData now includes businessId and optional providerUserId
    const [newChat] = await db
      .insert(chats)
      .values({
        businessId: data.businessId,
        platformCustomerId: data.platformCustomerId, // Changed from customerId
        channelId: data.channelId,
        providerUserId: data.providerUserId, // Will be null if not provided
        status: data.status || 'OPEN', // Default status
        // startedAt and lastMessageAt have defaults in schema or are set by triggers/service logic
      })
      .returning();
    return newChat;
  }

  async getChatById(chatId: string, options?: GetChatByIdOptions): Promise<ChatWithIncludes | null> {
    const query = db.query.chats.findFirst({
      where: eq(chats.chatId, chatId),
      with: {
        business: options?.include?.business ? true : undefined, // Added business
        userViaProviderId: options?.include?.userViaProviderId ? true : undefined, // Added userViaProviderId
        customer: options?.include?.customer ? true : undefined,
        connectedChannel: options?.include?.connectedChannel ? { with: { business: true } } : undefined,
        messages: options?.include?.messages 
          ? { 
              limit: typeof options.include.messages === 'boolean' ? undefined : options.include.messages.limit,
              orderBy: (messagesTable, { asc, desc }) => {
                if (typeof options.include?.messages === 'object' && options.include.messages.orderBy) {
                  const { field, direction } = options.include.messages.orderBy;
                  // Ensure field is a valid column of messagesTable
                  if (field in messagesTable) {
                    return [direction === 'asc' ? asc(messagesTable[field]) : desc(messagesTable[field])];
                  }
                }
                return [desc(messagesTable.timestamp)]; // Default order for messages
              }
            } 
          : undefined,
      }
    });
    const chat = await query;
    return chat ? (chat as ChatWithIncludes) : null;
  }

  async getAllChats(options?: GetAllChatsOptions): Promise<{ data: ChatWithIncludes[]; total: number }> {
    const page = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    const filter = options?.filter; // Type is Partial<Pick<Chat, 'businessId' | 'platformCustomerId' | ...>>
    const conditions = [];

    if (filter?.businessId) { // Added businessId filter
      conditions.push(eq(chats.businessId, filter.businessId));
    }
    if (filter?.providerUserId) { // Added providerUserId filter
      conditions.push(eq(chats.providerUserId, filter.providerUserId));
    }
    if (filter?.platformCustomerId) { // Changed from customerId
      conditions.push(eq(chats.platformCustomerId, filter.platformCustomerId));
    }
    if (filter?.channelId) {
      conditions.push(eq(chats.channelId, filter.channelId));
    }
    if (filter?.status) {
      conditions.push(eq(chats.status, filter.status));
    }
     if (filter?.chatType) {
      conditions.push(eq(chats.chatType, filter.chatType));
    }
    // Date range filters (startedAtBefore, etc.) are part of ChatFilterOptions, not GetAllChatsOptions.filter.
    // Removing them to match the current type definition for GetAllChatsOptions.
    // if (filter?.startedAtBefore) {
    //   conditions.push(lte(chats.startedAt, filter.startedAtBefore));
    // }
    // if (filter?.startedAtAfter) {
    //   conditions.push(gte(chats.startedAt, filter.startedAtAfter));
    // }
    // if (filter?.lastMessageAtBefore) {
    //   conditions.push(lte(chats.lastMessageAt, filter.lastMessageAtBefore));
    // }
    // if (filter?.lastMessageAtAfter) {
    //   conditions.push(gte(chats.lastMessageAt, filter.lastMessageAtAfter));
    // }

    const chatsQuery = db.query.chats.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit: page,
      offset: offset,
      with: {
        business: options?.include?.business ? true : undefined, // Added business
        userViaProviderId: options?.include?.userViaProviderId ? true : undefined, // Added userViaProviderId
        customer: options?.include?.customer ? true : undefined,
        connectedChannel: options?.include?.connectedChannel ? { with: { business: true } } : undefined,
        messages: options?.include?.messages 
          ? { 
              limit: typeof options.include.messages === 'boolean' ? undefined : options.include.messages.limit,
               orderBy: (messagesTable, { asc, desc }) => {
                if (typeof options.include?.messages === 'object' && options.include.messages.orderBy) {
                  const { field, direction } = options.include.messages.orderBy;
                   if (field in messagesTable) {
                    return [direction === 'asc' ? asc(messagesTable[field]) : desc(messagesTable[field])];
                  }
                }
                return [desc(messagesTable.timestamp)];
              }
            } 
          : undefined,
      },
      orderBy: [desc(chats.lastMessageAt), desc(chats.startedAt)]
    });

    const totalQuery = db.select({ value: count() }).from(chats).where(conditions.length > 0 ? and(...conditions) : undefined);

    const [data, totalResult] = await Promise.all([chatsQuery, totalQuery]);
    
    return { data: data as ChatWithIncludes[], total: totalResult[0]?.value ?? 0 };
  }

  async updateChat(chatId: string, data: UpdateChatData): Promise<Chat | null> {
    const [updatedChat] = await db
      .update(chats)
      .set({ ...data }) // Removed updatedAt as it's not in the schema
      .where(eq(chats.chatId, chatId))
      .returning();
    return updatedChat || null;
  }

  async updateChatStatus(chatId: string, status: (typeof chats.status.enumValues)[number]): Promise<void> {
    await db.update(chats).set({ status }).where(eq(chats.chatId, chatId));
  }

  async updateManyChats(filter: ChatFilterOptions, data: UpdateManyChatsData): Promise<{ count: number }> {
    if (!filter.ids || filter.ids.length === 0) {
      return { count: 0 };
    }
    const result = await db
      .update(chats)
      .set({ ...data }) // Removed updatedAt as it's not in the schema
      .where(inArray(chats.chatId, filter.ids as string[]));
      
    return { count: result.rowCount ?? 0 };
  }

  async deleteChat(chatId: string): Promise<boolean> {
    await db.delete(messages).where(eq(messages.chatId, chatId));
    const result = await db.delete(chats).where(eq(chats.chatId, chatId));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteManyChats(filter: ChatFilterOptions): Promise<{ count: number }> {
    if (!filter.ids || filter.ids.length === 0) {
      return { count: 0 };
    }
    const result = await db.delete(chats).where(inArray(chats.chatId, filter.ids as string[]));
    return { count: result.rowCount ?? 0 };
  }

  async handleNewMessage(
    messageContent: Omit<typeof messages.$inferInsert, 'messageId' | 'chatId'| 'timestamp'>, // Exclude messageId, chatId, and timestamp as they are auto-generated
    chatId: string,
  ): Promise<(typeof messages.$inferSelect)[]> {
    // 1. Find the chat or determine businessId and provi...0
   

    // 2. Create a new message entity
    // Assuming senderType is 'CUSTOMER' and contentType is 'TEXT' for new messages via this handler
    await db
      .insert(messages)
      .values({
        chatId: chatId,
        ...messageContent,
      })
      .returning(); // .returning() to get the new message if needed, though not used here

    // 3. Update the chat's lastMessageAt timestamp
    await db
      .update(chats)
      .set({ lastMessageAt: new Date() })
      .where(eq(chats.chatId, chatId));

    // 4. Retrieve and return the last minimum 100 messages for that chat
    const lastMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: [asc(messages.timestamp)],
      limit: 100,
    });

    // The messages are returned newest first. If chronological order (oldest first) is needed for display,
    // the client can reverse this array.
    return lastMessages;
  }
}

export const chatsService = new ChatsService();
