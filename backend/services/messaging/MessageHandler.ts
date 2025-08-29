import { channelsService } from '@/backend/services/channels/channels.service';
import { customersService } from '@/backend/services/customers/customers.service';
import { chatsService } from '@/backend/services/chats/chats.service';
import { executeAgent } from '@/backend/services/ai/manager';
import { Customer } from '@/backend/services/customers/customers.types';
import { ConnectedChannelWithIncludes } from '@/backend/services/channels/channels.types';
import { Chat } from '@/backend/services/chats/chats.types';
import { messages } from '@/db/schema';
import { IMessagingClient } from './IMessagingClient';

// We'll need a generic message object type, for now, we'll use a simplified version
// of the Facebook message object. This can be expanded later.
export interface GenericMessage {
    sender: { id: string };
    recipient: { id: string };
    message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{ type: string; payload?: unknown }>;
        is_echo?: boolean;
    };
}

export class MessageHandler {
    private client: IMessagingClient;
    private channel: ConnectedChannelWithIncludes | null = null;
    private customer: Customer | null = null;
    private chat: Chat | null = null;
    private log: (message: string, ...args: unknown[]) => void;

    constructor(client: IMessagingClient, log: (message: string, ...args: unknown[]) => void = console.log) {
        this.client = client;
        this.log = log;
    }

    public async handle<T extends GenericMessage>(message: T): Promise<void> {
        if (message.sender.id === message.recipient.id || !message.message || message.message.is_echo) {
            return;
        }

        this.log(`Processing message for recipient: ${message.recipient.id} from sender: ${message.sender.id}`);
        await this.initialize(message.recipient.id, message.sender.id);

        if (!this.channel || !this.customer || !this.chat) {
            this.log('Initialization failed, aborting message handling.');
            return;
        }

        if (message.message.attachments) {
            await this.handleAttachmentMessage(message);
        } else if (message.message.text) {
            await this.handleTextMessage(message);
        } else {
            this.log(`Received unhandled message type from ${message.sender.id}:`, message.message);
            await this.client.sendTextMessage(message.sender.id, `Received a message of a type we don't fully support yet.`);
        }
    }

    private async initialize(recipientPageId: string, senderPlatformId: string): Promise<void> {
        try {
            await this.findChannel(recipientPageId, senderPlatformId);
            if (this.channel) {
                await this.findOrCreateCustomer(senderPlatformId);
                await this.findOrCreateChat(senderPlatformId);
            }
        } catch (error) {
            this.log('Error during initialization:', error);
        }
    }

    private async findChannel(recipientPageId: string, senderPlatformId: string): Promise<void> {
        const { data } = await channelsService.getAllChannels({
            filter: { platformSpecificId: recipientPageId },
            include: {
                business: true,
                customers: { limit: 1, platformCustomerId: senderPlatformId },
                chats: { limit: 1, platformCustomerId: senderPlatformId }
            },
            limit: 1,
        });
        this.channel = data[0];
        if (this.channel) {
            this.log(`Found channel: ${this.channel.channelId}`);
            this.customer = this.channel.customers?.[0] || null;
            this.chat = this.channel.chats?.[0] || null;
        } else {
            this.log(`Channel not found for recipient: ${recipientPageId}`);
        }
    }

    private async findOrCreateCustomer(senderPlatformId: string): Promise<void> {
        if (this.customer) {
            this.log(`Found customer: ${this.customer.customerId}`);
        } else if (this.channel) {
            this.customer = await customersService.createCustomer({
                platformCustomerId: senderPlatformId,
                channelId: this.channel.channelId,
                fullName: `User ${senderPlatformId}`,
                businessId: this.channel.business!.businessId,
            });
            this.log(`Created new customer: ${this.customer.customerId}`);
        }
    }

    private async findOrCreateChat(senderPlatformId: string): Promise<void> {
        if (this.chat) {
            this.log(`Found chat: ${this.chat.chatId}`);
        } else if (this.channel) {
            this.chat = await chatsService.createChat({
                platformCustomerId: senderPlatformId,
                channelId: this.channel.channelId,
                businessId: this.channel.business!.businessId,
                providerUserId: this.channel.providerUserId,
                status: 'OPEN',
            });
            this.log(`Created new chat: ${this.chat.chatId}`);
        }
    }

    private async handleAttachmentMessage(message: GenericMessage): Promise<void> {
        const attachment = message.message?.attachments?.[0];
        if (attachment?.type === 'image' && attachment.payload && typeof attachment.payload === 'object' && 'url' in attachment.payload) {
            const payload = attachment.payload as { url: string };
            const messageContent: Omit<typeof messages.$inferInsert, 'messageId' | 'chatId' | 'timestamp' | "platformMessageId"> = {
                content: `A image with [IMAGE URL]: ${payload.url}`,
                senderType: 'CUSTOMER',
                contentType: 'IMAGE',
            };
            const lastMsgs = await chatsService.handleNewMessage(messageContent, this.chat!.chatId);
            await this.client.sendTextMessage(message.sender.id, `Please wait a moment while processing the image. This may take a minute...`);
            await this.executeAI(lastMsgs, message.sender.id);
        } else {
            await this.client.sendTextMessage(message.sender.id, `Can not process ${attachment?.type} attachments yet.`);
        }
    }

    private async handleTextMessage(message: GenericMessage): Promise<void> {
        const text = message.message!.text!;
        const platformMessageId = message.message!.mid;
        const messageContent: Omit<typeof messages.$inferInsert, 'messageId' | 'chatId' | 'timestamp'> = {
            content: text,
            senderType: 'CUSTOMER',
            contentType: 'TEXT',
            platformMessageId: platformMessageId,
        };
        await this.client.markSeen(message.sender.id);
        await this.client.toggleTyping(message.sender.id, true);
        const lastMsgs = await chatsService.handleNewMessage(messageContent, this.chat!.chatId);
        await this.executeAI(lastMsgs, message.sender.id);
    }

    private async executeAI(lastMsgs: (typeof messages.$inferSelect)[], messageSenderPsid: string): Promise<void> {
        const customerInfo = `
            Name: ${this.customer!.fullName}
            Contact: ${this.customer!.contact ? this.customer!.contact : "No contact available. If make any order ask contact number."}
            Address: ${this.customer!.address ? this.customer!.address : "No address available. If make any order ask address."}
        `;

        const replyUserFn = async (msg: unknown) => {
            const content = typeof msg === 'string' ? msg : JSON.stringify(msg);
            await this.client.sendTextMessage(messageSenderPsid, content);
            await this.client.toggleTyping(messageSenderPsid, false);
            await chatsService.handleNewMessage(
                { content, senderType: 'BOT', contentType: 'TEXT', platformMessageId: undefined },
                this.chat!.chatId,
            );
        };

        const replyUserWithProductImageAndInfoFn = async (productImageURL: string, productInfo: string) => {
            await this.client.sendImageMessage(messageSenderPsid, productImageURL);
            await this.client.sendTextMessage(messageSenderPsid, productInfo);
            await this.client.toggleTyping(messageSenderPsid, false);
            await chatsService.handleNewMessage(
                { content: productInfo, senderType: 'BOT', contentType: 'TEXT', platformMessageId: undefined },
                this.chat!.chatId,
            );
        };

        await executeAgent(
            lastMsgs,
            this.customer!.customerId,
            this.channel!.channelId,
            this.channel!.business?.description || null,
            this.channel!.business!.businessId,
            this.customer!.address || "",
            customerInfo,
            replyUserFn,
            replyUserWithProductImageAndInfoFn,
            this.log
        );
    }
}